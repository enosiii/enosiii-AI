const fetch    = require('node-fetch');
const FormData = require('form-data');

const MAX_MSG_LENGTH = 4000;

function getTelegramUrl(method) {
  return `https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`;
}

async function sendMessage(chatId, text, keyboard = null) {
  const url  = getTelegramUrl('sendMessage');
  const body = { chat_id: chatId, text, parse_mode: 'MarkdownV2' };
  if (keyboard) body.reply_markup = { inline_keyboard: keyboard };

  const res    = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const result = await res.json();

  if (!result.ok) {
    console.error('sendMessage failed:', JSON.stringify(result));
    const plain = text.replace(/[\\*_`[\]()~>#+\-=|{}.!]/g, '');
    const body2 = { chat_id: chatId, text: plain };
    if (keyboard) body2.reply_markup = { inline_keyboard: keyboard };
    await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body2) });
  }
}

async function answerCallback(callbackQueryId, text = '') {
  await fetch(getTelegramUrl('answerCallbackQuery'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, text })
  });
}

async function sendDocument(chatId, content, filename) {
  const url = getTelegramUrl('sendDocument');
  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('document', Buffer.from(content, 'utf-8'), { filename, contentType: 'text/plain' });
    form.append('caption', `📄 ${filename}`);
    const res    = await fetch(url, { method: 'POST', body: form, headers: form.getHeaders() });
    const result = await res.json();
    if (!result.ok) console.error('sendDocument failed:', JSON.stringify(result));
  } catch (err) {
    console.error('sendDocument error:', err.message);
  }
}

function mdToTelegramMd(text) {
  const codeBlocks = [];
  text = text.replace(/```([\w]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push({ lang: lang || '', code });
    return `\x00CB${codeBlocks.length - 1}\x00`;
  });
  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    inlineCodes.push(code);
    return `\x00IC${inlineCodes.length - 1}\x00`;
  });
  text = text.replace(/^#{1,6}\s+(.+)$/gm, (_, t) => `*${t.replace(/\*/g, '')}*`);
  text = text.replace(/\*\*(.+?)\*\*/g, (_, t) => `\x01BOLD\x01${t}\x01BOLD\x01`);
  text = text.replace(/__(.+?)__/g,     (_, t) => `\x01BOLD\x01${t}\x01BOLD\x01`);
  text = text.replace(/(?<![_\w])_([^_\n]+)_(?![_\w])/g, (_, t) => `\x01ITAL\x01${t}\x01ITAL\x01`);
  text = text.replace(/~~(.+?)~~/g,     (_, t) => `\x01STRK\x01${t}\x01STRK\x01`);
  text = text.replace(/^[*\-]\s+/gm, '• ');
  text = text.replace(/[_*[\]()~`>#+\-=|{}.!\\]/g, ch => '\\' + ch);
  text = text.replace(/\x01BOLD\x01/g, '*');
  text = text.replace(/\x01ITAL\x01/g, '_');
  text = text.replace(/\x01STRK\x01/g, '~');
  for (let i = 0; i < inlineCodes.length; i++) text = text.replace(`\x00IC${i}\x00`, '`' + inlineCodes[i] + '`');
  for (let i = 0; i < codeBlocks.length; i++) text = text.replace(`\x00CB${i}\x00`, '```' + codeBlocks[i].lang + '\n' + codeBlocks[i].code + '\n```');
  return text;
}

function escMd(text) {
  return String(text).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

function smartSplit(text, maxLen) {
  if (text.length <= maxLen) return [text];
  const chunks = [];
  let remaining = text;
  while (remaining.length > maxLen) {
    let splitAt = remaining.lastIndexOf('\n\n', maxLen);
    if (splitAt < 1) splitAt = remaining.lastIndexOf('\n', maxLen);
    if (splitAt < 1) splitAt = remaining.lastIndexOf('. ', maxLen);
    if (splitAt < 1) splitAt = maxLen;
    chunks.push(remaining.substring(0, splitAt).trim());
    remaining = remaining.substring(splitAt).trim();
  }
  if (remaining.length > 0) chunks.push(remaining);
  return chunks;
}

function getLangExt(lang) {
  const map = { python:'py', py:'py', javascript:'js', js:'js', typescript:'ts', ts:'ts', bash:'sh', shell:'sh', sh:'sh', html:'html', css:'css', json:'json', yaml:'yaml', yml:'yml', sql:'sql', java:'java', cpp:'cpp', c:'c', go:'go', rust:'rs', php:'php', ruby:'rb', swift:'swift', kotlin:'kt', xml:'xml', powershell:'ps1', ps1:'ps1', vba:'vba', r:'r' };
  return map[(lang || '').toLowerCase()] || 'txt';
}

async function sendAiReply(chatId, rawText) {
  const hasCode = /```[\s\S]*?```/.test(rawText);
  if (rawText.length > MAX_MSG_LENGTH && hasCode) {
    await sendAsTextAndFile(chatId, rawText);
  } else if (rawText.length > MAX_MSG_LENGTH) {
    for (const chunk of smartSplit(rawText, MAX_MSG_LENGTH)) await sendMessage(chatId, mdToTelegramMd(chunk));
  } else {
    await sendMessage(chatId, mdToTelegramMd(rawText));
  }
}

async function sendAsTextAndFile(chatId, rawText) {
  const codeBlocks = [];
  let match;
  const re = /```([\w]*)\n?([\s\S]*?)```/g;
  while ((match = re.exec(rawText)) !== null) codeBlocks.push({ lang: match[1] || 'txt', code: match[2] });
  let textOnly = rawText.replace(/```[\w]*\n?[\s\S]*?```/g, '📎 _See attached file_');
  if (textOnly.trim()) for (const chunk of smartSplit(textOnly, MAX_MSG_LENGTH)) await sendMessage(chatId, mdToTelegramMd(chunk));
  for (let j = 0; j < codeBlocks.length; j++) await sendDocument(chatId, codeBlocks[j].code, `response_${j + 1}.${getLangExt(codeBlocks[j].lang)}`);
}

module.exports = { sendMessage, sendDocument, sendAiReply, escMd, mdToTelegramMd, answerCallback };