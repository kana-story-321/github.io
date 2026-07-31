/**
 * 第15回 W02 引受判定ツール (GAS + Gemini API + スプシ連動サイドバー)
 *
 * 使い方:
 *   1. スプシメニュー「引受判定」→「判定ツールを開く」
 *   2. サイドバーで 顧客情報 + 検討中の商品 を入力
 *   3. 「判定する」ボタン → Gemini が マスタ表を参照して判定
 *   4. 結果は画面表示 + 「判定履歴」シートに自動保存
 *
 * 事前準備:
 *   スクリプトプロパティに GEMINI_API_KEY を設定
 *   (取得: https://aistudio.google.com/apikey)
 */

const MASTER_SHEET = '引受判定マスタ';
const HISTORY_SHEET = '判定履歴';
const MODEL = 'gemini-flash-latest';  // 常に最新の Flash モデルを使う (2.5-flash 等の固定バージョンは新規利用不可になることがある)

// ═══════════════════════════════════════════════════════════
// カスタムメニュー
// ═══════════════════════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('引受判定')
    .addItem('判定ツールを開く', 'showSidebar')
    .addSeparator()
    .addItem('判定履歴シートを初期化', 'initHistorySheet')
    .addItem('セットアップ確認 (ログに出力)', 'testSetup')
    .addToUi();
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile('Sidebar')
    .setTitle('引受判定ツール')
    .setWidth(360);
  SpreadsheetApp.getUi().showSidebar(html);
}

// ═══════════════════════════════════════════════════════════
// サイドバーから呼ばれる API 群 (google.script.run)
// ═══════════════════════════════════════════════════════════

/**
 * 商品リストを取得(サイドバーのドロップダウン用)
 * マスタ表から (保険会社 × 商品名) のユニーク組合せを返す
 */
function getProductList() {
  const rows = readMasterTable_();
  const seen = new Set();
  const products = [];
  for (const r of rows) {
    const key = `${r.company} / ${r.product}`;
    if (!seen.has(key)) {
      seen.add(key);
      products.push(key);
    }
  }
  return products.sort();
}

/**
 * 引受判定を実行 (メイン)
 * input = { age, gender, health, job, history, other, productKey }
 */
function runJudgment(input) {
  const [company, product] = input.productKey.split(' / ').map(s => s.trim());
  const master = readMasterTable_();

  // 検討商品のルールだけ抽出(プロンプト短縮 + 精度向上)
  const relevantRules = master.filter(r =>
    r.company === company && r.product === product
  );

  if (relevantRules.length === 0) {
    return {
      ok: false,
      error: `商品「${input.productKey}」のルールがマスタ表に見つかりません`,
    };
  }

  const prompt = buildPrompt_(input, company, product, relevantRules);
  const result = callGemini_(prompt);
  saveHistory_(input, company, product, result);

  return { ok: true, result: result };
}

// ═══════════════════════════════════════════════════════════
// マスタ表の読み込み
// ═══════════════════════════════════════════════════════════
function readMasterTable_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MASTER_SHEET);
  if (!sh) throw new Error(`シート「${MASTER_SHEET}」が見つかりません`);

  const data = sh.getDataRange().getValues();
  const rows = [];
  for (const r of data) {
    if (!String(r[0]).startsWith('RULE-')) continue;
    rows.push({
      ruleId:    r[0],
      company:   r[1],
      product:   r[2],
      category:  r[3],
      condition: r[4],
      verdict:   r[5],
      reason:    r[6],
      action:    r[7],
      source:    r[8],
    });
  }
  return rows;
}

// ═══════════════════════════════════════════════════════════
// プロンプト構築
// ═══════════════════════════════════════════════════════════
function buildPrompt_(input, company, product, rules) {
  const rulesText = rules.map(r =>
    `- [${r.ruleId}] カテゴリ:${r.category} / 条件:${r.condition} / 判定:${r.verdict} / 理由:${r.reason} / 対応:${r.action}`
  ).join('\n');

  const customerText = [
    `年齢: ${input.age || '未記入'}`,
    `性別: ${input.gender || '未記入'}`,
    `健康状態: ${input.health || '特記なし'}`,
    `職業: ${input.job || '未記入'}`,
    `既往歴: ${input.history || '特記なし'}`,
    `その他: ${input.other || 'なし'}`,
  ].join(' / ');

  return `あなたは保険代理店の「引受判定サポートAI」です。
以下は「${company} ${product}」の引受判定ルール一覧です。

${rulesText}

これらのルールに照らして、次の顧客が「${company} ${product}」に申し込む場合、通るかを判定してください。

顧客情報: ${customerText}
検討中の商品: ${company} ${product}

【出力ルール】
- 該当ルールがある場合: verdict=そのルールの判定、ruleId=そのRULE-IDを返す
- 複数該当する場合: 最も厳しい判定(NO > 要確認 > YES条件付 > YES)を優先
- 該当ルールが1つも無い場合: verdict="該当なし"、ruleId="該当なし" とする(勝手にYESと判定しない)
- reason は必ず 1〜2文で
- action と nextStep は「顧客に何を伝えるか」「誰に確認するか」まで具体的に
- 最終判定は保険会社が行う旨を暗黙に前提として、代理店の中間見立てを返す`;
}

// ═══════════════════════════════════════════════════════════
// Gemini API 呼び出し (responseSchema で構造化出力を強制)
// ═══════════════════════════════════════════════════════════
function callGemini_(prompt) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('スクリプトプロパティ GEMINI_API_KEY が未設定です');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          verdict:  { type: 'string', enum: ['YES', 'YES(条件付)', '要確認', 'NO', '該当なし'] },
          ruleId:   { type: 'string' },
          reason:   { type: 'string' },
          action:   { type: 'string' },
          nextStep: { type: 'string' },
        },
        required: ['verdict', 'ruleId', 'reason', 'action', 'nextStep'],
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
  if (code !== 200) throw new Error(`Gemini API エラー (${code}): ${body.substring(0, 300)}`);

  const json = JSON.parse(body);
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini 応答が空です: ' + body.substring(0, 300));

  return JSON.parse(text);
}

// ═══════════════════════════════════════════════════════════
// 判定履歴シートに保存
// ═══════════════════════════════════════════════════════════
function saveHistory_(input, company, product, result) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(HISTORY_SHEET);
  if (!sh) sh = initHistorySheet();

  sh.appendRow([
    new Date(),
    company, product,
    input.age, input.gender, input.health, input.job, input.history, input.other,
    result.verdict, result.ruleId, result.reason, result.action, result.nextStep,
  ]);
}

function initHistorySheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(HISTORY_SHEET);
  if (!sh) sh = ss.insertSheet(HISTORY_SHEET);
  else sh.clear();

  const headers = ['判定日時', '保険会社', '商品名',
    '年齢', '性別', '健康状態', '職業', '既往歴', 'その他',
    '判定', '該当条件ID', '判定理由', '対応', '次のアクション'];
  sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  sh.getRange(1, 1, 1, headers.length)
    .setFontWeight('bold').setBackground('#0E7C86').setFontColor('#FFFFFF');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 140);
  sh.setColumnWidth(2, 100);
  sh.setColumnWidth(3, 160);
  sh.setColumnWidth(6, 220);
  sh.setColumnWidth(8, 200);
  sh.setColumnWidth(9, 180);
  sh.setColumnWidth(10, 90);
  sh.setColumnWidth(11, 100);
  sh.setColumnWidth(12, 260);
  sh.setColumnWidth(13, 260);
  sh.setColumnWidth(14, 260);
  return sh;
}

// ═══════════════════════════════════════════════════════════
// 診断・単体テスト (GAS エディタから直接実行)
// ═══════════════════════════════════════════════════════════

/** GEMINI_API_KEY & マスタ表 の設定を確認 */
function testSetup() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  Logger.log('GEMINI_API_KEY: ' + (key ? key.substring(0, 8) + '...(OK)' : '❌ 未設定'));

  try {
    const rows = readMasterTable_();
    Logger.log(`マスタ表 行数: ${rows.length}`);
    Logger.log(`商品リスト:\n  ${getProductList().join('\n  ')}`);
  } catch (e) {
    Logger.log('マスタ表エラー: ' + e.message);
  }
}

/** 高血圧185×A社医療プレミアム で判定テスト (演習回答例 ケース1) */
function testJudgment_case1() {
  const result = runJudgment({
    age: 45, gender: '男',
    health: '高血圧治療中(1年経過、収縮期185mmHg)',
    job: '会社員', history: '', other: '',
    productKey: 'A社生命 / 医療プレミアム',
  });
  Logger.log(JSON.stringify(result, null, 2));
}

/** 同じ顧客×D社医療ライト で再判定 (ケース2) */
function testJudgment_case2() {
  const result = runJudgment({
    age: 45, gender: '男',
    health: '高血圧治療中(1年経過、収縮期185mmHg)',
    job: '会社員',
    history: '過去1年入院なし・5年手術なし・がん治療なし',
    other: '',
    productKey: 'D社生命 / 医療ライト(緩和型)',
  });
  Logger.log(JSON.stringify(result, null, 2));
}

/** マスタにない条件で 該当なし が返るか (ケース3) */
function testJudgment_case3() {
  const result = runJudgment({
    age: 33, gender: '男',
    health: '健康状態問題なし', job: 'プロサッカー選手',
    history: '', other: '',
    productKey: 'A社生命 / 死亡プレミアム',
  });
  Logger.log(JSON.stringify(result, null, 2));
}
