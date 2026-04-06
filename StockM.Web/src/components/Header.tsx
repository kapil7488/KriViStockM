import { Market, MARKETS, LiveQuote, SignalType } from '../types';

interface HeaderProps {
  symbol: string;
  loading: boolean;
  market: Market;
  liveQuote: LiveQuote | null;
  hasApiKey: boolean;
  onSymbolChange: (s: string) => void;
  onMarketChange: (m: Market) => void;
  onAnalyze: () => void;
}

export function Header({
  symbol, loading, market, liveQuote, hasApiKey,
  onSymbolChange, onMarketChange, onAnalyze,
}: HeaderProps) {
  const mktConfig = MARKETS.find(m => m.id === market)!;

  return (
    <header className="header">
      <div className="header-left">
        <span className="logo">📈</span>
        <div>
          <h1 className="header-title">StockM</h1>
          <p className="header-subtitle">Algorithmic Stock Picker — 2026 Liquidity Model</p>
        </div>
      </div>

      <div className="header-center">
        {/* Market Selector */}
        <div className="market-selector">
          {MARKETS.map(m => (
            <button
              key={m.id}
              className={`market-btn ${market === m.id ? 'active' : ''}`}
              onClick={() => onMarketChange(m.id)}
              title={m.label}
            >
              {m.flag} {m.id}
            </button>
          ))}
        </div>

        <input
          type="text"
          className="symbol-input"
          value={symbol}
          onChange={e => onSymbolChange(e.target.value.toUpperCase())}
          onKeyDown={e => e.key === 'Enter' && onAnalyze()}
          placeholder={`Symbol (${mktConfig.id})...`}
        />
        <button className="btn-primary" onClick={onAnalyze} disabled={loading}>
          {loading ? '⏳ Analyzing...' : '⚡ Analyze'}
        </button>

        {/* Live Price Badge */}
        {liveQuote && (
          <div className="live-badge">
            <span className="live-dot" />
            <span className="live-price">{mktConfig.currency}{liveQuote.lastPrice.toFixed(2)}</span>
            <span className={`live-change ${liveQuote.percentChange >= 0 ? 'up' : 'down'}`}>
              {liveQuote.percentChange >= 0 ? '▲' : '▼'} {Math.abs(liveQuote.percentChange).toFixed(2)}%
            </span>
          </div>
        )}
      </div>

      <div className="header-right">
        {market === 'US' && hasApiKey && (
          <span className="api-label" style={{ color: '#22c55e', fontSize: '0.8rem' }}>
            🟢 Live Data (Alpha Vantage + Finnhub)
          </span>
        )}
        {market === 'US' && !hasApiKey && (
          <span className="api-label" style={{ color: '#f59e0b', fontSize: '0.8rem' }}>
            ⚠️ No API key — simulated data
          </span>
        )}
        {market !== 'US' && (
          <span className="api-label" style={{ color: '#22c55e', fontSize: '0.8rem' }}>
            🟢 Yahoo Finance (live + history)
          </span>
        )}
      </div>
    </header>
  );
}

interface WatchlistProps {
  symbols: string[];
  activeSymbol?: string;
  watchlistQuotes: LiveQuote[];
  currency: string;
  onSelect: (s: string) => void;
}

export function Watchlist({ symbols, activeSymbol, watchlistQuotes, currency, onSelect }: WatchlistProps) {
  const quoteMap = new Map(watchlistQuotes.map(q => [q.symbol, q]));

  return (
    <div className="watchlist">
      {symbols.map(s => {
        const q = quoteMap.get(s);
        return (
          <button key={s}
            className={`watchlist-btn ${s === activeSymbol ? 'active' : ''}`}
            onClick={() => onSelect(s)}>
            <span className="wl-symbol">{s}</span>
            {q && (
              <span className="wl-price-info">
                <span className="wl-price">{currency}{q.lastPrice.toFixed(2)}</span>
                <span className={`wl-change ${q.percentChange >= 0 ? 'up' : 'down'}`}>
                  {q.percentChange >= 0 ? '+' : ''}{q.percentChange.toFixed(2)}%
                </span>
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function getSignalColor(signal: SignalType): string {
  switch (signal) {
    case 'StrongBuy': return '#22c55e';
    case 'Buy': return '#84cc16';
    case 'Hold': return '#eab308';
    case 'Sell': return '#f97316';
    case 'StrongSell': return '#ef4444';
  }
}

export function getScoreColor(score: number): string {
  if (score >= 0.65) return '#22c55e';
  if (score >= 0.55) return '#84cc16';
  if (score >= 0.45) return '#eab308';
  if (score >= 0.30) return '#f97316';
  return '#ef4444';
}
