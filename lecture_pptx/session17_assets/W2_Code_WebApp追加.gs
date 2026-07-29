/**
 * W2 追加コード ─ Webアプリ版UI を使う場合
 *
 * このコードは Code_ライフプランAI.gs に "追加" する形で使う。
 * (メインの GAS 関数は流用、Webアプリ向けの doGet と runSimulationFromWebApp だけ追加)
 *
 * デプロイ方法は W3_デプロイ手順書_WebApp.md 参照。
 */

// ═══════════════════════════════════════════════════════════
// Web App エントリーポイント
// ═══════════════════════════════════════════════════════════
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('WebApp')
    .setTitle('ライフプランAI Web版')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ═══════════════════════════════════════════════════════════
// Webフォームからの入力を受けてシミュレーション実行
// スプシへの保存 + Gemini呼出 + Docs生成 まで一気通貫
// ═══════════════════════════════════════════════════════════
function runSimulationFromWebApp(input) {
  try {
    // 1. Webフォーム入力をスプシ「顧客カルテ」に書き込む
    writeInputToKarte_(input);

    // 2. 既存の readKarte_() + シミュレーション実行を再利用
    const karte = readKarte_();
    const assumptions = readAssumptions_();
    const prompt = buildPrompt_(karte, assumptions);
    const result = callGemini_(prompt);

    // 3. シート書き出し(既存関数を再利用)
    writeCashflowSheet_(result, karte);
    writeHookSheet_(result);

    // 4. Docsレポート生成 (Code_レポート生成.gs の関数)
    let docUrl = null;
    try {
      const doc = generateCustomerReport();  // returns { docUrl, pdfUrl } もしくは void
      docUrl = doc && doc.docUrl ? doc.docUrl : null;
    } catch (e) {
      // レポート生成失敗は許容 (シミュレーション自体は成功)
    }

    return {
      ok: true,
      result: {
        summary: result.summary,
        insurance_hooks: result.insurance_hooks,
        docUrl: docUrl,
      },
    };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// Webフォーム入力を スプシ「顧客カルテ」に書き込むヘルパー
// ═══════════════════════════════════════════════════════════
function writeInputToKarte_(input) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sh = ss.getSheetByName(KARTE_SHEET);
  if (!sh) throw new Error(`シート「${KARTE_SHEET}」が見つかりません`);

  // 顧客カルテの各項目を Webフォーム入力で上書き
  const mapping = {
    '顧客名(仮名OK)': input.customer_name || '',
    '相談日': Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd'),
    '年齢': input.age,
    '性別': input.gender || '',
    '職業': input.job || '',
    '年収(額面)': input.income,
    '想定退職年齢': input.retire_age,
    '配偶者の有無': input.spouse || 'なし',
    '配偶者 年齢': input.spouse_age,
    '配偶者 年収(額面)': input.spouse_income,
    '子ども① 年齢': input.children,  // 簡易的に子ども情報を1行にまとめる
    '現在の貯蓄': input.savings,
    '投資商品(株/投信 等)': input.invest,
    '住宅ローン 残高': input.loan,
    '住宅ローン 残期間': input.loan_years,
    '生活費(食費・水道光熱・通信)': input.monthly.living,
    '住居費(ローン返済+管理費)': input.monthly.housing,
    '教育費(現在の月額、塾等)': input.monthly.edu,
    '保険料': input.monthly.ins,
    'その他(交際・娯楽・被服)': input.monthly.other,
    '気になるリスク': input.risk || '',
    'その他要望': input.want || '',
  };

  const data = sh.getDataRange().getValues();
  for (let i = 0; i < data.length; i++) {
    const key = String(data[i][0] || '').trim();
    if (mapping.hasOwnProperty(key)) {
      sh.getRange(i + 1, 2).setValue(mapping[key]);
    }
  }
  SpreadsheetApp.flush();
}
