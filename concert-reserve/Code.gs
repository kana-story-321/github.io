/**
 * コンサート予約システム（Google Apps Script / スプレッドシートに紐づけて使う）
 *
 * 画面:
 *   予約フォーム … WebアプリのURL
 *   受付画面     … WebアプリのURL + ?page=checkin&key=（設定シートの合言葉）
 *
 * 最初に1回だけ setup() を実行すると「設定」「予約」シートができる。
 */

var TZ = 'Asia/Tokyo';
var SHEET_RES = '予約';
var SHEET_SET = '設定';

var COLS = ['予約番号', '受付日時', '名前', 'フリガナ', 'メール', '電話番号', '枚数',
  '支払い方法', '合計金額', '支払期限', '入金状況', '状態', '来場', '来場時刻', '備考'];
var C = {};
COLS.forEach(function (name, i) { C[name] = i; });

var PAY_BANK = '銀行振込';
var PAY_CARD = 'クレジットカード';

// [項目, 初期値, 説明]
var DEFAULT_SETTINGS = [
  ['公演名', '金澤博 またうたう まだうたう コンサート', 'フォームとメールに表示されます'],
  ['出演', 'ピアノ 名和田俊二／ゲスト 三瓶千鶴', ''],
  ['公演日', '2027/05/21', '日付で入力（例 2027/05/21）。翌日以降は自動で受付終了になります'],
  ['時間', '18:00開場／18:30開演', ''],
  ['会場', '代々木ムジカーザ', ''],
  ['料金', 5000, '1枚あたりの金額（円）'],
  ['定員', '', '販売する合計枚数。空欄なら上限なし'],
  ['受付状態', '受付中', '「受付中」以外にするとフォームが受付停止になります'],
  ['振込期限日数', 7, '予約日から何日以内か（公演前日のほうが早ければ前日が期限）'],
  ['振込の案内', '{期限}までに、{合計}を下記の口座へお振込みください。\n\n（ここに銀行名・支店・口座種別・口座番号・名義を入力）',
    '振込の方への案内文。メールと完了画面に載ります。{名前} {予約番号} {枚数} {合計} {期限} は予約ごとの内容に置き換わります'],
  ['カード決済の案内', '{期限}までに、{合計}をクレジットカードでお支払いください。\n\n（ここに決済ページのURLや手順を入力）',
    'カード払いの方への案内文。使える置き換えは振込の案内と同じです'],
  ['問い合わせ先', '', 'メール末尾とフォームに表示（メールアドレスや電話番号）'],
  ['通知先メール', '', '予約が入るたびに主催者へ通知するアドレス。空欄なら通知しない'],
  ['受付画面の合言葉', '', '受付画面URLの key= に付ける文字列。他人に知られたら書き換えてください']
];

/* ───────────── 初期設定・メニュー ───────────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('予約システム')
    .addItem('初期設定（シートを作る）', 'setup')
    .addItem('フォーム・受付画面のURLを表示', 'showUrls')
    .addToUi();
}

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.setSpreadsheetTimeZone(TZ);
  ss.setSpreadsheetLocale('ja_JP');

  // 設定シート（既にある項目は上書きしない）
  var set = ss.getSheetByName(SHEET_SET) || ss.insertSheet(SHEET_SET);
  if (set.getLastRow() === 0) {
    set.getRange(1, 1, 1, 3).setValues([['項目', '値', '説明']]).setFontWeight('bold').setBackground('#dbe9ff');
    set.setFrozenRows(1);
    set.setColumnWidth(1, 150);
    set.setColumnWidth(2, 340);
    set.setColumnWidth(3, 520);
  }
  var existing = readSettings_();
  DEFAULT_SETTINGS.forEach(function (d) {
    if (existing.hasOwnProperty(d[0])) return;
    var value = d[1];
    if (d[0] === '受付画面の合言葉') value = Utilities.getUuid().replace(/-/g, '').slice(0, 12);
    var row = set.getLastRow() + 1;
    set.getRange(row, 1, 1, 3).setValues([[d[0], value, d[2]]]);
  });

  // 予約シート
  var res = ss.getSheetByName(SHEET_RES) || ss.insertSheet(SHEET_RES);
  if (res.getLastRow() === 0) {
    res.getRange(1, 1, 1, COLS.length).setValues([COLS]).setFontWeight('bold').setBackground('#dbe9ff');
    res.setFrozenRows(1);
    var widths = [80, 150, 140, 140, 220, 130, 50, 120, 90, 100, 80, 80, 50, 80, 260];
    widths.forEach(function (w, i) { res.setColumnWidth(i + 1, w); });
  }
}

function showUrls() {
  var url = ScriptApp.getService().getUrl();
  var ui = SpreadsheetApp.getUi();
  if (!url) {
    ui.alert('まだWebアプリとしてデプロイされていません。\nApps Script の「デプロイ」→「新しいデプロイ」から公開してください。');
    return;
  }
  var key = readSettings_()['受付画面の合言葉'];
  ui.alert('予約フォーム（お客様用）\n' + url +
    '\n\n受付画面（スタッフ用・外部に出さない）\n' + url + '?page=checkin&key=' + encodeURIComponent(key));
}

/* ───────────── Webアプリ ───────────── */

function doGet(e) {
  var page = (e && e.parameter && e.parameter.page) || '';
  var s = readSettings_();
  var isCheckin = page === 'checkin';
  return HtmlService.createHtmlOutputFromFile(isCheckin ? 'checkin' : 'form')
    .setTitle((isCheckin ? '受付｜' : 'ご予約｜') + (s['公演名'] || 'コンサート'))
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ───────────── 予約フォーム用 ───────────── */

/** フォームに表示する公演情報と受付可否 */
function getFormInfo() {
  var s = readSettings_();
  var st = status_(s, readRows_());
  return {
    title: String(s['公演名'] || ''),
    performers: String(s['出演'] || ''),
    dateText: st.eventYmd ? jpDate_(st.eventYmd) : '',
    timeText: String(s['時間'] || ''),
    venue: String(s['会場'] || ''),
    price: st.price,
    remaining: st.remaining, // null = 上限なし
    open: st.open,
    closedReason: st.closedReason,
    contact: String(s['問い合わせ先'] || ''),
    payments: [PAY_BANK, PAY_CARD]
  };
}

/** 予約を1件登録する。成功時は完了画面用の情報を返す */
function submitReservation(form) {
  form = form || {};
  if (form.website) throw new Error('送信できませんでした。'); // bot対策（人には見えない欄）

  var name = cleanText_(form.name, 60);
  var kana = cleanText_(form.kana, 60);
  var email = String(form.email || '').trim();
  var tel = toHalfWidth_(String(form.tel || '')).replace(/[^0-9-]/g, '').slice(0, 20);
  var qty = Number(toHalfWidth_(String(form.qty || '')));
  var payment = String(form.payment || '');
  var note = cleanText_(form.note, 300);

  if (!name) throw new Error('お名前を入力してください。');
  if (!kana) throw new Error('フリガナを入力してください。');
  if (!/^[A-Za-z0-9][^\s@]*@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) {
    throw new Error('メールアドレスを正しく入力してください。');
  }
  if (tel.replace(/-/g, '').length < 9) throw new Error('電話番号を正しく入力してください。');
  if (!(qty >= 1) || Math.floor(qty) !== qty) throw new Error('枚数を入力してください。');
  if (payment !== PAY_BANK && payment !== PAY_CARD) throw new Error('お支払い方法を選んでください。');

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var result, s, sheet, row;
  try {
    s = readSettings_();
    var rows = readRows_();
    var st = status_(s, rows);
    if (!st.open) throw new Error(st.closedReason);
    if (st.remaining !== null && qty > st.remaining) {
      throw new Error('申し訳ありません。残り' + st.remaining + '枚のため、' + qty + '枚はお取りできません。');
    }

    var id = nextId_(rows);
    var total = qty * st.price;
    var due = dueDate_(st.todayYmd, st.eventYmd, Number(s['振込期限日数']) || 7);

    var values = [];
    values[C['予約番号']] = id;
    values[C['受付日時']] = Utilities.formatDate(now_(), TZ, 'yyyy/MM/dd HH:mm:ss');
    values[C['名前']] = name;
    values[C['フリガナ']] = kana;
    values[C['メール']] = email;
    values[C['電話番号']] = tel;
    values[C['枚数']] = qty;
    values[C['支払い方法']] = payment;
    values[C['合計金額']] = total;
    values[C['支払期限']] = due ? due.replace(/-/g, '/') : '当日';
    values[C['入金状況']] = '未';
    values[C['状態']] = '有効';
    values[C['来場']] = false;
    values[C['来場時刻']] = '';
    values[C['備考']] = note;

    sheet = resSheet_();
    row = sheet.getLastRow() + 1;
    // お客様が入力した欄は「書式なしテキスト」にして、電話番号の先頭0落ちや数式化を防ぐ
    [C['名前'], C['フリガナ'], C['メール'], C['電話番号'], C['備考']].forEach(function (c) {
      sheet.getRange(row, c + 1, 1, 1).setNumberFormat('@');
    });
    sheet.getRange(row, 1, 1, COLS.length).setValues([values]);
    sheet.getRange(row, C['入金状況'] + 1, 1, 1).setDataValidation(listRule_(['未', '済']));
    sheet.getRange(row, C['状態'] + 1, 1, 1).setDataValidation(listRule_(['有効', 'キャンセル']));
    sheet.getRange(row, C['来場'] + 1, 1, 1).insertCheckboxes();

    result = {
      id: id, name: name, qty: qty, total: total, payment: payment,
      payText: ''
    };
    result.payText = payText_(s, result, due);
  } finally {
    lock.releaseLock();
  }

  // メールはロックの外で送る（失敗しても予約は成立させ、備考に残す）
  try {
    sendMails_(s, result, email, tel, note);
  } catch (err) {
    var cell = sheet.getRange(row, C['備考'] + 1, 1, 1);
    cell.setValue('【確認メール送信失敗】' + cell.getValue());
    result.mailFailed = true;
  }
  return result;
}

/* ───────────── 受付画面用 ───────────── */

function getCheckinList(key) {
  checkKey_(key);
  var s = readSettings_();
  var list = [];
  readRows_().forEach(function (r) {
    if (!r[C['予約番号']] || r[C['状態']] === 'キャンセル') return;
    list.push({
      id: String(r[C['予約番号']]),
      name: String(r[C['名前']]),
      kana: String(r[C['フリガナ']]),
      tel: String(r[C['電話番号']]),
      qty: Number(r[C['枚数']]) || 0,
      total: Number(r[C['合計金額']]) || 0,
      payment: String(r[C['支払い方法']]),
      paid: r[C['入金状況']] === '済',
      arrived: r[C['来場']] === true,
      note: String(r[C['備考']] || '')
    });
  });
  return { title: String(s['公演名'] || ''), list: list };
}

function setArrived(key, id, on) {
  checkKey_(key);
  var row = findRow_(id);
  var sheet = resSheet_();
  sheet.getRange(row, C['来場'] + 1, 1, 1).setValue(!!on);
  sheet.getRange(row, C['来場時刻'] + 1, 1, 1).setValue(on ? Utilities.formatDate(now_(), TZ, 'HH:mm') : '');
  return true;
}

function setPaid(key, id, on) {
  checkKey_(key);
  resSheet_().getRange(findRow_(id), C['入金状況'] + 1, 1, 1).setValue(on ? '済' : '未');
  return true;
}

/* ───────────── 内部処理 ───────────── */

function now_() { return new Date(); }

function resSheet_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RES);
  if (!sheet) throw new Error('「予約」シートがありません。初期設定を実行してください。');
  return sheet;
}

function readSettings_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_SET);
  var map = {};
  if (!sheet || sheet.getLastRow() < 2) return map;
  sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues().forEach(function (r) {
    var k = String(r[0]).trim();
    if (k) map[k] = r[1];
  });
  return map;
}

/** 予約シートの全データ行（見出しを除く） */
function readRows_() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_RES);
  if (!sheet || sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, COLS.length).getValues();
}

/** 受付可否・残席をまとめて判定する */
function status_(s, rows) {
  var todayYmd = Utilities.formatDate(now_(), TZ, 'yyyy-MM-dd');
  var eventYmd = toYmd_(s['公演日']);
  var price = Number(s['料金']) || 0;

  var cap = s['定員'];
  var hasCap = cap !== '' && cap !== null && cap !== undefined && !isNaN(Number(cap));
  var sold = 0;
  rows.forEach(function (r) {
    if (r[C['予約番号']] && r[C['状態']] !== 'キャンセル') sold += Number(r[C['枚数']]) || 0;
  });
  var remaining = hasCap ? Math.max(0, Number(cap) - sold) : null;

  var closedReason = '';
  if (String(s['受付状態']).trim() !== '受付中') closedReason = 'ただいま予約の受付を停止しています。';
  else if (eventYmd && todayYmd > eventYmd) closedReason = 'この公演は終了しました。';
  else if (remaining === 0) closedReason = 'おかげさまで満席となりました。';

  return {
    todayYmd: todayYmd, eventYmd: eventYmd, price: price, sold: sold,
    remaining: remaining, open: !closedReason, closedReason: closedReason
  };
}

/**
 * 支払期限（yyyy-MM-dd）。「予約日+days日」と「公演前日」の早いほう。
 * 公演前日を過ぎてからの予約（＝当日予約）は期限なし（null）＝当日受付で支払い。
 */
function dueDate_(todayYmd, eventYmd, days) {
  var due = addDays_(todayYmd, days);
  if (eventYmd) {
    var dayBefore = addDays_(eventYmd, -1);
    if (dayBefore < due) due = dayBefore;
  }
  return due < todayYmd ? null : due;
}

/**
 * 支払い案内文。設定シートの文面の {名前} {予約番号} {枚数} {合計} {期限} を予約内容に置き換える。
 * 公演当日の予約（期限なし）は当日払いの固定文。
 */
function payText_(s, r, due) {
  var amount = yen_(r.total) + '円';
  if (!due) return '公演当日のご予約のため、' + amount + 'を当日受付にてお支払いください。';
  var tpl = String(s[r.payment === PAY_BANK ? '振込の案内' : 'カード決済の案内'] || '').trim();
  if (!tpl) tpl = '{期限}までに、{合計}をお支払いください。お支払い方法は別途ご案内いたします。';
  var vals = { '名前': r.name, '予約番号': r.id, '枚数': r.qty + '枚', '合計': amount, '期限': jpDate_(due) };
  return tpl.replace(/[{｛]\s*(名前|予約番号|枚数|合計|期限)\s*[}｝]/g, function (m, k) { return vals[k]; });
}

function sendMails_(s, r, email, tel, note) {
  var title = String(s['公演名'] || 'コンサート');
  var eventYmd = toYmd_(s['公演日']);
  var contact = String(s['問い合わせ先'] || '').trim();
  var detail =
    '■ 予約番号：' + r.id + '\n' +
    '■ 公演：' + title + '\n' +
    '■ 日時：' + (eventYmd ? jpDate_(eventYmd) + ' ' : '') + String(s['時間'] || '') + '\n' +
    '■ 会場：' + String(s['会場'] || '') + '\n' +
    '■ 枚数：' + r.qty + '枚\n' +
    '■ 合計：' + yen_(r.total) + '円\n' +
    '■ お支払い方法：' + r.payment + '\n';

  var body = r.name + ' 様\n\n' +
    'このたびは「' + title + '」にご予約いただき、ありがとうございます。\n' +
    '以下の内容で承りました。\n\n' + detail +
    '\n【お支払いについて】\n' + r.payText + '\n\n' +
    '当日は受付でお名前をお伝えください。\n' +
    'ご来場を心よりお待ちしております。\n' +
    (contact ? '\n――――――――――\nお問い合わせ：' + contact + '\n' : '');
  MailApp.sendEmail(email, '【ご予約確認】' + title + '（' + r.id + '）', body, { name: title });

  var notify = String(s['通知先メール'] || '').trim();
  if (notify) {
    MailApp.sendEmail(notify, '【予約】' + r.id + ' ' + r.name + ' 様 ' + r.qty + '枚',
      detail + '■ 名前：' + r.name + '\n■ メール：' + email + '\n■ 電話：' + tel + '\n■ 備考：' + note + '\n');
  }
}

function checkKey_(key) {
  var expected = String(readSettings_()['受付画面の合言葉'] || '').trim();
  if (!expected || String(key || '') !== expected) throw new Error('受付画面のURLが正しくありません。');
}

function findRow_(id) {
  var rows = readRows_();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][C['予約番号']]) === String(id)) return i + 2;
  }
  throw new Error('予約番号 ' + id + ' が見つかりません。');
}

function nextId_(rows) {
  var max = 0;
  rows.forEach(function (r) {
    var m = /(\d+)\s*$/.exec(String(r[C['予約番号']] || ''));
    if (m) max = Math.max(max, Number(m[1]));
  });
  var n = String(max + 1);
  while (n.length < 3) n = '0' + n;
  return 'K-' + n;
}

function listRule_(items) {
  return SpreadsheetApp.newDataValidation().requireValueInList(items, true).setAllowInvalid(false).build();
}

/** 前後の空白と制御文字を除き、数式として解釈されうる先頭記号（= + - @）を落とす */
function cleanText_(v, maxLen) {
  return String(v === undefined || v === null ? '' : v)
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .replace(/^[=+\-@\s]+/, '')
    .slice(0, maxLen);
}

function toHalfWidth_(s) {
  return s.replace(/[０-９]/g, function (ch) { return String.fromCharCode(ch.charCodeAt(0) - 0xFEE0); })
    .replace(/[‐‑–—―ー−－]/g, '-');
}

/** 設定シートの日付（Date または文字列）を yyyy-MM-dd に */
function toYmd_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, TZ, 'yyyy-MM-dd');
  var m = /(\d{4})\D+(\d{1,2})\D+(\d{1,2})/.exec(String(v || ''));
  if (!m) return '';
  return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
}

function addDays_(ymd, days) {
  var p = ymd.split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2]) + days));
  return d.toISOString().slice(0, 10);
}

/** yyyy-MM-dd → 2027年5月21日(金) */
function jpDate_(ymd) {
  var p = ymd.split('-');
  var d = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1, Number(p[2])));
  return Number(p[0]) + '年' + Number(p[1]) + '月' + Number(p[2]) + '日(' + '日月火水木金土'.charAt(d.getUTCDay()) + ')';
}

function yen_(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}
