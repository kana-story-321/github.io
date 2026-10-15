// 進化するキャラの試作。定番の各商品を「いきもの」として3段階で描きます。
// window.EVOLVE_LINES[商品ID] = { names, descs, art: [段階1, 段階2, 段階3] }
// window.EVOLVE_SVG(段階, 商品ID) で <svg> 文字列を返します。
(() => {
  "use strict";

  const INK = "#5b3a29";
  const LINE = `stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round"`;
  const AMBER = "#f2a541", AMBER_D = "#d9822b", CREAM = "#fff3dc";
  const svg = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">${inner}</svg>`;
  const shine = (x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff"/><circle cx="${x - r * 1.4}" cy="${y + r * 1.6}" r="${r * .45}" fill="#fff"/>`;
  const blush = (x, y) => `<ellipse cx="${x}" cy="${y}" rx="8" ry="5" fill="#ff8fa3" opacity=".55"/>`;

  const STAGES = {
    // 1. こはくたま：殻のすき間から、こっそりのぞいている
    1: () => svg(`
      <ellipse cx="100" cy="182" rx="40" ry="7" fill="#000" opacity=".08"/>
      <ellipse cx="82" cy="176" rx="11" ry="6" fill="${AMBER_D}" ${LINE}/><ellipse cx="118" cy="176" rx="11" ry="6" fill="${AMBER_D}" ${LINE}/>
      <path d="M100 26 C146 26 156 92 156 120 C156 158 132 178 100 178 C68 178 44 158 44 120 C44 92 54 26 100 26Z" fill="#f7c27a" ${LINE}/>
      <path d="M50 108 L64 96 L76 110 L90 94 L104 110 L118 94 L132 110 L146 96 L152 106 L152 122 Q100 132 48 122Z" fill="#3a2418"/>
      <ellipse cx="82" cy="112" rx="6" ry="6.5" fill="#ffe08a"/><ellipse cx="118" cy="112" rx="6" ry="6.5" fill="#ffe08a"/>
      <circle cx="84" cy="110" r="2" fill="#fff"/><circle cx="120" cy="110" r="2" fill="#fff"/>
      <path d="M50 108 L64 96 L76 110 L90 94 L104 110 L118 94 L132 110 L146 96 L152 106" fill="none" ${LINE}/>
      <path d="M48 122 Q100 132 152 122" fill="none" ${LINE}/>
      <ellipse cx="78" cy="56" rx="10" ry="16" fill="#fff" opacity=".5" transform="rotate(20 78 56)"/>
      <circle cx="128" cy="150" r="3" fill="${AMBER_D}"/><circle cx="70" cy="152" r="2.4" fill="${AMBER_D}"/><circle cx="132" cy="62" r="2.4" fill="${AMBER_D}"/>`),

    // 2. ピヨハク：生まれたて。殻をパンツみたいにはいている
    2: () => svg(`
      <ellipse cx="100" cy="184" rx="44" ry="7" fill="#000" opacity=".08"/>
      <path d="M86 44 q-6 -22 8 -26 q-2 12 6 18 q4 -16 18 -12 q-10 6 -8 20" fill="${AMBER}" ${LINE}/>
      <path d="M38 112 q-22 -6 -24 -26 q18 2 30 16z M162 112 q22 -6 24 -26 q-18 2 -30 16z" fill="${AMBER_D}" ${LINE}/>
      <circle cx="100" cy="104" r="62" fill="${AMBER}" ${LINE}/>
      <ellipse cx="100" cy="122" rx="40" ry="30" fill="#ffd38a"/>
      <ellipse cx="80" cy="96" rx="8.5" ry="10" fill="${INK}"/>${shine(83, 92, 3.2)}
      <ellipse cx="120" cy="96" rx="8.5" ry="10" fill="${INK}"/>${shine(123, 92, 3.2)}
      ${blush(62, 116)}${blush(138, 116)}
      <path d="M90 112 L110 112 L100 126 Z" fill="#ff9a3c" ${LINE}/>
      <path d="M44 140 Q46 182 100 184 Q154 182 156 140 L144 152 L130 138 L116 152 L100 138 L84 152 L70 138 L56 152 Z" fill="#fff3dc" ${LINE}/>
      <circle cx="78" cy="168" r="2.5" fill="${AMBER_D}"/><circle cx="124" cy="170" r="2" fill="${AMBER_D}"/>`),

    // 3. コハクロウ：森の物知り長老。羽角（耳）と白い眉、金の琥珀卵を抱えている
    3: () => svg(`
      <ellipse cx="100" cy="188" rx="56" ry="7" fill="#000" opacity=".08"/>
      <path d="M40 54 L50 18 L76 46 Z M160 54 L150 18 L124 46 Z" fill="${AMBER_D}" ${LINE}/>
      <path d="M100 30 C160 30 172 84 172 116 C172 164 140 186 100 186 C60 186 28 164 28 116 C28 84 40 30 100 30Z" fill="${AMBER}" ${LINE}/>
      <path d="M30 120 q-16 24 6 52 q20 -6 26 -30z M170 120 q16 24 -6 52 q-20 -6 -26 -30z" fill="${AMBER_D}" ${LINE}/>
      <path d="M100 66 C126 50 156 62 154 92 C152 116 128 126 100 118 C72 126 48 116 46 92 C44 62 74 50 100 66Z" fill="${CREAM}" ${LINE}/>
      <circle cx="76" cy="90" r="17" fill="#fff" ${LINE}/><circle cx="124" cy="90" r="17" fill="#fff" ${LINE}/>
      <circle cx="78" cy="92" r="10" fill="${INK}"/>${shine(81, 88, 3.4)}
      <circle cx="122" cy="92" r="10" fill="${INK}"/>${shine(125, 88, 3.4)}
      <path d="M58 62 q14 -12 30 -4 M142 62 q-14 -12 -30 -4" stroke="#fff" stroke-width="8" fill="none" stroke-linecap="round"/>
      <path d="M93 104 L107 104 L100 118 Z" fill="#ff9a3c" ${LINE}/>
      <path d="M70 128 q10 8 20 0 q10 8 20 0 q10 8 20 0 M76 146 q8 6 16 0 q8 6 16 0 q8 6 16 0" fill="none" stroke="${AMBER_D}" stroke-width="3" stroke-linecap="round"/>
      <ellipse cx="100" cy="164" rx="18" ry="22" fill="#f5c84c" stroke="#c9952a" stroke-width="4"/>
      <ellipse cx="94" cy="156" rx="5" ry="8" fill="#fff" opacity=".6"/>
      <path d="M72 168 q12 -10 18 4 M128 168 q-12 -10 -18 4" fill="${AMBER}" ${LINE}/>
      <path d="M100 30 l-6 -12 l6 4 l6 -4z" fill="#f5c84c" stroke="#c9952a" stroke-width="2.5" stroke-linejoin="round"/>`),
  };

  // ---------- 共通パーツ ----------
  const eye = (x, y, s = 1) => `<ellipse cx="${x}" cy="${y}" rx="${7 * s}" ry="${8.5 * s}" fill="${INK}"/>${shine(x + 2.6 * s, y - 3.4 * s, 2.8 * s)}`;
  const happyEye = (x, y, s = 1) => `<path d="M${x - 7 * s} ${y + 2 * s} q${7 * s} ${-9 * s} ${14 * s} 0" fill="none" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`;
  const lashEye = (x, y, flip) => eye(x, y) + `<path d="M${x + (flip ? 6 : -6)} ${y - 5} l${flip ? 6 : -6} -5 M${x + (flip ? 3 : -3)} ${y - 8} l${flip ? 3 : -3} -6" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`;
  const smile = (x, y, w = 7) => `<path d="M${x - w} ${y} q${w} ${w * 1.1} ${w * 2} 0" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/>`;
  const openMouth = (x, y, w = 8) => `<path d="M${x - w} ${y} q${w} ${w * 1.5} ${w * 2} 0z" fill="#8a2f3a" stroke="${INK}" stroke-width="2.5" stroke-linejoin="round"/>`;
  const catMouth = (x, y) => `<path d="M${x - 9} ${y} q4.5 5 9 0 q4.5 5 9 0" fill="none" stroke="${INK}" stroke-width="3" stroke-linecap="round"/>`;
  const sparkle = (x, y, s = 1, c = "#f5c84c") => `<path transform="translate(${x} ${y}) scale(${s})" d="M0 -9 Q1.5 -1.5 9 0 Q1.5 1.5 0 9 Q-1.5 1.5 -9 0 Q-1.5 -1.5 0 -9z" fill="${c}"/>`;
  const shadow = (rx, y = 184) => `<ellipse cx="100" cy="${y}" rx="${rx}" ry="7" fill="#000" opacity=".08"/>`;
  const tiara = (cx, y, s = 1) => `<g transform="translate(${cx} ${y}) scale(${s})">
    <path d="M-24 6 L-20 -12 L-10 -1 L0 -20 L10 -1 L20 -12 L24 6 Z" fill="#f5c84c" stroke="#c9952a" stroke-width="3" stroke-linejoin="round"/>
    <ellipse cx="0" cy="-1" rx="4.5" ry="5.5" fill="#e8a33d" stroke="#c9952a" stroke-width="2"/></g>`;
  const topHat = (cx, y, rot = -8, s = 1) => `<g transform="translate(${cx} ${y}) rotate(${rot}) scale(${s})">
    <rect x="-18" y="-36" width="36" height="36" rx="4" fill="#2d2230" stroke="${INK}" stroke-width="3"/>
    <rect x="-18" y="-12" width="36" height="7" fill="#e3667f"/>
    <ellipse cx="0" cy="0" rx="29" ry="6.5" fill="#2d2230" stroke="${INK}" stroke-width="3"/></g>`;
  const chips = (pts, r = 4) => pts.map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="${r}" ry="${r * .8}" fill="#6b3d1c"/>`).join("");
  const DOUGH = "#e2a85c", LEMON = "#ffe066", PUD = "#ffd977", CARA = "#b8641f", CREAMY = "#fff4e2";

  // ---------- 系統ごとの3段階 ----------
  const LINES = {
    // クッキー缶：くま
    cookie: {
      names: ["ほろりん", "クマッキー", "カンカングマ"],
      descs: ["クッキーのかけらから生まれた", "クマの形に焼きあがった", "クッキー缶をたいこにする森の親分"],
      art: [
        () => svg(`${shadow(36, 176)}
          <path d="M68 150 Q62 118 90 112 Q104 98 122 110 Q144 114 138 140 Q144 164 114 166 Q90 172 76 164 Q62 162 68 150Z" fill="${DOUGH}" ${LINE}/>
          ${chips([[84, 124], [128, 128], [118, 156]], 4)}
          ${eye(90, 138, .8)}${eye(114, 138, .8)}${blush(80, 150)}${blush(124, 150)}${smile(102, 148, 5)}
          <circle cx="56" cy="168" r="4" fill="${DOUGH}" ${LINE}/><circle cx="150" cy="166" r="3" fill="${DOUGH}" ${LINE}/>`),
        () => svg(`${shadow(46, 182)}
          <circle cx="66" cy="62" r="17" fill="${DOUGH}" ${LINE}/><circle cx="134" cy="62" r="17" fill="${DOUGH}" ${LINE}/>
          <circle cx="66" cy="62" r="7" fill="#c47f3a"/><circle cx="134" cy="62" r="7" fill="#c47f3a"/>
          <circle cx="100" cy="150" r="34" fill="${DOUGH}" ${LINE}/>
          <circle cx="62" cy="146" r="12" fill="${DOUGH}" ${LINE}/><circle cx="138" cy="146" r="12" fill="${DOUGH}" ${LINE}/>
          <circle cx="100" cy="94" r="44" fill="${DOUGH}" ${LINE}/>
          <ellipse cx="100" cy="112" rx="18" ry="13" fill="#fff4e2" ${LINE}/>
          <ellipse cx="100" cy="106" rx="6" ry="4.5" fill="${INK}"/>${smile(100, 114, 5)}
          ${eye(80, 90)}${eye(120, 90)}${blush(68, 108)}${blush(132, 108)}
          ${chips([[100, 146], [100, 162]], 4)}`),
        () => svg(`${shadow(64, 186)}
          <circle cx="54" cy="44" r="20" fill="${DOUGH}" ${LINE}/><circle cx="146" cy="44" r="20" fill="${DOUGH}" ${LINE}/>
          <circle cx="54" cy="44" r="9" fill="#c47f3a"/><circle cx="146" cy="44" r="9" fill="#c47f3a"/>
          <ellipse cx="100" cy="150" rx="62" ry="40" fill="${DOUGH}" ${LINE}/>
          <circle cx="100" cy="80" r="54" fill="${DOUGH}" ${LINE}/>
          <path d="M70 46 q10 -10 22 -6" stroke="#fff" stroke-opacity=".4" stroke-width="5" fill="none" stroke-linecap="round"/>
          <path d="M62 66 q12 -8 24 0 M114 66 q12 -8 24 0" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>
          ${eye(78, 80)}${eye(122, 80)}${blush(62, 98)}${blush(138, 98)}
          <ellipse cx="100" cy="102" rx="20" ry="14" fill="#fff4e2" ${LINE}/><ellipse cx="100" cy="96" rx="7" ry="5" fill="${INK}"/>${openMouth(100, 104, 6)}
          <ellipse cx="100" cy="158" rx="40" ry="12" fill="#5b8fd1" ${LINE}/>
          <path d="M60 158 V178 Q100 192 140 178 V158" fill="#5b8fd1" ${LINE}/>
          <ellipse cx="100" cy="158" rx="40" ry="12" fill="#7fb3e8" ${LINE}/>
          <path d="M92 158 q-14 -14 -18 0 q4 12 18 0 q14 -14 18 0 q-4 12 -18 0z" fill="#ff7aa2" ${LINE}/>
          <path d="M42 140 q-12 10 2 24 l14 -6z M158 140 q12 10 -2 24 l-14 -6z" fill="${DOUGH}" ${LINE}/>
          ${chips([[60, 126], [140, 128]], 4)}`),
      ],
    },

    // レモンクッキー：アゲハ（レモンの木で育つ）
    lemon: {
      names: ["レモたま", "レモムシ", "レモンアゲハ"],
      descs: ["レモンの葉っぱの上でおねむ", "レモンの輪切りの帽子がお気に入り", "輪切りの羽で風をおこす"],
      art: [
        () => svg(`${shadow(38, 172)}
          <path d="M40 160 Q100 120 160 160 Q100 176 40 160Z" fill="#7cb342" ${LINE}/>
          <path d="M60 156 Q100 138 140 156" stroke="#5c8f2c" stroke-width="3" fill="none"/>
          <path d="M66 132 Q66 100 100 96 Q134 100 134 132 Q134 156 100 156 Q66 156 66 132Z" fill="${LEMON}" ${LINE}/>
          <path d="M100 96 q2 -10 10 -14" stroke="#4f7a2e" stroke-width="5" fill="none" stroke-linecap="round"/>
          ${happyEye(88, 128, .8)}${happyEye(112, 128, .8)}${blush(80, 138)}${blush(120, 138)}${smile(100, 138, 4)}
          <text x="132" y="104" font-size="16" fill="${INK}" font-family="sans-serif" font-weight="700">z</text><text x="142" y="92" font-size="12" fill="${INK}" font-family="sans-serif" font-weight="700">z</text>`),
        () => svg(`${shadow(64, 178)}
          ${[[46, 160, 16], [72, 164, 18], [100, 162, 19]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#9ccc65" ${LINE}/><circle cx="${x}" cy="${y - 4}" r="${r * .3}" fill="${LEMON}"/>`).join("")}
          <circle cx="132" cy="122" r="36" fill="#aed581" ${LINE}/>
          <circle cx="132" cy="84" r="24" fill="${LEMON}" ${LINE}/>
          ${[0, 45, 90, 135].map((a) => `<path d="M132 84 l${(20 * Math.cos(a * Math.PI / 180)).toFixed(1)} ${(20 * Math.sin(a * Math.PI / 180)).toFixed(1)} M132 84 l${(-20 * Math.cos(a * Math.PI / 180)).toFixed(1)} ${(-20 * Math.sin(a * Math.PI / 180)).toFixed(1)}" stroke="#fff6b0" stroke-width="3"/>`).join("")}
          <circle cx="132" cy="84" r="24" fill="none" ${LINE}/>
          ${eye(118, 124)}${eye(146, 124)}${blush(108, 138)}${blush(156, 138)}${openMouth(132, 138, 6)}`),
        () => svg(`${shadow(50, 188)}
          ${sparkle(30, 34, .9)}${sparkle(176, 160, .7)}
          <path d="M96 112 L60 170 L54 188 L72 172 Z M104 112 L140 170 L146 188 L128 172 Z" fill="#ffd54f" ${LINE}/>
          <circle cx="58" cy="78" r="44" fill="${LEMON}" ${LINE}/><circle cx="142" cy="78" r="44" fill="${LEMON}" ${LINE}/>
          ${[58, 142].map((cx) => `<circle cx="${cx}" cy="78" r="32" fill="#fff6b0"/>` + [0, 60, 120].map((a) => `<path d="M${cx} 78 l${(30 * Math.cos(a * Math.PI / 180)).toFixed(1)} ${(30 * Math.sin(a * Math.PI / 180)).toFixed(1)} M${cx} 78 l${(-30 * Math.cos(a * Math.PI / 180)).toFixed(1)} ${(-30 * Math.sin(a * Math.PI / 180)).toFixed(1)}" stroke="${LEMON}" stroke-width="4"/>`).join("")).join("")}
          <circle cx="62" cy="142" r="24" fill="${LEMON}" ${LINE}/><circle cx="138" cy="142" r="24" fill="${LEMON}" ${LINE}/>
          <rect x="88" y="66" width="24" height="96" rx="12" fill="#6b3d1c" ${LINE}/>
          <circle cx="100" cy="62" r="24" fill="#fff4e2" ${LINE}/>
          <path d="M92 40 q-6 -20 -18 -22 M108 40 q6 -20 18 -22" stroke="${INK}" stroke-width="3.5" fill="none" stroke-linecap="round"/>
          <circle cx="74" cy="18" r="5" fill="${LEMON}" ${LINE}/><circle cx="126" cy="18" r="5" fill="${LEMON}" ${LINE}/>
          ${lashEye(91, 62, false)}${lashEye(109, 62, true)}${blush(84, 74)}${blush(116, 74)}${smile(100, 74, 4)}`),
      ],
    },

    // 琥珀卵プリン：ねこのお姫さま（プリンセス）
    pudding: {
      names: ["ぷるたま", "プリにゃん", "プリンセスニャン"],
      descs: ["ぷるぷるゆれるのが得意", "カラメルのねこ耳が自慢", "名前に「プリン」が入っている本物のお姫さま"],
      art: [
        () => svg(`${shadow(40, 176)}
          <ellipse cx="100" cy="166" rx="46" ry="9" fill="#fff" ${LINE}/>
          <path d="M66 162 L74 118 Q100 108 126 118 L134 162 Q100 170 66 162Z" fill="${PUD}" ${LINE}/>
          <path d="M74 124 Q76 110 100 108 Q124 110 126 124 Q118 132 110 124 Q100 134 90 124 Q82 132 74 124Z" fill="${CARA}" ${LINE}/>
          ${eye(88, 142, .8)}${eye(112, 142, .8)}${blush(80, 152)}${blush(120, 152)}${openMouth(100, 150, 4)}
          <path d="M54 130 q-6 6 0 12 M146 130 q6 6 0 12" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".6"/>`),
        () => svg(`${shadow(54, 180)}
          <path d="M150 160 q30 -6 26 -40 q-4 -14 -14 -8 q8 14 -4 30 q-6 8 -18 8z" fill="${CARA}" ${LINE}/>
          <path d="M52 172 L62 96 Q100 84 138 96 L148 172 Q100 182 52 172Z" fill="${PUD}" ${LINE}/>
          <path d="M60 100 L62 58 L84 86 Z M140 100 L138 58 L116 86 Z" fill="${CARA}" ${LINE}/>
          <path d="M64 104 Q66 84 100 82 Q134 84 136 104 Q126 114 116 104 Q106 118 100 106 Q94 118 84 104 Q74 114 64 104Z" fill="${CARA}" ${LINE}/>
          ${eye(82, 128)}${eye(118, 128)}${blush(70, 144)}${blush(130, 144)}${catMouth(100, 142)}
          <path d="M50 136 h-18 M52 146 l-16 6 M150 136 h18 M148 146 l16 6" stroke="${INK}" stroke-width="2.5" stroke-linecap="round"/>`),
        () => svg(`${shadow(62, 188)}
          ${sparkle(28, 60, 1)}${sparkle(176, 96, .8)}${sparkle(166, 36, .6)}
          <path d="M156 170 q34 -10 26 -48 q-6 -14 -16 -6 q10 16 -4 34 q-6 8 -18 8z" fill="${CARA}" ${LINE}/>
          ${`<path d="M168 128 q-12 -10 -14 2 q2 10 14 -2 q12 -10 14 2 q-2 10 -14 -2z" fill="#ff7aa2" ${LINE}/>`}
          <path d="M44 180 Q40 150 64 142 L136 142 Q160 150 156 180 Z" fill="#ffb3c7" ${LINE}/>
          <path d="M44 180 q14 -10 28 0 q14 -10 28 0 q14 -10 28 0 q14 -10 28 0" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round"/>
          <path d="M56 112 Q50 150 62 168 L72 120 Z M144 112 Q150 150 138 168 L128 120 Z" fill="${CARA}" ${LINE}/>
          <circle cx="100" cy="104" r="48" fill="${PUD}" ${LINE}/>
          <path d="M58 86 L58 36 L88 64 Z M142 86 L142 36 L112 64 Z" fill="${CARA}" ${LINE}/>
          <path d="M66 50 L68 64 L78 62 Z M134 50 L132 64 L122 62 Z" fill="#ffb3c7"/>
          <path d="M54 96 Q58 60 100 58 Q142 60 146 96 Q134 86 124 96 Q114 78 100 92 Q86 78 76 96 Q66 86 54 96Z" fill="${CARA}" ${LINE}/>
          ${tiara(100, 58, 1.1)}
          ${lashEye(80, 110, false)}${lashEye(120, 110, true)}${blush(68, 126)}${blush(132, 126)}${catMouth(100, 126)}
          ${[78, 90, 100, 110, 122].map((x, i) => `<circle cx="${x}" cy="${148 + (i === 2 ? 3 : i === 1 || i === 3 ? 2 : 0)}" r="3.8" fill="#fff" stroke="#e0b8a0" stroke-width="1.5"/>`).join("")}`),
      ],
    },

    // ババロア：アザラシ → セイウチ男爵（ババロア＋バロン）
    bavarois: {
      names: ["ぷるっこ", "ババロアザラシ", "ババロン男爵"],
      descs: ["ラズベリーのぼうしをかぶった小さなゼリー", "ひんやりした所でごろごろする", "キバと口ひげが自慢の紳士"],
      art: [
        () => svg(`${shadow(40, 176)}
          <path d="M60 170 Q58 120 100 116 Q142 120 140 170 Q100 178 60 170Z" fill="${CREAMY}" ${LINE}/>
          <path d="M66 136 Q72 116 100 116 Q128 116 134 136 Q126 146 118 138 Q110 150 100 140 Q90 150 82 138 Q74 146 66 136Z" fill="#e3667f" ${LINE}/>
          <circle cx="100" cy="110" r="7" fill="#d9304a" ${LINE}/>
          <path d="M58 160 q-12 4 -12 12 q10 0 16 -6 M142 160 q12 4 12 12 q-10 0 -16 -6" fill="${CREAMY}" ${LINE}/>
          ${eye(88, 154, .8)}${eye(112, 154, .8)}${blush(78, 164)}${blush(122, 164)}${smile(100, 164, 4)}`),
        () => svg(`${shadow(62, 182)}
          <path d="M150 156 q26 -4 30 14 q-18 6 -30 -2 M150 164 q22 8 18 24 q-14 -4 -20 -16" fill="${CREAMY}" ${LINE}/>
          <ellipse cx="96" cy="140" rx="64" ry="42" fill="${CREAMY}" ${LINE}/>
          <circle cx="78" cy="104" r="42" fill="${CREAMY}" ${LINE}/>
          <path d="M44 92 Q48 62 78 60 Q110 62 112 90 Q102 98 96 90 Q88 102 80 92 Q72 102 64 92 Q54 100 44 92Z" fill="#e3667f" ${LINE}/>
          <circle cx="78" cy="56" r="6" fill="#d9304a" ${LINE}/>
          ${eye(62, 108)}${eye(94, 108)}${blush(52, 122)}${blush(104, 122)}
          <ellipse cx="78" cy="124" rx="12" ry="8" fill="#fff" ${LINE}/><ellipse cx="78" cy="118" rx="5" ry="3.5" fill="${INK}"/>
          <path d="M90 168 q8 12 22 10 q-6 -10 -14 -14" fill="${CREAMY}" ${LINE}/>`),
        () => svg(`${shadow(64, 188)}
          <path d="M40 186 Q30 120 100 108 Q170 120 160 186 Z" fill="${CREAMY}" ${LINE}/>
          <path d="M38 150 q-20 10 -16 30 q16 -2 24 -14 M162 150 q20 10 16 30 q-16 -2 -24 -14" fill="${CREAMY}" ${LINE}/>
          <circle cx="100" cy="84" r="50" fill="${CREAMY}" ${LINE}/>
          <path d="M54 72 Q58 38 100 36 Q142 38 146 72 Q134 62 124 72 Q112 56 100 70 Q88 56 76 72 Q66 62 54 72Z" fill="#e3667f" ${LINE}/>
          ${topHat(116, 42, 12, .9)}
          ${eye(80, 82)}${eye(120, 82)}${blush(64, 98)}${blush(136, 98)}
          <circle cx="120" cy="82" r="12" fill="#fff" fill-opacity=".25" stroke="#c9952a" stroke-width="3"/>
          <path d="M129 90 q8 14 2 26" fill="none" stroke="#c9952a" stroke-width="2" stroke-dasharray="3 3"/>
          <path d="M84 116 L80 150 L92 118 Z M116 116 L120 150 L108 118 Z" fill="#fff" ${LINE}/>
          <ellipse cx="88" cy="110" rx="16" ry="12" fill="#f3dfc0" ${LINE}/><ellipse cx="112" cy="110" rx="16" ry="12" fill="#f3dfc0" ${LINE}/>
          ${[[82, 106], [90, 112], [80, 114], [110, 106], [118, 112], [120, 104]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.8" fill="${INK}"/>`).join("")}
          <ellipse cx="100" cy="100" rx="8" ry="5.5" fill="${INK}"/>
          <path d="M100 164 l-16 -9 v18 z M100 164 l16 -9 v18 z" fill="#e3667f" ${LINE}/><circle cx="100" cy="164" r="4.5" fill="#e3667f" ${LINE}/>`),
      ],
    },

    // いちごのロールケーキ：カタツムリ（うずまきの殻）
    roll: {
      names: ["くるりん", "ロルマイ", "マイマイ大将"],
      descs: ["ころころ転がって移動する", "ロールケーキの殻をしょっている", "いちごのかぶとをかぶった森の大将"],
      art: [
        () => svg(`${shadow(36, 176)}
          <circle cx="100" cy="138" r="36" fill="#f6d58f" ${LINE}/>
          <path d="M100 138 m-4 0 a4 4 0 1 1 8 0 a12 12 0 1 1 -20 4 a22 22 0 1 1 36 -10" fill="none" stroke="#fffaf0" stroke-width="8" stroke-linecap="round"/>
          <circle cx="100" cy="146" r="18" fill="#fffaf0"/>
          ${eye(90, 144, .75)}${eye(110, 144, .75)}${blush(82, 154)}${blush(118, 154)}${smile(100, 153, 4)}
          <path d="M54 172 q8 -4 16 0 M140 170 q8 -4 16 0" stroke="${INK}" stroke-width="3" fill="none" stroke-linecap="round" opacity=".5"/>`),
        () => svg(`${shadow(66, 180)}
          <path d="M28 176 Q30 150 60 150 L150 150 Q176 152 176 176 Z" fill="#f3d9b8" ${LINE}/>
          <circle cx="110" cy="110" r="46" fill="#f6d58f" ${LINE}/>
          <path d="M110 110 m-6 0 a6 6 0 1 1 12 0 a16 16 0 1 1 -28 6 a28 28 0 1 1 46 -14" fill="none" stroke="#fffaf0" stroke-width="10" stroke-linecap="round"/>
          <path d="M44 154 Q40 120 58 108 L64 60 M58 108 L46 64" fill="none" ${LINE}/>
          <circle cx="64" cy="58" r="6" fill="#f3d9b8" ${LINE}/><circle cx="46" cy="62" r="6" fill="#f3d9b8" ${LINE}/>
          <path d="M40 156 Q36 116 60 112 Q76 116 76 156Z" fill="#f3d9b8" ${LINE}/>
          ${eye(52, 132, .8)}${eye(68, 132, .8)}${blush(46, 144)}${blush(74, 144)}${smile(60, 142, 4)}`),
        () => svg(`${shadow(78, 188)}
          <path d="M14 184 Q16 150 50 148 L160 148 Q190 150 190 184 Z" fill="#f3d9b8" ${LINE}/>
          <circle cx="120" cy="100" r="62" fill="#f6d58f" ${LINE}/>
          <path d="M120 100 m-7 0 a7 7 0 1 1 14 0 a22 22 0 1 1 -38 8 a38 38 0 1 1 62 -20 a52 52 0 1 1 -96 -6" fill="none" stroke="#fffaf0" stroke-width="12" stroke-linecap="round"/>
          <path d="M150 40 q2 -14 16 -18 q0 14 -16 18z" fill="#7cb342" ${LINE}/>
          <path d="M152 44 l0 -24" stroke="${INK}" stroke-width="3"/><path d="M152 20 l20 6 l-20 6z" fill="#e8344e" ${LINE}/>
          <path d="M26 156 Q22 112 52 104 Q80 112 78 156Z" fill="#f3d9b8" ${LINE}/>
          <path d="M28 100 Q30 64 52 62 Q74 64 76 100 Q52 110 28 100Z" fill="#e8344e" ${LINE}/>
          ${[[40, 82], [52, 74], [64, 82], [46, 94], [60, 94]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="2" ry="3" fill="#ffe08a"/>`).join("")}
          <path d="M38 62 q14 -16 28 0 q-8 -2 -14 6 q-6 -8 -14 -6z" fill="#7cb342" ${LINE}/>
          <path d="M36 116 l12 4 M68 116 l-12 4" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
          ${eye(44, 128, .85)}${eye(62, 128, .85)}${blush(36, 140)}${blush(70, 140)}${openMouth(53, 140, 5)}`),
      ],
    },

    // オーダーケーキ：うさぎのパティシエ
    order: {
      names: ["ホイッピ", "クリームうさぎ", "デコうさシェフ"],
      descs: ["しぼりたての生クリーム", "いちごの鼻がチャームポイント", "どんなケーキも思いのままに飾る"],
      art: [
        () => svg(`${shadow(40, 176)}
          ${[[72, 152, 20], [128, 152, 20], [86, 132, 22], [114, 132, 22], [100, 150, 28]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#fffdf8" ${LINE}/>`).join("")}
          ${[[72, 152, 20], [128, 152, 20], [86, 132, 22], [114, 132, 22]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r - 3.5}" fill="#fffdf8"/>`).join("")}
          <path d="M92 116 Q100 98 108 116 Q110 128 100 130 Q90 128 92 116Z" fill="#e8344e" ${LINE}/>
          <path d="M92 110 q8 -10 16 0 q-8 -3 -16 0z" fill="#7cb342" ${LINE}/>
          <circle cx="97" cy="120" r="1.4" fill="#ffe08a"/><circle cx="103" cy="124" r="1.4" fill="#ffe08a"/>
          ${eye(90, 154, .8)}${eye(112, 154, .8)}${blush(80, 164)}${blush(122, 164)}${smile(101, 162, 4)}`),
        () => svg(`${shadow(50, 182)}
          <path d="M74 86 Q60 30 76 18 Q92 26 90 84Z M126 86 Q140 30 124 18 Q108 26 110 84Z" fill="#fffdf8" ${LINE}/>
          <path d="M78 76 Q70 40 78 30 Q86 38 84 76Z M122 76 Q130 40 122 30 Q114 38 116 76Z" fill="#ffc2d1"/>
          <ellipse cx="100" cy="150" rx="44" ry="32" fill="#fffdf8" ${LINE}/>
          <circle cx="100" cy="110" r="42" fill="#fffdf8" ${LINE}/>
          ${eye(84, 106)}${eye(116, 106)}${blush(72, 122)}${blush(128, 122)}
          <path d="M94 116 q6 -8 12 0 q-2 10 -6 12 q-4 -2 -6 -12z" fill="#e8344e" ${LINE}/>${smile(100, 132, 5)}`),
        () => svg(`${shadow(62, 188)}
          ${sparkle(30, 120, .8)}${sparkle(170, 70, .7)}
          <path d="M74 70 Q58 22 72 10 Q90 16 88 68Z" fill="#fffdf8" ${LINE}/>
          <path d="M78 62 Q70 30 76 22 Q84 28 82 62Z" fill="#ffc2d1"/>
          <path d="M126 70 Q150 40 168 46 Q164 66 116 80Z" fill="#fffdf8" ${LINE}/>
          <path d="M124 70 Q146 50 160 52 Q156 64 120 76Z" fill="#ffc2d1"/>
          <path d="M52 186 Q48 136 100 130 Q152 136 148 186 Z" fill="#fffdf8" ${LINE}/>
          <path d="M70 140 Q100 156 130 140 L134 186 H66 Z" fill="#ffb3c7" ${LINE}/>
          <circle cx="100" cy="100" r="44" fill="#fffdf8" ${LINE}/>
          <path d="M66 70 q-18 -6 -14 -24 q10 -14 26 -6 q4 -18 22 -16 q18 -2 22 16 q16 -8 26 6 q4 18 -14 24 v12 h-68z" fill="#fff" ${LINE}/>
          <path d="M66 80 h68" stroke="${INK}" stroke-width="3"/>
          ${eye(84, 104)}${eye(116, 104)}${blush(72, 120)}${blush(128, 120)}
          <path d="M94 114 q6 -8 12 0 q-2 10 -6 12 q-4 -2 -6 -12z" fill="#e8344e" ${LINE}/>${openMouth(100, 130, 5)}
          <path d="M150 128 l26 -30 l12 10 l-26 30z" fill="#9b6ad8" ${LINE}/><path d="M176 98 l8 -8" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
          <path d="M140 150 q12 -10 18 -18" stroke="${INK}" stroke-width="4" fill="none" stroke-linecap="round"/>`),
      ],
    },
  };
  LINES.gift = {
    names: ["こはくたま", "ピヨハク", "コハクロウ"],
    descs: ["殻のすき間からこっそりのぞいている", "殻をパンツみたいにはいている", "金の琥珀卵を抱えた森の物知り長老"],
    art: [STAGES[1], STAGES[2], STAGES[3]],
  };

  window.EVOLVE_LINES = LINES;
  window.EVOLVE_SVG = (stage, line = "gift") => (LINES[line] && LINES[line].art[stage - 1] ? LINES[line].art[stage - 1]() : null);
})();
