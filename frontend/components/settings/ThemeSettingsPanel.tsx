"use client";

import { useTheme, type ThemePreference } from "@/components/theme/ThemeProvider";

const OPTIONS: Array<{
  value: ThemePreference;
  label: string;
  description: string;
}> = [
  { value: "light", label: "Light", description: "Bright interface" },
  { value: "dark", label: "Dark", description: "Dark canvas" },
];

function MoonIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M20.5 14.5A8.2 8.2 0 0 1 9.5 3.5 8.7 8.7 0 1 0 20.5 14.5z" />
    </svg>
  );
}

function SunIcon({ className }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2" />
      <path d="M12 20v2" />
      <path d="M4.93 4.93l1.41 1.41" />
      <path d="M17.66 17.66l1.41 1.41" />
      <path d="M2 12h2" />
      <path d="M20 12h2" />
      <path d="M4.93 19.07l1.41-1.41" />
      <path d="M17.66 6.34l1.41-1.41" />
    </svg>
  );
}

function optionIcon(value: ThemePreference, className?: string) {
  if (value === "dark") return <MoonIcon className={className} />;
  return <SunIcon className={className} />;
}

export function ThemeSettingsPanel() {
  const { preference, setPreference } = useTheme();

  return (
    <section className="max-w-[560px]">
      <h2 className="text-[13px] font-medium uppercase tracking-[0.06em] text-[var(--ink-5)]">Appearance</h2>
      <p className="mt-2 max-w-[50ch] text-[13px] leading-relaxed text-[var(--ink-4)]">
        Theme applies across this workspace in your browser.
      </p>

      <div
        className="mt-5 flex w-full max-w-md rounded-[10px] bg-[var(--bg-sunken)] p-1 ring-1 ring-[var(--line-faint)]"
        role="radiogroup"
        aria-label="Color theme"
      >
        {OPTIONS.map((option) => {
          const active = preference === option.value;
          return (
            <button
              key={option.value}
              type="button"
              role="radio"
              aria-checked={active}
              onClick={() => setPreference(option.value)}
              className={[
                "flex min-w-0 flex-1 flex-col items-center gap-1 rounded-[8px] px-2 py-2.5 text-center transition-colors sm:flex-row sm:justify-center sm:gap-2 sm:px-3",
                active
                  ? "bg-[var(--bg-raised)] text-[var(--ink-strong)] shadow-[var(--sh-1)] ring-1 ring-[var(--line)]"
                  : "text-[var(--ink-4)] hover:text-[var(--ink-strong)]",
              ].join(" ")}
            >
              <span className={active ? "text-[var(--ink-strong)]" : "text-[var(--ink-5)]"}>{optionIcon(option.value)}</span>
              <span className="min-w-0">
                <span className="block text-[12px] font-semibold sm:inline sm:text-[13px]">{option.label}</span>
                <span className="hidden text-[11px] text-[var(--ink-5)] sm:ml-1 sm:inline">· {option.description}</span>
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
