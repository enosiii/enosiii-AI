const fetch = require('node-fetch');

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

async function callOpenRouter(apiKey, model, messages) {
  try {
    console.log('callOpenRouter: model=' + model + ' apiKey=...' + (apiKey || '').slice(-6));

    const response = await fetch(OPENROUTER_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  'https://vercel.app',
        'X-Title':       'EnosIII Bot'
      },
      body: JSON.stringify({ model, messages })
    });

    const body = await response.json();
    console.log('OpenRouter status:', response.status);
    console.log('OpenRouter body:', JSON.stringify(body).slice(0, 500));

    if (response.status !== 200) {
      console.error('OpenRouter error:', response.status, JSON.stringify(body));
      return null;
    }

    return body.choices?.[0]?.message?.content || null;
  } catch (err) {
    console.error('callOpenRouter error:', err.message);
    return null;
  }
}

module.exports = { callOpenRouter };