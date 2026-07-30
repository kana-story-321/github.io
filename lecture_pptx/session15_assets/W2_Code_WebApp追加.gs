/**
 * 引受判定AI ─ Webアプリ版 追加コード
 *
 * このコードは 既存の Code_引受判定.gs に "追加" して使う。
 * (既存のサイドバー版の関数 readMasterTable_ / callGemini_ / getProductList
 *  等は そのまま流用)
 *
 * 使い方:
 *   1. Code_引受判定.gs を貼付済みのプロジェクトに、このファイルを追加
 *   2. HTMLファイル「WebApp」を作成、W2_WebApp.html の中身を貼付
 *   3. デプロイ → 新しいデプロイ → 種類「ウェブアプリ」
 *   4. 発行された URL でブラウザから使える
 *
 * 詳細は W3_デプロイ手順書.md を参照
 */

// ═══════════════════════════════════════════════════════════
// Web App エントリーポイント
// ═══════════════════════════════════════════════════════════
function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('WebApp')
    .setTitle('引受判定AI')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

// ═══════════════════════════════════════════════════════════
// Webアプリから呼ばれる: 商品リスト取得
// ═══════════════════════════════════════════════════════════
function getProductListForWebApp() {
  try {
    return { ok: true, list: getProductList() };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// Webアプリから呼ばれる: 判定実行
// ═══════════════════════════════════════════════════════════
function runJudgmentFromWebApp(webInput) {
  try {
    // Webフォーム形式 → 既存 runJudgment が期待する形式に変換
    const input = {
      productKey: webInput.productKey,
      age: webInput.age,
      gender: webInput.gender,
      health: buildHealthText_(webInput),
      job: webInput.job,
      history: webInput.history,
      other: webInput.other,
    };
    return runJudgment(input);
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════
// Webアプリ用: 個別項目を "健康状態" 文字列に組み立て
// (Webフォームでは 血圧・HbA1c・妊娠 等を個別入力させると入力しやすい)
// ═══════════════════════════════════════════════════════════
function buildHealthText_(w) {
  const parts = [];
  if (w.bp) parts.push(`血圧: ${w.bp}`);
  if (w.hba1c) parts.push(`HbA1c: ${w.hba1c}`);
  if (w.pregnancy) parts.push(`妊娠週数: ${w.pregnancy}週`);
  if (w.health) parts.push(w.health);
  return parts.join(' / ') || '特記なし';
}

// ═══════════════════════════════════════════════════════════
// テストシナリオ (WebApp のクイック読込ボタン用)
// ═══════════════════════════════════════════════════════════
function getTestScenariosForWebApp() {
  return [
    { name: '#1 高血圧180超 × A社医療', age: 45, gender: '男', job: '会社員',
      bp: '185mmHg', hba1c: '', pregnancy: '',
      health: '高血圧治療中(1年経過)', history: '', other: '',
      productKey: 'A社生命 / 医療プレミアム' },
    { name: '#2 同顧客 × D社医療ライト', age: 45, gender: '男', job: '会社員',
      bp: '185mmHg', hba1c: '', pregnancy: '',
      health: '高血圧治療中(1年経過)',
      history: '過去1年入院なし・5年手術なし・がん治療なし',
      other: '',
      productKey: 'D社生命 / 医療ライト(緩和型)' },
    { name: '#3 妊娠中 × A社医療', age: 28, gender: '女', job: '会社員',
      bp: '', hba1c: '', pregnancy: '10',
      health: '妊娠10週目', history: '', other: '',
      productKey: 'A社生命 / 医療プレミアム' },
    { name: '#4 がん既往3年 × C社Gold', age: 60, gender: '男', job: '会社員',
      bp: '', hba1c: '', pregnancy: '',
      health: '健康状態問題なし',
      history: 'がん治療完了3年経過、再発なし',
      other: '',
      productKey: 'C社生命 / がん保険Gold' },
    { name: '#5 78歳 × A社医療', age: 78, gender: '男', job: '元自営業',
      bp: '', hba1c: '', pregnancy: '',
      health: '健康状態問題なし', history: '', other: '',
      productKey: 'A社生命 / 医療プレミアム' },
    { name: '#6 消防士 × A社死亡', age: 35, gender: '男', job: '消防士',
      bp: '', hba1c: '', pregnancy: '',
      health: '健康状態問題なし', history: '',
      other: '希望保険金 3000万円',
      productKey: 'A社生命 / 死亡プレミアム' },
    { name: '#7 該当なしエッジ', age: 30, gender: '男', job: 'プロサッカー選手',
      bp: '', hba1c: '', pregnancy: '',
      health: '健康状態問題なし', history: '', other: '',
      productKey: 'A社生命 / 死亡プレミアム' },
    { name: '#8 糖尿病2型 良好', age: 42, gender: '女', job: '会社員',
      bp: '', hba1c: '6.5(直近1年安定)', pregnancy: '',
      health: '糖尿病2型 コントロール良好', history: '', other: '',
      productKey: 'A社生命 / 医療プレミアム' },
  ];
}

// ═══════════════════════════════════════════════════════════
// Webアプリ 起動時の初期化(判定履歴シートを事前に作成)
// ═══════════════════════════════════════════════════════════
function initForWebApp() {
  try {
    const list = getProductList();
    if (list.length === 0) {
      return { ok: false, error: 'マスタ表に商品がありません。「引受判定マスタ」シートを確認してください' };
    }
    return { ok: true, productCount: list.length };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
