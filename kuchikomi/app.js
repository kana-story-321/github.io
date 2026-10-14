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
    },
  };
  if (params.has("reset")) store.set("today", null);

  const todayKey = (() => {
    const d = new Date();
    return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  })();

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
      const total = C.products.reduce((sum, p) => sum + RARITY_WEIGHT[p.rarity] / countOfRarity(p.rarity), 0);
      let r = Math.random() * total;
      for (const p of C.products) {
        r -= RARITY_WEIGHT[p.rarity] / countOfRarity(p.rarity);
        if (r <= 0) { product = p; break; }
      }
      product = product || C.products[0];
    }
    const rank = product.rarity === "SSR" ? "大吉" : pick(C.luckRanks);
    return { productId: product.id, rank, lucky: pick(C.luckyItems), date: todayKey };
  }
  function countOfRarity(r) { return C.products.filter((p) => p.rarity === r).length; }

  // ---------- cookie ----------
  const cookie = { taps: 0, need: 5 + Math.floor(Math.random() * 4), done: false, crackLen: 0 };
  const TAUNTS = ["いいね！", "その調子！", "ヒビが入った！", "もうすこし…", "あと一押し！", "割れそう…！"];

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
      ${chips.map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="9" ry="7" fill="#5a3424" transform="rotate(${(x * y) % 60} ${x} ${y})"/>`).join("")}
      <path d="M45 95 q20 -40 70 -55" stroke="#fff" stroke-opacity=".35" stroke-width="8" fill="none" stroke-linecap="round"/>`;
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
      if (isSpark) el.textContent = pick(["✨", "⭐", "💫"]);
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
    const isNew = addToZukan(fortune.productId);
    setTimeout(() => renderResult(fortune, isNew), 1300);
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
  function addToZukan(productId) {
    const z = store.get("zukan", {});
    const isNew = !z[productId];
    z[productId] = (z[productId] || 0) + 1;
    store.set("zukan", z);
    updateZukanCount();
    return isNew;
  }
  function updateZukanCount() {
    const z = store.get("zukan", {});
    $("zukanCount").textContent = `${Object.keys(z).length}/${C.products.length}`;
  }
  function openZukan() {
    const z = store.get("zukan", {});
    $("zukanProgress").textContent = `${Object.keys(z).length}/${C.products.length}`;
    $("zukanGrid").innerHTML = C.products.map((p) => {
      const owned = z[p.id];
      return `<div class="zk ${owned ? "" : "locked"}">
        <span class="e">${p.emoji}</span>${owned ? p.chara : "？？？"}
        <div class="n">${p.rarity}${owned ? ` ・ ${owned}回` : ""}</div></div>`;
    }).join("");
    $("zukan").showModal();
  }

  // ---------- result ----------
  const VOICES = [
    "つついても何も出ないよ〜", "今日もいい焼き色でしょ？", "ふふ、くすぐったい！", "答え合わせ、待ってるね",
    "明日も会えるかな？", "図鑑、ぜんぶ埋まった？", "パティシエさんは朝4時起きなんだって",
  ];
  let state = null;

  function renderResult(fortune, isNew) {
    const p = productById(fortune.productId);
    state = state || newSurveyState(fortune);
    $("slip").className = "slip r-" + p.rarity;
    $("rank").textContent = fortune.rank;
    const chara = $("chara");
    chara.textContent = p.emoji;
    chara.style.background = p.color + "33";
    $("rarity").textContent = p.rarity;
    $("rarity").className = "rarity " + p.rarity;
    $("resultTitle").textContent = p.chara;
    $("productName").textContent = `今日のお菓子：${p.name}`;
    $("fortuneText").textContent = p.fortune;
    $("keyword").textContent = `〈${p.keyword}〉`;
    $("luckyItem").textContent = fortune.lucky;
    $("newBadge").hidden = !isNew;
    $("againNote").textContent = "クッキーは1日1枚。また明日、別のキャラに会えるかも。";
    show("screenResult");
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

  // ---------- share card ----------
  async function shareCard() {
    const f = store.get("today", null);
    if (!f) return;
    const p = productById(f.productId);
    const cv = document.createElement("canvas");
    cv.width = 1080; cv.height = 1350;
    const g = cv.getContext("2d");
    g.fillStyle = "#fbf3e6"; g.fillRect(0, 0, 1080, 1350);
    g.fillStyle = p.color + "55"; g.beginPath(); g.arc(540, 520, 260, 0, Math.PI * 2); g.fill();
    g.textAlign = "center"; g.fillStyle = "#4a2f22";
    g.font = "900 64px 'Zen Maru Gothic', sans-serif"; g.fillText(`今日の運勢  ${f.rank}`, 540, 180);
    g.font = "260px serif"; g.fillText(p.emoji, 540, 610);
    g.font = "900 72px 'Zen Maru Gothic', sans-serif"; g.fillText(p.chara, 540, 900);
    g.font = "500 40px 'Zen Maru Gothic', sans-serif";
    wrapText(g, p.fortune, 540, 990, 860, 60);
    g.font = "700 36px 'Zen Maru Gothic', sans-serif"; g.fillStyle = "#e2725b";
    g.fillText(`#${C.shopName}  #おみくじクッキー`, 540, 1270);
    const blob = await new Promise((r) => cv.toBlob(r, "image/png"));
    const file = new File([blob], "omikuji.png", { type: "image/png" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: `#${C.shopName} #おみくじクッキー` });
        return;
      }
    } catch { /* fall through to download */ }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = "omikuji.png"; a.click();
    toast("画像を保存しました");
  }
  function wrapText(g, text, x, y, maxW, lh) {
    let line = "";
    for (const ch of text) {
      if (g.measureText(line + ch).width > maxW) { g.fillText(line, x, y); line = ch; y += lh; } else line += ch;
    }
    g.fillText(line, x, y);
  }

  // ---------- survey ----------
  function newSurveyState(fortune) {
    return { fortune, answers: {}, order: [], aiQuestions: [], aiAsked: {}, aiCount: 0, unlocked: false, finished: false };
  }

  const ans = (id) => state.answers[id];
  const arr = (id) => [].concat(ans(id) || []);
  const eatenNames = () => arr("products").filter((n) => n !== "その他");
  const focusName = () => ans("focus") || eatenNames()[0] || "今日のお菓子";
  const focusProduct = () => productByName(focusName());
  const fortuneProduct = () => productById(state.fortune.productId);
  const isGiftScene = () => ["手土産・ギフトに", "お祝いに"].includes(ans("scene"));

  const GENERIC_TEXTURES = ["さくさく", "しっとり", "ふわふわ", "なめらか", "もっちり", "濃厚"];
  const GENERIC_FLAVORS = ["バターの香り", "素材の味", "上品な甘さ", "華やかな見た目"];

  const QUESTIONS = [
    { id: "products", type: "multi", title: () => "答え合わせ！今日食べた（買った）のはどれ？", sub: "いくつでも選べます",
      options: () => C.products.map((p) => p.name).concat(["その他"]) },
    { id: "focus", type: "single", when: () => eatenNames().length > 1, title: () => "いちばん印象に残ったのは？",
      options: () => eatenNames() },
    { id: "check", type: "single",
      title: () => `占いのキーワードは〈${fortuneProduct().keyword}〉。${focusName()}、当たってた？`,
      options: () => ["ぴったり当たってた！", "ちょっとだけ", "ぜんぜん違う魅力だった"],
      react: (v) => ({ "ぴったり当たってた！": "さすが！直感が冴えてる日です✨", "ちょっとだけ": "ふむふむ、くわしく教えて！", "ぜんぜん違う魅力だった": "新発見！どんな魅力だった？" }[v]) },
    { id: "texture", type: "multi", title: () => `${focusName()}の食感は？`, sub: "読む人がいちばん知りたいポイントです",
      options: () => (focusProduct() ? focusProduct().textures : GENERIC_TEXTURES) },
    { id: "flavor", type: "multi", title: () => "印象に残った味・香りは？",
      options: () => (focusProduct() ? focusProduct().flavors : GENERIC_FLAVORS) },
    { id: "sweet", type: "single", title: () => "甘さはどうでした？", options: () => ["かなり控えめ", "控えめ", "ちょうどいい", "しっかり甘い"], ai: true },
    { id: "scene", type: "single", title: () => "誰と・どんなシーンで？",
      options: () => ["自分へのご褒美", "家族と", "友人と", "手土産・ギフトに", "お祝いに", "仕事の休憩に"] },
    { id: "gift", type: "multi", when: () => isGiftScene(), title: () => "相手の反応や、向いている相手は？",
      options: () => ["とても喜ばれた", "目上の方にも安心", "個包装で配りやすい", "見た目が華やか", "子どもにも人気", "日持ちして助かる"] },
    { id: "timing", type: "single", when: () => ans("scene") && !isGiftScene(), title: () => "どんなタイミングで食べた？",
      options: () => ["朝ごはんに", "午後のおやつ", "夜のご褒美", "コーヒーと", "紅茶と"] },
    { id: "reason", type: "single", title: () => "今日これを選んだ理由は？",
      options: () => C.reasons || ["見た目に惹かれて", "前に食べておいしかった", "口コミを見て", "季節限定だから", "店員さんのおすすめ", "通りがかりに"] },
    { id: "pref", type: "multi", title: () => "普段はどんなお菓子が好き？", sub: "「自分と好みが近い人の感想だ」と読む人に伝わります",
      options: () => ["チョコ系", "フルーツ系", "焼き菓子", "和の素材", "甘さ控えめ派", "甘いものはあまり食べない"], ai: true },
    { id: "tips", type: "multi", title: () => "次に買う人へのひとこと", sub: "知っていると助かる情報を選んでね",
      options: () => ["日持ちする", "持ち歩きしやすい", "温めるとさらにおいしい", "冷やすとさらにおいしい", "早い時間が品ぞろえ◎", "量がちょうどいい", "価格以上の満足感", "ラッピングが丁寧"] },
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

    if (q.type === "text") {
      const ta = document.createElement("textarea");
      ta.rows = 3; ta.placeholder = q.placeholder || "";
      el.appendChild(ta);
      el.appendChild(actions(() => submit(q, ta.value.trim() || null), q.optional, () => submit(q, null), false));
      return el;
    }

    const options = typeof q.options === "function" ? q.options() : q.options;
    const selected = new Set(opts.preselect || []);
    const chips = document.createElement("div");
    chips.className = "chips";
    let nextBtn = null;
    for (const o of options) {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip"; b.textContent = o;
      b.setAttribute("aria-pressed", selected.has(o) ? "true" : "false");
      b.addEventListener("click", () => {
        if (navigator.vibrate) navigator.vibrate(6);
        if (q.type === "single") { submit(q, o); return; }
        selected.has(o) ? selected.delete(o) : selected.add(o);
        b.setAttribute("aria-pressed", selected.has(o) ? "true" : "false");
        if (nextBtn) nextBtn.disabled = !selected.size && !q.optional && !q.withText;
      });
      chips.appendChild(b);
    }
    el.appendChild(chips);

    let ta = null;
    if (q.withText) {
      ta = document.createElement("textarea");
      ta.rows = 2; ta.placeholder = "自由に書いてもOK（例：栗のお菓子が食べたい）";
      el.appendChild(ta);
    }
    if (q.type === "multi") {
      const value = () => (q.withText ? { chips: [...selected], text: ta.value.trim() } : [...selected]);
      const row = actions(() => submit(q, value()), q.optional, () => submit(q, null), !selected.size && !q.optional && !q.withText);
      nextBtn = row.querySelector(".next-btn");
      el.appendChild(row);
    } else if (q.optional) {
      el.appendChild(actions(null, true, () => submit(q, null)));
    }
    return el;
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

    if (q.ai && C.aiEndpoint && state.aiCount < MAX_AI_FOLLOWUPS) {
      renderCards();
      const thinking = document.createElement("p");
      thinking.className = "thinking"; thinking.textContent = "✦ あなたの答えから、次の質問を考えています…";
      $("cards").appendChild(thinking);
      const fq = await fetchFollowup();
      thinking.remove();
      if (fq) {
        state.aiCount++;
        const id = "ai" + state.aiCount;
        const aq = { id, isAI: true, type: fq.multi ? "multi" : "single", title: fq.title, sub: fq.sub, options: fq.options, optional: true };
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
      products: C.products.map((p) => p.name),
      answers: state.order
        .filter((id) => !questionFor(id).shop)
        .map((id) => {
          const q = questionFor(id);
          return { question: typeof q.title === "function" ? q.title() : q.title, answer: state.answers[id] === null ? "（スキップ）" : formatAnswer(state.answers[id]) };
        }),
    };
  }

  async function callAI(path, body, timeoutMs) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(C.aiEndpoint.replace(/\/$/, "") + path, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: ctrl.signal,
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
  const PREF = { "チョコ系": "チョコ系", "フルーツ系": "フルーツ系", "焼き菓子": "焼き菓子", "和の素材": "和の素材のお菓子" };

  function composeLocal() {
    const s = [];
    const names = eatenNames();
    if (names.length) {
      const r = REASON[ans("reason")];
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

    const pref = arr("pref");
    const mild = ["かなり控えめ", "控えめ", "ちょうどいい"].includes(ans("sweet"));
    if (pref.includes("甘いものはあまり食べない") && mild) s.push("普段あまり甘いものを食べない私でも、ぺろりと食べられました。");
    else if (pref.includes("甘さ控えめ派") && mild) s.push("甘さ控えめ派の私でも、最後までおいしく食べられました。");
    else if (pref.some((p) => PREF[p])) s.push(`普段は${joinTo(pref.filter((p) => PREF[p]).map((p) => PREF[p]))}が好きな私も、${vary("p", ["大満足でした。", "また食べたいと思える味でした。"])}`);

    const scene = ans("scene");
    if (scene && isGiftScene()) {
      s.push(`${SCENE[scene]}選びました。`);
      const g = arr("gift").map((x) => GIFT[x]).filter(Boolean);
      if (g.length) s.push(g.join("。") + "。");
    } else if (scene) {
      const tm = TIMING[ans("timing")];
      const sc = scene === "自分へのご褒美" && ans("timing") === "夜のご褒美" ? "" : SCENE[scene];
      s.push([sc, tm].filter(Boolean).join("、") + "いただきました。");
    }

    const tips = arr("tips").map((x) => TIPS[x]).filter(Boolean);
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

  async function finishSurvey() {
    state.finished = true;
    show("screenFinish");
    const [trait, line] = TRAIT[ans("check")] || ["マイペースタイプ", "今週は、自分のペースを守ると吉。"];
    const eaten = new Set(eatenNames());
    const next = C.products.find((p) => !eaten.has(p.name) && p.id !== state.fortune.productId) || fortuneProduct();
    $("deep").innerHTML = `<h3>🔓 くわしい運勢</h3><p></p><p style="margin-top:6px"></p>`;
    const ps = $("deep").querySelectorAll("p");
    ps[0].textContent = `${focusName()}を選んだあなたは「${trait}」。${line}`;
    ps[1].textContent = `次に会うと運気が上がるキャラ：${next.emoji} ${next.chara}（${next.name}）`;

    const review = $("review");
    review.value = composeLocal();
    updateCount();
    if (C.aiEndpoint) {
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
    setTimeout(() => window.open(C.gbpReviewUrl, "_blank", "noopener"), ok ? 700 : 1600);
  }

  // ---------- boot ----------
  function boot() {
    $("shopName").textContent = C.shopName;
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
    $("backToResult").addEventListener("click", () => show("screenResult"));

    // 今日すでに割っていたら結果から
    const today = store.get("today", null);
    if (today && today.date === todayKey && productById(today.productId)) {
      renderResult(today, false);
    }
  }

  boot();
})();
