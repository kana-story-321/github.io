// このファイルは tools/bundle.sh で src/ から作ったものです。直接書き換えず、src/ を直してから作り直してください。
// 版：1.1.0

// ===== 00_config.js =====
/**
 * 経理アシスタント（個人事業主向け）
 *
 * 「管理シート」（年をまたいで使い続けるスプレッドシート）に付けて使うGAS。
 *   ・Gmailの領収書・請求書メールを集めて、電子帳簿保存法のルールに沿って保存する（元メールeml・PDF・添付）
 *   ・公式LINEに送られた写真・PDFと、「スキャン受付」フォルダに入れたファイルをGeminiで読み取って保存する
 *   ・カード明細を取り込み、領収書と突き合わせ、経費の仕分け（区分・勘定科目・事業割合）を提案する
 *   ・帳簿は年ごとに分け（「2026年」フォルダの「2026年_帳簿」）、領収書は月ごとのフォルダに保存する
 *   ・保存先の年は「取引日」で決める（12月の領収書が1月に届いても、前の年に入る）
 *
 * 弊社が設定するもの（拡張機能 → Apps Script → プロジェクトの設定 → スクリプト プロパティ）
 *   GEMINI_API_KEY : お客様ごとに弊社が発行した Gemini APIキー
 *   LINE_TOKEN     : お客様ごとの公式LINEの チャネルアクセストークン（長期）
 * お客様が入れるもの：管理シートの「設定」タブ（屋号・事業の説明 など）
 *
 * 画面の操作はスプレッドシートのメニュー「経理」から行う。
 */

const APP_VERSION = '1.1.0';
const TZ = 'Asia/Tokyo';
const PROPS = PropertiesService.getScriptProperties();

// AIのモデル。版を固定する（上げるときは、テスト用の環境で読み取り結果を確かめてから全員に配る）
const MODEL_NAME = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`;
// AIが答える前に「考える」量（トークン）。考えた分も料金がかかる
//   読み取り（メール・レシート・カード明細）は決まった項目を写すだけなので 0（考えない）
//   経費の仕分けは判断が要るので少しだけ考えさせる
// ※ モデルを変えるときは、0 が使えるか確かめる（使えないモデルがある）
const THINK_READ = 0;
const THINK_SHIWAKE = 1024;

// 管理シートのタブ
const SH_SETTINGS = '設定';
const SH_YEARS = '年度一覧';
const SH_RULES = '仕分けルール';
const SH_CARDS = 'カード名';
const SH_DONE = '処理済み';       // 読んだメールの記録（年をまたいで1つ）
const SH_LIST = '対象リスト';     // 見つけたメールの一覧（年をまたいで1つ）

// 年ごとの帳簿のタブ
const SHEET_LEDGER = '領収書台帳';

// フォルダの名前
const INBOX_NAME = 'スキャン受付';          // 紙の写真・ダウンロードしたPDF・LINEで届いたファイルの入口
const CARD_INBOX_NAME = 'カード明細受付';
const UNREADABLE_NAME = '読めなかった';
const CARD_DONE_NAME = '取込済み';
const BACKUP_NAME = '控え';                 // 年を締めたときのCSVの控え

// 「設定」タブの項目（項目名・初期値・説明）。上から順に並ぶ
const SETTING_ITEMS = [
  ['屋号', '', '帳簿のフォルダ名などに使います'],
  ['事業の説明', '', 'AIが経費の仕分けを判断するための説明です。どんな仕事か、仕事場（自宅など）、車やスマホを仕事と私用のどちらで使うか、よくある経費などを書いてください'],
  ['取り込み開始日', '', 'この日より前に届いたメールは取り込みません（例：2026/01/01）'],
  ['対象外のあて先', '', 'このあて先に届いたメールは取り込みません。カンマ区切り（例：example.com,info@example.jp）'],
  ['LINE連携コード', '', '公式LINEにこの数字を送ると、送った人が登録されます'],
  ['LINEの登録者', '', '自動で入ります（消すと、その人の登録が外れます）'],
  ['LINEで結果を知らせる', 'はい', '読み取りが終わったら、結果をLINEで知らせます（はい／いいえ）'],
  ['経理フォルダID', '', '自動で入ります。変更しないでください']
];

// スクリプトプロパティに保存する作業用の値
const PROP_LIST_DATE = 'LIST_SEARCHED_UNTIL';
const PROP_PAGE_TOKEN = 'LIST_PAGE_TOKEN';
const PROP_RETRY_ROUND = 'RETRY_ROUND';
const PROP_INFLIGHT = 'INFLIGHT';
const FAIL_PREFIX = 'FAIL_';


// ==========================================
// 管理シート
// ==========================================
// メニューや自動実行ではスプレッドシートが「開いている」扱いになるが、LINEの受付（ウェブアプリ）ではならないため、
// 初期設定で覚えたIDから開く
function manage_() {
  const ss = SpreadsheetApp.getActive();
  if (ss) return ss;
  const id = PROPS.getProperty('MANAGE_ID');
  if (!id) throw new Error('管理シートが分かりません。メニュー「経理」→「初期設定」を実行してください');
  return SpreadsheetApp.openById(id);
}


// ==========================================
// 「設定」タブを読む・書く
// ==========================================
let SETTINGS_CACHE = null;

function settings_() {
  if (SETTINGS_CACHE) return SETTINGS_CACHE;
  const sh = manage_().getSheetByName(SH_SETTINGS);
  const map = {};
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().forEach(r => { map[String(r[0]).trim()] = String(r[1]).trim(); });
  }
  SETTINGS_CACHE = map;
  return map;
}

function setting_(name) {
  return settings_()[name] || '';
}

function setSetting_(name, value) {
  const sh = manage_().getSheetByName(SH_SETTINGS);
  const last = sh.getLastRow();
  const names = last >= 2 ? sh.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0]).trim()) : [];
  const k = names.indexOf(name);
  if (k >= 0) sh.getRange(k + 2, 2).setValue(value);
  else sh.appendRow([name, value, '']);
  SETTINGS_CACHE = null;
}

function geminiKey_() {
  return PROPS.getProperty('GEMINI_API_KEY') || '';
}

function lineToken_() {
  return PROPS.getProperty('LINE_TOKEN') || '';
}

// 経理フォルダ（管理シートと、年ごとのフォルダが入る）
function rootFolder_() {
  const id = setting_('経理フォルダID');
  if (!id) throw new Error('経理フォルダが見つかりません。メニュー「経理」→「初期設定」を実行してください');
  return DriveApp.getFolderById(id);
}

// 取り込み開始日（未設定なら今年の1月1日）
function startDate_() {
  const d = normalizeDate_(setting_('取り込み開始日'));
  return d || `${Utilities.formatDate(new Date(), TZ, 'yyyy')}/01/01`;
}

function excludeTo_() {
  return setting_('対象外のあて先').split(',').map(s => s.trim()).filter(s => s);
}

// ===== 01_menu.js =====
// ==========================================
// メニュー「経理」と初期設定
// ==========================================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('経理')
    .addItem('今すぐ領収書を集める', 'メニュー_領収書を集める')
    .addItem('カード明細を取り込んで仕分ける', 'メニュー_カード明細を仕分ける')
    .addItem('未確認の行をAIで判定し直す', 'メニュー_判定し直す')
    .addSeparator()
    .addItem('前年を締める', 'メニュー_前年を締める')
    .addSeparator()
    .addItem('初期設定（最初に1回）', '初期設定')
    .addItem('状態を確認', 'メニュー_状態を確認')
    .addToUi();
}

function メニュー_領収書を集める() {
  const ss = SpreadsheetApp.getActive();
  ss.toast('領収書を集めています（数分かかることがあります）', '経理', 10);
  const r = 領収書をあつめる();
  if (!r) { ss.toast('ほかの処理が動いています。少し待ってから、もう一度押してください。', '経理', 10); return; }
  const more = r.left > 0 ? `残り${r.left}件は、このあと自動で続けます。` : '';
  ss.toast(`メール${r.processed}件を読み、${r.saved}件を保存しました。紙・PDF・LINEは${r.paper}件を保存しました。${more}`, '経理', 15);
}

function メニュー_カード明細を仕分ける() {
  const ss = SpreadsheetApp.getActive();
  ss.toast('カード明細の取り込みと仕分けをしています（数分かかることがあります）', '経理', 10);
  const r = 経費を仕分ける();
  if (!r) { ss.toast('ほかの処理が動いています。少し待ってから、もう一度押してください。', '経理', 10); return; }
  ss.toast('終わりました。各年の帳簿の「カード突き合わせ」「経費仕分け」タブを見てください。', '経理', 15);
}

function メニュー_判定し直す() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('未確認の行をAIで判定し直します',
    '「確認」にチェックがなく、何も変えていない行を消して、もう一度判定します。チェックした行・変えた行はそのまま残ります。続けますか？',
    ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  const r = 未確認の行をAIで判定し直す();
  SpreadsheetApp.getActive().toast(r ? '判定し直しました。' : 'ほかの処理が動いています。少し待ってから、もう一度押してください。', '経理', 10);
}

function メニュー_状態を確認() {
  const lines = [`バージョン：${APP_VERSION}（AI：${MODEL_NAME}）`];
  lines.push(`Gemini APIキー：${geminiKey_() ? '設定済み' : '未設定（弊社で設定します）'}`);
  lines.push(`公式LINE：${lineToken_() ? '設定済み' : '未設定（弊社で設定します）'}`);
  lines.push(`LINEの受付の合言葉：${PROPS.getProperty('WEBHOOK_KEY') || '未設定（初期設定を実行してください）'}`);
  lines.push(`LINEの登録者：${setting_('LINEの登録者') ? setting_('LINEの登録者').split(',').filter(s => s).length + '人' : 'なし（公式LINEに連携コードを送ってください）'}`);
  lines.push(`毎日の自動実行：${ScriptApp.getProjectTriggers().filter(t => t.getEventType() === ScriptApp.EventType.CLOCK).length > 0 ? 'オン' : 'オフ（初期設定を実行してください）'}`);
  const years = yearRows_().map(y => `${y.year}年（${y.status || '記帳中'}）`);
  lines.push(`帳簿：${years.length > 0 ? years.join('、') : 'まだありません'}`);
  SpreadsheetApp.getUi().alert('経理アシスタントの状態', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}


// ==========================================
// 初期設定（お客様のアカウントで1回だけ。何度実行しても壊れない）
// ==========================================
function 初期設定() {
  const ss = SpreadsheetApp.getActive();
  PROPS.setProperty('MANAGE_ID', ss.getId());   // テンプレートからコピーした直後は、テンプレートのIDが残っているので必ず書き直す
  if (!PROPS.getProperty('WEBHOOK_KEY')) PROPS.setProperty('WEBHOOK_KEY', Utilities.getUuid().replace(/-/g, ''));   // LINEの受付の合言葉
  ensureManagementSheets_(ss);

  // 経理フォルダ：テンプレートからコピーした直後は空。管理シートをそのフォルダに入れる
  let root = null;
  const id = setting_('経理フォルダID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      const parents = DriveApp.getFileById(ss.getId()).getParents();
      while (parents.hasNext()) { if (parents.next().getId() === f.getId()) root = f; }
    } catch (e) { root = null; }
  }
  if (!root) {
    const name = safeName_(`経理_${setting_('屋号') || '事業'}`);
    root = DriveApp.createFolder(name);
    DriveApp.getFileById(ss.getId()).moveTo(root);
    setSetting_('経理フォルダID', root.getId());
  }
  getSubFolder_(root, INBOX_NAME);
  getSubFolder_(root, CARD_INBOX_NAME);

  // 今年の帳簿
  getYear_(Number(Utilities.formatDate(new Date(), TZ, 'yyyy')), true);

  // LINE連携コード
  if (!setting_('LINE連携コード')) setSetting_('LINE連携コード', String(Math.floor(100000 + Math.random() * 900000)));
  if (!setting_('取り込み開始日')) setSetting_('取り込み開始日', startDate_());

  // 毎日の自動実行（メールは4時、カード明細と仕分けは6時）
  const daily = { '領収書をあつめる': 4, 'カード明細を取り込んで突き合わせる': 6 };
  ScriptApp.getProjectTriggers()
    .filter(t => daily[t.getHandlerFunction()] !== undefined)
    .forEach(t => ScriptApp.deleteTrigger(t));
  Object.keys(daily).forEach(fn => {
    ScriptApp.newTrigger(fn).timeBased().everyDays(1).atHour(daily[fn]).inTimezone(TZ).create();
  });

  const todo = [];
  if (!setting_('事業の説明')) todo.push('・「設定」タブの「事業の説明」を書いてください（AIの仕分けの精度が上がります）');
  if (!geminiKey_()) todo.push('・Gemini APIキー：弊社で設定します');
  if (!lineToken_()) todo.push('・公式LINE：弊社で設定します');
  SpreadsheetApp.getUi().alert('初期設定が終わりました',
    `経理フォルダ「${root.getName()}」を作り、今年の帳簿を用意しました。毎日4時にメール、6時にカード明細を自動で処理します。\n\n` +
    `公式LINEを友だち追加して、連携コード「${setting_('LINE連携コード')}」を送ってください。` +
    (todo.length > 0 ? '\n\nこのあと必要なこと：\n' + todo.join('\n') : ''),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

// 管理シートのタブをそろえる（足りないものだけ作る。中身は消さない）
function ensureManagementSheets_(ss) {
  const header = (sh, cols) => {
    if (sh.getLastRow() === 0) {
      sh.appendRow(cols);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, cols.length).setFontWeight('bold').setBackground('#DDEBF7');
    }
    return sh;
  };

  const st = header(getOrCreateSheet_(ss, SH_SETTINGS), ['項目', '値', '説明']);
  const have = st.getLastRow() >= 2 ? st.getRange(2, 1, st.getLastRow() - 1, 1).getValues().map(r => String(r[0]).trim()) : [];
  const add = SETTING_ITEMS.filter(it => have.indexOf(it[0]) < 0);
  if (add.length > 0) st.getRange(st.getLastRow() + 1, 1, add.length, 3).setValues(add);
  st.setColumnWidth(1, 160); st.setColumnWidth(2, 320); st.setColumnWidth(3, 480);
  st.getRange(2, 2, st.getLastRow() - 1, 1).setBackground('#FFF2CC');
  st.getRange(2, 1, st.getLastRow() - 1, 3).setWrap(true).setVerticalAlignment('top');
  SETTINGS_CACHE = null;

  header(getOrCreateSheet_(ss, SH_YEARS), YEAR_HEADERS);
  const rules = header(getOrCreateSheet_(ss, SH_RULES), RULE_HEADERS);
  if (rules.getLastRow() === 1 && DEFAULT_RULES.length > 0) rules.getRange(2, 1, DEFAULT_RULES.length, RULE_HEADERS.length).setValues(DEFAULT_RULES);
  header(getOrCreateSheet_(ss, SH_CARDS), ['会員番号の末尾', 'カードの名前', 'メモ']);
  // メールIDは文字のまま保存する（数字だけのIDが数値に変わると、同じメールだと分からなくなるため）
  header(getOrCreateSheet_(ss, SH_DONE), ['メールID', 'Message-ID', '処理日時', '結果', '保存した年']).hideSheet().getRange('A:B').setNumberFormat('@');
  header(getOrCreateSheet_(ss, SH_LIST), ['メールID', '見つけた日時']).hideSheet().getRange('A:A').setNumberFormat('@');

  // 最初からある空のシートは消す
  ['シート1', 'Sheet1'].forEach(n => {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
  ss.setActiveSheet(st);
}


// ==========================================
// 弊社の作業用（エディタから実行する）
// ==========================================
// テンプレートのタブ（設定・年度一覧など）だけを作る。フォルダ・自動実行・鍵は作らない
// （お客様がコピーした直後に「設定」タブへ屋号などを書けるようにするため。テンプレートで初期設定は押さない）
function 管理用_テンプレートを準備する() {
  ensureManagementSheets_(SpreadsheetApp.getActive());
  console.log('テンプレートのタブを用意しました。');
}

// テンプレートを配る前に、作業用の値・自動実行・鍵をすべて消す（お客様のシートでは実行しない）
function 管理用_テンプレートを空にする() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  PROPS.deleteAllProperties();
  [SH_YEARS, SH_DONE, SH_LIST].forEach(n => {
    const sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  });
  ['屋号', '事業の説明', '取り込み開始日', '対象外のあて先', 'LINE連携コード', 'LINEの登録者', '経理フォルダID'].forEach(n => {
    if (settings_()[n] !== undefined) setSetting_(n, '');
  });
  console.log('テンプレート用に空にしました。');
}

// ===== 02_years.js =====
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

// ===== 03_common.js =====
// ==========================================
// 共通の道具（Gemini・失敗回数・ファイル名・日付・数字）
// ==========================================

let DEADLINE = 0;   // この時刻を過ぎそうなら、待ち時間のある送り直しをしない

// 領収書台帳の列
const LEDGER_HEADERS = [
  '取引日', '取引先', '金額', '通貨', '品名', '分類', '事業で使えそうか', '支払い方法', 'ポイント利用額', 'ポイント以外の支払額',
  '注文番号', '入手経路', '件名', '差出人', '受信日時', '保存ファイル', '添付ファイル', 'Message-ID', 'メールID', 'メモ',
  '書類の種類', '元メール（eml）', 'チェック', '登録番号（インボイス）', '内訳（品目・金額・区分）', '事業の品の金額'
];
const ITEM_BIZ = '事業で使いそう', ITEM_PRIVATE = '個人っぽい', ITEM_UNSURE = 'どちらとも言えない';
const COL = name => LEDGER_HEADERS.indexOf(name) + 1;   // 列番号（1から）

const CATEGORIES = ['パソコン・機器', 'ソフト・サブスク', '本・勉強', '事務用品・消耗品', '通信', '交通・宿泊', '車', '飲食', '日用品・食品', '衣類・美容', '趣味・娯楽', 'ギフト・金券', '家賃・光熱費', '保険', '税金', 'その他'];
const DOC_TYPES = ['領収書', '注文確認', '請求書', '見積書', '契約書', '返金・取消', 'その他の取引書類'];


// ==========================================
// Gemini
// ==========================================
// 1件分のリクエスト（APIキーはURLではなくヘッダーで送る）。thinking：考える量（省略すると THINK_READ＝考えない）
function geminiRequest_(parts, thinking) {
  return {
    url: GEMINI_URL, method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { 'x-goog-api-key': geminiKey_() },
    payload: JSON.stringify({ contents: [{ parts: parts }], generationConfig: {
      responseMimeType: 'application/json', temperature: 0,
      thinkingConfig: { thinkingBudget: thinking === undefined ? THINK_READ : thinking }
    } })
  };
}

// まとめて送る。混み合っている（429・500・503）ときは、数秒おいて最大2回送り直す（時間に余裕があるときだけ）
function fetchGeminiAll_(requests) {
  if (!geminiKey_()) throw new Error('Gemini APIキーが設定されていません（弊社で設定します）');
  let responses = [];
  try { responses = UrlFetchApp.fetchAll(requests); } catch (e) { console.error('Gemini 送信エラー: ' + e.message); return []; }
  const busy = c => c === 429 || c === 500 || c === 503;
  [3000, 8000].forEach(wait => {
    const again = [];
    responses.forEach((r, k) => { if (r && busy(r.getResponseCode())) again.push(k); });
    if (again.length === 0) return;
    if (DEADLINE && Date.now() + wait + 30000 > DEADLINE) return;   // 時間が足りないときは送り直さない（次回に回す）
    Utilities.sleep(wait);
    try {
      const retried = UrlFetchApp.fetchAll(again.map(k => requests[k]));
      again.forEach((k, j) => { responses[k] = retried[j]; });
    } catch (e) { console.error('Gemini 再送信エラー: ' + e.message); }
  });
  return responses;
}

function readGeminiResponse_(res) {
  if (!res) return null;
  const code = res.getResponseCode();
  if (code !== 200) { console.error(`Gemini API エラー (Code: ${code})`); return null; }   // 本文には書類の中身が入りうるので、ログに出さない
  try {
    const json = JSON.parse(res.getContentText());
    if (!json.candidates || !json.candidates[0] || !json.candidates[0].content) return null;
    return parseJsonSafe_(json.candidates[0].content.parts[0].text);
  } catch (e) {
    console.error('Geminiの応答を読めませんでした');
    return null;
  }
}

function parseJsonSafe_(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    const m = String(text).match(/\{[\s\S]*\}/);
    if (m) {
      try { return JSON.parse(m[0]); } catch (e2) { /* 下へ */ }
    }
    console.error('Geminiの応答がJSONとして読めませんでした');
    return null;
  }
}

// 書類の読み取り結果を確かめて整える。必要な項目がない・形がおかしいときは null（＝読み取り失敗として次回読み直す）
function validateInfo_(info) {
  if (!info || typeof info !== 'object' || Array.isArray(info)) return null;
  if (typeof info.is_receipt !== 'boolean') return null;
  const str = v => (v === null || v === undefined || typeof v === 'object') ? '' : String(v).trim();
  const cur = str(info.currency).toUpperCase();
  const total = numOrBlank_(info.total);
  return {
    is_receipt: info.is_receipt,
    reason: str(info.reason),
    doc_type: DOC_TYPES.indexOf(str(info.doc_type)) >= 0 ? str(info.doc_type) : (info.is_receipt ? '領収書' : ''),
    store: str(info.store),
    date: normalizeDate_(info.date),
    total: total,
    total_invalid: total === '' && info.total !== null && info.total !== undefined && info.total !== '',
    currency: /^[A-Z]{3}$/.test(cur) ? cur : 'JPY',
    order_no: str(info.order_no),
    invoice_no: /^T\d{13}$/.test(str(info.invoice_no).replace(/[\s-]/g, '')) ? str(info.invoice_no).replace(/[\s-]/g, '') : '',
    payment_method: str(info.payment_method),
    points_used: numOrBlank_(info.points_used),
    other_paid: numOrBlank_(info.other_paid),
    memo: str(info.memo),
    items: (Array.isArray(info.items) ? info.items : [])
      .filter(it => it && typeof it === 'object')
      .map(it => ({ name: str(it.name), category: str(it.category), business_use: str(it.business_use), price: numOrBlank_(it.price) }))
  };
}

// 品目の内訳と、事業の品の金額を出す
//   事業の品と個人の品が混ざっているときだけ「事業の品の金額」を出す（全部事業・全部個人なら空＝レシート全体で判断）
//   レシートの品目の金額は税抜きのこともあるので、「事業の品の金額の割合」を合計金額（税込）に掛けて求める
// 戻り値：{ text: 内訳の文, bizAmount: 数字か空, checks: チェック欄に書くこと }
function itemBreakdown_(info) {
  const items = info.items || [];
  const tag = it => it.business_use === ITEM_BIZ ? '事業' : it.business_use === ITEM_PRIVATE ? '個人' : '不明';
  const text = items.length < 2 ? '' :
    items.map(it => `${it.name || '品名不明'}${it.price !== '' ? ' ' + it.price + '円' : ''}［${tag(it)}］`).join('、');
  const out = { text: text, bizAmount: '', checks: [] };
  const total = numOrBlank_(info.total);
  if (items.length < 2 || total === '' || info.currency !== 'JPY') return out;
  const priced = items.filter(it => it.price !== '');
  const sum = list => list.reduce((a, it) => a + Number(it.price), 0);
  // 読み取りの確かめ：品目の合計と合計金額が大きく違えば知らせる（税抜き表示なら最大10%ほど違うのは正常）
  const mismatch = priced.length === items.length && sum(items) > 0 && (total < sum(items) * 0.95 || total > sum(items) * 1.12);
  if (mismatch) out.checks.push(`品目の合計（${sum(items)}円）と合計金額（${total}円）が合いません。読み間違いがないか確認してください`);
  const biz = items.filter(it => it.business_use === ITEM_BIZ);
  if (biz.length === 0 || biz.length === items.length) return out;   // 混ざっていない
  if (mismatch) {   // 読み間違いの可能性がある数字で計算しない
    out.checks.push('事業の品と個人の品が混ざっていますが、金額が合わないため、事業の分は計算していません（事業割合を入れてください）');
    return out;
  }
  if (priced.length !== items.length || sum(items) <= 0) {
    out.checks.push('事業の品と個人の品が混ざっていますが、金額が読み取れない品があるため、事業の分を計算できませんでした');
    return out;
  }
  out.bizAmount = Math.round(total * sum(biz) / sum(items));
  const unsure = items.filter(it => tag(it) === '不明');
  out.checks.push(`事業の品と個人の品が混ざっています（事業の分 ${out.bizAmount}円）` +
    (unsure.length > 0 ? `。事業か個人か分からない品（${unsure.map(it => it.name).join('、')}）は個人に入れています` : ''));
  return out;
}

// 事業の説明（「設定」タブ）。AIへの指示に入れる
function businessProfile_() {
  return setting_('事業の説明') || '（まだ書かれていません。一般的な個人事業主として判断してください）';
}


// ==========================================
// 失敗回数（メールID・ファイルIDごとに、1件ずつ別のプロパティに記録）
// ==========================================
const MAX_FAILS_PER_ITEM = 5;   // 同じものが5回失敗したら「要確認」にする

function loadFails_() {
  const all = PROPS.getProperties();
  const fails = {};
  Object.keys(all).forEach(k => { if (k.indexOf(FAIL_PREFIX) === 0) fails[k.slice(FAIL_PREFIX.length)] = Number(all[k]) || 0; });
  return fails;
}

// 失敗を1回数える。上限に達したら true（＝要確認にする）
function countFail_(ctx, key) {
  const n = (ctx.fails[key] || 0) + 1;
  if (n >= MAX_FAILS_PER_ITEM) { clearFail_(ctx, key); return true; }
  ctx.fails[key] = n;
  PROPS.setProperty(FAIL_PREFIX + key, String(n));
  return false;
}

function clearFail_(ctx, key) {
  if (ctx.fails[key] !== undefined) { delete ctx.fails[key]; PROPS.deleteProperty(FAIL_PREFIX + key); }
}


// ==========================================
// 鍵：帳簿に書く処理（メール・紙とLINE・カード明細と仕分け・年を締める）は、すべて同じ鍵で1つずつ動かす
// （別々の鍵だと、同時に「最後の行の次」に書いて、行を上書きしてしまうため）
// ==========================================
const MAX_LOCK_WAITS = 15;   // ほかの処理が動いていたら2分ずつ待つ。15回（30分）で諦めて翌日の自動実行に任せる

// retryHandler：鍵が取れなかったときに、2分後に呼び直す関数の名前（null なら呼び直さない＝メニューから押したとき）
function withLock_(retryHandler, fn) {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) {
    console.log('ほかの処理が動いているので、今回は待ちます。');
    if (retryHandler) {
      const key = 'WAIT_' + retryHandler;
      const n = Number(PROPS.getProperty(key) || 0) + 1;
      if (n <= MAX_LOCK_WAITS) { PROPS.setProperty(key, String(n)); scheduleOnce_(retryHandler, 2 * 60 * 1000); }
      else PROPS.deleteProperty(key);
    }
    return null;
  }
  if (retryHandler) PROPS.deleteProperty('WAIT_' + retryHandler);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}


// ==========================================
// 自動実行の予約
// ==========================================
// 同じ関数の予約は常に1つだけにする
function scheduleOnce_(handler, ms) {
  cancelSchedule_(handler);
  ScriptApp.newTrigger(handler).timeBased().after(ms).create();
}

function cancelSchedule_(handler) {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === handler && t.getEventType() === ScriptApp.EventType.CLOCK && !isDailyTrigger_(t))
    .forEach(t => ScriptApp.deleteTrigger(t));
}

// 毎日の自動実行（初期設定で作ったもの）は、予約の入れ直しで消さない
function isDailyTrigger_(t) {
  return t.getHandlerFunction() === '領収書をあつめる' || t.getHandlerFunction() === 'カード明細を取り込んで突き合わせる';
}

function hasSchedule_(handler) {
  return ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === handler && t.getEventType() === ScriptApp.EventType.CLOCK);
}


// ==========================================
// スプレッドシート・フォルダ・ファイル名
// ==========================================
function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

// 同じ名前のフォルダが2つできてしまっても、いちばん古いものを使う
function getSubFolder_(parent, name) {
  const it = parent.getFoldersByName(name);
  const found = [];
  while (it.hasNext()) found.push(it.next());
  if (found.length === 0) return parent.createFolder(name);
  found.sort((a, b) => a.getDateCreated() - b.getDateCreated());
  return found[0];
}

function uniqueName_(folder, name) {
  if (!folder.getFilesByName(name).hasNext()) return name;
  const dot = name.lastIndexOf('.');
  for (let n = 2; n < 100; n++) {
    const cand = `${name.slice(0, dot)}_${n}${name.slice(dot)}`;
    if (!folder.getFilesByName(cand).hasNext()) return cand;
  }
  return name;
}

function safeName_(s) {
  return String(s).replace(/[\\/:*?"<>|\r\n\t]/g, '').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function esc_(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function amountLabel_(info) {
  const n = numOrBlank_(info.total);
  if (n === '') return '金額不明';
  return info.currency === 'JPY' ? `${n}円` : `${n}${info.currency}`;
}

// 「=」「+」「-」「@」で始まる文字は、数式として動かないよう先頭に ' をつける
function safeCell_(v) {
  const s = (v === null || v === undefined) ? '' : String(v);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

// スプレッドシートのセルの日付（日付型に自動変換されている場合も）を「YYYY/MM/DD」にする
function cellDate_(v) {
  if (v instanceof Date || (v && typeof v.getTime === 'function')) return Utilities.formatDate(v, TZ, 'yyyy/MM/dd');
  return normalizeDate_(v);
}

// 「YYYY/MM/DD」に直す。存在しない日付（2/30など）は空にする
function normalizeDate_(s) {
  const m = String(s || '').match(/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (!m) return '';
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) return '';
  return `${y}/${('0' + mo).slice(-2)}/${('0' + d).slice(-2)}`;
}

// 金額を数字にする。数字として正しくないもの（[]、"1,2"の羅列、Infinity など）は空にする
function numOrBlank_(v) {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return isFinite(v) ? v : '';
  if (typeof v !== 'string') return '';
  const s = v.replace(/[,，円¥$\s]/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(s)) return '';
  const n = Number(s);
  return isFinite(n) ? n : '';
}

function loadIds_(sheet, asArray) {
  const last = sheet.getLastRow();
  const vals = last < 2 ? [] : sheet.getRange(2, 1, last - 1, 1).getValues().map(r => String(r[0])).filter(v => v);
  if (asArray) return vals;
  const ids = {};
  vals.forEach(v => { ids[v] = true; });
  return ids;
}

// ===== 10_mail.js =====
// ==========================================
// 領収書あつめ（Gmail ＋ スキャン受付・LINE）
//   Gmailの領収書・請求書などのメールを探し、電子帳簿保存法のルールに沿って
//     ・元のメールをそのまま（.eml）保存 … 画像や長い本文も欠けない「原本」
//     ・見やすいようにPDFも保存
//     ・PDFなどの添付ファイル（領収書・請求書）も保存
//     ・ファイル名は「日付_取引先_金額」、取引日の年・月のフォルダに分ける
//     ・その年の「領収書台帳」に 日付・取引先・金額 などを1行ずつ記録（検索用）
//   6分の上限で止まらないよう、区切って自動で続きを行う。
// ==========================================

const STOP_AFTER_MS = 3 * 60 * 1000;      // 3分たったら新しいまとまりを始めない
const HARD_STOP_MS = 4 * 60 * 1000;       // 4分を過ぎたら、まとまりの途中でも次のメールに進まない
const LIMIT_MS = 5 * 60 * 1000;           // 送り直しの待ち時間などは、5分を超えない範囲でだけ行う（GASの上限は6分）
const CONTINUE_AFTER_MS = 60 * 1000;      // 区切ったら1分後に自動で続きを実行
const RETRY_AFTER_MS = 10 * 60 * 1000;    // 失敗だけが残った・エラーで止まったときは、10分後に再挑戦
const SAFETY_AFTER_MS = 8 * 60 * 1000;    // 実行の最初に入れておく「保険の予約」（強制終了されても8分後に再開）
const MAX_RETRY_ROUNDS = 6;               // 再挑戦は最大6回（約1時間）まで
const PARALLEL = 10;                      // 同時に読む・送る通数
const BODY_MAX_CHARS = 6000;              // Geminiに送る本文の上限
const HTML_MAX_CHARS = 300000;            // これより大きいメールは、画像を外してからPDFにする
const LIGHT_HTML_MAX_CHARS = 1000000;     // 画像を外しても、これより大きいメールは文字だけのPDFにする
const TEXT_PDF_MAX_CHARS = 30000;         // 文字だけのPDFにするときの本文の上限
const CONTINUE_HANDLER = '続きを自動実行';
const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me/messages';

// 領収書・請求書などのメールを探す検索条件（広告・SNSのタブは除く）
const SEARCH_BASE = [
  '-category:promotions -category:social -in:spam -in:trash',
  '(category:purchases OR subject:(注文 OR 購入 OR 領収 OR 決済 OR お支払い OR ご利用 OR 請求 OR 見積 OR 契約 OR 返金 OR 取消 OR キャンセル OR receipt OR order OR invoice OR payment OR refund)',
  'OR from:(shopping.yahoo.co.jp OR paypay OR amazon OR rakuten OR yodobashi OR biccamera OR apple OR mercari OR iosys OR janpara OR sofmap OR dospara))'
].join(' ');

// 件名だけで「対象外」と分かるもの（Geminiに送らない）。ただし取引書類の言葉も入っていれば除外しない
const SKIP_SUBJECT = /(発送|出荷|配達|お届け完了|ポイント(獲得|付与|進呈|失効)|クーポン|アンケート|レビュー|認証コード|確認コード|ワンタイム|パスワード|ログイン|メルマガ|ニュースレター)/;
const KEEP_SUBJECT = /(領収|請求|見積|契約|返金|取消|キャンセル|receipt|invoice|refund|お支払い|決済)/i;


// ==========================================
// メイン：領収書をあつめる（終わるまで自動で続ける）
// ==========================================
function 領収書をあつめる() {
  const started = Date.now();
  DEADLINE = started + LIMIT_MS;
  return withLock_(CONTINUE_HANDLER, () => {
    try {
      return collect_(started);
    } catch (e) {
      console.error('エラーで止まりました：' + e.message);
      scheduleRetry_('エラーで止まったため');
      throw e;
    }
  });
}

function 続きを自動実行() {
  領収書をあつめる();
}

function 自動の続きを止める() {
  cancelSchedule_(CONTINUE_HANDLER);
}

function collect_(started) {
  // 保険の予約：この実行が6分を超えて強制終了されても、8分後に自動で再開する（正常に終われば、下で置き換えるか消す）
  scheduleOnce_(CONTINUE_HANDLER, SAFETY_AFTER_MS);
  if (!geminiKey_()) throw new Error('Gemini APIキーが設定されていません（弊社で設定します）');
  const ss = manage_();
  const done = ss.getSheetByName(SH_DONE);
  const list = ss.getSheetByName(SH_LIST);
  if (!done || !list) throw new Error('管理シートの準備ができていません。メニュー「経理」→「初期設定」を実行してください');
  const timeUp = () => Date.now() - started > STOP_AFTER_MS;
  const hardStop = () => Date.now() - started > HARD_STOP_MS;
  const ctx = { done: done, fails: loadFails_(), hardStop: hardStop, light: {}, lineResults: [] };

  // ① 紙・PDF・LINEの写真（LINEで送った人を待たせないよう、メールより先に行う）
  const paper = processPaperReceipts_(ctx, timeUp);
  if (paper.saved + paper.unreadable > 0) console.log(`紙・PDF・LINE：${paper.saved}件を保存、読めなかった ${paper.unreadable}件`);
  notifyLineResults_(ctx.lineResults);

  // ② メールを探す
  const searched = searchNewMessages_(list, timeUp);
  if (!searched.finished) {
    console.log(`メールを探している途中で区切りました（ここまで${searched.added}件追加）。1分後に自動で続けます。`);
    scheduleOnce_(CONTINUE_HANDLER, CONTINUE_AFTER_MS);
    return { processed: 0, saved: 0, left: null, paper: paper.saved };
  }

  // ③ まだ処理していないメール（前回失敗したものは後回し）
  const doneIds = loadIds_(done);
  const pendingAll = loadIds_(list, true).filter(id => !doneIds[id]);
  const pending = pendingAll.filter(id => !ctx.fails[id]).concat(pendingAll.filter(id => ctx.fails[id]));
  console.log(`対象のメール：全${list.getLastRow() - 1}件／未処理 ${pending.length}件`);

  // 前回、保存の途中で強制終了されたメールがあれば：失敗を1回数え、今回は軽いやり方（文字だけのPDF・添付なし）で保存する
  const inflight = PROPS.getProperty(PROP_INFLIGHT);
  if (inflight) {
    PROPS.deleteProperty(PROP_INFLIGHT);
    console.log('前回、保存の途中で止まったメールがあります。今回は軽いやり方で保存します。');
    const k = pending.indexOf(inflight);
    const savedYear = ledgerYearOfMail_(inflight);
    if (savedYear) {
      // 台帳には書けていた（保存の記録を書く直前に止まった）：二重に保存しない
      appendDone_(done, [[inflight, '', new Date(), '保存', savedYear]]);
      if (k >= 0) pending.splice(k, 1);
    } else if (countFail_(ctx, inflight)) {
      appendDone_(done, [[inflight, '', new Date(), `要確認（保存の途中で止まることを${MAX_FAILS_PER_ITEM}回くり返したため保留。Gmailの元メールを確認してください）`, '']]);
      if (k >= 0) pending.splice(k, 1);
    } else {
      ctx.light[inflight] = true;
      if (k > 0) { pending.splice(k, 1); pending.unshift(inflight); }   // いちばん先に処理して、結果をはっきりさせる
    }
  }

  let processed = 0, saved = 0, failed = 0, quotaHit = false, i = 0;
  while (i < pending.length && !timeUp()) {
    const batch = pending.slice(i, i + PARALLEL);
    i += batch.length;
    const r = processBatch_(batch, ctx);
    processed += r.processed; saved += r.saved; failed += r.failed;
    console.log(`進み具合：${i}／${pending.length}件（保存 ${saved}件）`);
    if (r.quotaHit) { quotaHit = true; console.log('Gmail側の回数制限にかかったので、いったん止めます。'); break; }
    if (hardStop()) break;
  }

  const left = pending.length - processed;
  console.log(`今回 ${processed}件を読み、保存 ${saved}件。残り ${left}件。`);
  if (failed > 0) console.log(`読み取りに失敗した ${failed}件は、次回もう一度読みます（同じものが${MAX_FAILS_PER_ITEM}回失敗したら「要確認」にします）。`);

  if (quotaHit) {
    scheduleRetry_('Gmailの回数制限にかかったため');
  } else if ((left > 0 && left > failed) || paper.left > 0) {
    PROPS.deleteProperty(PROP_RETRY_ROUND);
    scheduleOnce_(CONTINUE_HANDLER, CONTINUE_AFTER_MS);
  } else if (left > 0 || paper.failed > 0) {
    scheduleRetry_(`残りは読み取りに失敗した${left + paper.failed}件`);
  } else {
    PROPS.deleteProperty(PROP_RETRY_ROUND);
    自動の続きを止める();
    console.log('すべて読み終わりました。');
  }
  return { processed: processed, saved: saved, left: left, paper: paper.saved };
}

function scheduleRetry_(why) {
  const round = Number(PROPS.getProperty(PROP_RETRY_ROUND) || 0) + 1;
  if (round <= MAX_RETRY_ROUNDS) {
    PROPS.setProperty(PROP_RETRY_ROUND, String(round));
    console.log(`${why}、10分後に自動で再挑戦します（${round}／${MAX_RETRY_ROUNDS}回目）。`);
    scheduleOnce_(CONTINUE_HANDLER, RETRY_AFTER_MS);
  } else {
    PROPS.deleteProperty(PROP_RETRY_ROUND);
    自動の続きを止める();
    console.log(`${why}ですが、再挑戦の上限に達したので止めます。翌日の自動実行で読み直します。`);
  }
}

function appendDone_(done, rows) {
  if (rows.length > 0) done.getRange(done.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
}


// ==========================================
// Gmail API
// ==========================================
function gmailHeaders_() {
  return { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() };
}

function gmailGetJson_(url) {
  const res = UrlFetchApp.fetch(url, { headers: gmailHeaders_(), muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code !== 200) throw new Error(`Gmail API エラー (Code: ${code})`);
  return JSON.parse(res.getContentText());
}

function buildQuery_(fromDate) {
  const ex = excludeTo_();
  return `after:${fromDate} ${SEARCH_BASE}${ex.length > 0 ? ` -to:(${ex.join(' OR ')})` : ''}`;
}

// メールを探して「対象リスト」に足す
function searchNewMessages_(list, timeUp) {
  // Gmailの日付検索は米国時間で区切られるため、取り込み開始日の1日前から探し、日付はコードで日本時間に合わせて判定する
  const start = new Date(startDate_().replace(/\//g, '-') + 'T00:00:00+09:00');
  const fromDate = PROPS.getProperty(PROP_LIST_DATE) || Utilities.formatDate(new Date(start.getTime() - 24 * 3600 * 1000), TZ, 'yyyy/MM/dd');
  let pageToken = PROPS.getProperty(PROP_PAGE_TOKEN) || '';
  const query = buildQuery_(fromDate);
  const known = loadIds_(list);
  let added = 0;

  while (true) {
    if (timeUp()) {
      PROPS.setProperty(PROP_PAGE_TOKEN, pageToken);
      return { finished: false, added: added };
    }
    let url = `${GMAIL_API}?maxResults=500&q=${encodeURIComponent(query)}`;
    if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
    let json;
    try {
      json = gmailGetJson_(url);
    } catch (e) {
      if (pageToken) PROPS.deleteProperty(PROP_PAGE_TOKEN);   // 古くなった続きの位置は捨てて、次回は最初から探し直す（重複はしない）
      throw e;
    }
    const now = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm');
    const rows = [];
    (json.messages || []).forEach(m => {
      if (known[m.id]) return;
      known[m.id] = true;
      rows.push([m.id, now]);
    });
    if (rows.length > 0) {
      list.getRange(list.getLastRow() + 1, 1, rows.length, 2).setValues(rows);
      added += rows.length;
    }
    if (!json.nextPageToken) break;
    pageToken = json.nextPageToken;
  }
  // 次回は2日前から探す（1日だと時差で取りこぼしが出る。重なった分は重複しない）
  const from = new Date(Date.now() - 2 * 24 * 3600 * 1000);
  PROPS.setProperty(PROP_LIST_DATE, Utilities.formatDate(from, TZ, 'yyyy/MM/dd'));
  PROPS.deleteProperty(PROP_PAGE_TOKEN);
  if (added > 0) console.log(`新しく見つかったメール：${added}件`);
  return { finished: true, added: added };
}

// 保存済みの Message-ID（同じメールが転送などで2通届いても、二重に保存しない）
function savedMessageIds_(done) {
  const last = done.getLastRow();
  const ids = {};
  if (last < 2) return ids;
  done.getRange(2, 2, last - 1, 3).getValues().forEach(r => { if (r[0] && r[2] === '保存') ids[String(r[0])] = true; });
  return ids;
}

// このメールを記録した台帳の年（なければ 0）
function ledgerYearOfMail_(mailId) {
  for (const r of yearRows_()) {
    const ledger = getYear_(r.year, false).ss.getSheetByName(SHEET_LEDGER);
    if (!ledger || ledger.getLastRow() < 2) continue;
    const ids = ledger.getRange(2, COL('メールID'), ledger.getLastRow() - 1, 1).getValues();
    if (ids.some(v => String(v[0]) === mailId)) return r.year;
  }
  return 0;
}

// その年の台帳にある注文番号（注文確認と領収書が別々に届いたときに知らせるため）
function ledgerOrders_(ledger) {
  const last = ledger.getLastRow();
  const orders = {};
  if (last < 2) return orders;
  ledger.getRange(2, 1, last - 1, COL('注文番号')).getValues().forEach(r => {
    const ord = r[COL('注文番号') - 1];
    if (ord) orders[String(r[COL('取引先') - 1]).replace(/^'/, '') + '|' + String(ord).replace(/^'/, '')] = true;
  });
  return orders;
}


// ==========================================
// 10通ずつ同時に読み、Geminiで判定して保存する
// ==========================================
function processBatch_(ids, ctx) {
  let processed = 0, saved = 0, failed = 0, quotaHit = false;
  const doneRows = [];
  const markDone = (id, mid, result, year) => { doneRows.push([id, mid || '', new Date(), result, year || '']); processed++; clearFail_(ctx, id); };
  const markFail = (id, why) => {
    if (countFail_(ctx, id)) { doneRows.push([id, '', new Date(), `要確認（${why}を${MAX_FAILS_PER_ITEM}回くり返したため保留）`, '']); processed++; return; }
    failed++;
  };

  let mailRes = [];
  try {
    mailRes = UrlFetchApp.fetchAll(ids.map(id => ({ url: `${GMAIL_API}/${id}?format=full`, headers: gmailHeaders_(), muteHttpExceptions: true })));
  } catch (e) {
    console.error('Gmailの読み込みエラー: ' + e.message);
    return { processed: 0, saved: 0, failed: ids.length, quotaHit: false };
  }

  const startDay = startDate_();
  const savedMids = savedMessageIds_(ctx.done);   // 保存済みのメールはGeminiに送らない（費用の節約）
  const toAsk = [];
  ids.forEach((id, k) => {
    const res = mailRes[k];
    const code = res ? res.getResponseCode() : 0;
    if (code === 404) { markDone(id, '', '対象外（メールが見つからない）'); return; }
    if (code === 429 || code === 403) { quotaHit = true; failed++; return; }   // Gmailの回数制限：10分後の再挑戦に回す
    if (code !== 200) { console.error(`Gmail API エラー (Code: ${code})`); markFail(id, 'Gmailの読み込みエラー'); return; }
    let msg;
    try { msg = toMessage_(JSON.parse(res.getContentText())); } catch (e) { markFail(id, 'メールの読み取りエラー'); return; }
    if (Utilities.formatDate(msg.date, TZ, 'yyyy/MM/dd') < startDay) { markDone(id, msg.messageId, '対象外（取り込み開始日より前）'); return; }
    if (SKIP_SUBJECT.test(msg.subject) && !KEEP_SUBJECT.test(msg.subject)) { markDone(id, msg.messageId, '対象外（件名で除外）'); return; }
    if (msg.messageId && savedMids[msg.messageId]) { markDone(id, msg.messageId, '重複（保存済み）'); return; }
    toAsk.push(msg);
  });

  if (toAsk.length > 0) {
    const responses = fetchGeminiAll_(toAsk.map(msg => geminiRequest_([{ text: buildPrompt_(msg) }])));
    for (let k = 0; k < toAsk.length; k++) {
      const msg = toAsk[k];
      if (ctx.hardStop()) break;   // 時間切れ：残りは処理済みにせず、次回に回す
      const info = validateInfo_(readGeminiResponse_(responses[k]));
      if (info === null) { markFail(msg.id, 'Geminiの読み取り失敗'); continue; }
      if (!info.is_receipt) { markDone(msg.id, msg.messageId, '対象外' + (info.reason ? `（${info.reason}）` : '')); continue; }
      if (msg.messageId && savedMids[msg.messageId]) { markDone(msg.id, msg.messageId, '重複（保存済み）'); continue; }
      const created = [];
      PROPS.setProperty(PROP_INFLIGHT, msg.id);   // 保存中の印（ここで強制終了されたら、次の実行で分かる）
      try {
        const where = chooseYear_(info.date, msg.date);
        const ledger = ledgerOf_(where.y);
        const files = saveReceipt_(msg, info, ctx, where.y, created);
        const sameOrder = info.order_no && ledgerOrders_(ledger)[(info.store || '') + '|' + info.order_no];
        const notes = [where.note, sameOrder ? '同じ注文番号の記録がすでにあります（注文確認と領収書など。合計で二重に数えないよう注意）' : ''].filter(s => s).join('／');
        ledger.appendRow(buildLedgerRow_(info, msg, files, 'メール', notes));
        // 保存の記録はすぐに書く（まとめて最後に書くと、途中で強制終了されたとき、次の実行で二重に保存してしまう）
        appendDone_(ctx.done, [[msg.id, msg.messageId || '', new Date(), '保存', where.y.year]]);
        processed++;
        clearFail_(ctx, msg.id);
        if (msg.messageId) savedMids[msg.messageId] = true;
        saved++;
      } catch (e) {
        // 台帳に書けなかったとき：作ったファイルを片づけて、次回やり直す（台帳に載らないファイルを残さない）
        console.error('保存エラー：' + e.message);
        created.forEach(f => { try { f.setTrashed(true); } catch (e2) { /* 片づけに失敗しても続ける */ } });
        markFail(msg.id, '保存エラー');
      }
      PROPS.deleteProperty(PROP_INFLIGHT);
    }
  }

  appendDone_(ctx.done, doneRows);
  return { processed: processed, saved: saved, failed: failed, quotaHit: quotaHit };
}

// Gmail API の返事を、扱いやすい形にする
function toMessage_(json) {
  const headers = {};
  ((json.payload && json.payload.headers) || []).forEach(h => { headers[h.name.toLowerCase()] = h.value; });
  const payload = json.payload || {};
  const html = findPart_(payload, 'text/html');
  const plain = findPart_(payload, 'text/plain');
  const htmlText = html ? decodePart_(html, json.id) : '';
  const plainText = plain ? decodePart_(plain, json.id) : '';
  return {
    id: json.id,
    messageId: headers['message-id'] || '',
    subject: headers['subject'] || '',
    from: headers['from'] || '',
    to: headers['to'] || '',
    date: new Date(Number(json.internalDate)),
    html: htmlText,
    body: plainText || htmlToText_(htmlText) || json.snippet || '',
    attachments: listAttachments_(payload)
  };
}

// 本文のパート（添付ファイルではないもの）を探す。本文が別取得（attachmentId）の形式でも拾う
function findPart_(part, mime) {
  if (part.mimeType === mime && !part.filename && part.body && (part.body.data || part.body.attachmentId)) return part;
  for (const p of (part.parts || [])) {
    const f = findPart_(p, mime);
    if (f) return f;
  }
  return null;
}

// 添付ファイル（PDF・画像）を探す。本文に埋め込まれた（data形式の）PDFも拾う
function listAttachments_(part, out) {
  out = out || [];
  const name = part.filename || '';
  const isPdf = part.mimeType === 'application/pdf' || /\.pdf$/i.test(name);
  const isImg = /^image\//.test(part.mimeType || '') && name;
  if (name && part.body && (part.body.attachmentId || part.body.data) && (isPdf || isImg)) {
    out.push({ filename: name, mimeType: isPdf ? 'application/pdf' : part.mimeType, attachmentId: part.body.attachmentId || '', data: part.body.data || '' });
  }
  (part.parts || []).forEach(p => listAttachments_(p, out));
  return out;
}

function decodePart_(part, messageId) {
  let data = part.body.data;
  if (!data && part.body.attachmentId) data = gmailGetJson_(`${GMAIL_API}/${messageId}/attachments/${part.body.attachmentId}`).data;
  const bytes = Utilities.base64DecodeWebSafe(data);
  const ct = ((part.headers || []).find(h => h.name.toLowerCase() === 'content-type') || {}).value || '';
  const m = ct.match(/charset="?([^";\s]+)"?/i);
  try {
    return Utilities.newBlob(bytes).getDataAsString(m ? m[1] : 'UTF-8');
  } catch (e) {
    return Utilities.newBlob(bytes).getDataAsString('UTF-8');
  }
}

function htmlToText_(html) {
  return String(html || '')
    .replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&yen;/g, '¥').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n');
}


// ==========================================
// 保存（元メール・PDF・添付）
// どれかが失敗しても残りは保存し、「チェック」欄で知らせる（原本を消さない）
// created：作ったファイルを入れていく（台帳に書けなかったときだけ、呼び出し側で片づける）
// ==========================================
function saveReceipt_(msg, info, ctx, y, created) {
  const dateStr = info.date || Utilities.formatDate(msg.date, TZ, 'yyyy/MM/dd');
  // 取引日が帳簿の年と違うとき（受け取った年に入れた場合など）は、受信した月のフォルダに入れる
  const folder = monthFolder_(y, Number(dateStr.slice(0, 4)) === y.year ? dateStr : Utilities.formatDate(msg.date, TZ, 'yyyy/MM/dd'));
  const base = safeName_(`${dateStr.replace(/\//g, '')}_${info.store || '取引先不明'}_${amountLabel_(info)}`);
  const notes = [];

  // 1) 元のメールをそのまま保存（.eml）＝画像や長い本文も欠けない原本
  let emlFile = null;
  try {
    emlFile = saveEml_(folder, base, msg.id);
    created.push(emlFile);
  } catch (e) {
    console.error('元メール（eml）を保存できませんでした：' + e.message);
    notes.push('元メール（eml）を保存できませんでした。Gmailの元メールを消さずに残してください');
  }

  // 2) 見やすいPDF（先頭に差出人・あて先・日時・件名をのせる）
  const head = `<div style="font-family:sans-serif;font-size:11px;color:#333;border-bottom:1px solid #999;padding-bottom:6px;margin-bottom:10px">`
    + `差出人：${esc_(msg.from)}<br>あて先：${esc_(msg.to)}<br>受信日時：${Utilities.formatDate(msg.date, TZ, 'yyyy/MM/dd HH:mm')}<br>`
    + `件名：${esc_(msg.subject)}<br>原本：${emlFile ? '同じフォルダの「' + esc_(emlFile.getName()) + '」' : 'Gmailの元メール'}</div>`;
  const light = !!ctx.light[msg.id] || (DEADLINE && Date.now() > DEADLINE - 90 * 1000);   // 前回止まったメール・時間が足りないときは軽いやり方
  if (light) notes.push(ctx.light[msg.id] ? '前回保存の途中で止まったため、PDFは文字だけ・添付は保存していません（原本はeml）' : '時間が足りないため、PDFは文字だけで保存（原本はeml）');
  let pdfFile = null;
  try {
    const pdf = saveMailPdf_(folder, uniqueName_(folder, base + '.pdf'), msg, head, base, light);
    pdfFile = pdf.file;
    created.push(pdfFile);
    if (pdf.note) notes.push(pdf.note);
  } catch (e) {
    console.error('PDFを作れませんでした：' + e.message);
    notes.push('PDFを作れませんでした（元メールemlで確認してください）');
  }

  // 3) 添付ファイル（PDF・画像）
  const attachLinks = [];
  (ctx.light[msg.id] ? [] : msg.attachments).forEach((a, n) => {
    try {
      const data = a.data || gmailGetJson_(`${GMAIL_API}/${msg.id}/attachments/${a.attachmentId}`).data;
      const ext = a.mimeType === 'application/pdf' ? '.pdf' : (a.filename.match(/\.[A-Za-z0-9]+$/) || ['.' + a.mimeType.split('/')[1]])[0];
      const blob = Utilities.newBlob(Utilities.base64DecodeWebSafe(data), a.mimeType);
      const name = uniqueName_(folder, safeName_(`${base}_添付${n + 1}_${a.filename.replace(/\.[A-Za-z0-9]+$/, '')}`) + ext);
      const f = folder.createFile(blob.setName(name));
      created.push(f);
      attachLinks.push(f.getUrl());
    } catch (e) {
      console.error('添付ファイルを保存できませんでした：' + e.message);
      notes.push(`添付ファイル「${a.filename}」を保存できませんでした（Gmailの元メールに残っています）`);
    }
  });

  if (!emlFile && !pdfFile && attachLinks.length === 0) throw new Error('元メール・PDF・添付のどれも保存できませんでした');
  return {
    main: pdfFile ? pdfFile.getUrl() : (emlFile ? emlFile.getUrl() : attachLinks[0]),
    attachments: attachLinks, date: dateStr, eml: emlFile ? emlFile.getUrl() : '', note: notes.join('／')
  };
}

function saveEml_(folder, base, messageId) {
  const raw = gmailGetJson_(`${GMAIL_API}/${messageId}?format=raw`).raw;
  const blob = Utilities.newBlob(Utilities.base64DecodeWebSafe(raw), 'message/rfc822');
  return folder.createFile(blob.setName(uniqueName_(folder, base + '.eml')));
}

// メールをPDFにして保存する。大きすぎて変換・保存できないときは、①画像を外す ②文字だけ の順に切り替える
function saveMailPdf_(folder, pdfName, msg, head, base, light) {
  const wrap = body => `<html><head><meta charset="utf-8"></head><body>${head}${body}</body></html>`;
  const toPdf = html => Utilities.newBlob(html, 'text/html', base + '.html').getAs('application/pdf');
  const textOnly = () => {
    const text = String(msg.body || '');
    const cut = text.length > TEXT_PDF_MAX_CHARS ? text.slice(0, TEXT_PDF_MAX_CHARS) + '\n\n（以下、長いため省略。全文は同じフォルダの元メール（.eml）にあります）' : text;
    return `<p style="font-size:10px;color:#888">※ 元のメールが大きいため、文字だけで保存しています。原本は同じフォルダの .eml ファイルです。</p><pre style="white-space:pre-wrap;font-family:sans-serif">${esc_(cut)}</pre>`;
  };
  const tries = [];
  if (!light && msg.html) {
    const html = String(msg.html).replace(/<script[\s\S]*?<\/script>/gi, '');
    if (html.length <= HTML_MAX_CHARS) tries.push({ body: html, note: '' });
    const noImg = html.replace(/<img[^>]*>/gi, '').replace(/url\(\s*['"]?data:[^)]*\)/gi, 'none');
    if (noImg.length <= LIGHT_HTML_MAX_CHARS) tries.push({ body: noImg, note: 'PDFは画像なしで保存（原本はeml）' });
  } else if (!light) {
    tries.push({ body: `<pre style="white-space:pre-wrap;font-family:sans-serif">${esc_(String(msg.body || '').slice(0, TEXT_PDF_MAX_CHARS * 10))}</pre>`, note: '' });
  }
  tries.push({ body: textOnly(), note: 'PDFは文字だけで保存（原本はeml）' });
  let lastErr = null;
  for (const t of tries) {
    try {
      const pdf = toPdf(wrap(t.body));
      pdf.getBytes();   // ここで実際に変換させて、失敗をこの場で拾う
      return { file: folder.createFile(pdf.setName(pdfName)), note: t.note };
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}


// ==========================================
// 台帳の1行
// ==========================================
function buildLedgerRow_(info, msg, files, source, extraCheck) {
  const items = info.items;
  const names = items.map(it => it.name).filter(v => v).join('、');
  const cat = items.length > 0 && CATEGORIES.indexOf(items[0].category) >= 0 ? items[0].category : 'その他';
  const biz = items.length > 0 ? (items[0].business_use || '') : '';
  const checks = [];
  if (numOrBlank_(info.total) === '') checks.push(info.total_invalid ? '金額の読み取りがおかしいため空にしています' : '金額が読み取れていません');
  if (!info.date) checks.push('取引日が読み取れず、受け取った日にしています');
  if (!info.store) checks.push('取引先が読み取れていません');
  const bd = itemBreakdown_(info);
  checks.push.apply(checks, bd.checks);
  if (files.note) checks.push(files.note);
  if (extraCheck) checks.push(extraCheck);
  const t = safeCell_;
  const row = new Array(LEDGER_HEADERS.length).fill('');
  const set = (name, v) => { row[COL(name) - 1] = v; };
  set('取引日', files.date);
  set('取引先', t(info.store));
  set('金額', numOrBlank_(info.total));
  set('通貨', t(info.currency));
  set('品名', t(names));
  set('分類', cat);
  set('事業で使えそうか', t(biz));
  set('支払い方法', t(info.payment_method));
  set('ポイント利用額', numOrBlank_(info.points_used));
  set('ポイント以外の支払額', numOrBlank_(info.other_paid));
  set('注文番号', t(info.order_no));
  set('入手経路', source);
  set('件名', t(msg.subject));
  set('差出人', t(msg.from));
  set('受信日時', Utilities.formatDate(msg.date, TZ, 'yyyy/MM/dd HH:mm'));
  set('保存ファイル', files.main);
  set('添付ファイル', files.attachments.join('\n'));
  set('Message-ID', t(msg.messageId));
  set('メールID', msg.id);
  set('メモ', t(info.memo));
  set('書類の種類', t(info.doc_type));
  set('元メール（eml）', files.eml);
  set('チェック', checks.join('／'));
  set('登録番号（インボイス）', info.invoice_no);
  set('内訳（品目・金額・区分）', t(bd.text));
  set('事業の品の金額', bd.bizAmount);
  return row;
}


// ==========================================
// Gemini への指示（メール）
// ==========================================
function buildPrompt_(msg) {
  const body = String(msg.body).replace(/\s+\n/g, '\n').slice(0, BODY_MAX_CHARS);
  const att = msg.attachments.length > 0 ? msg.attachments.map(a => a.filename).join('、') : 'なし';
  return `
あなたは個人事業主の確定申告の下準備を手伝う経理担当です。次のメールが「取引に関する書類（電子帳簿保存法で保存が必要なもの）」かどうかを判定し、そうであれば内容を抜き出してください。

# この人の事業
${businessProfile_()}

# 保存の対象（is_receipt を true にする）
- 領収書、注文確認、購入完了、決済完了、サブスクの請求・領収
- 請求書（支払い前のものも含む）、見積書、契約書
- 返金・取消の通知（取引の記録として残す）
- 本文に金額がなくても、「領収書（請求書）を添付しました」のように添付ファイルが取引書類であることが分かるもの

# 対象外（is_receipt を false にする）
- 広告・セール案内・メルマガ、発送／配達のお知らせ（注文確認と重複するため）、ポイント獲得のお知らせ、カートの案内、本人以外あての請求、お知らせだけのメール

# 書き方
- doc_type は次のどれか：${DOC_TYPES.join('／')}
- total は合計金額（税込）の数字だけ。返金・取消のときも金額は正の数で書き、doc_type を「返金・取消」にする。currency は通貨（JPY、USD など3文字）。
- ポイントで払った分は points_used、それ以外（カード・PayPay残高・銀行など）で払った分は other_paid。分からなければ null。
- invoice_no は適格請求書発行事業者の登録番号（T＋13桁）。書いていなければ null。
- items には、注文した品を1つずつ全部書く（まとめない）。price はその品の金額（数量分の合計。書いてあるとおり）。送料・手数料も1行として書く。
- business_use は、上の「この人の事業」に照らして品ごとに判断する（同じ注文に事業の品と生活の品が混ざることがある）。
- 書いていないことは推測せず null にする。

# 分類（category はこの中から1つ）
${CATEGORIES.join('／')}

# 出力形式（JSONのみ）
{
  "is_receipt": true または false,
  "reason": "対象外の理由（is_receipt が false のときだけ。短く）",
  "doc_type": "書類の種類",
  "store": "取引先（お店・サービス名）",
  "date": "YYYY/MM/DD（取引日＝注文日・決済日・請求日。なければ null）",
  "total": 数字 または null,
  "currency": "JPY など",
  "order_no": "注文番号・領収書番号・請求書番号（なければ null）",
  "invoice_no": "T1234567890123 または null",
  "payment_method": "支払い方法（例：PayPayポイント＋クレジットカード）",
  "points_used": 数字 または null,
  "other_paid": 数字 または null,
  "memo": "補足（任意）",
  "items": [
    { "name": "品名（具体的に）", "price": 数字 または null, "category": "分類", "business_use": "事業で使いそう／個人っぽい／どちらとも言えない" }
  ]
}

# メール
受信日時：${Utilities.formatDate(msg.date, TZ, 'yyyy/MM/dd HH:mm')}
差出人：${msg.from}
件名：${msg.subject}
添付ファイル：${att}
本文：
${body}
`;
}

// ===== 20_paper.js =====
// ==========================================
// 紙の領収書（写真・スキャン）・ダウンロードしたPDF・LINEで届いたファイルを取り込む
//   経理フォルダの「スキャン受付」に入ったファイルを Gemini で読み取り、
//   名前をつけて取引日の年・月のフォルダへ移し、その年の台帳に記録する。
//   1枚の写真に複数のレシートが写っていれば、レシートごとに台帳の行を分ける（写真は1枚のまま保存）。
//   ※ 紙の原本は捨てずに保管してください（スキャナ保存の要件を満たすまでは）。
// ==========================================

const PAPER_TYPES = ['image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp', 'application/pdf'];
const PAPER_MAX_BYTES = 15 * 1024 * 1024;   // これより大きいファイルはGeminiに送れないので「読めなかった」へ
const LINE_FILE_PREFIX = 'LINE_';           // LINEで届いたファイルの名前の頭（30_line.js で付ける）

function processPaperReceipts_(ctx, timeUp) {
  const inbox = getSubFolder_(rootFolder_(), INBOX_NAME);
  const files = [];
  const it = inbox.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (PAPER_TYPES.indexOf(f.getMimeType()) >= 0) files.push(f);
  }
  files.sort((a, b) => a.getDateCreated() - b.getDateCreated());
  let saved = 0, unreadable = 0, attempted = 0, failed = 0;
  const toUnreadable = (f, fromLine) => {
    f.moveTo(getSubFolder_(inbox, UNREADABLE_NAME));
    unreadable++;
    if (fromLine) ctx.lineResults.push('読み取れない写真がありました。明るい場所で、レシート全体が写るように撮り直してください。');
  };
  for (const f of files) {
    if (timeUp() || ctx.hardStop()) break;
    attempted++;
    const key = 'paper:' + f.getId();
    const fromLine = f.getName().indexOf(LINE_FILE_PREFIX) === 0;
    try {
      // 前回、台帳には書けたが移動に失敗していたファイル：台帳に書き直さず、移動だけやり直す
      const already = findRowByFileUrl_(f.getUrl());
      if (already) {
        f.moveTo(monthFolder_(already.y, already.date));
        clearFail_(ctx, key);
        continue;
      }
      const bytes = f.getBlob().getBytes();
      if (bytes.length > PAPER_MAX_BYTES) { toUnreadable(f, fromLine); continue; }
      const res = fetchGeminiAll_([geminiRequest_([
        { text: buildPaperPrompt_() },
        { inline_data: { mime_type: f.getMimeType(), data: Utilities.base64Encode(bytes) } }
      ])])[0];
      const list = splitPaperResponse_(readGeminiResponse_(res));   // 1枚の写真に複数のレシートがあれば、1枚ずつに分ける
      if (list === null) {   // 通信エラーなど。5回続いたら「読めなかった」へ
        if (countFail_(ctx, key)) toUnreadable(f, fromLine); else failed++;
        continue;
      }
      clearFail_(ctx, key);
      const ok = list.filter(info => info.is_receipt && numOrBlank_(info.total) !== '');
      const ng = list.length - ok.length;
      if (ok.length === 0) { toUnreadable(f, fromLine); continue; }

      const created = f.getDateCreated();
      const fallbackDate = Utilities.formatDate(created, TZ, 'yyyy/MM/dd');
      const isPdf = f.getMimeType() === 'application/pdf';
      const source = fromLine ? (isPdf ? 'LINE（PDF）' : 'LINE（写真）') : (isPdf ? 'ダウンロード（PDF）' : '紙（スキャン）');
      const placed = ok.map(info => ({ info: info, date: info.date || fallbackDate, where: chooseYear_(info.date || fallbackDate, created) }))
        .sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
      // ファイルは、いちばん古い日付の年・月のフォルダに入れる
      const first = placed[0];
      const folder = monthFolder_(first.where.y, Number(first.date.slice(0, 4)) === first.where.y.year ? first.date : fallbackDate);
      const ext = (f.getName().match(/\.[A-Za-z0-9]+$/) || ['.' + f.getMimeType().split('/')[1]])[0].toLowerCase();
      const base = placed.length === 1
        ? safeName_(`${first.date.replace(/\//g, '')}_${first.info.store || '取引先不明'}_${amountLabel_(first.info)}${isPdf ? '' : '_紙'}`)
        : safeName_(`${first.date.replace(/\//g, '')}_複数${isPdf ? '書類' : 'レシート'}${placed.length}枚${isPdf ? '' : '_紙'}`);
      const fakeMsg = { subject: isPdf ? '（ダウンロードした書類）' : '（紙の領収書）', from: '', date: created, messageId: '', id: '' };

      // 先に台帳へ書き、そのあとで名前を変えて移動する（途中で止まっても、ファイルは受付に残り、移動だけやり直される）
      // 1枚の写真の行は、台帳ごとに1回でまとめて書く（途中で止まって一部の行だけが残らないように）
      const byYear = {};
      placed.forEach((p, n) => {
        const ledger = ledgerOf_(p.where.y);
        const notes = [p.where.note];
        if (findSamePaper_(ledger, p.date, p.info.store, numOrBlank_(p.info.total))) notes.push('同じ日付・取引先・金額の記録がすでにあります（二重に入れていないか確認）');
        if (ng > 0) notes.push(`この${isPdf ? 'ファイル' : '写真'}には読み取れなかった${isPdf ? '書類' : 'レシート'}が${ng}枚あります（手で確認してください）`);
        const row = buildLedgerRow_(p.info, fakeMsg, { main: f.getUrl(), attachments: [], date: p.date, eml: '', note: '' }, source, notes.filter(s => s).join('／'));
        if (placed.length > 1) row[COL('メモ') - 1] = safeCell_(`写真の中の${n + 1}枚目／全${placed.length}枚` + (p.info.memo ? '　' + p.info.memo : ''));
        (byYear[p.where.y.year] = byYear[p.where.y.year] || { ledger: ledger, rows: [] }).rows.push(row);
        const bizAmount = row[COL('事業の品の金額') - 1];
        if (fromLine) ctx.lineResults.push(`${p.date.slice(5)} ${p.info.store || '取引先不明'} ${amountLabel_(p.info)}` + (bizAmount !== '' ? `（うち事業の品 ${bizAmount}円）` : ''));
      });
      Object.keys(byYear).forEach(k => {
        const b = byYear[k];
        b.ledger.getRange(b.ledger.getLastRow() + 1, 1, b.rows.length, LEDGER_HEADERS.length).setValues(b.rows);
      });
      if (fromLine && ng > 0) ctx.lineResults.push(`（同じ写真の中に、読み取れなかったレシートが${ng}枚あります）`);
      f.setName(uniqueName_(folder, base + ext));
      f.moveTo(folder);
      saved += placed.length;
    } catch (e) {
      console.error('紙・PDFの取り込みエラー：' + e.message);
      if (countFail_(ctx, key)) { try { toUnreadable(f, fromLine); } catch (e2) { /* 続ける */ } } else failed++;
    }
  }
  return { saved: saved, unreadable: unreadable, left: files.length - attempted, failed: failed };
}

// 読み取り結果を、1枚ずつの配列にする。{receipts:[...]} でも、1枚分の形でも受け付ける。読めない返事は null
function splitPaperResponse_(raw) {
  if (!raw || typeof raw !== 'object') return null;
  if (Array.isArray(raw.receipts)) {
    const list = raw.receipts.map(r => validateInfo_(r)).filter(v => v !== null);
    if (list.length === 0) return raw.receipts.length === 0 ? [{ is_receipt: false, total: '', items: [] }] : null;
    return list;
  }
  const one = validateInfo_(raw);
  return one === null ? null : [one];
}

// 台帳から、このファイルを記録した行を探す（{ y, date } か null）。締めた年も探す（移動だけ失敗していた場合に、二重に記録しないため）
function findRowByFileUrl_(url) {
  for (const year of yearRows_().map(r => r.year)) {
    const y = getYear_(year, false);
    const ledger = y.ss.getSheetByName(SHEET_LEDGER);
    if (!ledger || ledger.getLastRow() < 2) continue;
    const vals = ledger.getRange(2, 1, ledger.getLastRow() - 1, COL('保存ファイル')).getValues();
    const r = vals.find(v => v[COL('保存ファイル') - 1] === url);
    if (r) {
      const d = cellDate_(r[0]);
      return { y: y, date: Number(d.slice(0, 4)) === year ? d : `${year}/12/31` };
    }
  }
  return null;
}

function findSamePaper_(ledger, dateStr, store, total) {
  const last = ledger.getLastRow();
  if (last < 2) return false;
  return ledger.getRange(2, 1, last - 1, 3).getValues()
    .some(r => cellDate_(r[0]) === dateStr && String(r[1]).replace(/^'/, '') === String(store || '') && Number(r[2]) === Number(total));
}

function buildPaperPrompt_() {
  return `
あなたは個人事業主の確定申告の下準備を手伝う経理担当です。添付の画像またはPDFは、紙のレシート・領収書を撮影したもの、またはサイトからダウンロードした取引書類（領収書・請求書・見積書・契約書など）です。内容を読み取ってください。

# この人の事業
${businessProfile_()}

# 1枚に複数のレシートが写っている場合
- 写真には、複数のレシートが並べて写っていることがあります。レシート（書類）を1枚ずつ見分けて、receipts の配列に1枚ずつ入れてください。
- 写っている順番（左上から右へ、上から下へ）に並べてください。
- 1枚しか写っていなければ、receipts には1件だけ入れます。
- 1枚のレシートの合計を、別のレシートと混ぜたり、足し合わせたりしないでください。

# ルール（レシート1枚ごと）
- 取引書類（領収書・レシート・請求書（支払い前も含む）・見積書・契約書・返金の書類）なら is_receipt を true にする。
- 取引書類でない、または文字が読めない場合は is_receipt を false にし、reason に理由を書く。
- doc_type は次のどれか：${DOC_TYPES.join('／')}
- total は合計金額（税込）の数字だけ。currency は通貨（JPY など3文字）。
- date は取引日（YYYY/MM/DD）。領収書は支払日、請求書は請求日。和暦なら西暦に直す。
- invoice_no は適格請求書発行事業者の登録番号（T＋13桁）。書いていなければ null。
- items には、レシートに印字された品を1行ずつ全部書く（まとめない・省略しない）。price はその行の金額（数量分の合計。印字されているとおり）。値引きの行は、マイナスの金額で1行として書く。
- business_use は、上の「この人の事業」に照らして品ごとに判断する（スーパーなどでは、仕事の品と生活の品が1枚に混ざることがある）。
- 印字がかすれて読めない文字・数字は、推測で埋めずに null にする。
- 支払い方法（現金・カード・電子マネーなど）が書いてあれば payment_method に書く。
- 書いていないこと・読めないことは推測せず null にする。

# 分類（category はこの中から1つ）
${CATEGORIES.join('／')}

# 出力形式（JSONのみ）
{
  "receipts": [
    {
      "is_receipt": true または false,
      "reason": "読めなかった理由（is_receipt が false のときだけ）",
      "doc_type": "書類の種類",
      "store": "取引先（お店・会社の名前）",
      "date": "YYYY/MM/DD",
      "total": 数字 または null,
      "currency": "JPY",
      "order_no": "レシート番号・領収書番号・請求書番号（なければ null）",
      "invoice_no": "T1234567890123 または null",
      "payment_method": "支払い方法",
      "points_used": 数字 または null,
      "other_paid": 数字 または null,
      "memo": "但し書き（「お品代として」「広告費として」など）があれば",
      "items": [
        { "name": "品名", "price": 数字 または null, "category": "分類", "business_use": "事業で使いそう／個人っぽい／どちらとも言えない" }
      ]
    }
  ]
}
`;
}

// ===== 30_line.js =====
// ==========================================
// 公式LINEの受付（ウェブアプリとして公開し、LINEの Webhook URL に設定する）
//   ・登録した人が送った写真・PDFを「スキャン受付」フォルダに保存し、1分後に読み取る
//   ・最初に「設定」タブの連携コードを送った人だけを登録する（それ以外の人のメッセージは保存しない）
//   ※ GASではLINEの署名（x-line-signature）を確かめられないため、次の3つで守る
//     1. Webhook URL の末尾に秘密の合言葉（?k=…、スクリプトプロパティ WEBHOOK_KEY）を付け、合わないものは無視する
//     2. 登録した人のIDからのメッセージだけを受け付ける
//     3. 連携コードの間違いは、全員合わせて1時間に10回まで（総当たり対策）
//   ※ ここ（doPost）は短く保つ。読み取りは自動実行（最新のコードで動く）で行うので、
//     コードを更新しても、ウェブアプリを公開し直す必要はほとんどない
// ==========================================

const LINE_API = 'https://api.line.me/v2/bot/message';
const LINE_DATA_API = 'https://api-data.line.me/v2/bot/message';
const LINE_HANDLER = 'LINEの写真を読み取る';
const LINE_MAX_CODE_TRIES = 10;             // 連携コードの間違い：全員合わせて1時間にこの回数まで
const LINE_MAX_EVENTS = 20;                 // 1回の通知で受け付けるイベントの数
const LINE_FILE_EXT = /\.(pdf|jpe?g|png|heic|heif|webp)$/i;
const LINE_MIME = { '.pdf': 'application/pdf', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.heic': 'image/heic', '.heif': 'image/heif', '.webp': 'image/webp' };

function doPost(e) {
  try {
    const key = PROPS.getProperty('WEBHOOK_KEY');
    if (!key || !e || !e.parameter || e.parameter.k !== key) return ContentService.createTextOutput('OK');   // 合言葉が違う：何もしない
    const body = JSON.parse((e.postData && e.postData.contents) || '{}');
    (body.events || []).slice(0, LINE_MAX_EVENTS).forEach(ev => {
      try { handleLineEvent_(ev); } catch (err) { console.error('LINEの受付エラー：' + err.message); }
    });
  } catch (err) {
    console.error('LINEの受付エラー：' + err.message);
  }
  return ContentService.createTextOutput('OK');
}

function doGet() {
  return ContentService.createTextOutput('OK');
}

function handleLineEvent_(ev) {
  const userId = ev.source && ev.source.userId;
  if (!userId) return;
  if (ev.type === 'follow') {
    lineReply_(ev.replyToken, '友だち追加ありがとうございます。\nはじめに、お手元の「連携コード」（6桁の数字）を送ってください。');
    return;
  }
  if (ev.type !== 'message') return;
  const m = ev.message || {};

  if (lineMembers_().indexOf(userId) < 0) {
    registerLineUser_(ev, userId, m);
    return;
  }

  if (m.type === 'image' || (m.type === 'file' && LINE_FILE_EXT.test(m.fileName || ''))) {
    // LINEは同じメッセージを送り直すことがある：6時間以内に受け取ったものは保存しない
    const cache = CacheService.getScriptCache();
    if (cache.get('LINE_MSG_' + m.id)) return;
    saveLineContent_(m);
    cache.put('LINE_MSG_' + m.id, '1', 6 * 3600);
    lineReply_(ev.replyToken, setting_('LINEで結果を知らせる') === 'いいえ'
      ? '受け取りました。数分で読み取って、帳簿に記録します。'
      : '受け取りました。数分で読み取って、結果をお知らせします。');
    // 写真をまとめて送られても、読み取りの予約は1つだけにする（自動実行の数には上限がある）
    if (!cache.get('LINE_SCHEDULED') && !hasSchedule_(LINE_HANDLER)) {
      cache.put('LINE_SCHEDULED', '1', 90);
      ScriptApp.newTrigger(LINE_HANDLER).timeBased().after(60 * 1000).create();
    }
  } else if (m.type === 'file') {
    lineReply_(ev.replyToken, 'このファイルは読み取れません。レシートの写真か、領収書・請求書のPDFを送ってください。');
  } else if (m.type === 'text') {
    lineReply_(ev.replyToken, '使い方\n・レシートや領収書の写真、PDFを送ると、読み取って帳簿に記録します。\n・1枚の写真に、何枚かのレシートを並べて撮ってもかまいません。\n・紙のレシートは、念のため捨てずに保管してください。');
  }
}

// 登録していない人：連携コードが合っていれば登録する
function registerLineUser_(ev, userId, m) {
  const cache = CacheService.getScriptCache();
  const tries = Number(cache.get('LINE_CODE_TRIES') || 0);
  if (tries >= LINE_MAX_CODE_TRIES) {
    lineReply_(ev.replyToken, 'ただいま登録を受け付けていません。時間をおいて、もう一度お試しください。');
    return;
  }
  const code = setting_('LINE連携コード');
  const text = m.type === 'text' ? String(m.text || '').normalize('NFKC').replace(/\s/g, '') : '';
  if (code && text === code) {
    setSetting_('LINEの登録者', lineMembers_().concat([userId]).join(','));
    lineReply_(ev.replyToken, '登録しました。レシートや領収書の写真、PDFを送ってください。');
    return;
  }
  if (text) cache.put('LINE_CODE_TRIES', String(tries + 1), 3600);
  lineReply_(ev.replyToken, 'まだ登録されていません。お手元の「連携コード」（6桁の数字）を送ってください。');
}

function lineMembers_() {
  return setting_('LINEの登録者').split(',').map(s => s.trim()).filter(s => s);
}

// LINEに届いた写真・ファイルを「スキャン受付」に保存する
function saveLineContent_(m) {
  const res = UrlFetchApp.fetch(`${LINE_DATA_API}/${m.id}/content`, { headers: { Authorization: 'Bearer ' + lineToken_() }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error(`LINEからファイルを取れませんでした (Code: ${res.getResponseCode()})`);
  const blob = res.getBlob();
  // 種類は拡張子から決める（ファイルで送られると、LINEは種類を「不明」で返すため。違うと読み取りの対象にならない）
  let ext = (String(m.fileName || '').match(LINE_FILE_EXT) || [''])[0].toLowerCase();
  if (!ext) ext = Object.keys(LINE_MIME).find(k => LINE_MIME[k] === blob.getContentType()) || '.jpg';
  blob.setContentType(LINE_MIME[ext]);
  const name = `${LINE_FILE_PREFIX}${Utilities.formatDate(new Date(), TZ, 'yyyyMMdd_HHmmss')}_${m.id}${ext}`;
  getSubFolder_(rootFolder_(), INBOX_NAME).createFile(blob.setName(name));
}

// LINEで届いたファイルを読み取る（doPost から1分後に予約される）
function LINEの写真を読み取る() {
  cancelSchedule_(LINE_HANDLER);
  withLock_(LINE_HANDLER, () => {   // メール集めなどが動いていたら、2分後にもう一度
    const started = Date.now();
    DEADLINE = started + LIMIT_MS;
    const ctx = { fails: loadFails_(), hardStop: () => Date.now() - started > HARD_STOP_MS, lineResults: [] };
    const r = processPaperReceipts_(ctx, () => Date.now() - started > STOP_AFTER_MS);
    notifyLineResults_(ctx.lineResults);
    if (r.left > 0) scheduleOnce_(LINE_HANDLER, 60 * 1000);
    else if (r.failed > 0) scheduleOnce_(LINE_HANDLER, RETRY_AFTER_MS);   // 同じファイルは5回失敗したら「読めなかった」へ移るので、無限には続かない
  });
}

// 読み取りの結果をLINEで知らせる（プッシュメッセージは無料プランだと月200通まで。1回の実行で1通にまとめる）
function notifyLineResults_(lines) {
  if (!lines || lines.length === 0) return;
  if (setting_('LINEで結果を知らせる') === 'いいえ' || !lineToken_()) return;
  const text = ('読み取りました\n' + lines.join('\n') + '\n\n帳簿の「経費仕分け」で確認できます。').slice(0, 4500);
  lineMembers_().forEach(to => linePost_(`${LINE_API}/push`, { to: to, messages: [{ type: 'text', text: text }] }));
}

function lineReply_(replyToken, text) {
  if (!replyToken) return;
  linePost_(`${LINE_API}/reply`, { replyToken: replyToken, messages: [{ type: 'text', text: text }] });
}

function linePost_(url, payload) {
  if (!lineToken_()) { console.error('公式LINEの鍵が設定されていないため、LINEに送れません'); return; }
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    headers: { Authorization: 'Bearer ' + lineToken_() }, payload: JSON.stringify(payload)
  });
  if (res.getResponseCode() !== 200) console.error(`LINEへの送信エラー (Code: ${res.getResponseCode()})`);
}

// ===== 40_card.js =====
// ==========================================
// カード突き合わせ
//  1. 経理フォルダの「カード明細受付」に入れたカード明細を読み込み、利用日の年の帳簿の「カード明細」タブにためる（重複は入れない）
//     - アメックス・楽天カードのCSVはそのまま読む。それ以外のCSV・PDF・明細の写真やスクショは Gemini が読み取る
//  2. カード明細1件ごとに、その年の「領収書台帳」から領収書を探して、「カード突き合わせ」タブに結果を書く
//     - 円の支払い：金額が同じで、日付が近い（前後10日）領収書
//     - 外貨の支払い：日付が近く（前後4日）、お店の名前が似ている領収書
//     - ETC・カードの年会費：もともと領収書が出ないので「カード明細で代用」とし、台帳にも記録する
//  3. 台帳にあるのにカード明細に見つからない領収書（現金・PayPay・振込などで払ったもの）も一覧にする
//  4. 続けて「経費仕分け」を行う（50_shiwake.js）
// ==========================================

const SHEET_CARD = 'カード明細';
const SHEET_MATCH = 'カード突き合わせ';
const CARD_BAD_NAME = UNREADABLE_NAME;
const CARD_HEADERS = ['カード', '利用日', '内容', '金額（円）', '会員番号', '取込ファイル', '取込日時', 'キー'];
const JPY_DAYS = 10;          // 円の支払い：前後この日数以内の領収書を探す
const FX_DAYS = 4;            // 外貨の支払い：前後この日数以内で、名前が似ている領収書を探す
const CARD_FILE_TYPES = ['text/csv', 'text/plain', 'application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/heif', 'image/webp',
  'application/vnd.ms-excel', 'application/vnd.google-apps.spreadsheet'];
// 領収書が出ないもの（カード明細が記録の代わりになる）
const NO_RECEIPT_RULES = [
  { re: /(^|[^A-Za-z])ETC([^A-Za-z]|$)|ＥＴＣ|高速道路|NEXCO|ネクスコ|首都高|阪神高速|名古屋高速|有料道路/i, label: 'ETC（カード明細で代用）', memo: '通行ごとの領収書は出ません。カード明細（必要ならETC利用照会サービスの利用証明書）が記録になります', item: '高速道路の通行料（ETC）', category: '交通・宿泊' },
  { re: /年会費/, label: '年会費（カード明細で代用）', memo: 'カードの年会費は、カード明細が記録になります', item: 'クレジットカードの年会費', category: 'その他' }
];
const CARD_LEDGER_SOURCE = 'カード明細';             // 台帳の「入手経路」に書く言葉
const CARD_LEDGER_DOCTYPE = 'カード明細（領収書なし）';  // 台帳の「書類の種類」に書く言葉


// ==========================================
// メイン
// ==========================================
function カード明細を取り込んで突き合わせる() {
  // 帳簿に書くので、メール集め・LINEの読み取りと同じ鍵を使う（取れなければ2分後に「経費仕分けの続き」で再開）
  return withLock_(SHIWAKE_CONTINUE_HANDLER, cardMain_);
}

function cardMain_() {
  DEADLINE = Date.now() + 5 * 60 * 1000;
  const imported = importCardFiles_();
  if (imported.left > 0) {
    // 明細ファイルが多くて時間内に読み切れなかった：突き合わせは全部読んでから行う
    console.log(`カード明細のファイルが${imported.left}件残っています。1分後に続きを読みます。`);
    scheduleOnce_(SHIWAKE_CONTINUE_HANDLER, SHIWAKE_CONTINUE_MS);
    return { imported: imported, years: 0 };
  }
  if (imported.files > 0) console.log(`カード明細を${imported.files}ファイル読み込み、新しく${imported.rows}件を追加しました。`);
  if (imported.bad > 0) console.log(`読み取れなかったファイルが${imported.bad}件あります（「カード明細受付」の「読めなかった」フォルダを見てください）。`);
  if (imported.retry > 0) console.log(`読み取りに失敗したファイルが${imported.retry}件あります。次回もう一度読みます。`);
  if (imported.closed > 0) console.log(`締めた年・取り込み開始日より前・日付がおかしい利用${imported.closed}件は取り込みませんでした。`);

  const jobs = [];
  openYears_().forEach(year => {
    const y = getYear_(year, false);
    const r = buildMatchSheet_(y);
    console.log(`${year}年の突き合わせ：カード明細${r.total}件のうち、領収書あり ${r.found}件／カード明細で代用 ${r.noReceipt}件／見つからない ${r.missing}件（${r.missingYen.toLocaleString()}円）。カード以外で払った領収書 ${r.nonCard}件。`);
    jobs.push({ y: y, items: r.items });
  });
  updateShiwakeAll_(jobs);   // 経費仕分け（AIの判定）も続けて行う
  return { imported: imported, years: jobs.length };
}


// ==========================================
// 1. 明細ファイルを読み込む
// ==========================================
function importCardFiles_() {
  const inbox = getSubFolder_(rootFolder_(), CARD_INBOX_NAME);
  const doneFolder = getSubFolder_(inbox, CARD_DONE_NAME);
  const files = [];
  const it = inbox.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    if (CARD_FILE_TYPES.indexOf(f.getMimeType()) >= 0 || /\.(csv|pdf)$/i.test(f.getName())) files.push(f);
  }
  const startYear = Number(startDate_().slice(0, 4));
  const thisYear = Number(Utilities.formatDate(new Date(), TZ, 'yyyy'));
  const names = loadCardNames_();
  const ctx = { fails: loadFails_() };
  const have = {};   // 年ごと：すでにあるキーの件数（同じ日に同じ店で同じ金額の買い物が2回あっても、正しく2件として数える）
  const haveOf = y => {
    if (!have[y.year]) {
      have[y.year] = {};
      cardRows_(cardSheet_(y)).forEach(r => { have[y.year][r.key] = (have[y.year][r.key] || 0) + 1; });
    }
    return have[y.year];
  };
  let added = 0, bad = 0, retry = 0, read = 0, closed = 0, left = 0;
  files.forEach(f => {
    if (Date.now() > DEADLINE - 2 * 60 * 1000) { left++; return; }   // 残りは次の実行で（仕分けの時間を残す）
    const key = 'card:' + f.getId();
    let rows;
    try {
      rows = readStatementFile_(f, names);
    } catch (e) {
      console.error('カード明細の読み取りエラー：' + e.message);
      rows = null;
    }
    if (rows === null) {   // 一時的な失敗（Geminiの混雑など）：5回続いたら「読めなかった」へ
      if (countFail_(ctx, key)) { f.moveTo(getSubFolder_(inbox, CARD_BAD_NAME)); bad++; } else retry++;
      return;
    }
    clearFail_(ctx, key);
    if (rows.length === 0) { f.moveTo(getSubFolder_(inbox, CARD_BAD_NAME)); bad++; return; }
    const now = Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm');
    const inFile = {};
    const out = {};   // 年ごとに分ける
    rows.forEach(r => {
      const yr = Number(r.date.slice(0, 4));
      const known = getYear_(yr, false);
      // 取り込み開始日より前・締めた年・来年より先（読み間違い）の利用は入れない
      if (yr < startYear || yr > thisYear + 1 || (known && known.closed)) { closed++; return; }
      const y = known || getYear_(yr, true);
      const h = haveOf(y);
      const fk = yr + '|' + r.key;
      inFile[fk] = (inFile[fk] || 0) + 1;
      if (inFile[fk] > (h[r.key] || 0)) {   // このファイルの中で、すでに入っている件数を超えた分だけ追加
        (out[yr] = out[yr] || { y: y, rows: [] }).rows.push([r.card, r.date, safeCell_(r.desc), r.amount, r.member || '', f.getName(), now, r.key]);
        h[r.key] = (h[r.key] || 0) + 1;
      }
    });
    Object.keys(out).forEach(yr => {
      const sh = cardSheet_(out[yr].y);
      sh.getRange(sh.getLastRow() + 1, 1, out[yr].rows.length, CARD_HEADERS.length).setValues(out[yr].rows);
      added += out[yr].rows.length;
    });
    read++;
    f.moveTo(doneFolder);
  });
  return { files: read, rows: added, bad: bad, retry: retry, closed: closed, left: left };
}

function cardSheet_(y) {
  const sh = getOrCreateSheet_(y.ss, SHEET_CARD);
  if (sh.getLastRow() === 0) {
    sh.appendRow(CARD_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, CARD_HEADERS.length).setFontWeight('bold').setBackground('#DDEBF7');
  }
  return sh;
}

// 管理シートの「カード名」タブ：アメックスの会員番号の末尾 → カードの名前
function loadCardNames_() {
  const sh = manage_().getSheetByName(SH_CARDS);
  const map = {};
  if (sh && sh.getLastRow() >= 2) {
    sh.getRange(2, 1, sh.getLastRow() - 1, 2).getDisplayValues().forEach(r => {
      const k = String(r[0]).replace(/[^0-9]/g, '');
      if (k && r[1]) map[k] = String(r[1]).trim();
    });
  }
  return map;
}

function cardNameFor_(member, names) {
  const keys = Object.keys(names).filter(k => member.slice(-k.length) === k).sort((a, b) => b.length - a.length);
  return keys.length > 0 ? names[keys[0]] : '';
}

// 1つのファイルを読んで、利用1件ずつの配列にする（null＝一時的な失敗、[]＝明細ではない）
function readStatementFile_(f, names) {
  const mime = f.getMimeType();
  const name = f.getName();
  if (mime === 'application/vnd.google-apps.spreadsheet') {
    // CSVがGoogleスプレッドシートに変換されてしまった場合
    const values = SpreadsheetApp.openById(f.getId()).getSheets()[0].getDataRange().getDisplayValues();
    return readCsvRows_(values, name, names, () => values.map(r => r.join(',')).join('\n'));
  }
  if (mime === 'text/csv' || mime === 'text/plain' || mime === 'application/vnd.ms-excel' || /\.csv$/i.test(name)) {
    const text = decodeCsvText_(f.getBlob());
    return readCsvRows_(Utilities.parseCsv(text), name, names, () => text);
  }
  // PDF・写真：Geminiで読み取る
  const bytes = f.getBlob().getBytes();
  if (bytes.length > PAPER_MAX_BYTES) return [];
  return askGeminiStatement_([{ inline_data: { mime_type: mime === 'application/octet-stream' ? 'application/pdf' : mime, data: Utilities.base64Encode(bytes) } }], name);
}

// CSVの文字コード（Shift_JIS か UTF-8）を見分けて読む
function decodeCsvText_(blob) {
  const sj = blob.getDataAsString('Shift_JIS');
  const u8 = blob.getDataAsString('UTF-8').replace(/^﻿/, '');
  const score = s => (s.match(/利用|日付|金額|店名|内容|明細|カード/g) || []).length - (s.match(/�/g) || []).length * 5;
  return score(u8) >= score(sj) ? u8 : sj;
}

// CSVの表を読む。アメックス・楽天はそのまま、見出しが分かるものはそのまま、分からないものは Gemini に読ませる
function readCsvRows_(rows, fileName, names, textFn) {
  rows = rows.map(r => r.map(c => String(c === null || c === undefined ? '' : c).trim()));
  // CSVの上のほうに「ご利用カード,イオンカード」のようなカード名が書いてあれば使う
  let cardInFile = '';
  rows.slice(0, 25).forEach(r => {
    const k = r.findIndex(x => /^(ご利用カード|カード名|カード種類|カード)$/.test(x));
    if (!cardInFile && k >= 0 && r[k + 1]) cardInFile = r[k + 1];
  });
  // 見出しの行を探す（最初の数行に説明が入っているCSVもある）
  for (let h = 0; h < Math.min(rows.length, 25); h++) {
    const head = rows[h];
    const find = re => head.findIndex(x => re.test(x));
    const iDate = find(/^(ご)?利用日|^日付|^取引日|^利用年月日/);
    const iDesc = find(/利用店名|ご利用先|ご利用内容|利用先|ご利用店|加盟店|^内容|^摘要|^店名/);
    let iAmt = find(/^(ご)?利用金額|^金額|^ご利用金額/);
    if (iAmt < 0) iAmt = find(/支払金額|お支払金額|請求額|支払総額/);
    if (iDate < 0 || iDesc < 0 || iAmt < 0) continue;
    const iMem = find(/^会員番号/);
    const isAmex = head.indexOf('ご利用内容') >= 0 && head.indexOf('金額') >= 0 && head.indexOf('ご利用日') >= 0;
    const isRakuten = head.some(x => /利用店名・商品名/.test(x));
    const out = [];
    rows.slice(h + 1).forEach(r => {
      const date = cardDate_(r[iDate]);
      if (!date) return;
      const desc = String(r[iDesc] || '').replace(/\s+/g, ' ').trim();
      if (isPaymentLine_(desc)) return;
      const amount = Number(String(r[iAmt] || '').replace(/[,\s"円¥￥]/g, ''));
      if (!isFinite(amount) || amount === 0) return;
      const member = iMem >= 0 ? String(r[iMem] || '').replace(/[^0-9]/g, '') : '';
      let card;
      if (isAmex) card = (member && cardNameFor_(member, names)) || (member ? `アメックス（${member.slice(-5)}）` : guessCardName_(fileName, 'アメックス'));
      else if (isRakuten) card = '楽天カード';
      else if (cardInFile) card = cardInFile;
      else card = guessCardName_(fileName, 'カード（' + fileName.replace(/\.[^.]+$/, '') + '）');
      out.push(cardRow_(card, date, desc, amount, member));
    });
    if (out.length > 0) return out;
    break;   // 見出しはあったのに1件も読めなかった：Geminiに読ませ直す
  }
  // 見出しが分からないCSV：Geminiに表を読ませる
  return askGeminiStatement_([{ text: '【明細のCSV】\n' + String(textFn()).slice(0, 60000) }], fileName);
}

// カード明細の日付を「YYYY/MM/DD」にする。「2026/07/18」のほか「260718」「20260718」「26/07/18」も読む
function cardDate_(v) {
  const s = String(v || '').normalize('NFKC').trim();
  const d = normalizeDate_(s);
  if (d) return d;
  let m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return normalizeDate_(`${m[1]}/${m[2]}/${m[3]}`);
  m = s.match(/^(\d{2})(\d{2})(\d{2})$/);
  if (m) return normalizeDate_(`20${m[1]}/${m[2]}/${m[3]}`);
  m = s.match(/^(\d{2})[\/.\-](\d{1,2})[\/.\-](\d{1,2})$/);
  if (m) return normalizeDate_(`20${m[1]}/${m[2]}/${m[3]}`);
  return '';
}

function cardRow_(card, date, desc, amount, member) {
  const normDesc = String(desc).normalize('NFKC').replace(/\s+/g, '');
  return { card: card, date: date, desc: desc, amount: amount, member: member || '', key: [card, date, normDesc, amount].join('|') };
}

// カード代金の引き落とし・入金・合計などの行（利用ではないもの）
function isPaymentLine_(desc) {
  return /口座振替|口座引落|お支払(い)?金額|ご入金|入金|お支払合計|今回のお支払|前回分/.test(desc);
}

function guessCardName_(fileName, fallback) {
  const n = String(fileName).normalize('NFKC').toLowerCase();
  if (/楽天|rakuten|enavi/.test(n)) return '楽天カード';
  if (/イオン|aeon/.test(n)) return 'イオンカード';
  if (/エポス|epos/.test(n)) return 'エポスカード';
  if (/アメックス|amex|american/.test(n)) return fallback.indexOf('アメックス') === 0 ? fallback : 'アメックス';
  return fallback;
}

// PDF・写真・見出しの分からないCSVを Gemini に読ませる
function askGeminiStatement_(parts, fileName) {
  const prompt = `
あなたは経理担当です。添付は、クレジットカード会社の「ご利用明細」（PDF・写真・CSVのどれか）です。カードの利用を1件ずつ抜き出してください。

# ルール
- 利用1件ごとに date（利用日 YYYY/MM/DD）、desc（ご利用先・お店の名前・内容。明細に書いてあるとおり）、amount（その利用の金額。円の数字だけ。返金・取消はマイナス）を書く。
- 年が省略されている場合（例「26 08 23」「08/23」）は、明細の作成日やお支払日の年から正しい年を補う。和暦は西暦に直す。
- 次の行は入れない：カード代金の引き落とし・口座振替、入金、今回のお支払合計、前回からの繰越、リボ・分割の残高の説明、ポイントの説明。
- 分割払いは、利用日・お店ごとに1件（分割の各回ではなく、利用した金額）として書く。分からなければ今回の支払額で書く。
- card_name には、カード会社とカードの種類（例：エポスカード、楽天カード、イオンカード）を書く。
- 書いていないことは推測しない。明細ではない場合は transactions を空にする。

# 出力形式（JSONのみ）
{ "card_name": "カードの名前", "transactions": [ { "date": "YYYY/MM/DD", "desc": "内容", "amount": 数字 } ] }
`;
  const res = fetchGeminiAll_([geminiRequest_([{ text: prompt }].concat(parts))])[0];
  const raw = readGeminiResponse_(res);
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.transactions)) return null;
  const cardName = String(raw.card_name || '').trim() || guessCardName_(fileName, 'カード（' + fileName.replace(/\.[^.]+$/, '') + '）');
  const out = [];
  raw.transactions.forEach(t => {
    if (!t || typeof t !== 'object') return;
    const date = normalizeDate_(t.date);
    const desc = String(t.desc || '').replace(/\s+/g, ' ').trim();
    const amount = typeof t.amount === 'number' ? t.amount : Number(String(t.amount || '').replace(/[,\s円¥￥]/g, ''));
    if (!date || !desc || !isFinite(amount) || amount === 0 || isPaymentLine_(desc)) return;
    out.push(cardRow_(cardName, date, desc, amount, ''));
  });
  return out;
}

function cardRows_(card) {
  const last = card.getLastRow();
  if (last < 2) return [];
  return card.getRange(2, 1, last - 1, CARD_HEADERS.length).getValues().map(r => ({
    card: String(r[0]), date: cellDate_(r[1]), desc: String(r[2]).replace(/^'/, ''), amount: Number(r[3]), file: String(r[5]), key: String(r[7])
  }));
}


// ==========================================
// 2. 突き合わせ（年ごと）
// ==========================================
function buildMatchSheet_(y) {
  const ss = y.ss;
  const cards = cardRows_(cardSheet_(y)).filter(c => c.date);
  const written = writeNoReceiptToLedger_(y, cards);
  if (written > 0) console.log(`ETC・年会費など、領収書が出ないもの${written}件を${y.year}年の「領収書台帳」に書き込みました（記録はカード明細）。`);
  const ledger = ledgerOf_(y);
  const last = ledger.getLastRow();
  const receipts = last < 2 ? [] : ledger.getRange(2, 1, last - 1, LEDGER_HEADERS.length).getValues().map((r, k) => ({
    row: k + 2,
    date: cellDate_(r[COL('取引日') - 1]),
    store: String(r[COL('取引先') - 1] || '').replace(/^'/, ''),
    amount: Number(r[COL('金額') - 1]),
    currency: String(r[COL('通貨') - 1] || 'JPY') || 'JPY',
    payment: String(r[COL('支払い方法') - 1] || ''),
    otherPaid: r[COL('ポイント以外の支払額') - 1],
    source: String(r[COL('入手経路') - 1] || ''),
    docType: String(r[COL('書類の種類') - 1] || ''),
    file: String(r[COL('保存ファイル') - 1] || ''),
    item: String(r[COL('品名') - 1] || '').replace(/^'/, ''),
    biz: String(r[COL('事業で使えそうか') - 1] || ''),
    breakdown: String(r[COL('内訳（品目・金額・区分）') - 1] || '').replace(/^'/, ''),
    bizAmount: numOrBlank_(r[COL('事業の品の金額') - 1]),
    msgId: String(r[COL('Message-ID') - 1] || ''),
    check: String(r[COL('チェック') - 1] || ''),
    memo: String(r[COL('メモ') - 1] || ''),
    used: false
  })).filter(x => x.date && x.source !== CARD_LEDGER_SOURCE);   // カード明細から書き込んだ行（ETCなど）は、領収書として数えない
  const rOcc = {};
  receipts.forEach(r => { const b = receiptBaseKey_(r); rOcc[b] = (rOcc[b] || 0) + 1; r.rkey = b + '#' + rOcc[b]; });

  const out = [];
  const items = [];    // 経費仕分けに渡すもの（支払い1件ずつ）
  const occ = {};
  let found = 0, missing = 0, missingYen = 0, noReceipt = 0;
  cards.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0).forEach(c => {
    let status, memo = '', m = null;
    const rule = NO_RECEIPT_RULES.find(x => x.re.test(c.desc));
    if (c.amount < 0) { status = '返金・取消'; memo = 'カード会社からの返金・取消（対応する購入の行と合わせて確認）'; }
    else if (rule) { status = rule.label; memo = rule.memo; noReceipt++; }   // ETC・年会費は、金額がたまたま同じ別の領収書と結びつけない
    else if ((m = findReceipt_(c, receipts))) { status = m.fx ? '領収書あり（外貨・名前で照合）' : '領収書あり'; m.r.used = true; found++; }
    else { status = '見つからない'; missing++; missingYen += c.amount; memo = '領収書のメール・写真が台帳にありません（経費なら、領収書をLINEで送るか「スキャン受付」に入れる）'; }
    out.push([c.card, c.date, safeCell_(c.desc), c.amount, status,
      m ? m.r.date : '', m ? safeCell_(m.r.store) : '', m ? m.r.amount : '', m ? m.r.currency : '', m ? m.r.docType : '', m ? m.r.file : '', memo]);
    occ[c.key] = (occ[c.key] || 0) + 1;
    items.push({ key: 'card:' + c.key + '#' + occ[c.key], date: c.date, store: c.desc, amount: c.amount, pay: c.card, receipt: status,
      file: m ? m.r.file : '', item: m ? (m.r.breakdown || m.r.item) : '', hint: m ? m.r.biz : '', receiptKey: m ? m.r.rkey : '',
      bizAmount: m ? m.r.bizAmount : '', receiptTotal: m ? m.r.amount : '' });
  });

  // 台帳にあるのに、カード明細に見つからない領収書（カード以外で払ったもの・取り込んでいないカードのもの）
  const nonCard = receipts.filter(r => !r.used && r.amount > 0 && r.docType !== '見積書' && r.docType !== '契約書');
  nonCard.forEach(r => {
    if (r.check.indexOf('同じ注文番号の記録がすでにあります') >= 0) return;   // 注文確認と領収書など、同じ支払いの2通目は仕分けに出さない
    const yen = r.currency === 'JPY';
    items.push({ key: r.rkey, date: r.date, store: r.store, amount: yen ? r.amount : '', pay: r.payment || 'カード以外',
      receipt: 'カード以外で支払い（領収書あり）' + (yen ? '' : '・' + r.currency + ' ' + r.amount), file: r.file, item: r.breakdown || r.item, hint: r.biz, receiptKey: '',
      bizAmount: yen ? r.bizAmount : '', receiptTotal: r.amount });
  });

  const sh = getOrCreateSheet_(ss, SHEET_MATCH);
  sh.clear();
  const summary = [
    [`カード突き合わせ（${Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm')} 更新）`, '', '', '', ''],
    [`カード明細（${y.year}年）`, cards.length + '件', '', '', ''],
    ['領収書あり', found + '件', '', '', ''],
    ['カード明細で代用（ETC・年会費）', noReceipt + '件', '', '', 'もともと領収書が出ないもの'],
    ['見つからない', missing + '件', missingYen, '円', '経費のものだけ、領収書を探してください'],
    ['カード以外で払った領収書', nonCard.length + '件', '', '', '現金・PayPay・振込・取り込んでいないカードなど（下の2つ目の表）'],
    ['', '', '', '', '']
  ];
  sh.getRange(1, 1, summary.length, 5).setValues(summary);
  sh.getRange(1, 1).setFontWeight('bold');
  const H1 = ['カード', '利用日', '内容', '金額（円）', '状態', '領収書の取引日', '領収書の取引先', '領収書の金額', '通貨', '書類の種類', '保存ファイル', 'メモ'];
  const start = summary.length + 1;
  sh.getRange(start, 1, 1, H1.length).setValues([H1]).setFontWeight('bold').setBackground('#DDEBF7');
  if (out.length > 0) {
    sh.getRange(start + 1, 1, out.length, H1.length).setValues(out);
    sh.getRange(start + 1, 5, out.length, 1).setBackgrounds(out.map(r =>
      [r[4] === '見つからない' ? '#FCEBEB' : r[4] === '返金・取消' ? '#FAEEDA' : /代用/.test(r[4]) ? '#E6F1FB' : '#EAF3DE']));
  }
  const start2 = start + out.length + 3;
  sh.getRange(start2 - 1, 1).setValue('■ 台帳にあるが、カード明細に見つからない領収書（カード以外で払った・取り込んでいないカードなど）').setFontWeight('bold');
  const H2 = ['取引日', '取引先', '金額', '通貨', '支払い方法', '入手経路', '書類の種類', '保存ファイル'];
  sh.getRange(start2, 1, 1, H2.length).setValues([H2]).setFontWeight('bold').setBackground('#DDEBF7');
  if (nonCard.length > 0) {
    sh.getRange(start2 + 1, 1, nonCard.length, H2.length).setValues(
      nonCard.map(r => [r.date, safeCell_(r.store), r.amount, r.currency, safeCell_(r.payment), r.source, r.docType, r.file]));
  }
  sh.setFrozenRows(start);
  return { total: cards.length, found: found, missing: missing, missingYen: missingYen, nonCard: nonCard.length, noReceipt: noReceipt, items: items };
}

// ETC・年会費など、領収書が出ないものを「領収書台帳」に書き込む（同じものは二度書かない）
function writeNoReceiptToLedger_(y, cards) {
  const ledger = ledgerOf_(y);
  const last = ledger.getLastRow();
  const have = {};
  if (last >= 2) ledger.getRange(2, COL('Message-ID'), last - 1, 1).getValues().forEach(r => { have[String(r[0])] = true; });
  let urls = null;
  const seen = {};
  const rows = [];
  cards.slice().sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0).forEach(c => {
    if (!(c.amount > 0)) return;
    const rule = NO_RECEIPT_RULES.find(x => x.re.test(c.desc));
    if (!rule) return;
    seen[c.key] = (seen[c.key] || 0) + 1;                 // 同じ日・同じ区間・同じ金額が2回あっても、別々に書く
    const id = 'card:' + c.key + '#' + seen[c.key];
    if (have[id]) return;
    if (!urls) urls = cardFileUrls_();
    const row = new Array(LEDGER_HEADERS.length).fill('');
    const set = (name, v) => { row[COL(name) - 1] = v; };
    set('取引日', c.date);
    set('取引先', safeCell_(c.desc));
    set('金額', c.amount);
    set('通貨', 'JPY');
    set('品名', rule.item);
    set('分類', rule.category);
    set('事業で使えそうか', 'どちらとも言えない');
    set('支払い方法', safeCell_(c.card));
    set('ポイント以外の支払額', c.amount);
    set('入手経路', CARD_LEDGER_SOURCE);
    set('受信日時', Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd HH:mm'));
    set('保存ファイル', urls[c.file] || c.file);
    set('Message-ID', id);
    set('メモ', rule.memo);
    set('書類の種類', CARD_LEDGER_DOCTYPE);
    rows.push(row);
    have[id] = true;
  });
  if (rows.length > 0) ledger.getRange(ledger.getLastRow() + 1, 1, rows.length, LEDGER_HEADERS.length).setValues(rows);
  return rows.length;
}

// 取り込んだ明細ファイルの名前 → ドライブのリンク
function cardFileUrls_() {
  const urls = {};
  try {
    const done = getSubFolder_(getSubFolder_(rootFolder_(), CARD_INBOX_NAME), CARD_DONE_NAME);
    const it = done.getFiles();
    while (it.hasNext()) { const f = it.next(); urls[f.getName()] = f.getUrl(); }
  } catch (e) {
    console.error('明細ファイルのリンクを取れませんでした：' + e.message);
  }
  return urls;
}

// 台帳の領収書1件の見分け方（経費仕分けで使う）。紙の写真はファイルが同じでも、日付・取引先・金額で分ける
function receiptBaseKey_(r) {
  return 'rcpt:' + (r.msgId || [r.file, r.date, r.store, r.amount].join('|'));
}

// カード明細1件に合う領収書を探す
function findReceipt_(c, receipts) {
  if (c.amount < 0) return null;
  const cd = toDay_(c.date);
  let best = null;
  receipts.forEach(r => {
    if (r.used) return;
    const diff = Math.abs(toDay_(r.date) - cd);
    const sim = nameSimilar_(c.desc, r.store);
    if (r.currency === 'JPY') {
      // 円：金額が同じ（ポイント併用なら、ポイント以外の支払額が同じでもOK）
      const paid = Number(r.otherPaid);
      const amountOk = r.amount === c.amount || (isFinite(paid) && paid > 0 && paid === c.amount);
      if (!amountOk || diff > JPY_DAYS) return;
      const score = (sim ? 0 : 100) + diff;   // 名前が似ているものを優先し、次に日付が近いもの
      if (!best || score < best.score) best = { r: r, score: score, fx: false };
    } else {
      // 外貨：日付が近く、名前が似ているもの
      if (!sim || diff > FX_DAYS) return;
      const score = 50 + diff;
      if (!best || score < best.score) best = { r: r, score: score, fx: true };
    }
  });
  return best;
}

function toDay_(dateStr) {
  const m = String(dateStr).match(/(\d{4})\/(\d{2})\/(\d{2})/);
  return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000 : 0;
}

// お店の名前が似ているか（カードの「ANTHROPIC* CLAUDE SUB」と台帳の「Anthropic, PBC」など）
function nameSimilar_(cardDesc, store) {
  const norm = s => String(s || '').normalize('NFKC').toLowerCase()
    .replace(/(東京都|大阪府|京都府|北海道|..県).*$/, '')   // カード明細の後ろについている住所を外す
    .replace(/株式会社|有限会社|合同会社|\(株\)|inc\.?|incorporated|corp\.?|co\.,?|ltd\.?|llc|pbc|japan|ジャパン/g, ' ');
  const a = norm(cardDesc), b = norm(store);
  if (!a.trim() || !b.trim()) return false;
  const words = s => (s.match(/[a-z0-9]{3,}|[^\x00-\x7f\s・、。,.*()（）\-]{2,}/g) || []);
  const wa = words(a), wb = words(b);
  if (wa.some(x => wb.some(y => x === y || (x.length >= 4 && y.indexOf(x) >= 0) || (y.length >= 4 && x.indexOf(y) >= 0)))) return true;
  const ca = a.replace(/[\s\W_]/g, ''), cb = b.replace(/[\s\W_]/g, '');
  return (cb.length >= 3 && ca.indexOf(cb.slice(0, Math.min(5, cb.length))) >= 0) || (ca.length >= 3 && cb.indexOf(ca.slice(0, Math.min(5, ca.length))) >= 0);
}

// ===== 50_shiwake.js =====
// ==========================================
// 経費仕分け（カード突き合わせの続きで動く）
//  - カード明細の全件と、カード以外で払った領収書を、その年の帳簿の「経費仕分け」タブに1行ずつ並べる
//  - 1行ずつ、区分（事業の経費／立替／個人／要確認）・勘定科目・事業の割合・理由を書く
//  - レシートに事業の品と個人の品が混ざっていれば、事業の品の分だけを「AIの事業分の金額」に出す（経費になる金額はこちらを使う）
//      1. まず管理シートの「仕分けルール」（○○は事業の経費、など）を当てはめる
//      2. ルールに当てはまらないものは、Gemini が判定する（お客様がチェックした行を見本にする）
//  - お客様は「確認」にチェックを入れるだけ。AIと違うときだけ「〜（変える時だけ）」を選ぶ
//  - 「確定した区分」「確定した勘定科目」「経費になる金額」は自動で計算される（チェックした行だけ）
//  - 一度並べた行は消さない・書き換えない（お客様のチェックや変更は残る）。新しい支払いだけ下に足す
// ==========================================

const SHEET_SHIWAKE = '経費仕分け';
const SHIWAKE_HEADERS = ['取引日', '支払先', '金額（円）', '支払い方法', '領収書', '領収書のファイル', '品名',
  'AIの区分', 'AIの勘定科目', 'AIの事業割合(%)', 'AIの事業分の金額（円）', 'AIの理由',
  '確認', '区分（変える時だけ）', '勘定科目（変える時だけ）', '事業割合（変える時だけ）',
  '確定した区分', '確定した勘定科目', '経費になる金額', 'メモ', 'キー'];
const SC = name => SHIWAKE_HEADERS.indexOf(name) + 1;   // 列番号（1から）
const KUBUN_TATEKAE = '立替（あとで精算）';
const KUBUN = ['事業の経費', KUBUN_TATEKAE, '個人', '要確認'];
// 勘定科目（青色申告決算書の科目＋よく使う科目）
const KAMOKU = ['旅費交通費', '通信費', '広告宣伝費', '接待交際費', '会議費', '消耗品費', '工具器具備品', '新聞図書費', '研修費',
  '支払手数料', '外注工賃', '地代家賃', '水道光熱費', '損害保険料', '修繕費', '荷造運賃', '福利厚生費', '租税公課', '車両費', '雑費',
  '立替金', '事業主貸'];
const RULE_HEADERS = ['含む言葉（支払先・品名）', '区分', '勘定科目', '事業割合(%)', '理由', '金額の条件（任意）'];
// 最初に入れておく決まりごと（どのお客様にも当てはまるものだけ）。管理シートで自由に足したり直したりできる
// 上から順に見て、最初に当てはまったものを使う（同じ店で分けたいときは、細かい条件のものを上に書く）
const DEFAULT_RULES = [
  ['ETC', '要確認', '旅費交通費', 100, '仕事の移動なら経費（旅費交通費）', ''],
  ['ＥＴＣ', '要確認', '旅費交通費', 100, '仕事の移動なら経費（旅費交通費）', ''],
  ['年会費', '要確認', '支払手数料', 100, '事業で使うカードなら経費。個人用なら個人', '']
];
const SHIWAKE_BATCH = 40;        // Gemini に1回で送る件数
const SHIWAKE_PARALLEL = 5;      // 同時に送る数
const SHIWAKE_EXAMPLES = 40;     // 見本として渡す、お客様がチェックした行の数
const SHIWAKE_CONTINUE_HANDLER = '経費仕分けの続き';   // 自動の続きで動く関数
const SHIWAKE_CONTINUE_MS = 60 * 1000;                 // 区切ったら1分後に続ける
const SHIWAKE_MAX_STALL = 5;                           // 続けてこの回数1件も進まなければ、自動の続きをやめる（翌朝6時の実行に任せる）
const PROP_SHIWAKE_STALL = 'SHIWAKE_STALL';
const SHIWAKE_DOUBLE_MEMO = '同じ支払いが「カード以外で支払い」の行にもあります（二重に数えないよう、どちらかを「個人」以外で確定しない）';


// ==========================================
// メイン
// ==========================================
// 手で動かすとき用（カード明細の取り込み・突き合わせ・仕分けをまとめて行う）
function 経費を仕分ける() {
  PROPS.deleteProperty(PROP_SHIWAKE_STALL);
  return カード明細を取り込んで突き合わせる();
}

// 自動の続き（1分後の予約から呼ばれる）
function 経費仕分けの続き() {
  try {
    return カード明細を取り込んで突き合わせる();
  } catch (e) {
    console.error('経費仕分けの続きでエラー：' + e.message);
    afterShiwake_({ added: 0, left: 1 });   // 1分後にもう一度（続けて失敗したら止まる）
    throw e;
  }
}

function 経費仕分けの続きを止める() {
  cancelSchedule_(SHIWAKE_CONTINUE_HANDLER);
}

// まだチェックしていない・何も変えていない行を消して、もう一度判定する（ルールを直したあとに使う）
function 未確認の行をAIで判定し直す() {
  const cleared = withLock_(null, () => {
    openYears_().forEach(year => clearUntouchedRows_(getYear_(year, false)));
    return true;
  });
  return cleared ? 経費を仕分ける() : null;
}

function clearUntouchedRows_(y) {
  const sh = y.ss.getSheetByName(SHEET_SHIWAKE);
  if (!sh || sh.getLastRow() < 2) return;
  const vals = sh.getRange(2, 1, sh.getLastRow() - 1, SHIWAKE_HEADERS.length).getValues();
  const memo = v => String(v[SC('メモ') - 1] || '');
  const untouched = v => v[SC('確認') - 1] !== true && ['区分（変える時だけ）', '勘定科目（変える時だけ）', '事業割合（変える時だけ）'].every(h => v[SC(h) - 1] === '')
    && (memo(v) === '' || memo(v) === SHIWAKE_DOUBLE_MEMO);   // このコードが書いたメモは、お客様が変えたことにしない
  const keep = vals.filter(v => !untouched(v));
  // 1行ずつ消すと時間がかかるので、残す行だけをまとめて書き戻す
  sh.getRange(2, 1, vals.length, SHIWAKE_HEADERS.length).clearDataValidations().clearContent();
  if (keep.length > 0) {
    sh.getRange(2, 1, keep.length, SHIWAKE_HEADERS.length).setValues(keep);
    setShiwakeFormulas_(sh, 2, keep.length);
  }
  console.log(`${y.year}年：未確認の${vals.length - keep.length}行を消しました。もう一度判定します。`);
}


// ==========================================
// 仕分けの本体（カード突き合わせから呼ばれる）
// jobs：[{ y: 年の情報, items: 支払いの一覧 }]
// ==========================================
function updateShiwakeAll_(jobs) {
  const total = { added: 0, left: 0 };
  jobs.forEach(j => {
    let res;
    try {
      res = updateShiwakeCore_(j.y, j.items);
    } catch (e) {
      console.error(`${j.y.year}年の経費仕分けでエラー：` + e.message);
      res = { added: 0, left: 1 };
    }
    total.added += res.added;
    total.left += res.left;
  });
  afterShiwake_(total);
  return total;
}

// 残りがあれば1分後に続きを予約する。なければ予約を消す（予約は常に1つだけ）
function afterShiwake_(res) {
  経費仕分けの続きを止める();
  if (!(res.left > 0)) { PROPS.deleteProperty(PROP_SHIWAKE_STALL); return; }
  const stall = res.added > 0 ? 0 : Number(PROPS.getProperty(PROP_SHIWAKE_STALL) || 0) + 1;
  if (stall >= SHIWAKE_MAX_STALL) {
    PROPS.deleteProperty(PROP_SHIWAKE_STALL);
    console.log(`続けて${SHIWAKE_MAX_STALL}回、1件も進まなかったので自動の続きを止めました（AIの混雑など）。明日6時の自動実行でもう一度行います。`);
    return;
  }
  PROPS.setProperty(PROP_SHIWAKE_STALL, String(stall));
  scheduleOnce_(SHIWAKE_CONTINUE_HANDLER, SHIWAKE_CONTINUE_MS);
  console.log(`残り${res.left}件は、1分後に自動で続けます。`);
}

function updateShiwakeCore_(y, items) {
  if (!items || items.length === 0) return { added: 0, left: 0 };
  const sh = prepareShiwakeSheet_(y.ss);
  const last = sh.getLastRow();
  const old = last >= 2 ? sh.getRange(2, 1, last - 1, SHIWAKE_HEADERS.length).getValues() : [];
  const have = {};
  old.forEach(v => { have[String(v[SC('キー') - 1])] = true; });

  const todo = items.filter(x => !have[x.key]).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  if (todo.length === 0) return { added: 0, left: 0 };

  // 1. 決まりごと
  const rules = loadRules_();
  const judged = [];
  const forAi = [];
  todo.forEach(x => {
    const r = findRule_(x, rules);
    if (r) judged.push({ x: x, kubun: r.kubun, kamoku: r.kamoku, ratio: r.ratio, reason: 'ルール：' + r.reason });
    else forAi.push(x);
  });

  // 2. Gemini（時間が足りなくなったら、残りは次回）
  let left = 0;
  if (forAi.length > 0) {
    const examples = shiwakeExamples_(old, y.year);
    for (let i = 0; i < forAi.length; i += SHIWAKE_BATCH * SHIWAKE_PARALLEL) {
      if (DEADLINE && Date.now() + 60000 > DEADLINE) { left = forAi.length - i; break; }
      const groups = [];
      for (let j = i; j < Math.min(forAi.length, i + SHIWAKE_BATCH * SHIWAKE_PARALLEL); j += SHIWAKE_BATCH) groups.push(forAi.slice(j, j + SHIWAKE_BATCH));
      const responses = fetchGeminiAll_(groups.map(g => geminiRequest_([{ text: shiwakePrompt_(g, examples) }], THINK_SHIWAKE)));
      groups.forEach((g, k) => {
        const ans = readGeminiResponse_(responses[k]);
        if (!ans || !Array.isArray(ans.results)) { left += g.length; return; }   // 返事そのものが読めない（混雑など）：次回もう一度
        g.forEach((x, n) => {
          const a = ans.results.find(r => r && String(r.id) === String(n + 1));
          const v = validateShiwake_(a) || { kubun: '要確認', kamoku: '雑費', ratio: '', reason: 'AIが判定できませんでした（区分を選んでください）' };
          judged.push({ x: x, kubun: v.kubun, kamoku: v.kamoku, ratio: v.ratio, reason: v.reason });
        });
      });
    }
  }

  // 3. シートに足す（同じ支払いが「カード以外の領収書」の行ですでにあれば、メモで知らせる）
  judged.sort((a, b) => a.x.date < b.x.date ? -1 : a.x.date > b.x.date ? 1 : 0);
  const rows = judged.map(j => {
    const x = j.x;
    const memo = x.receiptKey && have[x.receiptKey] ? SHIWAKE_DOUBLE_MEMO : '';
    const row = new Array(SHIWAKE_HEADERS.length).fill('');
    row[SC('取引日') - 1] = x.date;
    row[SC('支払先') - 1] = safeCell_(x.store);
    row[SC('金額（円）') - 1] = x.amount;
    row[SC('支払い方法') - 1] = safeCell_(x.pay);
    row[SC('領収書') - 1] = x.receipt;
    row[SC('領収書のファイル') - 1] = x.file || '';
    row[SC('品名') - 1] = safeCell_(x.item || '');
    row[SC('AIの区分') - 1] = j.kubun;
    row[SC('AIの勘定科目') - 1] = j.kamoku;
    row[SC('AIの事業割合(%)') - 1] = j.ratio;
    // 事業の品と個人の品が混ざったレシート：事業の品の分だけを経費の候補にする（カードでポイント併用などで金額が違えば、割合で直す）
    const mixed = x.bizAmount !== '' && x.bizAmount !== undefined && (j.kubun === '事業の経費' || j.kubun === '要確認') && typeof x.amount === 'number';
    if (mixed) {
      const part = x.receiptTotal && Number(x.receiptTotal) !== x.amount ? Math.round(x.amount * x.bizAmount / Number(x.receiptTotal)) : x.bizAmount;
      row[SC('AIの事業分の金額（円）') - 1] = Math.min(part, x.amount);
    }
    row[SC('AIの理由') - 1] = safeCell_(j.reason + (mixed ? '／個人の品を除いた金額で計上' : ''));
    row[SC('確認') - 1] = false;
    row[SC('メモ') - 1] = memo;
    row[SC('キー') - 1] = x.key;
    return row;
  });
  if (rows.length > 0) {
    const start = sh.getLastRow() + 1;
    sh.getRange(start, 1, rows.length, SHIWAKE_HEADERS.length).setValues(rows);
    setShiwakeFormulas_(sh, start, rows.length);
  }
  console.log(`${y.year}年の経費仕分け：新しく${rows.length}件を判定しました（ルール ${todo.length - forAi.length}件・AI ${rows.length - (todo.length - forAi.length)}件）。` +
    (left > 0 ? `残り${left}件があります。` : '残りはありません。'));
  return { added: rows.length, left: left };
}


// ==========================================
// シートの準備
// ==========================================
function prepareShiwakeSheet_(ss) {
  let sh = ss.getSheetByName(SHEET_SHIWAKE);
  if (!sh) sh = ss.insertSheet(SHEET_SHIWAKE);
  if (sh.getLastRow() === 0) {
    sh.appendRow(SHIWAKE_HEADERS);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, 1, SHIWAKE_HEADERS.length).setFontWeight('bold').setBackground('#DDEBF7');
    sh.getRange(1, SC('確認'), 1, 4).setBackground('#FFF2CC');            // お客様が入れる列は黄色
    sh.getRange(1, SC('確定した区分'), 1, 3).setBackground('#E2EFDA');    // 自動で計算される列は緑
  }
  return sh;
}

// 「確認」はチェックボックス、「変える時だけ」は選択肢、確定の3列は計算式
function setShiwakeFormulas_(sh, start, n) {
  const R = c => 'RC' + SC(c);
  sh.getRange(start, SC('確認'), n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  sh.getRange(start, SC('区分（変える時だけ）'), n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(KUBUN, true).setAllowInvalid(false).build());
  sh.getRange(start, SC('勘定科目（変える時だけ）'), n, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(KAMOKU, true).setAllowInvalid(true).build());
  const f = [
    `=IF(${R('確認')}=TRUE,IF(${R('区分（変える時だけ）')}<>"",${R('区分（変える時だけ）')},${R('AIの区分')}),"")`,
    `=IF(${R('確認')}=TRUE,IF(${R('勘定科目（変える時だけ）')}<>"",${R('勘定科目（変える時だけ）')},${R('AIの勘定科目')}),"")`,
    // 経費になる金額：①事業割合を変えたらその割合 ②品目で分けた「AIの事業分の金額」があればそれ ③AIの事業割合
    `=IF(AND(${R('確定した区分')}="事業の経費",ISNUMBER(${R('金額（円）')})),IF(${R('事業割合（変える時だけ）')}<>"",ROUND(${R('金額（円）')}*${R('事業割合（変える時だけ）')}/100),IF(ISNUMBER(${R('AIの事業分の金額（円）')}),${R('AIの事業分の金額（円）')},ROUND(${R('金額（円）')}*IF(${R('AIの事業割合(%)')}<>"",${R('AIの事業割合(%)')},100)/100))),"")`
  ];
  sh.getRange(start, SC('確定した区分'), n, 3).setFormulasR1C1(new Array(n).fill(f));
}


// ==========================================
// 決まりごと（管理シートの「仕分けルール」タブ。年をまたいで使う）
// ==========================================
function loadRules_() {
  const rs = manage_().getSheetByName(SH_RULES);
  if (!rs || rs.getLastRow() < 2) return [];
  return rs.getRange(2, 1, rs.getLastRow() - 1, RULE_HEADERS.length).getValues()
    .filter(r => String(r[0]).trim() && KUBUN.indexOf(String(r[1]).trim()) >= 0)
    .map(r => ({ word: normText_(r[0]), kubun: String(r[1]).trim(), kamoku: String(r[2] || '').trim(),
      ratio: ratioFor_(String(r[1]).trim(), r[3]), reason: String(r[4] || '').trim(), cond: String(r[5] || '') }));
}

function findRule_(x, rules) {
  const text = normText_(x.store + ' ' + (x.item || ''));
  return rules.find(r => r.word && text.indexOf(r.word) >= 0 && amountOk_(x.amount, r.cond)) || null;
}

// 金額の条件：「1000円単位」「5000円以上」「3000円未満」「3000円以下」（組み合わせてもよい）。空なら条件なし
function amountOk_(amount, cond) {
  const c = String(cond || '').normalize('NFKC').replace(/[,，]/g, '');
  if (!c.trim()) return true;
  const n = Number(amount);
  if (!isFinite(n) || amount === '') return false;
  let m;
  if ((m = c.match(/(\d+)円単位/)) && n % Number(m[1]) !== 0) return false;
  if ((m = c.match(/(\d+)円以上/)) && n < Number(m[1])) return false;
  if ((m = c.match(/(\d+)円未満/)) && n >= Number(m[1])) return false;
  if ((m = c.match(/(\d+)円以下/)) && n > Number(m[1])) return false;
  return true;
}

function normText_(s) {
  return String(s || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}


// ==========================================
// Gemini
// ==========================================
// お客様がチェックした行（見本）。変えた行を優先して、新しいものから。今年の分が少なければ前の年の分も使う
function shiwakeExamples_(old, year) {
  const pick = rows => rows.filter(v => v[SC('確認') - 1] === true).map(v => ({
    changed: v[SC('区分（変える時だけ）') - 1] !== '' || v[SC('勘定科目（変える時だけ）') - 1] !== '',
    store: String(v[SC('支払先') - 1]).replace(/^'/, ''), item: String(v[SC('品名') - 1]).replace(/^'/, ''),
    kubun: String(v[SC('区分（変える時だけ）') - 1] || v[SC('AIの区分') - 1]),
    kamoku: String(v[SC('勘定科目（変える時だけ）') - 1] || v[SC('AIの勘定科目') - 1]),
    memo: String(v[SC('メモ') - 1] || '')
  })).reverse();
  let checked = pick(old);
  if (checked.length < SHIWAKE_EXAMPLES) {
    const prev = getYear_(year - 1, false);
    const psh = prev && prev.ss.getSheetByName(SHEET_SHIWAKE);
    if (psh && psh.getLastRow() >= 2) checked = checked.concat(pick(psh.getRange(2, 1, psh.getLastRow() - 1, SHIWAKE_HEADERS.length).getValues()));
  }
  return checked.filter(e => e.changed).concat(checked.filter(e => !e.changed)).slice(0, SHIWAKE_EXAMPLES);
}

function shiwakePrompt_(group, examples) {
  const list = group.map((x, n) => ({ id: n + 1, date: x.date, store: x.store, amount: x.amount, pay: x.pay, item: x.item || '', ai_hint: x.hint || '' }));
  const ex = examples.length === 0 ? '（まだありません）' :
    examples.map(e => `- ${e.store}${e.item ? '（' + e.item + '）' : ''} → ${e.kubun}／${e.kamoku}${e.memo ? '　メモ：' + e.memo : ''}`).join('\n');
  return `
あなたは個人事業主の経理担当です。下の支払い1件ずつについて、確定申告（青色申告）のための仕分けを提案してください。

# この人の事業
${businessProfile_()}

# 区分（kubun はこの中から1つ）
- 事業の経費：個人事業のための支払い
- ${KUBUN_TATEKAE}：取引先など他人のために立て替えた支払い（あとで精算される）
- 個人：生活・趣味のための支払い
- 要確認：どちらとも言えないもの（旅行と出張が混ざりうる宿・交通、飲食、家電など）。迷ったら要確認にする

# 勘定科目（kamoku はこの中から1つ）
${KAMOKU.join('、')}
- 立替は「立替金」、個人は「事業主貸」。10万円以上のパソコン・機器は「工具器具備品」、10万円未満は「消耗品費」。
- ソフト・クラウド・AIのサブスクの利用料、スマホ・ネットの料金は「通信費」。

# 品目の内訳について
- item に「品名 金額［事業］、品名 金額［個人］」のような内訳がある支払いは、事業の品と個人の品が1回の支払いに混ざっている。
- 事業の品が1つでもあれば kubun は「事業の経費」にし、kamoku は事業の品に合わせる。個人の品の分は、システムが自動で経費から除く。

# 事業割合（ratio）
- 事業の経費・要確認なら、事業で使う割合（0〜100）。スマホ代・車・自宅の家賃や光熱費など私用もあるものは、事業の説明に合わせて 50 など。立替・個人は空でよい。

# この人が以前に確定したもの（見本。似た支払いは同じように）
${ex}

# 支払い（ai_hint は、領収書を読んだAIの「事業で使えそうか」の感想）
${JSON.stringify(list)}

# 出力形式（JSONのみ。すべての id について1件ずつ）
{ "results": [ { "id": 1, "kubun": "区分", "kamoku": "勘定科目", "ratio": 数字, "reason": "理由（30文字くらい）" } ] }
`;
}

function validateShiwake_(a) {
  if (!a || typeof a !== 'object') return null;
  const kubun = String(a.kubun || '').trim();
  if (KUBUN.indexOf(kubun) < 0) return null;
  let kamoku = String(a.kamoku || '').trim();
  if (KAMOKU.indexOf(kamoku) < 0) kamoku = kubun === KUBUN_TATEKAE ? '立替金' : kubun === '個人' ? '事業主貸' : '雑費';
  return { kubun: kubun, kamoku: kamoku, ratio: ratioFor_(kubun, a.ratio), reason: String(a.reason || '').slice(0, 100) };
}

// 事業割合：個人・立替は空（お客様が「事業の経費」に変えたら100%で計算）。それ以外は0〜100、分からなければ100
function ratioFor_(kubun, v) {
  if (kubun === KUBUN_TATEKAE || kubun === '個人') return '';
  const n = v === '' || v === null || v === undefined ? NaN : Number(v);
  return isFinite(n) ? Math.max(0, Math.min(100, Math.round(n))) : 100;
}

// ===== 60_close.js =====
// ==========================================
// 年を締める（確定申告が終わったら、お客様がメニューから実行する）
//  ・その年の帳簿の全タブをCSVで「控え」フォルダに保存する（Googleのアカウントに何かあったときの備え）
//  ・帳簿の全タブを保護する（持ち主のお客様以外は編集できなくなる。持ち主は「データ」→「シートと範囲を保護」から外せる）
//  ・年度一覧の状態を「締め済み」にする。以後、その年の取引日の書類は今年の帳簿に入り、チェック欄で知らせる
// ==========================================

function メニュー_前年を締める() {
  const ui = SpreadsheetApp.getUi();
  const year = Number(Utilities.formatDate(new Date(), TZ, 'yyyy')) - 1;
  const y = getYear_(year, false);
  if (!y) { ui.alert(`${year}年の帳簿はありません。`); return; }
  if (y.closed) { ui.alert(`${year}年はすでに締めています。`); return; }
  const ok = ui.alert(`${year}年を締めます`,
    `確定申告が終わってから実行してください。\n\n` +
    `・${year}年の帳簿の控え（CSV）を「${year}年/${BACKUP_NAME}」フォルダに保存します\n` +
    `・${year}年の帳簿を保護して、誤って書き換えられないようにします\n` +
    `・このあと届いた${year}年の書類は、今年の帳簿に入れてお知らせします\n\n続けますか？`,
    ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  // ほかの処理がこの年に書いている途中で締めないよう、同じ鍵をかけてから行う
  const done = withLock_(null, () => { closeYear_(y); return true; });
  ui.alert(done ? `${year}年を締めました。` : 'ほかの処理が動いています。数分待ってから、もう一度実行してください。');
}

function closeYear_(y) {
  // 1) 控え（CSV）
  const backup = getSubFolder_(y.folder, BACKUP_NAME);
  const stamp = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
  y.ss.getSheets().forEach(sh => {
    if (sh.getLastRow() === 0) return;
    const csv = sh.getDataRange().getDisplayValues()
      .map(r => r.map(c => /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c).join(','))
      .join('\r\n');
    backup.createFile(`${y.year}年_${sh.getName()}_${stamp}.csv`, '﻿' + csv, MimeType.CSV);
  });

  // 2) 保護（持ち主以外は編集できない）
  y.ss.getSheets().forEach(sh => {
    const p = sh.protect().setDescription(`${y.year}年は締め済み`);
    p.removeEditors(p.getEditors());
    if (p.canDomainEdit()) p.setDomainEdit(false);
  });

  // 3) 年度一覧
  const row = yearRows_().find(r => r.year === y.year);
  const sh = manage_().getSheetByName(SH_YEARS);
  sh.getRange(row.row, 4, 1, 2).setValues([[YEAR_CLOSED, Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd')]]);
  delete YEAR_CACHE[y.year];
  console.log(`${y.year}年を締めました。`);
}
