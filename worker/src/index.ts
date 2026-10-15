// 口コミページ用のAI中継サーバー（Cloudflare Workers）。
// ブラウザにAPIキーを置かないために、ページとClaude APIの間に挟みます。
//   POST /followup  … これまでの答えから「もう一問だけ」の深掘り質問を作る
//   POST /compose   … 答えから、次に買う人の役に立つ口コミ文章を作る
import Anthropic from "@anthropic-ai/sdk";

interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGIN: string;
  MODEL?: string;
  // "1" のときだけ http://localhost:8123 からの呼び出しを許可する（手元での確認用）
  ALLOW_LOCALHOST?: string;
  // wrangler.toml の [[ratelimits]]。手元の開発などで無いときは制限をかけない
  RATE_LIMITER?: RateLimit;
}

// 1回の呼び出しで受け付ける本文の大きさの上限（20KB）。回答は数KBに収まるので十分です。
const MAX_BODY_BYTES = 20 * 1024;
const LOCALHOST_ORIGIN = "http://localhost:8123";

interface SurveyContext {
  shopName: string;
  fortuneCharacter: string;
  products: string[];
  answers: { question: string; answer: string }[];
}

const FOLLOWUP_SYSTEM = `あなたは洋菓子店の口コミアンケートを設計する編集者です。
お客さんのこれまでの回答を読み、「次にこのお店で買う人が読んで役に立つ具体的な情報」を引き出す質問を1つだけ作ります。

方針:
- まだ聞いていない観点を選ぶ（例: 他の商品との比較、おすすめの食べ方、どんな人に向くか、サイズ感や食べきれる量、持ち帰りの状態）。
- 回答者の言葉を少し引用して、その人向けの質問だと感じられるようにする。
- 中立に聞く。良い評価だけを誘導しない。選択肢には、否定的・中間的な答えも必ず1つ入れる。
- 星の数や点数は聞かない。個人情報は聞かない。
- 質問文は30文字以内、選択肢は3〜6個・各14文字以内の、やさしい話し言葉。
- 役に立つ質問が思いつかないときは ask を false にする。`;

const COMPOSE_SYSTEM = `あなたは、お客さんのアンケート回答を、本人の口コミ文章に整える手伝いをします。
出来上がった文章は、お客さん本人が確認・編集してからGoogleマップに投稿します。

ルール:
- 回答に書かれていることだけを使う。回答にない感想・事実・数字を足さない。大げさにしない。
- 否定的・中間的な回答はそのまま正直に残す。
- 次に買う人の役に立つ順に書く: 何を買ったか → 食感・味・甘さ → どんな人・シーンに向くか → 知っておくと便利なこと。
- 一人称の自然な話し言葉で、120〜250文字程度。広告っぽい表現、ハッシュタグ、絵文字は使わない。
- 占いやアンケートのことには触れない。「（スキップ）」の項目は使わない。`;

const FOLLOWUP_SCHEMA = {
  type: "object",
  properties: {
    ask: { type: "boolean" },
    title: { type: "string" },
    sub: { type: "string" },
    options: { type: "array", items: { type: "string" } },
    multi: { type: "boolean" },
  },
  required: ["ask", "title", "sub", "options", "multi"],
  additionalProperties: false,
};

const COMPOSE_SCHEMA = {
  type: "object",
  properties: { review: { type: "string" } },
  required: ["review"],
  additionalProperties: false,
};

// 呼び出しを許すページのURL（Origin）かどうか。完全一致だけを認める
function isAllowedOrigin(env: Env, origin: string | null): origin is string {
  if (!origin) return false;
  if (origin === env.ALLOWED_ORIGIN) return true;
  return env.ALLOW_LOCALHOST === "1" && origin === LOCALHOST_ORIGIN;
}

function cors(origin: string): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    Vary: "Origin",
  };
}

function json(body: unknown, status: number, headers: Record<string, string>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...headers, "Content-Type": "application/json; charset=utf-8" } });
}

// 本文を上限つきで読む。上限を超えたら途中で読むのをやめて null を返す
async function readBody(request: Request): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (!Number.isFinite(declared) || declared > MAX_BODY_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let offset = 0;
  for (const c of chunks) {
    buf.set(c, offset);
    offset += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function parseContext(raw: unknown): SurveyContext | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<SurveyContext>;
  if (!Array.isArray(r.answers)) return null;
  const clip = (s: unknown, n: number) => String(s ?? "").slice(0, n);
  return {
    shopName: clip(r.shopName, 60),
    fortuneCharacter: clip(r.fortuneCharacter, 60),
    products: Array.isArray(r.products) ? r.products.slice(0, 30).map((p) => clip(p, 40)) : [],
    answers: r.answers.slice(0, 30).map((a) => ({ question: clip(a?.question, 120), answer: clip(a?.answer, 400) })),
  };
}

function describe(ctx: SurveyContext): string {
  const lines = ctx.answers.map((a) => `Q. ${a.question}\nA. ${a.answer}`).join("\n\n");
  return `店名: ${ctx.shopName}\n取り扱い商品: ${ctx.products.join("、")}\n\n<回答>\n${lines}\n</回答>`;
}

async function ask(env: Env, system: string, userText: string, schema: Record<string, unknown>): Promise<unknown | null> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const response = await client.beta.messages.create({
    model: env.MODEL || "claude-opus-5-5",
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: userText }],
    // お客さんを待たせないよう、考える量は少なめに
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    // 安全判定で断られたときに、別モデルで自動的にやり直す
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
  });
  if (response.stop_reason === "refusal" || response.stop_reason === "max_tokens") return null;
  const text = response.content.find((b) => b.type === "text");
  if (!text || text.type !== "text") return null;
  try {
    return JSON.parse(text.text);
  } catch {
    return null;
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // 決められたページ以外（他のサイトや、Originを付けない直接の呼び出し）は断る
    const origin = request.headers.get("Origin");
    if (!isAllowedOrigin(env, origin)) return json({ error: "forbidden" }, 403, {});
    const headers = cors(origin);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "POST") return json({ error: "method not allowed" }, 405, headers);

    // 同じIPからの呼び出しすぎを止める（有料APIを使い込まれないように）
    if (env.RATE_LIMITER) {
      const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return json({ error: "too many requests" }, 429, { ...headers, "Retry-After": "60" });
    }

    const body = await readBody(request);
    if (body === null) return json({ error: "payload too large" }, 413, headers);
    const ctx = parseContext(parseJson(body));
    if (!ctx) return json({ error: "bad request" }, 400, headers);
    const path = new URL(request.url).pathname;

    try {
      if (path === "/followup") {
        const out = (await ask(env, FOLLOWUP_SYSTEM, describe(ctx), FOLLOWUP_SCHEMA)) as
          | { ask: boolean; title: string; sub: string; options: string[]; multi: boolean }
          | null;
        if (!out || !out.ask || out.options.length < 2) return json({ question: null }, 200, headers);
        return json({ question: { title: out.title, sub: out.sub, options: out.options.slice(0, 6), multi: out.multi } }, 200, headers);
      }
      if (path === "/compose") {
        const out = (await ask(env, COMPOSE_SYSTEM, describe(ctx), COMPOSE_SCHEMA)) as { review: string } | null;
        return json({ review: out?.review ?? null }, 200, headers);
      }
      return json({ error: "not found" }, 404, headers);
    } catch (err) {
      // ページ側はAIなしの文章に切り替わるので、ここでは静かに失敗を返す
      if (err instanceof Anthropic.RateLimitError) return json({ error: "busy" }, 503, headers);
      if (err instanceof Anthropic.APIError) return json({ error: "ai error" }, 502, headers);
      throw err;
    }
  },
};
