import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const path = Array.isArray(req.query.path) ? req.query.path.join('/') : req.query.path || '';
  const qs = new URLSearchParams(req.query as Record<string, string>);
  qs.delete('path');
  const qsStr = qs.toString();
  const url = `https://www.alphavantage.co/${path}${qsStr ? '?' + qsStr : ''}`;

  try {
    const upstream = await fetch(url, {
      method: req.method,
      headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' },
    });
    const data = await upstream.text();
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.status(upstream.status).send(data);
  } catch (err) {
    res.status(502).json({ error: 'Upstream request failed', detail: String(err) });
  }
}
