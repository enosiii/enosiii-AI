const db            = require('../lib/db');
const { sendMessage, sendAiReply, escMd } = require('../lib/telegram');
const { callOpenRouter } = require('../lib/openrouter');
const PERSONALITIES = require('../lib/personalities');

const MAX_HISTORY = 20; // Reduced from 50 to speed up DB queries

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'EnosIII Bot is running' });
  }

  const update = req.body;
  if (!update || !update.message) {
    return res.status(200).json({ status: 'ok' });
  }

  try {
    await handleUpdate(update);
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

  // Single batched call: get user data + all config in parallel
  const { userData, config } = await db.getContext(chatId);

  if (!userData) {
    await handleAuth(chatId, text, config);
    return;
  }

  if (userData.pending_action === 'select_personality') {
    await handlePersonalitySelection(chatId, text);
    return;
  }

  if (text.charAt(0) === '/') {
    await handleCommand(chatId, text, config, userData);
    return;
  }

  await handleChat(chatId, text, config, userData);
}

async function handleAuth(chatId, text, config) {
  const password = process.env.BOT_PASSWORD;
  if (text === '/start') {
    await sendMessage(chatId, '👋 Welcome to *EnosIII Bot*\\!\n\n🔒 This is a private bot\\. Please enter the password to continue\\.');
    return;
  }
  if (text === password) {
    await db.authorizeUser(chatId);
    await sendMessage(chatId, '✅ *Access granted\\!* Welcome, Enosiii\\!\n\nType /help to see all available commands\\.');
  } else {
    await sendMessage(chatId, '❌ Incorrect password\\. Please try again\\.');
  }
}

async function handleCommand(chatId, text, config, userData) {
  const parts   = text.split(' ');
  const command = parts[0].toLowerCase().split('@')[0];
  const arg     = parts.slice(1).join(' ').trim();

  switch (command) {
    case '/start':       await sendMessage(chatId, '✅ Already authenticated\\! Type /help for all commands\\.'); break;
    case '/help':        await cmdHelp(chatId); break;
    case '/clear':       await cmdClear(chatId); break;
    case '/personality': await cmdPersonality(chatId); break;
    case '/models':      await cmdListModels(chatId, config); break;
    case '/addmodel':    await cmdAddModel(chatId, arg, config); break;
    case '/removemodel': await cmdRemoveModel(chatId, arg, config); break;
    case '/setmodel':    await cmdSetModel(chatId, arg, config); break;
    case '/apis':        await cmdListApis(chatId, config); break;
    case '/addapi':      await cmdAddApi(chatId, arg, config); break;
    case '/removeapi':   await cmdRemoveApi(chatId, arg, config); break;
    case '/setapi':      await cmdSetApi(chatId, arg, config); break;
    case '/status':      await cmdStatus(chatId, config, userData); break;
    default:             await sendMessage(chatId, '❓ Unknown command\\. Type /help for the list\\.'); break;
  }
}

async function cmdHelp(chatId) {
  await sendMessage(chatId,
    '📖 *EnosIII Bot Commands*\n\n' +
    '*💬 Chat*\n' +
    '`/clear` \\— Clear conversation history\n' +
    '`/personality` \\— Change AI personality\n' +
    '`/status` \\— Show current settings\n\n' +
    '*🤖 Models*\n' +
    '`/models` \\— List all models\n' +
    '`/addmodel <id>` \\— Add a model\n' +
    '`/removemodel <id>` \\— Remove a model\n' +
    '`/setmodel <id>` \\— Switch active model\n\n' +
    '*🔑 API Keys*\n' +
    '`/apis` \\— List all API keys\n' +
    '`/addapi <key>` \\— Add an API key\n' +
    '`/removeapi <key>` \\— Remove an API key\n' +
    '`/setapi <key>` \\— Switch active API key'
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
    '⚙️ *Current Status*\n\n' +
    '🤖 *Model:* `' + escMd(model) + '`\n' +
    '🔑 *API Key:* `' + apiPreview + '`\n' +
    '🎭 *Personality:* ' + pName + '\n' +
    '💬 *History:* ' + history.length + '/' + MAX_HISTORY + ' messages'
  );
}

async function cmdClear(chatId) {
  await db.clearHistory(chatId);
  await sendMessage(chatId, '🗑️ Conversation history cleared\\!');
}

async function cmdPersonality(chatId) {
  let msg = '🎭 *Select a Personality*\n\nReply with the number:\n\n';
  for (const k of Object.keys(PERSONALITIES)) {
    msg += escMd(k + '. ' + PERSONALITIES[k].name) + '\n';
  }
  msg += '\n`0` \\— Remove personality \\(neutral mode\\)';
  await db.setUserField(chatId, 'pending_action', 'select_personality');
  await sendMessage(chatId, msg);
}

async function handlePersonalitySelection(chatId, text) {
  await db.setUserField(chatId, 'pending_action', null);
  if (text === '0') {
    await db.setUserField(chatId, 'personality', null);
    await sendMessage(chatId, '✅ Personality removed\\. Bot is now in neutral mode\\.');
    return;
  }
  if (PERSONALITIES[text]) {
    await db.setUserField(chatId, 'personality', text);
    await db.clearHistory(chatId);
    await sendMessage(chatId, '✅ Personality set to:\n*' + escMd(PERSONALITIES[text].name) + '*\n\n_Conversation history cleared for fresh context\\._');
  } else {
    await sendMessage(chatId, '❌ Invalid selection\\. Type /personality to try again\\.');
  }
}

async function cmdListModels(chatId, config) {
  const models   = JSON.parse(config.MODELS || '[]');
  const active   = config.ACTIVE_MODEL;
  const defModel = config.DEFAULT_MODEL;
  let msg = '🤖 *Saved Models*\n\n';
  for (const m of models) {
    const tag = (m === active ? ' ✅' : '') + (m === defModel ? ' 🔒' : '');
    msg += '`' + escMd(m) + '`' + escMd(tag) + '\n';
  }
  msg += '\n✅ \\= active  🔒 \\= default \\(protected\\)';
  await sendMessage(chatId, msg);
}

async function cmdAddModel(chatId, arg, config) {
  if (!arg) { await sendMessage(chatId, '❌ Usage: `/addmodel <model_id>`'); return; }
  const models = JSON.parse(config.MODELS || '[]');
  if (models.includes(arg)) { await sendMessage(chatId, '⚠️ Model already exists\\.'); return; }
  models.push(arg);
  await db.setConfig('MODELS', JSON.stringify(models));
  await sendMessage(chatId, '✅ Model added: `' + escMd(arg) + '`');
}

async function cmdRemoveModel(chatId, arg, config) {
  if (!arg) { await sendMessage(chatId, '❌ Usage: `/removemodel <model_id>`'); return; }
  if (arg === config.DEFAULT_MODEL) { await sendMessage(chatId, '🔒 Cannot remove the default model\\.'); return; }
  const models = JSON.parse(config.MODELS || '[]');
  const idx = models.indexOf(arg);
  if (idx === -1) { await sendMessage(chatId, '❌ Model not found\\.'); return; }
  models.splice(idx, 1);
  await db.setConfig('MODELS', JSON.stringify(models));
  if (config.ACTIVE_MODEL === arg) await db.setConfig('ACTIVE_MODEL', config.DEFAULT_MODEL);
  await sendMessage(chatId, '✅ Model removed: `' + escMd(arg) + '`');
}

async function cmdSetModel(chatId, arg, config) {
  if (!arg) { await sendMessage(chatId, '❌ Usage: `/setmodel <model_id>`'); return; }
  const models = JSON.parse(config.MODELS || '[]');
  if (!models.includes(arg)) { await sendMessage(chatId, '❌ Model not found\\. Add it first with `/addmodel`\\.'); return; }
  await db.setConfig('ACTIVE_MODEL', arg);
  await sendMessage(chatId, '✅ Active model set to:\n`' + escMd(arg) + '`');
}

async function cmdListApis(chatId, config) {
  const keys   = JSON.parse(config.API_KEYS || '[]');
  const active = config.ACTIVE_API_KEY;
  const defKey = config.DEFAULT_API_KEY;
  let msg = '🔑 *Saved API Keys*\n\n';
  for (const k of keys) {
    const preview = '\\.\\.\\.' + escMd(k.slice(-6));
    const tag = (k === active ? ' ✅' : '') + (k === defKey ? ' 🔒' : '');
    msg += '`' + preview + '`' + escMd(tag) + '\n';
  }
  msg += '\n✅ \\= active  🔒 \\= default \\(protected\\)';
  await sendMessage(chatId, msg);
}

async function cmdAddApi(chatId, arg, config) {
  if (!arg) { await sendMessage(chatId, '❌ Usage: `/addapi <api_key>`'); return; }
  const keys = JSON.parse(config.API_KEYS || '[]');
  if (keys.includes(arg)) { await sendMessage(chatId, '⚠️ API key already exists\\.'); return; }
  keys.push(arg);
  await db.setConfig('API_KEYS', JSON.stringify(keys));
  await sendMessage(chatId, '✅ API key added: `\\.\\.\\.' + escMd(arg.slice(-6)) + '`');
}

async function cmdRemoveApi(chatId, arg, config) {
  if (!arg) { await sendMessage(chatId, '❌ Usage: `/removeapi <api_key>`'); return; }
  if (arg === config.DEFAULT_API_KEY) { await sendMessage(chatId, '🔒 Cannot remove the default API key\\.'); return; }
  const keys = JSON.parse(config.API_KEYS || '[]');
  const idx = keys.indexOf(arg);
  if (idx === -1) { await sendMessage(chatId, '❌ API key not found\\.'); return; }
  keys.splice(idx, 1);
  await db.setConfig('API_KEYS', JSON.stringify(keys));
  if (config.ACTIVE_API_KEY === arg) await db.setConfig('ACTIVE_API_KEY', config.DEFAULT_API_KEY);
  await sendMessage(chatId, '✅ API key removed\\.');
}

async function cmdSetApi(chatId, arg, config) {
  if (!arg) { await sendMessage(chatId, '❌ Usage: `/setapi <api_key>`'); return; }
  const keys = JSON.parse(config.API_KEYS || '[]');
  if (!keys.includes(arg)) { await sendMessage(chatId, '❌ API key not found\\. Add it first with `/addapi`\\.'); return; }
  await db.setConfig('ACTIVE_API_KEY', arg);
  await sendMessage(chatId, '✅ Active API key set to: `\\.\\.\\.' + escMd(arg.slice(-6)) + '`');
}

async function handleChat(chatId, userText, config, userData) {
  const apiKey      = config.ACTIVE_API_KEY;
  const model       = config.ACTIVE_MODEL;
  const personality = userData.personality;

  // Get history in parallel while we prepare messages
  const history = await db.getUserHistory(chatId);
  const messages = [];

  if (personality && PERSONALITIES[personality]) {
    messages.push({ role: 'system', content: PERSONALITIES[personality].prompt });
  }
  for (const h of history) messages.push({ role: h.role, content: h.content });
  messages.push({ role: 'user', content: userText });

  // Save user message + call AI in parallel
  const [_, aiReply] = await Promise.all([
    db.appendHistory(chatId, 'user', userText),
    callOpenRouter(apiKey, model, messages)
  ]);

  if (!aiReply) {
    await sendMessage(chatId, '⚠️ No response from AI\\. Please try again\\.');
    return;
  }

  // Save AI reply + send response in parallel
  await Promise.all([
    db.appendHistory(chatId, 'assistant', aiReply),
    sendAiReply(chatId, aiReply)
  ]);

  // Trim history in background (non-blocking)
  db.trimHistory(chatId, MAX_HISTORY).catch(() => {});
}