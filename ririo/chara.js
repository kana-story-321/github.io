// キャラクターのイラスト（SVG）。window.CHARA_SVG(id) で <svg> 文字列を返します。
// 絵がない商品は null を返し、ページ側は絵文字で表示します。
(() => {
  "use strict";

  const INK = "#5b3a29";
  const LINE = `stroke="${INK}" stroke-width="3.5" stroke-linejoin="round" stroke-linecap="round"`;
  const GOLD = "#f5c84c", GOLD_D = "#c9952a";

  // ---------- 顔のパーツ ----------
  function eye(x, y, type, ink, flip) {
    const s = flip ? -1 : 1;
    const sparkle = `<ellipse cx="${x}" cy="${y}" rx="6" ry="7.5" fill="${ink}"/>
      <circle cx="${x + 2}" cy="${y - 3}" r="2.6" fill="#fff"/><circle cx="${x - 2}" cy="${y + 3}" r="1.2" fill="#fff"/>`;
    switch (type) {
      case "lash": // お姫さま：まつげ付き
        return sparkle + `<path d="M${x - 5 * s} ${y - 5} l${-6 * s} -4 M${x - 2 * s} ${y - 7} l${-4 * s} -6 M${x + 2 * s} ${y - 7.5} l${-1 * s} -6"
          stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`;
      case "happy": // ニコッと閉じた目
        return `<path d="M${x - 7} ${y + 2} q7 -9 14 0" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`;
      case "calm": // 執事・仙人の、落ち着いた閉じ目
        return `<path d="M${x - 7} ${y - 1} q7 7 14 0" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>`;
      case "wink":
        return flip ? `<path d="M${x - 7} ${y} q7 -8 14 0" fill="none" stroke="${ink}" stroke-width="3.5" stroke-linecap="round"/>` : sparkle;
      default:
        return sparkle;
    }
  }
  function mouth(x, y, type, ink) {
    switch (type) {
      case "open":
        return `<path d="M${x - 8} ${y} q8 12 16 0 z" fill="#8a2f3a" stroke="${ink}" stroke-width="2.5" stroke-linejoin="round"/>
          <path d="M${x - 4} ${y + 5} q4 -3 8 0 q-4 4 -8 0z" fill="#ff8fa0"/>`;
      case "cat":
        return `<path d="M${x - 9} ${y} q4.5 5 9 0 q4.5 5 9 0" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`;
      case "o":
        return `<ellipse cx="${x}" cy="${y + 2}" rx="4" ry="5" fill="#8a2f3a" stroke="${ink}" stroke-width="2.5"/>`;
      case "fang": // 伯爵：ちいさなキバ
        return `<path d="M${x - 9} ${y} q9 9 18 0" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>
          <path d="M${x - 5} ${y + 2.5} l2 5 l2 -4 z M${x + 5} ${y + 2.5} l-2 5 l-2 -4 z" fill="#fff" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>`;
      case "small":
        return `<path d="M${x - 4} ${y} q4 4 8 0" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`;
      default:
        return `<path d="M${x - 7} ${y} q7 8 14 0" fill="none" stroke="${ink}" stroke-width="3.2" stroke-linecap="round"/>`;
    }
  }
  function face(cx, cy, o = {}) {
    const dx = o.dx || 20, ink = o.ink || INK;
    const blush = o.blush === false ? "" :
      `<ellipse cx="${cx - dx - 7}" cy="${cy + 10}" rx="7" ry="4.5" fill="#ff8fa3" opacity=".55"/>
       <ellipse cx="${cx + dx + 7}" cy="${cy + 10}" rx="7" ry="4.5" fill="#ff8fa3" opacity=".55"/>`;
    return blush + eye(cx - dx, cy, o.eyes, ink, false) + eye(cx + dx, cy, o.eyes, ink, true) + mouth(cx, cy + (o.my || 14), o.mouth, ink);
  }

  // ---------- 小物 ----------
  const tiara = (cx, y, gem = "#e8a33d", s = 1) => `<g transform="translate(${cx} ${y}) scale(${s})">
    <path d="M-26 6 L-22 -14 L-11 -2 L0 -22 L11 -2 L22 -14 L26 6 Z" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="0" cy="-22" r="4" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="2"/><circle cx="-22" cy="-14" r="3" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="2"/>
    <circle cx="22" cy="-14" r="3" fill="${GOLD}" stroke="${GOLD_D}" stroke-width="2"/>
    <ellipse cx="0" cy="-1" rx="5" ry="6" fill="${gem}" stroke="${GOLD_D}" stroke-width="2"/><circle cx="-1.5" cy="-3" r="1.6" fill="#fff"/></g>`;
  const topHat = (cx, y, rot = -8, band = "#8c3b4a", s = 1) => `<g transform="translate(${cx} ${y}) rotate(${rot}) scale(${s})">
    <rect x="-20" y="-40" width="40" height="40" rx="4" fill="#2d2230" stroke="${INK}" stroke-width="3"/>
    <rect x="-20" y="-14" width="40" height="8" fill="${band}"/>
    <ellipse cx="0" cy="0" rx="32" ry="7" fill="#2d2230" stroke="${INK}" stroke-width="3"/>
    <path d="M-14 -36 v18" stroke="#fff" stroke-opacity=".25" stroke-width="4" stroke-linecap="round"/></g>`;
  const monocle = (x, y) => `<circle cx="${x}" cy="${y}" r="11" fill="#fff" fill-opacity=".25" stroke="${GOLD_D}" stroke-width="3"/>
    <path d="M${x + 9} ${y + 7} q8 14 2 28" fill="none" stroke="${GOLD_D}" stroke-width="2" stroke-dasharray="3 3"/>`;
  const mustache = (cx, y, c = INK) => `<path d="M${cx} ${y} q-8 -6 -16 0 q-6 5 -12 -2 q4 10 14 7 q8 -2 14 -5 q6 3 14 5 q10 3 14 -7 q-6 7 -12 2 q-8 -6 -16 0z" fill="${c}"/>`;
  const bowtie = (cx, y, c = "#8c3b4a") => `<path d="M${cx} ${y} l-16 -9 v18 z M${cx} ${y} l16 -9 v18 z" fill="${c}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <circle cx="${cx}" cy="${y}" r="4.5" fill="${c}" stroke="${INK}" stroke-width="3"/>`;
  const ribbon = (x, y, c = "#ff7aa2", s = 1) => `<g transform="translate(${x} ${y}) scale(${s})">
    <path d="M0 0 q-16 -14 -20 0 q4 14 20 0 z M0 0 q16 -14 20 0 q-4 14 -20 0 z" fill="${c}" stroke="${INK}" stroke-width="3" stroke-linejoin="round"/>
    <circle r="4.5" fill="${c}" stroke="${INK}" stroke-width="3"/></g>`;
  const sparkle = (x, y, s = 1, c = GOLD) => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -9 Q1.5 -1.5 9 0 Q1.5 1.5 0 9 Q-1.5 1.5 -9 0 Q-1.5 -1.5 0 -9z" fill="${c}"/>`;
  const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${inner}</svg>`;

  // ---------- キャラ ----------
  const CHARA = {
    // 琥珀卵プリン：こはく姫
    pudding: () => svg(`
      ${sparkle(30, 60, 1)}${sparkle(172, 84, .8)}${sparkle(160, 36, .6)}
      <ellipse cx="100" cy="170" rx="74" ry="13" fill="#fff" ${LINE}/>
      <path d="M48 164 L60 78 Q100 64 140 78 L152 164 Q100 176 48 164Z" fill="#ffd977" ${LINE}/>
      <path d="M60 88 Q62 68 100 66 Q138 68 140 88 Q133 100 126 90 Q119 108 110 92 Q100 104 90 92 Q81 108 74 90 Q67 100 60 88Z" fill="#b8641f" ${LINE}/>
      <path d="M78 76 q14 -6 30 -4" stroke="#fff" stroke-opacity=".45" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M50 150 Q100 140 150 150 L152 166 Q141 176 130 166 Q119 178 108 166 Q97 178 86 166 Q75 178 64 166 Q54 176 48 166Z" fill="#ffb3c7" ${LINE}/>
      ${[66, 80, 94, 108, 122, 136].map((x, i) => `<circle cx="${x}" cy="${148 - (i === 0 || i === 5 ? 0 : 2)}" r="3.6" fill="#fff" stroke="#e0b8a0" stroke-width="1.5"/>`).join("")}
      ${tiara(100, 60, "#e8a33d", 1.2)}
      ${face(100, 114, { eyes: "lash", mouth: "small", dx: 21 })}`),

    // 蔵王琥珀卵の詰合せ：琥珀たまご仙人
    gift: () => svg(`
      <ellipse cx="100" cy="40" rx="30" ry="7" fill="none" stroke="${GOLD}" stroke-width="5"/>
      <path d="M30 172 q-6 -16 12 -18 q2 -14 20 -10 q8 -12 24 -4 q14 -10 26 2 q16 -6 22 8 q18 -2 16 16 q12 6 4 14z" fill="#fff" ${LINE}/>
      <ellipse cx="100" cy="108" rx="54" ry="66" fill="#f0a85a" ${LINE}/>
      <ellipse cx="80" cy="76" rx="12" ry="18" fill="#fff" opacity=".45" transform="rotate(20 80 76)"/>
      <circle cx="132" cy="80" r="2.5" fill="#c9773a"/><circle cx="126" cy="70" r="1.8" fill="#c9773a"/><circle cx="70" cy="140" r="2" fill="#c9773a"/>
      <path d="M70 96 q12 -10 24 -2 M106 94 q12 -8 24 2" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round"/>
      ${face(100, 106, { eyes: "calm", mouth: "small", blush: true, dx: 18, my: 10 })}
      <path d="M78 122 q-6 30 10 50 q4 -12 8 -4 q4 -12 8 0 q6 -10 8 2 q16 -20 10 -48 q-10 14 -22 8 q-12 6 -22 -8z" fill="#fff" ${LINE}/>
      <path d="M100 124 q-6 -6 -14 -2 q8 2 14 8 q6 -6 14 -8 q-8 -4 -14 2z" fill="#fff" ${LINE}/>`),

    // かぼちゃのお菓子：かぼちゃプリンちゃん
    pumpkin: () => svg(`
      <ellipse cx="100" cy="170" rx="72" ry="12" fill="#fff" ${LINE}/>
      <path d="M50 164 L62 82 Q100 70 138 82 L150 164 Q100 176 50 164Z" fill="#f6a04d" ${LINE}/>
      <path d="M80 92 L76 160 M120 92 L124 160" stroke="#e07f24" stroke-width="3" opacity=".6"/>
      <path d="M62 92 Q64 74 100 72 Q136 74 138 92 Q130 102 122 92 Q112 106 100 94 Q88 106 78 92 Q70 102 62 92Z" fill="#7a3f12" ${LINE}/>
      <path d="M100 72 q-4 -16 6 -26" stroke="#4f7a2e" stroke-width="8" fill="none" stroke-linecap="round"/>
      <path d="M106 52 q22 -14 30 4 q-18 8 -30 -4z" fill="#7cb342" ${LINE}/>
      ${ribbon(88, 64, "#9b6ad8", .8)}
      ${face(100, 124, { eyes: "sparkle", mouth: "open", dx: 21 })}`),

    // ハロウィン限定ケーキ：ジャック・オ・ランタン伯爵
    jack: () => svg(`
      <path d="M36 168 L20 92 Q40 110 60 104 Z M164 168 L180 92 Q160 110 140 104 Z" fill="#b3202f" ${LINE}/>
      <path d="M40 168 L30 112 Q44 120 60 116 Z M160 168 L170 112 Q156 120 140 116 Z" fill="#2d2230"/>
      <ellipse cx="68" cy="122" rx="34" ry="46" fill="#f08a24" ${LINE}/>
      <ellipse cx="132" cy="122" rx="34" ry="46" fill="#f08a24" ${LINE}/>
      <ellipse cx="100" cy="120" rx="38" ry="50" fill="#f6a04d" ${LINE}/>
      <path d="M100 72 q-2 -10 6 -18" stroke="#4f7a2e" stroke-width="8" fill="none" stroke-linecap="round"/>
      ${topHat(104, 72, 10, "#7a3fb0", .95)}
      ${face(100, 118, { eyes: "sparkle", mouth: "fang", dx: 20 })}
      ${monocle(120, 118)}
      ${bowtie(100, 172, "#7a3fb0")}`),

    // ババロア：ババロア男爵
    bavarois: () => svg(`
      <ellipse cx="100" cy="166" rx="72" ry="14" fill="#e9f2f7" ${LINE}/>
      <path d="M46 158 Q42 76 100 72 Q158 76 154 158 Q100 170 46 158Z" fill="#f8ecd2" ${LINE}/>
      <path d="M58 96 Q66 74 100 72 Q134 74 142 96 Q136 108 128 98 Q122 116 114 100 Q104 112 94 100 Q86 116 78 100 Q68 110 58 96Z" fill="#e3667f" ${LINE}/>
      <circle cx="100" cy="66" r="8" fill="#e3304f" ${LINE}/>
      ${topHat(72, 74, -16, "#3c6fb3", .8)}
      ${face(100, 120, { eyes: "sparkle", mouth: "small", dx: 20, my: 28 })}
      ${monocle(120, 120)}
      ${mustache(100, 136)}`),

    // バレンタインのショコラ：ショコラ執事
    chocolat: () => svg(`
      <rect x="48" y="50" width="104" height="122" rx="16" fill="#6b3b22" ${LINE}/>
      <path d="M48 92 H152 M48 132 H152 M100 132 V172" stroke="#8a5434" stroke-width="3"/>
      <path d="M52 76 Q60 40 104 46 Q146 48 150 76 Q130 60 110 66 Q102 56 92 64 Q72 58 52 76Z" fill="#3e2014" ${LINE}/>
      <path d="M78 54 q12 -6 24 -4" stroke="#fff" stroke-opacity=".35" stroke-width="4" fill="none" stroke-linecap="round"/>
      ${face(100, 100, { eyes: "calm", mouth: "small", dx: 20, ink: "#fff3e0", my: 12 })}
      <path d="M70 172 L100 146 L130 172 Z" fill="#fff" ${LINE}/>
      ${bowtie(100, 150, "#2d2230")}`),

    // 栗のモンブラン：モンブラン博士
    montblanc: () => svg(`
      <path d="M52 140 L62 176 H138 L148 140 Z" fill="#d9a066" ${LINE}/>
      <path d="M62 150 L66 176 M84 150 L86 176 M116 150 L114 176 M138 150 L134 176" stroke="#b7803f" stroke-width="3"/>
      <path d="M44 142 Q42 118 62 112 Q58 92 80 86 Q82 66 100 62 Q118 66 120 86 Q142 92 138 112 Q158 118 156 142 Z" fill="#c8915a" ${LINE}/>
      <path d="M54 130 q46 -16 92 0 M64 108 q36 -12 72 0 M80 88 q20 -8 40 0" stroke="#a87442" stroke-width="3.5" fill="none" stroke-linecap="round"/>
      <g transform="translate(100 58) rotate(-6)">
        <path d="M-34 0 L0 -14 L34 0 L0 14 Z" fill="#2d2230" ${LINE}/><rect x="-16" y="2" width="32" height="10" fill="#2d2230"/>
        <path d="M0 0 L26 6 v18" stroke="${GOLD}" stroke-width="3" fill="none"/><circle cx="26" cy="26" r="4" fill="${GOLD}"/></g>
      <circle cx="80" cy="118" r="13" fill="#fff" fill-opacity=".3" stroke="${INK}" stroke-width="3"/>
      <circle cx="120" cy="118" r="13" fill="#fff" fill-opacity=".3" stroke="${INK}" stroke-width="3"/>
      <path d="M93 118 h14" stroke="${INK}" stroke-width="3"/>
      ${face(100, 118, { eyes: "sparkle", mouth: "smile", dx: 20, my: 18 })}`),

    // 栗の焼き菓子：マロン兄さん
    marron: () => svg(`
      <path d="M100 40 Q154 76 154 124 Q154 170 100 170 Q46 170 46 124 Q46 76 100 40Z" fill="#8a4b2a" ${LINE}/>
      <path d="M52 140 Q100 120 148 140 Q146 168 100 170 Q54 168 52 140Z" fill="#e2b77a" ${LINE}/>
      <circle cx="80" cy="152" r="2" fill="#b7803f"/><circle cx="110" cy="158" r="2" fill="#b7803f"/><circle cx="128" cy="148" r="2" fill="#b7803f"/>
      <path d="M74 64 q16 -10 30 -8" stroke="#fff" stroke-opacity=".35" stroke-width="5" fill="none" stroke-linecap="round"/>
      <path d="M52 86 Q100 70 148 86 L150 98 Q100 82 50 98Z" fill="#e2393b" ${LINE}/>
      <path d="M150 90 l18 -10 l-4 14 z M150 92 l20 6 l-12 8 z" fill="#e2393b" ${LINE}/>
      <path d="M72 106 l16 4 M128 106 l-16 4" stroke="#fff3e0" stroke-width="4" stroke-linecap="round"/>
      ${face(100, 118, { eyes: "wink", mouth: "smile", dx: 20, ink: "#fff3e0" })}`),

    // クッキー缶：クッキー缶ファミリー
    cookie: () => {
      const ck = (x, y, r, o) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#e2a85c" ${LINE}/>
        <circle cx="${x - r * .5}" cy="${y - r * .55}" r="${r * .1}" fill="#6b3d1c"/><circle cx="${x + r * .55}" cy="${y - r * .35}" r="${r * .09}" fill="#6b3d1c"/>
        <circle cx="${x + r * .5}" cy="${y + r * .55}" r="${r * .1}" fill="#6b3d1c"/>
        ${face(x, y - r * .05, Object.assign({ dx: r * .36 }, o))}`;
      return svg(`
        ${ck(100, 92, 56, { eyes: "sparkle", mouth: "open" })}
        ${ck(48, 150, 32, { eyes: "happy", mouth: "small", dx: 11 })}
        ${ck(152, 152, 30, { eyes: "sparkle", mouth: "cat", dx: 10 })}
        ${ribbon(166, 124, "#ff7aa2", .6)}`);
    },

    // レモンクッキー：レモンちゃん
    lemon: () => svg(`
      ${sparkle(34, 50, .8, "#fff3a0")}${sparkle(170, 150, .7, "#fff3a0")}
      <path d="M22 112 Q30 60 100 56 Q170 60 178 112 Q170 164 100 168 Q30 164 22 112Z" fill="#ffe066" ${LINE}/>
      <path d="M40 86 q10 10 22 0 q10 10 22 0 q10 10 22 0 q10 10 22 0 q10 10 22 0" fill="none" stroke="#fff" stroke-width="6" stroke-linecap="round"/>
      <path d="M100 56 q-2 -14 10 -22" stroke="#4f7a2e" stroke-width="6" fill="none" stroke-linecap="round"/>
      <path d="M108 38 q24 -12 34 6 q-20 10 -34 -6z" fill="#7cb342" ${LINE}/>
      ${ribbon(62, 58, "#ff7aa2", .8)}
      ${face(100, 116, { eyes: "lash", mouth: "open", dx: 24 })}`),

    // いちごのロールケーキ：いちごロールくん
    roll: () => svg(`
      <circle cx="100" cy="112" r="64" fill="#f6d58f" ${LINE}/>
      <path d="M100 112 m-6 0 a6 6 0 1 1 12 0 a18 18 0 1 1 -30 6 a32 32 0 1 1 52 -16 a44 44 0 1 1 -74 -6" fill="none" stroke="#fffaf0" stroke-width="12" stroke-linecap="round"/>
      <circle cx="100" cy="122" r="36" fill="#fffaf0"/>
      <path d="M62 50 Q100 18 138 50 Q120 60 100 58 Q80 60 62 50Z" fill="#e8344e" ${LINE}/>
      <circle cx="84" cy="44" r="2" fill="#ffe08a"/><circle cx="100" cy="38" r="2" fill="#ffe08a"/><circle cx="116" cy="44" r="2" fill="#ffe08a"/>
      <path d="M86 26 q14 8 28 0 q-4 10 -14 10 q-10 0 -14 -10z" fill="#7cb342" ${LINE}/>
      ${face(100, 118, { eyes: "sparkle", mouth: "open", dx: 22 })}`),

    // さくらんぼ：さくらんぼ姉妹
    cherry: () => svg(`
      <path d="M70 110 Q80 60 108 30 M132 104 Q124 60 108 30" fill="none" stroke="#4f7a2e" stroke-width="6" stroke-linecap="round"/>
      <path d="M108 30 q26 -14 40 4 q-24 10 -40 -4z" fill="#7cb342" ${LINE}/>
      <circle cx="68" cy="134" r="38" fill="#d9304a" ${LINE}/>
      <circle cx="136" cy="128" r="36" fill="#e8455e" ${LINE}/>
      <path d="M50 116 q8 -10 18 -10 M120 110 q8 -10 18 -10" stroke="#fff" stroke-opacity=".5" stroke-width="5" fill="none" stroke-linecap="round"/>
      ${ribbon(44, 102, "#ffd1e0", .7)}${ribbon(160, 98, "#fff3a0", .7)}
      ${face(68, 136, { eyes: "lash", mouth: "small", dx: 13 })}
      ${face(136, 130, { eyes: "happy", mouth: "small", dx: 13 })}`),

    // オーダーケーキ：デコレーション職人
    order: () => svg(`
      <path d="M40 112 V160 Q100 176 160 160 V112" fill="#fff4f6" ${LINE}/>
      <path d="M40 112 Q100 96 160 112 Q150 124 140 116 Q130 128 120 116 Q110 128 100 116 Q90 128 80 116 Q70 128 60 116 Q50 124 40 112Z" fill="#fff" ${LINE}/>
      <circle cx="56" cy="104" r="7" fill="#e8344e" ${LINE}/><circle cx="144" cy="104" r="7" fill="#e8344e" ${LINE}/>
      <path d="M60 66 q-22 -4 -18 -24 q8 -18 28 -8 q6 -20 30 -18 q24 -2 30 18 q20 -10 28 8 q4 20 -18 24 v26 h-80z" fill="#fff" ${LINE}/>
      <path d="M60 80 h80" stroke="${INK}" stroke-width="3"/>
      ${face(100, 136, { eyes: "happy", mouth: "open", dx: 22, my: 12 })}
      <path d="M150 150 l22 -30 l8 6 l-22 30z" fill="#9b6ad8" ${LINE}/>`),

    // 蔵王琥珀卵以外のギフト系はなし。ハロウィンクッキー：おばけクッキー団
    "halloween-cookie": () => {
      const ghost = (x, y, s, o, hat) => `<g transform="translate(${x} ${y}) scale(${s})">
        <path d="M-40 40 V-6 Q-40 -50 0 -50 Q40 -50 40 -6 V40 q-10 -10 -20 0 q-10 -10 -20 0 q-10 -10 -20 0 q-10 -10 -20 0z" fill="#fbf4ea" stroke="#c98b4b" stroke-width="5" stroke-linejoin="round"/>
        ${face(0, -6, o)}${hat ? `<path d="M-26 -44 L4 -86 L22 -44 Z" fill="#7a3fb0" ${LINE}/><ellipse cx="0" cy="-44" rx="34" ry="7" fill="#7a3fb0" ${LINE}/>` : ""}</g>`;
      return svg(`
        ${ghost(78, 112, 1.1, { eyes: "sparkle", mouth: "o", dx: 15 })}
        ${ghost(148, 140, .7, { eyes: "happy", mouth: "open", dx: 15 }, true)}
        <path d="M150 50 q8 -10 16 0 q8 -10 16 0 q-8 4 -16 14 q-8 -10 -16 -14z" fill="#2d2230"/>`);
    },

    // クリスマスケーキ：サンタショート
    "xmas-cake": () => svg(`
      <path d="M36 168 L60 92 L164 120 L164 168 Z" fill="#fff4f6" ${LINE}/>
      <path d="M40 156 L164 158" stroke="#e8344e" stroke-width="6"/><path d="M38 164 L164 165" stroke="#f6d58f" stroke-width="5"/>
      <path d="M60 92 L164 120 Q154 130 144 120 Q134 130 124 116 Q112 126 104 112 Q94 120 86 106 Q74 112 70 100Z" fill="#fff" ${LINE}/>
      <path d="M86 92 Q100 36 136 52 Q150 58 146 84 Q120 72 86 92Z" fill="#e2393b" ${LINE}/>
      <path d="M82 96 Q116 70 150 86" stroke="#fff" stroke-width="12" fill="none" stroke-linecap="round"/>
      <circle cx="146" cy="56" r="10" fill="#fff" ${LINE}/>
      ${face(112, 126, { eyes: "happy", mouth: "small", dx: 18, my: 10 })}
      <path d="M94 140 q18 20 36 0 q-8 6 -18 4 q-10 2 -18 -4z" fill="#fff" ${LINE}/>`),

    // クリスマスクッキー：スノーマン
    "xmas-cookie": () => svg(`
      ${sparkle(36, 44, .7, "#bfe3ff")}${sparkle(166, 70, .9, "#bfe3ff")}
      <circle cx="100" cy="146" r="40" fill="#fff" ${LINE}/>
      <circle cx="100" cy="82" r="38" fill="#fff" ${LINE}/>
      <path d="M62 108 Q100 124 138 108 L136 122 Q100 136 64 122Z" fill="#d9304a" ${LINE}/>
      <path d="M118 120 l12 34 l12 -4 l-8 -30z" fill="#d9304a" ${LINE}/>
      <path d="M62 70 Q62 36 100 38 Q138 36 138 70" fill="none" stroke="#3c6fb3" stroke-width="7"/>
      <circle cx="62" cy="76" r="12" fill="#7fb3d9" ${LINE}/><circle cx="138" cy="76" r="12" fill="#7fb3d9" ${LINE}/>
      <path d="M100 88 l18 4 l-18 4z" fill="#f08a24" stroke="${INK}" stroke-width="2" stroke-linejoin="round"/>
      ${face(100, 78, { eyes: "sparkle", mouth: "smile", dx: 15, my: 22 })}
      <circle cx="100" cy="140" r="4" fill="${INK}"/><circle cx="100" cy="158" r="4" fill="${INK}"/>`),

    // 春のクッキー缶：さくらクッキーズ
    "spring-cookie": () => {
      const petal = (r) => `<ellipse cx="100" cy="${110 - r}" rx="${r * .62}" ry="${r * .7}" fill="#f6b8c8" ${LINE}/>`;
      const flower = [0, 72, 144, 216, 288].map((a) => `<g transform="rotate(${a} 100 110)">${petal(42)}</g>`).join("");
      return svg(`
        ${flower}<circle cx="100" cy="110" r="40" fill="#f6b8c8"/>
        <path d="M30 40 q8 -8 12 2 q-8 6 -12 -2z M164 176 q8 -8 12 2 q-8 6 -12 -2z M170 40 q8 -8 12 2 q-8 6 -12 -2z" fill="#f6b8c8" ${LINE}/>
        ${ribbon(140, 66, "#fff3a0", .7)}
        ${face(100, 112, { eyes: "lash", mouth: "cat", dx: 18 })}`);
    },
  };

  window.CHARA_SVG = (id) => (CHARA[id] ? CHARA[id]() : null);
})();
