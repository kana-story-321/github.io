/**
 * 第11回 演習1 — FAQ チャットボット (GAS Web アプリ)
 *
 * 【構成】
 *   ・FAQ シート(質問/回答/カテゴリ)を知識として Gemini に渡す
 *   ・doGet で HTML UI を返し、fetch("?q=...") でチャット応答
 *   ・答えられない質問は「担当者に繋ぐ」案内を返す
 *
 * 【セットアップ】
 *   1. このコードを FAQ スプレッドシートに紐付いた GAS プロジェクトに貼る
 *      (スプレッドシートを開いて 拡張機能 → Apps Script)
 *   2. Index.html を新規追加し、末尾のテンプレートをそのまま貼る
 *   3. プロジェクト設定 → スクリプト プロパティ に以下を追加
 *        GEMINI_API_KEY  = Google AI Studio で発行した API キー
 *   4. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *        ・実行するユーザー: 自分
 *        ・アクセスできるユーザー: 全員
 *      → デプロイ後の URL をリッチメニューのボタンに設定
 *
 * 【動作確認モデル】 gemini-2.5-flash (2026/07 時点で GA・安定版)
 *   利用可否は verifyModel() をエディタから実行して確認可能
 */

const FAQ_SHEET_NAME = 'FAQ';
const MODEL_ID       = 'gemini-2.5-flash';
const API_BASE       = 'https://generativelanguage.googleapis.com/v1beta';

// ────────────────────────────────────────────────
// Web アプリ入口
// ────────────────────────────────────────────────
function doGet(e) {
  // JSON API モード: ?q=... で応答テキストを返す
  if (e && e.parameter && e.parameter.q) {
    const answer = answerQuestion(String(e.parameter.q));
    return ContentService
      .createTextOutput(JSON.stringify(answer))
      .setMimeType(ContentService.MimeType.JSON);
  }
  // HTML モード: Index.html を返す
  const tpl = HtmlService.createTemplateFromFile('Index');
  return tpl.evaluate()
    .setTitle('保険FAQ チャット')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ────────────────────────────────────────────────
// メイン: 質問→回答
// ────────────────────────────────────────────────
function answerQuestion(question) {
  const faqs = loadFAQ_();
  if (faqs.length === 0) {
    return { text: 'FAQ が読み込めませんでした。担当者にご連絡ください。', handoff: true };
  }

  // まず FAQ から完全に一致しそうなものを Gemini に選ばせる
  const result = askGemini_(question, faqs);
  return result;
}

// ────────────────────────────────────────────────
// スプレッドシートから FAQ を読み込む
// ────────────────────────────────────────────────
function loadFAQ_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(FAQ_SHEET_NAME);
  if (!sh) return [];
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const [header, ...rows] = values;
  const qi = header.indexOf('質問');
  const ai = header.indexOf('回答');
  const ci = header.indexOf('カテゴリ');
  return rows
    .filter(r => r[qi] && r[ai])
    .map(r => ({ q: String(r[qi]), a: String(r[ai]), c: String(r[ci] || '') }));
}

// ────────────────────────────────────────────────
// Gemini API を呼ぶ
// ────────────────────────────────────────────────
function askGemini_(question, faqs) {
  const apiKey = getApiKey_();
  if (!apiKey) {
    return { text: 'API キーが未設定です。担当者にご連絡ください。', handoff: true };
  }

  const knowledge = faqs
    .map((f, i) => `【FAQ${i + 1}】(${f.c})\n  Q: ${f.q}\n  A: ${f.a}`)
    .join('\n\n');

  const systemPrompt =
    'あなたは保険営業事務所の「一次受け AI」です。以下のルールを厳守してください。\n' +
    ' 1. 下の【FAQ 知識】に一致・類似する内容なら、その回答を要約(200文字以内)して丁寧語で返す。\n' +
    ' 2. FAQ に情報がない、または個人契約の内容に関する質問には\n' +
    '    「担当者からご連絡いたします。少々お待ちください。」と返し、末尾に [HANDOFF] を付ける。\n' +
    ' 3. 医療診断・法律相談・不適切な話題には応じず、上と同じ[HANDOFF]応答にする。\n' +
    ' 4. 出力は JSON で {"text": "回答", "handoff": true/false} の形式のみ。前置きや解説は不要。';

  const userPrompt =
    `【FAQ 知識】\n${knowledge}\n\n【ユーザーの質問】\n${question}`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'OBJECT',
        properties: {
          text:    { type: 'STRING' },
          handoff: { type: 'BOOLEAN' },
        },
        required: ['text', 'handoff'],
      },
      temperature: 0.3,
    },
  };

  const url = API_BASE + '/models/' + MODEL_ID +
              ':generateContent?key=' + encodeURIComponent(apiKey);
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  if (res.getResponseCode() !== 200) {
    Logger.log('Gemini error: ' + res.getContentText());
    return { text: '応答生成に失敗しました。担当者からご連絡いたします。', handoff: true };
  }

  const data = JSON.parse(res.getContentText());
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  try {
    const parsed = JSON.parse(text);
    return {
      text:    String(parsed.text || '').slice(0, 400),
      handoff: !!parsed.handoff,
    };
  } catch (e) {
    return { text: text || '担当者からご連絡いたします。', handoff: true };
  }
}

// ────────────────────────────────────────────────
// モデル検証(エディタから実行)
// ────────────────────────────────────────────────
function verifyModel() {
  const apiKey = getApiKey_();
  if (!apiKey) throw new Error('スクリプトプロパティに GEMINI_API_KEY を設定してください');
  const url = API_BASE + '/models?key=' + encodeURIComponent(apiKey);
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    Logger.log('HTTP ' + res.getResponseCode() + ' : ' + res.getContentText());
    return;
  }
  const models = JSON.parse(res.getContentText()).models || [];
  const usable = models
    .filter(m => (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1)
    .map(m => m.name.replace(/^models\//, ''));
  const ok = usable.indexOf(MODEL_ID) !== -1;
  Logger.log((ok ? '✅ ' : '❌ ') + MODEL_ID + ' は' + (ok ? '利用可能' : '利用不可'));
  Logger.log('先頭10件: ' + usable.slice(0, 10).join(' / '));
}

function getApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
}
