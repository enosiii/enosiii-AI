const fetch = require('node-fetch');

// Webhook entry point — responds 200 immediately, fires process in background
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'EnosIII Bot is running' });
  }

  const update = req.body;

  // Fire-and-forget the process endpoint (do NOT await)
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  fetch(`https://${host}/api/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update)
  }).catch(err => console.error('Failed to fire process:', err.message));

  // Respond to Telegram immediately
  return res.status(200).json({ status: 'ok' });
};