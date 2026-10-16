// 公式LINEの自動返信（Messaging API の Webhook）。
// - ふだんは AI（Claude）が、お店の情報とホームページの営業日カレンダーをもとに返信する
// - AIが答えられないこと（お菓子教室の申し込み、オーダーの相談、アレルギーの個別判断など）は
//   「担当者からご連絡します」と返して、そのお客さんを手動対応に切り替え、お店の人のLINEに通知する
// - 手動対応中のお客さんにはAIは返信しない（お店の人が LINE公式アカウントのチャットから返信する）
// - お店の人は公式LINEに「#コード 自動」などと送って切り替えられる（「ヘルプ」で一覧）
import { DurableObject } from "cloudflare:workers";
import { ask, type Env } from "./index";
import { SHOP_INFO, SHOP_NAME, SITE_URL } from "./shop";

const LINE_API = "https://api.line.me/v2/bot";
const HUMAN_HOURS = 72; // 手動対応に切り替えてから、自動返信に戻るまでの時間
const HISTORY_TURNS = 6;

interface Chat { userId: string; name: string; mode: string; until: number; code: string; history: { role: "user" | "assistant"; text: string }[] }

// ---------- 保存（1店舗で1つ） ----------
export class ShopBot extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.storage.sql.exec("CREATE TABLE IF NOT EXISTS owners (user_id TEXT PRIMARY KEY)");
    ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS chats (
      user_id TEXT PRIMARY KEY, name TEXT, mode TEXT, until INTEGER, code TEXT, history TEXT, updated INTEGER)`);
  }
  async owners(): Promise<string[]> {
    return this.ctx.storage.sql.exec("SELECT user_id FROM owners").toArray().map((r) => String(r.user_id));
  }
  async addOwner(userId: string): Promise<void> {
    this.ctx.storage.sql.exec("INSERT OR IGNORE INTO owners VALUES (?)", userId);
  }
  async getChat(userId: string): Promise<Chat> {
    const r = this.ctx.storage.sql.exec("SELECT * FROM chats WHERE user_id = ?", userId).toArray()[0];
    if (!r) return { userId, name: "", mode: "bot", until: 0, code: "", history: [] };
    return { userId, name: String(r.name || ""), mode: String(r.mode), until: Number(r.until), code: String(r.code || ""), history: JSON.parse(String(r.history || "[]")) };
  }
  async saveChat(c: Chat): Promise<void> {
    this.ctx.storage.sql.exec(
      "INSERT OR REPLACE INTO chats VALUES (?, ?, ?, ?, ?, ?, ?)",
      c.userId, c.name, c.mode, c.until, c.code, JSON.stringify(c.history.slice(-HISTORY_TURNS * 2)), Date.now());
  }
  // 「#AB12」のコード、または表示名の一部でお客さんを探す（最近話した人から）
  async find(q: string): Promise<Chat[]> {
    const rows = q.startsWith("#")
      ? this.ctx.storage.sql.exec("SELECT user_id FROM chats WHERE code = ?", q.slice(1).toUpperCase()).toArray()
      : this.ctx.storage.sql.exec("SELECT user_id FROM chats WHERE name LIKE ? ORDER BY updated DESC LIMIT 5", `%${q}%`).toArray();
    return Promise.all(rows.map((r) => this.getChat(String(r.user_id))));
  }
  async waiting(): Promise<Chat[]> {
    const rows = this.ctx.storage.sql.exec("SELECT user_id FROM chats WHERE mode = 'human' AND until > ? ORDER BY updated DESC LIMIT 10", Date.now()).toArray();
    return Promise.all(rows.map((r) => this.getChat(String(r.user_id))));
  }
}

const botStore = (env: Env) => env.BOT.get(env.BOT.idFromName("ririo"));

// ---------- LINE ----------
async function verifySignature(secret: string, body: string, signature: string | null): Promise<boolean> {
  if (!signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  let sig: Uint8Array<ArrayBuffer>;
  try { sig = Uint8Array.from(atob(signature), (c) => c.charCodeAt(0)); } catch { return false; }
  return crypto.subtle.verify("HMAC", key, sig, new TextEncoder().encode(body));
}

type LineMessage = Record<string, unknown>;
async function lineApi(env: Env, path: string, body?: unknown): Promise<Response> {
  return fetch((env.LINE_API_BASE || LINE_API) + path, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${env.LINE_CHANNEL_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}
const text = (t: string, quick?: string[]): LineMessage => ({
  type: "text", text: t.slice(0, 4900),
  ...(quick ? { quickReply: { items: quick.map((label) => ({ type: "action", action: { type: "message", label, text: label } })) } } : {}),
});
const reply = (env: Env, token: string, messages: LineMessage[]) => lineApi(env, "/message/reply", { replyToken: token, messages });
const push = (env: Env, to: string, messages: LineMessage[]) => lineApi(env, "/message/push", { to, messages });
async function displayName(env: Env, userId: string): Promise<string> {
  try { const r = await lineApi(env, `/profile/${userId}`); return r.ok ? String(((await r.json()) as { displayName?: string }).displayName || "") : ""; } catch { return ""; }
}

const QUICK = ["今月の営業日", "自販機のお菓子", "アクセス", "お菓子教室について", "スタッフと話したい"];

// ---------- 営業日（ホームページと同じデータベース） ----------
interface Day { date: string; is_open: boolean; open_time: string | null; close_time: string | null; note: string | null }
const WEEK = "日月火水木金土";
function jstNow(): Date { return new Date(Date.now() + 9 * 3600_000); }
const ymd = (d: Date) => d.toISOString().slice(0, 10);

async function schedule(env: Env): Promise<Day[] | null> {
  if (!env.SITE_SUPABASE_URL || !env.SITE_SUPABASE_KEY) return null;
  const now = jstNow();
  const from = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
  const to = ymd(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 2, 0)));
  try {
    const r = await fetch(`${env.SITE_SUPABASE_URL}/rest/v1/business_schedule?select=date,is_open,open_time,close_time,note&date=gte.${from}&date=lte.${to}&order=date`,
      { headers: { apikey: env.SITE_SUPABASE_KEY } });
    return r.ok ? ((await r.json()) as Day[]) : null;
  } catch { return null; }
}
const dayLabel = (d: string) => { const t = new Date(d + "T00:00:00Z"); return `${t.getUTCMonth() + 1}/${t.getUTCDate()}(${WEEK[t.getUTCDay()]})`; };
const hours = (d: Day) => `${(d.open_time || "10:00").slice(0, 5)}〜${(d.close_time || "18:00").slice(0, 5)}`;

function scheduleText(days: Day[] | null): string {
  if (!days) return "（営業日カレンダーを読み込めませんでした。ホームページのカレンダーを案内すること）";
  const open = days.filter((d) => d.is_open);
  if (!open.length) return "（今月・来月の営業日はまだ登録されていません。ホームページのカレンダーを案内すること）";
  return open.map((d) => `${dayLabel(d.date)} ${hours(d)}${d.note ? `（${d.note}）` : ""}`).join("\n") + "\n※上に無い日は休業日";
}

// 「今月の営業日」はAIを使わず、そのまま一覧で返す
function monthScheduleReply(days: Day[] | null): string {
  const now = jstNow();
  const m = now.getUTCMonth() + 1;
  const prefix = `${now.getUTCFullYear()}-${String(m).padStart(2, "0")}`;
  const open = (days || []).filter((d) => d.is_open && d.date.startsWith(prefix));
  if (!days) return `営業日はホームページのカレンダーでご確認ください🌸\n${SITE_URL}#calendar`;
  if (!open.length) return `${m}月の営業日は、まだカレンダーに載っていません。決まりしだいホームページでお知らせします🌸\n${SITE_URL}#calendar`;
  const sameHours = open.every((d) => hours(d) === hours(open[0]));
  const list = open.map((d) => `🌸 ${dayLabel(d.date)}${sameHours ? "" : " " + hours(d)}${d.note ? `（${d.note}）` : ""}`).join("\n");
  return `${m}月の営業日です。\n${list}${sameHours ? `\n営業時間 ${hours(open[0])}` : ""}\n\nマルシェ＆イベント参加のため臨時休業の場合があります。お店の前の自動販売機は24時間いつでもご利用いただけます🍰`;
}

// ---------- AI ----------
// ---------- 自動販売機のラインナップ（口コミページの vending.json と同じもの） ----------
const VENDING_URL = "https://gbp.ai-mottainai.jp/ririo/vending.json";
interface VendingItem { no: number; name: string; price: number; desc: string }
async function vendingText(): Promise<string> {
  try {
    const r = await fetch(VENDING_URL, { cf: { cacheTtl: 300 } } as RequestInit);
    if (!r.ok) throw new Error(String(r.status));
    const j = (await r.json()) as { updated?: string; items?: VendingItem[] };
    const items = (j.items || []).slice(0, 30);
    if (!items.length) throw new Error("empty");
    return `（${j.updated || ""} 時点。売り切れや入れ替えがあることもある）\n` +
      items.map((v) => `${v.no}. ${v.name} ${v.price}円${v.desc ? `：${v.desc}` : ""}`).join("\n");
  } catch {
    return "（ラインナップを読み込めませんでした。中身は季節で変わるとだけ伝える）";
  }
}

const BOT_SYSTEM = (today: string, days: string, vending: string) => `あなたは${SHOP_NAME}（宮城県多賀城市のお菓子屋さん＆お菓子教室）の公式LINEで、お客さまに返信するアシスタントです。
今日は ${today} です。

<お店の情報>
${SHOP_INFO}
</お店の情報>

<自動販売機のラインナップ>
${vending}
</自動販売機のラインナップ>

<営業日（今月・来月）>
${days}
</営業日>

返信のルール:
- 上の情報に書いてあることだけで答える。書いていないこと（在庫や売り切れ、店頭の当日の品ぞろえ、自販機以外の商品の値段、アレルギーの可否、取り置き、配送など）は推測で答えない。
- やさしく丁寧な話し言葉で、短く（200文字くらいまで）。絵文字は使っても1つまで。URLは必要なときだけ1つ。
- 次の場合は handoff を true にして、担当者に引き継ぐ:
  ・お菓子教室の申し込み、日程の相談、体験の希望（料金・内容の質問に答えるだけなら false でよい。申し込みは予約フォームも案内する）
  ・オーダーメイドやケーキの注文・予約・見積もり・取り置きの相談
  ・駐車場を使いたいという連絡（事前連絡が必要なため）
  ・アレルギーや原材料についての個別の判断
  ・苦情、返品・返金、体調に関すること
  ・取材、営業、コラボの依頼
  ・スタッフと話したいと言われたとき
  ・お店の情報から答えられない質問
- handoff のときの reply は「内容を受け取ったこと」と「担当者から改めてご連絡すること」を伝える。いつ返信するかは約束しない。
- summary には、担当者向けに「何の用件か」を30文字くらいで書く（handoff でないときは空でよい）。`;

const BOT_SCHEMA = {
  type: "object",
  properties: { reply: { type: "string" }, handoff: { type: "boolean" }, summary: { type: "string" } },
  required: ["reply", "handoff", "summary"],
  additionalProperties: false,
};

// ---------- お店の人の操作 ----------
const HELP = `【お店の方用の操作】
・ヘルプ … この一覧
・対応待ち … 手動対応中のお客さま
・#コード 自動 … そのお客さまをAIの自動返信に戻す（例：#K7Q2 自動）
・#コード 手動 … そのお客さまを手動対応にする（${HUMAN_HOURS}時間）
・名前 自動／名前 手動 … LINEの表示名の一部でも指定できます（例：山田 手動）
手動対応中は、AIは返信しません。LINE公式アカウントのチャットから返信してください。`;

async function ownerCommand(env: Env, msg: string): Promise<string | null> {
  const t = msg.trim();
  if (t === "ヘルプ") return HELP;
  const store = botStore(env);
  if (t === "対応待ち") {
    const list = await store.waiting();
    return list.length ? "手動対応中のお客さま：\n" + list.map((c) => `#${c.code} ${c.name || "（名前なし）"}`).join("\n") : "手動対応中のお客さまはいません。";
  }
  const m = t.match(/^(#[A-Za-z0-9]{4}|\S+)\s*(自動|手動)$/);
  if (!m) return null;
  const found = await store.find(m[1]);
  if (!found.length) return `「${m[1]}」のお客さまが見つかりませんでした。`;
  if (found.length > 1) return `何人か見つかりました。コードで指定してください：\n` + found.map((c) => `#${c.code || "----"} ${c.name}`).join("\n");
  const c = found[0];
  c.code = c.code || (await codeOf(c.userId));
  if (m[2] === "自動") { c.mode = "bot"; c.until = 0; } else { c.mode = "human"; c.until = Date.now() + HUMAN_HOURS * 3600_000; }
  await store.saveChat(c);
  return `${c.name || "お客さま"}（#${c.code}）を${m[2] === "自動" ? "AIの自動返信に戻しました" : `手動対応にしました（${HUMAN_HOURS}時間）`}。`;
}

// お客さまごとに決まった4文字のコード（同じ人には、いつも同じコード）
async function codeOf(userId: string): Promise<string> {
  const a = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const h = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(userId)));
  return Array.from(h.slice(0, 4), (b) => a[b % a.length]).join("");
}

async function handOff(env: Env, chat: Chat, what: string, summary: string): Promise<void> {
  chat.mode = "human";
  chat.until = Date.now() + HUMAN_HOURS * 3600_000;
  chat.code = chat.code || (await codeOf(chat.userId));
  const owners = await botStore(env).owners();
  const note = `【要対応】${chat.name || "お客さま"} さん（#${chat.code}）\n用件：${summary || "（AIでは答えられない内容）"}\n内容：「${what.slice(0, 300)}」\n\nLINE公式アカウントのチャットから返信してください。\nAIに戻すとき：「#${chat.code} 自動」と送信`;
  await Promise.all(owners.map((o) => push(env, o, [text(note)])));
}

// ---------- 1件ずつ処理 ----------
interface LineEvent { type: string; replyToken?: string; source?: { type: string; userId?: string }; message?: { type: string; text?: string } }

async function handleEvent(env: Env, e: LineEvent): Promise<void> {
  if (e.type !== "message" || !e.replyToken || e.source?.type !== "user" || !e.source.userId || !e.message) return;
  const userId = e.source.userId;
  const store = botStore(env);
  const owners = await store.owners();
  const isOwner = owners.includes(userId);
  const msg = e.message.type === "text" ? String(e.message.text || "") : "";

  // お店の人の登録：「管理者登録 合言葉」（合言葉は REVIEW_ADMIN_KEY と同じ）
  const reg = msg.trim().match(/^管理者登録\s+(.+)$/);
  if (reg) {
    if (env.REVIEW_ADMIN_KEY && reg[1].trim() === env.REVIEW_ADMIN_KEY) {
      await store.addOwner(userId);
      await reply(env, e.replyToken, [text("お店の方として登録しました。AIが答えられないお問い合わせが来たら、ここにお知らせします。\n\n" + HELP)]);
    } else {
      await reply(env, e.replyToken, [text("合言葉がちがうようです。")]);
    }
    return;
  }
  if (isOwner && msg) {
    const out = await ownerCommand(env, msg);
    if (out) { await reply(env, e.replyToken, [text(out)]); return; }
  }

  const chat = await store.getChat(userId);
  if (!chat.name) chat.name = await displayName(env, userId);
  if (!chat.code) chat.code = await codeOf(userId);
  // 手動対応中はAIは黙る（お店の人がチャットで返信する）
  if (chat.mode === "human" && chat.until > Date.now()) {
    chat.history.push({ role: "user", text: msg || `（${e.message.type}）` });
    await store.saveChat(chat);
    return;
  }
  chat.mode = "bot";

  if (e.message.type === "sticker") { await reply(env, e.replyToken, [text("スタンプありがとうございます😊 ご質問があれば、お気軽にメッセージでどうぞ。", QUICK)]); return; }
  if (!msg) {
    // 画像・動画・位置情報などは担当者が確認する
    await handOff(env, chat, `（${e.message.type}を受信）`, "画像などが届きました");
    await store.saveChat(chat);
    await reply(env, e.replyToken, [text("お送りいただいた内容を受け取りました。担当者が確認して、改めてご連絡いたします。")]);
    return;
  }

  // AIの返事を待つあいだ「…」を出す
  lineApi(env, "/chat/loading/start", { chatId: userId, loadingSeconds: 10 }).catch(() => {});
  const [days, vending] = await Promise.all([schedule(env), vendingText()]);
  if (/^今月の営業日/.test(msg.trim())) {
    chat.history.push({ role: "user", text: msg });
    const out = monthScheduleReply(days);
    chat.history.push({ role: "assistant", text: out });
    await store.saveChat(chat);
    await reply(env, e.replyToken, [text(out, QUICK)]);
    return;
  }

  const now = jstNow();
  const today = `${now.getUTCFullYear()}年${now.getUTCMonth() + 1}月${now.getUTCDate()}日(${WEEK[now.getUTCDay()]}) ${String(now.getUTCHours()).padStart(2, "0")}:${String(now.getUTCMinutes()).padStart(2, "0")}`;
  const convo = chat.history.map((h) => `${h.role === "user" ? "お客さま" : "お店"}：${h.text}`).join("\n");
  const userText = `${convo ? `<これまでの会話>\n${convo}\n</これまでの会話>\n\n` : ""}<お客さまの新しいメッセージ>\n${msg.slice(0, 1000)}\n</お客さまの新しいメッセージ>`;
  type BotOut = { reply: string; handoff: boolean; summary: string };
  let out: BotOut | null = null;
  try { out = (await ask(env, BOT_SYSTEM(today, scheduleText(days), vending), userText, BOT_SCHEMA)) as BotOut | null; } catch { out = null; }
  if (!out || !out.reply) out = { reply: "お問い合わせありがとうございます。担当者が確認して、改めてご連絡いたします。", handoff: true, summary: "AIが返信できませんでした" };

  chat.history.push({ role: "user", text: msg }, { role: "assistant", text: out.reply });
  if (out.handoff) await handOff(env, chat, msg, out.summary);
  await store.saveChat(chat);
  await reply(env, e.replyToken, [text(out.reply, out.handoff ? undefined : QUICK)]);
}

// Webhook の入口。LINEには先に200を返し、返信はそのあと行う
export async function handleLineWebhook(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  if (!env.LINE_CHANNEL_SECRET || !env.LINE_CHANNEL_ACCESS_TOKEN) return new Response("not configured", { status: 503 });
  const body = await request.text();
  if (body.length > 200_000 || !(await verifySignature(env.LINE_CHANNEL_SECRET, body, request.headers.get("x-line-signature")))) {
    return new Response("bad signature", { status: 401 });
  }
  let events: LineEvent[] = [];
  try { events = ((JSON.parse(body) as { events?: LineEvent[] }).events || []).slice(0, 20); } catch { /* ignore */ }
  ctx.waitUntil(Promise.all(events.map((e) => handleEvent(env, e).catch(() => {}))));
  return new Response("ok");
}
