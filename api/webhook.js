const db            = require('../lib/db');
const { sendMessage, sendAiReply, escMd, answerCallback } = require('../lib/telegram');
const { callOpenRouter } = require('../lib/openrouter');
const PERSONALITIES = require('../lib/personalities');

const MAX_HISTORY = 20;

// ─── Entry Point ──────────────────────────────────────────────
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

// ─── Message Handler ──────────────────────────────────────────
async function handleUpdate(update) {
  const msg    = update.message;
  const chatId = String(msg.chat.id);
  const text   = (msg.text || '').trim();
  if (!text) return;

  const { userData, config } = await db.getContext(chatId);

  if (!userData) { await handleAuth(chatId, text); return; }

  // /cancel clears any pending action
  if (text === '/cancel') {
    await db.setUserField(chatId, 'pending_action', null);
    await sendMessage(chatId, '❌ Action cancelled\\.');
    return;
  }

  const pending = userData.pending_action;
  if (pending === 'add_model') { await doAddModel(chatId, text, config); return; }
  if (pending === 'add_api')   { await doAddApi(chatId, text, config); return; }

  if (text.charAt(0) === '/') { await handleCommand(chatId, text, config, userData); return; }

  await handleChat(chatId, text, config, userData);
}

// ─── Callback Query Handler ───────────────────────────────────
async function handleCallback(cb) {
  const chatId = String(cb.message.chat.id);
  const data   = cb.data;
  await answerCallback(cb.id);

  const { userData, config } = await db.getContext(chatId);
  if (!userData) return;

  // ── Personality ───────────────────────────────────────────
  if (data === 'personality_cancel') {
    await sendMessage(chatId, '❌ Action cancelled\\.');
    return;
  }
  if (data.startsWith('setpersonality:')) {
    const key = data.split(':')[1];
    if (key === 'none') {
      await db.setUserField(chatId, 'personality', null);
      await sendMessage(chatId, '✅ Personality removed\\. Bot is now in neutral mode\\.');
    } else if (PERSONALITIES[key]) {
      await db.setUserField(chatId, 'personality', key);
      await db.clearHistory(chatId);
      await sendMessage(chatId, '✅ Personality set to: *' + escMd(PERSONALITIES[key].name) + '*\n\n_History cleared for fresh context\\._');
    }
    return;
  }

  // ── Models ────────────────────────────────────────────────
  if (data === 'model_add') {
    await db.setUserField(chatId, 'pending_action', 'add_model');
    await sendMessage(chatId, '✏️ *Add Model*\n\nSend the model ID:\n_e\\.g\\. `meta\\-llama/llama\\-3\\.1\\-8b\\-instruct:free`_\n\nOr /cancel to abort\\.');
    return;
  }
  if (data === 'model_cancel') {
    await db.setUserField(chatId, 'pending_action', null);
    await sendMessage(chatId, '❌ Action cancelled\\.');
    return;
  }
  if (data.startsWith('setmodel:')) {
    const model = data.split(':').slice(1).join(':');
    await db.setConfig('ACTIVE_MODEL', model);
    await sendMessage(chatId, '✅ Active model set to:\n`' + escMd(model) + '`');
    return;
  }
  if (data === 'model_remove_menu') {
    const models    = JSON.parse(config.MODELS || '[]');
    const defModel  = config.DEFAULT_MODEL;
    const removable = models.filter(m => m !== defModel);
    if (removable.length === 0) {
      await sendMessage(chatId, '🔒 No removable models\\. Cannot remove the default model\\.');
      return;
    }
    const keyboard = removable.map((m, i) => [{ text: `${i + 1}. ${m}`, callback_data: `removemodel:${m}` }]);
    keyboard.push([{ text: '❌ Cancel', callback_data: 'model_cancel' }]);
    await sendMessage(chatId, '🗑️ *Select model to remove:*', keyboard);
    return;
  }
  if (data.startsWith('removemodel:')) {
    const model = data.split(':').slice(1).join(':');
    if (model === config.DEFAULT_MODEL) { await sendMessage(chatId, '🔒 Cannot remove the default model\\.'); return; }
    const models  = JSON.parse(config.MODELS || '[]');
    const updated = models.filter(m => m !== model);
    await db.setConfig('MODELS', JSON.stringify(updated));
    if (config.ACTIVE_MODEL === model) await db.setConfig('ACTIVE_MODEL', config.DEFAULT_MODEL);
    await sendMessage(chatId, '✅ Model removed: `' + escMd(model) + '`');
    return;
  }

  // ── APIs ──────────────────────────────────────────────────
  if (data === 'api_add') {
    await db.setUserField(chatId, 'pending_action', 'add_api');
    await sendMessage(chatId, '✏️ *Add API Key*\n\nSend the full API key\\.\n\nOr /cancel to abort\\.');
    return;
  }
  if (data === 'api_cancel') {
    await db.setUserField(chatId, 'pending_action', null);
    await sendMessage(chatId, '❌ Action cancelled\\.');
    return;
  }
  if (data.startsWith('setapi:')) {
    const key = data.split(':').slice(1).join(':');
    await db.setConfig('ACTIVE_API_KEY', key);
    await sendMessage(chatId, '✅ Active API key set to: `\\.\\.\\.' + escMd(key.slice(-6)) + '`');
    return;
  }
  if (data === 'api_remove_menu') {
    const keys      = JSON.parse(config.API_KEYS || '[]');
    const defKey    = config.DEFAULT_API_KEY;
    const removable = keys.filter(k => k !== defKey);
    if (removable.length === 0) {
      await sendMessage(chatId, '🔒 No removable API keys\\. Cannot remove the default key\\.');
      return;
    }
    const keyboard = removable.map((k, i) => [{ text: `${i + 1}. ...${k.slice(-8)}`, callback_data: `removeapi:${k}` }]);
    keyboard.push([{ text: '❌ Cancel', callback_data: 'api_cancel' }]);
    await sendMessage(chatId, '🗑️ *Select API key to remove:*', keyboard);
    return;
  }
  if (data.startsWith('removeapi:')) {
    const key = data.split(':').slice(1).join(':');
    if (key === config.DEFAULT_API_KEY) { await sendMessage(chatId, '🔒 Cannot remove the default API key\\.'); return; }
    const keys    = JSON.parse(config.API_KEYS || '[]');
    const updated = keys.filter(k => k !== key);
    await db.setConfig('API_KEYS', JSON.stringify(updated));
    if (config.ACTIVE_API_KEY === key) await db.setConfig('ACTIVE_API_KEY', config.DEFAULT_API_KEY);
    await sendMessage(chatId, '✅ API key removed\\.');
    return;
  }

  // ── Clear confirm ─────────────────────────────────────────
  if (data === 'clear_yes') {
    await db.clearHistory(chatId);
    await sendMessage(chatId, '🗑️ Conversation history cleared\\!');
    return;
  }
  if (data === 'clear_no') {
    await sendMessage(chatId, '✅ Clear cancelled\\.');
    return;
  }
}

// ─── Auth ─────────────────────────────────────────────────────
async function handleAuth(chatId, text) {
  if (text === '/start') {
    await sendMessage(chatId, '👋 Welcome to *Enosiii AI*\\!\n\n🔒 This is a private bot\\. Please enter the password to continue\\.');
    return;
  }
  if (text === process.env.BOT_PASSWORD) {
    await db.authorizeUser(chatId);
    await sendMessage(chatId, '✅ *Access granted\\!* Welcome, Enosiii\\!\n\nType /help to see all available commands\\.');
  } else {
    await sendMessage(chatId, '❌ Incorrect password\\. Please try again\\.');
  }
}

// ─── Command Router ───────────────────────────────────────────
async function handleCommand(chatId, text, config, userData) {
  const command = text.split(' ')[0].toLowerCase().split('@')[0];
  switch (command) {
    case '/start':       await sendMessage(chatId, '✅ Already authenticated\\! Type /help for all commands\\.'); break;
    case '/help':        await cmdHelp(chatId); break;
    case '/clear':       await cmdClear(chatId); break;
    case '/personality': await cmdPersonality(chatId, userData); break;
    case '/models':      await cmdModels(chatId, config); break;
    case '/apis':        await cmdApis(chatId, config); break;
    case '/status':      await cmdStatus(chatId, config, userData); break;
    default:             await sendMessage(chatId, '❓ Unknown command\\. Type /help for the list\\.'); break;
  }
}

// ─── Help ─────────────────────────────────────────────────────
async function cmdHelp(chatId) {
  await sendMessage(chatId,
    '📖 *Enosiii AI Commands*\n\n' +
    '/personality \\— Change AI personality\n' +
    '/models \\— Manage AI models\n' +
    '/apis \\— Manage API keys\n' +
    '/status \\— Show current settings\n' +
    '/clear \\— Clear conversation history\n' +
    '/cancel \\— Cancel any pending action\n\n' +
    '_Just type a message to chat with the AI\\._'
  );
}

// ─── Status ───────────────────────────────────────────────────
async function cmdStatus(chatId, config, userData) {
  const model      = config.ACTIVE_MODEL || 'none';
  const apiKey     = config.ACTIVE_API_KEY || '';
  const apiPreview = apiKey ? '\\.\\.\\.' + escMd(apiKey.slice(-6)) : 'none';
  const pKey       = userData.personality;
  const pName      = pKey ? escMd(PERSONALITIES[pKey]?.name || pKey) : 'None \\(neutral\\)';
  const history    = await db.getUserHistory(chatId);
  await sendMessage(chatId,
    '⚙️ *Current Status*\n\n' +
    '🤖 *Model:* `' + escMd(model) + '`\n' +
    '🔑 *API Key:* `' + apiPreview + '`\n' +
    '🎭 *Personality:* ' + pName + '\n' +
    '💬 *History:* ' + history.length + '/' + MAX_HISTORY + ' messages'
  );
}

// ─── Clear with confirmation ──────────────────────────────────
async function cmdClear(chatId) {
  await sendMessage(chatId,
    '🗑️ *Clear conversation history?*\n\nThis cannot be undone\\.',
    [[
      { text: '✅ Yes, clear it', callback_data: 'clear_yes' },
      { text: '❌ Cancel',        callback_data: 'clear_no'  }
    ]]
  );
}

// ─── Personality Menu ─────────────────────────────────────────
async function cmdPersonality(chatId, userData) {
  const keys     = Object.keys(PERSONALITIES);
  const current  = userData.personality;
  const keyboard = [];

  // 2 per row
  for (let i = 0; i < keys.length; i += 2) {
    const row = [];
    const a = keys[i];
    const b = keys[i + 1];
    const labelA = (a === current ? '✅ ' : '') + `${a}. ${PERSONALITIES[a].name}`;
    row.push({ text: labelA, callback_data: `setpersonality:${a}` });
    if (b) {
      const labelB = (b === current ? '✅ ' : '') + `${b}. ${PERSONALITIES[b].name}`;
      row.push({ text: labelB, callback_data: `setpersonality:${b}` });
    }
    keyboard.push(row);
  }
  keyboard.push([{ text: '🚫 Remove Personality (Neutral)', callback_data: 'setpersonality:none' }]);
  keyboard.push([{ text: '❌ Cancel', callback_data: 'personality_cancel' }]);

  await sendMessage(chatId, '🎭 *Select a Personality:*\n\n_Current: ' + escMd(current ? (PERSONALITIES[current]?.name || current) : 'None') + '_', keyboard);
}

// ─── Models Menu ──────────────────────────────────────────────
async function cmdModels(chatId, config) {
  const models   = JSON.parse(config.MODELS || '[]');
  const active   = config.ACTIVE_MODEL;
  const defModel = config.DEFAULT_MODEL;

  let msg = '🤖 *Manage Models*\n\n';
  models.forEach((m, i) => {
    const isActive  = m === active  ? ' ✅' : '';
    const isDefault = m === defModel ? ' 🔒' : '';
    msg += `${i + 1}\\. \`${escMd(m)}\`${escMd(isActive + isDefault)}\n`;
  });
  msg += '\n_✅ active  🔒 default \\(protected\\)_';

  // Set buttons: one per model, 1 per row
  const setRows = models.map((m, i) => [{ text: `${i + 1}. Set Active: ${m === active ? '✅ ' : ''}${m.split('/').pop()}`, callback_data: `setmodel:${m}` }]);

  const keyboard = [
    ...setRows,
    [
      { text: '➕ Add Model',    callback_data: 'model_add' },
      { text: '🗑️ Remove Model', callback_data: 'model_remove_menu' }
    ],
    [{ text: '❌ Cancel', callback_data: 'model_cancel' }]
  ];

  await sendMessage(chatId, msg, keyboard);
}

// ─── APIs Menu ────────────────────────────────────────────────
async function cmdApis(chatId, config) {
  const keys   = JSON.parse(config.API_KEYS || '[]');
  const active = config.ACTIVE_API_KEY;
  const defKey = config.DEFAULT_API_KEY;

  let msg = '🔑 *Manage API Keys*\n\n';
  keys.forEach((k, i) => {
    const isActive  = k === active  ? ' ✅' : '';
    const isDefault = k === defKey  ? ' 🔒' : '';
    msg += `${i + 1}\\. \`\\.\\.\\.${escMd(k.slice(-8))}\`${escMd(isActive + isDefault)}\n`;
  });
  msg += '\n_✅ active  🔒 default \\(protected\\)_';

  // Set buttons: one per key, 1 per row
  const setRows = keys.map((k, i) => [{ text: `${i + 1}. Set Active: ${k === active ? '✅ ' : ''}...${k.slice(-8)}`, callback_data: `setapi:${k}` }]);

  const keyboard = [
    ...setRows,
    [
      { text: '➕ Add API Key',    callback_data: 'api_add' },
      { text: '🗑️ Remove API Key', callback_data: 'api_remove_menu' }
    ],
    [{ text: '❌ Cancel', callback_data: 'api_cancel' }]
  ];

  await sendMessage(chatId, msg, keyboard);
}

// ─── Pending: Add Model ───────────────────────────────────────
async function doAddModel(chatId, text, config) {
  await db.setUserField(chatId, 'pending_action', null);
  if (text.startsWith('/')) { await sendMessage(chatId, '❌ Cancelled\\. No model added\\.'); return; }
  const models = JSON.parse(config.MODELS || '[]');
  if (models.includes(text)) { await sendMessage(chatId, '⚠️ Model already exists\\.'); return; }
  models.push(text);
  await db.setConfig('MODELS', JSON.stringify(models));
  await sendMessage(chatId, '✅ Model added: `' + escMd(text) + '`\n\nUse /models to set it as active\\.');
}

// ─── Pending: Add API ─────────────────────────────────────────
async function doAddApi(chatId, text, config) {
  await db.setUserField(chatId, 'pending_action', null);
  if (text.startsWith('/')) { await sendMessage(chatId, '❌ Cancelled\\. No API key added\\.'); return; }
  const keys = JSON.parse(config.API_KEYS || '[]');
  if (keys.includes(text)) { await sendMessage(chatId, '⚠️ API key already exists\\.'); return; }
  keys.push(text);
  await db.setConfig('API_KEYS', JSON.stringify(keys));
  await sendMessage(chatId, '✅ API key added: `\\.\\.\\.' + escMd(text.slice(-8)) + '`\n\nUse /apis to set it as active\\.');
}

// ─── AI Chat ──────────────────────────────────────────────────
async function handleChat(chatId, userText, config, userData) {
  const apiKey      = config.ACTIVE_API_KEY;
  const model       = config.ACTIVE_MODEL;
  const personality = userData.personality;

  const history  = await db.getUserHistory(chatId);
  const messages = [];

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
    await sendMessage(chatId, '⚠️ No response from AI\\. Please try again\\.');
    return;
  }

  await Promise.all([
    db.appendHistory(chatId, 'assistant', aiReply),
    sendAiReply(chatId, aiReply)
  ]);

  db.trimHistory(chatId, MAX_HISTORY).catch(() => {});
}