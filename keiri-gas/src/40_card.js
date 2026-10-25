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
