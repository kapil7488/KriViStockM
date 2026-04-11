const https = require('https');

// ── NIFTY 50 watchlist (Yahoo Finance tickers) ─────────────────
const WATCHLIST = [
  'RELIANCE.NS', 'TCS.NS', 'HDFCBANK.NS', 'INFY.NS', 'ICICIBANK.NS',
  'HINDUNILVR.NS', 'SBIN.NS', 'BHARTIARTL.NS', 'KOTAKBANK.NS', 'ITC.NS',
  'LT.NS', 'AXISBANK.NS', 'BAJFINANCE.NS', 'ASIANPAINT.NS', 'MARUTI.NS',
  'TITAN.NS', 'SUNPHARMA.NS', 'ULTRACEMCO.NS', 'NESTLEIND.NS', 'WIPRO.NS',
  'HCLTECH.NS', 'BAJAJFINSV.NS', 'POWERGRID.NS', 'NTPC.NS', 'ONGC.NS',
  'TATAMOTORS.NS', 'ADANIENT.NS', 'ADANIPORTS.NS', 'COALINDIA.NS', 'JSWSTEEL.NS',
  'TATASTEEL.NS', 'TECHM.NS', 'HDFCLIFE.NS', 'SBILIFE.NS', 'BAJAJ-AUTO.NS',
  'DIVISLAB.NS', 'DRREDDY.NS', 'BRITANNIA.NS', 'CIPLA.NS', 'EICHERMOT.NS',
  'INDUSINDBK.NS', 'HEROMOTOCO.NS', 'APOLLOHOSP.NS', 'TATACONSUM.NS', 'GRASIM.NS',
  'UPL.NS', 'BPCL.NS', 'HINDALCO.NS', 'M&M.NS', 'LTIM.NS',
];

const RESEND_API_KEY = process.env.RESEND_API_KEY || 're_i3bNU3bV_LAxWwitmeb59ZrRA6d8EmdDZ';
const ALERT_EMAILS = ['kapil7488@gmail.com', 'khushboopanwar.panwar@gmail.com', 'sairamskaps@gmail.com'];

// ── Helpers ────────────────────────────────────────────────────
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error('JSON parse failed')); }
      });
      res.on('error', reject);
    }).on('error', reject);
  });
}

function sma(closes, period) {
  if (closes.length < period) return null;
  let sum = 0;
  for (let i = closes.length - period; i < closes.length; i++) sum += closes[i];
  return sum / period;
}

// ── Detect SMA cross for a single stock ────────────────────────
async function checkSmaCross(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?interval=1d&range=2y`;
    const json = await fetchJSON(url);
    const result = json.chart?.result?.[0];
    if (!result) return null;

    const closes = result.indicators?.quote?.[0]?.close;
    if (!closes || closes.length < 201) return null;

    // Filter out nulls — keep only valid closes
    const validCloses = closes.filter((c) => c != null);
    if (validCloses.length < 201) return null;

    // Today's SMAs
    const sma50Today = sma(validCloses, 50);
    const sma200Today = sma(validCloses, 200);

    // Yesterday's SMAs (exclude last bar)
    const yesterday = validCloses.slice(0, -1);
    const sma50Yesterday = sma(yesterday, 50);
    const sma200Yesterday = sma(yesterday, 200);

    if (!sma50Today || !sma200Today || !sma50Yesterday || !sma200Yesterday) return null;

    const crossAboveToday = sma50Today > sma200Today;
    const crossAboveYesterday = sma50Yesterday > sma200Yesterday;

    if (crossAboveToday && !crossAboveYesterday) {
      return { ticker, type: 'Golden Cross', sma50: sma50Today.toFixed(2), sma200: sma200Today.toFixed(2), close: validCloses[validCloses.length - 1].toFixed(2) };
    }
    if (!crossAboveToday && crossAboveYesterday) {
      return { ticker, type: 'Death Cross', sma50: sma50Today.toFixed(2), sma200: sma200Today.toFixed(2), close: validCloses[validCloses.length - 1].toFixed(2) };
    }

    return null; // no cross
  } catch {
    return null; // skip on error
  }
}

// ── Send email via Resend ──────────────────────────────────────
function sendEmail(subject, htmlBody) {
  return new Promise((resolve, reject) => {
    const payload = JSON.stringify({
      from: 'StockM Alerts <onboarding@resend.dev>',
      to: ALERT_EMAILS,
      subject,
      html: htmlBody,
    });

    const options = {
      hostname: 'api.resend.com',
      path: '/emails',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => resolve({ status: res.statusCode, body }));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.write(payload);
    req.end();
  });
}

// ── Main handler (Vercel cron) ─────────────────────────────────
module.exports = async function handler(req, res) {
  // Security: only allow Vercel cron or manual trigger with secret
  const authHeader = req.headers['authorization'];
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  console.log(`[SMA Cross Alert] Checking ${WATCHLIST.length} stocks...`);

  // Check all stocks in parallel (batched to avoid rate limits)
  const BATCH_SIZE = 10;
  const crosses = [];

  for (let i = 0; i < WATCHLIST.length; i += BATCH_SIZE) {
    const batch = WATCHLIST.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map(checkSmaCross));
    for (const r of results) {
      if (r) crosses.push(r);
    }
  }

  if (crosses.length === 0) {
    console.log('[SMA Cross Alert] No crosses detected today.');
    return res.status(200).json({ message: 'No SMA crosses detected', checked: WATCHLIST.length });
  }

  // Build email
  const date = new Date().toISOString().split('T')[0];
  const subject = `🚨 SMA Cross Alert — ${crosses.length} signal${crosses.length > 1 ? 's' : ''} (${date})`;

  const rows = crosses.map((c) => {
    const emoji = c.type === 'Golden Cross' ? '🟢' : '🔴';
    const color = c.type === 'Golden Cross' ? '#00c853' : '#ff1744';
    return `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #333">${emoji} <strong>${c.ticker.replace('.NS', '')}</strong></td>
        <td style="padding:8px 12px;border-bottom:1px solid #333;color:${color};font-weight:bold">${c.type}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #333">₹${c.close}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #333">₹${c.sma50}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #333">₹${c.sma200}</td>
      </tr>`;
  }).join('');

  const html = `
    <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;background:#1a1a2e;color:#e0e0e0;padding:24px;border-radius:12px">
      <h2 style="color:#00d4ff;margin-top:0">📊 StockM — SMA Cross Alert</h2>
      <p style="color:#aaa">Date: ${date} | Stocks monitored: ${WATCHLIST.length}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <thead>
          <tr style="background:#16213e">
            <th style="padding:8px 12px;text-align:left;color:#00d4ff">Stock</th>
            <th style="padding:8px 12px;text-align:left;color:#00d4ff">Signal</th>
            <th style="padding:8px 12px;text-align:left;color:#00d4ff">Close</th>
            <th style="padding:8px 12px;text-align:left;color:#00d4ff">SMA 50</th>
            <th style="padding:8px 12px;text-align:left;color:#00d4ff">SMA 200</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="color:#888;font-size:12px;margin-top:16px">
        🟢 Golden Cross = SMA50 crosses above SMA200 (bullish)<br>
        🔴 Death Cross = SMA50 crosses below SMA200 (bearish)
      </p>
      <p style="color:#555;font-size:11px;margin-top:24px">Sent by StockM App • stockm-app.vercel.app</p>
    </div>`;

  const emailRes = await sendEmail(subject, html);
  console.log(`[SMA Cross Alert] Email sent: ${emailRes.status} — ${crosses.length} crosses`);

  return res.status(200).json({
    message: `Found ${crosses.length} SMA cross(es)`,
    crosses,
    emailStatus: emailRes.status,
    checked: WATCHLIST.length,
  });
};
