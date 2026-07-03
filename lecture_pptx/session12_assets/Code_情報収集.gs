/**
 * 第12回 ワーク01 演習2 — お金の有益情報 自動収集GAS
 *
 * 【何をするコード?】
 *   ・「情報源マスター」シートのホワイトリストを AI に渡し、
 *   ・Gemini 2.5 Flash + Google Search Grounding で最新の公的情報を検索、
 *   ・「配信予約」シートに 日付/タイトル/本文/出典URL/カテゴリ/OK-NG(空) で追記する。
 *
 * 【なぜこの設計?】(生徒に必ず問いかける)
 *   Q1. なぜホワイトリストを AI に渡すの?
 *       → AI が個人ブログやアフィ広告サイトを引かないようにするため。
 *          "危ない情報" を混ぜないための"枠"。
 *   Q2. なぜ Google Search Grounding を使うの?
 *       → AI が「知ってるつもり」で古い情報や作り話を返すのを防ぐため。
 *          Google検索でリアルタイムに引いた結果+出典URLで裏付けが取れる。
 *   Q3. なぜ OK/NG 列を空欄で保存するの?
 *       → AI 生成をそのまま配信しない。次の演習で"人が最終判断"する。
 *          これが誤情報を止める最後の砦。
 *
 * 【セットアップ】
 *   1. スプシに紐付けた GAS プロジェクトにこのコードを貼る
 *   2. スクリプトプロパティに GEMINI_API_KEY を設定
 *      (Google AI Studio で発行: https://aistudio.google.com/apikey)
 *   3. エディタで collectOne() を実行(初回は権限承認)
 *   4. ログとスプシ「配信予約」を確認
 *
 * 【モデル】 gemini-2.5-flash (2026/07 GA、Google Search Grounding 対応)
 */

const SHEET_DESIGN   = '情報設計';
const SHEET_SOURCES  = '情報源マスター';
const SHEET_QUEUE    = '配信予約';
const MODEL_ID       = 'gemini-2.5-flash';
const API_BASE       = 'https://generativelanguage.googleapis.com/v1beta';

// カテゴリを順番に回して偏りを防ぐ
const CATEGORIES = ['助成金・補助金', '税金・節税', '株・為替', 'お金の豆知識'];

// ────────────────────────────────────────────────
// メインエントリ: 1本収集して「配信予約」に追記
// エディタから実行 or 定時トリガーから実行
// ────────────────────────────────────────────────
function collectOne() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const whitelist = loadWhitelist_(ss);
  if (whitelist.length === 0) {
    Logger.log('[collectOne] 情報源マスターが空です。まずシートを作成してください。');
    return;
  }
  // 今日日付でランダムにカテゴリを選ぶ(偏り防止のため後で改善余地あり)
  const idx = new Date().getDate() % CATEGORIES.length;
  const category = CATEGORIES[idx];
  Logger.log('[collectOne] 選択カテゴリ: ' + category);

  const item = askGeminiWithSearch_(category, whitelist);
  if (!item) {
    Logger.log('[collectOne] 収集失敗');
    return;
  }

  // ホワイトリストのドメインに含まれるかを検証
  if (!isDomainAllowed_(item.sourceUrl, whitelist)) {
    Logger.log('[collectOne] 出典URLがホワイトリスト外: ' + item.sourceUrl + ' → スキップ');
    return;
  }

  appendToQueue_(ss, item);
  Logger.log('[collectOne] 追記完了: ' + item.title);
}

// ────────────────────────────────────────────────
// 情報源マスターからホワイトリスト読み込み
// ────────────────────────────────────────────────
function loadWhitelist_(ss) {
  const sh = ss.getSheetByName(SHEET_SOURCES);
  if (!sh) return [];
  const values = sh.getDataRange().getValues();
  if (values.length < 2) return [];
  const header = values[0];
  const nameI = header.indexOf('機関名');
  const domI  = header.indexOf('ドメイン');
  const catI  = header.indexOf('主なカテゴリ');
  return values.slice(1)
    .filter(r => r[nameI] && r[domI])
    .map(r => ({ name: r[nameI], domain: r[domI], cat: r[catI] || '' }));
}

// ────────────────────────────────────────────────
// Gemini API 呼び出し (Google Search Grounding を有効化)
// ────────────────────────────────────────────────
function askGeminiWithSearch_(category, whitelist) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) {
    Logger.log('[askGemini] GEMINI_API_KEY が未設定');
    return null;
  }

  const wlText = whitelist
    .map(w => `- ${w.name} (${w.domain}) 主カテゴリ:${w.cat}`)
    .join('\n');

  const systemPrompt =
    'あなたは、お金の知識に自信がない30〜50代向けに公的機関の一次情報を分かりやすく伝える編集者です。\n' +
    '以下のルールを厳守してください。\n' +
    '1. 出典は必ず以下のホワイトリストのドメイン内から選ぶ(それ以外は絶対NG):\n' +
    wlText + '\n' +
    '2. 個別助言(税務相談・投資助言)は行わず、一般情報のみを扱う。\n' +
    '3. タイトル: 20文字以内、末尾に絵文字1つまで。\n' +
    '4. 本文: 300文字以内、3〜5行で改行、平易な表現。\n' +
    '5. 出典URL: 実在するホワイトリスト内ドメインのURLを1つ必ず含める。\n' +
    '6. 不確かな数字・固有名詞は使わない。分からなければ "詳細は公式サイトで確認を" と締める。\n' +
    '7. 出力は JSON のみ: {"title": "...", "body": "...", "sourceUrl": "...", "category": "..."}';

  const userPrompt =
    `カテゴリ「${category}」の分野で、今週配信するに値するお金の有益情報を1本作成してください。\n` +
    `必要ならGoogle検索でホワイトリスト内の最新情報を調べてください。\n` +
    `カテゴリ値は「${category}」をそのまま使ってください。`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    // ★★ Google Search Grounding を有効化 ★★
    tools: [{ google_search: {} }],
    generationConfig: {
      temperature: 0.2,
      // Grounding 使用時は responseMimeType/Schema は使えないので、
      // プロンプト側で JSON を厳しく指示する
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
  Logger.log('[askGemini] HTTP ' + res.getResponseCode());
  if (res.getResponseCode() !== 200) {
    Logger.log('[askGemini] エラー: ' + res.getContentText());
    return null;
  }

  const data = JSON.parse(res.getContentText());
  const text = data && data.candidates && data.candidates[0] &&
               data.candidates[0].content && data.candidates[0].content.parts &&
               data.candidates[0].content.parts.map(p => p.text || '').join('') || '';
  Logger.log('[askGemini] 生テキスト長: ' + text.length);

  // JSON 抽出(コードブロックが混ざる場合の保険)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    Logger.log('[askGemini] JSON が見つかりません: ' + text.slice(0, 200));
    return null;
  }
  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (!parsed.title || !parsed.body || !parsed.sourceUrl) {
      Logger.log('[askGemini] 必須フィールド不足: ' + JSON.stringify(parsed));
      return null;
    }
    return {
      title:     String(parsed.title).slice(0, 30),
      body:      String(parsed.body).slice(0, 400),
      sourceUrl: String(parsed.sourceUrl),
      category:  String(parsed.category || category),
    };
  } catch (e) {
    Logger.log('[askGemini] JSON parse エラー: ' + e.message);
    return null;
  }
}

// ────────────────────────────────────────────────
// ドメイン検証 (ホワイトリスト内か)
// ────────────────────────────────────────────────
function isDomainAllowed_(url, whitelist) {
  if (!url) return false;
  try {
    // 簡易ホスト抽出: https://host/... のhost部を切り出す
    const m = url.match(/^https?:\/\/([^\/\s]+)/);
    if (!m) return false;
    const host = m[1].toLowerCase();
    return whitelist.some(w => host === w.domain || host.endsWith('.' + w.domain));
  } catch (e) {
    return false;
  }
}

// ────────────────────────────────────────────────
// 配信予約シートに追記
// ────────────────────────────────────────────────
function appendToQueue_(ss, item) {
  const sh = ss.getSheetByName(SHEET_QUEUE);
  if (!sh) {
    Logger.log('[appendToQueue] 配信予約シートが存在しません');
    return;
  }
  const now = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
  sh.appendRow([
    now,             // A: 生成日時
    item.title,      // B: タイトル
    item.body,       // C: 本文
    item.sourceUrl,  // D: 出典URL
    item.category,   // E: カテゴリ
    '',              // F: OK/NG (人が判定)
    '',              // G: 配信済み日時 (配信GASが記入)
  ]);
}

// ────────────────────────────────────────────────
// 動作確認用: 全カテゴリ1本ずつ
// ────────────────────────────────────────────────
function collectAllCategories() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const whitelist = loadWhitelist_(ss);
  CATEGORIES.forEach(cat => {
    const item = askGeminiWithSearch_(cat, whitelist);
    if (item && isDomainAllowed_(item.sourceUrl, whitelist)) {
      appendToQueue_(ss, item);
      Logger.log('[collectAll] OK: ' + cat + ' / ' + item.title);
    } else {
      Logger.log('[collectAll] スキップ: ' + cat);
    }
    Utilities.sleep(1500); // API レート制限対策
  });
}

// ────────────────────────────────────────────────
// モデル検証 (Search Grounding が使えるかも確認)
// ────────────────────────────────────────────────
function verifyModel() {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) { Logger.log('❌ GEMINI_API_KEY 未設定'); return; }
  const url = API_BASE + '/models?key=' + encodeURIComponent(apiKey);
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) {
    Logger.log('HTTP ' + res.getResponseCode() + ' : ' + res.getContentText());
    return;
  }
  const models = JSON.parse(res.getContentText()).models || [];
  const usable = models.filter(m =>
    (m.supportedGenerationMethods || []).indexOf('generateContent') !== -1
  ).map(m => m.name.replace(/^models\//, ''));
  const ok = usable.indexOf(MODEL_ID) !== -1;
  Logger.log((ok ? '✅ ' : '❌ ') + MODEL_ID + ' は' + (ok ? '利用可能' : '利用不可'));
  Logger.log('先頭10件: ' + usable.slice(0, 10).join(' / '));
}
