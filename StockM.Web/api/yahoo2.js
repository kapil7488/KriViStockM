const https = require('https');

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace(/^\/api\/yahoo2\//, '');
  const qs = url.search || '';
  const target = `https://query2.finance.yahoo.com/${path}${qs}`;
  const headers = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };
  if (req.headers.cookie) headers['Cookie'] = req.headers.cookie;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  try {
    const data = await new Promise((resolve, reject) => {
      const parsed = new URL(target);
      const opts = { hostname: parsed.hostname, path: parsed.pathname + parsed.search, headers };
      https.get(opts, (upstream) => {
        const sc = upstream.headers['set-cookie'];
        if (sc) res.setHeader('Set-Cookie', sc);
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

