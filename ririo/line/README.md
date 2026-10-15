# 公式LINEとの連携

## しくみ

```
お店のQR（今まで印刷したものもそのまま使えます）
  └→ gbp.ai-mottainai.jp/ririo/ を開く
       └→ LINEの外なら、自動で LINE（LIFF）で開き直す
            └→ 初回だけ「ログインの許可」と「公式LINEの友だち追加」の画面
                 └→ おみくじクッキーのページ（図鑑は LINE アカウントに保存）

2回目以降：QRを読む／公式LINEのリッチメニュー → 同じページ
```

- 図鑑・相棒・今日のおみくじは LINE アカウントごとにサーバー（Cloudflare）へ保存されます。機種を変えても、Safari と LINE のどちらで開いても続きます。
- キャラがもらえるのは今までどおり1日1回、答え合わせを最後までしたときです。Google への投稿は条件にしていません。
- **AIの質問・口コミ文章は、公式LINEの友だちだけ**が使えます。友だちでない人も、AIなしの質問と文章で最後まで答えて Google に投稿できます。
- `?web=1` を付けると LINE を使わずにブラウザで開けます（お店の確認用）。

## お店側の設定（LINE Developers / LINE Official Account Manager）

1. **LINEログインのチャネルを作る**（LINE Developers）
   - プロバイダーは、公式LINEアカウントと同じものを選ぶ
   - 「チャネル基本設定」→「リンクされたLINE公式アカウント」に、お店の公式LINEを選ぶ
   - チャネルIDをメモ（数字10桁）
2. **LIFFアプリを追加**（同じチャネルの「LIFF」タブ）
   - サイズ：Full
   - エンドポイントURL：`https://gbp.ai-mottainai.jp/ririo/`
   - Scope：`openid` と `profile` にチェック
   - 友だち追加オプション：**On (Aggressive)** … ログインの直後に友だち追加の画面が出ます
   - LIFF ID をメモ（`1234567890-AbCdEfGh` のような形）
3. チャネルを「**公開済み**」にする（開発中のままだと、お客さんがログインできません）
4. LIFF ID・チャネルID・友だち追加URL（`https://lin.ee/Nf8u2Tf`）を設定ファイルに入れる
   - `ririo/config.js`：`liffId` と `lineUrl`
   - `worker/wrangler.toml`：`LINE_CHANNEL_ID`

## リッチメニュー（自動で設定されます）

GitHub の secret `LINE_CHANNEL_ACCESS_TOKEN` を登録すると、GitHub Actions（「LINE rich menu」）が
下の内容でリッチメニューを作り、全員のメニューに設定します（`ririo/line/richmenu.mjs`）。
画像を差し替えて main に入れれば、作り直されます。LINE Official Account Manager でメニューを作る必要はありません。


- 画像：[`richmenu.jpg`](richmenu.jpg)（2500×1686、テンプレートは「大・6分割（3×2）」）
  ホームページの雰囲気（クリーム地・ローズピンク・筆記体の英字）に合わせ、キャラは「おみくじ」「図鑑」だけ
- アクション

| 場所 | タイプ | 中身 |
|---|---|---|
| 上・左：今日のおみくじ | リンク | `https://liff.line.me/{LIFF ID}` |
| 上・中：キャラ図鑑 | リンク | `https://liff.line.me/{LIFF ID}?zukan=1` |
| 上・右：今月の営業日 | **テキスト** | `今月の営業日`（自動返信が、ホームページのカレンダーと同じ内容を返します） |
| 下・左：お菓子教室 | リンク | `https://sweet-season-ririo.lovable.app/#classes` |
| 下・中：ホームページ | リンク | `https://sweet-season-ririo.lovable.app/` |
| 下・右：アクセス | リンク | `https://sweet-season-ririo.lovable.app/#access` |

- メニューの表示：「表示する」（トークを開いたときに最初から出す）

## 自動返信（AI）と手動対応の切り替え

```
お客さまがメッセージを送る
 ├ 営業日・営業時間・場所・駐車場・教室の料金・オンラインショップなど
 │   → AIが、お店の情報とホームページの営業日カレンダーをもとに返信
 └ 教室の申し込み・オーダーの相談・駐車場の利用連絡・アレルギー・苦情・取材・「スタッフと話したい」など
     → AI「担当者から改めてご連絡いたします」
     → そのお客さまは「手動対応」に切り替わり（72時間）、AIは返信しない
     → お店の方のLINEに【要対応】の通知
     → お店の方は LINE公式アカウントのチャット（アプリ）から返信
```

- 営業日はホームページの管理画面のカレンダーをそのまま読みます。カレンダーを直せば、自動返信も変わります。
- お店の情報（住所、教室の料金など）は `worker/src/shop.ts` に書いてあります。変わったら書き換えます。
- お店の方の操作（お店の方のLINEから公式LINEに送る）
  - `管理者登録 合言葉` … 最初に1回。通知を受け取る人として登録（合言葉は REVIEW_ADMIN_KEY と同じ）
  - `ヘルプ` … 操作の一覧
  - `対応待ち` … 手動対応中のお客さまの一覧
  - `#コード 自動` / `#コード 手動` … AIに戻す／手動にする（コードは通知に書いてあります）
  - `名前 自動` / `名前 手動` … LINEの表示名の一部でも指定できます

### 設定
1. LINE Official Account Manager →「設定」→「Messaging API」を有効にする（プロバイダーはLINEログインと同じもの）
2. LINE Developers → そのMessaging APIチャネル
   - 「チャネル基本設定」のチャネルシークレット → GitHub の secret `LINE_CHANNEL_SECRET`
   - 「Messaging API設定」のチャネルアクセストークン（長期）を発行 → GitHub の secret `LINE_CHANNEL_ACCESS_TOKEN`
   - Webhook URL：`https://gbp-api.ai-mottainai.jp/line/webhook`、「Webhookの利用」をオン
3. LINE Official Account Manager →「応答設定」
   - チャット：オン（手動で返信するため）
   - Webhook：オン
   - 応答メッセージ（キーワードの自動応答）：オフ（AIと二重にならないように）
4. GitHub の secret `REVIEW_ADMIN_KEY`（合言葉）も登録し、公式LINEに `管理者登録 合言葉` と送る

## あいさつメッセージ（友だち追加されたとき）

```
友だち追加ありがとうございます🍪
Sweet Season ririo です。

下のメニュー「今日のおみくじ」から、毎日1枚おみくじクッキーが割れます。
食べたお菓子の感想を答えると、キャラが図鑑にたまって、相棒が育っていきます。

季節限定キャラが出るときは、こちらでお知らせしますね。
```

## 配信（送りすぎない）

- 季節限定キャラが出はじめるときだけ（例：「🎃 ハロウィン限定キャラ出現中！」）。月1〜2回まで。
- 「口コミを書いたら特典」のような配信はしない（Googleの規約・ステマ規制）。
