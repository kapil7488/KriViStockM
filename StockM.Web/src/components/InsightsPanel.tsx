import { useState, useEffect, useRef } from 'react';
import { StockNewsItem, LiveQuote, FundamentalData, SAStyleData, Market } from '../types';
import { fetchStockNews, buildKeyStats } from '../services/stockApi';

interface InsightsPanelProps {
  symbol: string;
  liveQuote: LiveQuote | null;
  fundamentals: FundamentalData | null;
  saData: SAStyleData | null;
  currency: string;
  market: Market;
  watchlistQuotes: LiveQuote[];
  onSelectSymbol: (s: string) => void;
}

export function InsightsPanel({
  symbol, liveQuote, fundamentals, saData, currency, market: _market, watchlistQuotes, onSelectSymbol,
}: InsightsPanelProps) {
  const [news, setNews] = useState<StockNewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const fetchId = useRef(0);

  useEffect(() => {
    if (!symbol) return;
    const id = ++fetchId.current;
    setNewsLoading(true);
    fetchStockNews(symbol, 8)
      .then(items => { if (fetchId.current === id) setNews(items); })
      .catch(() => { if (fetchId.current === id) setNews([]); })
      .finally(() => { if (fetchId.current === id) setNewsLoading(false); });
  }, [symbol]);

  const stats = buildKeyStats(liveQuote, fundamentals, saData);
  const price = liveQuote?.lastPrice || 0;

  // Range slider position helpers
  const pct52w = stats.fiftyTwoWeekHigh > stats.fiftyTwoWeekLow
    ? ((price - stats.fiftyTwoWeekLow) / (stats.fiftyTwoWeekHigh - stats.fiftyTwoWeekLow)) * 100
    : 50;
  const pctDay = stats.dayHigh > stats.dayLow
    ? ((price - stats.dayLow) / (stats.dayHigh - stats.dayLow)) * 100
    : 50;

  const fmtNum = (n: number, dec = 2) => n ? n.toFixed(dec) : '—';
  const fmtVol = (n: number) => {
    if (!n) return '—';
    if (n >= 1e9) return (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
    return n.toLocaleString();
  };
  const fmtPct = (n: number) => n ? n.toFixed(2) + '%' : '—';

  const relativeTime = (ts: number) => {
    const diff = Math.floor((Date.now() / 1000) - ts);
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };

  // Peers from watchlist (exclude current symbol, take first 5)
  const peers = watchlistQuotes.filter(q => q.symbol !== symbol).slice(0, 5);

  return (
    <div className="insights-panel">
      {/* KEY STATISTICS */}
      <div className="card insights-stats-card">
        <h3 className="insights-section-title">Key Statistics</h3>

        {/* Range Sliders */}
        <div className="range-stat">
          <div className="range-header">
            <span className="range-label">52 Week Range</span>
          </div>
          <div className="range-bar-wrap">
            <span className="range-val">{currency}{fmtNum(stats.fiftyTwoWeekLow)}</span>
            <div className="range-bar">
              <div className="range-fill" style={{ width: `${Math.max(2, Math.min(98, pct52w))}%` }} />
              <div className="range-thumb" style={{ left: `${Math.max(2, Math.min(98, pct52w))}%` }} />
            </div>
            <span className="range-val">{currency}{fmtNum(stats.fiftyTwoWeekHigh)}</span>
          </div>
        </div>

        <div className="range-stat">
          <div className="range-header">
            <span className="range-label">Day Range</span>
          </div>
          <div className="range-bar-wrap">
            <span className="range-val">{currency}{fmtNum(stats.dayLow)}</span>
            <div className="range-bar">
              <div className="range-fill" style={{ width: `${Math.max(2, Math.min(98, pctDay))}%` }} />
              <div className="range-thumb" style={{ left: `${Math.max(2, Math.min(98, pctDay))}%` }} />
            </div>
            <span className="range-val">{currency}{fmtNum(stats.dayHigh)}</span>
          </div>
        </div>

        {/* Stats Grid */}
        <div className="stats-grid">
          <div className="stat-item">
            <span className="stat-label">EPS (FWD)</span>
            <span className="stat-value">{fmtNum(stats.eps)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">PE (FWD)</span>
            <span className="stat-value">{fmtNum(stats.forwardPE)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Div Rate (FWD)</span>
            <span className="stat-value">{currency}{fmtNum(stats.dividendRate)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Yield (FWD)</span>
            <span className="stat-value">{fmtPct(stats.dividendYield)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Short Interest</span>
            <span className="stat-value">{fmtPct(stats.shortInterest)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Market Cap</span>
            <span className="stat-value">{stats.marketCap}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Volume</span>
            <span className="stat-value">{fmtVol(stats.volume)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Prev. Close</span>
            <span className="stat-value">{currency}{fmtNum(stats.previousClose)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">P/E Ratio</span>
            <span className="stat-value">{fmtNum(stats.peRatio)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Beta</span>
            <span className="stat-value">{fmtNum(stats.beta)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">Profit Margin</span>
            <span className="stat-value">{fmtPct(stats.profitMargin)}</span>
          </div>
          <div className="stat-item">
            <span className="stat-label">ROE</span>
            <span className="stat-value">{fmtPct(stats.roe)}</span>
          </div>
        </div>

        {/* Analyst Target */}
        {stats.analystTarget > 0 && (
          <div className="analyst-target-bar">
            <div className="at-header">
              <span className="at-label">Analyst Price Target</span>
              <span className="at-rec">{stats.recommendation}</span>
            </div>
            <div className="at-row">
              <span className="at-current">{currency}{fmtNum(price)}</span>
              <span className="at-arrow">→</span>
              <span className="at-target">{currency}{fmtNum(stats.analystTarget)}</span>
              <span className={`at-upside ${stats.analystTarget >= price ? 'up' : 'down'}`}>
                ({stats.analystTarget >= price ? '+' : ''}{(((stats.analystTarget - price) / price) * 100).toFixed(1)}%)
              </span>
            </div>
            {stats.analystCount > 0 && (
              <span className="at-count">Based on {stats.analystCount} analyst{stats.analystCount > 1 ? 's' : ''}</span>
            )}
          </div>
        )}

        {/* Sector/Industry */}
        {(stats.sector || stats.industry) && (
          <div className="sector-info">
            {stats.sector && <span className="sector-tag">{stats.sector}</span>}
            {stats.industry && <span className="industry-tag">{stats.industry}</span>}
            {stats.exchange && <span className="exchange-tag">{stats.exchange}</span>}
          </div>
        )}
      </div>

      {/* NEWS */}
      <div className="card insights-news-card">
        <h3 className="insights-section-title">📰 {symbol} News</h3>
        {newsLoading && <div className="insights-loading">Loading news…</div>}
        {!newsLoading && news.length === 0 && (
          <p className="empty-text">No recent news found for {symbol}.</p>
        )}
        <div className="news-list">
          {news.map((item) => (
            <a
              key={item.uuid}
              className="news-item"
              href={item.link}
              target="_blank"
              rel="noopener noreferrer"
            >
              {item.thumbnail && (
                <img className="news-thumb" src={item.thumbnail} alt="" loading="lazy" />
              )}
              <div className="news-body">
                <div className="news-title">{item.title}</div>
                <div className="news-meta">
                  <span className="news-publisher">{item.publisher}</span>
                  <span className="news-time">{relativeTime(item.publishTime)}</span>
                </div>
                {item.relatedTickers.length > 0 && (
                  <div className="news-tickers">
                    {item.relatedTickers.slice(0, 5).map(t => (
                      <span key={t} className="news-ticker-tag">{t}</span>
                    ))}
                  </div>
                )}
              </div>
            </a>
          ))}
        </div>
      </div>

      {/* PEOPLE ALSO FOLLOW */}
      {peers.length > 0 && (
        <div className="card insights-peers-card">
          <h3 className="insights-section-title">People Also Follow</h3>
          <div className="peers-list">
            <div className="peer-header-row">
              <span>Symbol</span>
              <span className="peer-r">Last Price</span>
              <span className="peer-r">Change</span>
            </div>
            {peers.map(p => (
              <div
                key={p.symbol}
                className="peer-row"
                onClick={() => onSelectSymbol(p.symbol)}
              >
                <div className="peer-sym">
                  <span className="peer-symbol">{p.symbol}</span>
                  <span className="peer-name">{p.companyName}</span>
                </div>
                <span className="peer-price peer-r">{currency}{p.lastPrice.toFixed(2)}</span>
                <span className={`peer-change peer-r ${p.percentChange >= 0 ? 'up' : 'down'}`}>
                  {p.percentChange >= 0 ? '+' : ''}{p.percentChange.toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
