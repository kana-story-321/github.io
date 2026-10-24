// ==========================================
// 経費仕分け（カード突き合わせの続きで動く）
//  - カード明細の全件と、カード以外で払った領収書を、その年の帳簿の「経費仕分け」タブに1行ずつ並べる
//  - 1行ずつ、区分（事業の経費／立替／個人／要確認）・勘定科目・事業の割合・理由を書く
//      1. まず管理シートの「仕分けルール」（○○は事業の経費、など）を当てはめる
//      2. ルールに当てはまらないものは、Gemini が判定する（お客様がチェックした行を見本にする）
//  - お客様は「確認」にチェックを入れるだけ。AIと違うときだけ「〜（変える時だけ）」を選ぶ
//  - 「確定した区分」「確定した勘定科目」「経費になる金額」は自動で計算される（チェックした行だけ）
//  - 一度並べた行は消さない・書き換えない（お客様のチェックや変更は残る）。新しい支払いだけ下に足す
// ==========================================

const SHEET_SHIWAKE = '経費仕分け';
const SHIWAKE_HEADERS = ['取引日', '支払先', '金額（円）', '支払い方法', '領収書', '領収書のファイル', '品名',
  'AIの区分', 'AIの勘定科目', 'AIの事業割合(%)', 'AIの理由',
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
      const responses = fetchGeminiAll_(groups.map(g => geminiRequest_([{ text: shiwakePrompt_(g, examples) }])));
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
    row[SC('AIの理由') - 1] = safeCell_(j.reason);
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
    `=IF(AND(${R('確定した区分')}="事業の経費",ISNUMBER(${R('金額（円）')})),ROUND(${R('金額（円）')}*IF(${R('事業割合（変える時だけ）')}<>"",${R('事業割合（変える時だけ）')},IF(${R('AIの事業割合(%)')}<>"",${R('AIの事業割合(%)')},100))/100),"")`
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
