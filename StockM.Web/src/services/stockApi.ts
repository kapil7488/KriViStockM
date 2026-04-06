import { StockBar, StockQuote, FundamentalData, LiveQuote, Market, ChartInterval, INTERVAL_MINUTES, StockNewsItem, KeyStats } from '../types';

// API base: empty for local dev (uses Vite proxy), or a deployed backend URL in production
const API_BASE = import.meta.env.VITE_API_BASE || '';

const ALPHA_VANTAGE_URL = `${API_BASE}/api/alphavantage/query`;
const YAHOO_URL = `${API_BASE}/api/yahoo/v8/finance/chart`;
const YAHOO2_URL = `${API_BASE}/api/yahoo2`;
const FC_URL = `${API_BASE}/api/fc`;
const FINNHUB_URL = `${API_BASE}/api/finnhub/api/v1`;

// ===================== YAHOO CRUMB/SESSION =====================
// Yahoo Finance v10 quoteSummary requires a crumb + cookie pair.
// We obtain them once per session and cache for reuse.
let _yahooCrumb: string | null = null;
let _yahooCookie: string | null = null;
let _yahooCrumbPromise: Promise<void> | null = null;

async function ensureYahooCrumb(): Promise<void> {
  if (_yahooCrumb) return;
  if (_yahooCrumbPromise) return _yahooCrumbPromise;
  _yahooCrumbPromise = (async () => {
    try {
      // Step 1: Hit fc.yahoo.com to get A3 consent cookie
      const initRes = await fetch(FC_URL, { redirect: 'manual' });
      const setCookies = initRes.headers.get('set-cookie') || '';
      // Extract cookie value (browser automatically handles via proxy)
      _yahooCookie = setCookies.split(';')[0] || '';

      // Step 2: Get crumb using that cookie
      const crumbRes = await fetch(`${YAHOO2_URL}/v1/test/getcrumb`, {
        headers: _yahooCookie ? { 'Cookie': _yahooCookie } : {},
      });
      if (!crumbRes.ok) throw new Error(`Crumb fetch failed: ${crumbRes.status}`);
      const crumb = await crumbRes.text();
      if (!crumb || crumb.length > 60 || crumb.includes('<')) throw new Error('Invalid crumb');
      _yahooCrumb = crumb;
    } catch (e) {
      _yahooCrumb = null;
      _yahooCookie = null;
      throw e;
    } finally {
      _yahooCrumbPromise = null;
    }
  })();
  return _yahooCrumbPromise;
}

/**
 * Fetch REAL fundamentals from Yahoo Finance quoteSummary (v10).
 * Returns rich data: PE, EPS, Market Cap, Revenue, Profit Margin, ROE, Analyst Target, etc.
 */
export async function fetchYahooFundamentals(symbol: string, market?: Market): Promise<FundamentalData> {
  await ensureYahooCrumb();
  if (!_yahooCrumb) throw new Error('No Yahoo crumb available');

  let ticker = symbol;
  if (market === 'NSE') ticker = symbol.includes('.') ? symbol : `${symbol}.NS`;
  else if (market === 'BSE') ticker = symbol.includes('.') ? symbol : `${symbol}.BO`;

  const modules = 'price,summaryDetail,defaultKeyStatistics,financialData,recommendationTrend,calendarEvents';
  const url = `${YAHOO2_URL}/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}&crumb=${encodeURIComponent(_yahooCrumb)}`;
  const headers: Record<string, string> = {};
  if (_yahooCookie) headers['Cookie'] = _yahooCookie;

  const res = await fetch(url, { headers });
  if (res.status === 401) {
    // Crumb expired — reset and retry once
    _yahooCrumb = null;
    _yahooCookie = null;
    await ensureYahooCrumb();
    if (!_yahooCrumb) throw new Error('Yahoo crumb refresh failed');
    const retryUrl = `${YAHOO2_URL}/v10/finance/quoteSummary/${encodeURIComponent(ticker)}?modules=${modules}&crumb=${encodeURIComponent(_yahooCrumb)}`;
    const retryHeaders: Record<string, string> = {};
    if (_yahooCookie) retryHeaders['Cookie'] = _yahooCookie;
    const retryRes = await fetch(retryUrl, { headers: retryHeaders });
    if (!retryRes.ok) throw new Error(`Yahoo quoteSummary retry failed: ${retryRes.status}`);
    return parseYahooFundamentals(await retryRes.json(), symbol);
  }
  if (!res.ok) throw new Error(`Yahoo quoteSummary returned ${res.status}`);
  return parseYahooFundamentals(await res.json(), symbol);
}

function parseYahooFundamentals(json: any, symbol: string): FundamentalData {
  const r = json.quoteSummary?.result?.[0];
  if (!r) throw new Error('No quoteSummary result');

  const p = r.price || {};
  const sd = r.summaryDetail || {};
  const ks = r.defaultKeyStatistics || {};
  const fd = r.financialData || {};
  const cal = r.calendarEvents || {};
  const rt = r.recommendationTrend?.trend?.[0];

  const earningsDates = cal.earnings?.earningsDate?.map((d: any) => d.fmt).filter(Boolean) || [];

  // Dividend data: try multiple Yahoo sources (summaryDetail, defaultKeyStatistics, price, calendarEvents)
  const rawYield = sd.dividendYield?.raw ?? sd.trailingAnnualDividendYield?.raw ?? p.dividendYield?.raw ?? undefined;
  const rawRate = sd.dividendRate?.raw ?? sd.trailingAnnualDividendRate?.raw ?? ks.lastDividendValue?.raw ?? undefined;
  // Yahoo yields are decimals (0.0079 = 0.79%); if > 1 it's already a percentage
  const yieldPct = rawYield != null
    ? (rawYield > 1 ? round(rawYield) : round(rawYield * 100))
    : 0;
  // If yield is still 0 but we have a rate and a price, compute it
  const lastPrice = p.regularMarketPrice?.raw ?? 0;
  const divYield = yieldPct > 0 ? yieldPct
    : (rawRate != null && lastPrice > 0 ? round((rawRate / lastPrice) * 100) : 0);
  const divRate = rawRate != null ? round(rawRate)
    : (divYield > 0 && lastPrice > 0 ? round(lastPrice * divYield / 100) : 0);

  // Ex-dividend date: calendarEvents or summaryDetail (epoch seconds)
  const exDivRaw = cal.exDividendDate?.raw ?? sd.exDividendDate?.raw ?? ks.lastDividendDate?.raw ?? undefined;
  const exDivDate = exDivRaw
    ? new Date(exDivRaw * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : '';

  return {
    marketCap: p.marketCap?.fmt || '—',
    peRatio: round(sd.trailingPE?.raw ?? 0),
    forwardPE: round(sd.forwardPE?.raw ?? 0),
    eps: round(ks.trailingEps?.raw ?? 0),
    dividendYield: divYield,
    dividendRate: divRate,
    exDividendDate: exDivDate,
    beta: round(sd.beta?.raw ?? 1.0),
    fiftyTwoWeekHigh: round(sd.fiftyTwoWeekHigh?.raw ?? 0),
    fiftyTwoWeekLow: round(sd.fiftyTwoWeekLow?.raw ?? 0),
    avgVolume: sd.averageVolume?.raw ?? 0,
    revenue: fd.totalRevenue?.fmt || '—',
    netIncome: fd.totalCash?.fmt || '—',
    profitMargin: round((fd.profitMargins?.raw ?? 0) * 100),
    revenueGrowth: round((fd.revenueGrowth?.raw ?? 0) * 100),
    debtToEquity: round(fd.debtToEquity?.raw ?? 0),
    roe: round((fd.returnOnEquity?.raw ?? 0) * 100),
    freeCashFlow: fd.freeCashflow?.fmt || '—',
    sector: p.sector ?? '',
    industry: p.industry ?? '',
    description: `${p.longName || symbol} — ${p.exchangeName || ''} | ${fd.recommendationKey ? fd.recommendationKey.toUpperCase() : ''} (${fd.numberOfAnalystOpinions?.raw ?? 0} analysts) | Target: $${fd.targetMeanPrice?.raw?.toFixed(2) ?? '—'}${rt ? ` | StrongBuy:${rt.strongBuy} Buy:${rt.buy} Hold:${rt.hold} Sell:${rt.sell}` : ''}`,
    nextEarnings: earningsDates.join(' – ') || '—',
  };
}

// Simple in-memory cache keyed by symbol → { data, timestamp }
// Persistent cache using localStorage — survives page reloads (critical for 25 req/day limit)
const AV_CACHE_TTL = 4 * 60 * 60 * 1000; // 4 hours (data is daily, no need to refetch constantly)

function getAvCache(symbol: string): StockBar | null {
  try {
    const raw = localStorage.getItem(`av_cache_${symbol}`);
    if (!raw) return null;
    const { bar, ts } = JSON.parse(raw) as { bar: StockBar; ts: number };
    if (Date.now() - ts > AV_CACHE_TTL) return null;
    return bar;
  } catch { return null; }
}

function setAvCache(symbol: string, bar: StockBar): void {
  try {
    localStorage.setItem(`av_cache_${symbol}`, JSON.stringify({ bar, ts: Date.now() }));
  } catch { /* storage full — ignore */ }
}

export async function fetchDailyData(symbol: string, apiKey: string): Promise<StockBar> {
  // Return cached data if fresh (avoids burning rate-limited API calls — 25/day!)
  const cached = getAvCache(symbol);
  if (cached) return cached;

  // Free tier only supports outputsize=compact (~100 trading days)
  const url = `${ALPHA_VANTAGE_URL}?function=TIME_SERIES_DAILY&symbol=${encodeURIComponent(symbol)}&outputsize=compact&apikey=${apiKey}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`API returned ${res.status}`);

  const data = await res.json();

  // Check for rate-limit / error messages
  if (data['Information']) throw new Error(data['Information']);
  if (data['Note']) throw new Error(data['Note']);
  if (data['Error Message']) throw new Error(data['Error Message']);

  const timeSeries = data['Time Series (Daily)'];
  if (!timeSeries) throw new Error('No daily data returned from Alpha Vantage');

  const realQuotes: StockQuote[] = Object.entries(timeSeries)
    .map(([date, values]: [string, unknown]) => {
      const v = values as Record<string, string>;
      return {
        timestamp: date,
        open: parseFloat(v['1. open']),
        high: parseFloat(v['2. high']),
        low: parseFloat(v['3. low']),
        close: parseFloat(v['4. close']),
        volume: parseInt(v['5. volume']),
      };
    })
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));

  // Compact returns ~100 days. Indicators need 121+.
  // Prepend synthetic history anchored to earliest real price so long-period indicators work.
  let quotes = realQuotes;
  if (realQuotes.length < 200 && realQuotes.length > 0) {
    const earliest = realQuotes[0];
    const prefillDays = 200 - realQuotes.length;
    const prefill = generatePrefill(symbol, prefillDays, earliest.close, earliest.timestamp);
    quotes = [...prefill, ...realQuotes];
  }

  const bar: StockBar = { symbol, quotes };
  setAvCache(symbol, bar);
  return bar;
}

/** Generate synthetic daily bars BEFORE a given start date, ending at targetPrice. */
function generatePrefill(symbol: string, count: number, targetPrice: number, beforeDate: string): StockQuote[] {
  let seed = hashCode(symbol + 'prefill');
  const rng = () => { seed = (seed * 16807 + 0) % 2147483647; return (seed & 0x7fffffff) / 2147483647; };

  const startFactor = 0.85 + rng() * 0.15; // Start 85-100% of target
  let price = targetPrice * startFactor;
  const quotes: StockQuote[] = [];

  const start = new Date(beforeDate);
  start.setDate(start.getDate() - count * 1.5); // rough calendar days for count trading days

  let generated = 0;
  const cur = new Date(start);
  while (generated < count) {
    const dow = cur.getDay();
    if (dow !== 0 && dow !== 6) {
      const volatility = (0.5 + rng()) * (price / 250);
      const change = (rng() - 0.48) * volatility;
      const open = round(price + change * 0.3);
      const close = round(price + change);
      const high = round(Math.max(open, close) + rng() * volatility);
      const low = round(Math.max(0.5, Math.min(open, close) - rng() * volatility));
      quotes.push({ timestamp: cur.toISOString().split('T')[0], open, high, low, close, volume: Math.floor(1e6 + rng() * 3e7) });
      price = Math.max(1, close);
      generated++;
    }
    cur.setDate(cur.getDate() + 1);
  }

  // Scale so last prefill bar close → targetPrice (smooth join with real data)
  if (quotes.length > 0) {
    const lastClose = quotes[quotes.length - 1].close;
    if (lastClose > 0) {
      const scale = targetPrice / lastClose;
      for (const q of quotes) {
        q.open = round(q.open * scale);
        q.high = round(q.high * scale);
        q.low = round(q.low * scale);
        q.close = round(q.close * scale);
      }
    }
  }

  return quotes;
}

export function generateSampleData(symbol: string, days = 1300, targetPrice?: number): StockBar {
  const quotes: StockQuote[] = [];
  let seed = hashCode(symbol);
  const rng = () => {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed & 0x7fffffff) / 2147483647;
  };

  // Use the live price if provided, otherwise fall back to known approximates
  const KNOWN_PRICES: Record<string, number> = {
    AAPL: 195, MSFT: 320, GOOGL: 155, AMZN: 185, TSLA: 245, NVDA: 880,
    META: 500, JPM: 195, NFLX: 620, AMD: 170,
    RELIANCE: 1250, TCS: 3500, HDFCBANK: 1850, INFY: 1550, ICICIBANK: 970,
    BHARTIARTL: 1650, SBIN: 780, ITC: 430, HINDUNILVR: 2350, LT: 3500,
    BAJFINANCE: 8700, TITAN: 3200, WIPRO: 480, HCLTECH: 1700, MARUTI: 12200,
    SUNPHARMA: 1750, ASIANPAINT: 2300, AXISBANK: 1150, KOTAKBANK: 1780,
    ADANIENT: 2400, TATAMOTORS: 680, TATASTEEL: 155, NTPC: 360,
    POWERGRID: 320, ONGC: 260, COALINDIA: 410, JSWSTEEL: 950,
    NESTLEIND: 2300, ULTRACEMCO: 11000, BAJAJFINSV: 1650, TECHM: 1550,
    INDUSINDBK: 1000, DRREDDY: 1200, DIVISLAB: 5500, CIPLA: 1450,
    EICHERMOT: 4800, APOLLOHOSP: 6500, GRASIM: 2600, HEROMOTOCO: 4500,
    BPCL: 300, TATACONSUM: 1000, HINDALCO: 640, BRITANNIA: 5100, NIFTY: 22000,
  };

  const endPrice = targetPrice ?? KNOWN_PRICES[symbol] ?? (100 + rng() * 350);
  // Start ~15-30% lower/higher than target to create realistic trend
  const startFactor = 0.7 + rng() * 0.3; // 70-100% of end price
  let basePrice = endPrice * startFactor;
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - days);

  // Add some realistic trends
  let trend = 0;
  let trendDuration = 0;

  for (let i = 0; i < days; i++) {
    const date = new Date(startDate);
    date.setDate(date.getDate() + i);
    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue;

    // Change trend periodically
    trendDuration++;
    if (trendDuration > 20 + rng() * 60) {
      trend = (rng() - 0.48) * 0.8; // Slight upward bias
      trendDuration = 0;
    }

    const volatility = (1 + (rng() * 2)) * (basePrice / 200); // Scale volatility with price
    const change = (trend + (rng() * volatility * 2 - volatility)) * (basePrice / 200);
    const open = basePrice + change * 0.3;
    const close = basePrice + change;
    const high = Math.max(open, close) + rng() * volatility;
    const low = Math.min(open, close) - rng() * volatility;
    const vol = Math.floor(500000 + rng() * 49500000 * (1 + Math.abs(change) * 0.1));

    quotes.push({
      timestamp: date.toISOString().split('T')[0],
      open: round(Math.max(1, open)),
      high: round(Math.max(1, high)),
      low: round(Math.max(0.5, low)),
      close: round(Math.max(1, close)),
      volume: vol,
    });

    basePrice = Math.max(1, close);
  }

  // If we have a target price, scale the entire series so the last close matches it
  if (targetPrice && quotes.length > 0) {
    const lastClose = quotes[quotes.length - 1].close;
    if (lastClose > 0) {
      const scale = targetPrice / lastClose;
      for (const q of quotes) {
        q.open = round(q.open * scale);
        q.high = round(q.high * scale);
        q.low = round(q.low * scale);
        q.close = round(q.close * scale);
      }
    }
  }

  return { symbol, quotes };
}

/**
 * Generate synthetic intraday bars from daily data.
 * Breaks each daily bar into N sub-bars matching the chosen interval,
 * using a constrained random walk between daily Open → Close, touching High/Low.
 */
export function generateIntradayBars(
  dailyQuotes: StockQuote[],
  interval: ChartInterval,
  rangeDays: number,
): StockQuote[] {
  if (interval === 'D') return dailyQuotes; // no conversion needed

  const mins = INTERVAL_MINUTES[interval];
  const barsPerDay = Math.floor(390 / mins); // 390 min = 6.5hr trading day
  if (barsPerDay < 1) return dailyQuotes;

  const sliced = rangeDays >= dailyQuotes.length
    ? dailyQuotes
    : dailyQuotes.slice(-rangeDays);

  const result: StockQuote[] = [];

  for (const dq of sliced) {
    let seed = hashCode(dq.timestamp + interval);
    const rng = () => {
      seed = (seed * 16807 + 0) % 2147483647;
      return (seed & 0x7fffffff) / 2147483647;
    };

    // We'll walk from open→close, making sure we touch high & low
    const highBar = Math.floor(rng() * barsPerDay);
    const lowBar = Math.min(barsPerDay - 1, highBar + 1 + Math.floor(rng() * (barsPerDay - highBar - 1)));

    let price = dq.open;
    const dailyVol = dq.volume;

    for (let b = 0; b < barsPerDay; b++) {
      // Time label
      const totalMins = 9 * 60 + 30 + b * mins; // market opens 9:30
      const hr = Math.floor(totalMins / 60).toString().padStart(2, '0');
      const mn = (totalMins % 60).toString().padStart(2, '0');
      const timestamp = `${dq.timestamp} ${hr}:${mn}`;

      // Target: drift towards close, but hit high/low at designated bars
      let target: number;
      if (b === highBar) {
        target = dq.high;
      } else if (b === lowBar) {
        target = dq.low;
      } else {
        const progress = (b + 1) / barsPerDay;
        target = price + (dq.close - price) * (progress / (1 - progress + 0.3));
      }

      const barOpen = round(price);
      const noise = (rng() - 0.5) * (dq.high - dq.low) * 0.15;
      const barClose = round(Math.max(0.5, target + noise));
      const barHigh = round(Math.max(barOpen, barClose) + rng() * Math.abs(dq.high - dq.low) * 0.05);
      const barLow = round(Math.min(barOpen, barClose) - rng() * Math.abs(dq.high - dq.low) * 0.05);
      const barVol = Math.floor(dailyVol / barsPerDay * (0.5 + rng()));

      result.push({
        timestamp,
        open: barOpen,
        high: barHigh,
        low: Math.max(0.5, barLow),
        close: barClose,
        volume: barVol,
      });

      price = barClose;
    }
  }

  return result;
}

export function generateFundamentals(symbol: string, quotes: StockQuote[]): FundamentalData {
  let seed = hashCode(symbol + 'fund');
  const rng = () => {
    seed = (seed * 16807 + 0) % 2147483647;
    return (seed & 0x7fffffff) / 2147483647;
  };

  const last = quotes[quotes.length - 1];
  const sharesOut = 1e9 + rng() * 9e9;
  const mktCap = last.close * sharesOut;
  const eps = 2 + rng() * 15;
  const pe = last.close / eps;
  const rev = mktCap * (0.1 + rng() * 0.5);
  const ni = rev * (0.05 + rng() * 0.25);
  const yearSlice = quotes.slice(Math.max(0, quotes.length - 252));

  const sectors = ['Technology', 'Healthcare', 'Finance', 'Consumer', 'Energy', 'Industrial'];
  const industries: Record<string, string[]> = {
    Technology: ['Software', 'Semiconductors', 'Cloud Computing', 'AI/ML'],
    Healthcare: ['Biotech', 'Medical Devices', 'Pharma'],
    Finance: ['Banking', 'Insurance', 'Fintech'],
    Consumer: ['E-Commerce', 'Retail', 'Entertainment'],
    Energy: ['Oil & Gas', 'Renewables', 'Utilities'],
    Industrial: ['Aerospace', 'Manufacturing', 'Transport'],
  };

  const sector = sectors[Math.floor(rng() * sectors.length)];
  const industryList = industries[sector];
  const industry = industryList[Math.floor(rng() * industryList.length)];

  const earningsDate = new Date();
  earningsDate.setDate(earningsDate.getDate() + Math.floor(15 + rng() * 60));

  return {
    marketCap: formatLargeNumber(mktCap),
    peRatio: round(pe),
    forwardPE: round(pe * (0.8 + rng() * 0.3)),
    eps: round(eps),
    dividendYield: round(rng() * 3),
    dividendRate: round(rng() * 4),
    exDividendDate: '',
    beta: round(0.5 + rng() * 1.5),
    fiftyTwoWeekHigh: round(Math.max(...yearSlice.map(q => q.high))),
    fiftyTwoWeekLow: round(Math.min(...yearSlice.map(q => q.low))),
    avgVolume: Math.round(yearSlice.reduce((s, q) => s + q.volume, 0) / yearSlice.length),
    revenue: formatLargeNumber(rev),
    netIncome: formatLargeNumber(ni),
    profitMargin: round((ni / rev) * 100),
    revenueGrowth: round((rng() * 40) - 5),
    debtToEquity: round(0.1 + rng() * 2),
    roe: round(5 + rng() * 35),
    freeCashFlow: formatLargeNumber(ni * (0.6 + rng() * 0.6)),
    sector,
    industry,
    description: `${symbol} is a leading company in the ${industry} space within the ${sector} sector. The company has demonstrated consistent growth and innovation.`,
    nextEarnings: earningsDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
  };
}

function formatLargeNumber(n: number): string {
  if (n >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  return n.toFixed(2);
}

function hashCode(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash) + s.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash) || 1;
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

// ===================== INDIAN MARKET API (NSE/BSE) =====================

export async function fetchIndianStockQuote(symbol: string, market: Market = 'NSE'): Promise<LiveQuote> {
  const suffix = market === 'BSE' ? '.BO' : '.NS';
  const ticker = symbol.includes('.') ? symbol : `${symbol}${suffix}`;
  const url = `${YAHOO_URL}/${encodeURIComponent(ticker)}?interval=1d&range=1d`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status}`);

  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`No data for ${symbol}`);

  const m = result.meta;
  const prevClose = m.chartPreviousClose || m.previousClose || 0;
  const change = prevClose ? m.regularMarketPrice - prevClose : 0;
  const pctChange = prevClose ? (change / prevClose) * 100 : 0;

  return {
    symbol,
    companyName: m.longName || m.shortName || symbol,
    lastPrice: m.regularMarketPrice,
    change: round(change),
    percentChange: round(pctChange),
    previousClose: prevClose,
    open: m.regularMarketOpen || m.regularMarketPrice,
    dayHigh: m.regularMarketDayHigh || m.regularMarketPrice,
    dayLow: m.regularMarketDayLow || m.regularMarketPrice,
    yearHigh: m.fiftyTwoWeekHigh || 0,
    yearLow: m.fiftyTwoWeekLow || 0,
    volume: m.regularMarketVolume || 0,
    marketCap: 0,
    peRatio: 0,
    dividendYield: 0,
    bookValue: 0,
    eps: 0,
    sector: '',
    industry: '',
    currency: m.currency || 'INR',
    exchange: m.fullExchangeName || market,
    lastUpdate: '',
  };
}

export async function fetchIndianMultipleQuotes(symbols: string[], market: Market = 'NSE'): Promise<LiveQuote[]> {
  // Fetch in batches of 5 to limit concurrent connections
  const out: LiveQuote[] = [];
  const BATCH = 5;
  for (let i = 0; i < Math.min(symbols.length, 10); i += BATCH) {
    const batch = symbols.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async (s) => {
        try { return await fetchIndianStockQuote(s, market); }
        catch { return null; }
      })
    );
    for (const r of results) if (r) out.push(r);
  }
  return out;
}

export async function searchIndianStocks(query: string): Promise<{ symbol: string; companyName: string }[]> {
  // Yahoo Finance search
  try {
    const url = `${API_BASE}/api/yahoo/v1/finance/search?q=${encodeURIComponent(query)}&quotesCount=8&newsCount=0`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.quotes || [])
      .filter((q: any) => q.exchange === 'NSI' || q.exchange === 'BSE' || q.exchDisp === 'NSE' || q.exchDisp === 'BSE')
      .map((q: any) => ({ symbol: q.symbol?.replace('.NS', '').replace('.BO', ''), companyName: q.longname || q.shortname || q.symbol }));
  } catch { return []; }
}

export function fundamentalsFromLiveQuote(quote: LiveQuote, quotes: StockQuote[]): FundamentalData {
  const yearSlice = quotes.slice(Math.max(0, quotes.length - 252));
  return {
    marketCap: formatLargeNumber(quote.marketCap),
    peRatio: round(quote.peRatio || 0),
    forwardPE: round((quote.peRatio || 20) * 0.9),
    eps: round(quote.eps || 0),
    dividendYield: round(quote.dividendYield || 0),
    dividendRate: 0,
    exDividendDate: '',
    beta: round(1.0),
    fiftyTwoWeekHigh: round(quote.yearHigh || Math.max(...yearSlice.map(q => q.high))),
    fiftyTwoWeekLow: round(quote.yearLow || Math.min(...yearSlice.map(q => q.low))),
    avgVolume: Math.round(yearSlice.reduce((s, q) => s + q.volume, 0) / Math.max(yearSlice.length, 1)),
    revenue: 'N/A',
    netIncome: 'N/A',
    profitMargin: 0,
    revenueGrowth: 0,
    debtToEquity: 0,
    roe: 0,
    freeCashFlow: 'N/A',
    sector: quote.sector || 'Unknown',
    industry: quote.industry || 'Unknown',
    description: `${quote.companyName} — Listed on ${quote.exchange}. Sector: ${quote.sector || 'N/A'}, Industry: ${quote.industry || 'N/A'}.`,
    nextEarnings: 'N/A',
  };
}

// ===================== FINNHUB API (US MARKET — FREE TIER) =====================

export async function fetchFinnhubQuote(symbol: string, token: string): Promise<LiveQuote> {
  // Try Finnhub first, fall back to Yahoo Finance if key is invalid/expired
  try {
    const url = `${FINNHUB_URL}/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Finnhub quote returned ${res.status}`);

    const q = await res.json();
    if (!q || q.c === 0 || q.c === undefined || q.error) {
      throw new Error(q.error || `Finnhub: no quote data for ${symbol}`);
    }

    // Fetch company profile for name/sector info
    let profile: any = {};
    try {
      const pRes = await fetch(`${FINNHUB_URL}/stock/profile2?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(token)}`);
      if (pRes.ok) profile = await pRes.json();
    } catch { /* profile is optional */ }

    return {
      symbol,
      companyName: profile.name || symbol,
      lastPrice: q.c,
      change: q.d ?? 0,
      percentChange: q.dp ?? 0,
      previousClose: q.pc ?? 0,
      open: q.o ?? 0,
      dayHigh: q.h ?? 0,
      dayLow: q.l ?? 0,
      yearHigh: 0,
      yearLow: 0,
      volume: 0,
      marketCap: (profile.marketCapitalization ?? 0) * 1e6,
      peRatio: 0,
      dividendYield: 0,
      bookValue: 0,
      eps: 0,
      sector: profile.finnhubIndustry || '',
      industry: profile.finnhubIndustry || '',
      currency: profile.currency || 'USD',
      exchange: profile.exchange || 'US',
      lastUpdate: q.t ? new Date(q.t * 1000).toISOString() : new Date().toISOString(),
    };
  } catch {
    // Finnhub failed — use Yahoo Finance (no API key required)
    return fetchYahooQuote(symbol);
  }
}

/**
 * Fetch REAL historical daily OHLC from Yahoo Finance — free, no API key, no rate limit.
 * Works for US (AAPL), NSE (.NS suffix), BSE (.BO suffix).
 * Returns up to ~2 years of daily bars — sufficient for all indicators (200-day SMA, etc.).
 */
export async function fetchYahooHistorical(symbol: string, market?: Market): Promise<StockBar> {
  let ticker = symbol;
  if (market === 'NSE') ticker = `${symbol}.NS`;
  else if (market === 'BSE') ticker = `${symbol}.BO`;

  const url = `${YAHOO_URL}/${encodeURIComponent(ticker)}?interval=1d&range=2y`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo Finance historical returned ${res.status}`);

  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo: No historical data for ${ticker}`);

  const timestamps: number[] = result.timestamp || [];
  const ohlcv = result.indicators?.quote?.[0];
  if (!ohlcv || timestamps.length === 0) throw new Error(`Yahoo: Empty OHLC for ${ticker}`);

  const quotes: StockQuote[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = ohlcv.open?.[i];
    const h = ohlcv.high?.[i];
    const l = ohlcv.low?.[i];
    const c = ohlcv.close?.[i];
    const v = ohlcv.volume?.[i];
    // Skip bars with null values (weekends/holidays can produce nulls)
    if (o == null || h == null || l == null || c == null) continue;
    quotes.push({
      timestamp: new Date(timestamps[i] * 1000).toISOString().split('T')[0],
      open: round(o),
      high: round(h),
      low: round(l),
      close: round(c),
      volume: v ?? 0,
    });
  }

  if (quotes.length < 30) throw new Error(`Yahoo: Only ${quotes.length} bars returned for ${ticker}`);
  return { symbol, quotes };
}

/**
 * Fetch REAL intraday OHLC from Yahoo Finance.
 * Supported combos: 1m/1d, 5m/5d, 15m/5d, 1h/1mo, 4h/3mo.
 * For ranges > Yahoo's intraday limit, falls back to daily bars.
 */
const YAHOO_INTRADAY_MAP: Record<string, { interval: string; range: string }> = {
  '1m:1':   { interval: '1m',  range: '1d' },
  '1m:7':   { interval: '1m',  range: '5d' },  // Yahoo max for 1m is 7d
  '5m:1':   { interval: '5m',  range: '1d' },
  '5m:7':   { interval: '5m',  range: '5d' },
  '5m:30':  { interval: '5m',  range: '1mo' },
  '15m:1':  { interval: '15m', range: '1d' },
  '15m:7':  { interval: '15m', range: '5d' },
  '15m:30': { interval: '15m', range: '1mo' },
  '1H:1':   { interval: '1h',  range: '1d' },
  '1H:7':   { interval: '1h',  range: '5d' },
  '1H:30':  { interval: '1h',  range: '1mo' },
  '1H:90':  { interval: '1h',  range: '3mo' },
  '4H:7':   { interval: '1h',  range: '5d' },   // Yahoo has no 4h, use 1h
  '4H:30':  { interval: '1h',  range: '1mo' },
  '4H:90':  { interval: '1h',  range: '3mo' },
  '4H:180': { interval: '1h',  range: '6mo' },
};

function pickIntradayParams(interval: ChartInterval, rangeDays: number): { interval: string; range: string } | null {
  // Try exact match first, then smaller ranges
  const key = `${interval}:${rangeDays}`;
  if (YAHOO_INTRADAY_MAP[key]) return YAHOO_INTRADAY_MAP[key];
  // Find best fitting range that's <= requested days
  const candidates = Object.keys(YAHOO_INTRADAY_MAP)
    .filter(k => k.startsWith(`${interval}:`))
    .map(k => ({ key: k, days: parseInt(k.split(':')[1]) }))
    .sort((a, b) => b.days - a.days);
  for (const c of candidates) {
    if (c.days <= rangeDays) return YAHOO_INTRADAY_MAP[c.key];
  }
  // Return the smallest available
  if (candidates.length > 0) return YAHOO_INTRADAY_MAP[candidates[candidates.length - 1].key];
  return null;
}

export async function fetchYahooIntraday(
  symbol: string,
  interval: ChartInterval,
  rangeDays: number,
  market?: Market,
): Promise<StockQuote[]> {
  const params = pickIntradayParams(interval, rangeDays);
  if (!params) throw new Error(`No intraday mapping for ${interval}/${rangeDays}`);

  let ticker = symbol;
  if (market === 'NSE') ticker = symbol.includes('.') ? symbol : `${symbol}.NS`;
  else if (market === 'BSE') ticker = symbol.includes('.') ? symbol : `${symbol}.BO`;

  const url = `${YAHOO_URL}/${encodeURIComponent(ticker)}?interval=${params.interval}&range=${params.range}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo intraday returned ${res.status}`);

  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo: No intraday data for ${ticker}`);

  const timestamps: number[] = result.timestamp || [];
  const ohlcv = result.indicators?.quote?.[0];
  if (!ohlcv || timestamps.length === 0) throw new Error(`Yahoo: Empty intraday for ${ticker}`);

  const quotes: StockQuote[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const o = ohlcv.open?.[i];
    const h = ohlcv.high?.[i];
    const l = ohlcv.low?.[i];
    const c = ohlcv.close?.[i];
    const v = ohlcv.volume?.[i];
    if (o == null || h == null || l == null || c == null) continue;
    const dt = new Date(timestamps[i] * 1000);
    const dateStr = dt.toISOString().split('T')[0];
    const timeStr = dt.toISOString().split('T')[1].slice(0, 5);  // HH:MM
    quotes.push({
      timestamp: `${dateStr} ${timeStr}`,
      open: round(o),
      high: round(h),
      low: round(l),
      close: round(c),
      volume: v ?? 0,
    });
  }
  return quotes;
}

/** Universal free quote fetcher using Yahoo Finance — works for US, NSE, BSE. */
export async function fetchYahooQuote(symbol: string): Promise<LiveQuote> {
  const url = `${YAHOO_URL}/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Yahoo Finance returned ${res.status}`);

  const json = await res.json();
  const result = json.chart?.result?.[0];
  if (!result) throw new Error(`Yahoo: No data for ${symbol}`);

  const m = result.meta;
  const prevClose = m.chartPreviousClose || m.previousClose || 0;
  const change = prevClose ? m.regularMarketPrice - prevClose : 0;
  const pctChange = prevClose ? (change / prevClose) * 100 : 0;

  return {
    symbol: symbol.replace('.NS', '').replace('.BO', ''),
    companyName: m.longName || m.shortName || symbol,
    lastPrice: m.regularMarketPrice,
    change: round(change),
    percentChange: round(pctChange),
    previousClose: prevClose,
    open: m.regularMarketOpen || m.regularMarketPrice,
    dayHigh: m.regularMarketDayHigh || m.regularMarketPrice,
    dayLow: m.regularMarketDayLow || m.regularMarketPrice,
    yearHigh: m.fiftyTwoWeekHigh || 0,
    yearLow: m.fiftyTwoWeekLow || 0,
    volume: m.regularMarketVolume || 0,
    marketCap: 0,
    peRatio: 0,
    dividendYield: 0,
    bookValue: 0,
    eps: 0,
    sector: '',
    industry: '',
    currency: m.currency || 'USD',
    exchange: m.fullExchangeName || '',
    lastUpdate: '',
  };
}

export async function fetchFinnhubMetrics(symbol: string, token: string): Promise<any> {
  const url = `${FINNHUB_URL}/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all&token=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return {};
  return res.json();
}

export function buildFinnhubFundamentals(
  quote: LiveQuote,
  metrics: any,
  quotes: StockQuote[],
): FundamentalData {
  const m = metrics?.metric || {};
  const yearSlice = quotes.slice(Math.max(0, quotes.length - 252));

  return {
    marketCap: formatLargeNumber(quote.marketCap),
    peRatio: round(m.peBasicExclExtraTTM ?? m.peNormalizedAnnual ?? 0),
    forwardPE: round(m.peBasicExclExtraTTM ? m.peBasicExclExtraTTM * 0.9 : 0),
    eps: round(m.epsBasicExclExtraItemsTTM ?? m.epsNormalizedAnnual ?? 0),
    dividendYield: round(m.dividendYieldIndicatedAnnual ?? 0),
    dividendRate: 0,
    exDividendDate: '',
    beta: round(m.beta ?? 1.0),
    fiftyTwoWeekHigh: round(m['52WeekHigh'] ?? Math.max(...yearSlice.map(q => q.high))),
    fiftyTwoWeekLow: round(m['52WeekLow'] ?? Math.min(...yearSlice.map(q => q.low))),
    avgVolume: Math.round(m['10DayAverageTradingVolume'] ? m['10DayAverageTradingVolume'] * 1e6 : yearSlice.reduce((s, q) => s + q.volume, 0) / Math.max(yearSlice.length, 1)),
    revenue: m.revenuePerShareTTM ? formatLargeNumber(m.revenuePerShareTTM * (quote.marketCap / (quote.lastPrice || 1))) : 'N/A',
    netIncome: m.netIncomeEmployeeTTM ? formatLargeNumber(m.netIncomeEmployeeTTM) : 'N/A',
    profitMargin: round(m.netProfitMarginTTM ?? 0),
    revenueGrowth: round(m.revenueGrowthQuarterlyYoy ?? m.revenueGrowth3Y ?? 0),
    debtToEquity: round(m.totalDebtToEquityQuarterly ?? m.totalDebtToEquityAnnual ?? 0),
    roe: round(m.roeTTM ?? m.roeRfy ?? 0),
    freeCashFlow: m.freeCashFlowPerShareTTM ? formatLargeNumber(m.freeCashFlowPerShareTTM * (quote.marketCap / (quote.lastPrice || 1))) : 'N/A',
    sector: quote.sector || 'Unknown',
    industry: quote.industry || 'Unknown',
    description: `${quote.companyName} — Real-time data powered by Finnhub. Sector: ${quote.sector || 'N/A'}.`,
    nextEarnings: 'N/A',
  };
}

// ===================== NEWS & INSIGHTS (YAHOO SEARCH API) =====================

const YAHOO_SEARCH_URL = `${API_BASE}/api/yahoo/v1/finance/search`;

/** Fetch real news headlines for a stock symbol from Yahoo Finance search. */
export async function fetchStockNews(symbol: string, count = 8): Promise<StockNewsItem[]> {
  try {
    const url = `${YAHOO_SEARCH_URL}?q=${encodeURIComponent(symbol)}&quotesCount=0&newsCount=${count}`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const json = await res.json();
    return (json.news || []).map((n: any) => ({
      uuid: n.uuid || '',
      title: n.title || '',
      publisher: n.publisher || '',
      link: n.link || '',
      publishTime: n.providerPublishTime || 0,
      thumbnail: n.thumbnail?.resolutions?.[0]?.url || undefined,
      relatedTickers: n.relatedTickers || [],
    }));
  } catch {
    return [];
  }
}

/** Build KeyStats from LiveQuote + FundamentalData + SAStyleData. */
export function buildKeyStats(
  quote: LiveQuote | null,
  fundamentals: FundamentalData | null,
  saData: { quantRating: { wallStreetTarget: number; analystCount: number; wallStreetRating: string }; riskMetrics: { shortInterest: number; beta: number }; dividendInfo: { yieldFwd: number; annualPayout: number } } | null,
): KeyStats {
  return {
    fiftyTwoWeekHigh: quote?.yearHigh || fundamentals?.fiftyTwoWeekHigh || 0,
    fiftyTwoWeekLow: quote?.yearLow || fundamentals?.fiftyTwoWeekLow || 0,
    dayHigh: quote?.dayHigh || 0,
    dayLow: quote?.dayLow || 0,
    previousClose: quote?.previousClose || 0,
    open: quote?.open || 0,
    volume: quote?.volume || 0,
    avgVolume: fundamentals?.avgVolume || 0,
    marketCap: fundamentals?.marketCap || '—',
    peRatio: fundamentals?.peRatio || quote?.peRatio || 0,
    forwardPE: fundamentals?.forwardPE || 0,
    eps: fundamentals?.eps || quote?.eps || 0,
    dividendYield: saData?.dividendInfo.yieldFwd || fundamentals?.dividendYield || 0,
    dividendRate: saData?.dividendInfo.annualPayout || 0,
    beta: saData?.riskMetrics.beta || fundamentals?.beta || 0,
    shortInterest: saData?.riskMetrics.shortInterest || 0,
    profitMargin: fundamentals?.profitMargin || 0,
    roe: fundamentals?.roe || 0,
    debtToEquity: fundamentals?.debtToEquity || 0,
    revenueGrowth: fundamentals?.revenueGrowth || 0,
    sector: quote?.sector || fundamentals?.sector || '',
    industry: quote?.industry || fundamentals?.industry || '',
    exchange: quote?.exchange || '',
    analystTarget: saData?.quantRating.wallStreetTarget || 0,
    analystCount: saData?.quantRating.analystCount || 0,
    recommendation: saData?.quantRating.wallStreetRating || '',
  };
}


