import { useState, useEffect, useRef } from 'react';
import { FundamentalData, StockNewsItem } from '../types';
import { fetchStockNews } from '../services/stockApi';

interface FundamentalPanelProps {
  data: FundamentalData;
  symbol: string;
  currency: string;
}

export function FundamentalPanel({ data, symbol, currency }: FundamentalPanelProps) {
  const sym = currency === 'INR' ? '₹' : '$';
  const [news, setNews] = useState<StockNewsItem[]>([]);
  const [newsLoading, setNewsLoading] = useState(false);
  const fetchId = useRef(0);

  useEffect(() => {
    if (!symbol) return;
    const id = ++fetchId.current;
    setNewsLoading(true);
    fetchStockNews(symbol, 6)
      .then(items => { if (fetchId.current === id) setNews(items); })
      .catch(() => { if (fetchId.current === id) setNews([]); })
      .finally(() => { if (fetchId.current === id) setNewsLoading(false); });
  }, [symbol]);

  const relativeTime = (ts: number) => {
    const diff = Math.floor((Date.now() / 1000) - ts);
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return `${Math.floor(diff / 86400)}d ago`;
  };
  return (
    <div className="card fundamental-card">
      <h3 className="card-title">📋 Fundamental Analysis — {symbol}</h3>

      {/* Company Profile */}
      <div className="sa-company-profile">
        <div className="fund-description">{data.description}</div>
        <div className="fund-tags">
          <span className="fund-tag">{data.sector}</span>
          <span className="fund-tag">{data.industry}</span>
        </div>
      </div>

      {/* Valuation */}
      <div className="fund-section">
        <h4 className="fund-section-title">💎 Valuation</h4>
        <div className="fund-grid">
          <FundRow label="P/E (TTM)" value={data.peRatio.toFixed(2)}
            signal={data.peRatio < 15 ? 'good' : data.peRatio > 30 ? 'warn' : 'neutral'} />
          <FundRow label="P/E (FWD)" value={data.forwardPE.toFixed(2)}
            signal={data.forwardPE > 0 && data.forwardPE < data.peRatio ? 'good' : 'neutral'} />
          <FundRow label="EPS" value={`${sym}${data.eps.toFixed(2)}`}
            signal={data.eps > 0 ? 'good' : 'warn'} />
          <FundRow label="Market Cap" value={data.marketCap} />
          <FundRow label="Dividend Yield" value={`${data.dividendYield.toFixed(2)}%`}
            signal={data.dividendYield >= 2 ? 'good' : 'neutral'} />
        </div>
      </div>

      {/* Growth */}
      <div className="fund-section">
        <h4 className="fund-section-title">🚀 Growth</h4>
        <div className="fund-grid">
          <FundRow label="Revenue" value={data.revenue} />
          <FundRow label="Revenue Growth (YoY)" value={`${data.revenueGrowth.toFixed(1)}%`}
            signal={data.revenueGrowth > 10 ? 'good' : data.revenueGrowth < 0 ? 'warn' : 'neutral'} />
          <FundRow label="Net Income" value={data.netIncome} />
          <FundRow label="Free Cash Flow" value={data.freeCashFlow} />
        </div>
      </div>

      {/* Profitability */}
      <div className="fund-section">
        <h4 className="fund-section-title">📊 Profitability</h4>
        <div className="fund-grid">
          <FundRow label="Profit Margin" value={`${data.profitMargin.toFixed(1)}%`}
            signal={data.profitMargin > 20 ? 'good' : data.profitMargin < 5 ? 'warn' : 'neutral'} />
          <FundRow label="ROE" value={`${data.roe.toFixed(1)}%`}
            signal={data.roe > 15 ? 'good' : data.roe < 5 ? 'warn' : 'neutral'} />
          <FundRow label="Debt/Equity" value={data.debtToEquity.toFixed(2)}
            signal={data.debtToEquity < 0.5 ? 'good' : data.debtToEquity > 1.5 ? 'warn' : 'neutral'} />
          <FundRow label="Beta" value={data.beta.toFixed(2)}
            signal={data.beta > 1.5 ? 'warn' : 'good'} />
        </div>
      </div>

      {/* Price & Trading */}
      <div className="fund-section">
        <h4 className="fund-section-title">📈 Price & Trading</h4>
        <div className="fund-grid">
          <FundRow label="52W High" value={`${sym}${data.fiftyTwoWeekHigh.toFixed(2)}`} />
          <FundRow label="52W Low" value={`${sym}${data.fiftyTwoWeekLow.toFixed(2)}`} />
          <FundRow label="Avg Volume" value={`${(data.avgVolume / 1e6).toFixed(1)}M`} />
          <FundRow label="Next Earnings" value={data.nextEarnings} highlight />
        </div>
      </div>

      {/* Latest News */}
      <div className="fund-section">
        <h4 className="fund-section-title">📰 Latest News</h4>
        {newsLoading && <div style={{ fontSize: 11, color: '#94a3b8', padding: '4px 0' }}>Loading news…</div>}
        {!newsLoading && news.length === 0 && <div style={{ fontSize: 11, color: '#64748b' }}>No recent news.</div>}
        <div className="fund-news-list">
          {news.map(item => (
            <a key={item.uuid} className="fund-news-item" href={item.link} target="_blank" rel="noopener noreferrer">
              {item.thumbnail && <img className="fund-news-thumb" src={item.thumbnail} alt="" loading="lazy" />}
              <div className="fund-news-body">
                <div className="fund-news-title">{item.title}</div>
                <div className="fund-news-meta">
                  <span className="fund-news-pub">{item.publisher}</span>
                  <span>{relativeTime(item.publishTime)}</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

function FundRow({ label, value, signal, highlight }: {
  label: string; value: string; signal?: 'good' | 'warn' | 'neutral'; highlight?: boolean;
}) {
  let dotColor = '';
  if (signal === 'good') dotColor = '#22c55e';
  else if (signal === 'warn') dotColor = '#f97316';

  return (
    <div className={`fund-row ${highlight ? 'highlight' : ''}`}>
      <span className="fund-label">{label}</span>
      <span className="fund-value">
        {dotColor && <span className="fund-dot" style={{ background: dotColor }} />}
        {value}
      </span>
    </div>
  );
}
