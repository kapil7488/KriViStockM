module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const clientId = process.env.VITE_UPSTOX_CLIENT_ID || '';
  const clientSecret = process.env.UPSTOX_CLIENT_SECRET || '';
  const code = req.body?.code;
  if (!code || !clientId || !clientSecret) return res.status(400).json({ error: 'Missing code or credentials' });
  const origin = req.headers.origin || req.headers.referer?.replace(/\/[^/]*$/, '') || '';
  try {
    const tokenRes = await fetch('https://api.upstox.com/v2/login/authorization/token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: `${origin}/callback`, grant_type: 'authorization_code' }).toString(),
    });
    const data = await tokenRes.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(tokenRes.ok ? 200 : 400).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Token exchange failed', detail: String(err) });
  }
}

