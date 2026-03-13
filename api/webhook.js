const fetch = require('node-fetch');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(200).json({ status: 'EnosIII Bot is running' });
  }

  const update = req.body;

  // Respond to Telegram immediately
  res.status(200).json({ status: 'ok' });

  // Now process — Vercel will keep running until this completes (up to 60s)
  try {
    const response = await fetch('https://enosiii-ai.vercel.app/api/process', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(update)
    });
    console.log('Process response:', response.status);
  } catch (err) {
    console.error('Failed to call process:', err.message);
  }
};