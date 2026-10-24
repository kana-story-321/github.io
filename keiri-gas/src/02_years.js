// ==========================================
// 年ごとのフォルダと帳簿
//   経理フォルダ / 2026年 / 2026年_帳簿（スプレッドシート）
//                        / 01月 … 12月（領収書の保存先。必要になったときに作る）
// ==========================================

const YEAR_HEADERS = ['年', 'フォルダ', '帳簿', '状態', '締めた日', 'フォルダID', '帳簿ID'];
const YEAR_CLOSED = '締め済み';
let YEAR_CACHE = {};

function yearRows_() {
  const sh = manage_().getSheetByName(SH_YEARS);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getRange(2, 1, sh.getLastRow() - 1, YEAR_HEADERS.length).getValues()
    .map((r, k) => ({ row: k + 2, year: Number(r[0]), status: String(r[3] || ''), folderId: String(r[5] || ''), ssId: String(r[6] || '') }))
    .filter(r => r.year > 0 && r.folderId && r.ssId);
}

// 締めていない年（古い順）
function openYears_() {
  return yearRows_().filter(r => r.status !== YEAR_CLOSED).map(r => r.year).sort();
}

// その年のフォルダと帳簿。create が true なら、なければ作る（なくて作らないなら null）
function getYear_(year, create) {
  if (YEAR_CACHE[year]) return YEAR_CACHE[year];
  let row = yearRows_().find(r => r.year === year);
  if (!row) {
    if (!create) return null;
    // ほかの実行（メール集めとカード明細など）が同時に同じ年を作らないよう、短い鍵をかける
    const lock = LockService.getUserLock();
    lock.waitLock(30 * 1000);
    try {
      row = yearRows_().find(r => r.year === year);   // 待っている間に、ほかの実行が作ったかもしれない
      if (!row) row = createYear_(year);
    } finally {
      lock.releaseLock();
    }
  }
  const y = {
    year: year,
    closed: row.status === YEAR_CLOSED,
    folder: DriveApp.getFolderById(row.folderId),
    ss: SpreadsheetApp.openById(row.ssId),
    months: {}
  };
  YEAR_CACHE[year] = y;
  return y;
}

function createYear_(year) {
  const folder = getSubFolder_(rootFolder_(), `${year}年`);
  const ss = SpreadsheetApp.create(`${year}年_帳簿`);
  DriveApp.getFileById(ss.getId()).moveTo(folder);
  const ledger = ss.getSheets()[0].setName(SHEET_LEDGER);
  prepareLedger_(ledger);
  const sh = manage_().getSheetByName(SH_YEARS);
  sh.appendRow([year, '', '', '記帳中', '', folder.getId(), ss.getId()]);
  const r = sh.getLastRow();
  sh.getRange(r, 2, 1, 2).setFormulas([[`=HYPERLINK("${folder.getUrl()}","${year}年のフォルダ")`, `=HYPERLINK("${ss.getUrl()}","${year}年_帳簿")`]]);
  console.log(`${year}年のフォルダと帳簿を作りました。`);
  return { row: r, year: year, status: '記帳中', folderId: folder.getId(), ssId: ss.getId() };
}

function prepareLedger_(ledger) {
  if (ledger.getLastRow() === 0) {
    ledger.appendRow(LEDGER_HEADERS);
    ledger.setFrozenRows(1);
    ledger.getRange(1, 1, 1, LEDGER_HEADERS.length).setFontWeight('bold').setBackground('#DDEBF7');
    ledger.getRange(1, COL('メールID'), ledger.getMaxRows(), 1).setNumberFormat('@');   // メールIDは文字のまま
  }
  return ledger;
}

function ledgerOf_(y) {
  return prepareLedger_(getOrCreateSheet_(y.ss, SHEET_LEDGER));
}

// 取引日（YYYY/MM/DD）の月のフォルダ（例：01月）
function monthFolder_(y, dateStr) {
  const mm = String(dateStr).slice(5, 7);
  if (!y.months[mm]) y.months[mm] = getSubFolder_(y.folder, `${mm}月`);
  return y.months[mm];
}

// 書類をどの年の帳簿に入れるか。取引日の年を基本にし、次の場合だけ受け取った年（または今年）にする
//   ・取引日が読めない
//   ・取引日が受け取った年から2年以上離れている（古い契約書・読み間違いなど）
//   ・その年をもう締めている
// 戻り値：{ y: 年の情報, note: チェック欄に書く言葉 }
function chooseYear_(txDate, receivedAt) {
  const rx = Number(Utilities.formatDate(receivedAt, TZ, 'yyyy'));
  const tx = txDate ? Number(String(txDate).slice(0, 4)) : 0;
  let year = tx || rx;
  let note = '';
  if (tx && Math.abs(tx - rx) > 1) {
    year = rx;
    note = `取引日が${tx}年のため、受け取った${rx}年の帳簿に入れています`;
  }
  const target = getYear_(year, false);
  if (target && target.closed) {
    const now = Number(Utilities.formatDate(new Date(), TZ, 'yyyy'));
    note = `${year}年はすでに締めているため、${now}年の帳簿に入れています（前の年の申告に関係するか確認してください）`;
    year = now;
  }
  return { y: getYear_(year, true), note: note };
}
