import { type KeyboardEvent, useCallback, useMemo, useRef, useState } from 'react';
import type { SceneData } from '../app/data';
import { buildGazetteer, type SearchEntry, search } from '../app/search';
import { useApp } from '../app/store';
import { terrainAt } from '../engine/district';
import './search.css';

const DOT_COLOR: Record<SearchEntry['kind'], string> = {
  compound: '#1f1f1c',
  building: '#57544e',
  poi: '#8a867e',
  road: '#b9b4aa',
};

export function SearchBox({ data }: { data: SceneData }) {
  // 逐个取函数：zustand v5 里选择器每次返回新对象会导致无限重渲染
  const select = useApp((s) => s.select);
  const requestFly = useApp((s) => s.requestFly);
  const setMarker = useApp((s) => s.setMarker);

  const entries = useMemo(() => buildGazetteer(data.district), [data]);

  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [hl, setHl] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const results = useMemo(() => (query.trim() ? search(entries, query, 8) : []), [entries, query]);

  const handleSelect = useCallback(
    (e: SearchEntry) => {
      if (e.kind === 'building' && e.building !== undefined) {
        const b = data.district.buildings[e.building];
        if (!b) return;
        select({ kind: 'building', index: e.building });
        setMarker(null);
        requestFly([e.x, e.y, b.base + b.height * 0.45], Math.max(110, b.height * 3.2));
      } else if (e.kind === 'compound' && e.compound !== undefined) {
        select({ kind: 'compound', index: e.compound });
        setMarker(null);
        requestFly([e.x, e.y, terrainAt(data.district.terrain, e.x, e.y)], 520);
      } else {
        select(null);
        setMarker({ x: e.x, y: e.y, label: e.name });
        requestFly([e.x, e.y, terrainAt(data.district.terrain, e.x, e.y)], 260);
      }
      setQuery(e.name);
      setOpen(false);
      setHl(0);
      inputRef.current?.blur();
    },
    [data, select, requestFly, setMarker],
  );

  const onKey = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHl((h) => (results.length ? (h + 1) % results.length : 0));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHl((h) => (results.length ? (h - 1 + results.length) % results.length : 0));
      } else if (e.key === 'Enter' && results.length > 0) {
        e.preventDefault();
        const idx = hl >= 0 && hl < results.length ? hl : 0;
        handleSelect(results[idx] as SearchEntry);
      } else if (e.key === 'Escape') {
        setQuery('');
        setOpen(false);
        setHl(0);
      }
    },
    [results, hl, handleSelect],
  );

  return (
    <div className="panel search-box">
      <input
        ref={inputRef}
        className="search-input"
        placeholder="搜索小区、楼、地铁站、设施"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          setHl(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKey}
      />
      {open && results.length > 0 && (
        <ul className="search-dropdown">
          {results.map((e, i) => (
            <li
              key={`${e.kind}-${e.name}-${i}`}
              className={`search-item${i === hl ? ' hl' : ''}`}
              onMouseDown={(ev) => ev.preventDefault()}
              onClick={() => handleSelect(e)}
            >
              <span className="search-dot" style={{ background: DOT_COLOR[e.kind] }} />
              <div className="search-info">
                <div className="search-name">{e.name}</div>
                <div className="search-detail">{e.detail}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {open && query.trim() && results.length === 0 && (
        <div className="search-dropdown">
          <div className="search-empty">无匹配</div>
        </div>
      )}
    </div>
  );
}
