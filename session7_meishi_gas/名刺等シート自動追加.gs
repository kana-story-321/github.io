/**
 * 第7回 演習：Drive 監視 → 名刺等シート 自動追加 GAS
 *
 * 指定された Google Drive フォルダに名刺画像／テキストファイルが
 * 追加されると、Gemini API で内容を抽出し、「名刺等」シートに
 * 1 行追加します。同じお客様は重複登録しません。
 *
 * 【セットアップ】
 *   1. スクリプトプロパティに以下を設定
 *      - GEMINI_API_KEY   : Google AI Studio で発行した API キー
 *      - DRIVE_FOLDER_ID  : 監視するドライブフォルダの ID（任意、未設定なら下の定数を使用）
 *   2. メニュー「名刺取り込み」→「自動実行トリガーを設定（5分ごと）」をクリック
 *
 * 【動作確認用モデル】 gemini-3.5-flash（2026/06 時点で GA・安定版）
 */

// 既定の監視フォルダ ID（スクリプトプロパティ未設定時のフォールバック）
const DEFAULT_DRIVE_FOLDER_ID = '1tS5v5PYLRSrO7Uq4q8miLldpmLqYCFKz';

const PROCESSED_SUBFOLDER_NAME = '処理済み';
const ERROR_SUBFOLDER_NAME = 'エラー';
const TARGET_SHEET = '名刺等';
const MODEL_ID = 'gemini-3.5-flash';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * 「名刺等」シートの列見出しと一致させた抽出項目
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
    .addItem('今すぐドライブを確認', 'processDriveFolder')
    .addSeparator()
    .addItem('自動実行トリガーを設定（5分ごと）', 'installTrigger')
    .addItem('自動実行トリガーを解除', 'uninstallTrigger')
    .addSeparator()
    .addItem('利用可能なモデルを確認', 'verifyModel')
    .addToUi();
}

// ───────────────────────────────────────────────
// トリガー設定／解除
// ───────────────────────────────────────────────
function installTrigger() {
  uninstallTrigger_silent_();
  ScriptApp.newTrigger('processDriveFolder')
    .timeBased()
    .everyMinutes(5)
    .create();
  safeAlert_('5 分ごとの自動実行トリガーを設定しました。\n\n' +
             '※ ファイルが追加されると、最大 5 分以内に「名刺等」シートに反映されます。');
}

function uninstallTrigger() {
  const removed = uninstallTrigger_silent_();
  safeAlert_('自動実行トリガーを解除しました（削除 ' + removed + ' 件）。');
}

function uninstallTrigger_silent_() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = 0;
  triggers.forEach(function (t) {
    if (t.getHandlerFunction() === 'processDriveFolder') {
      ScriptApp.deleteTrigger(t);
      removed++;
    }
  });
  return removed;
}

// ───────────────────────────────────────────────
// モデル検証
// ───────────────────────────────────────────────
function verifyModel() {
  const apiKey = getApiKey_();
  if (!apiKey) return;

  const url = API_BASE + '/models?key=' + encodeURIComponent(apiKey);
  const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  const code = res.getResponseCode();

  if (code !== 200) {
    safeAlert_('モデル一覧の取得に失敗しました。\nHTTP ' + code + '\n\n' + res.getContentText());
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

  safeAlert_(
    head + '\n\n利用可能モデル数：' + usableModels.length +
    '\n\n--- 先頭20件 ---\n' + usableModels.slice(0, 20).join('\n')
  );
}

// ───────────────────────────────────────────────
// メイン：ドライブフォルダを巡回してファイル処理
// ───────────────────────────────────────────────
/**
 * 監視フォルダ内の新規ファイルを処理し、
 * 抽出結果を「名刺等」シートに追加する（重複は登録しない）。
 *
 * 処理後のファイルは「処理済み」サブフォルダに、
 * 失敗したファイルは「エラー」サブフォルダに移動します。
 */
function processDriveFolder() {
  const folder = DriveApp.getFolderById(getFolderId_());
  const processedFolder = getOrCreateSubfolder_(folder, PROCESSED_SUBFOLDER_NAME);
  const errorFolder = getOrCreateSubfolder_(folder, ERROR_SUBFOLDER_NAME);

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const targetSheet = ss.getSheetByName(TARGET_SHEET);
  if (!targetSheet) {
    safeAlert_('「' + TARGET_SHEET + '」シートが見つかりません。');
    return;
  }

  // 既存シートから重複チェック用インデックスを作成
  const dupIndex = buildDuplicateIndex_(targetSheet);

  const files = folder.getFiles();
  let added = 0, dup = 0, err = 0, skipped = 0;
  const errorLog = [];

  while (files.hasNext()) {
    const file = files.next();
    const name = file.getName();
    const mime = file.getMimeType();

    if (!isProcessableMime_(mime)) {
      skipped++;
      continue;
    }

    try {
      const extracted = extractFromFile_(file);
      if (!extracted) {
        errorLog.push(name + ' : 抽出失敗（空応答）');
        file.moveTo(errorFolder);
        err++;
        continue;
      }

      if (isDuplicateExtracted_(dupIndex, extracted)) {
        Logger.log('重複スキップ: ' + (extracted['氏名（フルネーム）'] || name));
        file.moveTo(processedFolder);
        dup++;
        continue;
      }

      const row = FIELDS.map(function (f) {
        if (f === 'タイムスタンプ') return new Date();
        const v = extracted[f];
        return (v === undefined || v === null || v === '') ? '記載なし' : String(v);
      });
      targetSheet.appendRow(row);

      // 同一バッチ内での重複も防ぐためインデックス更新
      addToDuplicateIndex_(dupIndex, extracted);

      file.moveTo(processedFolder);
      added++;
    } catch (e) {
      errorLog.push(name + ' : ' + e.message);
      try { file.moveTo(errorFolder); } catch (_) {}
      err++;
    }
  }

  const summary =
    '【取り込み結果】\n' +
    '追加: ' + added + ' 件\n' +
    '重複スキップ: ' + dup + ' 件\n' +
    '対象外スキップ: ' + skipped + ' 件\n' +
    'エラー: ' + err + ' 件' +
    (errorLog.length ? '\n\n--- エラー詳細 ---\n' + errorLog.join('\n') : '');
  Logger.log(summary);
  safeAlert_(summary);
}

// ───────────────────────────────────────────────
// 重複チェック
// ───────────────────────────────────────────────
/**
 * 既存シートから「氏名 / メール / 電話」のインデックスを作る
 */
function buildDuplicateIndex_(sheet) {
  const idx = { names: {}, emails: {}, phones: {} };
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return idx;

  const headers = data[0];
  const nameIdx  = headers.indexOf('氏名（フルネーム）');
  const emailIdx = headers.indexOf('連絡先：メールアドレス');
  const phoneIdx = headers.indexOf('連絡先：電話番号（ハイフンなし）');

  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const n = normalizeName_(row[nameIdx]);
    const e = normalizeEmail_(row[emailIdx]);
    const p = normalizePhone_(row[phoneIdx]);
    if (n) idx.names[n] = true;
    if (e) idx.emails[e] = true;
    if (p) idx.phones[p] = true;
  }
  return idx;
}

function addToDuplicateIndex_(idx, extracted) {
  const n = normalizeName_(extracted['氏名（フルネーム）']);
  const e = normalizeEmail_(extracted['連絡先：メールアドレス']);
  const p = normalizePhone_(extracted['連絡先：電話番号（ハイフンなし）']);
  if (n) idx.names[n] = true;
  if (e) idx.emails[e] = true;
  if (p) idx.phones[p] = true;
}

/**
 * 重複判定ルール（いずれかに該当 → 重複）:
 *   1. メールアドレス完全一致
 *   2. 電話番号完全一致
 *   3. 氏名一致 かつ メール・電話が両方とも未記載
 */
function isDuplicateExtracted_(idx, extracted) {
  const n = normalizeName_(extracted['氏名（フルネーム）']);
  const e = normalizeEmail_(extracted['連絡先：メールアドレス']);
  const p = normalizePhone_(extracted['連絡先：電話番号（ハイフンなし）']);

  if (e && idx.emails[e]) return true;
  if (p && idx.phones[p]) return true;
  if (n && !e && !p && idx.names[n]) return true;
  return false;
}

function normalizeName_(s) {
  if (!s) return '';
  const t = String(s).replace(/\s+/g, '').trim();
  return (t && t !== '記載なし' && t !== '不明') ? t : '';
}
function normalizeEmail_(s) {
  if (!s) return '';
  const t = String(s).trim().toLowerCase();
  return (t && t !== '記載なし' && t !== '不明' && t.indexOf('@') !== -1) ? t : '';
}
function normalizePhone_(s) {
  if (!s) return '';
  const t = String(s).replace(/\D/g, '');
  return t.length >= 9 ? t : '';
}

// ───────────────────────────────────────────────
// Gemini API 呼び出し（テキスト／画像／PDF 対応）
// ───────────────────────────────────────────────
function extractFromFile_(file) {
  const mime = file.getMimeType();
  const parts = [{ text: buildPrompt_() }];

  if (mime.indexOf('image/') === 0 || mime === 'application/pdf') {
    // 画像・PDF はインラインで送る
    const blob = file.getBlob();
    parts.push({
      inline_data: {
        mime_type: mime,
        data: Utilities.base64Encode(blob.getBytes())
      }
    });
  } else if (mime === 'text/plain' || mime === 'text/csv') {
    // テキストは文字列として埋め込む
    const text = file.getBlob().getDataAsString('UTF-8');
    parts.push({ text: '\n\n【入力テキスト】\n' + text });
  } else {
    Logger.log('Unsupported mime type, skipped: ' + mime);
    return null;
  }

  return callGemini_(parts);
}

function buildPrompt_() {
  const fieldList = FIELDS
    .filter(function (f) { return f !== 'タイムスタンプ'; })
    .map(function (f) { return '  - ' + f; })
    .join('\n');

  return [
    '添付された名刺・メモ・メール等の情報から、顧客情報を抽出してください。',
    'これを下記の項目に分解して、純粋な JSON 形式で返してください。',
    '',
    '【抽出する項目（このキー名をそのまま使うこと）】',
    fieldList,
    '',
    '【ルール】',
    '- 記載がない項目は "記載なし" としてください',
    '- 電話番号はハイフンなしの数字のみで返してください',
    '- メールアドレスは小文字に揃えてください',
    '- 年代は「30代」「40代」など。不明なら "不明"',
    '- JSON のみを返してください（コードブロックや説明は不要）'
  ].join('\n');
}

function callGemini_(parts) {
  const apiKey = getApiKey_();
  if (!apiKey) return null;

  const url = API_BASE + '/models/' + MODEL_ID + ':generateContent?key=' + encodeURIComponent(apiKey);
  const payload = {
    contents: [{ role: 'user', parts: parts }],
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2
    }
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const code = res.getResponseCode();
  if (code !== 200) {
    Logger.log('Gemini API error: HTTP ' + code + '\n' + res.getContentText());
    return null;
  }

  const data = JSON.parse(res.getContentText());
  const text =
    data && data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;

  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (e) {
    Logger.log('JSON parse failed: ' + e.message + '\nresponse: ' + text);
    return null;
  }
}

// ───────────────────────────────────────────────
// 共通ユーティリティ
// ───────────────────────────────────────────────
function getApiKey_() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) {
    safeAlert_(
      'スクリプトプロパティに「GEMINI_API_KEY」を設定してください。\n\n' +
      'Apps Script エディタ → ⚙ プロジェクトの設定 → スクリプト プロパティ → プロパティを追加'
    );
    return null;
  }
  return key;
}

function getFolderId_() {
  const id = PropertiesService.getScriptProperties().getProperty('DRIVE_FOLDER_ID');
  return id || DEFAULT_DRIVE_FOLDER_ID;
}

function getOrCreateSubfolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  return it.hasNext() ? it.next() : parent.createFolder(name);
}

function isProcessableMime_(mime) {
  if (!mime) return false;
  if (mime.indexOf('image/') === 0) return true;
  if (mime === 'application/pdf') return true;
  if (mime === 'text/plain') return true;
  if (mime === 'text/csv') return true;
  return false;
}

/**
 * UI が使える時はアラート、使えない（時間トリガー等）時はログのみ
 */
function safeAlert_(msg) {
  try {
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) {
    Logger.log(msg);
  }
}
