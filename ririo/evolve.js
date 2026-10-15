// 進化するキャラの試作（琥珀卵の系統）。window.EVOLVE_SVG(stage) で <svg> 文字列を返します。
// 1: こはくたま（たまご） → 2: ピヨハク（ひよこ） → 3: コハクロウ（フクロウの長老）
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

  window.EVOLVE_SVG = (stage) => (STAGES[stage] ? STAGES[stage]() : null);
})();
