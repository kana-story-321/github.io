/**
 * mk.js — 全セッション一括生成
 *   node mk.js          → 全セッション
 *   node mk.js 9        → 第9回のみ
 *   node mk.js 9 10 11  → 指定回のみ
 */
const PptxGenJS = require('pptxgenjs');
const fs = require('fs');
const path = require('path');
const wlib = require('./wlib');

// セッションデータマージ
const SESSIONS = {
  9: require('./session9'),
  ...require('./sessions'),
  ...require('./sessions_12_17'),
  ...require('./sessions_18_22'),
};

function newPres() {
  const p = new PptxGenJS();
  p.defineLayout({ name: 'CUSTOM_16_9', width: wlib.SLIDE_W, height: wlib.SLIDE_H });
  p.layout = 'CUSTOM_16_9';
  return p;
}

function buildStudent(workDef, isApplied) {
  const p = newPres();
  wlib.coverSlide(p, workDef.cover.title, workDef.cover.concept);
  wlib.goalsSlide(p, '学習目標', workDef.goals);
  const stepTitle = isApplied ? 'STEP1: 抑えておきたい用語と仕様' : 'STEP1: 用語と前提';
  wlib.termsSlide(p, stepTitle, workDef.terms);
  wlib.exerciseSlide(p, workDef.ex1.title, workDef.ex1);
  wlib.brushSlide(p, workDef.ex1.title + ' — 観点別チェック', workDef.ex1Brush);
  wlib.exerciseSlide(p, workDef.ex2.title, workDef.ex2);
  wlib.brushSlide(p, workDef.ex2.title + ' — 観点別チェック', workDef.ex2Brush);
  wlib.summarySlide(p, '今日の持ち帰り', workDef.summary);
  return p;
}

function buildTeacher(workDef) {
  const p = newPres();
  wlib.coverSlide(p, workDef.cover.title, workDef.cover.concept, 'teacher');
  wlib.answerSlide(p, workDef.ex1.title, workDef.teacher.ex1Answer);
  wlib.answerSlide(p, workDef.ex2.title, workDef.teacher.ex2Answer);
  return p;
}

async function generateSession(n, session) {
  const dir = path.join(__dirname, 'out', `s${String(n).padStart(2, '0')}`);
  fs.mkdirSync(dir, { recursive: true });
  await buildStudent(session.W01, false).writeFile({ fileName: `${dir}/ワーク01.pptx` });
  await buildTeacher(session.W01).writeFile({ fileName: `${dir}/ワーク01_講師用.pptx` });
  await buildStudent(session.W02, true).writeFile({ fileName: `${dir}/ワーク02.pptx` });
  await buildTeacher(session.W02).writeFile({ fileName: `${dir}/ワーク02_講師用.pptx` });
  console.log(`✓ 第${n}回 (4ファイル → ${dir})`);
}

async function main() {
  const args = process.argv.slice(2);
  const targets = args.length > 0
    ? args.map(Number).filter(n => SESSIONS[n])
    : Object.keys(SESSIONS).map(Number).sort((a, b) => a - b);
  console.log(`生成対象: 第${targets.join(', ')}回`);
  for (const n of targets) {
    await generateSession(n, SESSIONS[n]);
  }
  console.log('完了');
}
main();
