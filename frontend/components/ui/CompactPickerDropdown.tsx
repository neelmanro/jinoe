"use client";

import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";

export type CompactPickerItem = {
  id: string;
  label: string;
};

type CompactPickerDropdownProps = {
  id: string;
  /** Matches `label htmlFor` / `aria-labelledby` target when present */
  ariaLabelledBy?: string;
  /** Used when `ariaLabelledBy` is omitted (e.g. no visible label) */
  ariaLabel?: string;
  value: string;
  onChange: (id: string) => void;
  items: CompactPickerItem[];
  disabled?: boolean;
  /** Shown in trigger when `items` is empty */
  emptyText?: string;
  /** When `value` is missing from `items` */
  fallbackTriggerLabel?: string;
  /** Rename item label (opens prompt / modal from parent) */
  onRename?: (id: string) => void;
  onDelete?: (id: string) => void;
  /** Disable rename/delete affordances (e.g. pending message) */
  actionsDisabled?: boolean;
  /** Open the list above the trigger (use when the trigger sits at the bottom of an overflow-hidden panel). */
  menuPlacement?: "bottom" | "top";
};

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
      className={["shrink-0 text-[var(--ink-4)] transition-transform duration-200", open ? "rotate-180" : ""].join(
        " ",
      )}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

function RenameIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 20h9M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={14}
      height={14}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6h14zM10 11v6M14 11v6" />
    </svg>
  );
}

export function CompactPickerDropdown({
  id,
  ariaLabelledBy,
  ariaLabel,
  value,
  onChange,
  items,
  disabled = false,
  emptyText = "No options",
  fallbackTriggerLabel = "Select…",
  onRename,
  onDelete,
  actionsDisabled = false,
  menuPlacement = "bottom",
}: CompactPickerDropdownProps) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);

  const selected = useMemo(() => items.find((o) => o.id === value), [items, value]);

  const triggerText = useMemo(() => {
    if (items.length === 0) return emptyText;
    if (selected) return selected.label;
    return fallbackTriggerLabel;
  }, [items.length, selected, emptyText, fallbackTriggerLabel]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const n = e.target as Node;
      if (rootRef.current && !rootRef.current.contains(n)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const pick = useCallback(
    (itemId: string) => {
      onChange(itemId);
      setOpen(false);
      triggerRef.current?.focus();
    },
    [onChange],
  );

  const showActions = Boolean(onRename || onDelete);
  const actionsOff = actionsDisabled || disabled;

  const listEmpty = items.length === 0;

  const listboxLabelledBy = ariaLabelledBy ?? id;

  return (
    <div ref={rootRef} className="relative min-w-0 w-full">
      <button
        ref={triggerRef}
        id={id}
        type="button"
        disabled={disabled || listEmpty}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listboxId}
        {...(ariaLabelledBy
          ? { "aria-labelledby": ariaLabelledBy }
          : { "aria-label": ariaLabel ?? "Choose a conversation" })}
        onClick={() => !disabled && !listEmpty && setOpen((o) => !o)}
        className={[
          "ari-input flex h-9 w-full min-w-0 items-center justify-between gap-2 px-2.5 text-left text-[13px] font-medium text-[var(--ink-1)]",
          disabled || listEmpty ? "cursor-not-allowed opacity-50" : "cursor-pointer hover:border-[var(--ink-4)]",
          open && !listEmpty ? "border-[var(--ink-3)] ring-1 ring-[var(--line-strong)]" : "",
        ].join(" ")}
      >
        <span className="min-w-0 flex-1 truncate">{triggerText}</span>
        <Chevron open={open} />
      </button>

      {open && !listEmpty ? (
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={listboxLabelledBy}
          className={[
            "absolute left-0 right-0 z-[140] flex max-h-[min(280px,calc(100vh-10rem))] flex-col overflow-hidden rounded-[10px] border border-[var(--line-strong)] bg-[rgba(255,255,255,0.97)] shadow-[var(--sh-pop)] backdrop-blur-xl",
            menuPlacement === "top" ? "bottom-[calc(100%+4px)]" : "top-[calc(100%+4px)]",
          ].join(" ")}
        >
          <ul className="min-h-0 overflow-y-auto py-1" role="presentation">
            {items.map((item) => {
              const active = item.id === value;
              return (
                <li key={item.id} role="presentation" className="group/row px-1">
                  <div
                    className={[
                      "flex min-h-[36px] items-stretch gap-0.5 rounded-[8px] transition-colors",
                      active ? "bg-[var(--accent-soft)]" : "hover:bg-[var(--surface-muted)]",
                    ].join(" ")}
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={active}
                      onClick={() => pick(item.id)}
                      className={[
                        "flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)]",
                        active
                          ? "font-semibold text-[var(--ink-strong)]"
                          : "font-medium text-[var(--ink-2)] group-hover/row:text-[var(--ink-1)]",
                      ].join(" ")}
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      {active ? (
                        <svg
                          width={14}
                          height={14}
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth={2.2}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden
                          className="shrink-0 text-[var(--ink-strong)]"
                        >
                          <path d="M5 12l5 5 9-11" />
                        </svg>
                      ) : null}
                    </button>
                    {showActions ? (
                      <div className="flex shrink-0 items-center gap-0.5 pr-1">
                        {onRename ? (
                          <button
                            type="button"
                            tabIndex={-1}
                            disabled={actionsOff}
                            title="Rename"
                            aria-label={`Rename ${item.label}`}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (actionsOff) return;
                              setOpen(false);
                              onRename(item.id);
                            }}
                            className={[
                              "flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--ink-5)] transition",
                              actionsOff
                                ? "cursor-not-allowed opacity-35"
                                : "hover:bg-black/[0.06] hover:text-[var(--accent)]",
                            ].join(" ")}
                          >
                            <RenameIcon />
                          </button>
                        ) : null}
                        {onDelete ? (
                          <button
                            type="button"
                            tabIndex={-1}
                            disabled={actionsOff}
                            title="Delete"
                            aria-label={`Delete ${item.label}`}
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (actionsOff) return;
                              setOpen(false);
                              onDelete(item.id);
                            }}
                            className={[
                              "flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--ink-5)] transition",
                              actionsOff
                                ? "cursor-not-allowed opacity-35"
                                : "hover:bg-red-50 hover:text-[#b91c1c]",
                            ].join(" ")}
                          >
                            <TrashIcon />
                          </button>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
