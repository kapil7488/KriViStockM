The API keys are configured in these locations:

Local development — create/edit a .env file:

.env (not committed to git)
VITE_AV_KEY=your_alpha_vantage_key
VITE_FINNHUB_KEY=your_finnhub_key

Vercel production — set environment variables in the Vercel dashboard or CLI:
vercel env add VITE_AV_KEY
vercel env add VITE_FINNHUB_KEY

GitHub Pages — set as repository variables:

GitHub repo → Settings → Secrets and variables → Actions → Variables
VITE_API_BASE
VITE_AV_KEY
VITE_FINNHUB_KEY
Where they're read in code:

App.tsx:21 — import.meta.env.VITE_AV_KEY, import.meta.env.VITE_FINNHUB_KEY
stockApi.ts:4 — import.meta.env.VITE_API_BASE
src/vite-env.d.ts — TypeScript type declarations
Where to get new keys:

Alpha Vantage: https://www.alphavantage.co/support/#api-key (free, 25 requests/day)
Finnhub: https://finnhub.io/register (free, 60 calls/min)
Yahoo Finance: No key needed — uses proxy with crumb/cookie auth automatically
