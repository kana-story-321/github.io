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
