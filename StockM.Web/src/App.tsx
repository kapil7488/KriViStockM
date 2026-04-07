import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Market, MARKETS } from './types';
import { Header, Watchlist } from './components/Header';
import { StockChart } from './components/StockChart';
import { SignalPanel, IndicatorsPanel } from './components/SignalPanel';
import { RiskPanel, HistoryPanel } from './components/RiskPanel';
import { FundamentalPanel } from './components/FundamentalPanel';
import { QuantRatingPanel } from './components/QuantRatingPanel';
import { GuidePanel } from './components/GuidePanel';
import { PaperTradingPanel } from './components/PaperTradingPanel';
import { TopPicksPanel } from './components/TopPicksPanel';
import { VwapScreener } from './components/VwapScreener';
import { InsightsPanel } from './components/InsightsPanel';
import { useStockData } from './hooks/useStockData';
import { computeSAStyleData } from './services/quantScoring';
import './App.css';

type SidebarTab = 'insights' | 'technical' | 'fundamental' | 'quant' | 'risk' | 'trade' | 'picks' | 'vwap' | 'guide';

// Read API keys from environment (set in .env, never committed to git)
const AV_KEY = import.meta.env.VITE_AV_KEY || '';
const FINNHUB_KEY = import.meta.env.VITE_FINNHUB_KEY || '';

export default function App() {
  const [symbol, setSymbol] = useState('AAPL');
  const apiKey = AV_KEY;
  const finnhubKey = FINNHUB_KEY;
  const [market, setMarket] = useState<Market>('US');
  const [activeTab, setActiveTab] = useState<SidebarTab>('insights');
  const {
    loading, error, stockData, signal, risk, fundamentals,
    liveQuote, watchlistQuotes, signalHistory, dataSource,
    analyze, fetchWatchlist, refreshQuote, lastRefreshed,
  } = useStockData();

  const mktConfig = MARKETS.find(m => m.id === market)!;
  const symbolRef = useRef(symbol);
  const marketRef = useRef(market);
  const finnhubRef = useRef(finnhubKey);
  symbolRef.current = symbol;
  marketRef.current = market;
  finnhubRef.current = finnhubKey;

  // When market changes, update the default symbol and refresh watchlist quotes
  useEffect(() => {
    const defaultSymbol = mktConfig.watchlist[0];
    setSymbol(defaultSymbol);
    fetchWatchlist(mktConfig.watchlist, market, finnhubKey || undefined);
    // Auto-analyze the default symbol so live data loads immediately
    analyze(defaultSymbol, market, apiKey || undefined, finnhubKey || undefined);
  }, [market, mktConfig, fetchWatchlist, apiKey, finnhubKey, analyze]);

  // Auto-refresh live quote + watchlist every 15 s so prices stay current
  useEffect(() => {
    const REFRESH_MS = 30_000; // 30 seconds
    const tick = () => {
      const m = marketRef.current;
      const s = symbolRef.current;
      const fk = finnhubRef.current;
      const cfg = MARKETS.find(mk => mk.id === m)!;
      // Refresh watchlist quotes
      fetchWatchlist(cfg.watchlist, m, fk || undefined);
      // Refresh the active stock's live quote + chart last bar
      if (s) refreshQuote(s, m, fk || undefined);
    };
    const id = setInterval(tick, REFRESH_MS);
    return () => clearInterval(id);
  }, [fetchWatchlist, refreshQuote]);

  const handleAnalyze = () => {
    if (symbol.trim()) analyze(symbol.trim(), market, apiKey || undefined, finnhubKey || undefined);
  };

  const handleWatchlistSelect = (s: string) => {
    setSymbol(s);
    analyze(s, market, apiKey || undefined, finnhubKey || undefined);
  };

  const handleMarketChange = (m: Market) => {
    setMarket(m);
  };

  const handleManualRefresh = useCallback(() => {
    fetchWatchlist(mktConfig.watchlist, market, finnhubKey || undefined);
    if (symbol) refreshQuote(symbol, market, finnhubKey || undefined);
  }, [fetchWatchlist, refreshQuote, mktConfig, market, symbol, finnhubKey]);

  // Compute Seeking Alpha-style data whenever fundamentals/stockData/signal change
  const saData = useMemo(() => {
    if (!fundamentals || !stockData || !signal) return null;
    return computeSAStyleData(fundamentals, stockData.quotes, signal.modelScore, watchlistQuotes, stockData.symbol);
  }, [fundamentals, stockData, signal, watchlistQuotes]);

  return (
    <div className="app">
      <Header
        symbol={symbol}
        loading={loading}
        market={market}
        liveQuote={liveQuote}
        hasApiKey={!!apiKey}
        onSymbolChange={setSymbol}
        onMarketChange={handleMarketChange}
        onAnalyze={handleAnalyze}
      />

      <Watchlist
        symbols={mktConfig.watchlist}
        activeSymbol={stockData?.symbol}
        watchlistQuotes={watchlistQuotes}
        currency={mktConfig.currency}
        onSelect={handleWatchlistSelect}
      />

      <main className="main-content">
        <div className="left-panel">
          {stockData && <StockChart data={stockData} signal={signal} dataSource={dataSource} liveQuote={liveQuote} currency={mktConfig.currency} market={market} />}

          {!stockData && !loading && (
            <div className="card empty-card">
              <div className="empty-icon">📈</div>
              <h2>Welcome to StockM</h2>
              <p>Enter a stock symbol and click Analyze to get started.<br />
                Powered by H-BLSTM + XGBoost hybrid scoring with the 2026 Liquidity Strategy.</p>
              <div className="data-source-banner simulated" style={{ marginBottom: 14 }}>
                <span className="ds-badge simulated">⚠️ NOTE</span>
                <span className="ds-text">
                  <b>US market</b> uses Finnhub for live prices (chart history is simulated).
                  <b>NSE/BSE</b> markets fetch <b>live prices</b> from a free API.
                  All markets use <b>Yahoo Finance</b> for <b>real historical charts</b> and live data.
                </span>
              </div>
              <div className="feature-grid">
                <div className="feature-card">
                  <span className="feature-emoji">🕯️</span>
                  <span>Candlestick / Line / Area charts</span>
                </div>
                <div className="feature-card">
                  <span className="feature-emoji">📅</span>
                  <span>1D to 5Y ranges + 1m–4H intervals</span>
                </div>
                <div className="feature-card">
                  <span className="feature-emoji">📊</span>
                  <span>SMA, EMA, BB, VWAP overlays</span>
                </div>
                <div className="feature-card">
                  <span className="feature-emoji">📈</span>
                  <span>RSI, MACD, Stochastic, ATR</span>
                </div>
                <div className="feature-card">
                  <span className="feature-emoji">📋</span>
                  <span>Fundamental analysis (P/E, EPS, ROE)</span>
                </div>
                <div className="feature-card">
                  <span className="feature-emoji">�</span>
                  <span>SA-style Quant Ratings & Factor Grades</span>
                </div>
                <div className="feature-card">
                  <span className="feature-emoji">�🛡️</span>
                  <span>Risk management & position sizing</span>
                </div>
              </div>
            </div>
          )}

          {!stockData && !loading && <GuidePanel />}

          {signal && <SignalPanel signal={signal} currency={mktConfig.currency} />}
          {error && <div className="card error-card">⚠️ {error}</div>}
        </div>

        <div className="right-panel">
          {/* Sidebar Tabs */}
          <div className="sidebar-tabs">
            <button className={`sidebar-tab ${activeTab === 'insights' ? 'active' : ''}`}
              onClick={() => setActiveTab('insights')}>
              📰 Insights
            </button>
            <button className={`sidebar-tab ${activeTab === 'technical' ? 'active' : ''}`}
              onClick={() => setActiveTab('technical')}>
              📊 Technical
            </button>
            <button className={`sidebar-tab ${activeTab === 'fundamental' ? 'active' : ''}`}
              onClick={() => setActiveTab('fundamental')}>
              📋 Fundamental
            </button>
            <button className={`sidebar-tab ${activeTab === 'quant' ? 'active' : ''}`}
              onClick={() => setActiveTab('quant')}>
              🔬 Quant
            </button>
            <button className={`sidebar-tab ${activeTab === 'risk' ? 'active' : ''}`}
              onClick={() => setActiveTab('risk')}>
              🛡️ Risk
            </button>
            <button className={`sidebar-tab ${activeTab === 'trade' ? 'active' : ''}`}
              onClick={() => setActiveTab('trade')}>
              💰 Trade
            </button>
            <button className={`sidebar-tab ${activeTab === 'picks' ? 'active' : ''}`}
              onClick={() => setActiveTab('picks')}>
              🔥 Top Picks
            </button>
            <button className={`sidebar-tab ${activeTab === 'vwap' ? 'active' : ''}`}
              onClick={() => setActiveTab('vwap')}>
              📏 VWAP
            </button>
            <button className={`sidebar-tab ${activeTab === 'guide' ? 'active' : ''}`}
              onClick={() => setActiveTab('guide')}>
              📖 Guide
            </button>
          </div>

          {activeTab === 'insights' && (
            <InsightsPanel
              symbol={stockData?.symbol || symbol}
              liveQuote={liveQuote}
              fundamentals={fundamentals}
              saData={saData}
              currency={mktConfig.currency}
              market={market}
              watchlistQuotes={watchlistQuotes}
              onSelectSymbol={handleWatchlistSelect}
            />
          )}

          {activeTab === 'technical' && (
            <>
              {signal && <IndicatorsPanel signal={signal} currency={mktConfig.currency} />}
              <HistoryPanel signals={signalHistory} />
            </>
          )}

          {activeTab === 'fundamental' && (
            <>
              {fundamentals && stockData
                ? <FundamentalPanel data={fundamentals} symbol={stockData.symbol} currency={mktConfig.currency} />
                : <div className="card"><p className="empty-text">Analyze a stock to see fundamentals.</p></div>
              }
            </>
          )}

          {activeTab === 'quant' && (
            <>
              {saData && stockData
                ? <QuantRatingPanel
                    data={saData}
                    symbol={stockData.symbol}
                    currency={mktConfig.currency}
                    onPeerSelect={handleWatchlistSelect}
                  />
                : <div className="card"><p className="empty-text">Analyze a stock to see Quant Rating & Factor Grades.</p></div>
              }
            </>
          )}

          {activeTab === 'risk' && (
            <>
              {signal && risk
                ? <RiskPanel risk={risk} signal={signal} currency={mktConfig.currency} />
                : <div className="card"><p className="empty-text">Analyze a stock to see risk analysis.</p></div>
              }
              <HistoryPanel signals={signalHistory} />
            </>
          )}

          {activeTab === 'trade' && (
            <PaperTradingPanel
              market={market}
              symbol={symbol}
              liveQuote={liveQuote}
              signal={signal}
              watchlistQuotes={watchlistQuotes}
              currency={mktConfig.currency}
              onSelectSymbol={handleWatchlistSelect}
            />
          )}

          {activeTab === 'picks' && (
            <TopPicksPanel
              market={market}
              currency={mktConfig.currency}
              onSelectSymbol={handleWatchlistSelect}
            />
          )}

          {activeTab === 'vwap' && (
            <VwapScreener
              market={market}
              currency={mktConfig.currency}
              onSelectSymbol={handleWatchlistSelect}
            />
          )}

          {activeTab === 'guide' && <GuidePanel />}
        </div>
      </main>

      <footer className="footer">
        <div className="footer-left">
          <button className="refresh-btn" onClick={handleManualRefresh} title="Refresh prices now">
            🔄
          </button>
          <span className={`status-dot ${loading ? 'loading' : 'ready'}`} />
          <span>
            {loading ? 'Analyzing...' : error ? error : signal
              ? `${signal.symbol}: ${(signal.modelScore * 100).toFixed(1)}% — ${signal.signal}`
              : 'Ready — Enter a symbol and click Analyze'}
          </span>
        </div>
        <div className="footer-right">
          <span className="refresh-time">
            Updated {new Date(lastRefreshed).toLocaleTimeString()}
          </span>
          <span className="footer-sep">|</span>
          <span>MACD · RSI · Stochastic · BB · VWAP · ATR</span>
        </div>
      </footer>

      {loading && (
        <div className="loading-overlay">
          <div className="loading-content">
            <div className="loading-spinner" />
            <p>Analyzing {symbol}...</p>
          </div>
        </div>
      )}
    </div>
  );
}
