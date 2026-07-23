/**
 * 第17回 W02 ライフプラン シミュレーション AI (GAS + Gemini API)
 *
 * 使い方:
 *   1. スプシメニュー「ライフプランAI」→「シミュレーション実行」
 *   2. 「顧客カルテ」シートの入力を読み込み、Gemini でシミュレーション生成
 *   3. 結果は「シミュレーション結果」「保険提案フック」シートに書き出し
 *   4. サイドバーにサマリを表示(グラフはスプシで自動生成)
 *
 * 事前準備:
 *   スクリプトプロパティに GEMINI_API_KEY を設定
 *   (取得: https://aistudio.google.com/apikey)
 */

const KARTE_SHEET       = '顧客カルテ';
const ASSUMPTION_SHEET  = '前提テーブル';
const RESULT_SHEET      = 'シミュレーション結果';
const HOOK_SHEET        = '保険提案フック';
const MODEL             = 'gemini-2.5-flash';

// ═══════════════════════════════════════════════════════════
// カスタムメニュー
// ═══════════════════════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('ライフプランAI')
    .addItem('▶ シミュレーション実行', 'runSimulation')
    .addItem('📄 顧客向けレポート出力 (PDF)', 'generateCustomerReport')
    .addSeparator()
    .addItem('サイドバーを開く(サマリ表示)', 'showSidebar')
    .addItem('結果シートを初期化', 'initResultSheets')
    .addItem('セットアップ確認 (ログ)', 'testSetup')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('ライフプランAI')
    .setWidth(360);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ═══════════════════════════════════════════════════════════
// メイン: シミュレーション実行
// ═══════════════════════════════════════════════════════════
function runSimulation() {
  const ui = SpreadsheetApp.getUi();
  try {
    const karte = readKarte_();
    const assumptions = readAssumptions_();

    ui.alert('シミュレーション開始',
      `顧客: ${karte['顧客名(仮名OK)'] || '(未入力)'} / 年齢 ${karte['年齢']}\n\nGemini に問い合わせます。30秒ほどお待ちください...`,
      ui.ButtonSet.OK);

    const prompt = buildPrompt_(karte, assumptions);
    const result = callGemini_(prompt);

    writeCashflowSheet_(result, karte);
    writeHookSheet_(result);

    ui.alert('シミュレーション完了',
      `年次CF表(${result.annual_cashflow.length}年)と保険提案フック(${result.insurance_hooks.length}件)を書き出しました。\n\n` +
      `【総評】\n${result.summary.comment.substring(0, 200)}...\n\n` +
      `サマリと詳細は「シミュレーション結果」シートを確認してください。`,
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════
// 顧客カルテを読み込む (項目/値 の縦2列)
// ═══════════════════════════════════════════════════════════
function readKarte_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(KARTE_SHEET);
  if (!sh) throw new Error(`シート「${KARTE_SHEET}」が見つかりません`);

  const data = sh.getDataRange().getValues();
  const karte = {};
  for (const r of data) {
    const key = String(r[0] || '').trim();
    const val = r[1];
    if (!key) continue;
    if (key.startsWith('■')) continue;
    if (key === '項目') continue;
    if (val === '' || val === null || val === undefined) continue;
    karte[key] = val;
  }

  // 必須チェック
  const required = ['年齢', '年収(額面)'];
  const missing = required.filter(k => karte[k] === undefined);
  if (missing.length > 0) {
    throw new Error(`必須項目が未入力です: ${missing.join(', ')}`);
  }
  return karte;
}

// ═══════════════════════════════════════════════════════════
// 前提テーブルを読み込む
// ═══════════════════════════════════════════════════════════
function readAssumptions_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(ASSUMPTION_SHEET);
  if (!sh) throw new Error(`シート「${ASSUMPTION_SHEET}」が見つかりません`);

  const data = sh.getDataRange().getValues();
  const asm = {};
  for (const r of data) {
    const key = String(r[0] || '').trim();
    const val = r[1];
    if (!key || key.startsWith('■') || key === '項目') continue;
    if (val === '' || val === null || val === undefined) continue;
    asm[key] = val;
  }
  return asm;
}

// ═══════════════════════════════════════════════════════════
// プロンプト構築
// ═══════════════════════════════════════════════════════════
function buildPrompt_(karte, assumptions) {
  const karteJson = JSON.stringify(karte, null, 2);
  const asmJson = JSON.stringify(assumptions, null, 2);

  return `あなたは保険代理店の「ライフプラン シミュレーション AI」です。
以下の顧客情報と前提条件をもとに、今後40年間の年次キャッシュフロー、家計サマリ、保険提案フック を JSON で返してください。

【顧客カルテ(万円単位)】
${karteJson}

【経済前提・教育費相場】
${asmJson}

【シミュレーション方針】
- シミュレーション期間: 40年(相談年〜+40年)
- 収入計算: 給与収入は 給与上昇率で年次調整、退職以降は年金収入(前提テーブル参照)
- 支出計算: 生活費+住居費+教育費+保険料+その他 の月額×12を年額に。物価上昇率で年次調整。
- 教育費: 子どもの年齢と進学予定に応じて 前提テーブルの相場を各年に加算
- 住宅ローン: 「住宅ローン 残期間」経過後は住居費から月ローン返済分を控除
- 特別支出: ライフイベント予定は指定年に一括計上、金額プラスは支出/マイナスは収入(退職金など)
- 老後医療費: 65歳以降は前提テーブルの追加月額を生活支出に加算
- 貯蓄残高: 前年末残高 + 当年年間収支 (初年度は「現在の貯蓄」+「投資商品」を初期値)

【出力形式】以下の JSON 構造で(全て数値は万円単位、小数点なし):

annual_cashflow: 40年ぶんの配列。各年 { year, age, income, expense, special, net, saving, memo }
  - year: 西暦
  - age: 相談者本人の年齢
  - income: 世帯収入(万円)
  - expense: 生活支出(万円)
  - special: 特別支出(万円、収入的なら負)
  - net: 年間収支 = income - expense - special
  - saving: 当年末貯蓄残高(万円)
  - memo: その年のイベントメモ(なければ空文字)

summary: {
  peak_saving_year: 最大貯蓄年(西暦),
  peak_saving_amount: その額(万円),
  lowest_saving_year: 最低貯蓄年(西暦),
  lowest_saving_amount: その額(万円),
  breakdown_year: 破綻年(西暦、破綻しないなら null),
  risk_periods: リスク期間の説明文(1〜2文),
  comment: 総評コメント(3〜5文、代理店が顧客に説明できるトーン)
}

insurance_hooks: 保険提案フックの配列(3〜5件)。各要素 { trigger, product_type, amount_hint, reason }
  - trigger: CF表のどこに注目したか(例: "2041年 教育費ピーク")
  - product_type: 推奨商品タイプ(学資保険/個人年金/医療保険/就業不能保険/定期保険/収入保障保険 等)
  - amount_hint: 推奨金額ヒント(例: "月額20万" "400万円" "月額5万×20年")
  - reason: 提案理由(2〜3文)

【重要】
- 数値計算はできるだけ正確に。前年貯蓄+当年収支=当年貯蓄 の累積を守る。
- 顧客の「気になるリスク」欄と「その他要望」欄は 必ず insurance_hooks に反映すること。
- 破綻(貯蓄マイナス)がある場合は summary.breakdown_year に明記し、対策を comment で提案。
- 最終判定・提案は 代理店が行う。AI は "計算とヒント" のみ提供する立場。`;
}

// ═══════════════════════════════════════════════════════════
// Gemini API 呼び出し (responseSchema で構造化強制)
// ═══════════════════════════════════════════════════════════
function callGemini_(prompt) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('スクリプトプロパティ GEMINI_API_KEY が未設定です');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const cashflowItem = {
    type: 'object',
    properties: {
      year:    { type: 'integer' },
      age:     { type: 'integer' },
      income:  { type: 'integer' },
      expense: { type: 'integer' },
      special: { type: 'integer' },
      net:     { type: 'integer' },
      saving:  { type: 'integer' },
      memo:    { type: 'string' },
    },
    required: ['year', 'age', 'income', 'expense', 'special', 'net', 'saving', 'memo'],
  };

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          annual_cashflow: { type: 'array', items: cashflowItem },
          summary: {
            type: 'object',
            properties: {
              peak_saving_year:    { type: 'integer' },
              peak_saving_amount:  { type: 'integer' },
              lowest_saving_year:  { type: 'integer' },
              lowest_saving_amount:{ type: 'integer' },
              breakdown_year:      { type: 'string' },  // nullable via string
              risk_periods:        { type: 'string' },
              comment:             { type: 'string' },
            },
            required: ['peak_saving_year', 'peak_saving_amount', 'lowest_saving_year',
                       'lowest_saving_amount', 'breakdown_year', 'risk_periods', 'comment'],
          },
          insurance_hooks: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                trigger:      { type: 'string' },
                product_type: { type: 'string' },
                amount_hint:  { type: 'string' },
                reason:       { type: 'string' },
              },
              required: ['trigger', 'product_type', 'amount_hint', 'reason'],
            },
          },
        },
        required: ['annual_cashflow', 'summary', 'insurance_hooks'],
      },
    },
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) throw new Error(`Gemini API エラー (${code}): ${body.substring(0, 400)}`);

  const json = JSON.parse(body);
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini 応答が空です: ' + body.substring(0, 400));

  return JSON.parse(text);
}

// ═══════════════════════════════════════════════════════════
// 「シミュレーション結果」シートに CF 表 + サマリ を書き出し
// ═══════════════════════════════════════════════════════════
function writeCashflowSheet_(result, karte) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(RESULT_SHEET);
  if (!sh) sh = ss.insertSheet(RESULT_SHEET);
  else sh.clear();

  // タイトル
  sh.getRange(1, 1).setValue(
    `■ ライフプランシミュレーション結果 ─ ${karte['顧客名(仮名OK)'] || '未記名'} 様 ` +
    `(相談日 ${karte['相談日'] || ''} / 相談時年齢 ${karte['年齢']}歳)`
  );
  sh.getRange(1, 1, 1, 8).merge()
    .setBackground('#FFF7E0').setFontWeight('bold').setFontSize(12).setFontColor('#1F3A5F');

  // CF表 ヘッダ
  const headers = ['年', '年齢', '世帯収入(万円)', '生活支出(万円)', '特別支出(万円)',
                   '年間収支(万円)', '貯蓄残高(万円)', '備考'];
  sh.getRange(2, 1, 1, headers.length).setValues([headers])
    .setBackground('#0E7C86').setFontColor('#FFFFFF').setFontWeight('bold');
  sh.setFrozenRows(2);

  // CF表 データ
  const rows = result.annual_cashflow.map(r =>
    [r.year, r.age, r.income, r.expense, r.special, r.net, r.saving, r.memo || '']);
  if (rows.length > 0) {
    sh.getRange(3, 1, rows.length, 8).setValues(rows);

    // 収支マイナスを赤 / 貯蓄200万以下を黄
    const netRange = sh.getRange(3, 6, rows.length, 1);
    const savingRange = sh.getRange(3, 7, rows.length, 1);
    const rules = sh.getConditionalFormatRules();
    rules.push(
      SpreadsheetApp.newConditionalFormatRule()
        .whenNumberLessThan(0).setBackground('#FDECEA')
        .setRanges([netRange]).build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenNumberLessThan(200).setBackground('#FFF7E0')
        .setRanges([savingRange]).build(),
      SpreadsheetApp.newConditionalFormatRule()
        .whenNumberLessThan(0).setBackground('#F5B7B1').setFontColor('#C0392B')
        .setRanges([savingRange]).build()
    );
    sh.setConditionalFormatRules(rules);
  }

  // 列幅
  [70, 60, 110, 110, 110, 110, 120, 260].forEach((w, i) => sh.setColumnWidth(i + 1, w));

  // サマリ
  const s = result.summary;
  let r = 3 + rows.length + 2;
  sh.getRange(r, 1).setValue('■ サマリ')
    .setFontSize(13).setFontWeight('bold').setFontColor('#1F3A5F');
  r++;

  const summary_rows = [
    ['最大貯蓄年',  `${s.peak_saving_year}年 (約 ${formatMan_(s.peak_saving_amount)})`],
    ['最低貯蓄年',  `${s.lowest_saving_year}年 (約 ${formatMan_(s.lowest_saving_amount)})`],
    ['破綻年',      s.breakdown_year && s.breakdown_year !== 'null' ? `${s.breakdown_year}年` : 'なし(全期間で貯蓄プラス維持)'],
    ['リスク期間',  s.risk_periods],
    ['総評コメント', s.comment],
  ];
  for (const [k, v] of summary_rows) {
    sh.getRange(r, 1).setValue(k).setFontWeight('bold').setFontColor('#1F3A5F');
    sh.getRange(r, 2, 1, 7).merge().setValue(v).setWrap(true);
    r++;
  }

  // グラフ生成 (貯蓄残高の推移)
  if (rows.length > 0) {
    const chart = sh.newChart()
      .setChartType(Charts.ChartType.LINE)
      .addRange(sh.getRange(2, 1, rows.length + 1, 1))  // 年
      .addRange(sh.getRange(2, 7, rows.length + 1, 1))  // 貯蓄残高
      .setPosition(r + 2, 1, 0, 0)
      .setOption('title', '貯蓄残高の推移(万円)')
      .setOption('width', 700)
      .setOption('height', 320)
      .setOption('colors', ['#0E7C86'])
      .setOption('legend', { position: 'none' })
      .build();
    sh.insertChart(chart);
  }
}

function formatMan_(v) {
  if (v == null) return '—';
  return v.toLocaleString('ja-JP') + '万円';
}

// ═══════════════════════════════════════════════════════════
// 「保険提案フック」シートに提案候補を書き出し
// ═══════════════════════════════════════════════════════════
function writeHookSheet_(result) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(HOOK_SHEET);
  if (!sh) sh = ss.insertSheet(HOOK_SHEET);
  else sh.clear();

  sh.getRange(1, 1).setValue('■ 保険提案フック ─ シミュレーション結果から抽出した提案候補');
  sh.getRange(1, 1, 1, 4).merge()
    .setBackground('#FFF7E0').setFontWeight('bold').setFontSize(12).setFontColor('#1F3A5F');

  const headers = ['トリガー', '推奨商品タイプ', '推奨金額ヒント', '提案理由'];
  sh.getRange(2, 1, 1, headers.length).setValues([headers])
    .setBackground('#0E7C86').setFontColor('#FFFFFF').setFontWeight('bold');
  sh.setFrozenRows(2);

  const rows = result.insurance_hooks.map(h => [h.trigger, h.product_type, h.amount_hint, h.reason]);
  if (rows.length > 0) {
    sh.getRange(3, 1, rows.length, 4).setValues(rows).setWrap(true).setVerticalAlignment('top');
  }

  [200, 180, 160, 400].forEach((w, i) => sh.setColumnWidth(i + 1, w));
  sh.getRange(3, 1, Math.max(1, rows.length), 4).setFontSize(11);
}

// ═══════════════════════════════════════════════════════════
// サイドバー用 API
// ═══════════════════════════════════════════════════════════
function getLatestSummary() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(RESULT_SHEET);
  if (!sh) return { ok: false, error: 'まだシミュレーション未実行です' };

  const data = sh.getDataRange().getValues();
  // 「■ サマリ」を探して、その後の5行を返す
  let idx = -1;
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).startsWith('■ サマリ')) { idx = i; break; }
  }
  if (idx === -1) return { ok: false, error: 'サマリが見つかりません' };

  const summary = {};
  for (let i = idx + 1; i < Math.min(idx + 6, data.length); i++) {
    summary[data[i][0]] = data[i][1];
  }

  // フック取得
  const hooksSh = ss.getSheetByName(HOOK_SHEET);
  let hooks = [];
  if (hooksSh) {
    const hd = hooksSh.getDataRange().getValues();
    hooks = hd.slice(2).filter(r => r[0]).map(r =>
      ({ trigger: r[0], product: r[1], amount: r[2], reason: r[3] }));
  }

  return { ok: true, summary, hooks };
}

// ═══════════════════════════════════════════════════════════
// 診断・テスト
// ═══════════════════════════════════════════════════════════
function testSetup() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  Logger.log('GEMINI_API_KEY: ' + (key ? key.substring(0, 8) + '...(OK)' : '❌ 未設定'));
  try {
    const k = readKarte_();
    Logger.log('顧客カルテ 項目数: ' + Object.keys(k).length);
    Logger.log('顧客カルテ プレビュー: ' + JSON.stringify(k, null, 2).substring(0, 500));
    const a = readAssumptions_();
    Logger.log('前提テーブル 項目数: ' + Object.keys(a).length);
  } catch (e) {
    Logger.log('エラー: ' + e.message);
  }
}

function initResultSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [RESULT_SHEET, HOOK_SHEET].forEach(name => {
    const sh = ss.getSheetByName(name);
    if (sh) sh.clear();
  });
  SpreadsheetApp.getUi().alert('結果シートを初期化しました');
}
