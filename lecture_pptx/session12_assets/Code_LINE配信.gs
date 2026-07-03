/**
 * 第12回 ワーク02 演習1+2 — LINE broadcast 配信 GAS
 *
 * 【何をするコード?】
 *   ・「配信予約」から「今日 & OK & 未配信」の1件を取り出し、
 *   ・LINE Messaging API の broadcast で全友だちに1コール送信、
 *   ・成功したら「配信済み」列に日時記録。
 *   ・月間通数(無料枠 200通) を監視、閾値超なら自動停止。
 *   ・エラー時は管理者にメール通知。
 *
 * 【なぜこの設計?】(意味を必ず問う)
 *   Q1. なぜ broadcast? 個別送信ではダメ?
 *       → 「全員一律」ならbroadcastが1コールで済み、通数管理も簡単。
 *          個別送信APIは友だちIDリストの管理も必要になり、無料枠でこぼれる。
 *   Q2. なぜ Webhook 設定を触ってはいけないの?
 *       → 既にLステップがWebhookを使っているから。上書きするとLステップの
 *          タグ自動付与や分岐配信が全部止まる。触るのは "送信用トークン" だけ。
 *   Q3. なぜ月間通数カウンターが必要?
 *       → 無料枠は月200通。超えると翌月まで送れない。事故防止のガードレール。
 *
 * 【セットアップ】
 *   1. LINE Developers でMessaging APIチャネルを作成
 *      https://developers.line.biz/console/
 *   2. 「Messaging API 設定」タブで「チャネルアクセストークン(長期)」を発行
 *      ★ Webhook 設定タブは絶対に開かない・触らない ★
 *   3. スクリプトプロパティに以下を設定
 *      LINE_CHANNEL_ACCESS_TOKEN = 上で発行したトークン
 *      ADMIN_EMAIL              = エラー時通知を受け取るメールアドレス
 *      MONTHLY_LIMIT            = 200 (無料枠の上限)
 *   4. 手動で sendOne() を実行して自分アカウントで到着確認
 *   5. 時間トリガー設定: 「トリガー」→ sendOne / 日タイマー / 午前9-10時
 */

const SHEET_QUEUE  = '配信予約';
const LINE_API     = 'https://api.line.me/v2/bot';

// ────────────────────────────────────────────────
// メイン: 今日 & OK & 未配信 の先頭1件を送る
// エディタから手動実行 or 時間トリガーから実行
// ────────────────────────────────────────────────
function sendOne() {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sh = ss.getSheetByName(SHEET_QUEUE);
    if (!sh) throw new Error('配信予約シートがありません');

    // 通数カウンター確認
    if (!checkQuotaOK_()) {
      Logger.log('[sendOne] 月間通数上限、スキップ');
      return;
    }

    // 対象行を探す (今日日付 & OK=TRUE系 & 配信済みが空)
    const values = sh.getDataRange().getValues();
    if (values.length < 2) { Logger.log('[sendOne] データなし'); return; }
    const header = values[0];
    const dateI  = header.indexOf('生成日時');
    const titleI = header.indexOf('タイトル');
    const bodyI  = header.indexOf('本文');
    const urlI   = header.indexOf('出典URL');
    const okI    = header.indexOf('OK/NG');
    const sentI  = header.indexOf('配信済み日時');

    const todayStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd');
    let targetRow = -1;
    let targetItem = null;
    for (let i = 1; i < values.length; i++) {
      const row = values[i];
      const dt = String(row[dateI] || '');
      const ok = String(row[okI] || '').toUpperCase();
      const sent = String(row[sentI] || '');
      if (dt.startsWith(todayStr) && (ok === 'OK' || ok === 'TRUE') && !sent) {
        targetRow = i + 1; // シート上の行番号
        targetItem = {
          title: row[titleI], body: row[bodyI], url: row[urlI],
        };
        break;
      }
    }
    if (targetRow < 0) {
      Logger.log('[sendOne] 送信対象なし (今日日付+OK+未配信)');
      return;
    }

    // 本文を組み立て(出典URL 必須)
    const text = targetItem.body + '\n\n出典: ' + targetItem.url;

    // 配信
    const ok = broadcast_(text);
    if (!ok) throw new Error('LINE API 送信失敗');

    // 送信済みマーク + 通数加算
    const nowStr = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
    sh.getRange(targetRow, sentI + 1).setValue(nowStr);
    incrementQuota_();
    Logger.log('[sendOne] 配信成功: ' + targetItem.title);
  } catch (err) {
    Logger.log('[sendOne] エラー: ' + err.message + ' / ' + err.stack);
    notifyAdmin_('LINE配信GASエラー', err.message + '\n\n' + err.stack);
  }
}

// ────────────────────────────────────────────────
// LINE Messaging API: broadcast
// 全友だちに1コールで送信
// ────────────────────────────────────────────────
function broadcast_(text) {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  if (!token) {
    Logger.log('[broadcast] LINE_CHANNEL_ACCESS_TOKEN 未設定');
    return false;
  }
  const res = UrlFetchApp.fetch(LINE_API + '/message/broadcast', {
    method: 'post',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    payload: JSON.stringify({
      messages: [{ type: 'text', text: text }],
    }),
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  Logger.log('[broadcast] HTTP ' + code + ' / ' + res.getContentText().slice(0, 200));
  return code === 200;
}

// ────────────────────────────────────────────────
// 通数カウンター (スクリプトプロパティに保存)
//   MONTH_YYYYMM   ... 現在の月(202607 等)、変わったらリセット
//   MONTHLY_COUNT  ... 今月の累積送信通数(友だち数 × 配信回数)
//   MONTHLY_LIMIT  ... 上限(200 等)
// ────────────────────────────────────────────────
function checkQuotaOK_() {
  const props = PropertiesService.getScriptProperties();
  const limit = Number(props.getProperty('MONTHLY_LIMIT') || '200');
  const nowYm = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMM');
  const savedYm = props.getProperty('MONTH_YYYYMM') || '';
  if (savedYm !== nowYm) {
    // 月が変わったのでリセット
    props.setProperty('MONTH_YYYYMM', nowYm);
    props.setProperty('MONTHLY_COUNT', '0');
    Logger.log('[quota] 月替わりリセット: ' + nowYm);
  }
  const count = Number(props.getProperty('MONTHLY_COUNT') || '0');
  const friends = getFollowerCount_();
  const projected = count + friends;
  Logger.log('[quota] 現在 ' + count + ' / 予定加算 ' + friends + ' / 上限 ' + limit);
  if (projected > limit) {
    notifyAdmin_(
      'LINE配信 月間通数上限到達',
      '現在' + count + '通、次回配信で' + projected + '通(上限' + limit + ')。今月の配信を停止します。'
    );
    return false;
  }
  return true;
}

function incrementQuota_() {
  const props = PropertiesService.getScriptProperties();
  const count = Number(props.getProperty('MONTHLY_COUNT') || '0');
  const friends = getFollowerCount_();
  props.setProperty('MONTHLY_COUNT', String(count + friends));
}

// ────────────────────────────────────────────────
// 友だち数の取得
//   LINE API から取れなければ、スクリプトプロパティ FRIEND_COUNT_FALLBACK を使う
// ────────────────────────────────────────────────
function getFollowerCount_() {
  const token = PropertiesService.getScriptProperties().getProperty('LINE_CHANNEL_ACCESS_TOKEN');
  const fallback = Number(
    PropertiesService.getScriptProperties().getProperty('FRIEND_COUNT_FALLBACK') || '20'
  );
  if (!token) return fallback;
  try {
    const dateStr = Utilities.formatDate(
      new Date(Date.now() - 2 * 24 * 60 * 60 * 1000), // 2日前(集計反映のズレ対策)
      'Asia/Tokyo', 'yyyyMMdd'
    );
    const res = UrlFetchApp.fetch(
      LINE_API + '/insight/followers?date=' + dateStr,
      { headers: { 'Authorization': 'Bearer ' + token }, muteHttpExceptions: true }
    );
    if (res.getResponseCode() !== 200) return fallback;
    const data = JSON.parse(res.getContentText());
    return data.followers || fallback;
  } catch (e) {
    return fallback;
  }
}

// ────────────────────────────────────────────────
// 管理者にメール通知
// ────────────────────────────────────────────────
function notifyAdmin_(subject, body) {
  const to = PropertiesService.getScriptProperties().getProperty('ADMIN_EMAIL');
  if (!to) {
    Logger.log('[notify] ADMIN_EMAIL 未設定、スキップ');
    return;
  }
  try {
    MailApp.sendEmail(to, '[LINE配信] ' + subject, body);
    Logger.log('[notify] メール送信: ' + subject);
  } catch (e) {
    Logger.log('[notify] メール送信失敗: ' + e.message);
  }
}

// ────────────────────────────────────────────────
// テスト用: 通数カウンターをリセット
// (閾値テスト後の後片付けにも使う)
// ────────────────────────────────────────────────
function resetQuotaCounter() {
  const props = PropertiesService.getScriptProperties();
  const nowYm = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMM');
  props.setProperty('MONTH_YYYYMM', nowYm);
  props.setProperty('MONTHLY_COUNT', '0');
  Logger.log('[resetQuota] リセット完了: ' + nowYm + ' / 0通');
}

// ────────────────────────────────────────────────
// テスト用: 上限を一時的に低くして自動停止を確認
// 実行後に MONTHLY_LIMIT を必ず 200 に戻すこと
// ────────────────────────────────────────────────
function testLowLimit() {
  PropertiesService.getScriptProperties().setProperty('MONTHLY_LIMIT', '10');
  Logger.log('MONTHLY_LIMIT を 10 に一時変更しました。テスト後 resetLimit200() を実行してください。');
}
function resetLimit200() {
  PropertiesService.getScriptProperties().setProperty('MONTHLY_LIMIT', '200');
  Logger.log('MONTHLY_LIMIT を 200 に戻しました。');
}

// ────────────────────────────────────────────────
// トリガー登録ヘルパ (平日朝9時に自動配信)
// ────────────────────────────────────────────────
function installDailyTrigger() {
  // 既存トリガーを削除
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'sendOne') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sendOne')
    .timeBased()
    .atHour(9)
    .everyDays(1)
    .create();
  Logger.log('[installTrigger] sendOne を毎日9-10時に登録しました');
}
