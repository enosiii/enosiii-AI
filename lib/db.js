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
async function getConfig(key) {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('bot_config')
    .select('value')
    .eq('key', key)
    .single();
  if (error || !data) return null;
  return data.value;
}

async function setConfig(key, value) {
  const sb = getSupabase();
  await sb.from('bot_config').upsert({ key, value }, { onConflict: 'key' });
}

// ─── Auth Users ───────────────────────────────────────────────
async function isAuthorized(chatId) {
  const sb = getSupabase();
  const { data } = await sb
    .from('users')
    .select('chat_id')
    .eq('chat_id', String(chatId))
    .single();
  return !!data;
}

async function authorizeUser(chatId) {
  const sb = getSupabase();
  await sb.from('users').upsert(
    { chat_id: String(chatId), personality: null, pending_action: null },
    { onConflict: 'chat_id' }
  );
}

// ─── User State ───────────────────────────────────────────────
async function getUserField(chatId, field) {
  const sb = getSupabase();
  const { data } = await sb
    .from('users')
    .select(field)
    .eq('chat_id', String(chatId))
    .single();
  return data ? data[field] : null;
}

async function setUserField(chatId, field, value) {
  const sb = getSupabase();
  await sb
    .from('users')
    .update({ [field]: value })
    .eq('chat_id', String(chatId));
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
  // Get all message IDs ordered by time
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
  isAuthorized,
  authorizeUser,
  getUserField,
  setUserField,
  getUserHistory,
  appendHistory,
  trimHistory,
  clearHistory
};
