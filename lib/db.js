const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getSupabase() {
  if (!_client) {
    _client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
  }
  return _client;
}

// ─── Bot Config ───────────────────────────────────────────────
// Fetch ALL config keys in one query and cache for the request
let _configCache = null;
let _configCacheTime = 0;
const CONFIG_CACHE_TTL = 10000; // 10 seconds

async function getAllConfig() {
  const now = Date.now();
  if (_configCache && (now - _configCacheTime) < CONFIG_CACHE_TTL) {
    return _configCache;
  }
  const sb = getSupabase();
  const { data } = await sb.from('bot_config').select('key, value');
  const map = {};
  if (data) data.forEach(row => { map[row.key] = row.value; });
  _configCache = map;
  _configCacheTime = now;
  return map;
}

async function getConfig(key) {
  const all = await getAllConfig();
  return all[key] || null;
}

async function setConfig(key, value) {
  const sb = getSupabase();
  await sb.from('bot_config').upsert({ key, value }, { onConflict: 'key' });
  // Invalidate cache
  _configCache = null;
}

// ─── Auth + User State (single query) ────────────────────────
async function getUserData(chatId) {
  const sb = getSupabase();
  const { data } = await sb
    .from('users')
    .select('chat_id, personality, pending_action')
    .eq('chat_id', String(chatId))
    .single();
  return data || null;
}

async function isAuthorized(chatId) {
  const data = await getUserData(chatId);
  return !!data;
}

async function authorizeUser(chatId) {
  const sb = getSupabase();
  await sb.from('users').upsert(
    { chat_id: String(chatId), personality: null, pending_action: null },
    { onConflict: 'chat_id' }
  );
}

async function getUserField(chatId, field) {
  const data = await getUserData(chatId);
  return data ? data[field] : null;
}

async function setUserField(chatId, field, value) {
  const sb = getSupabase();
  await sb.from('users').update({ [field]: value }).eq('chat_id', String(chatId));
}

// ─── Batch: get user + config in parallel ────────────────────
async function getContext(chatId) {
  const [userData, config] = await Promise.all([
    getUserData(chatId),
    getAllConfig()
  ]);
  return { userData, config };
}

// ─── Conversation History ─────────────────────────────────────
async function getUserHistory(chatId) {
  const sb = getSupabase();
  const { data } = await sb
    .from('history')
    .select('role, content')
    .eq('chat_id', String(chatId))
    .order('created_at', { ascending: true });
  return data || [];
}

async function appendHistory(chatId, role, content) {
  const sb = getSupabase();
  await sb.from('history').insert({ chat_id: String(chatId), role, content });
}

async function trimHistory(chatId, maxMessages) {
  const sb = getSupabase();
  const { data } = await sb
    .from('history')
    .select('id')
    .eq('chat_id', String(chatId))
    .order('created_at', { ascending: true });

  if (!data || data.length <= maxMessages) return;
  const toDelete = data.slice(0, data.length - maxMessages).map(r => r.id);
  await sb.from('history').delete().in('id', toDelete);
}

async function clearHistory(chatId) {
  const sb = getSupabase();
  await sb.from('history').delete().eq('chat_id', String(chatId));
}

module.exports = {
  getConfig,
  setConfig,
  getAllConfig,
  getContext,
  isAuthorized,
  authorizeUser,
  getUserData,
  getUserField,
  setUserField,
  getUserHistory,
  appendHistory,
  trimHistory,
  clearHistory
};