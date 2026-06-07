/**
 * 第7回 演習：名刺・メモ → 名刺等シート 自動追加 GAS
 *
 * 「入力」シートの A2 に貼り付けた自由記述テキストから、
 * Gemini API を使って必要な項目を抽出し、
 * 「名刺等」シートの一番下に 1 行追加します。
 *
 * 【セットアップ】
 *   1. スクリプトプロパティに「GEMINI_API_KEY」を設定する
 *      プロジェクト設定 → スクリプトプロパティ → プロパティを追加
 *   2. スプレッドシートをリロードして「名刺取り込み」メニューを表示
 *
 * 【動作確認用モデル】 gemini-3.5-flash（2026/06 時点で GA・安定版）
 *   利用可能かどうかは「利用可能なモデルを確認」メニューから検証できます。
 */

const INPUT_SHEET = '入力';
const TARGET_SHEET = '名刺等';
const MODEL_ID = 'gemini-3.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * 「名刺等」シートの列見出し（A〜K の 11 列）
 * 抽出する項目名 = JSON のキー名 = シートの列見出し に揃える
 */
const FIELDS = [
  'タイムスタンプ',
  '氏名（フルネーム）',
  '連絡先：メールアドレス',
  '連絡先：電話番号（ハイフンなし）',
  '年代',
  '現在の家族構成についてお聞かせください。（複数選択可）',
  '今回のお困りごとの種類',
  'お困りごとの具体的な内容を詳しくご記入ください。',
  '連絡希望時間帯 [平日 (月〜金)]',
  '連絡希望時間帯 [週末 (土・日)]',
  'その他、連絡に関する特記事項があればご記入ください。',
];

// ───────────────────────────────────────────────
// メニュー
// ───────────────────────────────────────────────
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('名刺取り込み')
    .addItem('テキストから1行追加', 'appendFromInput')
    .addSeparator()
    .addItem('利用可能なモデルを確認', 'verifyModel')
    .addToUi();
}

// ───────────────────────────────────────────────
// モデル検証
// ───────────────────────────────────────────────
/**
 * Gemini API の models エンドポイントを呼び、設定モデルが利用可能か検証する
 */
function verifyModel() {
  const apiKey = getApiKey_();
  if (!apiKey) return;

  const url = API_BASE + '/models?key=' + encodeURIComponent(apiKey);
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = res.getResponseCode();

  if (code !== 200) {
    SpreadsheetApp.getUi().alert(
      'モデル一覧の取得に失敗しました。\nHTTP ' + code + '\n\n' + res.getContentText()
    );
    return;
  }

  const data = JSON.parse(res.getContentText());
  const usableModels = (data.models || [])
    .filter(function (m) {
      return (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1;
    })
    .map(function (m) { return m.name.replace(/^models\//, ''); });

  const ok = usableModels.indexOf(MODEL_ID) !== -1;
  const head = ok
    ? '✅ 設定モデル「' + MODEL_ID + '」は利用可能です。'
    : '❌ 設定モデル「' + MODEL_ID + '」は利用できません。';
  const sample = usableModels.slice(0, 20).join('\n');

  SpreadsheetApp.getUi().alert(
    head +
    '\n\n利用可能モデル数：' + usableModels.length +
    '\n\n--- 先頭20件 ---\n' + sample
  );
}

// ───────────────────────────────────────────────
// メイン：入力テキスト → 抽出 → 名刺等シートに追加
// ───────────────────────────────────────────────
function appendFromInput() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const inputSheet = ss.getSheetByName(INPUT_SHEET);
  const targetSheet = ss.getSheetByName(TARGET_SHEET);

  if (!inputSheet || !targetSheet) {
    SpreadsheetApp.getUi().alert(
      '「' + INPUT_SHEET + '」または「' + TARGET_SHEET + '」シートが見つかりません。'
    );
    return;
  }

  const rawText = inputSheet.getRange('A2').getValue();
  if (!rawText || String(rawText).trim() === '') {
    SpreadsheetApp.getUi().alert('「入力」シートの A2 にテキストを貼り付けてください。');
    return;
  }

  const extracted = callGemini_(String(rawText));
  if (!extracted) return;

  // FIELDS の順番で行データを作成
  const row = FIELDS.map(function (field) {
    if (field === 'タイムスタンプ') {
      return ''; // 名刺等は手入力分のためタイムスタンプは空欄でOK
    }
    const v = extracted[field];
    return (v === undefined || v === null || v === '') ? '記載なし' : String(v);
  });

  targetSheet.appendRow(row);

  // 入力欄をクリア
  inputSheet.getRange('A2').clearContent();

  SpreadsheetApp.getUi().alert(
    '「' + TARGET_SHEET + '」シートに1行追加しました。\n\n' +
    '氏名：' + (extracted['氏名（フルネーム）'] || '不明')
  );
}

// ───────────────────────────────────────────────
// Gemini API 呼び出し
// ───────────────────────────────────────────────
/**
 * 自由記述テキストから FIELDS に対応する JSON を抽出する
 */
function callGemini_(rawText) {
  const apiKey = getApiKey_();
  if (!apiKey) return null;

  const fieldList = FIELDS
    .filter(function (f) { return f !== 'タイムスタンプ'; })
    .map(function (f) { return '  - ' + f; })
    .join('\n');

  const prompt =
    '以下は名刺・メモ・メール等から得た顧客情報の生テキストです。\n' +
    'これを下記の項目に分解して、純粋な JSON 形式で返してください。\n\n' +
    '【抽出する項目（このキー名をそのまま使うこと）】\n' +
    fieldList + '\n\n' +
    '【ルール】\n' +
    '- 記載がない項目は "記載なし" としてください\n' +
    '- 電話番号はハイフンなしの数字のみで返してください\n' +
    '- 年代は「30代」「40代」など。不明なら "不明"\n' +
    '- JSON のみを返してください（コードブロックや説明は不要）\n\n' +
    '【入力テキスト】\n' + rawText;

  const url = API_BASE + '/models/' + MODEL_ID + ':generateContent?key=' + encodeURIComponent(apiKey);
  const payload = {
    contents: [{
      role: 'user',
      parts: [{ text: prompt }],
    }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
    },
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  if (code !== 200) {
    SpreadsheetApp.getUi().alert(
      'Gemini API エラー：HTTP ' + code + '\n\n' + res.getContentText()
    );
    return null;
  }

  const data = JSON.parse(res.getContentText());
  const text =
    data && data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;

  if (!text) {
    SpreadsheetApp.getUi().alert('Gemini から空の応答が返りました。');
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (e) {
    SpreadsheetApp.getUi().alert(
      '応答の JSON 解析に失敗しました：' + e.message + '\n\n応答:\n' + text
    );
    return null;
  }
}

// ───────────────────────────────────────────────
// 共通：API キー取得
// ───────────────────────────────────────────────
function getApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) {
    SpreadsheetApp.getUi().alert(
      'スクリプトプロパティに「GEMINI_API_KEY」を設定してください。\n\n' +
      '設定方法：\n' +
      '  Apps Script エディタ → ⚙ プロジェクトの設定\n' +
      '  → スクリプト プロパティ → プロパティを追加\n' +
      '  プロパティ名: GEMINI_API_KEY\n' +
      '  値: Google AI Studio で取得した API キー'
    );
    return null;
  }
  return key;
}
