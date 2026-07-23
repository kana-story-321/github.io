/**
 * 第17回 W02 応用: 顧客向けレポート生成 (Google Docs → PDF)
 *
 * 使い方:
 *   1. 事前に メニュー「ライフプランAI」→「▶ シミュレーション実行」で結果を作る
 *   2. メニュー「ライフプランAI」→「📄 顧客向けレポート出力(PDF)」
 *   3. Google Docs と PDF が「ライフプランレポート」フォルダ内に保存される
 *   4. アラートに表示されるURLで開ける
 *
 * 生成内容:
 *   - 表紙 (レポート名 / お客様名 / 相談日 / 担当代理店)
 *   - お客様情報 (相談者 / 年収 / 家族 / 資産 / 主なライフイベント)
 *   - 総評 (AI総評コメント + 4指標)
 *   - 貯蓄残高の推移グラフ
 *   - 年次キャッシュフロー表 (40年)
 *   - 保険提案フック
 *   - 前提条件と免責事項
 */

const REPORT_FOLDER_NAME = 'ライフプランレポート';
const AGENCY_NAME = '(代理店名を Code_レポート生成.gs 冒頭で設定)';  // ← 各代理店で書き換え

// ═══════════════════════════════════════════════════════════
// メイン: 顧客向けレポート生成
// ═══════════════════════════════════════════════════════════
function generateCustomerReport() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const resultSheet = ss.getSheetByName(RESULT_SHEET);
  const hookSheet = ss.getSheetByName(HOOK_SHEET);

  if (!resultSheet) {
    SpreadsheetApp.getUi().alert('先に メニュー「▶ シミュレーション実行」で計算してください');
    return;
  }

  const karte = readKarte_();
  const asm = readAssumptions_();
  const customerName = karte['顧客名(仮名OK)'] || '未記名';
  const consultDate = formatDate_(karte['相談日']) || Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd');

  // Google Docs 新規作成
  const docTitle = `ライフプラン診断レポート_${customerName}様_${consultDate}`;
  const doc = DocumentApp.create(docTitle);
  const body = doc.getBody();
  body.clear();

  // 余白調整
  body.setMarginTop(50).setMarginBottom(50).setMarginLeft(50).setMarginRight(50);

  // ─── 表紙 ─────────────────────────────
  const titlePara = body.appendParagraph('ライフプラン診断レポート');
  titlePara.setHeading(DocumentApp.ParagraphHeading.TITLE)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  body.appendParagraph('').setSpacingAfter(20);

  body.appendParagraph(`${customerName} 様`)
    .setHeading(DocumentApp.ParagraphHeading.HEADING1)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  body.appendParagraph(`ご相談日: ${consultDate}`)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
    .editAsText().setFontSize(12);

  body.appendParagraph('').setSpacingAfter(40);
  body.appendParagraph(`担当代理店: ${AGENCY_NAME}`)
    .setAlignment(DocumentApp.HorizontalAlignment.CENTER)
    .editAsText().setFontSize(11).setForegroundColor('#555555');

  body.appendPageBreak();

  // ─── お客様情報サマリ ─────────────────
  body.appendParagraph('お客様情報').setHeading(DocumentApp.ParagraphHeading.HEADING1);

  const profileRows = [
    ['ご相談者',
     `${karte['年齢']}歳 ${karte['性別'] || ''}${karte['職業'] ? ' / ' + karte['職業'] : ''}`],
    ['ご年収(額面)', `${karte['年収(額面)']} 万円`],
    ['ご家族構成', formatFamily_(karte)],
    ['ご資産', `貯蓄 ${karte['現在の貯蓄'] || 0} 万円 + 投資 ${karte['投資商品(株/投信 等)'] || 0} 万円`],
    ['住宅ローン', formatMortgage_(karte)],
    ['月次支出', formatMonthly_(karte)],
    ['主なライフイベント', formatEvents_(karte)],
    ['気になるリスク', karte['気になるリスク'] || '特記なし'],
    ['ご要望', karte['その他要望'] || '特記なし'],
  ];
  buildTable_(body, profileRows, { headerColor: '#7C5F8A' });

  // ─── 総評 ─────────────────
  body.appendParagraph('').setSpacingAfter(16);
  body.appendParagraph('総評').setHeading(DocumentApp.ParagraphHeading.HEADING1);

  const summary = readSummaryFromSheet_(resultSheet);
  const commentPara = body.appendParagraph(summary['総評コメント'] || '');
  commentPara.editAsText().setFontSize(11).setLineSpacing(1.4);

  body.appendParagraph('').setSpacingAfter(10);

  const highlightRows = [
    ['最大貯蓄年',  summary['最大貯蓄年'] || '—'],
    ['最低貯蓄年',  summary['最低貯蓄年'] || '—'],
    ['破綻年',      summary['破綻年']     || '—'],
    ['リスク期間',  summary['リスク期間'] || '—'],
  ];
  buildTable_(body, highlightRows, { headerColor: '#C76B7A' });

  // ─── 貯蓄残高の推移グラフ ─────────
  body.appendParagraph('').setSpacingAfter(16);
  body.appendParagraph('貯蓄残高の推移').setHeading(DocumentApp.ParagraphHeading.HEADING1);

  const charts = resultSheet.getCharts();
  if (charts.length > 0) {
    try {
      const chartBlob = charts[0].getAs('image/png');
      const img = body.appendImage(chartBlob);
      // 画像の幅をページ幅に合わせる (最大 500pt)
      const targetWidth = 500;
      const ratio = targetWidth / img.getWidth();
      img.setWidth(targetWidth);
      img.setHeight(img.getHeight() * ratio);
    } catch (e) {
      body.appendParagraph('(グラフ画像の埋め込みに失敗しました。スプシ側で「シミュレーション結果」シートをご確認ください)')
        .editAsText().setFontSize(9).setForegroundColor('#C76B7A');
    }
  } else {
    body.appendParagraph('(グラフが見つかりません。シミュレーションを再実行してください)')
      .editAsText().setFontSize(9).setForegroundColor('#C76B7A');
  }

  // ─── 年次キャッシュフロー表 ─────────
  body.appendPageBreak();
  body.appendParagraph('年次キャッシュフロー(40年)').setHeading(DocumentApp.ParagraphHeading.HEADING1);
  body.appendParagraph('※ 万円単位。「年間収支」がマイナスは家計赤字、「貯蓄残高」がマイナスは家計破綻を示します。')
    .editAsText().setFontSize(9).setForegroundColor('#777777');

  // 結果シートから40年ぶんのCFデータを取得 (ヘッダー含む)
  const lastCfRow = 2 + 40;  // Row 2 = header, Row 3〜42 = 40年
  const cfDataRaw = resultSheet.getRange(2, 1, Math.min(41, resultSheet.getLastRow() - 1), 8).getValues();
  const cfData = cfDataRaw.map(row => row.map(v => v === '' || v === null ? '' : String(v)));

  const cfTable = body.appendTable(cfData);
  formatCFTable_(cfTable);

  // ─── 保険提案フック ─────────
  if (hookSheet && hookSheet.getLastRow() > 2) {
    body.appendParagraph('').setSpacingAfter(20);
    body.appendParagraph('保険提案フック(備えの候補)').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    body.appendParagraph('※ AI が試算結果から抽出した "備えの候補" です。実際の商品選定・可否は担当代理店にご相談ください。')
      .editAsText().setFontSize(9).setForegroundColor('#777777');

    const hookLast = hookSheet.getLastRow();
    const hookDataRaw = hookSheet.getRange(2, 1, hookLast - 1, 4).getValues();
    const hookData = hookDataRaw.map(row => row.map(v => v === '' || v === null ? '' : String(v)));
    const hookTable = body.appendTable(hookData);
    formatHookTable_(hookTable);
  }

  // ─── 前提条件と免責事項 ─────────
  body.appendPageBreak();
  body.appendParagraph('前提条件と免責事項').setHeading(DocumentApp.ParagraphHeading.HEADING1);

  body.appendParagraph('■ シミュレーションで用いた主要な前提').editAsText().setBold(true);
  const asmRows = [
    ['物価上昇率', String(asm['物価上昇率(年率)'] || '—')],
    ['給与上昇率', String(asm['給与上昇率(年率)'] || '—')],
    ['投資リターン', String(asm['投資リターン(年率)'] || '—')],
    ['老齢年金 夫婦月額', String(asm['老齢年金 夫婦月額'] || '—')],
    ['シミュレーション期間', String(asm['シミュレーション期間'] || '40年')],
  ];
  buildTable_(body, asmRows, { headerColor: '#7C5F8A' });

  body.appendParagraph('').setSpacingAfter(16);
  const disc = body.appendParagraph(
    '■ 免責事項\n' +
    '本レポートは AI と担当代理店の試算に基づく参考資料です。実際の家計状況、保険商品の可否、\n' +
    '税制・年金制度の適用は各保険会社および行政機関の判断・査定によります。\n' +
    '経済前提・教育費相場は最新の実態と乖離する場合があります。詳細は担当代理店にお問い合わせください。\n' +
    '本レポートに基づく行動の結果について、代理店および本レポート作成者は責任を負いかねます。'
  );
  disc.editAsText().setFontSize(9).setForegroundColor('#555555').setLineSpacing(1.3);

  // フッター (レポート生成情報)
  body.appendParagraph('').setSpacingAfter(20);
  const footer = body.appendParagraph(
    `\n本レポート生成日時: ${Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd HH:mm')} / ` +
    `担当代理店: ${AGENCY_NAME}`
  );
  footer.editAsText().setFontSize(8).setForegroundColor('#999999');
  footer.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

  doc.saveAndClose();

  // フォルダ整理 & PDF 化
  const folder = getOrCreateFolder_(REPORT_FOLDER_NAME);
  const docFile = DriveApp.getFileById(doc.getId());
  docFile.moveTo(folder);

  const pdfBlob = docFile.getAs('application/pdf').setName(`${docTitle}.pdf`);
  const pdfFile = folder.createFile(pdfBlob);

  // 完了アラート
  const ui = SpreadsheetApp.getUi();
  ui.alert('レポート生成完了',
    `お客様向けレポートを「${REPORT_FOLDER_NAME}」フォルダに保存しました。\n\n` +
    `📄 Google Docs (編集可):\n${doc.getUrl()}\n\n` +
    `📕 PDF (お客様配布用):\n${pdfFile.getUrl()}\n\n` +
    `※ Google Docs 側で 代理店名・ロゴ・カラーを調整してから PDF を再エクスポートすると、より "自社仕様" になります。`,
    ui.ButtonSet.OK);

  return { docUrl: doc.getUrl(), pdfUrl: pdfFile.getUrl() };
}

// ═══════════════════════════════════════════════════════════
// ヘルパー: 顧客カルテ整形
// ═══════════════════════════════════════════════════════════
function formatFamily_(karte) {
  const parts = [];
  if (karte['配偶者の有無'] === 'あり') {
    parts.push(`配偶者 ${karte['配偶者 年齢']}歳 (${karte['配偶者 職業'] || ''}, 年収 ${karte['配偶者 年収(額面)'] || 0} 万)`);
  }
  for (let i = 1; i <= 3; i++) {
    const age = karte[`子ども${['①','②','③'][i-1]} 年齢`];
    if (age && age !== 'なし') {
      parts.push(`子ども${i} ${age}歳 (${karte[`子ども${['①','②','③'][i-1]} 進学予定`] || ''})`);
    }
  }
  return parts.length ? parts.join(' / ') : '単身';
}

function formatMortgage_(karte) {
  if (karte['保有住宅の有無'] !== 'あり') return karte['保有住宅の有無'] || '—';
  return `残高 ${karte['住宅ローン 残高'] || 0} 万円 / 残 ${karte['住宅ローン 残期間'] || '-'} 年 / 金利 ${karte['住宅ローン 金利'] || '-'}%`;
}

function formatMonthly_(karte) {
  const items = ['生活費(食費・水道光熱・通信)', '住居費(ローン返済+管理費)', '教育費(現在の月額、塾等)', '保険料', 'その他(交際・娯楽・被服)'];
  const total = items.reduce((s, k) => s + (Number(karte[k]) || 0), 0);
  return `合計 約 ${total} 万円/月 (生活 ${karte['生活費(食費・水道光熱・通信)']||0} / 住居 ${karte['住居費(ローン返済+管理費)']||0} / 教育 ${karte['教育費(現在の月額、塾等)']||0} / 保険 ${karte['保険料']||0} / その他 ${karte['その他(交際・娯楽・被服)']||0})`;
}

function formatEvents_(karte) {
  const events = [];
  for (let i = 1; i <= 5; i++) {
    const m = ['①','②','③','④','⑤'][i-1];
    const when = karte[`イベント${m} 何年後`];
    const what = karte[`イベント${m} 内容と金額`];
    if (when && when !== 'なし' && what && what !== 'なし') {
      events.push(`${when}年後: ${what}`);
    }
  }
  return events.length ? events.join(' / ') : 'なし';
}

// ═══════════════════════════════════════════════════════════
// ヘルパー: シミュレーション結果シートからサマリを抽出
// ═══════════════════════════════════════════════════════════
function readSummaryFromSheet_(sheet) {
  const data = sheet.getDataRange().getValues();
  let idx = -1;
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).startsWith('■ サマリ')) { idx = i; break; }
  }
  if (idx === -1) return {};
  const s = {};
  for (let i = idx + 1; i < Math.min(idx + 6, data.length); i++) {
    if (data[i][0]) s[data[i][0]] = data[i][1];
  }
  return s;
}

// ═══════════════════════════════════════════════════════════
// ヘルパー: Docs テーブル作成
// ═══════════════════════════════════════════════════════════
function buildTable_(body, rows, opts) {
  opts = opts || {};
  const table = body.appendTable(rows);
  for (let r = 0; r < rows.length; r++) {
    const labelCell = table.getRow(r).getCell(0);
    labelCell.setBackgroundColor(opts.headerColor || '#0E7C86')
      .setWidth(150);
    labelCell.editAsText().setForegroundColor('#FFFFFF').setBold(true).setFontSize(10);

    const valueCell = table.getRow(r).getCell(1);
    valueCell.editAsText().setFontSize(11);
  }
  return table;
}

function formatCFTable_(table) {
  // ヘッダー行整形
  const header = table.getRow(0);
  for (let i = 0; i < header.getNumCells(); i++) {
    header.getCell(i).setBackgroundColor('#0E7C86');
    header.getCell(i).editAsText().setForegroundColor('#FFFFFF').setBold(true).setFontSize(9);
  }
  // データ行整形 (fontSize小さめ)
  for (let r = 1; r < table.getNumRows(); r++) {
    const row = table.getRow(r);
    for (let c = 0; c < row.getNumCells(); c++) {
      row.getCell(c).editAsText().setFontSize(9);
    }
    // 収支マイナス = 赤、貯蓄マイナス = 濃赤
    const net = row.getCell(5).getText();
    const saving = row.getCell(6).getText();
    if (net && !isNaN(Number(net)) && Number(net) < 0) {
      row.getCell(5).editAsText().setForegroundColor('#C0392B').setBold(true);
    }
    if (saving && !isNaN(Number(saving)) && Number(saving) < 0) {
      row.getCell(6).editAsText().setForegroundColor('#C0392B').setBold(true).setBackgroundColor('#FDECEA');
    } else if (saving && !isNaN(Number(saving)) && Number(saving) < 200) {
      row.getCell(6).setBackgroundColor('#FFF7E0');
    }
  }
}

function formatHookTable_(table) {
  const header = table.getRow(0);
  for (let i = 0; i < header.getNumCells(); i++) {
    header.getCell(i).setBackgroundColor('#E8A33D');
    header.getCell(i).editAsText().setForegroundColor('#FFFFFF').setBold(true).setFontSize(10);
  }
  for (let r = 1; r < table.getNumRows(); r++) {
    const row = table.getRow(r);
    for (let c = 0; c < row.getNumCells(); c++) {
      row.getCell(c).editAsText().setFontSize(10);
    }
  }
}

// ═══════════════════════════════════════════════════════════
// ヘルパー: フォルダ取得/作成 + 日付整形
// ═══════════════════════════════════════════════════════════
function getOrCreateFolder_(name) {
  const folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}

function formatDate_(v) {
  if (!v) return '';
  if (v instanceof Date) return Utilities.formatDate(v, 'JST', 'yyyy-MM-dd');
  return String(v);
}
