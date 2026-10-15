(() => {
  "use strict";

  const C = window.SHOP_CONFIG;
  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  // ---------- storage (private mode etc. can throw) ----------
  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem("kk_" + key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem("kk_" + key, JSON.stringify(value)); } catch { /* ignore */ }
      if (SYNC_KEYS.includes(key)) scheduleCloudSave();
    },
  };
  // LINEでログインしている人は、図鑑・相棒をLINEアカウントにも保存する（機種変更しても続く）
  const SYNC_KEYS = ["stages", "zukan", "graduated", "partner", "claimed", "today"];
  const line = { on: false, token: null, friend: false };
  if (params.has("reset")) store.set("today", null);

  // ?date=2026-10-14 で日付を変えて季節の表示を確認できます
  const now = (() => {
    const t = params.get("date") ? new Date(params.get("date") + "T12:00:00") : new Date();
    return isNaN(t) ? new Date() : t;
  })();
  const todayKey = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;

  // ---------- 季節 ----------
  const pad = (n) => String(n).padStart(2, "0");
  const monthDay = `${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const inRange = (s) => (s.from <= s.to ? monthDay >= s.from && monthDay <= s.to : monthDay >= s.from || monthDay <= s.to);
  const spanDays = (s) => { const d = (md) => +md.slice(0, 2) * 31 + +md.slice(3); return (d(s.to) - d(s.from) + 372) % 372; };
  const seasons = C.seasons || [];
  const activeSeasons = seasons.filter(inRange).sort((a, b) => spanDays(a) - spanDays(b)); // 期間が短い＝より特別な季節が先
  const activeIds = new Set(activeSeasons.map((s) => s.id));
  const isActive = (p) => !p.seasons || p.seasons.some((id) => activeIds.has(id));
  const activeProducts = C.products.filter(isActive);
  const seasonName = (id) => (seasons.find((s) => s.id === id) || {}).name || id;
  const seasonLabel = (p) => {
    if (!p.seasons) return "";
    const id = p.seasons.find((x) => activeIds.has(x)) || p.seasons[0];
    return `${seasonName(id)}限定`;
  };
  // 商品名に季節名が入っていれば「（〇〇限定）」は付けない
  const productLabel = (p) => {
    const label = seasonLabel(p);
    return label && !p.name.includes(label.replace("限定", "")) ? `${p.name}（${label}）` : p.name;
  };
  // ---------- 進化（evolve.js） ----------
  // 定番キャラは3段階に育つ。QRを読んでクッキーを割るたび（1日1回）に「相棒」のなかよし度が1たまる。
  const LINES = window.EVOLVE_LINES || {};
  const EVOLVE_AT = [0, 3, 7]; // 段階2・3になるのに必要ななかよし度
  const RARE_EVOLVED_RATE = 0.05; // 進化しきった姿でいきなり出てくる確率
  const hasLine = (p) => !!(p && LINES[p.id]);
  const stageOf = (xp) => (xp >= EVOLVE_AT[2] ? 3 : xp >= EVOLVE_AT[1] ? 2 : 1);
  const nameOf = (p, stage) => (hasLine(p) ? LINES[p.id].names[(stage || 1) - 1] : p.chara);
  const descOf = (p, stage) => (hasLine(p) ? LINES[p.id].descs[(stage || 1) - 1] : "");
  const svgOf = (p, stage) => (hasLine(p) ? window.EVOLVE_SVG(stage || 1, p.id) : window.CHARA_SVG && window.CHARA_SVG(p.id));
  // キャラの絵：img/chara/{商品ID}-{段階}.webp（Canvaで清書した画像）。読めなければ手描きSVG、それもなければ絵文字
  const imgSrc = (p, stage) => `img/chara/${p.id}-${hasLine(p) ? stage || 1 : 1}.webp`;
  const svgFallback = (p, stage) => svgOf(p, stage) || p.emoji;
  window.__charaFallback = (el) => { const p = productById(el.dataset.id); el.outerHTML = svgFallback(p, +el.dataset.stage || 1); };
  const art = (p, stage) =>
    `<img src="${imgSrc(p, stage)}" alt="" draggable="false" data-id="${p.id}" data-stage="${stage || 1}" onerror="__charaFallback(this)">`;
  function loadImage(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }
  async function artImage(p, stage) {
    const img = await loadImage(imgSrc(p, stage));
    if (img) return img;
    const svgText = svgOf(p, stage);
    return svgText ? loadImage("data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgText)) : null;
  }
  const SPARKS = activeSeasons.length ? activeSeasons.flatMap((s) => s.sparks || []) : ["✨", "⭐", "💫"];
  const hashtag = "#" + C.shopName.replace(/[\s"]/g, "");

  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const productById = (id) => C.products.find((p) => p.id === id);
  const productByName = (name) => C.products.find((p) => p.name === name);

  // 文章の言い回しをセッション内で固定する（答えるたびに文がガラッと変わらないように）
  const seed = Math.floor(Math.random() * 1e6);
  const vary = (key, options) => {
    let h = seed;
    for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) % 1e9;
    return options[h % options.length];
  };

  function toast(text) {
    const t = $("toast");
    t.textContent = text;
    t.classList.add("show");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => t.classList.remove("show"), 2200);
  }

  function show(screenId) {
    for (const s of document.querySelectorAll(".screen")) s.hidden = s.id !== screenId;
    window.scrollTo({ top: 0 });
  }

  // ---------- fortune draw ----------
  const RARITY_WEIGHT = { N: 60, R: 25, SR: 12, SSR: 3 };

  function drawFortune() {
    // 箱のシールごとにQRを変えて ?p=canele のように渡すと、そのキャラが出る
    let product = productById(params.get("p"));
    if (!product) {
      const total = activeProducts.reduce((sum, p) => sum + weightOf(p), 0);
      let r = Math.random() * total;
      for (const p of activeProducts) {
        r -= weightOf(p);
        if (r <= 0) { product = p; break; }
      }
      product = product || activeProducts[0];
    }
    const stage = hasLine(product) && Math.random() < RARE_EVOLVED_RATE ? 3 : 1;
    const rank = product.rarity === "SSR" || stage === 3 ? "大吉" : pick(C.luckRanks);
    return { productId: product.id, stage, rank, lucky: pick(C.luckyItems), date: todayKey };
  }
  function countOfRarity(r) { return activeProducts.filter((p) => p.rarity === r).length; }
  // 季節限定キャラは、その季節のあいだ出やすくする
  function weightOf(p) { return (RARITY_WEIGHT[p.rarity] / countOfRarity(p.rarity)) * (p.seasons ? C.seasonalBoost || 1 : 1); }

  // ---------- cookie ----------
  const cookie = { taps: 0, need: 5 + Math.floor(Math.random() * 4), done: false, crackLen: 0 };
  const TAUNTS = ["いいね！", "その調子！", "ヒビが入った！", "もうすこし…", "あと一押し！", "割れそう…！"];

  // 季節ごとのクッキーの飾り
  const theme = (activeSeasons.find((s) => s.theme) || {}).theme || "";
  const COOKIE_DECO = {
    halloween: `
      <polygon points="78,92 102,92 90,72" fill="#3b1f0e"/><polygon points="138,92 162,92 150,72" fill="#3b1f0e"/>
      <path d="M70 140 L90 160 L105 145 L120 162 L135 145 L150 160 L170 140 Q120 190 70 140 Z" fill="#3b1f0e"/>`,
    christmas: [[70, 70], [120, 50], [170, 75], [60, 150], [180, 160], [120, 200], [100, 110], [150, 120]]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="6" fill="#fff" opacity=".9"/>`).join(""),
  };

  function buildCookie() {
    const pts = [];
    for (let y = 8; y <= 232; y += 28) pts.push([120 + (Math.random() * 36 - 18), y]);
    pts[0][0] = 120; pts[pts.length - 1][0] = 120;
    const line = pts.map((p) => p.join(",")).join(" ");
    $("polyLeft").setAttribute("points", `0,0 ${line} 0,240`);
    $("polyRight").setAttribute("points", `240,0 ${line} 240,240`);
    $("crackPath").setAttribute("d", "M" + pts.map((p) => p.join(" ")).join(" L"));

    const chips = [[80, 80], [150, 70], [170, 140], [95, 160], [130, 115], [60, 125], [140, 185], [185, 100]];
    const body = `
      <circle cx="120" cy="120" r="104" fill="#c47f3a"/>
      <circle cx="120" cy="116" r="100" fill="url(#dough)"/>
      ${(theme === "halloween" ? [] : chips).map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="9" ry="7" fill="#5a3424" transform="rotate(${(x * y) % 60} ${x} ${y})"/>`).join("")}
      <path d="M45 95 q20 -40 70 -55" stroke="#fff" stroke-opacity=".35" stroke-width="8" fill="none" stroke-linecap="round"/>
      ${COOKIE_DECO[theme] || ""}`;
    $("halfLeft").innerHTML = body;
    $("halfRight").innerHTML = body;

    const path = $("crackPath");
    cookie.crackLen = path.getTotalLength();
    path.style.strokeDasharray = cookie.crackLen;
    path.style.strokeDashoffset = cookie.crackLen;
    $("cookieBtn").classList.add("idle");
  }

  function spawnCrumbs(n, x, y) {
    const box = $("crumbs");
    for (let i = 0; i < n; i++) {
      const el = document.createElement("span");
      const isSpark = Math.random() < 0.25;
      el.className = isSpark ? "spark" : "crumb";
      if (isSpark) el.textContent = pick(SPARKS);
      el.style.left = x + "px";
      el.style.top = y + "px";
      el.style.setProperty("--dx", (Math.random() * 160 - 80) + "px");
      el.style.setProperty("--dy", (Math.random() * 120 - 20) + "px");
      el.style.setProperty("--r", (Math.random() * 360) + "deg");
      box.appendChild(el);
      setTimeout(() => el.remove(), 900);
    }
  }

  function hitCookie(evt) {
    if (cookie.done) return;
    cookie.taps++;
    const btn = $("cookieBtn");
    btn.classList.remove("idle", "hit", "shake");
    void btn.offsetWidth; // restart animation
    btn.classList.add(evt && evt.type === "shake" ? "shake" : "hit");
    if (navigator.vibrate) navigator.vibrate(12);

    const rect = btn.getBoundingClientRect();
    const x = evt && evt.clientX ? evt.clientX - rect.left : 130;
    const y = evt && evt.clientY ? evt.clientY - rect.top : 130;
    spawnCrumbs(4 + cookie.taps, x, y);

    const ratio = Math.min(cookie.taps / cookie.need, 1);
    $("crackPath").style.strokeDashoffset = cookie.crackLen * (1 - ratio);
    $("meterFill").style.width = ratio * 100 + "%";
    const combo = $("combo");
    combo.textContent = cookie.taps >= cookie.need ? "パカッ！" : `${TAUNTS[Math.min(cookie.taps - 1, TAUNTS.length - 1)]}  ×${cookie.taps}`;
    combo.classList.remove("pop"); void combo.offsetWidth; combo.classList.add("pop");

    if (cookie.taps >= cookie.need) breakCookie();
  }

  function breakCookie() {
    cookie.done = true;
    if (navigator.vibrate) navigator.vibrate([30, 40, 60]);
    spawnCrumbs(24, 130, 130);
    $("cookieStage").classList.add("broken");
    const fortune = drawFortune();
    store.set("today", fortune);
    setTimeout(() => renderResult(fortune), 1300);
  }

  // ---------- キャラの受け取り ----------
  // 答え合わせ（お店へのアンケート）を最後まで答えたお礼。1日1回まで。
  // Googleに投稿してもしなくても同じように受け取れる（口コミの見返りにはしない）。
  const claimedToday = () => store.get("claimed", "") === todayKey;
  function claimReward() {
    if (claimedToday()) return null;
    const fortune = store.get("today", null);
    if (!fortune) return null;
    store.set("claimed", todayKey);
    const isNew = addToZukan(fortune.productId, fortune.stage || 1);
    const growth = growPartner(fortune);
    fortune.growth = growth;
    store.set("today", fortune);
    return { fortune, isNew, growth };
  }
  function playReward(r) {
    if (!r) return;
    renderRewardBox();
    if (r.growth && (r.growth.evolved || r.growth.joined)) { playEvolution(r.growth); return; }
    const p = productById(r.fortune.productId);
    const stage = r.fortune.stage || 1;
    const ov = $("evolve");
    ov.querySelector(".evolve-art").innerHTML = art(p, stage);
    ov.querySelector(".evolve-art").className = "evolve-art pop";
    const partner = store.get("partner", null);
    const pp = partner && productById(partner.id);
    ov.querySelector(".evolve-text").textContent = `${nameOf(p, stage)}を図鑑に${r.isNew ? "登録した！" : "もう一度登録した！"}` +
      (r.growth && r.growth.gained && pp ? `　相棒の${nameOf(pp, stageOf(partner.xp))}のなかよし度 +1` : "");
    ov.querySelector(".evolve-btns").hidden = false;
    ov.querySelector("[data-act=wall]").onclick = () => makeWallpaper(p, null, stage);
    ov.hidden = false;
  }
  // 受け取り待ちの表示（完成画面）
  function renderRewardBox() {
    const box = $("rewardBox");
    const f = store.get("today", null);
    if (!f) { box.hidden = true; return; }
    const p = productById(f.productId);
    const done = claimedToday();
    box.innerHTML = `<div class="reward-art ${done ? "" : "waiting"}">${art(p, f.stage || 1)}</div>
      <div><p class="reward-title"></p><p class="reward-sub"></p></div>`;
    box.querySelector(".reward-title").textContent = done ? `${nameOf(p, f.stage || 1)}を受け取りました` : "🎁 答え合わせのお礼に、今日のキャラを図鑑に登録します";
    box.querySelector(".reward-sub").textContent = done ? "また明日、QRを読んで会いに来てね" : "下のボタンでも「次に進む」でも受け取れます";
    box.hidden = false;
  }
  // Googleマップから戻ってきたときに受け取りの演出を出す
  let pendingReward = null;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && pendingReward) { const r = pendingReward; pendingReward = null; setTimeout(() => playReward(r), 400); }
  });

  // 相棒を育てる（クッキーは1日1枚なので、なかよし度も1日1まで）
  function growPartner(fortune) {
    let partner = store.get("partner", null);
    const done = store.get("graduated", []);
    const drawn = productById(fortune.productId);
    let joined = false;
    if ((!partner || partner.xp >= EVOLVE_AT[2]) && hasLine(drawn) && !done.includes(drawn.id) && (!partner || partner.id !== drawn.id)) {
      partner = { id: drawn.id, xp: 0 };
      joined = true;
    }
    if (!partner || !hasLine(productById(partner.id))) return null;
    if (partner.xp >= EVOLVE_AT[2]) return { id: partner.id, xp: partner.xp, from: 3, to: 3 };
    const from = stageOf(partner.xp);
    partner.xp += 1;
    const to = stageOf(partner.xp);
    store.set("partner", partner);
    markSeen(partner.id, to);
    if (to === 3 && !done.includes(partner.id)) store.set("graduated", done.concat(partner.id));
    return { id: partner.id, xp: partner.xp, from, to, evolved: to > from, joined, gained: true };
  }

  async function enableShake() {
    try {
      if (typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission === "function") {
        const res = await DeviceMotionEvent.requestPermission();
        if (res !== "granted") { toast("タップでも割れます！"); return; }
      }
    } catch { toast("タップでも割れます！"); return; }
    let last = 0;
    window.addEventListener("devicemotion", (e) => {
      const a = e.accelerationIncludingGravity || e.acceleration;
      if (!a) return;
      const mag = Math.abs(a.x || 0) + Math.abs(a.y || 0) + Math.abs(a.z || 0);
      const now = Date.now();
      if (mag > 30 && now - last > 280) { last = now; hitCookie({ type: "shake" }); }
    });
    $("shakeBtn").textContent = "📳 スマホをふってみて！";
  }

  // ---------- zukan ----------
  // 図鑑：商品ごとの出会った回数と、見たことのある段階
  function markSeen(productId, stage) {
    const seen = store.get("stages", {});
    const isNew = !(seen[productId] || []).includes(stage);
    if (isNew) { seen[productId] = (seen[productId] || []).concat(stage); store.set("stages", seen); }
    updateZukanCount();
    return isNew;
  }
  function addToZukan(productId, stage = 1) {
    const z = store.get("zukan", {});
    z[productId] = (z[productId] || 0) + 1;
    store.set("zukan", z);
    return markSeen(productId, stage);
  }
  const zukanTotal = () => C.products.reduce((n, p) => n + (hasLine(p) ? 3 : 1), 0);
  function zukanFound() {
    const seen = store.get("stages", {});
    const z = store.get("zukan", {});
    return C.products.reduce((n, p) => n + (hasLine(p) ? (seen[p.id] || []).length : (z[p.id] || (seen[p.id] || []).length) ? 1 : 0), 0);
  }
  function updateZukanCount() {
    $("zukanCount").textContent = `${zukanFound()}/${zukanTotal()}`;
  }
  function openZukan() {
    const z = store.get("zukan", {});
    const seen = store.get("stages", {});
    $("zukanProgress").textContent = `${zukanFound()}/${zukanTotal()}`;
    const one = (p, stage, owned, label) => `<div class="zk ${owned ? "" : "locked"}" ${owned ? `data-wall="${p.id}" data-stage="${stage || 1}" role="button" tabindex="0"` : ""}>
        <span class="e">${art(p, stage)}</span>${owned ? nameOf(p, stage) : "？？？"}<div class="n">${label}</div></div>`;
    const cell = (p) => {
      if (hasLine(p)) {
        const got = seen[p.id] || [];
        return `<div class="zk-line"><p class="zk-line-name">${p.name}</p>${[1, 2, 3].map((st) => one(p, st, got.includes(st), ["たまご期", "こども期", "進化形"][st - 1])).join("")}</div>`;
      }
      const owned = z[p.id];
      const tag = p.seasons ? `<div class="n ${isActive(p) ? "now" : ""}">${isActive(p) ? "出現中！" : seasonLabel(p)}</div>` : "";
      return one(p, null, owned, `${p.rarity}${owned ? ` ・ ${owned}回` : ""}`).replace(/<\/div>$/, `${tag}</div>`);
    };
    const regular = C.products.filter((p) => !p.seasons);
    const seasonal = C.products.filter((p) => p.seasons).sort((a, b) => isActive(b) - isActive(a));
    $("zukanGrid").innerHTML = `<p class="zk-head">定番</p>${regular.map(cell).join("")}
      <p class="zk-head">季節限定 <small>季節ごとに入れかわります</small></p>${seasonal.map(cell).join("")}`;
    for (const el of $("zukanGrid").querySelectorAll("[data-wall]")) {
      el.addEventListener("click", () => makeWallpaper(productById(el.dataset.wall), null, +el.dataset.stage || 1));
    }
    $("zukan").showModal();
  }

  // ---------- result ----------
  const VOICES = [
    "つついても何も出ないよ〜", "今日もいい焼き色でしょ？", "ふふ、くすぐったい！", "答え合わせ、待ってるね",
    "明日も会えるかな？", "図鑑、ぜんぶ埋まった？", "パティシエさんは朝4時起きなんだって",
  ];
  let state = null;

  function renderResult(fortune) {
    const seenNow = (store.get("stages", {})[fortune.productId] || []).includes(fortune.stage || 1);
    const isNew = !seenNow;
    const p = productById(fortune.productId);
    state = state || newSurveyState(fortune);
    $("slip").className = "slip r-" + p.rarity;
    $("rank").textContent = fortune.rank;
    const stage = fortune.stage || 1;
    const chara = $("chara");
    chara.innerHTML = art(p, stage);
    chara.style.background = p.color + "33";
    $("rarity").textContent = stage === 3 && hasLine(p) ? "✨進化形" : p.rarity;
    $("rarity").className = "rarity " + (stage === 3 && hasLine(p) ? "SSR" : p.rarity);
    if (stage === 3 && hasLine(p)) $("slip").className = "slip r-SSR";
    $("resultTitle").textContent = nameOf(p, stage);
    $("productName").textContent = `今日のお菓子：${productLabel(p)}`;
    $("fortuneText").textContent = p.fortune;
    $("keyword").textContent = `〈${p.keyword}〉`;
    $("luckyItem").textContent = fortune.lucky;
    $("newBadge").hidden = !isNew || claimedToday();
    $("againNote").textContent = "クッキーは1日1枚。また明日、別のキャラに会えるかも。";
    renderPartner(claimedToday() ? fortune.growth : null);
    show("screenResult");
  }

  // 相棒の育ち具合
  function renderPartner(growth) {
    const box = $("partner");
    const partner = store.get("partner", null);
    const p = partner && productById(partner.id);
    if (!hasLine(p)) { box.hidden = true; return; }
    const stage = stageOf(partner.xp);
    const next = EVOLVE_AT[stage];
    const dots = Array.from({ length: EVOLVE_AT[2] }, (_, i) => `<i class="${i < partner.xp ? "on" : ""}"></i>`).join("");
    const msg = stage === 3 ? "進化しきった！次に出会ったキャラが新しい相棒に" :
      `あと${next - partner.xp}回で${stage === 1 ? "生まれる" : "進化する"}…！${claimedToday() ? "" : "（答え合わせで +1）"}`;
    box.innerHTML = `<div class="partner-art">${art(p, stage)}</div>
      <div class="partner-body"><p class="partner-label">相棒 ${growth && growth.gained ? "<b>なかよし度 +1</b>" : ""}</p>
      <p class="partner-name"></p><div class="dots">${dots}</div><p class="partner-msg"></p></div>`;
    box.querySelector(".partner-name").textContent = nameOf(p, stage);
    box.querySelector(".partner-msg").textContent = msg;
    box.hidden = false;
    box.onclick = () => makeWallpaper(p, null, stage);
  }

  // 進化の演出
  function playEvolution(growth) {
    const p = productById(growth.id);
    const ov = $("evolve");
    const stageEl = ov.querySelector(".evolve-art");
    const text = ov.querySelector(".evolve-text");
    const btns = ov.querySelector(".evolve-btns");
    btns.hidden = true;
    ov.hidden = false;
    if (growth.joined && !growth.evolved) {
      stageEl.innerHTML = art(p, 1);
      stageEl.className = "evolve-art pop";
      text.textContent = `${nameOf(p, 1)}が相棒になった！答え合わせをするたびに育つよ（1日1回）`;
      btns.hidden = false;
      return;
    }
    stageEl.innerHTML = art(p, growth.from);
    stageEl.className = "evolve-art";
    text.textContent = `おや…？ ${nameOf(p, growth.from)}のようすが…！`;
    setTimeout(() => { stageEl.className = "evolve-art flicker"; }, 900);
    setTimeout(() => {
      stageEl.innerHTML = art(p, growth.to);
      stageEl.className = "evolve-art pop";
      if (navigator.vibrate) navigator.vibrate([40, 60, 120]);
      text.textContent = `おめでとう！ ${nameOf(p, growth.from)}は ${nameOf(p, growth.to)}に${growth.to === 2 ? "生まれた" : "進化した"}！`;
      btns.hidden = false;
      ov.querySelector("[data-act=wall]").onclick = () => makeWallpaper(p, null, growth.to);
    }, 3200);
  }

  function pokeChara() {
    const c = $("chara");
    c.classList.remove("boing"); void c.offsetWidth; c.classList.add("boing");
    if (navigator.vibrate) navigator.vibrate(8);
    const b = $("bubble");
    b.textContent = pick(VOICES);
    b.classList.add("show");
    clearTimeout(pokeChara.t);
    pokeChara.t = setTimeout(() => b.classList.remove("show"), 1600);
  }

  // ---------- 待ち受け画像 ----------
  // アプリとして残らない前提で、キャラを「待ち受け」として持ち帰ってもらう。
  // 上部は時計、下部はボタンが重なるので、大事な情報は中央にまとめる。
  const WALL_BG = {
    halloween: ["#3a1f4f", "#e8701c"],
    christmas: ["#1f5a34", "#c8352e"],
  };
  async function makeWallpaper(p, fortune, stage = 1) {
    try { await document.fonts.ready; } catch { /* ignore */ }
    const W = 1170, H = 2532;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const font = (w, px) => `${w} ${px}px 'Zen Maru Gothic', sans-serif`;
    const dark = p.seasons && WALL_BG[theme] && p.seasons.includes(theme);

    // 背景：キャラの色のグラデーション（季節限定キャラは季節の色）
    const grad = g.createLinearGradient(0, 0, 0, H);
    if (dark) { grad.addColorStop(0, WALL_BG[theme][0]); grad.addColorStop(1, WALL_BG[theme][1]); }
    else { grad.addColorStop(0, "#fffaf2"); grad.addColorStop(1, p.color + "aa"); }
    g.fillStyle = grad; g.fillRect(0, 0, W, H);

    // うすい柄（キャラの絵文字を散らす）
    g.globalAlpha = dark ? 0.16 : 0.12;
    g.font = "90px serif"; g.textAlign = "center"; g.textBaseline = "middle";
    const img = await artImage(p, stage);
    const chara = nameOf(p, stage);
    for (let y = 60, row = 0; y < H; y += 190, row++) {
      for (let x = row % 2 ? 95 : 0; x < W + 100; x += 190) {
        if (img) g.drawImage(img, x - 60, y - 60, 120, 120); else g.fillText(p.emoji, x, y);
      }
    }
    g.globalAlpha = 1;

    // SSR は光の輪
    const cy = 1330;
    if (p.rarity === "SSR" || p.rarity === "SR") {
      const glow = g.createRadialGradient(W / 2, cy, 120, W / 2, cy, 520);
      glow.addColorStop(0, p.rarity === "SSR" ? "rgba(255,220,120,.9)" : "rgba(200,177,240,.8)");
      glow.addColorStop(1, "rgba(255,255,255,0)");
      g.fillStyle = glow; g.fillRect(0, cy - 560, W, 1120);
    }
    g.fillStyle = "rgba(255,253,248,.92)";
    g.beginPath(); g.arc(W / 2, cy, 330, 0, Math.PI * 2); g.fill();
    if (img) g.drawImage(img, W / 2 - 290, cy - 290, 580, 580);
    else { g.font = "380px serif"; g.fillText(p.emoji, W / 2, cy + 20); }

    // レア度
    g.fillStyle = p.rarity === "SSR" ? "#d9a520" : p.rarity === "SR" ? "#8c6bd1" : p.rarity === "R" ? "#4d9a8a" : "#4a2f22";
    g.beginPath(); g.roundRect(W / 2 + 170, cy - 340, 170, 80, 40); g.fill();
    g.fillStyle = "#fff"; g.font = font(900, 48); g.fillText(p.rarity, W / 2 + 255, cy - 298);

    const ink = dark ? "#ffffff" : "#4a2f22";
    const soft = dark ? "rgba(255,255,255,.85)" : "#8a6a58";
    g.fillStyle = ink;
    let size = 96;
    do { g.font = font(900, size); size -= 4; } while (g.measureText(chara).width > W - 120 && size > 40);
    g.fillText(chara, W / 2, cy + 450);
    g.fillStyle = soft; g.font = font(700, 44);
    g.fillText(productLabel(p), W / 2, cy + 540);
    if (fortune) {
      g.font = font(700, 46); g.fillStyle = ink;
      g.fillText(`${fortune.date.replace(/-/g, ".")} の運勢　${fortune.rank}`, W / 2, cy + 640);
    }
    g.font = font(500, 42); g.fillStyle = soft;
    wrapText(g, fortune ? p.fortune : descOf(p, stage) || p.fortune, W / 2, cy + 720, 900, 64);

    g.font = font(900, 46); g.fillStyle = ink;
    g.fillText(C.shopName, W / 2, H - 330);
    g.font = font(500, 34); g.fillStyle = soft;
    g.fillText("毎日1枚、キャラが変わるおみくじクッキー", W / 2, H - 270);
    g.textBaseline = "alphabetic";

    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    const name = `ririo-${p.id}-${stage}.png`;
    const file = new File([blob], name, { type: "image/png" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: `${hashtag} #おみくじクッキー` });
        return;
      }
    } catch (e) { if (e && e.name === "AbortError") return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    toast("待ち受け画像を保存しました");
  }
  async function shareCard() {
    const f = store.get("today", null);
    if (!f) return;
    $("shareCard").disabled = true;
    try { await makeWallpaper(productById(f.productId), f, f.stage || 1); } finally { $("shareCard").disabled = false; }
  }
  function wrapText(g, text, x, y, maxW, lh) {
    let line = "";
    for (const ch of text) {
      if (g.measureText(line + ch).width > maxW && !"。、！？」）".includes(ch)) { g.fillText(line, x, y); line = ch; y += lh; } else line += ch;
    }
    g.fillText(line, x, y);
  }

  // ---------- survey ----------
  function newSurveyState(fortune) {
    return { fortune, answers: {}, order: [], aiQuestions: [], aiAsked: {}, aiCount: 0, unlocked: false, finished: false };
  }

  const ans = (id) => state.answers[id];
  const arr = (id) => [].concat(ans(id) || []);
  const OTHER = "その他";
  const eatenNames = () => arr("products").filter((n) => n !== OTHER);
  const focusName = () => ans("focus") || eatenNames()[0] || "今日のお菓子";
  const focusProduct = () => productByName(focusName());
  const fortuneProduct = () => productById(state.fortune.productId);
  const isGiftScene = () => ["手土産・ギフトに", "お祝いに"].includes(ans("scene"));

  const GENERIC_TEXTURES = ["さくさく", "しっとり", "ふわふわ", "なめらか", "もっちり", "濃厚"];
  const GENERIC_FLAVORS = ["バターの香り", "素材の味", "上品な甘さ", "華やかな見た目"];

  const QUESTIONS = [
    { id: "products", type: "single", title: () => "答え合わせ！今日食べた（買った）のはどれ？", sub: "いくつか買った人は、いちばん印象に残ったものを1つ",
      options: () => {
        // 今の季節の商品だけ出す（シールのQRで来た商品は季節外でも出す）
        const list = [...activeProducts.filter((p) => p.seasons), ...activeProducts.filter((p) => !p.seasons)]; // 季節ものを先頭に
        const preset = productById(params.get("p"));
        if (preset && !list.includes(preset)) list.push(preset);
        return list.map((p) => p.name);
      } },
    { id: "focus", type: "single", noOther: true, when: () => eatenNames().length > 1, title: () => "いちばん印象に残ったのは？",
      options: () => eatenNames() },
    { id: "check", type: "single", noOther: true,
      title: () => `占いのキーワードは〈${fortuneProduct().keyword}〉。${focusName()}、当たってた？`,
      options: () => ["ぴったり当たってた！", "ちょっとだけ", "ぜんぜん違う魅力だった"],
      react: (v) => ({ "ぴったり当たってた！": "さすが！直感が冴えてる日です✨", "ちょっとだけ": "ふむふむ、くわしく教えて！", "ぜんぜん違う魅力だった": "新発見！どんな魅力だった？" }[v]) },
    { id: "texture", type: "single", title: () => `${focusName()}の食感は？`, sub: "読む人がいちばん知りたいポイントです",
      options: () => (focusProduct() ? focusProduct().textures : GENERIC_TEXTURES) },
    { id: "flavor", type: "single", title: () => "印象に残った味・香りは？",
      options: () => (focusProduct() ? focusProduct().flavors : GENERIC_FLAVORS) },
    { id: "sweet", type: "single", title: () => "甘さはどうでした？", options: () => ["かなり控えめ", "控えめ", "ちょうどいい", "しっかり甘い"], ai: true },
    { id: "scene", type: "single", title: () => "誰と・どんなシーンで？",
      options: () => ["自分へのご褒美", "家族と", "友人と", "手土産・ギフトに", "お祝いに", "仕事の休憩に"] },
    { id: "gift", type: "single", when: () => isGiftScene(), title: () => "相手の反応や、向いている相手は？",
      options: () => ["とても喜ばれた", "目上の方にも安心", "個包装で配りやすい", "見た目が華やか", "子どもにも人気", "日持ちして助かる"] },
    { id: "timing", type: "single", when: () => ans("scene") && !isGiftScene(), title: () => "どんなタイミングで食べた？",
      options: () => ["朝ごはんに", "午後のおやつ", "夜のご褒美", "コーヒーと", "紅茶と"] },
    { id: "reason", type: "single", title: () => "今日これを選んだ理由は？",
      options: () => C.reasons || ["見た目に惹かれて", "前に食べておいしかった", "口コミを見て", "季節限定だから", "店員さんのおすすめ", "通りがかりに"] },
    { id: "pref", type: "single", title: () => "普段はどんなお菓子が好き？", sub: "「自分と好みが近い人の感想だ」と読む人に伝わります",
      options: () => ["チョコ系", "フルーツ系", "焼き菓子", "和の素材", "甘さ控えめ派", "甘いものはあまり食べない"], ai: true },
    { id: "tips", type: "single", title: () => "次に買う人へのひとこと", sub: "知っていると助かる情報を選んでね",
      options: () => ["日持ちする", "持ち歩きしやすい", "温めるとさらにおいしい", "冷やすとさらにおいしい", "早い時間が品ぞろえ◎", "量がちょうどいい", "価格以上の満足感", "ラッピングが丁寧"] },
    { id: "photo", type: "photo", optional: true, title: () => "買ったお菓子の写真はありますか？", sub: "あれば載せてください（3枚まで・なくてもOK）。お店に届き、Googleの口コミにも付けられます" },
    { id: "free", type: "text", optional: true, title: () => "最後に、ひとことで言うと？", sub: "自由にどうぞ（なくてもOK）", placeholder: "例：外カリ中もちで、また買いに来ます！" },
    { id: "wish", type: "multi", shop: true, optional: true, withText: true, title: () => "今後食べたいもの・お店へのリクエスト",
      sub: "🔒 お店だけに届きます（口コミの文章には入りません）",
      options: () => ["季節限定をもっと", "甘さ控えめの商品", "ギフトセット", "少量・お試しサイズ", "焼き菓子の種類を増やして", "自販機の品ぞろえ", "お菓子教室のメニュー"] },
  ];

  const MAX_AI_FOLLOWUPS = 2;

  function nextQuestion() {
    if (state.aiQuestions.length) return state.aiQuestions.shift();
    return QUESTIONS.find((q) => !(q.id in state.answers) && (!q.when || q.when())) || null;
  }

  function remainingCount() {
    return QUESTIONS.filter((q) => !(q.id in state.answers) && (!q.when || q.when())).length;
  }

  function startSurvey() {
    show("screenSurvey");
    if (!state.order.length) {
      // シールのQRで来た場合は、その商品を最初から選んでおく
      const preset = productById(params.get("p"));
      askNext(preset ? { preselect: [preset.name] } : {});
    }
    updateGrow();
  }

  function askNext(opts = {}) {
    const q = nextQuestion();
    if (!q) return finishSurvey();
    state.current = q;
    renderCards(opts);
  }

  function renderCards(opts = {}) {
    const box = $("cards");
    box.innerHTML = "";
    state.order.forEach((qid, i) => box.appendChild(doneCard(qid, i)));
    if (state.current) box.appendChild(activeCard(state.current, opts));
    const answered = state.order.length;
    const total = answered + remainingCount() + (state.current && state.current.ai ? 0 : 0);
    $("progressFill").style.width = Math.min(100, (answered / Math.max(total, 1)) * 100) + "%";
    const last = box.lastElementChild;
    if (last && state.order.length) last.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function questionFor(qid) {
    return QUESTIONS.find((q) => q.id === qid) || state.aiAsked[qid];
  }

  function doneCard(qid, index) {
    const q = questionFor(qid);
    const el = document.createElement("div");
    el.className = "card done" + (q.isAI ? " ai" : "") + (q.shop ? " shop" : "");
    const v = state.answers[qid];
    const text = v === null ? "（スキップ）" : formatAnswer(v);
    el.innerHTML = `<p class="q"></p><p class="answer"></p>`;
    el.querySelector(".q").textContent = typeof q.title === "function" ? q.title() : q.title;
    el.querySelector(".answer").textContent = text;
    el.title = "タップで答えなおす";
    el.addEventListener("click", () => reopen(index));
    return el;
  }

  function formatAnswer(v) {
    if (v && typeof v === "object" && !Array.isArray(v)) return [...(v.chips || []), v.text].filter(Boolean).join("、") || "（なし）";
    return [].concat(v).join("、");
  }

  // 答えなおし：その質問以降を消して、そこから再開
  function reopen(index) {
    const removed = state.order.splice(index);
    for (const id of removed) delete state.answers[id];
    state.aiQuestions = [];
    state.aiCount = state.order.filter((id) => id.startsWith("ai")).length;
    const q = questionFor(removed[0]);
    state.current = q;
    renderCards();
    updateGrow();
  }

  function activeCard(q, opts) {
    const el = document.createElement("div");
    el.className = "card" + (q.isAI ? " ai" : "") + (q.shop ? " shop" : "");
    const title = typeof q.title === "function" ? q.title() : q.title;
    el.innerHTML = `${q.isAI ? '<span class="ai-tag">✦ もうひとつだけ</span>' : ""}<p class="q"></p>${q.sub ? '<p class="sub"></p>' : ""}`;
    el.querySelector(".q").textContent = title;
    if (q.sub) el.querySelector(".sub").textContent = q.sub;

    if (q.type === "photo") {
      el.appendChild(photoPicker(q));
      return el;
    }

    if (q.type === "text") {
      const ta = document.createElement("textarea");
      ta.rows = 3; ta.placeholder = q.placeholder || "";
      el.appendChild(ta);
      el.appendChild(actions(() => submit(q, ta.value.trim() || null), q.optional, () => submit(q, null), false));
      return el;
    }

    // 選択肢の最後に「その他」を足し、選ぶと自由記述の欄が出る（自由記述欄がある質問・占いの答え合わせは除く）
    const withOther = !q.noOther && !q.withText;
    const options = (typeof q.options === "function" ? q.options() : q.options).filter((o) => o !== OTHER);
    if (withOther) options.push(OTHER);
    const selected = new Set(opts.preselect || []);
    const chips = document.createElement("div");
    chips.className = "chips";
    const chipEls = [];
    let sent = false;
    for (const o of options) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip" + (o === OTHER ? " other" : ""); b.textContent = o;
      b.addEventListener("click", () => {
        if (navigator.vibrate) navigator.vibrate(6);
        if (q.type === "single") {
          selected.clear(); selected.add(o);
          refresh();
          // 1つ選ぶ質問はタップで次へ（「その他」だけは書いてから「次へ」）
          if (o !== OTHER && !q.withText && !sent) { sent = true; setTimeout(() => submit(q, o), 160); }
        } else {
          selected.has(o) ? selected.delete(o) : selected.add(o);
          refresh();
        }
        if (o === OTHER && selected.has(OTHER)) otherInput.focus();
      });
      chips.appendChild(b);
      chipEls.push([o, b]);
    }
    el.appendChild(chips);

    let otherInput = null;
    if (withOther) {
      otherInput = document.createElement("input");
      otherInput.type = "text"; otherInput.className = "other-input"; otherInput.maxLength = 60;
      otherInput.placeholder = "その他の答えを自由に書いてね";
      otherInput.hidden = true;
      otherInput.addEventListener("input", () => refresh());
      el.appendChild(otherInput);
    }
    let ta = null;
    if (q.withText) {
      ta = document.createElement("textarea");
      ta.rows = 2; ta.placeholder = "自由に書いてもOK（例：栗のお菓子が食べたい）";
      el.appendChild(ta);
    }

    // 「その他」は書いた言葉に置きかえて答えにする
    const picked = () => {
      const list = [...selected].filter((o) => o !== OTHER);
      const own = otherInput ? otherInput.value.trim() : "";
      if (selected.has(OTHER) && own) list.push(own);
      return list;
    };
    const value = () => (q.withText ? { chips: picked(), text: ta.value.trim() } : q.type === "single" ? picked()[0] : picked());
    const canNext = () => {
      if (selected.has(OTHER) && !otherInput.value.trim()) return false; // 「その他」を選んだら一言書いてもらう
      return picked().length > 0 || !!q.withText || (q.type === "multi" && !!q.optional);
    };
    const row = actions(() => submit(q, value()), q.optional, () => submit(q, null), true);
    const nextBtn = row.querySelector(".next-btn");
    el.appendChild(row);
    function refresh() {
      for (const [o, b] of chipEls) b.setAttribute("aria-pressed", selected.has(o) ? "true" : "false");
      if (otherInput) otherInput.hidden = !selected.has(OTHER);
      nextBtn.disabled = !canNext();
      // 「次へ」は、自由記述を書くときと、いくつも選ぶ質問のときだけ出す
      nextBtn.hidden = q.type === "single" && !q.withText && !selected.has(OTHER);
      row.hidden = nextBtn.hidden && !q.optional;
    }
    refresh();
    return el;
  }

  // ---------- 写真 ----------
  // 選んだ写真はスマホの中で縮小してから使う（通信量を抑えるため）
  const MAX_PHOTOS = 3;
  function shrinkPhoto(file) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 1080 / Math.max(img.width, img.height));
        const cv = document.createElement("canvas");
        cv.width = Math.round(img.width * scale); cv.height = Math.round(img.height * scale);
        cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height);
        URL.revokeObjectURL(url);
        resolve(cv.toDataURL("image/jpeg", 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
      img.src = url;
    });
  }
  function photoPicker(q) {
    const wrap = document.createElement("div");
    state.photos = state.photos || [];
    wrap.innerHTML = `<div class="photos"></div>
      <label class="photo-add"><input type="file" accept="image/*" multiple hidden>📷 写真を選ぶ・撮る</label>`;
    const list = wrap.querySelector(".photos");
    const input = wrap.querySelector("input");
    const draw = () => {
      list.innerHTML = state.photos.map((src, i) => `<div class="ph"><img src="${src}" alt="買ったお菓子の写真${i + 1}"><button type="button" data-i="${i}" aria-label="この写真を外す">×</button></div>`).join("");
      for (const b of list.querySelectorAll("button")) b.onclick = () => { state.photos.splice(+b.dataset.i, 1); draw(); };
      wrap.querySelector(".photo-add").hidden = state.photos.length >= MAX_PHOTOS;
      next.textContent = state.photos.length ? "次へ" : "写真なしで次へ";
    };
    input.addEventListener("change", async () => {
      for (const f of [...input.files].slice(0, MAX_PHOTOS - state.photos.length)) {
        const src = await shrinkPhoto(f);
        if (src) state.photos.push(src);
      }
      input.value = "";
      draw();
    });
    const row = actions(() => submit(q, state.photos.length ? `写真${state.photos.length}枚` : null), false, null, false);
    const next = row.querySelector(".next-btn");
    wrap.appendChild(row);
    draw();
    return wrap;
  }
  function renderFinishPhotos() {
    const box = $("photoBox");
    const photos = (state && state.photos) || [];
    box.hidden = !photos.length;
    if (!photos.length) { $("step2").textContent = C.gbpDirect ? "Googleマップで ☆ をタップして評価" : "Googleマップで「クチコミを書く」→ ☆ をタップ"; return; }
    box.innerHTML = `<p class="photo-note">📷 この写真もGoogleの口コミに付けられます</p><div class="photos">${photos.map((src, i) => `<div class="ph"><img src="${src}" alt="買ったお菓子の写真${i + 1}"></div>`).join("")}</div>`;
    $("step2").textContent = (C.gbpDirect ? "☆ をタップ" : "「クチコミを書く」→ ☆ をタップ") + " →「写真を追加」でこの写真を選ぶ";
  }

  function actions(onNext, optional, onSkip, disabled) {
    const row = document.createElement("div");
    row.className = "card-actions";
    if (optional) {
      const s = document.createElement("button");
      s.type = "button"; s.className = "skip-btn"; s.textContent = "スキップ";
      s.addEventListener("click", onSkip);
      row.appendChild(s);
    }
    if (onNext) {
      const n = document.createElement("button");
      n.type = "button"; n.className = "next-btn"; n.textContent = "次へ"; n.disabled = !!disabled;
      n.addEventListener("click", onNext);
      row.appendChild(n);
    }
    return row;
  }

  async function submit(q, value) {
    state.answers[q.id] = value;
    state.order.push(q.id);
    state.current = null;
    if (q.react) { const r = q.react(value); if (r) toast(r); }
    updateGrow();

    // 3問答えたら「くわしい運勢」を開放（お店へのアンケートへのお礼。Google投稿とは無関係）
    if (!state.unlocked && state.order.length >= 3) {
      state.unlocked = true;
      toast("🔓 くわしい運勢がひらきました！最後に読めます");
    }

    if (q.ai && aiOn() && state.aiCount < MAX_AI_FOLLOWUPS) {
      renderCards();
      const thinking = document.createElement("p");
      thinking.className = "thinking"; thinking.textContent = "✦ あなたの答えから、次の質問を考えています…";
      $("cards").appendChild(thinking);
      const fq = await fetchFollowup();
      thinking.remove();
      if (fq) {
        state.aiCount++;
        const id = "ai" + state.aiCount;
        const aq = { id, isAI: true, type: "single", title: fq.title, sub: fq.sub, options: fq.options, optional: true };
        state.aiAsked = state.aiAsked || {};
        state.aiAsked[id] = aq;
        state.aiQuestions.push(aq);
      }
    }
    askNext();
  }

  // ---------- AI ----------
  function surveyContext() {
    return {
      shopName: C.shopName,
      fortuneCharacter: fortuneProduct().name,
      products: activeProducts.map((p) => p.name),
      answers: state.order
        .filter((id) => !questionFor(id).shop)
        .map((id) => {
          const q = questionFor(id);
          return { question: typeof q.title === "function" ? q.title() : q.title, answer: state.answers[id] === null ? "（スキップ）" : formatAnswer(state.answers[id]) };
        }),
    };
  }

  // AIを使えるか（LINE連携中は、公式LINEの友だちだけ）
  const aiOn = () => !!C.aiEndpoint && (!C.liffId || line.friend);

  async function callAI(path, body, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(C.aiEndpoint.replace(/\/$/, "") + path, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(line.token ? { ...body, lineToken: line.token } : body), signal: ctrl.signal,
      });
      if (!res.ok) return null;
      return await res.json();
    } catch { return null; } finally { clearTimeout(timer); }
  }

  async function fetchFollowup() {
    const data = await callAI("/followup", surveyContext(), 8000);
    const q = data && data.question;
    if (!q || !q.title || !Array.isArray(q.options) || q.options.length < 2) return null;
    return { title: String(q.title), sub: q.sub ? String(q.sub) : "", options: q.options.slice(0, 6).map(String), multi: !!q.multi };
  }

  // ---------- 口コミ文章（AIなしの組み立て） ----------
  const joinTo = (a) => (a.length <= 1 ? a[0] || "" : a.slice(0, -1).join("、") + "と" + a[a.length - 1]);
  const teForm = (w) => (w.endsWith("いい") ? w.slice(0, -2) + "よくて" : w.endsWith("い") ? w.slice(0, -1) + "くて" : w + "で");
  const end = (s) => (/[。！!？?]$/.test(s) ? s : s + "。");

  const REASON = {
    "見た目に惹かれて": "見た目に惹かれて", "前に食べておいしかった": "前回おいしかったのでリピートで",
    "口コミを見て": "口コミを見て気になり", "季節限定だから": "季節限定と聞いて",
    "店員さんのおすすめ": "店員さんのおすすめで", "通りがかりに": "通りがかりに立ち寄って",
    "自販機で見かけて": "お店の前の自販機で見かけて", "お菓子教室で知って": "お菓子教室をきっかけに", "人に勧められて": "人に勧められて",
  };
  const SWEET = {
    "かなり控えめ": "甘さはかなり控えめです。", "控えめ": "甘さは控えめで、上品な味わいです。",
    "ちょうどいい": "甘さはちょうどいいバランスです。", "しっかり甘い": "甘さはしっかりめで、甘党にはうれしい味です。",
  };
  const SCENE = {
    "自分へのご褒美": "自分へのご褒美に", "家族と": "家族と", "友人と": "友人と",
    "手土産・ギフトに": "手土産に", "お祝いに": "お祝いに", "仕事の休憩に": "仕事の休憩に",
  };
  const TIMING = { "朝ごはんに": "朝ごはんに", "午後のおやつ": "午後のおやつに", "夜のご褒美": "夜のご褒美に", "コーヒーと": "コーヒーと一緒に", "紅茶と": "紅茶と一緒に" };
  const GIFT = {
    "とても喜ばれた": "とても喜ばれました", "目上の方にも安心": "目上の方にも安心して渡せます", "個包装で配りやすい": "個包装で配りやすいです",
    "見た目が華やか": "見た目が華やかです", "子どもにも人気": "子どもにも人気でした", "日持ちして助かる": "日持ちするのも助かります",
  };
  const TIPS = {
    "日持ちする": "日持ちするので手土産にも良さそうです", "持ち歩きしやすい": "持ち歩きしやすいのもうれしいポイントです",
    "温めるとさらにおいしい": "少し温めるとさらにおいしくなります", "冷やすとさらにおいしい": "冷やして食べるのもおすすめです",
    "早い時間が品ぞろえ◎": "早めの時間に行くと品ぞろえが豊富です", "量がちょうどいい": "量もちょうどいいです",
    "価格以上の満足感": "価格以上の満足感がありました", "ラッピングが丁寧": "ラッピングも丁寧でした",
  };
  const PREF_FIXED = ["甘さ控えめ派", "甘いものはあまり食べない"];
  const PREF = { "チョコ系": "チョコ系", "フルーツ系": "フルーツ系", "焼き菓子": "焼き菓子", "和の素材": "和の素材のお菓子" };

  function composeLocal() {
    const s = [];
    const names = eatenNames();
    if (names.length) {
      const r = REASON[ans("reason")] || (ans("reason") ? `「${ans("reason")}」がきっかけで` : "");
      s.push(`${r ? r + "、" : ""}${joinTo(names)}を購入しました。`);
    }

    const t = arr("texture"), f = arr("flavor"), focus = focusName();
    if (t.length) {
      const chain = t.slice(0, -1).join("、") + (t.length > 1 ? "、" : "") + teForm(t[t.length - 1]);
      s.push(f.length ? `${focus}は${chain}、${joinTo(f)}が印象的でした。`
        : `${focus}は${chain}、${vary("t", ["また食べたくなる味でした。", "とてもおいしかったです。"])}`);
    } else if (f.length) {
      s.push(`${focus}は${joinTo(f)}が印象的でした。`);
    }
    if (SWEET[ans("sweet")]) s.push(SWEET[ans("sweet")]);
    else if (ans("sweet")) s.push(`甘さは「${ans("sweet")}」という印象でした。`);

    const pref = arr("pref");
    const mild = ["かなり控えめ", "控えめ", "ちょうどいい"].includes(ans("sweet"));
    if (pref.includes("甘いものはあまり食べない") && mild) s.push("普段あまり甘いものを食べない私でも、ぺろりと食べられました。");
    else if (pref.includes("甘さ控えめ派") && mild) s.push("甘さ控えめ派の私でも、最後までおいしく食べられました。");
    else {
      // 選択肢の言葉は言いかえ、「その他」に書いた言葉はそのまま使う
      const liked = pref.filter((p) => PREF[p] || !PREF_FIXED.includes(p)).map((p) => PREF[p] || p);
      if (liked.length) s.push(`普段は${joinTo(liked)}が好きな私も、${vary("p", ["大満足でした。", "また食べたいと思える味でした。"])}`);
    }

    const scene = ans("scene");
    if (scene && isGiftScene()) {
      s.push(`${SCENE[scene]}選びました。`);
      const g = arr("gift").map((x) => GIFT[x] || x);
      if (g.length) s.push(g.join("。") + "。");
    } else if (scene) {
      const tm = TIMING[ans("timing")] || ans("timing");
      const sc = scene === "自分へのご褒美" && ans("timing") === "夜のご褒美" ? "" : SCENE[scene] || scene;
      s.push([sc, tm].filter(Boolean).join("、") + "いただきました。");
    }

    const tips = arr("tips").map((x) => TIPS[x] || x);
    if (tips.length) s.push(tips.join("。") + "。");
    if (ans("free")) s.push(end(ans("free")));
    return s.join("");
  }

  function updateGrow() {
    const text = state ? composeLocal() : "";
    const el = $("growText");
    el.textContent = text || "答えるたびに、ここに文章ができていきます。";
    el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump");
  }

  // ---------- finish ----------
  const TRAIT = {
    "ぴったり当たってた！": ["直感さえわたりタイプ", "今週は、ピンときたものを迷わず選ぶと吉。"],
    "ちょっとだけ": ["バランス感覚タイプ", "今週は、いつもと少しだけ違う選択が幸運を運びます。"],
    "ぜんぜん違う魅力だった": ["新発見ハンタータイプ", "今週は、はじめてのお店や道に出会いがあります。"],
  };

  // くわしい運勢。日付と今日のキャラで決まるので、同じ日に何度開いても同じ内容になる
  const STAR_TEXT = {
    love: ["焦らずゆっくりが吉。自分を大事にする日。", "さりげない気づかいが伝わる日。", "うれしい連絡が届きそう。素直な言葉が◎"],
    work: ["今日は準備の日。メモをとっておくと後で役立ちます。", "ひとつずつ片づけると、午後から流れにのれます。", "ひらめきが冴える日。思いついたら即メモ！"],
    money: ["小さな出費はごほうびと割り切って。", "使うほどめぐる日。誰かへのプレゼントが吉。", "思わぬお得に出会えそう。レシートは大事に。"],
    treat: ["今日は甘いもので一休みが正解。", "ひと口目をゆっくり味わうと運気アップ。", "ごほうび運MAX！気になっていたお菓子をどうぞ。"],
  };
  const LUCKY_COLORS = ["キャラメル色", "ミルクティー色", "いちごピンク", "レモンイエロー", "ピスタチオグリーン", "ショコラブラウン", "マロンベージュ", "パンプキンオレンジ"];
  const LUCKY_ACTIONS = ["温かい飲みものをていねいに淹れる", "いつもと違う道を歩く", "誰かに「おいしかった」を伝える", "窓をあけて深呼吸", "お気に入りの器でおやつを食べる", "手書きでメモを残す", "5分だけ早く寝る", "写真を1枚撮っておく"];
  const LUCKY_TIME = { "朝ごはんに": "朝 8時ごろ", "午後のおやつ": "午後 3時ごろ", "夜のご褒美": "夜 9時ごろ", "コーヒーと": "午後 2時ごろ", "紅茶と": "午後 4時ごろ" };
  const SWEET_ADVICE = {
    "かなり控えめ": "ほどよい加減を知っているあなた。今週は「腹八分目」の判断がうまくいきます。",
    "控えめ": "上品なものを見分けるあなた。迷ったら、シンプルなほうを選ぶと吉。",
    "ちょうどいい": "バランス上手なあなた。今週は人と人のあいだをつなぐ役で輝きます。",
    "しっかり甘い": "ごほうび上手なあなた。今週は自分をちょっと甘やかすほど運気アップ。",
  };
  const RANK_STARS = { "大吉": 5, "中吉": 4, "小吉": 3, "吉": 3, "末吉": 2 };

  function seededRandom(seedText) {
    let h = 2166136261;
    for (const ch of seedText) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); }
    return () => { h ^= h << 13; h ^= h >>> 17; h ^= h << 5; return ((h >>> 0) % 10000) / 10000; };
  }

  function renderFortune() {
    const rnd = seededRandom(todayKey + state.fortune.productId);
    const pick = (list) => list[Math.floor(rnd() * list.length)];
    const [trait, line] = TRAIT[ans("check")] || ["マイペースタイプ", "今週は、自分のペースを守ると吉。"];
    const eaten = new Set(eatenNames());
    const candidates = activeProducts.filter((p) => !eaten.has(p.name) && p.id !== state.fortune.productId);
    const next = candidates.find((p) => p.seasons) || candidates[0] || fortuneProduct();
    const stars = (n) => "★".repeat(n) + "☆".repeat(5 - n);
    const rows = [
      ["総合運", RANK_STARS[state.fortune.rank] || 3, fortuneProduct().fortune],
      ...[["恋愛運", "love"], ["仕事・勉強運", "work"], ["金運", "money"], ["ごほうび運", "treat"]].map(([label, key]) => {
        const n = 2 + Math.floor(rnd() * 4); // 2〜5
        return [label, n, STAR_TEXT[key][n <= 2 ? 0 : n <= 4 ? 1 : 2]];
      }),
    ];
    const lucky = [
      ["ラッキーアイテム", state.fortune.lucky],
      ["ラッキーカラー", pick(LUCKY_COLORS)],
      ["ラッキータイム", LUCKY_TIME[ans("timing")] || pick(Object.values(LUCKY_TIME))],
      ["開運アクション", pick(LUCKY_ACTIONS)],
    ];
    const box = $("deep");
    box.innerHTML = `<h3>🔮 今日のくわしい運勢</h3>
      <p class="ft-type"></p><p class="ft-line"></p>
      <div class="ft-rows">${rows.map(() => `<div class="ft-row"><span class="ft-label"></span><span class="ft-stars"></span><p class="ft-text"></p></div>`).join("")}</div>
      <dl class="ft-lucky">${lucky.map(() => "<div><dt></dt><dd></dd></div>").join("")}</dl>
      <p class="ft-advice"></p>
      <div class="ft-next"><div class="ft-next-art">${art(next, 1)}</div><p></p></div>
      <a class="line-btn" target="_blank" rel="noopener" hidden>明日の運勢もチェック！LINEで友だち追加して、新作・季節限定のお知らせを受け取る</a>`;
    box.querySelector(".ft-type").textContent = `${focusName()}を選んだあなたは「${trait}」`;
    box.querySelector(".ft-line").textContent = line;
    box.querySelectorAll(".ft-row").forEach((el, i) => {
      el.querySelector(".ft-label").textContent = rows[i][0];
      el.querySelector(".ft-stars").textContent = stars(rows[i][1]);
      el.querySelector(".ft-stars").setAttribute("aria-label", `5段階中${rows[i][1]}`);
      el.querySelector(".ft-text").textContent = rows[i][2];
    });
    box.querySelectorAll(".ft-lucky div").forEach((el, i) => {
      el.querySelector("dt").textContent = lucky[i][0];
      el.querySelector("dd").textContent = lucky[i][1];
    });
    const advice = box.querySelector(".ft-advice");
    advice.textContent = SWEET_ADVICE[ans("sweet")] || "";
    advice.hidden = !advice.textContent;
    box.querySelector(".ft-next p").textContent = `次に会うと運気が上がるキャラ：${nameOf(next)}（${next.name}）`;
    setupLineButton(box.querySelector(".line-btn"));
  }

  function setupLineButton(a) {
    if (!a) return;
    a.hidden = !C.lineUrl || line.friend;
    if (C.lineUrl) a.href = C.lineUrl;
  }

  // くわしい運勢を出して、そこまでスクロールする
  function revealFortune(scroll) {
    const box = $("deep");
    if (!state || !state.finished) return;
    box.hidden = false;
    if (scroll) box.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  async function finishSurvey() {
    state.finished = true;
    show("screenFinish");
    renderFortune();
    $("deep").hidden = !claimedToday();
    renderRewardBox();
    renderFinishPhotos();

    const review = $("review");
    review.value = composeLocal();
    updateCount();
    if (aiOn()) {
      review.disabled = true;
      const prev = review.value;
      review.value = "✦ AIが読みやすい文章に整えています…";
      const data = await callAI("/compose", surveyContext(), 12000);
      review.value = data && typeof data.review === "string" && data.review.trim() ? data.review.trim() : prev;
      review.disabled = false;
      updateCount();
    }
    sendFeedback(review.value);
  }

  function updateCount() { $("count").textContent = `${$("review").value.length}文字`; }

  function sendFeedback(reviewText) {
    if (!C.feedbackEndpoint) return;
    const payload = {
      shop: C.shopName, at: new Date().toISOString(), fortune: state.fortune,
      answers: state.order.map((id) => ({ id, question: (() => { const q = questionFor(id); return typeof q.title === "function" ? q.title() : q.title; })(), answer: state.answers[id] })),
      review: reviewText,
      photos: state.photos || [], // JPEGのdataURL（最大3枚）
    };
    // Apps Script はCORSを返さないので no-cors + text/plain で送る
    fetch(C.feedbackEndpoint, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(payload) }).catch(() => {});
  }

  async function copyAndOpen() {
    const text = $("review").value;
    let ok = false;
    try { await navigator.clipboard.writeText(text); ok = true; } catch {
      const ta = $("review"); ta.select();
      try { ok = document.execCommand("copy"); } catch { ok = false; }
    }
    toast(ok ? "コピーしました！Googleマップで貼り付けてね" : "文章を長押ししてコピーしてください");
    revealFortune(false);
    const r = claimReward();
    if (r) {
      pendingReward = r;
      // 別タブが開かずページが隠れなかったときは、少し待ってそのまま見せる
      setTimeout(() => { if (pendingReward === r && document.visibilityState === "visible") { pendingReward = null; playReward(r); } }, 4000);
    }
    setTimeout(() => window.open(C.gbpReviewUrl, "_blank", "noopener"), ok ? 700 : 1600);
  }
  function skipGoogle() {
    revealFortune(false);
    const r = claimReward();
    if (r) playReward(r); else revealFortune(true);
  }

  // ---------- boot ----------
  function boot() {
    $("shopName").textContent = C.shopName;
    if (theme) document.body.classList.add("theme-" + theme);
    const banner = activeSeasons.find((s) => s.banner);
    if (banner) { $("seasonBanner").textContent = banner.banner; $("seasonBanner").hidden = false; }
    if (activeSeasons.length) {
      $("seasonDeco").innerHTML = SPARKS.slice(0, 5).map((e, i) => {
        const [x, y] = [[-2, 8], [88, 4], [-6, 70], [92, 62], [46, 96]][i];
        return `<span style="--i:${i};left:${x}%;top:${y}%">${e}</span>`;
      }).join("");
    }
    if (!C.gbpDirect) $("step2").textContent = "Googleマップで「クチコミを書く」→ ☆ をタップ";
    document.title = `おみくじクッキー｜${C.shopName}`;
    updateZukanCount();
    buildCookie();

    $("cookieBtn").addEventListener("pointerdown", (e) => { e.preventDefault(); hitCookie(e); });
    $("cookieBtn").addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); hitCookie(); } });
    $("shakeBtn").addEventListener("click", enableShake);
    $("chara").addEventListener("click", pokeChara);
    $("toSurvey").addEventListener("click", startSurvey);
    $("shareCard").addEventListener("click", shareCard);
    $("openZukan").addEventListener("click", openZukan);
    $("closeZukan").addEventListener("click", () => $("zukan").close());
    $("review").addEventListener("input", updateCount);
    $("copyOpen").addEventListener("click", copyAndOpen);
    $("skipGoogle").addEventListener("click", skipGoogle);
    $("backToResult").addEventListener("click", () => show("screenResult"));
    $("evolve").querySelector("[data-act=close]").addEventListener("click", () => {
      $("evolve").hidden = true;
      if (!$("screenFinish").hidden) revealFortune(true); // 受け取ったあとは、最後のくわしい運勢へ
    });
    $("evolve").querySelector("[data-act=zukan]").addEventListener("click", () => { $("evolve").hidden = true; openZukan(); });
    $("finishZukan").addEventListener("click", openZukan);
    setupLineButton($("zukanLine"));

    // 今日すでに割っていたら結果から
    const today = store.get("today", null);
    if (today && today.date === todayKey && productById(today.productId)) {
      renderResult(today);
    }
  }

  // ---------- LINE（LIFF） ----------
  // config.js の liffId を入れると、QRを読んだ人はLINEの中でこのページを開く（公式LINEの友だち追加もそこで出る）。
  // ?web=1 を付けると、LINEを使わずブラウザで開ける（お店の確認用）。
  const LIFF_SDK = "https://static.line-scdn.net/liff/edge/2/sdk.js";
  const inLineApp = /\bLine\//i.test(navigator.userAgent);

  function loadScript(src) {
    return new Promise((ok, ng) => { const el = document.createElement("script"); el.src = src; el.onload = ok; el.onerror = ng; document.head.appendChild(el); });
  }

  let saveTimer = null;
  function scheduleCloudSave() {
    if (!line.on) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(cloudSave, 600);
  }
  async function cloudCall(path, extra) {
    try {
      const res = await fetch(C.aiEndpoint.replace(/\/$/, "") + path, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lineToken: line.token, ...extra }),
      });
      return res.ok ? await res.json() : null;
    } catch { return null; }
  }
  async function cloudSave() {
    const state = {};
    for (const k of SYNC_KEYS) state[k] = store.get(k, null);
    const data = await cloudCall("/state/save", { state });
    if (data && data.state) applyCloud(data.state);
  }
  // サーバーに保存してあった分を、このスマホの分と合わせる（多いほうに合わせる）
  function applyCloud(remote) {
    const raw = (k, v) => { try { localStorage.setItem("kk_" + k, JSON.stringify(v)); } catch { /* ignore */ } }; // 保存し直しを起こさない
    const stages = store.get("stages", {});
    for (const [id, list] of Object.entries(remote.stages || {})) stages[id] = [...new Set([...(stages[id] || []), ...list])];
    raw("stages", stages);
    const zukan = store.get("zukan", {});
    for (const [id, n] of Object.entries(remote.zukan || {})) zukan[id] = Math.max(zukan[id] || 0, n);
    raw("zukan", zukan);
    raw("graduated", [...new Set([...store.get("graduated", []), ...(remote.graduated || [])])]);
    const mine = store.get("partner", null);
    if (remote.partner && (!mine || remote.partner.xp > mine.xp)) raw("partner", remote.partner);
    if (remote.claimed === todayKey) raw("claimed", todayKey);
    const today = store.get("today", null);
    if (!params.has("reset") && remote.today && remote.today.date === todayKey && (!today || today.date !== todayKey)) raw("today", remote.today);
    updateZukanCount();
  }

  async function setupLiff() {
    // LINEの外（スマホのカメラなど）で開いたら、LINEで開き直す。戻ってきたときにくり返さないよう1回だけ
    let redirected = false;
    try { redirected = sessionStorage.getItem("kk_liffJump") === "1"; } catch { /* ignore */ }
    if (!inLineApp && !redirected && !params.has("liff.state")) {
      try { sessionStorage.setItem("kk_liffJump", "1"); } catch { /* ignore */ }
      location.replace(`https://liff.line.me/${C.liffId}${location.search}`);
      return "redirect";
    }
    await loadScript(LIFF_SDK);
    await window.liff.init({ liffId: C.liffId });
    if (!window.liff.isLoggedIn()) { window.liff.login({ redirectUri: location.href }); return "redirect"; }
    line.token = window.liff.getAccessToken();
    line.on = !!line.token;
    try { line.friend = !!(await window.liff.getFriendship()).friendFlag; } catch { line.friend = false; }
    const data = await cloudCall("/state/load", {});
    if (data && data.state) applyCloud(data.state);
    if (data && "friend" in data) line.friend = !!data.friend;
    renderLineStatus();
    if (line.on) cloudSave(); // このスマホにだけあった分もアカウントへ
    // 友だち追加して戻ってきたら、AIを使えるようにする
    document.addEventListener("visibilitychange", async () => {
      if (document.visibilityState !== "visible" || line.friend) return;
      try { line.friend = !!(await window.liff.getFriendship()).friendFlag; } catch { /* ignore */ }
      renderLineStatus();
    });
    return "ok";
  }

  function renderLineStatus() {
    const tip = $("friendTip");
    if (tip) {
      tip.hidden = !line.on || line.friend || !C.lineUrl;
      tip.querySelector("a").href = C.lineUrl || "#";
    }
    const note = $("zukanLineNote");
    if (note) note.hidden = !line.on;
    // 友だちの人には「友だち追加」のボタンは出さない
    document.querySelectorAll(".line-btn").forEach((a) => { if (line.friend) a.hidden = true; });
  }

  async function start() {
    if (C.liffId && !params.has("web")) {
      try { if ((await setupLiff()) === "redirect") return; } catch { /* LINEが使えなくても、そのまま遊べる */ }
    }
    boot();
    renderLineStatus();
    if (params.has("zukan")) openZukan(); // リッチメニューの「図鑑」から
  }

  start();
})();
