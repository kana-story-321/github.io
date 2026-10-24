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
