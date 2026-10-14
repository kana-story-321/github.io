# GBP 口コミ施策（gbp.ai-mottainai.jp）

Googleビジネスプロフィール（GBP）の口コミを集めるための、お店ごとのページを置くリポジトリです。`https://gbp.ai-mottainai.jp/<お店>/` で公開します。

| フォルダ | 内容 |
|---|---|
| `ririo/` | Sweet Season ririo のおみくじクッキー → https://gbp.ai-mottainai.jp/ririo/ |
| `worker/` | AI中継サーバー（全店共通・任意）。Claude APIキーをブラウザに出さないために使います |
| `index.html` | 一覧ページ |

お店を増やすときは、`ririo/` をコピーしてフォルダ名を変え、`config.js` を書き換え、`index.html` の一覧に追加します。

## 公開の設定（最初に1回だけ）

1. GitHub の Settings → Pages で、公開元を `main` ブランチのルートにします。
2. Cloudflare（ai-mottainai.jp のDNS）に CNAME レコード `gbp` → `kana-story-321.github.io` を追加します。証明書の発行が終わるまでは、プロキシをオフ（DNS only）にしておきます。
3. Settings → Pages の Custom domain が `gbp.ai-mottainai.jp`（リポジトリ直下の `CNAME`）になっていることを確認し、「Enforce HTTPS」をオンにします。

## AI中継サーバー（任意）

```bash
cd worker
npm install
npx wrangler secret put ANTHROPIC_API_KEY   # Claude APIキーを登録
npx wrangler deploy                         # 表示されたURLを各店の config.js の aiEndpoint に設定
```

- `/followup`: 回答をもとに「もう一問だけ」の深掘り質問を作ります（1回の回答で最大2問）。
- `/compose`: 回答だけを材料に、次に買う人の役に立つ口コミ文章へ整えます。回答にないことは書かないよう指示しています。
- 呼び出せるのは `wrangler.toml` の `ALLOWED_ORIGIN`（`https://gbp.ai-mottainai.jp`）からだけです。
- モデルは `wrangler.toml` の `MODEL` で変更できます（初期値は `claude-opus-5-5`）。`claude-haiku-5-5` にすると料金は大幅に下がり、応答も速くなります。
