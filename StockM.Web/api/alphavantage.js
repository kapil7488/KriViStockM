const https = require('https');

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace(/^\/api\/alphavantage\//, '');
  const qs = url.search || '';
  const target = `https://www.alphavantage.co/${path}${qs}`;

  res.setHeader('Access-Control-Allow-Origin', '*');

  try {
    const data = await new Promise((resolve, reject) => {
      const parsed = new URL(target);
      const opts = { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' } };
      https.get(opts, (upstream) => {
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

