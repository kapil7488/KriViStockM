const https = require('https');

module.exports = async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname.replace(/^\/api\/fc\//, '').replace(/^\/api\/fc$/, '');
  const target = `https://fc.yahoo.com/${path}`;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Credentials', 'true');

  try {
    const data = await new Promise((resolve, reject) => {
      const parsed = new URL(target);
      const opts = {
        hostname: parsed.hostname,
        path: parsed.pathname + parsed.search,
        headers: { 'User-Agent': 'Mozilla/5.0' },
      };
      const r = https.get(opts, (upstream) => {
        // Don't follow redirects - we want the Set-Cookie from the 3xx response
        const sc = upstream.headers['set-cookie'];
        if (sc) res.setHeader('Set-Cookie', sc);
        let body = '';
        upstream.on('data', (chunk) => body += chunk);
        upstream.on('end', () => resolve({ status: upstream.statusCode, body }));
        upstream.on('error', reject);
      });
      r.on('error', reject);
    });
    res.status(data.status).send(data.body);
  } catch (err) {
    res.status(502).json({ error: 'Upstream failed', detail: String(err) });
  }
};

