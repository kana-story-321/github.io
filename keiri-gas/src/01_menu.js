// ==========================================
// メニュー「経理」と初期設定
// ==========================================

function onOpen() {
  SpreadsheetApp.getUi().createMenu('経理')
    .addItem('今すぐ領収書を集める', 'メニュー_領収書を集める')
    .addItem('カード明細を取り込んで仕分ける', 'メニュー_カード明細を仕分ける')
    .addItem('未確認の行をAIで判定し直す', 'メニュー_判定し直す')
    .addSeparator()
    .addItem('前年を締める', 'メニュー_前年を締める')
    .addSeparator()
    .addItem('初期設定（最初に1回）', '初期設定')
    .addItem('状態を確認', 'メニュー_状態を確認')
    .addToUi();
}

function メニュー_領収書を集める() {
  const ss = SpreadsheetApp.getActive();
  ss.toast('領収書を集めています（数分かかることがあります）', '経理', 10);
  const r = 領収書をあつめる();
  if (!r) { ss.toast('ほかの処理が動いています。少し待ってから、もう一度押してください。', '経理', 10); return; }
  const more = r.left > 0 ? `残り${r.left}件は、このあと自動で続けます。` : '';
  ss.toast(`メール${r.processed}件を読み、${r.saved}件を保存しました。紙・PDF・LINEは${r.paper}件を保存しました。${more}`, '経理', 15);
}

function メニュー_カード明細を仕分ける() {
  const ss = SpreadsheetApp.getActive();
  ss.toast('カード明細の取り込みと仕分けをしています（数分かかることがあります）', '経理', 10);
  const r = 経費を仕分ける();
  if (!r) { ss.toast('ほかの処理が動いています。少し待ってから、もう一度押してください。', '経理', 10); return; }
  ss.toast('終わりました。各年の帳簿の「カード突き合わせ」「経費仕分け」タブを見てください。', '経理', 15);
}

function メニュー_判定し直す() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('未確認の行をAIで判定し直します',
    '「確認」にチェックがなく、何も変えていない行を消して、もう一度判定します。チェックした行・変えた行はそのまま残ります。続けますか？',
    ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  const r = 未確認の行をAIで判定し直す();
  SpreadsheetApp.getActive().toast(r ? '判定し直しました。' : 'ほかの処理が動いています。少し待ってから、もう一度押してください。', '経理', 10);
}

function メニュー_状態を確認() {
  const lines = [`バージョン：${APP_VERSION}（AI：${MODEL_NAME}）`];
  lines.push(`Gemini APIキー：${geminiKey_() ? '設定済み' : '未設定（弊社で設定します）'}`);
  lines.push(`公式LINE：${lineToken_() ? '設定済み' : '未設定（弊社で設定します）'}`);
  lines.push(`LINEの受付の合言葉：${PROPS.getProperty('WEBHOOK_KEY') || '未設定（初期設定を実行してください）'}`);
  lines.push(`LINEの登録者：${setting_('LINEの登録者') ? setting_('LINEの登録者').split(',').filter(s => s).length + '人' : 'なし（公式LINEに連携コードを送ってください）'}`);
  lines.push(`毎日の自動実行：${ScriptApp.getProjectTriggers().filter(t => t.getEventType() === ScriptApp.EventType.CLOCK).length > 0 ? 'オン' : 'オフ（初期設定を実行してください）'}`);
  const years = yearRows_().map(y => `${y.year}年（${y.status || '記帳中'}）`);
  lines.push(`帳簿：${years.length > 0 ? years.join('、') : 'まだありません'}`);
  SpreadsheetApp.getUi().alert('経理アシスタントの状態', lines.join('\n'), SpreadsheetApp.getUi().ButtonSet.OK);
}


// ==========================================
// 初期設定（お客様のアカウントで1回だけ。何度実行しても壊れない）
// ==========================================
function 初期設定() {
  const ss = SpreadsheetApp.getActive();
  PROPS.setProperty('MANAGE_ID', ss.getId());   // テンプレートからコピーした直後は、テンプレートのIDが残っているので必ず書き直す
  if (!PROPS.getProperty('WEBHOOK_KEY')) PROPS.setProperty('WEBHOOK_KEY', Utilities.getUuid().replace(/-/g, ''));   // LINEの受付の合言葉
  ensureManagementSheets_(ss);

  // 経理フォルダ：テンプレートからコピーした直後は空。管理シートをそのフォルダに入れる
  let root = null;
  const id = setting_('経理フォルダID');
  if (id) {
    try {
      const f = DriveApp.getFolderById(id);
      const parents = DriveApp.getFileById(ss.getId()).getParents();
      while (parents.hasNext()) { if (parents.next().getId() === f.getId()) root = f; }
    } catch (e) { root = null; }
  }
  if (!root) {
    const name = safeName_(`経理_${setting_('屋号') || '事業'}`);
    root = DriveApp.createFolder(name);
    DriveApp.getFileById(ss.getId()).moveTo(root);
    setSetting_('経理フォルダID', root.getId());
  }
  getSubFolder_(root, INBOX_NAME);
  getSubFolder_(root, CARD_INBOX_NAME);

  // 今年の帳簿
  getYear_(Number(Utilities.formatDate(new Date(), TZ, 'yyyy')), true);

  // LINE連携コード
  if (!setting_('LINE連携コード')) setSetting_('LINE連携コード', String(Math.floor(100000 + Math.random() * 900000)));
  if (!setting_('取り込み開始日')) setSetting_('取り込み開始日', startDate_());

  // 毎日の自動実行（メールは4時、カード明細と仕分けは6時）
  const daily = { '領収書をあつめる': 4, 'カード明細を取り込んで突き合わせる': 6 };
  ScriptApp.getProjectTriggers()
    .filter(t => daily[t.getHandlerFunction()] !== undefined)
    .forEach(t => ScriptApp.deleteTrigger(t));
  Object.keys(daily).forEach(fn => {
    ScriptApp.newTrigger(fn).timeBased().everyDays(1).atHour(daily[fn]).inTimezone(TZ).create();
  });

  const todo = [];
  if (!setting_('事業の説明')) todo.push('・「設定」タブの「事業の説明」を書いてください（AIの仕分けの精度が上がります）');
  if (!geminiKey_()) todo.push('・Gemini APIキー：弊社で設定します');
  if (!lineToken_()) todo.push('・公式LINE：弊社で設定します');
  SpreadsheetApp.getUi().alert('初期設定が終わりました',
    `経理フォルダ「${root.getName()}」を作り、今年の帳簿を用意しました。毎日4時にメール、6時にカード明細を自動で処理します。\n\n` +
    `公式LINEを友だち追加して、連携コード「${setting_('LINE連携コード')}」を送ってください。` +
    (todo.length > 0 ? '\n\nこのあと必要なこと：\n' + todo.join('\n') : ''),
    SpreadsheetApp.getUi().ButtonSet.OK);
}

// 管理シートのタブをそろえる（足りないものだけ作る。中身は消さない）
function ensureManagementSheets_(ss) {
  const header = (sh, cols) => {
    if (sh.getLastRow() === 0) {
      sh.appendRow(cols);
      sh.setFrozenRows(1);
      sh.getRange(1, 1, 1, cols.length).setFontWeight('bold').setBackground('#DDEBF7');
    }
    return sh;
  };

  const st = header(getOrCreateSheet_(ss, SH_SETTINGS), ['項目', '値', '説明']);
  const have = st.getLastRow() >= 2 ? st.getRange(2, 1, st.getLastRow() - 1, 1).getValues().map(r => String(r[0]).trim()) : [];
  const add = SETTING_ITEMS.filter(it => have.indexOf(it[0]) < 0);
  if (add.length > 0) st.getRange(st.getLastRow() + 1, 1, add.length, 3).setValues(add);
  st.setColumnWidth(1, 160); st.setColumnWidth(2, 320); st.setColumnWidth(3, 480);
  st.getRange(2, 2, st.getLastRow() - 1, 1).setBackground('#FFF2CC');
  st.getRange(2, 1, st.getLastRow() - 1, 3).setWrap(true).setVerticalAlignment('top');
  SETTINGS_CACHE = null;

  header(getOrCreateSheet_(ss, SH_YEARS), YEAR_HEADERS);
  const rules = header(getOrCreateSheet_(ss, SH_RULES), RULE_HEADERS);
  if (rules.getLastRow() === 1 && DEFAULT_RULES.length > 0) rules.getRange(2, 1, DEFAULT_RULES.length, RULE_HEADERS.length).setValues(DEFAULT_RULES);
  header(getOrCreateSheet_(ss, SH_CARDS), ['会員番号の末尾', 'カードの名前', 'メモ']);
  // メールIDは文字のまま保存する（数字だけのIDが数値に変わると、同じメールだと分からなくなるため）
  header(getOrCreateSheet_(ss, SH_DONE), ['メールID', 'Message-ID', '処理日時', '結果', '保存した年']).hideSheet().getRange('A:B').setNumberFormat('@');
  header(getOrCreateSheet_(ss, SH_LIST), ['メールID', '見つけた日時']).hideSheet().getRange('A:A').setNumberFormat('@');

  // 最初からある空のシートは消す
  ['シート1', 'Sheet1'].forEach(n => {
    const s = ss.getSheetByName(n);
    if (s && s.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(s);
  });
  ss.setActiveSheet(st);
}


// ==========================================
// 弊社の作業用（エディタから実行する）
// ==========================================
// テンプレートのタブ（設定・年度一覧など）だけを作る。フォルダ・自動実行・鍵は作らない
// （お客様がコピーした直後に「設定」タブへ屋号などを書けるようにするため。テンプレートで初期設定は押さない）
function 管理用_テンプレートを準備する() {
  ensureManagementSheets_(SpreadsheetApp.getActive());
  console.log('テンプレートのタブを用意しました。');
}

// テンプレートを配る前に、作業用の値・自動実行・鍵をすべて消す（お客様のシートでは実行しない）
function 管理用_テンプレートを空にする() {
  const ss = SpreadsheetApp.getActive();
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  PROPS.deleteAllProperties();
  [SH_YEARS, SH_DONE, SH_LIST].forEach(n => {
    const sh = ss.getSheetByName(n);
    if (sh && sh.getLastRow() > 1) sh.deleteRows(2, sh.getLastRow() - 1);
  });
  ['屋号', '事業の説明', '取り込み開始日', '対象外のあて先', 'LINE連携コード', 'LINEの登録者', '経理フォルダID'].forEach(n => {
    if (settings_()[n] !== undefined) setSetting_(n, '');
  });
  console.log('テンプレート用に空にしました。');
}
