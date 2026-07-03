/**
 * 第11回 演習1 — FAQ チャットボット (GAS Web アプリ)  ★修正版
 *
 * 【構成】
 *   ・FAQ シート(質問/回答/カテゴリ)を知識として Gemini に渡す
 *   ・doGet で HTML UI を返す
 *   ・HTML からは google.script.run で answerQuestion() を直接呼ぶ
 *
 * 【変更履歴 (前版からの修正点)】
 *   ・HTML からのアクセスに fetch を使うと GAS iframe サンドボックスの
 *     制約でリクエストが届かない不具合を、google.script.run 呼び出しに変更
 *   ・pingServer() を追加、動作確認を GAS 側で完結できるように
 *
 * 【セットアップ】
 *   1. このコードを FAQ スプレッドシートに紐付いた GAS プロジェクトに貼る
 *   2. Index.html を新規追加し、同梱ファイルの内容をそのまま貼る
 *   3. プロジェクト設定 → スクリプト プロパティ に
 *        GEMINI_API_KEY = Google AI Studio で発行した API キー
 *      を追加
 *   4. 【重要】デプロイし直す (コードを変えたら必ず「新しいバージョン」で再デプロイ)
 *      デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *        ・実行するユーザー: 自分
 *        ・アクセスできるユーザー: 全員
 *      → 新しい URL をリッチメニューのボタンに設定し直す
 *
 * 【動作確認モデル】 gemini-2.5-flash
 *   利用可否は verifyModel() をエディタから実行して確認可能
 */

const FAQ_SHEET_NAME = 'FAQ';
const MODEL_ID       = 'gemini-2.5-flash';
const API_BASE       = 'https://generativelanguage.googleapis.com/v1beta';

// ────────────────────────────────────────────────
// Web アプリ入口: HTML を返すだけ
// ────────────────────────────────────────────────
function doGet(e) {
  const tpl = HtmlService.createTemplateFromFile('Index');
  return tpl.evaluate()
    .setTitle('保険FAQ チャット')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ────────────────────────────────────────────────
// クライアント(HTML)から google.script.run で呼ばれる関数
// アンダースコアで終わらないので外部から呼び出し可能
// ────────────────────────────────────────────────
function answerQuestion(question) {
  try {
    Logger.log('[answerQuestion] 受信: ' + question);
    if (!question || typeof question !== 'string') {
      return { text: '質問を入力してください。', handoff: false };
    }
    const faqs = loadFAQ_();
    Logger.log('[answerQuestion] FAQ件数: ' + faqs.length);
    if (faqs.length === 0) {
      return {
        text: 'FAQ シートが読み込めませんでした。シート名「FAQ」と列見出し「質問/回答/カテゴリ」を確認してください。',
        handoff: true
      };
    }
    return askGemini_(question, faqs);
  } catch (err) {
    Logger.log('[answerQuestion] エラー: ' + err.message + ' / ' + err.stack);
    return { text: '内部エラーが発生しました: ' + err.message, handoff: true };
  }
}

// ────────────────────────────────────────────────
// 動作確認用 (HTMLの右上「接続テスト」ボタンから呼ぶ)
// ────────────────────────────────────────────────
function pingServer() {
  const faqs = loadFAQ_();
  const apiKey = getApiKey_();
  return {
    ok: true,
    faqCount: faqs.length,
    hasApiKey: !!apiKey,
    sheetName: FAQ_SHEET_NAME,
    model: MODEL_ID,
    time: new Date().toString(),
  };
}

// ────────────────────────────────────────────────
// スプレッドシートから FAQ を読み込む
// ────────────────────────────────────────────────
function loadFAQ_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    Logger.log('[loadFAQ] ActiveSpreadsheet が null');
    return [];
  }
  const sh = ss.getSheetByName(FAQ_SHEET_NAME);
  if (!sh) {
    Logger.log('[loadFAQ] シート「' + FAQ_SHEET_NAME + '」が見つかりません');
    return [];
  }
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const [header, ...rows] = values;
  const qi = header.indexOf('質問');
  const ai = header.indexOf('回答');
  const ci = header.indexOf('カテゴリ');
  if (qi === -1 || ai === -1) {
    Logger.log('[loadFAQ] 列見出し「質問」「回答」が見つかりません: ' + JSON.stringify(header));
    return [];
  }
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
    return {
      text: 'GEMINI_API_KEY がスクリプトプロパティに設定されていません。担当者にご連絡ください。',
      handoff: true,
    };
  }

  const knowledge = faqs
    .map((f, i) => `【FAQ${i + 1}】(${f.c})\n  Q: ${f.q}\n  A: ${f.a}`)
    .join('\n\n');

  const systemPrompt =
    'あなたは保険営業事務所の「一次受け AI」です。以下のルールを厳守してください。\n' +
    ' 1. 下の【FAQ 知識】に一致・類似する内容なら、その回答を要約(200文字以内)して丁寧語で返す。\n' +
    ' 2. FAQ に情報がない、または個人契約の内容に関する質問には\n' +
    '    「担当者からご連絡いたします。少々お待ちください。」と返し、handoff=true にする。\n' +
    ' 3. 医療診断・法律相談・不適切な話題には応じず、上と同じ handoff=true 応答にする。\n' +
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

  const code = res.getResponseCode();
  Logger.log('[askGemini] HTTP ' + code);
  if (code !== 200) {
    Logger.log('[askGemini] エラー本文: ' + res.getContentText());
    return {
      text: 'Gemini API 呼び出しでエラーが発生しました(HTTP ' + code + ')。担当者からご連絡いたします。',
      handoff: true
    };
  }

  const data = JSON.parse(res.getContentText());
  const text = data && data.candidates && data.candidates[0] &&
               data.candidates[0].content && data.candidates[0].content.parts &&
               data.candidates[0].content.parts[0] &&
               data.candidates[0].content.parts[0].text || '';
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

// ────────────────────────────────────────────────
// 直接テスト用 (エディタから実行して動作確認)
// ────────────────────────────────────────────────
function testAnswer() {
  const r = answerQuestion('相談は無料ですか?');
  Logger.log(JSON.stringify(r, null, 2));
}

function getApiKey_() {
  return PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
}
