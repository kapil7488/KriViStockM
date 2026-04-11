import { useState, useRef, useEffect, useCallback } from 'react';
import { searchSymbols, SymbolSuggestion } from '../services/stockApi';
import type { Market } from '../types';

interface Props {
  value: string;
  onChange: (s: string) => void;
  onSelect: (s: string) => void;
  placeholder?: string;
  className?: string;
  market?: Market;
}

export function SymbolAutocomplete({ value, onChange, onSelect, placeholder, className, market }: Props) {
  const [suggestions, setSuggestions] = useState<SymbolSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Debounced search
  const doSearch = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 1) { setSuggestions([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      const results = await searchSymbols(q, market);
      setSuggestions(results);
      setOpen(results.length > 0);
      setActiveIdx(-1);
    }, 250);
  }, [market]);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const v = e.target.value.toUpperCase();
    onChange(v);
    doSearch(v);
  };

  const pick = (sym: string) => {
    onChange(sym);
    onSelect(sym);
    setOpen(false);
    setSuggestions([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!open || suggestions.length === 0) {
      if (e.key === 'Enter') onSelect(value);
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIdx(i => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIdx(i => Math.max(i - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (activeIdx >= 0 && activeIdx < suggestions.length) {
        pick(suggestions[activeIdx].symbol);
      } else {
        onSelect(value);
        setOpen(false);
      }
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div className="symbol-ac-wrapper" ref={wrapperRef}>
      <input
        type="text"
        className={className || 'symbol-input'}
        value={value}
        onChange={handleChange}
        onKeyDown={handleKeyDown}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        placeholder={placeholder}
        autoComplete="off"
      />
      {open && suggestions.length > 0 && (
        <ul className="symbol-ac-dropdown">
          {suggestions.map((s, i) => (
            <li
              key={s.symbol}
              className={`symbol-ac-item ${i === activeIdx ? 'active' : ''}`}
              onMouseDown={() => pick(s.symbol)}
              onMouseEnter={() => setActiveIdx(i)}
            >
              <span className="symbol-ac-ticker">{s.symbol}</span>
              <span className="symbol-ac-name">{s.longname}</span>
              <span className="symbol-ac-exchange">{s.exchange}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
