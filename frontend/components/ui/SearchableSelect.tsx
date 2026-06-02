"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

export type SearchableSelectOption = {
  value: string;
  label: string;
  /** Shown under label; included in search match (e.g. email) */
  subtitle?: string;
};

type SearchableSelectProps = {
  id: string;
  /** Text label above the control */
  fieldLabel: ReactNode;
  value: string;
  onChange: (value: string) => void;
  options: SearchableSelectOption[];
  disabled?: boolean;
  searchPlaceholder?: string;
  /** When `value` is not in options (edge case) */
  fallbackTriggerLabel?: string;
  /** `jinoe` matches dashboard modals (firm border, white field). */
  variant?: "default" | "jinoe";
  /** When true, `fieldLabel` is visually hidden (still exposed to assistive tech). */
  labelSrOnly?: boolean;
};

function Chevron({ open, className }: { open: boolean; className?: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={["shrink-0 transition-transform", className ?? "text-[var(--ink-4)]", open ? "rotate-180" : ""].join(" ")}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function SearchIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden className="text-[var(--ink-5)]">
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="M20 20l-4-4" strokeLinecap="round" />
    </svg>
  );
}

export function SearchableSelect({
  id,
  fieldLabel,
  value,
  onChange,
  options,
  disabled = false,
  searchPlaceholder = "Search…",
  fallbackTriggerLabel = "Select…",
  variant = "default",
  labelSrOnly = false,
}: SearchableSelectProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const isJinoe = variant === "jinoe";

  const selected = useMemo(() => options.find((o) => o.value === value), [options, value]);
  const triggerText = selected?.label ?? fallbackTriggerLabel;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => {
      const hay = `${o.label} ${o.subtitle ?? ""}`.toLowerCase();
      return hay.includes(q);
    });
  }, [options, query]);

  const closeDropdown = useCallback(() => {
    setQuery("");
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    const t = requestAnimationFrame(() => searchRef.current?.focus());
    return () => cancelAnimationFrame(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const n = e.target as Node;
      if (rootRef.current && !rootRef.current.contains(n)) closeDropdown();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open, closeDropdown]);

  const pick = useCallback(
    (v: string) => {
      onChange(v);
      setQuery("");
      setOpen(false);
    },
    [onChange]
  );

  const labelWrapClass = labelSrOnly
    ? "sr-only"
    : isJinoe
      ? "mb-2 block text-[12px] font-extrabold text-slate-700"
      : "mb-1 block text-[12px] font-medium text-[var(--ink-2)]";

  const triggerClass = isJinoe
    ? [
        "flex h-9 w-full items-center justify-between gap-2 rounded-[6px] border border-[var(--line-strong)] bg-white px-2.5 text-left text-[13px] font-semibold text-neutral-950 shadow-none outline-none transition",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-[var(--ink-strong)]",
        open ? "border-[var(--ink-strong)] ring-2 ring-[var(--accent-soft)]" : "",
      ].join(" ")
    : [
        "ari-input flex h-9 w-full items-center justify-between gap-2 px-2.5 text-left text-[13px] text-[var(--ink-1)]",
        disabled ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-[var(--ink-4)]",
        open ? "border-[var(--ink-3)] ring-1 ring-[var(--line-strong)]" : "",
      ].join(" ");

  const panelClass = isJinoe
    ? "absolute left-0 right-0 top-[calc(100%+4px)] z-[140] flex max-h-[min(260px,calc(100vh-12rem))] flex-col overflow-hidden rounded-[8px] border border-[var(--ink-strong)] bg-white shadow-[var(--sh-pop)]"
    : "absolute left-0 right-0 top-[calc(100%+4px)] z-[120] flex max-h-[min(240px,calc(100vh-12rem))] flex-col overflow-hidden rounded-[8px] border border-[var(--line-strong)] bg-[var(--bg-raised)] shadow-[var(--sh-pop)]";

  const searchBarWrap = isJinoe
    ? "flex h-8 items-center gap-2 rounded-[6px] border border-[var(--line)] bg-[var(--bg-sunken)] px-2"
    : "flex h-8 items-center gap-2 rounded-[6px] border border-[var(--line)] bg-[var(--surface-muted)] px-2";

  const optionBtn = (active: boolean) =>
    isJinoe
      ? [
          "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-[13px] transition",
          active ? "bg-[var(--accent)] font-semibold text-[var(--ink-strong)]" : "text-neutral-950 hover:bg-[var(--bg-sunken)]",
        ].join(" ")
      : [
          "flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-[13px] transition",
          active ? "bg-[var(--bg-sunken)] text-[var(--ink-1)]" : "text-[var(--ink-2)] hover:bg-[var(--bg-sunken)]",
        ].join(" ");

  const subtitleClass = isJinoe ? "text-[11.5px] font-semibold text-slate-500" : "text-[11.5px] text-[var(--ink-5)]";

  const emptyClass = isJinoe ? "px-3 py-2.5 text-center text-[12.5px] font-semibold text-slate-500" : "px-3 py-2.5 text-center text-[12.5px] text-[var(--ink-5)]";

  return (
    <div ref={rootRef} className="relative">
      <span id={`${id}-label`} className={labelWrapClass}>
        {fieldLabel}
      </span>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-labelledby={`${id}-label`}
        onClick={() => {
          if (disabled) return;
          setOpen((prev) => {
            if (prev) setQuery("");
            return !prev;
          });
        }}
        className={triggerClass}
      >
        <span className="min-w-0 flex-1 truncate">{triggerText}</span>
        <Chevron open={open} className={isJinoe ? "text-slate-500" : undefined} />
      </button>

      {open ? (
        <div
          id={listboxId}
          role="listbox"
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            closeDropdown();
          }}
          className={panelClass}
        >
          <div className={["shrink-0 p-2", isJinoe ? "border-b border-[var(--line)]" : "border-b border-[var(--line)]"].join(" ")}>
            <div className={searchBarWrap}>
              <SearchIcon />
              <input
                ref={searchRef}
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Escape") return;
                  e.preventDefault();
                  e.stopPropagation();
                  closeDropdown();
                }}
                placeholder={searchPlaceholder}
                className={
                  isJinoe
                    ? "min-w-0 flex-1 bg-transparent text-[12.5px] font-semibold text-neutral-950 placeholder:font-medium placeholder:text-slate-400 focus:outline-none"
                    : "min-w-0 flex-1 bg-transparent text-[12.5px] text-[var(--ink-1)] placeholder:text-[var(--ink-5)] focus:outline-none"
                }
                autoComplete="off"
                aria-label="Search options"
              />
            </div>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto py-1" role="presentation">
            {filtered.length === 0 ? (
              <li className={emptyClass}>No matches</li>
            ) : (
              filtered.map((o) => {
                const active = o.value === value;
                return (
                  <li key={o.value === "" ? `empty-${o.label}` : o.value} role="presentation">
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => pick(o.value)}
                      className={optionBtn(active)}
                    >
                      <span className={isJinoe ? "font-extrabold" : "font-medium"}>{o.label}</span>
                      {o.subtitle ? <span className={subtitleClass}>{o.subtitle}</span> : null}
                    </button>
                  </li>
                );
              })
            )}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
