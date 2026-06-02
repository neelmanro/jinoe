"use client";

import { useEffect, useRef } from "react";

const LENGTH = 6;

function toSlots(code: string): string[] {
  const digits = code.replace(/\D/g, "").slice(0, LENGTH);
  return Array.from({ length: LENGTH }, (_, i) => digits[i] ?? "");
}

const digitClass =
  "h-12 w-10 shrink-0 rounded-[6px] border-2 border-[var(--line-strong)] bg-[var(--bg-raised)] text-center text-xl font-extrabold tracking-tight text-[var(--ink-strong)] shadow-none outline-none transition focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-line)] disabled:cursor-not-allowed disabled:opacity-50 sm:h-14 sm:w-12 sm:text-2xl";

type CodeDigitBoxesProps = {
  value: string;
  onChange: (code: string) => void;
  disabled?: boolean;
  idPrefix: string;
  autoFocus?: boolean;
};

export function CodeDigitBoxes({ value, onChange, disabled, idPrefix, autoFocus }: CodeDigitBoxesProps) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const slots = toSlots(value);

  useEffect(() => {
    if (!autoFocus) return;
    const id = requestAnimationFrame(() => refs.current[0]?.focus());
    return () => cancelAnimationFrame(id);
  }, [autoFocus]);

  function focusAt(i: number) {
    requestAnimationFrame(() => refs.current[Math.max(0, Math.min(i, LENGTH - 1))]?.focus());
  }

  function handlePaste(i: number, text: string) {
    const incoming = text.replace(/\D/g, "").slice(0, LENGTH);
    if (!incoming) return;
    const nextSlots = toSlots(value);
    let k = 0;
    for (const ch of incoming) {
      if (i + k < LENGTH) nextSlots[i + k] = ch;
      k += 1;
    }
    onChange(nextSlots.join(""));
    focusAt(Math.min(i + incoming.length, LENGTH - 1));
  }

  function handleDigitChange(i: number, raw: string) {
    const ch = raw.replace(/\D/g, "").slice(-1) || "";
    const nextSlots = toSlots(value);
    nextSlots[i] = ch;
    onChange(nextSlots.join(""));
    if (ch && i < LENGTH - 1) focusAt(i + 1);
  }

  return (
    <fieldset className="border-0 p-0">
      <legend className="sr-only">Enter your 6-digit verification code</legend>
      <div className="flex justify-center gap-2 sm:gap-3">
        {slots.map((digit, i) => (
          <input
            key={`${idPrefix}-${i}`}
            ref={(el) => {
              refs.current[i] = el;
            }}
            id={`${idPrefix}-digit-${i}`}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            autoComplete={i === 0 ? "one-time-code" : "off"}
            name={i === 0 ? "code" : undefined}
            maxLength={1}
            disabled={disabled}
            value={digit}
            placeholder=""
            aria-label={`Digit ${i + 1} of ${LENGTH}`}
            className={digitClass}
            onChange={(e) => handleDigitChange(i, e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Backspace" && !digit && i > 0) {
                e.preventDefault();
                const next = toSlots(value);
                next[i - 1] = "";
                onChange(next.join(""));
                focusAt(i - 1);
              }
              if (e.key === "ArrowLeft" && i > 0) {
                e.preventDefault();
                focusAt(i - 1);
              }
              if (e.key === "ArrowRight" && i < LENGTH - 1) {
                e.preventDefault();
                focusAt(i + 1);
              }
            }}
            onPaste={(e) => {
              e.preventDefault();
              handlePaste(i, e.clipboardData.getData("text"));
            }}
          />
        ))}
      </div>
    </fieldset>
  );
}
