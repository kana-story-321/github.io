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
