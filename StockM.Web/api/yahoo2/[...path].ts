import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const path = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path || '';
  const qs = new URLSearchParams(req.query as Record<string, string>);
  qs.delete('path');
  const qsStr = qs.toString();
  const url = `https://query2.finance.yahoo.com/${path}${qsStr ? '?' + qsStr : ''}`;

  // Forward cookie header for crumb authentication
  const headers: Record<string, string> = {
    'User-Agent': 'Mozilla/5.0',
    Accept: 'application/json',
  };
  if (req.headers.cookie) {
    headers['Cookie'] = req.headers.cookie;
  }

  try {
    const upstream = await fetch(url, { method: req.method, headers });
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
