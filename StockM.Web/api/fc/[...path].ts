import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const path = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path || '';
  const url = `https://fc.yahoo.com/${path}`;

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: { 'User-Agent': 'Mozilla/5.0' },
      redirect: 'manual',
    });
    // Forward the Set-Cookie (A3 cookie needed for crumb flow)
    const setCookie = upstream.headers.get('set-cookie');
    if (setCookie) res.setHeader('Set-Cookie', setCookie);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    const data = await upstream.text();
    res.status(upstream.status).send(data);
  } catch (err) {
    res.status(502).json({ error: 'Upstream request failed', detail: String(err) });
  }
}
