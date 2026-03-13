const fetch = require('node-fetch');

const MAX_MSG_LENGTH = 4000;

function getTelegramUrl(method) {
  return `https://api.telegram.org/bot${process.env.BOT_TOKEN}/${method}`;
}

// ─── Send Message ─────────────────────────────────────────────
async function sendMessage(chatId, text) {
  const url = getTelegramUrl('sendMessage');

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'MarkdownV2' })
  });
  const result = await res.json();

  if (!result.ok) {
    console.error('sendMessage MarkdownV2 failed:', JSON.stringify(result));
    // Fallback: plain text
    const plain = text.replace(/[\\*_`[\]()~>#+\-=|{}.!]/g, '');
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: plain })
    });
  }
}

// ─── Send Document ────────────────────────────────────────────
async function sendDocument(chatId, content, filename) {
  const url  = getTelegramUrl('sendDocument');
  const { FormData, Blob } = await import('node-fetch');

  try {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('document', new Blob([content], { type: 'text/plain' }), filename);
    form.append('caption', `📄 ${filename}`);

    await fetch(url, { method: 'POST', body: form });
  } catch (err) {
    console.error('sendDocument error:', err.message);
  }
}

// ─── Markdown → Telegram MarkdownV2 ──────────────────────────
function mdToTelegramMd(text) {
  const codeBlocks = [];
  text = text.replace(/```([\w]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
    const idx = codeBlocks.length;
    codeBlocks.push({ lang: lang || '', code });
    return `\x00CB${idx}\x00`;
  });

  const inlineCodes = [];
  text = text.replace(/`([^`\n]+)`/g, (_, code) => {
    const idx = inlineCodes.length;
    inlineCodes.push(code);
    return `\x00IC${idx}\x00`;
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

  for (let ic = 0; ic < inlineCodes.length; ic++) {
    text = text.replace(`\x00IC${ic}\x00`, '`' + inlineCodes[ic] + '`');
  }
  for (let cb = 0; cb < codeBlocks.length; cb++) {
    text = text.replace(`\x00CB${cb}\x00`,
      '```' + codeBlocks[cb].lang + '\n' + codeBlocks[cb].code + '\n```');
  }

  return text;
}

function escMd(text) {
  return String(text).replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
}

// ─── Smart Split ──────────────────────────────────────────────
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
  const map = {
    python:'py', py:'py', javascript:'js', js:'js', typescript:'ts', ts:'ts',
    bash:'sh', shell:'sh', sh:'sh', html:'html', css:'css', json:'json',
    yaml:'yaml', yml:'yml', sql:'sql', java:'java', cpp:'cpp', c:'c',
    go:'go', rust:'rs', php:'php', ruby:'rb', swift:'swift', kotlin:'kt',
    xml:'xml', powershell:'ps1', ps1:'ps1', vba:'vba', r:'r'
  };
  return map[(lang || '').toLowerCase()] || 'txt';
}

// ─── Send AI Reply ────────────────────────────────────────────
async function sendAiReply(chatId, rawText) {
  const hasCode = /```[\s\S]*?```/.test(rawText);

  if (rawText.length > MAX_MSG_LENGTH && hasCode) {
    await sendAsTextAndFile(chatId, rawText);
  } else if (rawText.length > MAX_MSG_LENGTH) {
    const chunks = smartSplit(rawText, MAX_MSG_LENGTH);
    for (const chunk of chunks) {
      await sendMessage(chatId, mdToTelegramMd(chunk));
    }
  } else {
    await sendMessage(chatId, mdToTelegramMd(rawText));
  }
}

async function sendAsTextAndFile(chatId, rawText) {
  const codeBlockRegex = /```([\w]*)\n?([\s\S]*?)```/g;
  const codeBlocks = [];
  let match;

  while ((match = codeBlockRegex.exec(rawText)) !== null) {
    codeBlocks.push({ lang: match[1] || 'txt', code: match[2] });
  }

  let textOnly = rawText.replace(/```[\w]*\n?[\s\S]*?```/g, '📎 _See attached file_');

  if (textOnly.trim()) {
    const chunks = smartSplit(textOnly, MAX_MSG_LENGTH);
    for (const chunk of chunks) {
      await sendMessage(chatId, mdToTelegramMd(chunk));
    }
  }

  for (let j = 0; j < codeBlocks.length; j++) {
    const ext      = getLangExt(codeBlocks[j].lang);
    const filename = `response_${j + 1}.${ext}`;
    await sendDocument(chatId, codeBlocks[j].code, filename);
  }
}

module.exports = { sendMessage, sendAiReply, escMd, mdToTelegramMd };
