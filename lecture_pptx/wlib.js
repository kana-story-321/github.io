/**
 * wlib.js — ai-lecture-worksheet 共通デザイン部品 (フォント大きめ版)
 *   16:9 ワイド 10x5.625in / 配色: 濃紺 ティール 山吹 プラム + 白 + カードグレー
 *   入れない: 回数、企業名、ページ番号、研修名フッター
 */

const COLOR = {
  navy:  '1F3A5F',
  teal:  '0E7C86',
  amber: 'E8A33D',
  plum:  '7C5F8A',
  rose:  'C76B7A',
  white: 'FFFFFF',
  card:  'F4F6F9',
  text:  '1A1A1A',
  sub:   '555555',
  line:  'D7DCE3',
};

const ROTATE = ['teal', 'amber', 'navy', 'plum'];

const FONT_JA = 'Yu Gothic UI';
const FONT_TITLE = 'Yu Gothic UI Semibold';

const SLIDE_W = 10;
const SLIDE_H = 5.625;

// ───────────────────────────────────────────────
// 基本: タイトル付き白背景スライド
// ───────────────────────────────────────────────
function baseSlide(pres, opts = {}) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.white };
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 0.18, h: SLIDE_H, fill: { color: COLOR.teal }, line: { type: 'none' },
  });
  if (opts.title) {
    slide.addText(opts.title, {
      x: 0.45, y: 0.22, w: 9.2, h: 0.65,
      fontSize: 26, bold: true, color: COLOR.navy, fontFace: FONT_TITLE,
    });
  }
  if (opts.subtitle) {
    slide.addText(opts.subtitle, {
      x: 0.45, y: 0.88, w: 9.2, h: 0.40,
      fontSize: 15, color: COLOR.sub, fontFace: FONT_JA, italic: true,
    });
  }
  return slide;
}

// ───────────────────────────────────────────────
// 表紙
// ───────────────────────────────────────────────
function coverSlide(pres, title, concept, kind = 'normal') {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.navy };
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 2.40, w: SLIDE_W, h: 0.05, fill: { color: COLOR.teal }, line: { type: 'none' },
  });
  slide.addText(title, {
    x: 0.6, y: 1.30, w: SLIDE_W - 1.2, h: 1.05,
    fontSize: 38, bold: true, color: COLOR.white, fontFace: FONT_TITLE, align: 'left',
  });
  slide.addText(concept, {
    x: 0.6, y: 2.55, w: SLIDE_W - 1.2, h: 0.70,
    fontSize: 19, color: COLOR.amber, fontFace: FONT_JA, align: 'left',
  });
  if (kind === 'teacher') {
    slide.addText('【講師用 解答・指導ポイント】', {
      x: 0.6, y: 4.5, w: SLIDE_W - 1.2, h: 0.45,
      fontSize: 17, color: COLOR.amber, fontFace: FONT_JA, bold: true,
    });
  }
  return slide;
}

// ───────────────────────────────────────────────
// 学習目標 (3つ)
// ───────────────────────────────────────────────
function goalsSlide(pres, title, goals) {
  const slide = baseSlide(pres, { title });
  const yTop = 1.55;
  const h = 3.20;
  const colW = (SLIDE_W - 0.45 * 2 - 0.4) / 3;
  const accents = ['teal', 'amber', 'navy'];
  goals.forEach((g, i) => {
    const x = 0.45 + i * (colW + 0.2);
    const accent = COLOR[accents[i % accents.length]];
    slide.addShape(pres.ShapeType.roundRect, {
      x, y: yTop, w: colW, h, rectRadius: 0.10,
      fill: { color: COLOR.card }, line: { color: accent, width: 1.5 },
    });
    slide.addShape(pres.ShapeType.rect, {
      x: x + 0.10, y: yTop, w: colW - 0.20, h: 0.08,
      fill: { color: accent }, line: { type: 'none' },
    });
    slide.addText(`0${i + 1}`, {
      x: x + 0.22, y: yTop + 0.20, w: 1.0, h: 0.70,
      fontSize: 30, bold: true, color: accent, fontFace: FONT_TITLE,
    });
    slide.addText(g.title, {
      x: x + 0.22, y: yTop + 0.95, w: colW - 0.44, h: 0.70,
      fontSize: 17, bold: true, color: COLOR.navy, fontFace: FONT_TITLE, valign: 'top',
    });
    slide.addText(g.detail, {
      x: x + 0.22, y: yTop + 1.75, w: colW - 0.44, h: h - 1.90,
      fontSize: 13, color: COLOR.text, fontFace: FONT_JA, valign: 'top',
    });
  });
  return slide;
}

// ───────────────────────────────────────────────
// 用語・前提カード (4つ) — 色ローテーション + 余白圧縮
// ───────────────────────────────────────────────
function termsSlide(pres, title, terms) {
  const slide = baseSlide(pres, { title });
  const yTop = 1.30;
  const totalW = SLIDE_W - 0.40 * 2;
  const colW = (totalW - 0.18 * 3) / 4;
  const cardH = 2.70;
  const noteY = yTop + cardH + 0.30;
  terms.forEach((t, i) => {
    const x = 0.40 + i * (colW + 0.18);
    const accent = COLOR[ROTATE[i % ROTATE.length]];
    slide.addShape(pres.ShapeType.roundRect, {
      x, y: yTop, w: colW, h: cardH, rectRadius: 0.10,
      fill: { color: COLOR.white }, line: { color: accent, width: 1.5 },
    });
    slide.addShape(pres.ShapeType.roundRect, {
      x, y: yTop, w: colW, h: 0.62, rectRadius: 0.10,
      fill: { color: accent }, line: { type: 'none' },
    });
    slide.addShape(pres.ShapeType.rect, {
      x, y: yTop + 0.25, w: colW, h: 0.37,
      fill: { color: accent }, line: { type: 'none' },
    });
    slide.addText(t.term, {
      x: x + 0.14, y: yTop + 0.10, w: colW - 0.28, h: 0.50,
      fontSize: 16, bold: true, color: COLOR.white, fontFace: FONT_TITLE,
      valign: 'middle',
    });
    slide.addText(t.desc, {
      x: x + 0.18, y: yTop + 0.78, w: colW - 0.36, h: cardH - 0.90,
      fontSize: 13, color: COLOR.text, fontFace: FONT_JA, valign: 'top',
      paraSpaceAfter: 2,
    });
  });
  if (terms.some(t => t.note)) {
    const filtered = terms.filter(t => t.note);
    const noteRuns = [];
    filtered.forEach((t, idx) => {
      noteRuns.push({ text: '※ ', options: { color: COLOR.amber, bold: true } });
      noteRuns.push({ text: t.term + ': ', options: { color: COLOR.navy, bold: true } });
      noteRuns.push({ text: t.note + (idx < filtered.length - 1 ? '   ' : ''), options: { color: COLOR.sub } });
    });
    slide.addText(noteRuns, {
      x: 0.40, y: noteY, w: SLIDE_W - 0.80, h: 1.30,
      fontSize: 11, fontFace: FONT_JA, valign: 'top',
    });
  }
  return slide;
}

// ───────────────────────────────────────────────
// 演習 (📍状況 / 💭ヒント / 🎯作るもの)
// ───────────────────────────────────────────────
function exerciseSlide(pres, title, ex) {
  const slide = baseSlide(pres, { title });
  const xL = 0.45, xR = 5.10, w = 4.55;
  card(pres, slide, xL, 1.10, w, 1.95, '📍 シチュエーション', ex.situation, COLOR.navy);
  card(pres, slide, xL, 3.15, w, 2.20, '💭 プロンプトのヒント', ex.hint, COLOR.amber);
  card(pres, slide, xR, 1.10, w, 4.25, '🎯 AIに作ってもらいたいもの', ex.target, COLOR.teal);
  return slide;
}

function card(pres, slide, x, y, w, h, head, body, accent) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.08,
    fill: { color: COLOR.card }, line: { color: COLOR.line, width: 0.5 },
  });
  slide.addShape(pres.ShapeType.rect, {
    x, y, w: 0.10, h, fill: { color: accent }, line: { type: 'none' },
  });
  slide.addText(head, {
    x: x + 0.22, y: y + 0.10, w: w - 0.34, h: 0.42,
    fontSize: 16, bold: true, color: accent, fontFace: FONT_TITLE,
  });
  const bodyOpts = {
    x: x + 0.26, y: y + 0.58, w: w - 0.50, h: h - 0.68,
    fontSize: 14, color: COLOR.text, fontFace: FONT_JA, valign: 'top',
    paraSpaceAfter: 4,
  };
  if (Array.isArray(body)) {
    slide.addText(body.map(t => ({ text: t, options: { bullet: { code: '25CF' } } })), bodyOpts);
  } else {
    slide.addText(body, bodyOpts);
  }
}

// ───────────────────────────────────────────────
// ブラッシュアップ (3観点)
// ───────────────────────────────────────────────
function brushSlide(pres, title, items) {
  const slide = baseSlide(pres, { title, subtitle: 'プロンプトをさらにブラッシュアップ — 3観点でセルフチェック' });
  const yTop = 1.45;
  const totalW = SLIDE_W - 0.45 * 2;
  const colW = (totalW - 0.2 * 2) / 3;
  const h = 3.80;
  const accents = ['teal', 'amber', 'plum'];
  items.forEach((it, i) => {
    const x = 0.45 + i * (colW + 0.2);
    const accent = COLOR[accents[i % accents.length]];
    slide.addShape(pres.ShapeType.roundRect, {
      x, y: yTop, w: colW, h, rectRadius: 0.10,
      fill: { color: COLOR.card }, line: { color: accent, width: 1.2 },
    });
    slide.addShape(pres.ShapeType.rect, {
      x, y: yTop, w: colW, h: 0.50, fill: { color: accent }, line: { type: 'none' },
    });
    slide.addText(`観点 ${String.fromCharCode(65 + i)}`, {
      x: x + 0.14, y: yTop + 0.06, w: colW - 0.28, h: 0.40,
      fontSize: 15, bold: true, color: COLOR.white, fontFace: FONT_TITLE,
    });
    slide.addText(it.title, {
      x: x + 0.20, y: yTop + 0.62, w: colW - 0.32, h: 0.60,
      fontSize: 15, bold: true, color: COLOR.navy, fontFace: FONT_TITLE, valign: 'top',
    });
    slide.addText([
      { text: '✓  ', options: { color: COLOR.teal, bold: true, fontSize: 14 } },
      { text: it.check, options: { color: COLOR.text } },
    ], {
      x: x + 0.20, y: yTop + 1.30, w: colW - 0.32, h: 1.15,
      fontSize: 13, fontFace: FONT_JA, valign: 'top',
    });
    slide.addText([
      { text: '💡  ', options: { color: COLOR.amber, bold: true, fontSize: 14 } },
      { text: it.tip, options: { color: COLOR.text } },
    ], {
      x: x + 0.20, y: yTop + 2.50, w: colW - 0.32, h: h - 2.60,
      fontSize: 13, fontFace: FONT_JA, valign: 'top',
    });
  });
  return slide;
}

// ───────────────────────────────────────────────
// まとめ
// ───────────────────────────────────────────────
function summarySlide(pres, title, points) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.navy };
  slide.addText(title, {
    x: 0.5, y: 0.40, w: SLIDE_W - 1, h: 0.85,
    fontSize: 32, bold: true, color: COLOR.white, fontFace: FONT_TITLE,
  });
  slide.addShape(pres.ShapeType.rect, {
    x: 0.5, y: 1.30, w: 1.5, h: 0.06, fill: { color: COLOR.amber }, line: { type: 'none' },
  });
  const yTop = 1.70;
  const h = 1.15;
  points.forEach((p, i) => {
    const y = yTop + i * (h + 0.22);
    slide.addShape(pres.ShapeType.roundRect, {
      x: 0.5, y, w: SLIDE_W - 1, h, rectRadius: 0.08,
      fill: { color: '2A4A75' }, line: { color: COLOR.teal, width: 0.5 },
    });
    slide.addText(`0${i + 1}`, {
      x: 0.72, y: y + 0.18, w: 0.85, h: 0.85,
      fontSize: 34, bold: true, color: COLOR.amber, fontFace: FONT_TITLE,
    });
    slide.addText(p.head, {
      x: 1.65, y: y + 0.15, w: SLIDE_W - 2.4, h: 0.45,
      fontSize: 18, bold: true, color: COLOR.white, fontFace: FONT_TITLE,
    });
    slide.addText(p.detail, {
      x: 1.65, y: y + 0.62, w: SLIDE_W - 2.4, h: 0.50,
      fontSize: 13, color: 'E6ECF3', fontFace: FONT_JA, valign: 'top',
    });
  });
  return slide;
}

// ───────────────────────────────────────────────
// 講師用 解答スライド
// ───────────────────────────────────────────────
function answerSlide(pres, exTitle, ans) {
  const slide = baseSlide(pres, {
    title: `${exTitle} — 解答・指導ポイント`,
    subtitle: '💬 解答例プロンプト / 📝 想定アウトプット例 / 🧭 回答へ導くポイント',
  });
  const xL = 0.45, w = SLIDE_W - 0.9;
  card(pres, slide, xL, 1.35, w, 1.80, '💬 解答例プロンプト', ans.prompt, COLOR.teal);
  card(pres, slide, xL, 3.25, w, 1.10, '📝 想定アウトプット例', ans.output, COLOR.amber);
  card(pres, slide, xL, 4.45, w, 1.00, '🧭 回答へ導くポイント・注意点', ans.guide, COLOR.navy);
  return slide;
}

module.exports = {
  COLOR, FONT_JA, FONT_TITLE, SLIDE_W, SLIDE_H,
  baseSlide, coverSlide, goalsSlide, termsSlide,
  exerciseSlide, brushSlide, summarySlide, answerSlide,
};
