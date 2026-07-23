/**
 * 議事録自動生成ツール (GAS + Gemini + Google Docs)
 *
 * 使い方:
 *   1. スプシ「MTG記録」シートに 会議名・日時・参加者・文字起こし本文 を入力
 *   2. メニュー「議事録AI」→「▶ 議事録生成」
 *   3. 30秒後、Google Docs で議事録が生成される (Drive「議事録アーカイブ」フォルダに保存)
 *   4. Docs を確認 → 修正 → 承認 → 「📧 参加者にメール送信」で配布
 *
 * 事前準備:
 *   スクリプトプロパティに GEMINI_API_KEY を設定
 *   (取得: https://aistudio.google.com/apikey)
 */

const MTG_SHEET   = 'MTG記録';
const ARCHIVE_FOLDER_NAME = '議事録アーカイブ';
const MODEL       = 'gemini-2.5-flash';

// ═══════════════════════════════════════════════════════════
// メニュー
// ═══════════════════════════════════════════════════════════
function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('議事録AI')
    .addItem('▶ 議事録生成', 'generateMinutes')
    .addItem('📧 参加者にメール送信 (承認後)', 'sendMinutesEmail')
    .addSeparator()
    .addItem('セットアップ確認 (ログ)', 'testSetup')
    .addToUi();
}

// ═══════════════════════════════════════════════════════════
// メイン: 議事録生成
// ═══════════════════════════════════════════════════════════
function generateMinutes() {
  const ui = SpreadsheetApp.getUi();
  try {
    const meta = readMeta_();
    if (!meta.transcript || meta.transcript.length < 100) {
      throw new Error('文字起こし本文が短すぎます (100文字以上必要)。MTG記録シートの本文欄に貼付されているか確認してください。');
    }

    ui.alert('議事録生成 開始',
      `会議: ${meta.meeting_name}\n日時: ${meta.date}\n参加者: ${meta.attendees.join(', ')}\n\nGemini に問い合わせます。30秒ほどお待ちください...`,
      ui.ButtonSet.OK);

    const prompt = buildPrompt_(meta);
    const result = callGemini_(prompt);

    const docUrl = writeToDoc_(meta, result);

    // 最新の議事録URLをスプシに保存 (メール送信用)
    PropertiesService.getDocumentProperties()
      .setProperty('LAST_MINUTES_URL', docUrl)
      .setProperty('LAST_MINUTES_META', JSON.stringify(meta));

    ui.alert('議事録生成 完了',
      `Google Docs に議事録を作成しました。\n\n${docUrl}\n\n` +
      `内容を確認・修正してから、メニュー「📧 参加者にメール送信」でメール配布できます。`,
      ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('エラー', e.message, ui.ButtonSet.OK);
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════
// スプシから会議メタ情報 + 文字起こしを読み込む
// ═══════════════════════════════════════════════════════════
function readMeta_() {
  const sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(MTG_SHEET);
  if (!sh) throw new Error(`シート「${MTG_SHEET}」が見つかりません`);

  const data = sh.getDataRange().getValues();

  // メタ情報 (項目名を探して値を取る)
  const findVal = (label) => {
    for (const r of data) {
      if (String(r[0] || '').trim() === label) return String(r[1] || '').trim();
    }
    return '';
  };

  const meeting_name = findVal('会議名') || '会議';
  const date = findVal('日時') || new Date().toLocaleString('ja-JP');
  const attendeesRaw = findVal('参加者') || '';
  const attendees = attendeesRaw.split(/[,、,]/).map(s => s.trim()).filter(Boolean);
  const author = findVal('議事録作成者') || Session.getActiveUser().getEmail();

  // 文字起こし本文: 「文字起こし本文」ラベル以降のセルを結合
  let transcript = '';
  let inTranscript = false;
  for (const r of data) {
    const label = String(r[0] || '');
    if (label.includes('文字起こし本文')) { inTranscript = true; continue; }
    if (inTranscript) {
      for (const cell of r) {
        const s = String(cell || '').trim();
        if (s && !s.startsWith('(ここに')) transcript += s + '\n';
      }
    }
  }
  transcript = transcript.trim();

  return { meeting_name, date, attendees, author, transcript };
}

// ═══════════════════════════════════════════════════════════
// プロンプト構築
// ═══════════════════════════════════════════════════════════
function buildPrompt_(meta) {
  return `あなたは "議事録作成アシスタント" です。以下の会議の文字起こしから、議事録を JSON で作成してください。

【会議情報】
- 会議名: ${meta.meeting_name}
- 日時: ${meta.date}
- 参加者: ${meta.attendees.join(', ')}

【文字起こし本文】
${meta.transcript}

【出力の JSON 構造】
- agenda: 議題の配列 (文字列)
- decisions: 決定事項の配列。各要素は { topic, decision, reason }
    - topic: 何について
    - decision: どう決まったか
    - reason: 決定の理由・根拠 (文字起こしで話された内容)
- todos: ToDo の配列。各要素は { who, what, due }
    - who: 担当者名 (参加者リストから)
    - what: やること
    - due: 期限 (YYYY-MM-DD または "月末まで" などの相対表現)
- pending: 保留事項の配列。各要素は { topic, next_action }
- next_meeting: 次回予定 { date, topics }

【重要】
- 文字起こしに書かれていない情報を "推測で追加しない" こと (誤情報防止)
- ToDo は "誰が" が明確なもののみ抽出。曖昧なものは pending に入れる
- 期限が話されていない ToDo は due="期限未定" で返す
- decisions の reason は 文字起こしの発言を要約 (捏造しない)
- 空の配列 (該当なし) は [] で返す`;
}

// ═══════════════════════════════════════════════════════════
// Gemini API 呼び出し
// ═══════════════════════════════════════════════════════════
function callGemini_(prompt) {
  const apiKey = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!apiKey) throw new Error('スクリプトプロパティ GEMINI_API_KEY が未設定です');

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object',
        properties: {
          agenda: { type: 'array', items: { type: 'string' } },
          decisions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                topic:    { type: 'string' },
                decision: { type: 'string' },
                reason:   { type: 'string' },
              },
              required: ['topic', 'decision', 'reason'],
            },
          },
          todos: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                who:  { type: 'string' },
                what: { type: 'string' },
                due:  { type: 'string' },
              },
              required: ['who', 'what', 'due'],
            },
          },
          pending: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                topic:       { type: 'string' },
                next_action: { type: 'string' },
              },
              required: ['topic', 'next_action'],
            },
          },
          next_meeting: {
            type: 'object',
            properties: {
              date:   { type: 'string' },
              topics: { type: 'array', items: { type: 'string' } },
            },
            required: ['date', 'topics'],
          },
        },
        required: ['agenda', 'decisions', 'todos', 'pending', 'next_meeting'],
      },
    },
  };

  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true,
  });

  const code = res.getResponseCode();
  const body = res.getContentText();
  if (code !== 200) throw new Error(`Gemini API エラー (${code}): ${body.substring(0, 400)}`);

  const json = JSON.parse(body);
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini 応答が空です');
  return JSON.parse(text);
}

// ═══════════════════════════════════════════════════════════
// Google Docs に議事録を書き出し
// ═══════════════════════════════════════════════════════════
function writeToDoc_(meta, result) {
  const docTitle = `議事録_${meta.meeting_name}_${sanitizeDate_(meta.date)}`;
  const doc = DocumentApp.create(docTitle);
  const body = doc.getBody();
  body.clear();

  body.setMarginTop(50).setMarginBottom(50).setMarginLeft(50).setMarginRight(50);

  // タイトル
  body.appendParagraph(`【議事録】${meta.meeting_name}`)
    .setHeading(DocumentApp.ParagraphHeading.TITLE);

  // メタ情報
  const metaTable = body.appendTable([
    ['日時', meta.date],
    ['参加者', meta.attendees.join(', ')],
    ['作成者', meta.author],
  ]);
  for (let r = 0; r < metaTable.getNumRows(); r++) {
    const label = metaTable.getRow(r).getCell(0);
    label.setBackgroundColor('#0E7C86').setWidth(80);
    label.editAsText().setForegroundColor('#FFFFFF').setBold(true).setFontSize(10);
    metaTable.getRow(r).getCell(1).editAsText().setFontSize(11);
  }

  // 議題
  if (result.agenda && result.agenda.length) {
    body.appendParagraph('').setSpacingAfter(10);
    body.appendParagraph('■ 議題').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    result.agenda.forEach((a, i) => {
      body.appendListItem(`${a}`).setGlyphType(DocumentApp.GlyphType.NUMBER);
    });
  }

  // 決定事項
  if (result.decisions && result.decisions.length) {
    body.appendParagraph('').setSpacingAfter(10);
    body.appendParagraph('■ 決定事項').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    result.decisions.forEach((d, i) => {
      const p = body.appendParagraph(`${i + 1}. ${d.topic}`);
      p.editAsText().setBold(true).setForegroundColor('#1F3A5F');
      body.appendParagraph(`   決定: ${d.decision}`).editAsText().setFontSize(11);
      body.appendParagraph(`   理由: ${d.reason}`).editAsText().setFontSize(10).setForegroundColor('#555555').setItalic(true);
    });
  }

  // ToDo
  if (result.todos && result.todos.length) {
    body.appendParagraph('').setSpacingAfter(10);
    body.appendParagraph('■ ToDo').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    const todoData = [['担当', 'やること', '期限']].concat(
      result.todos.map(t => [t.who || '未定', t.what || '', t.due || '期限未定'])
    );
    const t = body.appendTable(todoData);
    // ヘッダー
    const th = t.getRow(0);
    for (let i = 0; i < th.getNumCells(); i++) {
      th.getCell(i).setBackgroundColor('#E8A33D');
      th.getCell(i).editAsText().setForegroundColor('#FFFFFF').setBold(true).setFontSize(10);
    }
    // データ
    for (let r = 1; r < t.getNumRows(); r++) {
      for (let c = 0; c < t.getRow(r).getNumCells(); c++) {
        t.getRow(r).getCell(c).editAsText().setFontSize(11);
      }
    }
  }

  // 保留事項
  if (result.pending && result.pending.length) {
    body.appendParagraph('').setSpacingAfter(10);
    body.appendParagraph('■ 保留事項').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    result.pending.forEach(p => {
      body.appendListItem(`${p.topic} → ${p.next_action}`);
    });
  }

  // 次回予定
  if (result.next_meeting && (result.next_meeting.date || (result.next_meeting.topics && result.next_meeting.topics.length))) {
    body.appendParagraph('').setSpacingAfter(10);
    body.appendParagraph('■ 次回予定').setHeading(DocumentApp.ParagraphHeading.HEADING1);
    if (result.next_meeting.date) {
      body.appendParagraph(`日時: ${result.next_meeting.date}`);
    }
    if (result.next_meeting.topics && result.next_meeting.topics.length) {
      body.appendParagraph('議題:');
      result.next_meeting.topics.forEach(t => body.appendListItem(t));
    }
  }

  // フッター
  body.appendParagraph('').setSpacingAfter(20);
  const footer = body.appendParagraph(
    `\n─────────\n議事録作成: AI草案 → ${meta.author} 承認 / 作成日: ${Utilities.formatDate(new Date(), 'JST', 'yyyy-MM-dd HH:mm')}`
  );
  footer.editAsText().setFontSize(9).setForegroundColor('#999999');

  doc.saveAndClose();

  // フォルダに移動
  const folder = getOrCreateFolder_(ARCHIVE_FOLDER_NAME);
  const docFile = DriveApp.getFileById(doc.getId());
  docFile.moveTo(folder);

  return doc.getUrl();
}

// ═══════════════════════════════════════════════════════════
// 参加者にメール送信 (承認後)
// ═══════════════════════════════════════════════════════════
function sendMinutesEmail() {
  const ui = SpreadsheetApp.getUi();
  const url = PropertiesService.getDocumentProperties().getProperty('LAST_MINUTES_URL');
  const metaJson = PropertiesService.getDocumentProperties().getProperty('LAST_MINUTES_META');
  if (!url || !metaJson) {
    ui.alert('先に「▶ 議事録生成」で議事録を作成してください');
    return;
  }
  const meta = JSON.parse(metaJson);

  const emailPrompt = ui.prompt(
    '参加者のメールアドレスを入力',
    `${meta.attendees.join(', ')} のメールアドレスを カンマ区切りで入力してください\n(例: tanaka@example.com, sato@example.com)`,
    ui.ButtonSet.OK_CANCEL);
  if (emailPrompt.getSelectedButton() !== ui.Button.OK) return;

  const emails = emailPrompt.getResponseText().split(/[,、]/).map(s => s.trim()).filter(Boolean);
  if (emails.length === 0) { ui.alert('メールアドレスが入力されていません'); return; }

  const subject = `【議事録】${meta.meeting_name} (${meta.date})`;
  const bodyText =
    `お疲れさまです。\n\n` +
    `${meta.date} の「${meta.meeting_name}」の議事録を共有します。\n` +
    `内容確認・修正のうえ、この後の対応にご活用ください。\n\n` +
    `▼ 議事録 (Google Docs)\n${url}\n\n` +
    `参加者: ${meta.attendees.join(', ')}\n` +
    `作成: ${meta.author}\n`;

  emails.forEach(to => GmailApp.sendEmail(to, subject, bodyText));
  ui.alert(`${emails.length} 名にメール送信しました`);
}

// ═══════════════════════════════════════════════════════════
// ヘルパー
// ═══════════════════════════════════════════════════════════
function sanitizeDate_(s) {
  return String(s).replace(/[\/\s():：]/g, '-').replace(/[月火水木金土日]/g, '').replace(/-+/g, '-').substring(0, 20);
}

function getOrCreateFolder_(name) {
  const folders = DriveApp.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return DriveApp.createFolder(name);
}

// ═══════════════════════════════════════════════════════════
// 診断
// ═══════════════════════════════════════════════════════════
function testSetup() {
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  Logger.log('GEMINI_API_KEY: ' + (key ? key.substring(0, 8) + '...(OK)' : '❌ 未設定'));
  try {
    const m = readMeta_();
    Logger.log('会議名: ' + m.meeting_name);
    Logger.log('日時: ' + m.date);
    Logger.log('参加者: ' + m.attendees.join(', '));
    Logger.log('文字起こし文字数: ' + m.transcript.length);
    Logger.log('文字起こし冒頭: ' + m.transcript.substring(0, 200));
  } catch (e) {
    Logger.log('エラー: ' + e.message);
  }
}
