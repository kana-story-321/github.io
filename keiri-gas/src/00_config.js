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

const APP_VERSION = '1.0.0';
const TZ = 'Asia/Tokyo';
const PROPS = PropertiesService.getScriptProperties();

// AIのモデル。版を固定する（上げるときは、テスト用の環境で読み取り結果を確かめてから全員に配る）
const MODEL_NAME = 'gemini-2.5-flash';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL_NAME}:generateContent`;

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
