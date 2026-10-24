/**
 * 経理アシスタント：契約終了版
 * 解約したお客様のGASをこの中身で上書きする（tools/deploy-all.sh --stop 名前）。
 *   ・自動実行から呼ばれたら、自動実行をすべて消し、弊社が設定した鍵（APIキー・LINE）も消す
 *   ・メニューは「ご利用は終了しました」の案内だけになる
 *   ・帳簿と領収書（データ）には一切さわらない（法律上の保存期間があるため、お客様の手元に残す）
 * 権限（appsscript.json）は通常版と同じにしてある。違うとお客様に許可を求める画面が出てしまうため。
 */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('経理').addItem('ご利用は終了しました', '終了のご案内').addToUi();
}

function 終了のご案内() {
  stopAll_();
  SpreadsheetApp.getUi().alert('ご利用は終了しました',
    'これまでの帳簿と領収書は、Googleドライブの経理フォルダにそのまま残っています。\n' +
    '帳簿と領収書は法律で保存期間が決まっています（原則7年）。削除しないで保管してください。',
    SpreadsheetApp.getUi().ButtonSet.OK);
}

function stopAll_() {
  ScriptApp.getProjectTriggers().forEach(t => ScriptApp.deleteTrigger(t));
  PropertiesService.getScriptProperties().deleteAllProperties();
}

// 通常版の自動実行が呼ぶ関数（呼ばれたら、すべての自動実行を消す）
function 領収書をあつめる() { stopAll_(); }
function 続きを自動実行() { stopAll_(); }
function カード明細を取り込んで突き合わせる() { stopAll_(); }
function 経費仕分けの続き() { stopAll_(); }
function LINEの写真を読み取る() { stopAll_(); }

// 契約中に開いていたタブの古いメニューを押されたとき
function メニュー_領収書を集める() { 終了のご案内(); }
function メニュー_カード明細を仕分ける() { 終了のご案内(); }
function メニュー_判定し直す() { 終了のご案内(); }
function メニュー_前年を締める() { 終了のご案内(); }
function メニュー_状態を確認() { 終了のご案内(); }
function 初期設定() { 終了のご案内(); }

// LINEの受付（ウェブアプリ）が呼ばれても、何も保存しない。tools/deploy-all.sh --stop でウェブアプリもこの版に置き換える
function doPost() { return ContentService.createTextOutput('OK'); }
function doGet() { return ContentService.createTextOutput('OK'); }
