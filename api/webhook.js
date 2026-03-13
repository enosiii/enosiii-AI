const db            = require('../lib/db');
const { sendMessage, sendAiReply, escMd, answerCallback, editMessage } = require('../lib/telegram');
const { callOpenRouter } = require('../lib/openrouter');
const PERSONALITIES = require('../lib/personalities');

const MAX_HISTORY = 20;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'Enosiii AI is running' });
  }
  try {
    const update = req.body;
    if (!update) return res.status(200).json({ status: 'ok' });
    if (update.callback_query) {
      await handleCallback(update.callback_query);
    } else if (update.message) {
      await handleUpdate(update);
    }
  } catch (err) {
    console.error('Handler error:', err.message);
  }
  return res.status(200).json({ status: 'ok' });
};

async function handleUpdate(update) {
  const msg    = update.message;
  const chatId = String(msg.chat.id);
  const text   = (msg.text || '').trim();
  if (!text) return;

  const { userData, config } = await db.getContext(chatId);

  if (!userData) { await handleAuth(chatId, text); return; }

  if (text === '/cancel') {
    await db.setUserField(chatId, 'pending_action', null);
    await sendMessage(chatId, '\u274C Action cancelled\\.');
    return;
  }

  const pending = userData.pending_action;
  if (pending === 'add_model') { await doAddModel(chatId, text, config); return; }
  if (pending === 'add_api')   { await doAddApi(chatId, text, config); return; }

  if (text.charAt(0) === '/') { await handleCommand(chatId, text, config, userData); return; }

  await handleChat(chatId, text, config, userData);
}

async function handleCallback(cb) {
  const chatId    = String(cb.message.chat.id);
  const msgId     = cb.message.message_id;
  const data      = cb.data;
  await answerCallback(cb.id);

  const { userData, config } = await db.getContext(chatId);
  if (!userData) return;

  // Helper: edit the original menu message with result, no keyboard
  const done = (text) => editMessage(chatId, msgId, text);

  // ── Personality ──────────────────────────────────────────────
  if (data === 'personality_cancel') {
    await done('\u274C Action cancelled\\.');
    return;
  }
  if (data.startsWith('setpersonality:')) {
    const key = data.split(':')[1];
    if (key === 'none') {
      await db.setUserField(chatId, 'personality', null);
      await done('\u2705 Personality removed\\. Bot is now in neutral mode\\.');
    } else if (PERSONALITIES[key]) {
      await db.setUserField(chatId, 'personality', key);
      await db.clearHistory(chatId);
      await done('\u2705 Personality set to: *' + escMd(PERSONALITIES[key].name) + '*\n\n_History cleared for fresh context\\._');
    }
    return;
  }

  // ── Models ───────────────────────────────────────────────────
  if (data === 'model_add') {
    await db.setUserField(chatId, 'pending_action', 'add_model');
    await done('\u270F\uFE0F *Add Model*\n\nSend the model ID:\n_e\\.g\\. `meta\\-llama/llama\\-3\\.1\\-8b\\-instruct:free`_\n\nOr /cancel to abort\\.');
    return;
  }
  if (data === 'model_cancel') {
    await db.setUserField(chatId, 'pending_action', null);
    await done('\u274C Action cancelled\\.');
    return;
  }
  if (data.startsWith('setmodel_idx:')) {
    const idx    = parseInt(data.split(':')[1]);
    const models = JSON.parse(config.MODELS || '[]');
    const model  = models[idx];
    if (!model) { await done('\u274C Model not found\\.'); return; }
    await db.setConfig('ACTIVE_MODEL', model);
    await done('\u2705 Active model set to:\n`' + escMd(model) + '`');
    return;
  }
  if (data === 'model_remove_menu') {
    const models    = JSON.parse(config.MODELS || '[]');
    const defModel  = config.DEFAULT_MODEL;
    const removable = models.map((m, i) => ({ m, i })).filter(({ m }) => m !== defModel);
    if (removable.length === 0) {
      await done('\uD83D\uDD12 No removable models\\. Cannot remove the default model\\.');
      return;
    }
    // Show remove sub-menu by editing the same message
    const keyboard = removable.map(({ m, i }) => [{ text: m, callback_data: `removemodel_idx:${i}` }]);
    keyboard.push([{ text: '\u274C Cancel', callback_data: 'model_cancel' }]);
    await editMessage(chatId, msgId, '\uD83D\uDDD1\uFE0F *Select model to remove:*');
    // editMessage doesn't support keyboard — send new message for sub-menu
    await sendMessage(chatId, '\uD83D\uDDD1\uFE0F *Select model to remove:*', keyboard);
    return;
  }
  if (data.startsWith('removemodel_idx:')) {
    const idx    = parseInt(data.split(':')[1]);
    const models = JSON.parse(config.MODELS || '[]');
    const model  = models[idx];
    if (!model) { await done('\u274C Model not found\\.'); return; }
    if (model === config.DEFAULT_MODEL) { await done('\uD83D\uDD12 Cannot remove the default model\\.'); return; }
    const updated = models.filter((_, i) => i !== idx);
    await db.setConfig('MODELS', JSON.stringify(updated));
    if (config.ACTIVE_MODEL === model) await db.setConfig('ACTIVE_MODEL', config.DEFAULT_MODEL);
    await done('\u2705 Model removed: `' + escMd(model) + '`');
    return;
  }

  // ── APIs ─────────────────────────────────────────────────────
  if (data === 'api_add') {
    await db.setUserField(chatId, 'pending_action', 'add_api');
    await done('\u270F\uFE0F *Add API Key*\n\nSend the full API key\\.\n\nOr /cancel to abort\\.');
    return;
  }
  if (data === 'api_cancel') {
    await db.setUserField(chatId, 'pending_action', null);
    await done('\u274C Action cancelled\\.');
    return;
  }
  if (data.startsWith('setapi_idx:')) {
    const idx  = parseInt(data.split(':')[1]);
    const keys = JSON.parse(config.API_KEYS || '[]');
    const key  = keys[idx];
    if (!key) { await done('\u274C API key not found\\.'); return; }
    await db.setConfig('ACTIVE_API_KEY', key);
    await done('\u2705 Active API key set to: `\\.\\.\\.' + escMd(key.slice(-8)) + '`');
    return;
  }
  if (data === 'api_remove_menu') {
    const keys      = JSON.parse(config.API_KEYS || '[]');
    const defKey    = config.DEFAULT_API_KEY;
    const removable = keys.map((k, i) => ({ k, i })).filter(({ k }) => k !== defKey);
    if (removable.length === 0) {
      await done('\uD83D\uDD12 No removable API keys\\. Cannot remove the default key\\.');
      return;
    }
    const keyboard = removable.map(({ k, i }) => [{ text: '...' + k.slice(-8), callback_data: `removeapi_idx:${i}` }]);
    keyboard.push([{ text: '\u274C Cancel', callback_data: 'api_cancel' }]);
    await sendMessage(chatId, '\uD83D\uDDD1\uFE0F *Select API key to remove:*', keyboard);
    return;
  }
  if (data.startsWith('removeapi_idx:')) {
    const idx  = parseInt(data.split(':')[1]);
    const keys = JSON.parse(config.API_KEYS || '[]');
    const key  = keys[idx];
    if (!key) { await done('\u274C API key not found\\.'); return; }
    if (key === config.DEFAULT_API_KEY) { await done('\uD83D\uDD12 Cannot remove the default API key\\.'); return; }
    const updated = keys.filter((_, i) => i !== idx);
    await db.setConfig('API_KEYS', JSON.stringify(updated));
    if (config.ACTIVE_API_KEY === key) await db.setConfig('ACTIVE_API_KEY', config.DEFAULT_API_KEY);
    await done('\u2705 API key removed\\.');
    return;
  }

  // ── Clear confirm ─────────────────────────────────────────────
  if (data === 'clear_yes') {
    await db.clearHistory(chatId);
    await done('\uD83D\uDDD1\uFE0F Conversation history cleared\\!');
    return;
  }
  if (data === 'clear_no') {
    await done('\u274C Clear cancelled\\.');
    return;
  }
}

async function handleAuth(chatId, text) {
  if (text === '/start') {
    await sendMessage(chatId, '\uD83D\uDC4B Welcome to *Enosiii AI*\\!\n\n\uD83D\uDD12 This is a private bot\\. Please enter the password to continue\\.');
    return;
  }
  if (text === process.env.BOT_PASSWORD) {
    await db.authorizeUser(chatId);
    await sendMessage(chatId, '\u2705 *Access granted\\!* Welcome, Enosiii\\!\n\nType /help to see all available commands\\.\
\
Your default personality is *The Generalist*\\. Use /personality to change it\.');
  } else {
    await sendMessage(chatId, '\u274C Incorrect password\\. Please try again\\.');
  }
}

async function handleCommand(chatId, text, config, userData) {
  const command = text.split(' ')[0].toLowerCase().split('@')[0];
  switch (command) {
    case '/start':       await sendMessage(chatId, '\u2705 Already authenticated\\! Type /help for all commands\\.'); break;
    case '/help':        await cmdHelp(chatId); break;
    case '/clear':       await cmdClear(chatId); break;
    case '/personality': await cmdPersonality(chatId, userData); break;
    case '/models':      await cmdModels(chatId, config); break;
    case '/apis':        await cmdApis(chatId, config); break;
    case '/status':      await cmdStatus(chatId, config, userData); break;
    default:             await sendMessage(chatId, '\u2753 Unknown command\\. Type /help for the list\\.'); break;
  }
}

async function cmdHelp(chatId) {
  await sendMessage(chatId,
    '\uD83D\uDCD6 *Enosiii AI Commands*\n\n' +
    '/personality \\— Change AI personality\n' +
    '/models \\— Manage AI models\n' +
    '/apis \\— Manage API keys\n' +
    '/status \\— Show current settings\n' +
    '/clear \\— Clear conversation history\n' +
    '/cancel \\— Cancel any pending action\n\n' +
    '_Just type a message to chat with the AI\\._'
  );
}

async function cmdStatus(chatId, config, userData) {
  const model      = config.ACTIVE_MODEL || 'none';
  const apiKey     = config.ACTIVE_API_KEY || '';
  const apiPreview = apiKey ? '\\.\\.\\.' + escMd(apiKey.slice(-6)) : 'none';
  const pKey       = userData.personality;
  const pName      = pKey ? escMd(PERSONALITIES[pKey]?.name || pKey) : 'None \\(neutral\\)';
  const history    = await db.getUserHistory(chatId);
  await sendMessage(chatId,
    '\u2699\uFE0F *Current Status*\n\n' +
    '\uD83E\uDD16 *Model:* `' + escMd(model) + '`\n' +
    '\uD83D\uDD11 *API Key:* `' + apiPreview + '`\n' +
    '\uD83C\uDFAD *Personality:* ' + pName + '\n' +
    '\uD83D\uDCAC *History:* ' + history.length + '/' + MAX_HISTORY + ' messages'
  );
}

async function cmdClear(chatId) {
  await sendMessage(chatId,
    '\uD83D\uDDD1\uFE0F *Clear conversation history?*\n\nThis cannot be undone\\.',
    [[
      { text: '\u2705 Yes, clear it', callback_data: 'clear_yes' },
      { text: '\u274C Cancel',        callback_data: 'clear_no'  }
    ]]
  );
}

async function cmdPersonality(chatId, userData) {
  const keys    = Object.keys(PERSONALITIES);
  const current = userData.personality;
  const keyboard = [];
  for (let i = 0; i < keys.length; i += 2) {
    const row = [];
    const a   = keys[i];
    const b   = keys[i + 1];
    row.push({ text: (a === current ? '\u2705 ' : '') + a + '. ' + PERSONALITIES[a].name, callback_data: 'setpersonality:' + a });
    if (b) row.push({ text: (b === current ? '\u2705 ' : '') + b + '. ' + PERSONALITIES[b].name, callback_data: 'setpersonality:' + b });
    keyboard.push(row);
  }
  keyboard.push([{ text: '\uD83D\uDEAB Remove Personality (Neutral)', callback_data: 'setpersonality:none' }]);
  keyboard.push([{ text: '\u274C Cancel', callback_data: 'personality_cancel' }]);
  const currentName = current ? (PERSONALITIES[current]?.name || current) : 'None';
  await sendMessage(chatId, '\uD83C\uDFAD *Select a Personality:*\n\n_Current: ' + escMd(currentName) + '_', keyboard);
}

async function cmdModels(chatId, config) {
  const models   = JSON.parse(config.MODELS || '[]');
  const active   = config.ACTIVE_MODEL;
  const defModel = config.DEFAULT_MODEL;
  let msg = '\uD83E\uDD16 *Manage Models*\n\n';
  models.forEach((m, i) => {
    const tags = (m === active ? ' \u2705' : '') + (m === defModel ? ' \uD83D\uDD12' : '');
    msg += (i + 1) + '\\. `' + escMd(m) + '`' + escMd(tags) + '\n';
  });
  msg += '\n_\u2705 active  \uD83D\uDD12 default \\(protected\\)_';
  const setRows = models.map((m, i) => [{
    text: (m === active ? '\u2705 ' : '') + (i + 1) + '. ' + m.split('/').pop(),
    callback_data: 'setmodel_idx:' + i
  }]);
  const keyboard = [
    ...setRows,
    [
      { text: '\u2795 Add',    callback_data: 'model_add' },
      { text: '\uD83D\uDDD1\uFE0F Remove', callback_data: 'model_remove_menu' },
      { text: '\u274C Cancel', callback_data: 'model_cancel' }
    ]
  ];
  await sendMessage(chatId, msg, keyboard);
}

async function cmdApis(chatId, config) {
  const keys   = JSON.parse(config.API_KEYS || '[]');
  const active = config.ACTIVE_API_KEY;
  const defKey = config.DEFAULT_API_KEY;
  let msg = '\uD83D\uDD11 *Manage API Keys*\n\n';
  keys.forEach((k, i) => {
    const tags = (k === active ? ' \u2705' : '') + (k === defKey ? ' \uD83D\uDD12' : '');
    msg += (i + 1) + '\\. `\\.\\.\\.' + escMd(k.slice(-8)) + '`' + escMd(tags) + '\n';
  });
  msg += '\n_\u2705 active  \uD83D\uDD12 default \\(protected\\)_';
  const setRows = keys.map((k, i) => [{
    text: (k === active ? '\u2705 ' : '') + (i + 1) + '. ...' + k.slice(-8),
    callback_data: 'setapi_idx:' + i
  }]);
  const keyboard = [
    ...setRows,
    [
      { text: '\u2795 Add',    callback_data: 'api_add' },
      { text: '\uD83D\uDDD1\uFE0F Remove', callback_data: 'api_remove_menu' },
      { text: '\u274C Cancel', callback_data: 'api_cancel' }
    ]
  ];
  await sendMessage(chatId, msg, keyboard);
}

async function doAddModel(chatId, text, config) {
  await db.setUserField(chatId, 'pending_action', null);
  if (text.startsWith('/')) { await sendMessage(chatId, '\u274C Cancelled\\. No model added\\.'); return; }
  const models = JSON.parse(config.MODELS || '[]');
  if (models.includes(text)) { await sendMessage(chatId, '\u26A0\uFE0F Model already exists\\.'); return; }
  models.push(text);
  await db.setConfig('MODELS', JSON.stringify(models));
  await sendMessage(chatId, '\u2705 Model added: `' + escMd(text) + '`\n\nUse /models to set it as active\\.');
}

async function doAddApi(chatId, text, config) {
  await db.setUserField(chatId, 'pending_action', null);
  if (text.startsWith('/')) { await sendMessage(chatId, '\u274C Cancelled\\. No API key added\\.'); return; }
  const keys = JSON.parse(config.API_KEYS || '[]');
  if (keys.includes(text)) { await sendMessage(chatId, '\u26A0\uFE0F API key already exists\\.'); return; }
  keys.push(text);
  await db.setConfig('API_KEYS', JSON.stringify(keys));
  await sendMessage(chatId, '\u2705 API key added: `\\.\\.\\.' + escMd(text.slice(-8)) + '`\n\nUse /apis to set it as active\\.');
}

async function handleChat(chatId, userText, config, userData) {
  const apiKey      = config.ACTIVE_API_KEY;
  const model       = config.ACTIVE_MODEL;
  const personality = userData.personality;
  const history     = await db.getUserHistory(chatId);
  const messages    = [];
  if (personality && PERSONALITIES[personality]) {
    messages.push({ role: 'system', content: PERSONALITIES[personality].prompt });
  }
  for (const h of history) messages.push({ role: h.role, content: h.content });
  messages.push({ role: 'user', content: userText });
  const [_, aiReply] = await Promise.all([
    db.appendHistory(chatId, 'user', userText),
    callOpenRouter(apiKey, model, messages)
  ]);
  if (!aiReply) {
    await sendMessage(chatId, '\u26A0\uFE0F No response from AI\\. Please try again\\.');
    return;
  }
  await Promise.all([
    db.appendHistory(chatId, 'assistant', aiReply),
    sendAiReply(chatId, aiReply)
  ]);
  db.trimHistory(chatId, MAX_HISTORY).catch(() => {});
}