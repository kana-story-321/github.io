/**
 * 営業ノウハウAI (GAS 版)
 * ノウハウマスタ.xlsx をスプシで開いて、以下を貼付して使う。
 *
 * 使い方:
 *   1. メニュー「営業ノウハウAI」→「▶ ボットを開く」
 *   2. サイドバーで質問を入力 → 「質問する」
 *   3. 30秒後に トップ営業マンのノウハウに基づいた回答が返る
 *   4. 質問履歴が自動記録される
 *
 * 事前準備:
 *   スクリプトプロパティに GEMINI_API_KEY を設定
 */

const NOUHAU_SHEET = 'ノウハウマスタ';
const TYPE_SHEET   = '顧客タイプマスタ';
const HISTORY_SHEET = '質問履歴';
const MODEL = 'gemini-2.5-flash';

// AIのトーン設定(W1「5_トーン設計」から転記)
const TONE = `
● 先輩っぽく親しみやすい、少し軽口も交える
● 1回の回答は 200〜300字程度、長すぎない
● 回答の構造: ① 結論 → ② 理由 → ③ 具体的セリフ例 → ④ 応用のコツ
● 決めゼリフは「トップ営業ならこう言う: 〇〇」の形で必ず入れる
● 冒頭に「わかる、それ悩むよね」等の共感を1文入れる
● 避ける表現: 「絶対」「必ず」「100%」等の断定 / 個別商品名の推奨 / 他社批判
`.trim();

// ═══════════════════════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('営業ノウハウAI')
    .addItem('▶ ボットを開く', 'showSidebar')
    .addSeparator()
    .addItem('質問履歴シートを初期化', 'initHistorySheet')
    .addItem('セットアップ確認 (ログ)', 'testSetup')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('営業ノウハウAI')
    .setWidth(400);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ═══════════════════════════════════════════════════════════
// メイン: 質問を受けて回答を返す
// ═══════════════════════════════════════════════════════════
function askQuestion(input) {
  // input = { user, question, customerType }
  try {
    const nouhau = readNouhauMaster_();
    const types = readTypeMaster_();

    if (nouhau.length === 0) {
      return { ok: false, error: 'ノウハウマスタが空です。まずノウハウを追加してください。' };
    }

    const prompt = buildPrompt_(input, nouhau, types);
    const result = callGemini_(prompt);
    saveHistory_(input, result);

    return { ok: true, result: result };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// ノウハウマスタを読み込む(有効行のみ)
// ═══════════════════════════════════════════════════════════
function readNouhauMaster_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(NOUHAU_SHEET);
  if (!sh) throw new Error(`シート「${NOUHAU_SHEET}」が見つかりません`);

  const data = sh.getDataRange().getValues();
  const rows = [];
  for (const r of data) {
    if (!String(r[0]).startsWith('NW-')) continue;
    if (String(r[7]).trim() === '無効') continue;
    rows.push({
      id: r[0],
      category: r[1],
      situation: r[2],
      knowhow: r[3],
      script: r[4],
      customerType: r[5],
      source: r[6],
    });
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════
// 顧客タイプマスタを読み込む
// ═══════════════════════════════════════════════════════════
function readTypeMaster_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(TYPE_SHEET);
  if (!sh) return [];
  const data = sh.getDataRange().getValues();
  const rows = [];
  for (const r of data) {
    if (!r[0] || String(r[0]).startsWith('■') || String(r[0]) === 'タイプ') continue;
    rows.push({
      type: r[0],
      feature: r[1],
      avoid: r[2],
      effective: r[3],
    });
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════
// プロンプト構築
// ═══════════════════════════════════════════════════════════
function buildPrompt_(input, nouhau, types) {
  const nouhauText = nouhau.map(n =>
    `[${n.id}] ${n.category} / シチュエーション:${n.situation} / ノウハウ:${n.knowhow} / セリフ例:${n.script} / 対象:${n.customerType}`
  ).join('\n');

  const typeText = types.map(t =>
    `● ${t.type}: ${t.feature} | 避ける:${t.avoid} | 効果的:${t.effective}`
  ).join('\n');

  return `あなたは "トップ営業マンの知恵をまとめた AI アシスタント" です。
若手営業からの質問に対して、以下の 社内ノウハウ集を根拠に回答してください。

【トーン(必ず守る)】
${TONE}

【顧客タイプ別 対応の勘所】
${typeText}

【社内ノウハウ集(この中から関連するものを選んで回答の根拠にする)】
${nouhauText}

【若手からの質問】
利用者: ${input.user || '匿名'}
想定顧客タイプ: ${input.customerType || '(指定なし)'}
質問: ${input.question}

【出力形式】以下の JSON:
- answer: 質問への回答(トーンに沿った本文、200〜300字目安)
- referenced_ids: 回答の根拠にしたノウハウID の配列(例: ["NW-001", "NW-008"])
- script_example: 決めゼリフ例(実際に使える具体的なセリフ)
- next_tip: 応用のコツ(1〜2文)

【重要】
- ノウハウ集にない内容は "推測で追加しない"、代わりに「該当ノウハウが少ないので今度先輩に確認を」と返す
- 個別商品名の推奨・他社批判はしない
- 若手のメンタルケアを意識(冒頭で共感、押しつけない)`;
}

// ═══════════════════════════════════════════════════════════
// Gemini 呼び出し
// ═══════════════════════════════════════════════════════════
function callGemini_(prompt) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('スクリプトプロパティ GEMINI_API_KEY が未設定です');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.4,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          answer:         { type: 'string' },
          referenced_ids: { type: 'array', items: { type: 'string' } },
          script_example: { type: 'string' },
          next_tip:       { type: 'string' },
        },
        required: ['answer', 'referenced_ids', 'script_example', 'next_tip'],
      },
    },
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) throw new Error(`Gemini API エラー (${code}): ${body.substring(0, 400)}`);

  const json = JSON.parse(body);
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini 応答が空です');
  return JSON.parse(text);
}

// ═══════════════════════════════════════════════════════════
// 質問履歴に保存
// ═══════════════════════════════════════════════════════════
function saveHistory_(input, result) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(HISTORY_SHEET);
  if (!sh) sh = initHistorySheet();

  sh.appendRow([
    new Date(),
    input.user || '匿名',
    input.question,
    input.customerType || '',
    result.answer.substring(0, 500),
    result.referenced_ids.join(', '),
  ]);
}

function initHistorySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(HISTORY_SHEET);
  if (!sh) sh = ss.insertSheet(HISTORY_SHEET);
  else sh.clear();
  const headers = ['日時', '利用者', '質問', '顧客タイプ', 'AI回答(要約)', '参照ノウハウID'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setBackground('#0E7C86').setFontColor('#FFFFFF').setFontWeight('bold');
  sh.setFrozenRows(1);
  return sh;
}

// ═══════════════════════════════════════════════════════════
// 診断
// ═══════════════════════════════════════════════════════════
function testSetup() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  Logger.log('GEMINI_API_KEY: ' + (key ? key.substring(0, 8) + '...(OK)' : '❌ 未設定'));
  try {
    const n = readNouhauMaster_();
    Logger.log('ノウハウ有効件数: ' + n.length);
    const t = readTypeMaster_();
    Logger.log('顧客タイプ件数: ' + t.length);
  } catch (e) {
    Logger.log('エラー: ' + e.message);
  }
}
