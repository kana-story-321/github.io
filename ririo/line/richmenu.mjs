// 公式LINEのリッチメニューを、Messaging API で作って全員のメニューに設定します。
// GitHub Actions（.github/workflows/richmenu.yml）から動きます。手元で動かすときは:
//   LINE_CHANNEL_ACCESS_TOKEN=... node ririo/line/richmenu.mjs
// 同じ名前の古いメニューは、新しいメニューを設定したあとで消します（入れ替えの間もメニューが消えないように）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dir = path.dirname(fileURLToPath(import.meta.url));
const token = (process.env.LINE_CHANNEL_ACCESS_TOKEN || "").trim();
if (!token) {
  console.log("::notice::LINE_CHANNEL_ACCESS_TOKEN が未登録なので、リッチメニューは作りませんでした。");
  process.exit(0);
}

// LIFF ID は config.js から読む（設定は1か所だけ）
const config = fs.readFileSync(path.join(dir, "..", "config.js"), "utf8");
const liffId = (config.match(/liffId:\s*"([^"]*)"/) || [])[1];
const SITE = "https://sweet-season-ririo.lovable.app/";
const liff = liffId ? `https://liff.line.me/${liffId}` : "https://gbp.ai-mottainai.jp/ririo/";

const NAME = "ririo-main";
const W = [0, 833, 1666, 2500];
const H = [0, 843, 1686];
const cell = (col, row) => ({ x: W[col], y: H[row], width: W[col + 1] - W[col], height: H[row + 1] - H[row] });
const uri = (label, url) => ({ type: "uri", label, uri: url });
const menu = {
  size: { width: 2500, height: 1686 },
  selected: true, // トークを開いたときに最初から表示
  name: NAME,
  chatBarText: "メニュー",
  areas: [
    { bounds: cell(0, 0), action: uri("今日のおみくじ", liff) },
    { bounds: cell(1, 0), action: uri("キャラ図鑑", `${liff}?zukan=1`) },
    { bounds: cell(2, 0), action: { type: "message", label: "今月の営業日", text: "今月の営業日" } },
    { bounds: cell(0, 1), action: uri("お菓子教室", `${SITE}#classes`) },
    { bounds: cell(1, 1), action: uri("ホームページ", SITE) },
    { bounds: cell(2, 1), action: uri("アクセス", `${SITE}#access`) },
  ],
};

async function api(url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error(`${init.method || "GET"} ${url} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

const old = (await api("https://api.line.me/v2/bot/richmenu/list")).richmenus.filter((m) => m.name === NAME);
const { richMenuId } = await api("https://api.line.me/v2/bot/richmenu", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(menu),
});
await api(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
  method: "POST", headers: { "Content-Type": "image/jpeg" }, body: fs.readFileSync(path.join(dir, "richmenu.jpg")),
});
await api(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, { method: "POST" });
for (const m of old) await api(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: "DELETE" });
console.log(`リッチメニューを設定しました: ${richMenuId}（古いメニュー ${old.length} 件を削除）`);
