import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  const clientId = process.env.VITE_UPSTOX_CLIENT_ID || '';
  const clientSecret = process.env.UPSTOX_CLIENT_SECRET || '';
  const code = req.body?.code;

  if (!code || !clientId || !clientSecret) {
    res.status(400).json({ error: 'Missing code or Upstox credentials' });
    return;
  }

  const origin = req.headers.origin || req.headers.referer?.replace(/\/[^/]*$/, '') || 'https://your-app.vercel.app';
  const callbackUri = `${origin}/callback`;

  try {
    const tokenRes = await fetch('https://api.upstox.com/v2/login/authorization/token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: callbackUri,
        grant_type: 'authorization_code',
      }).toString(),
    });

    const data = await tokenRes.json();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(tokenRes.ok ? 200 : 400).json(data);
  } catch (err) {
    res.status(500).json({ error: 'Token exchange failed', detail: String(err) });
  }
}
