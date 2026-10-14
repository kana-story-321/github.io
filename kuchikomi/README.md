# おみくじクッキー × 口コミ

QRコードを読む → クッキーを割って占い → 答え合わせの質問が伸びていく → 口コミ文章が育つ → コピーしてGoogleマップへ、という流れのスマホ向けページです。

## ファイル

| ファイル | 役割 |
|---|---|
| `config.js` | **お店ごとに書き換える場所。** 店名、Googleの口コミURL、商品＝キャラ、占い文、選択肢 |
| `index.html` / `style.css` / `app.js` | ページ本体 |
| `worker/` | AI中継サーバー（任意）。APIキーをブラウザに出さないために使います |

## 公開先

`https://ririo.ai-mottainai.jp/` で公開する設定です（リポジトリ直下の `CNAME`）。トップを開くと `kuchikomi/` に移動します。

1. GitHub の Settings → Pages で、公開元を `main` ブランチのルートにします。
2. Cloudflare（ai-mottainai.jp のDNS）に CNAME レコード `ririo` → `kana-story-321.github.io` を追加します。証明書の発行が終わるまでは、プロキシをオフ（DNS only）にしておきます。
3. Settings → Pages の Custom domain に `ririo.ai-mottainai.jp` が入っていることを確認し、「Enforce HTTPS」をオンにします。

## 使い方

1. `config.js` の `shopName` と `gbpReviewUrl` を設定します。`gbpReviewUrl` は、Googleビジネスプロフィールの「クチコミを依頼」で表示されるURLです。
2. 商品・キャラ・占い文を、お店の実際の商品に置き換えます。
3. 箱のシールごとにQRコードを分けたい場合は、URLの最後に `?p=商品ID` を付けます（例: `.../kuchikomi/?p=canele`）。そのキャラが出て、最初の質問ではその商品が選ばれた状態になります。
4. 動作確認で「今日のクッキー」をやり直したいときは、`?reset` を付けて開きます。

## AIで深掘りする（任意）

`config.js` の `aiEndpoint` が空のときは、AIを使わずにあらかじめ用意した質問と文章の組み立てで動きます。AIを使う場合は、次のように設定します。

```bash
cd worker
npm install
npx wrangler secret put ANTHROPIC_API_KEY   # Claude APIキーを登録
npx wrangler deploy                         # 表示されたURLを config.js の aiEndpoint に設定
```

- `/followup`: 甘さの質問と好みの質問のあとに、回答をもとに「もう一問だけ」の深掘り質問を作ります（1回の回答で最大2問）。
- `/compose`: 回答だけを材料に、次に買う人の役に立つ口コミ文章へ整えます。回答にないことは書かないよう指示しています。
- `wrangler.toml` の `ALLOWED_ORIGIN` を、ページを公開するURLに合わせてください。
- モデルは `wrangler.toml` の `MODEL` で変更できます（初期値は `claude-opus-5-5`）。`claude-haiku-5-5` にすると料金は大幅に下がり、応答も速くなります。

## アンケート結果を受け取る（任意）

`feedbackEndpoint` に Google Apps Script のウェブアプリURLを設定すると、回答（お店へのリクエストを含む）が送られます。スプレッドシートに貼るスクリプトの例は次のとおりです。

```js
function doPost(e) {
  const d = JSON.parse(e.postData.contents);
  SpreadsheetApp.getActiveSheet().appendRow([
    d.at, d.fortune.productId,
    d.answers.map(a => a.question + "：" + JSON.stringify(a.answer)).join("\n"),
    d.review,
  ]);
  return ContentService.createTextOutput("ok");
}
```

## 規約まわりで守っていること

- 特典（くわしい運勢・キャラ図鑑）は、占いとお店へのアンケートに対するもので、**Googleへの投稿を条件にしていません**。
- 評価に関係なく、全員に同じGoogle投稿ボタンを表示しています（レビューゲーティングをしない）。
- 文章はお客さん本人が編集してから投稿する前提で、「自分の言葉を足してね」と案内しています。
- お店へのリクエストは口コミの文章には入れず、お店だけに届けます。
