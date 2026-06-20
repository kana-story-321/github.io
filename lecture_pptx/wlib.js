/**
 * wlib.js — ai-lecture-worksheet 共通デザイン部品
 *
 * 規約:
 *   - 16:9 ワイド (10in x 5.625in)
 *   - 配色: 濃紺#1F3A5F / ティール#0E7C86 / 山吹#E8A33D / 白 / 薄グレー#F4F6F9
 *   - 入れない: 回数(第◯回)、企業名、ページ番号、研修名フッター
 */

const COLOR = {
  navy:  '1F3A5F',
  teal:  '0E7C86',
  amber: 'E8A33D',
  plum:  '7C5F8A',   // 補色: くすんだ紫(ターム4色目用)
  rose:  'C76B7A',   // 補色: 落ち着いたローズ(まとめのバッジ用)
  white: 'FFFFFF',
  card:  'F4F6F9',
  text:  '1A1A1A',
  sub:   '555555',
  line:  'D7DCE3',
};

// 4枚並びの定型(用語・ブラッシュアップなど)で使う色ローテーション
const ROTATE = ['teal', 'amber', 'navy', 'plum'];

const FONT_JA = 'Yu Gothic UI';
const FONT_TITLE = 'Yu Gothic UI Semibold';

const SLIDE_W = 10;       // inch
const SLIDE_H = 5.625;
const PAD = 0.35;

// ─────────────────────────────────────────────
// 基本: タイトル付き白背景スライド
// ─────────────────────────────────────────────
function baseSlide(pres, opts = {}) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.white };
  // 左上アクセント帯
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 0, w: 0.18, h: SLIDE_H, fill: { color: COLOR.teal }, line: { type: 'none' },
  });
  if (opts.title) {
    slide.addText(opts.title, {
      x: 0.45, y: 0.25, w: 9.2, h: 0.55,
      fontSize: 22, bold: true, color: COLOR.navy, fontFace: FONT_TITLE,
    });
  }
  if (opts.subtitle) {
    slide.addText(opts.subtitle, {
      x: 0.45, y: 0.80, w: 9.2, h: 0.35,
      fontSize: 13, color: COLOR.sub, fontFace: FONT_JA, italic: true,
    });
  }
  return slide;
}

// ─────────────────────────────────────────────
// 表紙: 濃紺ベタ
// ─────────────────────────────────────────────
function coverSlide(pres, title, concept, kind = 'normal') {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.navy };
  // ティールの上線
  slide.addShape(pres.ShapeType.rect, {
    x: 0, y: 2.4, w: SLIDE_W, h: 0.05, fill: { color: COLOR.teal }, line: { type: 'none' },
  });
  // タイトル
  slide.addText(title, {
    x: 0.6, y: 1.5, w: SLIDE_W - 1.2, h: 0.9,
    fontSize: 34, bold: true, color: COLOR.white, fontFace: FONT_TITLE,
    align: 'left',
  });
  // 一言コンセプト
  slide.addText(concept, {
    x: 0.6, y: 2.55, w: SLIDE_W - 1.2, h: 0.6,
    fontSize: 16, color: COLOR.amber, fontFace: FONT_JA, align: 'left',
  });
  if (kind === 'teacher') {
    slide.addText('【講師用 解答・指導ポイント】', {
      x: 0.6, y: 4.5, w: SLIDE_W - 1.2, h: 0.4,
      fontSize: 14, color: COLOR.amber, fontFace: FONT_JA, bold: true,
    });
  }
  return slide;
}

// ─────────────────────────────────────────────
// 学習目標: 3つを横並び
// ─────────────────────────────────────────────
function goalsSlide(pres, title, goals) {
  const slide = baseSlide(pres, { title });
  const yTop = 1.45;
  const h = 2.50;
  const colW = (SLIDE_W - 0.45 * 2 - 0.4) / 3;
  const accents = ['teal', 'amber', 'navy'];
  goals.forEach((g, i) => {
    const x = 0.45 + i * (colW + 0.2);
    const accent = COLOR[accents[i % accents.length]];
    // カード
    slide.addShape(pres.ShapeType.roundRect, {
      x, y: yTop, w: colW, h, rectRadius: 0.10,
      fill: { color: COLOR.card }, line: { color: accent, width: 1.5 },
    });
    // 上端アクセント
    slide.addShape(pres.ShapeType.rect, {
      x: x + 0.10, y: yTop, w: colW - 0.20, h: 0.06,
      fill: { color: accent }, line: { type: 'none' },
    });
    // 番号バッジ(色も回す)
    slide.addText(`0${i + 1}`, {
      x: x + 0.2, y: yTop + 0.15, w: 0.85, h: 0.55,
      fontSize: 24, bold: true, color: accent, fontFace: FONT_TITLE,
    });
    // 見出し
    slide.addText(g.title, {
      x: x + 0.2, y: yTop + 0.72, w: colW - 0.4, h: 0.55,
      fontSize: 14, bold: true, color: COLOR.navy, fontFace: FONT_TITLE,
      valign: 'top',
    });
    // 詳細
    slide.addText(g.detail, {
      x: x + 0.2, y: yTop + 1.30, w: colW - 0.4, h: h - 1.40,
      fontSize: 11, color: COLOR.text, fontFace: FONT_JA, valign: 'top',
    });
  });
  return slide;
}

// ─────────────────────────────────────────────
// 用語・前提カード（4つ）— 色を 4色ローテーションし、カード高さを内容に最適化
// ─────────────────────────────────────────────
function termsSlide(pres, title, terms) {
  const slide = baseSlide(pres, { title });   // サブタイトル削除（重複回避）
  const yTop = 1.20;
  const totalW = SLIDE_W - 0.40 * 2;
  const colW = (totalW - 0.18 * 3) / 4;
  const cardH = 2.30;                          // 3.4→2.3 で空白を圧縮
  const noteY = yTop + cardH + 0.55;           // 用語注 を カード直下に
  terms.forEach((t, i) => {
    const x = 0.40 + i * (colW + 0.18);
    const accent = COLOR[ROTATE[i % ROTATE.length]];
    // 本体カード(白)
    slide.addShape(pres.ShapeType.roundRect, {
      x, y: yTop, w: colW, h: cardH, rectRadius: 0.10,
      fill: { color: COLOR.white }, line: { color: accent, width: 1.5 },
    });
    // ヘッダー帯
    slide.addShape(pres.ShapeType.roundRect, {
      x, y: yTop, w: colW, h: 0.55, rectRadius: 0.10,
      fill: { color: accent }, line: { type: 'none' },
    });
    // 帯の下端をフラットに(角丸で上にだけ来るよう、下側を白角丸で隠す)
    slide.addShape(pres.ShapeType.rect, {
      x, y: yTop + 0.20, w: colW, h: 0.35,
      fill: { color: accent }, line: { type: 'none' },
    });
    slide.addText(t.term, {
      x: x + 0.14, y: yTop + 0.08, w: colW - 0.28, h: 0.45,
      fontSize: 13, bold: true, color: COLOR.white, fontFace: FONT_TITLE,
      valign: 'middle',
    });
    slide.addText(t.desc, {
      x: x + 0.18, y: yTop + 0.68, w: colW - 0.36, h: cardH - 0.78,
      fontSize: 11, color: COLOR.text, fontFace: FONT_JA, valign: 'top',
      paraSpaceAfter: 2,
    });
  });
  // 用語注(※)
  if (terms.some(t => t.note)) {
    // 各 note を 1行ずつ並べる(横並びだと窮屈)
    const noteLines = terms
      .filter(t => t.note)
      .map(t => ({
        text: '※ ',
        options: { color: COLOR.amber, bold: true },
      })).flatMap((bullet, idx) => [
        bullet,
        { text: terms.filter(t => t.note)[idx].term + ': ',
          options: { color: COLOR.navy, bold: true } },
        { text: terms.filter(t => t.note)[idx].note + '   ',
          options: { color: COLOR.sub } },
      ]);
    slide.addText(noteLines, {
      x: 0.40, y: noteY, w: SLIDE_W - 0.80, h: 1.30,
      fontSize: 9.5, fontFace: FONT_JA, italic: false, valign: 'top',
    });
  }
  return slide;
}

// ─────────────────────────────────────────────
// 演習スライド（📍状況／🎯作るもの／💭ヒント）
// ─────────────────────────────────────────────
function exerciseSlide(pres, title, ex) {
  const slide = baseSlide(pres, { title });
  const xL = 0.45, xR = 5.1, w = 4.55;
  // 左上: シチュエーション
  card(pres, slide, xL, 1.05, w, 1.95, '📍 シチュエーション', ex.situation, COLOR.navy);
  // 左下: ヒント
  card(pres, slide, xL, 3.10, w, 2.20, '💭 プロンプトのヒント', ex.hint, COLOR.amber);
  // 右: 🎯 作るもの (大きめ)
  card(pres, slide, xR, 1.05, w, 4.25, '🎯 AIに作ってもらいたいもの', ex.target, COLOR.teal);
  return slide;
}

// 共通カード
function card(pres, slide, x, y, w, h, head, body, accent) {
  slide.addShape(pres.ShapeType.roundRect, {
    x, y, w, h, rectRadius: 0.08,
    fill: { color: COLOR.card }, line: { color: COLOR.line, width: 0.5 },
  });
  slide.addShape(pres.ShapeType.rect, {
    x, y, w: 0.08, h, fill: { color: accent }, line: { type: 'none' },
  });
  slide.addText(head, {
    x: x + 0.18, y: y + 0.1, w: w - 0.3, h: 0.35,
    fontSize: 13, bold: true, color: accent, fontFace: FONT_TITLE,
  });
  // body は文字列または配列
  const bodyOpts = {
    x: x + 0.22, y: y + 0.5, w: w - 0.42, h: h - 0.6,
    fontSize: 11.5, color: COLOR.text, fontFace: FONT_JA, valign: 'top',
    paraSpaceAfter: 4,
  };
  if (Array.isArray(body)) {
    slide.addText(body.map(t => ({ text: t, options: { bullet: { code: '25CF' } } })), bodyOpts);
  } else {
    slide.addText(body, bodyOpts);
  }
}

// ─────────────────────────────────────────────
// ブラッシュアップ: A/B/C の3観点 (✓ + 💡)
// ─────────────────────────────────────────────
function brushSlide(pres, title, items) {
  const slide = baseSlide(pres, { title, subtitle: 'プロンプトをさらにブラッシュアップ — 3観点でセルフチェック' });
  const yTop = 1.30;
  const totalW = SLIDE_W - 0.45 * 2;
  const colW = (totalW - 0.2 * 2) / 3;
  const h = 3.60;     // 余白を圧縮(3.85→3.60)
  const accents = ['teal', 'amber', 'plum'];
  items.forEach((it, i) => {
    const x = 0.45 + i * (colW + 0.2);
    const accent = COLOR[accents[i % accents.length]];
    slide.addShape(pres.ShapeType.roundRect, {
      x, y: yTop, w: colW, h, rectRadius: 0.10,
      fill: { color: COLOR.card }, line: { color: accent, width: 1.2 },
    });
    // ラベル(色を観点別に変える)
    slide.addShape(pres.ShapeType.rect, {
      x, y: yTop, w: colW, h: 0.42, fill: { color: accent }, line: { type: 'none' },
    });
    slide.addText(`観点 ${String.fromCharCode(65 + i)}`, {
      x: x + 0.12, y: yTop + 0.04, w: colW - 0.24, h: 0.34,
      fontSize: 12, bold: true, color: COLOR.white, fontFace: FONT_TITLE,
    });
    slide.addText(it.title, {
      x: x + 0.18, y: yTop + 0.50, w: colW - 0.3, h: 0.50,
      fontSize: 12, bold: true, color: COLOR.navy, fontFace: FONT_TITLE, valign: 'top',
    });
    // ✓ チェック(緑)
    slide.addText([
      { text: '✓  ', options: { color: COLOR.teal, bold: true, fontSize: 12 } },
      { text: it.check, options: { color: COLOR.text } },
    ], {
      x: x + 0.18, y: yTop + 1.05, w: colW - 0.3, h: 1.15,
      fontSize: 10.5, fontFace: FONT_JA, valign: 'top',
    });
    // 💡 AI へのヒント(黄)
    slide.addText([
      { text: '💡  ', options: { color: COLOR.amber, bold: true, fontSize: 12 } },
      { text: it.tip, options: { color: COLOR.text } },
    ], {
      x: x + 0.18, y: yTop + 2.20, w: colW - 0.3, h: h - 2.30,
      fontSize: 10.5, fontFace: FONT_JA, valign: 'top',
    });
  });
  return slide;
}

// ─────────────────────────────────────────────
// まとめ: 濃紺背景 + 3 つのキーメッセージ
// ─────────────────────────────────────────────
function summarySlide(pres, title, points) {
  const slide = pres.addSlide();
  slide.background = { color: COLOR.navy };
  slide.addText(title, {
    x: 0.5, y: 0.4, w: SLIDE_W - 1, h: 0.7,
    fontSize: 28, bold: true, color: COLOR.white, fontFace: FONT_TITLE,
  });
  slide.addShape(pres.ShapeType.rect, {
    x: 0.5, y: 1.15, w: 1.5, h: 0.05, fill: { color: COLOR.amber }, line: { type: 'none' },
  });
  const yTop = 1.6;
  const h = 1.05;
  points.forEach((p, i) => {
    const y = yTop + i * (h + 0.2);
    slide.addShape(pres.ShapeType.roundRect, {
      x: 0.5, y, w: SLIDE_W - 1, h, rectRadius: 0.06,
      fill: { color: '2A4A75' }, line: { color: COLOR.teal, width: 0.5 },
    });
    slide.addText(`0${i + 1}`, {
      x: 0.7, y: y + 0.18, w: 0.7, h: 0.7,
      fontSize: 28, bold: true, color: COLOR.amber, fontFace: FONT_TITLE,
    });
    slide.addText(p.head, {
      x: 1.5, y: y + 0.15, w: SLIDE_W - 2.2, h: 0.4,
      fontSize: 15, bold: true, color: COLOR.white, fontFace: FONT_TITLE,
    });
    slide.addText(p.detail, {
      x: 1.5, y: y + 0.55, w: SLIDE_W - 2.2, h: 0.45,
      fontSize: 11, color: '#E6ECF3', fontFace: FONT_JA, valign: 'top',
    });
  });
  return slide;
}

// ─────────────────────────────────────────────
// 講師用 解答スライド
//   演習タイトル + 💬解答例プロンプト / 📝想定アウトプット / 🧭導くポイント
// ─────────────────────────────────────────────
function answerSlide(pres, exTitle, ans) {
  const slide = baseSlide(pres, {
    title: `${exTitle} — 解答・指導ポイント`,
    subtitle: '💬 解答例プロンプト / 📝 想定アウトプット例 / 🧭 回答へ導くポイント',
  });
  const xL = 0.45, w = SLIDE_W - 0.9;
  // 💬 解答例プロンプト
  card(pres, slide, xL, 1.20, w, 1.65, '💬 解答例プロンプト', ans.prompt, COLOR.teal);
  // 📝 想定アウトプット
  card(pres, slide, xL, 2.95, w, 1.20, '📝 想定アウトプット例', ans.output, COLOR.amber);
  // 🧭 導くポイント
  card(pres, slide, xL, 4.25, w, 1.10, '🧭 回答へ導くポイント・注意点', ans.guide, COLOR.navy);
  return slide;
}

// ─────────────────────────────────────────────
// 公開
// ─────────────────────────────────────────────
module.exports = {
  COLOR, FONT_JA, FONT_TITLE, SLIDE_W, SLIDE_H,
  baseSlide, coverSlide, goalsSlide, termsSlide,
  exerciseSlide, brushSlide, summarySlide, answerSlide,
};
