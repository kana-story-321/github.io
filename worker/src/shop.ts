// 公式LINEの自動返信が使うお店の情報。ホームページ（https://sweet-season-ririo.lovable.app/）の内容から作っています。
// 営業日と商品は、ホームページと同じデータベースから毎回読みます（ホームページの管理画面で変えれば、そのまま反映）。
// ここに書いていないことは、AIは答えずに担当者へ回します。内容が変わったらここを書き換えてください。

export const SHOP_NAME = 'Sweet Season "ririo"';
export const SITE_URL = "https://sweet-season-ririo.lovable.app/";

export const SHOP_INFO = `
■ お店
- 店名：Sweet Season "ririo"（スイートシーズン リリオ）
- 宮城県多賀城市の丘の上にある小さなお菓子屋さん＆お菓子教室。オーダーメイドスイーツの販売と、お菓子教室の二本柱。
- ホームページ：https://sweet-season-ririo.lovable.app/

■ 営業
- 営業時間：10:00〜18:00（営業日はカレンダーのとおり。下の「営業日」を参照）
- マルシェ＆イベント参加のため臨時休業の場合がある
- お菓子の自動販売機はお店の前にあり、年中無休・24時間いつでも購入できる（営業時間外・定休日も）

■ アクセス
- 住所：〒985-0834 宮城県多賀城市丸山1-14-7
- ※笠上トンネルの上。トンネル内に入らないよう注意
- 下馬駅から徒歩7分
- 駐車場3台あり（事前に連絡が必要）
- 電話：090-2972-5054
- 地図：https://www.google.com/maps/search/?api=1&query=宮城県多賀城市丸山1-14-7

■ 商品・購入方法
- オーダーメイドスイーツ：特別な日のためのオリジナルのお菓子を作る（内容・価格・日程は個別に相談）
- オンラインショップ（BASE）：https://sweetseason.base.shop/
- ふるさと納税（多賀城市）：蔵王琥珀卵とお菓子の詰合せ A／B／E など。https://www.furusato-tax.jp/product/detail/04301/5228851
- 紹介記事（PR TIMES）：https://prtimes.jp/main/html/rd/p/000000023.000105088.html

■ お菓子教室（少人数制・初心者歓迎。お一人でも、お友達とでも）
- 製菓 フリーコース（プライベートコース）：2時間〜2時間半／相談の上お好きなケーキを1台／5,500円（材料費・レシピ・試食込）
- 製菓 ディプロマコース（今田美奈子お菓子教室ディプロマ取得可能）：2時間〜2時間半／入会金5,000円／レッスン料8,800円／月1回（8月休み）年11回／基礎科・研究科（各11回）
- シュガーデコレーション（今田美奈子お菓子教室カリキュラム）：入会金5,000円／2時間半・月2回／月謝18,500円／年22回（8月休み）
- 予約フォーム：https://docs.google.com/forms/d/e/1FAIpQLSd3lriuPafFm3ogPDc609scmgevUg06qKk1jmCXDD0DQmisBw/viewform

■ その他
- お問い合わせフォーム：https://forms.gle/MdsZQNYM8J9w1TnJ9
- Instagram（新作やお教室の様子）：https://www.instagram.com/sweetseason_ririo
- おみくじクッキー（毎日1枚・キャラ図鑑）：公式LINEのメニュー「今日のおみくじ」から
`.trim();
