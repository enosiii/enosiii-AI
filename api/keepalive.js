const { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  try {
    const sb = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    // Simple lightweight query to keep the project active
    await sb.from('bot_config').select('key').limit(1);
    console.log('Keep-alive ping successful:', new Date().toISOString());
    return res.status(200).json({ status: 'ok', time: new Date().toISOString() });
  } catch (err) {
    console.error('Keep-alive error:', err.message);
    return res.status(500).json({ status: 'error', message: err.message });
  }
};