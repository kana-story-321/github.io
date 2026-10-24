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
    { "name": "品名（具体的に）", "category": "分類", "business_use": "事業で使いそう／個人っぽい／どちらとも言えない" }
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
