import React, { useState, useRef, useEffect, useMemo } from "react";
import { Search, X } from "lucide-react";
import { outletNames } from "../lib/format";

/**
 * Searchable item picker (combobox) — type to filter, click to pick.
 * Props:
 *  - items:     array of { id, name, sku, unit, cost, outlet_code, category }
 *  - value:     selected item id (string) or ""
 *  - onChange:  (item_id) => void
 *  - testid:    base data-testid for the input
 *  - placeholder
 */
export function ItemPicker({ items, value, onChange, testid, placeholder = "Type to search item..." }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);

  const selected = useMemo(() => items.find((i) => i.id === value), [items, value]);

  // Sync input when a selection exists and the picker is closed
  useEffect(() => {
    if (!open && selected) setQuery(`${selected.name} (${selected.sku})`);
    if (!open && !selected) setQuery("");
  }, [selected, open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // When a picked item's label matches the query verbatim we treat as "no search" so all items show
    if (selected && query === `${selected.name} (${selected.sku})`) return items;
    if (!q) return items;
    return items.filter((it) => {
      return (
        (it.name || "").toLowerCase().includes(q) ||
        (it.sku || "").toLowerCase().includes(q) ||
        (it.category || "").toLowerCase().includes(q)
      );
    });
  }, [items, query, selected]);

  useEffect(() => {
    setHighlight(0);
  }, [query, open]);

  useEffect(() => {
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const commit = (it) => {
    onChange(it.id);
    setQuery(`${it.name} (${it.sku})`);
    setOpen(false);
  };

  const clear = () => {
    onChange("");
    setQuery("");
    inputRef.current?.focus();
    setOpen(true);
  };

  const onKey = (e) => {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = filtered[highlight];
      if (it) commit(it);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  return (
    <div className="item-picker" ref={wrapRef}>
      <div className="item-picker-input">
        <Search size={14} />
        <input
          ref={inputRef}
          data-testid={testid}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Typing clears the selection so the parent knows nothing is chosen anymore
            if (value) onChange("");
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKey}
          placeholder={placeholder}
          autoComplete="off"
          spellCheck={false}
        />
        {(query || value) && (
          <button
            type="button"
            className="item-picker-clear"
            aria-label="Clear item"
            data-testid={`${testid}-clear`}
            onClick={clear}
          >
            <X size={12} />
          </button>
        )}
      </div>
      {open && (
        <div className="item-picker-menu" role="listbox" data-testid={`${testid}-menu`}>
          {filtered.length === 0 && (
            <div className="item-picker-empty">No items match "{query}"</div>
          )}
          {filtered.slice(0, 100).map((it, idx) => (
            <button
              type="button"
              key={it.id}
              role="option"
              aria-selected={idx === highlight}
              data-testid={`${testid}-option-${it.id}`}
              className={`item-picker-option ${idx === highlight ? "is-active" : ""} ${it.id === value ? "is-selected" : ""}`}
              onMouseEnter={() => setHighlight(idx)}
              onClick={() => commit(it)}
            >
              <div className="item-picker-main">
                <strong>{it.name}</strong>
                <span className="sku">{it.sku}</span>
              </div>
              <div className="item-picker-meta">
                {it.category && <span>{it.category}</span>}
                {it.outlet_code && <span>{outletNames[it.outlet_code] || it.outlet_code}</span>}
                {it.unit && <span>{it.unit}</span>}
              </div>
            </button>
          ))}
          {filtered.length > 100 && (
            <div className="item-picker-empty">
              +{filtered.length - 100} more — refine your search
            </div>
          )}
        </div>
      )}
    </div>
  );
}
