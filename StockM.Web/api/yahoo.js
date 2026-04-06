const https = require('https');

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace(/^\/api\/yahoo\//, '');
  const qs = url.search || '';
  const target = `https://query1.finance.yahoo.com/${path}${qs}`;

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const data = await new Promise((resolve, reject) => {
      https.get(target, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } }, (upstream) => {
        let body = '';
        upstream.on('data', (chunk) => body += chunk);
        upstream.on('end', () => resolve({ status: upstream.statusCode, body }));
        upstream.on('error', reject);
      }).on('error', reject);
    });
    res.status(data.status).send(data.body);
  } catch (err) {
    res.status(502).json({ error: 'Upstream failed', detail: String(err) });
  }
};

