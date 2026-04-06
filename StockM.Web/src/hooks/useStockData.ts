import { useState, useCallback } from 'react';
import {
  StockBar, StockSignal, RiskAssessment, RiskParameters, FundamentalData, LiveQuote,
  Market, DEFAULT_RISK_PARAMS,
} from '../types';
import {
  generateSampleData, fetchDailyData, generateFundamentals,
  fetchIndianStockQuote, fetchIndianMultipleQuotes, fundamentalsFromLiveQuote,
  fetchFinnhubQuote, fetchFinnhubMetrics, buildFinnhubFundamentals,
  fetchUpstoxHistorical, fetchUpstoxQuote, fetchUpstoxMultipleQuotes,
  fetchYahooQuote, fetchYahooHistorical, fetchYahooFundamentals,
} from '../services/stockApi';
import { generateSignal } from '../services/scoringEngine';
import { evaluateRisk } from '../services/riskManager';

export type DataSource = 'simulated' | 'live-api' | 'live-patched';

interface UseStockDataReturn {
  loading: boolean;
  error: string | null;
  stockData: StockBar | null;
  signal: StockSignal | null;
  risk: RiskAssessment | null;
  fundamentals: FundamentalData | null;
  liveQuote: LiveQuote | null;
  watchlistQuotes: LiveQuote[];
  signalHistory: StockSignal[];
  dataSource: DataSource;
  analyze: (symbol: string, market: Market, apiKey?: string, upstoxToken?: string, finnhubKey?: string) => Promise<void>;
  fetchWatchlist: (symbols: string[], market: Market, upstoxToken?: string, finnhubKey?: string) => Promise<void>;
  refreshQuote: (symbol: string, market: Market, upstoxToken?: string, finnhubKey?: string) => Promise<void>;
  lastRefreshed: number;
  riskParams: RiskParameters;
}

export function useStockData(): UseStockDataReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stockData, setStockData] = useState<StockBar | null>(null);
  const [signal, setSignal] = useState<StockSignal | null>(null);
  const [risk, setRisk] = useState<RiskAssessment | null>(null);
  const [fundamentals, setFundamentals] = useState<FundamentalData | null>(null);
  const [liveQuote, setLiveQuote] = useState<LiveQuote | null>(null);
  const [watchlistQuotes, setWatchlistQuotes] = useState<LiveQuote[]>([]);
  const [signalHistory, setSignalHistory] = useState<StockSignal[]>([]);
  const [dataSource, setDataSource] = useState<DataSource>('simulated');
  const [lastRefreshed, setLastRefreshed] = useState<number>(Date.now());
  const riskParams = DEFAULT_RISK_PARAMS;

  const analyze = useCallback(async (symbol: string, market: Market, apiKey?: string, upstoxToken?: string, finnhubKey?: string) => {
    setLoading(true);
    setError(null);
    setLiveQuote(null);

    try {
      let live: LiveQuote | null = null;
      let data: StockBar;
      let src: DataSource = 'simulated';

      // ---- UPSTOX path: real historical + live quote for NSE/BSE ----
      if ((market === 'NSE' || market === 'BSE') && upstoxToken) {
        // Try real historical data from Upstox
        try {
          data = await fetchUpstoxHistorical(symbol, upstoxToken, market);
          src = 'live-api';
        } catch {
          // Fallback: fetch live quote first, then generate sample data anchored to real price
          try {
            live = await fetchUpstoxQuote(symbol, upstoxToken, market);
            setLiveQuote(live);
          } catch {
            try {
              live = await fetchIndianStockQuote(symbol, market);
              setLiveQuote(live);
            } catch { /* no live quote */ }
          }
          data = generateSampleData(symbol, 1300, live?.lastPrice);
          src = live ? 'live-patched' : 'simulated';
        }

        // If we got historical data, still try to get a live quote
        if (src === 'live-api' && !live) {
          try {
            live = await fetchUpstoxQuote(symbol, upstoxToken, market);
            setLiveQuote(live);
          } catch {
            try {
              live = await fetchIndianStockQuote(symbol, market);
              setLiveQuote(live);
            } catch { /* no live quote */ }
          }
        }
      }
      // ---- Free Indian API path (no Upstox token) ----
      else if (market === 'NSE' || market === 'BSE') {
        // Try Yahoo Finance for REAL historical daily OHLC (free, no key, no rate limit)
        try {
          data = await fetchYahooHistorical(symbol, market);
          src = 'live-api';
        } catch (yhErr) {
          console.warn('[StockM] Yahoo historical failed for Indian stock:', yhErr);
          data = generateSampleData(symbol, 1300);
        }

        // Fetch live quote to get latest price + metadata
        try {
          live = await fetchIndianStockQuote(symbol, market);
          setLiveQuote(live);
        } catch { /* Live quote failed */ }

        if (src !== 'live-api') {
          // Anchor simulated data to live price if available
          if (live) {
            data = generateSampleData(symbol, 1300, live.lastPrice);
            src = 'live-patched';
          }
        }
      }
      // ---- US market path: Yahoo Finance for history + live quote ----
      else if (market === 'US') {
        // First try live quote: Finnhub → Yahoo fallback
        if (finnhubKey) {
          try {
            live = await fetchFinnhubQuote(symbol, finnhubKey);
            setLiveQuote(live);
          } catch { /* Finnhub failed, will try Yahoo below */ }
        }
        if (!live) {
          try {
            live = await fetchYahooQuote(symbol);
            setLiveQuote(live);
          } catch { /* Yahoo also failed */ }
        }

        // Try Yahoo Finance for REAL historical daily OHLC (free, no key, no rate limit)
        try {
          data = await fetchYahooHistorical(symbol);
          src = 'live-api';
        } catch (yhErr) {
          console.warn('[StockM] Yahoo historical failed:', yhErr);
          // Fallback: try Alpha Vantage (cached, 25/day limit)
          if (apiKey) {
            try {
              data = await fetchDailyData(symbol, apiKey);
              src = 'live-api';
            } catch {
              data = generateSampleData(symbol, 1300, live?.lastPrice);
              src = live ? 'live-patched' : 'simulated';
            }
          } else {
            data = generateSampleData(symbol, 1300, live?.lastPrice);
            src = live ? 'live-patched' : 'simulated';
          }
        }
      }
      // ---- No API keys: pure simulation ----
      else {
        await new Promise(r => setTimeout(r, 300));
        data = generateSampleData(symbol);
        src = 'simulated';
      }

      // Patch latest bar with live price if we have it and data isn't already fully live
      if (live && data.quotes.length > 0 && src !== 'live-api') {
        const lastQ = data.quotes[data.quotes.length - 1];
        data.quotes[data.quotes.length - 1] = {
          ...lastQ,
          close: live.lastPrice,
          open: live.open || lastQ.open,
          high: live.dayHigh || lastQ.high,
          low: live.dayLow || lastQ.low,
          volume: live.volume || lastQ.volume,
        };
      }

      if (data.quotes.length < 121) {
        setError(`Insufficient data for ${symbol} (need 121+ trading days)`);
        setLoading(false);
        return;
      }

      setStockData(data);
      setDataSource(src);

      const sig = generateSignal(symbol, data.quotes, riskParams);
      setSignal(sig);

      const riskAssessment = evaluateRisk(sig, riskParams);
      setRisk(riskAssessment);

      // Fundamentals: Yahoo quoteSummary (real data) → Finnhub metrics → live quote → synthetic
      try {
        setFundamentals(await fetchYahooFundamentals(symbol, market));
      } catch {
        if (market === 'US' && finnhubKey && live) {
          try {
            const metrics = await fetchFinnhubMetrics(symbol, finnhubKey);
            setFundamentals(buildFinnhubFundamentals(live, metrics, data.quotes));
          } catch {
            setFundamentals(live ? fundamentalsFromLiveQuote(live, data.quotes) : generateFundamentals(symbol, data.quotes));
          }
        } else if (live) {
          setFundamentals(fundamentalsFromLiveQuote(live, data.quotes));
        } else {
          setFundamentals(generateFundamentals(symbol, data.quotes));
        }
      }

      setSignalHistory(prev => [sig, ...prev].slice(0, 50));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [riskParams]);

  /** Lightweight live-quote refresh — updates liveQuote AND patches chart's last bar. */
  const refreshQuote = useCallback(async (symbol: string, market: Market, upstoxToken?: string, finnhubKey?: string) => {
    try {
      let live: LiveQuote | null = null;
      if ((market === 'NSE' || market === 'BSE') && upstoxToken) {
        try { live = await fetchUpstoxQuote(symbol, upstoxToken, market); }
        catch { live = await fetchIndianStockQuote(symbol, market); }
      } else if (market === 'NSE' || market === 'BSE') {
        live = await fetchIndianStockQuote(symbol, market);
      } else if (finnhubKey) {
        try { live = await fetchFinnhubQuote(symbol, finnhubKey); }
        catch { live = await fetchYahooQuote(symbol); }
      } else {
        live = await fetchYahooQuote(symbol);
      }
      if (live) {
        // Skip update if price hasn't changed (avoid unnecessary re-renders)
        setLiveQuote(prev => {
          if (prev && prev.lastPrice === live.lastPrice && prev.volume === live.volume) return prev;
          return live;
        });
        setLastRefreshed(Date.now());
        // Patch the chart's last bar only if price actually changed
        setStockData(prev => {
          if (!prev || prev.quotes.length === 0) return prev;
          const last = prev.quotes[prev.quotes.length - 1];
          if (last.close === live.lastPrice && last.volume === (live.volume || last.volume)) return prev;
          const quotes = prev.quotes.slice();
          quotes[quotes.length - 1] = {
            ...last,
            close: live.lastPrice,
            high: Math.max(last.high, live.dayHigh || live.lastPrice),
            low: Math.min(last.low, live.dayLow || live.lastPrice),
            volume: live.volume || last.volume,
          };
          return { ...prev, quotes };
        });
      }
    } catch {
      /* silent — polling failure is not critical */
    }
  }, []);

  const fetchWatchlist = useCallback(async (symbols: string[], market: Market, upstoxToken?: string, finnhubKey?: string) => {
    if ((market === 'NSE' || market === 'BSE') && upstoxToken) {
      try {
        const quotes = await fetchUpstoxMultipleQuotes(symbols, upstoxToken, market);
        setWatchlistQuotes(quotes);
      } catch {
        // Fallback to free Indian API
        try {
          const quotes = await fetchIndianMultipleQuotes(symbols, market);
          setWatchlistQuotes(quotes);
        } catch {
          setWatchlistQuotes([]);
        }
      }
    } else if (market === 'NSE' || market === 'BSE') {
      try {
        const quotes = await fetchIndianMultipleQuotes(symbols, market);
        setWatchlistQuotes(quotes);
      } catch {
        setWatchlistQuotes([]);
      }
    } else if (market === 'US' && finnhubKey) {
      try {
        const out: LiveQuote[] = [];
        // Fetch in batches of 4 to limit concurrent connections
        for (let i = 0; i < Math.min(symbols.length, 10); i += 4) {
          const batch = symbols.slice(i, i + 4);
          const results = await Promise.all(
            batch.map(async (s) => {
              try { return await fetchFinnhubQuote(s, finnhubKey); }
              catch { return null; }
            })
          );
          for (const r of results) if (r) out.push(r);
        }
        setWatchlistQuotes(out);
      } catch {
        setWatchlistQuotes([]);
      }
    } else if (market === 'US') {
      try {
        const out: LiveQuote[] = [];
        for (let i = 0; i < Math.min(symbols.length, 10); i += 4) {
          const batch = symbols.slice(i, i + 4);
          const results = await Promise.all(
            batch.map(async (s) => {
              try { return await fetchYahooQuote(s); }
              catch { return null; }
            })
          );
          for (const r of results) if (r) out.push(r);
        }
        setWatchlistQuotes(out);
      } catch {
        setWatchlistQuotes([]);
      }
    } else {
      setWatchlistQuotes([]);
    }
    setLastRefreshed(Date.now());
  }, []);

  return {
    loading, error, stockData, signal, risk, fundamentals,
    liveQuote, watchlistQuotes, signalHistory, dataSource,
    analyze, fetchWatchlist, refreshQuote, lastRefreshed, riskParams,
  };
}
