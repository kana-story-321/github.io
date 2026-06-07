/**
 * 第7回 演習1：商談ログ → 顧客マスター 自動転記
 *
 * 「商談ログ」シートの全行をスキャンし、お客様名ごとに
 * 「顧客マスター」シートへ反映します。
 *   - 既存のお客様：最終商談日を最新の日付で更新
 *   - 新規のお客様：新しい行として追加
 *
 * 使い方：
 *   スプレッドシートを開くと「顧客管理」メニューが追加されます。
 *   「顧客マスターを更新」を選択すると実行されます。
 */

const LOG_SHEET_NAME = '商談ログ';
const MASTER_SHEET_NAME = '顧客マスター';

/**
 * スプレッドシートを開いたときにメニューを追加
 */
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('顧客管理')
    .addItem('顧客マスターを更新', 'updateCustomerMaster')
    .addToUi();
}

/**
 * 商談ログを読み取り、顧客マスターに反映する
 */
function updateCustomerMaster() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const logSheet = ss.getSheetByName(LOG_SHEET_NAME);
  const masterSheet = ss.getSheetByName(MASTER_SHEET_NAME);

  if (!logSheet || !masterSheet) {
    SpreadsheetApp.getUi().alert(
      `「${LOG_SHEET_NAME}」または「${MASTER_SHEET_NAME}」シートが見つかりません。`
    );
    return;
  }

  // ---- 商談ログを読み込む ----
  const logData = logSheet.getDataRange().getValues();
  if (logData.length < 2) {
    SpreadsheetApp.getUi().alert('商談ログにデータがありません。');
    return;
  }

  const logHeaders = logData[0];
  const nameCol = logHeaders.indexOf('お客様名');
  const dateCol = logHeaders.indexOf('日付');

  if (nameCol === -1 || dateCol === -1) {
    SpreadsheetApp.getUi().alert(
      '商談ログに「お客様名」「日付」の列が必要です。'
    );
    return;
  }

  // ---- 顧客マスターを読み込み、「お客様名 → 行番号」のマップを作る ----
  const masterData = masterSheet.getDataRange().getValues();
  const customerRowMap = {};
  for (let i = 1; i < masterData.length; i++) {
    const name = masterData[i][0];
    if (name) {
      customerRowMap[name] = i + 1; // シート上の行番号（1始まり）
    }
  }

  // ---- 商談ログを1行ずつ処理 ----
  let added = 0;
  let updated = 0;
  for (let i = 1; i < logData.length; i++) {
    const row = logData[i];
    const customerName = row[nameCol];
    const date = row[dateCol];

    if (!customerName || !date) continue;

    if (customerRowMap[customerName]) {
      // 既存お客様：最終商談日を更新（より新しい日付なら）
      const rowNum = customerRowMap[customerName];
      const currentDate = masterSheet.getRange(rowNum, 2).getValue();
      if (!currentDate || new Date(date) > new Date(currentDate)) {
        masterSheet.getRange(rowNum, 2).setValue(date);
        updated++;
      }
    } else {
      // 新規お客様：行を追加
      masterSheet.appendRow([customerName, date, '']);
      customerRowMap[customerName] = masterSheet.getLastRow();
      added++;
    }
  }

  SpreadsheetApp.getUi().alert(
    `顧客マスターを更新しました。\n新規追加：${added} 件 ／ 更新：${updated} 件`
  );
}
