// 口コミページ用のAI中継サーバー（Cloudflare Workers）。
// ブラウザにAPIキーを置かないために、ページとClaude APIの間に挟みます。
//   POST /followup  … これまでの答えから「もう一問だけ」の深掘り質問を作る
//   POST /compose   … 答えから、次に買う人の役に立つ口コミ文章を作る
//   POST /state/load, /state/save … LINEでログインした人の図鑑・相棒を保存する
//   POST /reviews/submit … 「お店のサイトに載せてOK」の口コミを受け取る（お店が承認するまで非公開）
//   GET  /reviews        … 承認した口コミの一覧（お店のサイトが読む。誰でも読める）
//   GET  /reviews/photo/{id}/{n} … 承認した口コミの写真
//   POST /reviews/admin/list, /reviews/admin/set … 承認ページ（REVIEW_ADMIN_KEY が必要）
//   POST /line/webhook … 公式LINEの自動返信（linebot.ts）
// LINE_CHANNEL_ID を設定すると、AIの2つは「公式LINEの友だち」だけが使えるようになります
// （友だちでない人には、ページ側がAIなしの質問・文章で答えます）。
import Anthropic from "@anthropic-ai/sdk";
import { DurableObject } from "cloudflare:workers";
import { ShopBot, handleLineWebhook } from "./linebot";
export { ShopBot };

export interface Env {
  ANTHROPIC_API_KEY: string;
  ALLOWED_ORIGIN: string;
  MODEL?: string;
  // "1" のときだけ http://localhost:8123 からの呼び出しを許可する（手元での確認用）
  ALLOW_LOCALHOST?: string;
  // wrangler.toml の [[ratelimits]]。手元の開発などで無いときは制限をかけない
  RATE_LIMITER?: RateLimit;
  // LINEログインのチャネルID。空ならLINE連携なし（AIは誰でも使える）
  LINE_CHANNEL_ID?: string;
  USER_STATE: DurableObjectNamespace<UserState>;
  REVIEWS: DurableObjectNamespace<ReviewStore>;
  // 口コミの承認ページの合言葉（GitHub の secret REVIEW_ADMIN_KEY から登録）。未設定なら承認ページは使えない
  REVIEW_ADMIN_KEY?: string;
  // 公式LINEの自動返信（Messaging API）。どちらも GitHub の secret から登録。未設定なら自動返信はしない
  LINE_CHANNEL_SECRET?: string;
  LINE_CHANNEL_ACCESS_TOKEN?: string;
  LINE_API_BASE?: string; // 手元での確認用（ふだんは空）
  BOT: DurableObjectNamespace<ShopBot>;
  // ホームページ（Lovable）の営業日カレンダーを読むための、公開用の接続先
  SITE_SUPABASE_URL?: string;
  SITE_SUPABASE_KEY?: string;
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
async function readBody(request: Request, max = MAX_BODY_BYTES): Promise<string | null> {
  const declared = Number(request.headers.get("Content-Length") ?? "0");
  if (!Number.isFinite(declared) || declared > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > max) {
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

export async function ask(env: Env, system: string, userText: string, schema: Record<string, unknown>): Promise<unknown | null> {
  const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
  const model = env.MODEL || "claude-haiku-5-5";
  // 安全判定で断られたときに別モデルで自動的にやり直す設定は、対応しているモデルだけで使う（Haiku は非対応）
  const fallback = /^claude-(opus-5|sonnet-5-5|fable-5)/.test(model)
    ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }
    : {};
  const response = await client.beta.messages.create({
    model,
    max_tokens: 2000,
    system,
    messages: [{ role: "user", content: userText }],
    // お客さんを待たせないよう、考える量は少なめに
    output_config: { effort: "low", format: { type: "json_schema", schema } },
    ...fallback,
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

// ---------- LINE ----------
interface LineUser { userId: string; friend: boolean }
// 同じトークンを何度も確かめないよう、少しの間だけ覚えておく
const lineCache = new Map<string, { user: LineUser | null; until: number }>();

// ページから届いたLIFFのアクセストークンを、LINEのサーバーで確かめる
async function lineUser(env: Env, token: unknown): Promise<LineUser | null> {
  if (!env.LINE_CHANNEL_ID || typeof token !== "string" || !token || token.length > 1000) return null;
  const hit = lineCache.get(token);
  if (hit && hit.until > Date.now()) return hit.user;
  let user: LineUser | null = null;
  try {
    const v = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(token)}`);
    const vj = (await v.json()) as { client_id?: string; expires_in?: number };
    // 他のアプリ向けに発行されたトークンは受け付けない
    if (v.ok && vj.client_id === env.LINE_CHANNEL_ID && (vj.expires_in ?? 0) > 0) {
      const auth = { headers: { Authorization: `Bearer ${token}` } };
      const [pr, fr] = await Promise.all([fetch("https://api.line.me/v2/profile", auth), fetch("https://api.line.me/friendship/v1/status", auth)]);
      const profile = (await pr.json()) as { userId?: string };
      const friendship = (await fr.json()) as { friendFlag?: boolean };
      if (pr.ok && profile.userId) user = { userId: profile.userId, friend: fr.ok && friendship.friendFlag === true };
    }
  } catch {
    user = null;
  }
  if (lineCache.size > 500) lineCache.clear();
  lineCache.set(token, { user, until: Date.now() + (user ? 5 * 60_000 : 30_000) });
  return user;
}

// ---------- 図鑑の保存（LINEのユーザーごとに1つの Durable Object） ----------
interface SavedState {
  stages: Record<string, number[]>;
  zukan: Record<string, number>;
  graduated: string[];
  partner: { id: string; xp: number } | null;
  claimed: string | null;
  today: Record<string, unknown> | null;
}

const ID_RE = /^[a-z0-9-]{1,40}$/;
const DAY_RE = /^\d{4}-\d{1,2}-\d{1,2}$/;

// ページから届いた中身を、形と大きさを確かめてから使う
function cleanState(raw: unknown): SavedState {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const obj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
  const stages: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(obj(r.stages)).slice(0, 60)) {
    if (!ID_RE.test(k) || !Array.isArray(v)) continue;
    const list = [...new Set(v.filter((n): n is number => n === 1 || n === 2 || n === 3))];
    if (list.length) stages[k] = list;
  }
  const zukan: Record<string, number> = {};
  for (const [k, v] of Object.entries(obj(r.zukan)).slice(0, 60)) {
    if (ID_RE.test(k) && typeof v === "number" && Number.isFinite(v)) zukan[k] = Math.max(0, Math.min(100000, Math.floor(v)));
  }
  const graduated = Array.isArray(r.graduated) ? r.graduated.filter((x): x is string => typeof x === "string" && ID_RE.test(x)).slice(0, 60) : [];
  const p = obj(r.partner);
  const partner = typeof p.id === "string" && ID_RE.test(p.id) && typeof p.xp === "number" && Number.isFinite(p.xp)
    ? { id: p.id, xp: Math.max(0, Math.min(1000, Math.floor(p.xp))) } : null;
  const claimed = typeof r.claimed === "string" && DAY_RE.test(r.claimed) ? r.claimed : null;
  const today = r.today && typeof r.today === "object" && JSON.stringify(r.today).length < 4000 ? (r.today as Record<string, unknown>) : null;
  return { stages, zukan, graduated, partner, claimed, today };
}

const dayNum = (d: string | null) => (d ? d.split("-").reduce((n, x) => n * 100 + Number(x), 0) : 0);

// 2台のスマホなどで別々にためた分も消えないよう、多いほうに合わせて足し合わせる
function mergeState(a: SavedState, b: SavedState): SavedState {
  const stages: Record<string, number[]> = { ...a.stages };
  for (const [k, v] of Object.entries(b.stages)) stages[k] = [...new Set([...(stages[k] || []), ...v])].sort();
  const zukan: Record<string, number> = { ...a.zukan };
  for (const [k, v] of Object.entries(b.zukan)) zukan[k] = Math.max(zukan[k] || 0, v);
  const partner = !a.partner ? b.partner : !b.partner ? a.partner : b.partner.xp > a.partner.xp ? b.partner : a.partner;
  const claimed = dayNum(b.claimed) > dayNum(a.claimed) ? b.claimed : a.claimed;
  const todayDay = (t: SavedState["today"]) => (t && typeof t.date === "string" ? dayNum(t.date) : 0);
  const today = todayDay(b.today) > todayDay(a.today) ? b.today : a.today || b.today;
  return { stages, zukan, graduated: [...new Set([...a.graduated, ...b.graduated])], partner, claimed, today };
}

export class UserState extends DurableObject<Env> {
  async load(): Promise<SavedState> {
    return cleanState(await this.ctx.storage.get("state"));
  }
  async save(incoming: SavedState): Promise<SavedState> {
    const merged = mergeState(cleanState(await this.ctx.storage.get("state")), incoming);
    await this.ctx.storage.put("state", merged);
    return merged;
  }
}

// ---------- お店のサイトに載せる口コミ ----------
// 1店舗分を1つの Durable Object（SQLite）にためる。写真は縮小済みのJPEGをそのまま保存
const MAX_REVIEW_BYTES = 900 * 1024; // 写真3枚まで入るように、ここだけ大きめ
const PHOTO_RE = /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/;

interface ReviewIn { text: string; product: string; photos: string[] }
interface ReviewRow { id: string; created: number; product: string; text: string; status: string; photos: number }

function cleanReview(raw: Record<string, unknown>): ReviewIn | null {
  const text = typeof raw.text === "string" ? raw.text.trim().slice(0, 1000) : "";
  if (text.length < 10) return null;
  const product = typeof raw.product === "string" ? raw.product.trim().slice(0, 40) : "";
  const photos = Array.isArray(raw.photos)
    ? raw.photos.filter((p): p is string => typeof p === "string" && p.length < 280 * 1024 && PHOTO_RE.test(p)).slice(0, 3) : [];
  return { text, product, photos };
}

export class ReviewStore extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY, created INTEGER, product TEXT, text TEXT, status TEXT, photos INTEGER)`);
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS photos (review_id TEXT, n INTEGER, data TEXT, PRIMARY KEY (review_id, n))`);
  }
  async submit(r: ReviewIn): Promise<string> {
    const id = crypto.randomUUID().slice(0, 12);
    this.ctx.storage.sql.exec("INSERT INTO reviews VALUES (?, ?, ?, ?, 'pending', ?)", id, Date.now(), r.product, r.text, r.photos.length);
    r.photos.forEach((data, n) => this.ctx.storage.sql.exec("INSERT INTO photos VALUES (?, ?, ?)", id, n, data));
    return id;
  }
  async list(status: string | null, limit: number): Promise<ReviewRow[]> {
    const rows = status
      ? this.ctx.storage.sql.exec("SELECT * FROM reviews WHERE status = ? ORDER BY created DESC LIMIT ?", status, limit)
      : this.ctx.storage.sql.exec("SELECT * FROM reviews ORDER BY created DESC LIMIT ?", limit);
    return rows.toArray() as unknown as ReviewRow[];
  }
  async setStatus(id: string, status: string): Promise<boolean> {
    if (status === "deleted") {
      this.ctx.storage.sql.exec("DELETE FROM photos WHERE review_id = ?", id);
      return this.ctx.storage.sql.exec("DELETE FROM reviews WHERE id = ?", id).rowsWritten > 0;
    }
    return this.ctx.storage.sql.exec("UPDATE reviews SET status = ? WHERE id = ?", status, id).rowsWritten > 0;
  }
  // publicOnly のときは、承認済みの口コミの写真だけ返す
  async photo(id: string, n: number, publicOnly: boolean): Promise<string | null> {
    const rows = this.ctx.storage.sql.exec(
      `SELECT p.data FROM photos p JOIN reviews r ON r.id = p.review_id WHERE p.review_id = ? AND p.n = ?${publicOnly ? " AND r.status = 'approved'" : ""}`, id, n).toArray();
    return rows.length ? String(rows[0].data) : null;
  }
}

const reviewStore = (env: Env) => env.REVIEWS.get(env.REVIEWS.idFromName("ririo"));
const monthOf = (t: number) => { const d = new Date(t + 9 * 3600_000); return `${d.getUTCFullYear()}年${d.getUTCMonth() + 1}月`; };

// 誰でも読める口コミの一覧と写真（お店のサイトから読むので、どのサイトからでも許可）
async function publicReviews(request: Request, env: Env, path: string): Promise<Response> {
  const open = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" };
  const store = reviewStore(env);
  const m = path.match(/^\/reviews\/photo\/([a-z0-9-]{1,40})\/([0-2])$/);
  if (m) {
    const data = await store.photo(m[1], Number(m[2]), true);
    if (!data) return new Response("not found", { status: 404, headers: open });
    const bytes = Uint8Array.from(atob(data.split(",")[1]), (c) => c.charCodeAt(0));
    return new Response(bytes, { headers: { ...open, "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=86400" } });
  }
  const limit = Math.max(1, Math.min(50, Number(new URL(request.url).searchParams.get("limit")) || 20));
  const base = `https://${new URL(request.url).host}`;
  const rows = await store.list("approved", limit);
  const reviews = rows.map((r) => ({
    id: r.id, date: monthOf(r.created), product: r.product, text: r.text,
    photos: Array.from({ length: r.photos }, (_, n) => `${base}/reviews/photo/${r.id}/${n}`),
  }));
  return json({ reviews }, 200, open);
}

export default {
  async fetch(request: Request, env: Env, execCtx: ExecutionContext): Promise<Response> {
    const path = new URL(request.url).pathname;
    // 公式LINEの Webhook（LINEのサーバーから届く。署名で確かめる）
    if (path === "/line/webhook" && request.method === "POST") return handleLineWebhook(request, env, execCtx);
    if (request.method === "GET" && (path === "/reviews" || path.startsWith("/reviews/photo/"))) return publicReviews(request, env, path);

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

    const body = await readBody(request, path === "/reviews/submit" ? MAX_REVIEW_BYTES : MAX_BODY_BYTES);
    if (body === null) return json({ error: "payload too large" }, 413, headers);
    const raw = parseJson(body) as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object") return json({ error: "bad request" }, 400, headers);

    // お店のサイトに載せてOKの口コミ（承認されるまでは非公開）
    if (path === "/reviews/submit") {
      const r = cleanReview(raw);
      if (!r) return json({ error: "bad request" }, 400, headers);
      return json({ id: await reviewStore(env).submit(r) }, 200, headers);
    }
    // 承認ページ
    if (path.startsWith("/reviews/admin/")) {
      if (!env.REVIEW_ADMIN_KEY || raw.key !== env.REVIEW_ADMIN_KEY) return json({ error: "wrong key" }, 401, headers);
      const store = reviewStore(env);
      if (path === "/reviews/admin/list") {
        const rows = await store.list(null, 200);
        const reviews = await Promise.all(rows.map(async (r) => ({
          ...r, date: monthOf(r.created),
          photos: await Promise.all(Array.from({ length: r.photos }, (_, n) => store.photo(r.id, n, false))),
        })));
        return json({ reviews }, 200, headers);
      }
      if (path === "/reviews/admin/set" && typeof raw.id === "string" && ["approved", "hidden", "pending", "deleted"].includes(String(raw.status))) {
        return json({ ok: await store.setStatus(raw.id, String(raw.status)) }, 200, headers);
      }
      return json({ error: "bad request" }, 400, headers);
    }

    // 図鑑の読み込み・保存（LINEでログインしている人だけ）
    if (path === "/state/load" || path === "/state/save") {
      const user = await lineUser(env, raw.lineToken);
      if (!user) return json({ error: "login required" }, 401, headers);
      const stub = env.USER_STATE.get(env.USER_STATE.idFromName(user.userId));
      const state = path === "/state/load" ? await stub.load() : await stub.save(cleanState(raw.state));
      return json({ state, friend: user.friend }, 200, headers);
    }

    // AIは公式LINEの友だちだけ（LINE連携を有効にしているとき）
    if (env.LINE_CHANNEL_ID) {
      const user = await lineUser(env, raw.lineToken);
      if (!user || !user.friend) return json({ error: "line friend required" }, 403, headers);
    }

    const ctx = parseContext(raw);
    if (!ctx) return json({ error: "bad request" }, 400, headers);

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
