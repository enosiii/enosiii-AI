const db            = require('../lib/db');
const { sendMessage, sendAiReply, escMd } = require('../lib/telegram');
const { callOpenRouter } = require('../lib/openrouter');
const PERSONALITIES = require('../lib/personalities');

const MAX_HISTORY = 50;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'ok' });
  }

  // Respond immediately so this internal call doesn't block
  res.status(200).json({ status: 'processing' });

  const update = req.body;
  if (!update || !update.message) return;

  try {
    await handleUpdate(update);
  } catch (err) {
    console.error('Process error:', err.message);
  }
};

async function handleUpdate(update) {
  const msg    = update.message;
  const chatId = String(msg.chat.id);
  const text   = (msg.text || '').trim();

  if (!text) return;

  const authorized = await db.isAuthorized(chatId);
  if (!authorized) { await handleAuth(chatId, text); return; }

  const pendingAction = await db.getUserField(chatId, 'pending_action');
  if (pendingAction === 'select_personality') { await handlePersonalitySelection(chatId, text); return; }

  if (text.charAt(0) === '/') { await handleCommand(chatId, text); return; }

  await handleChat(chatId, text);
}

async function handleAuth(chatId, text) {
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

async function handleCommand(chatId, text) {
  const parts   = text.split(' ');
  const command = parts[0].toLowerCase().split('@')[0];
  const arg     = parts.slice(1).join(' ').trim();

  switch (command) {
    case '/start':       await sendMessage(chatId, '✅ Already authenticated\\! Type /help for all commands\\.'); break;
    case '/help':        await cmdHelp(chatId);             break;
    case '/clear':       await cmdClear(chatId);            break;
    case '/personality': await cmdPersonality(chatId);      break;
    case '/models':      await cmdListModels(chatId);       break;
    case '/addmodel':    await cmdAddModel(chatId, arg);    break;
    case '/removemodel': await cmdRemoveModel(chatId, arg); break;
    case '/setmodel':    await cmdSetModel(chatId, arg);    break;
    case '/apis':        await cmdListApis(chatId);         break;
    case '/addapi':      await cmdAddApi(chatId, arg);      break;
    case '/removeapi':   await cmdRemoveApi(chatId, arg);   break;
    case '/setapi':      await cmdSetApi(chatId, arg);      break;
    case '/status':      await cmdStatus(chatId);           break;
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

async function cmdStatus(chatId) {
  const model      = await db.getConfig('ACTIVE_MODEL') || 'none';
  const apiKey     = await db.getConfig('ACTIVE_API_KEY') || '';
  const apiPreview = apiKey ? '\\.\\.\\.' + escMd(apiKey.slice(-6)) : 'none';
  const pKey       = await db.getUserField(chatId, 'personality');
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

async function cmdListModels(chatId) {
  const models   = JSON.parse(await db.getConfig('MODELS') || '[]');
  const active   = await db.getConfig('ACTIVE_MODEL');
  const defModel = await db.getConfig('DEFAULT_MODEL');
  let msg = '🤖 *Saved Models*\n\n';
  for (const m of models) {
    const tag = (m === active ? ' ✅' : '') + (m === defModel ? ' 🔒' : '');
    msg += '`' + escMd(m) + '`' + escMd(tag) + '\n';
  }
  msg += '\n✅ \\= active  🔒 \\= default \\(protected\\)';
  await sendMessage(chatId, msg);
}

async function cmdAddModel(chatId, arg) {
  if (!arg) { await sendMessage(chatId, '❌ Usage: `/addmodel <model_id>`'); return; }
  const models = JSON.parse(await db.getConfig('MODELS') || '[]');
  if (models.includes(arg)) { await sendMessage(chatId, '⚠️ Model already exists\\.'); return; }
  models.push(arg);
  await db.setConfig('MODELS', JSON.stringify(models));
  await sendMessage(chatId, '✅ Model added: `' + escMd(arg) + '`');
}

async function cmdRemoveModel(chatId, arg) {
  if (!arg) { await sendMessage(chatId, '❌ Usage: `/removemodel <model_id>`'); return; }
  const defModel = await db.getConfig('DEFAULT_MODEL');
  if (arg === defModel) { await sendMessage(chatId, '🔒 Cannot remove the default model\\.'); return; }
  const models = JSON.parse(await db.getConfig('MODELS') || '[]');
  const idx = models.indexOf(arg);
  if (idx === -1) { await sendMessage(chatId, '❌ Model not found\\.'); return; }
  models.splice(idx, 1);
  await db.setConfig('MODELS', JSON.stringify(models));
  if (await db.getConfig('ACTIVE_MODEL') === arg) await db.setConfig('ACTIVE_MODEL', defModel);
  await sendMessage(chatId, '✅ Model removed: `' + escMd(arg) + '`');
}

async function cmdSetModel(chatId, arg) {
  if (!arg) { await sendMessage(chatId, '❌ Usage: `/setmodel <model_id>`'); return; }
  const models = JSON.parse(await db.getConfig('MODELS') || '[]');
  if (!models.includes(arg)) { await sendMessage(chatId, '❌ Model not found\\. Add it first with `/addmodel`\\.'); return; }
  await db.setConfig('ACTIVE_MODEL', arg);
  await sendMessage(chatId, '✅ Active model set to:\n`' + escMd(arg) + '`');
}

async function cmdListApis(chatId) {
  const keys   = JSON.parse(await db.getConfig('API_KEYS') || '[]');
  const active = await db.getConfig('ACTIVE_API_KEY');
  const defKey = await db.getConfig('DEFAULT_API_KEY');
  let msg = '🔑 *Saved API Keys*\n\n';
  for (const k of keys) {
    const preview = '\\.\\.\\.' + escMd(k.slice(-6));
    const tag = (k === active ? ' ✅' : '') + (k === defKey ? ' 🔒' : '');
    msg += '`' + preview + '`' + escMd(tag) + '\n';
  }
  msg += '\n✅ \\= active  🔒 \\= default \\(protected\\)';
  await sendMessage(chatId, msg);
}

async function cmdAddApi(chatId, arg) {
  if (!arg) { await sendMessage(chatId, '❌ Usage: `/addapi <api_key>`'); return; }
  const keys = JSON.parse(await db.getConfig('API_KEYS') || '[]');
  if (keys.includes(arg)) { await sendMessage(chatId, '⚠️ API key already exists\\.'); return; }
  keys.push(arg);
  await db.setConfig('API_KEYS', JSON.stringify(keys));
  await sendMessage(chatId, '✅ API key added: `\\.\\.\\.' + escMd(arg.slice(-6)) + '`');
}

async function cmdRemoveApi(chatId, arg) {
  if (!arg) { await sendMessage(chatId, '❌ Usage: `/removeapi <api_key>`'); return; }
  const defKey = await db.getConfig('DEFAULT_API_KEY');
  if (arg === defKey) { await sendMessage(chatId, '🔒 Cannot remove the default API key\\.'); return; }
  const keys = JSON.parse(await db.getConfig('API_KEYS') || '[]');
  const idx = keys.indexOf(arg);
  if (idx === -1) { await sendMessage(chatId, '❌ API key not found\\.'); return; }
  keys.splice(idx, 1);
  await db.setConfig('API_KEYS', JSON.stringify(keys));
  if (await db.getConfig('ACTIVE_API_KEY') === arg) await db.setConfig('ACTIVE_API_KEY', defKey);
  await sendMessage(chatId, '✅ API key removed\\.');
}

async function cmdSetApi(chatId, arg) {
  if (!arg) { await sendMessage(chatId, '❌ Usage: `/setapi <api_key>`'); return; }
  const keys = JSON.parse(await db.getConfig('API_KEYS') || '[]');
  if (!keys.includes(arg)) { await sendMessage(chatId, '❌ API key not found\\. Add it first with `/addapi`\\.'); return; }
  await db.setConfig('ACTIVE_API_KEY', arg);
  await sendMessage(chatId, '✅ Active API key set to: `\\.\\.\\.' + escMd(arg.slice(-6)) + '`');
}

async function handleChat(chatId, userText) {
  const apiKey      = await db.getConfig('ACTIVE_API_KEY');
  const model       = await db.getConfig('ACTIVE_MODEL');
  const personality = await db.getUserField(chatId, 'personality');
  const history     = await db.getUserHistory(chatId);
  const messages    = [];

  if (personality && PERSONALITIES[personality]) {
    messages.push({ role: 'system', content: PERSONALITIES[personality].prompt });
  }
  for (const h of history) messages.push({ role: h.role, content: h.content });
  messages.push({ role: 'user', content: userText });

  await db.appendHistory(chatId, 'user', userText);
  await db.trimHistory(chatId, MAX_HISTORY);

  const aiReply = await callOpenRouter(apiKey, model, messages);

  if (!aiReply) {
    await sendMessage(chatId, '⚠️ No response from AI\\. Please try again\\.');
    return;
  }

  await db.appendHistory(chatId, 'assistant', aiReply);
  await db.trimHistory(chatId, MAX_HISTORY);
  await sendAiReply(chatId, aiReply);
}