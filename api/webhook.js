const fetch = require('node-fetch');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'EnosIII Bot is running' });
  }

  const update = req.body;

  // Fire-and-forget to process endpoint using hardcoded production URL
  const processUrl = process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}/api/process`
    : 'https://enosiii-ai.vercel.app/api/process';

  console.log('Firing process to:', processUrl);

  fetch(processUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(update)
  }).catch(err => console.error('Failed to fire process:', err.message));

  return res.status(200).json({ status: 'ok' });
};