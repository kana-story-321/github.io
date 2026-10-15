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

`worker/` は Cloudflare Workers で動く中継サーバーで、`https://gbp-api.ai-mottainai.jp` で公開されます（`*.workers.dev` のURLは閉じています）。各店の `config.js` の `aiEndpoint` には `https://gbp-api.ai-mottainai.jp` を設定します。

- `/followup`: 回答をもとに「もう一問だけ」の深掘り質問を作ります（1回の回答で最大2問）。
- `/compose`: 回答だけを材料に、次に買う人の役に立つ口コミ文章へ整えます。回答にないことは書かないよう指示しています。
- モデルは `wrangler.toml` の `MODEL` で変更できます（初期値は費用の安い `claude-haiku-5-5`。お客さん1人あたり約0.1〜0.2円）。品質を上げたいときは `claude-sonnet-5-5` などに変えます。

### 自動デプロイ（GitHub Actions）

`main` ブランチの `worker/` 以下が変わると、`.github/workflows/deploy-worker.yml` が自動でデプロイします（Actions 画面から手動実行も可）。リポジトリの Settings → Secrets and variables → Actions に、次の3つを登録しておきます。

| シークレット | 中身 |
| --- | --- |
| `CLOUDFLARE_API_TOKEN` | Cloudflare のAPIトークン。テンプレート「Edit Cloudflare Workers」（Workers Scripts:Edit、Workers Routes:Edit、Account Settings:Read など）で作り、対象を自分のアカウントと `ai-mottainai.jp` ゾーンに絞ります。独自ドメインのDNSレコードを作るため、Zone の DNS:Edit も追加しておきます |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare のアカウントID |
| `ANTHROPIC_API_KEY` | Claude APIキー。デプロイのたびに Worker のシークレットとして登録されます |

`gbp-api.ai-mottainai.jp` のDNSレコードは、デプロイ時に Cloudflare が自動で作ります（同じ名前の CNAME があると失敗するので、先に作らないでください）。

手元からデプロイする場合:

```bash
cd worker
npm ci
npx wrangler secret put ANTHROPIC_API_KEY   # Claude APIキーを登録
npx wrangler deploy
```

### 使いすぎ・悪用への対策

有料のAPIを呼ぶので、次の制限をかけています。

- **呼び出し元の確認**: `Origin` が `wrangler.toml` の `ALLOWED_ORIGIN`（`https://gbp.ai-mottainai.jp`）と完全に一致しない呼び出しは 403 で断ります。手元で確認するときだけ、`ALLOW_LOCALHOST = "1"` にすると `http://localhost:8123` からも呼べます（例: `npx wrangler dev --var ALLOW_LOCALHOST:1`）。
- **大きさの制限**: 20KB を超える本文は 413 で断ります。
- **回数の制限**: 同じIPから60秒に20回を超えると 429 を返します（`wrangler.toml` の `[[ratelimits]]`）。

AIが使えないとき（エラーや制限にかかったとき）は、ページ側はAIなしの文章に自動で切り替わります。
