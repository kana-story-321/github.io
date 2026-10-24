// ==========================================
// 年を締める（確定申告が終わったら、お客様がメニューから実行する）
//  ・その年の帳簿の全タブをCSVで「控え」フォルダに保存する（Googleのアカウントに何かあったときの備え）
//  ・帳簿の全タブを保護する（持ち主のお客様以外は編集できなくなる。持ち主は「データ」→「シートと範囲を保護」から外せる）
//  ・年度一覧の状態を「締め済み」にする。以後、その年の取引日の書類は今年の帳簿に入り、チェック欄で知らせる
// ==========================================

function メニュー_前年を締める() {
  const ui = SpreadsheetApp.getUi();
  const year = Number(Utilities.formatDate(new Date(), TZ, 'yyyy')) - 1;
  const y = getYear_(year, false);
  if (!y) { ui.alert(`${year}年の帳簿はありません。`); return; }
  if (y.closed) { ui.alert(`${year}年はすでに締めています。`); return; }
  const ok = ui.alert(`${year}年を締めます`,
    `確定申告が終わってから実行してください。\n\n` +
    `・${year}年の帳簿の控え（CSV）を「${year}年/${BACKUP_NAME}」フォルダに保存します\n` +
    `・${year}年の帳簿を保護して、誤って書き換えられないようにします\n` +
    `・このあと届いた${year}年の書類は、今年の帳簿に入れてお知らせします\n\n続けますか？`,
    ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  // ほかの処理がこの年に書いている途中で締めないよう、同じ鍵をかけてから行う
  const done = withLock_(null, () => { closeYear_(y); return true; });
  ui.alert(done ? `${year}年を締めました。` : 'ほかの処理が動いています。数分待ってから、もう一度実行してください。');
}

function closeYear_(y) {
  // 1) 控え（CSV）
  const backup = getSubFolder_(y.folder, BACKUP_NAME);
  const stamp = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd');
  y.ss.getSheets().forEach(sh => {
    if (sh.getLastRow() === 0) return;
    const csv = sh.getDataRange().getDisplayValues()
      .map(r => r.map(c => /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c).join(','))
      .join('\r\n');
    backup.createFile(`${y.year}年_${sh.getName()}_${stamp}.csv`, '﻿' + csv, MimeType.CSV);
  });

  // 2) 保護（持ち主以外は編集できない）
  y.ss.getSheets().forEach(sh => {
    const p = sh.protect().setDescription(`${y.year}年は締め済み`);
    p.removeEditors(p.getEditors());
    if (p.canDomainEdit()) p.setDomainEdit(false);
  });

  // 3) 年度一覧
  const row = yearRows_().find(r => r.year === y.year);
  const sh = manage_().getSheetByName(SH_YEARS);
  sh.getRange(row.row, 4, 1, 2).setValues([[YEAR_CLOSED, Utilities.formatDate(new Date(), TZ, 'yyyy/MM/dd')]]);
  delete YEAR_CACHE[y.year];
  console.log(`${y.year}年を締めました。`);
}
