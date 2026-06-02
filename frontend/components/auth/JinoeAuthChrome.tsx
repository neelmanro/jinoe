"use client";

import Image from "next/image";
import Link from "next/link";

export const pageBg = "bg-[var(--surface-app)]";

/** Secondary copy , blue-slate on light canvas */
export const authMutedBodyClass =
  "text-[0.9375rem] font-semibold leading-snug text-[var(--ink-4)]";

/** Text links on auth surfaces (neutral, not accent CTA color). */
export const authLinkClass =
  "inline-block cursor-pointer border-0 bg-transparent p-0 text-center font-bold text-[0.9375rem] text-neutral-950 underline decoration-2 underline-offset-[3px] decoration-neutral-950/35 hover:text-neutral-700";

/** Shared field style. WebKit autofill otherwise paints its own bg/text over our tokens. */
export const inputClass =
  "block w-full rounded-[6px] border-2 border-[var(--line-strong)] bg-[var(--bg-raised)] px-3 py-3 text-sm font-semibold text-[var(--ink-strong)] shadow-none outline-none transition placeholder:font-medium placeholder:text-[var(--ink-5)] focus:border-[var(--accent)] focus:ring-2 focus:ring-[var(--accent-line)] disabled:opacity-50 " +
  "[&:-webkit-autofill]:[-webkit-text-fill-color:var(--ink-strong)] [&:-webkit-autofill]:[box-shadow:0_0_0_1000px_var(--bg-raised)_inset] [&:-webkit-autofill]:[transition:background-color_99999s_ease-out_0s] " +
  "[&:-webkit-autofill:hover]:[box-shadow:0_0_0_1000px_var(--bg-raised)_inset] [&:-webkit-autofill:focus]:[box-shadow:0_0_0_1000px_var(--bg-raised)_inset] [&:-webkit-autofill:active]:[box-shadow:0_0_0_1000px_var(--bg-raised)_inset]";

export const primaryBtnClass =
  "flex w-full cursor-pointer items-center justify-center rounded-[6px] border border-black/10 bg-[var(--accent)] px-4 py-3.5 text-sm font-extrabold text-[var(--ink-strong)] shadow-[0_8px_18px_rgba(11,10,8,0.08)] transition hover:bg-[var(--accent-hover)] hover:border-black/20 focus:outline-none focus:ring-2 focus:ring-[var(--accent-line)] disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50";

const footerLegalLinkClass =
  "cursor-pointer font-bold text-neutral-950 underline decoration-2 underline-offset-[3px] decoration-neutral-950/35 hover:text-neutral-700";

export function FooterLegal({ variant }: { variant: "signup" | "login" }) {
  const terms = (
    <a href="#terms" className={footerLegalLinkClass} onClick={(e) => e.preventDefault()}>
      terms of service
    </a>
  );
  const privacy = (
    <a href="#privacy" className={footerLegalLinkClass} onClick={(e) => e.preventDefault()}>
      privacy policy
    </a>
  );

  if (variant === "login") {
    return (
      <p className="text-center text-sm font-semibold leading-relaxed text-[var(--ink-4)]">
        View our {terms} and {privacy}.
      </p>
    );
  }

  return (
    <p className="text-center text-sm font-semibold leading-relaxed text-[var(--ink-4)]">
      By signing up you agree to the {terms} and {privacy}.
    </p>
  );
}

type JinoeAuthChromeProps = {
  children: React.ReactNode;
  /** Signup mentions accepting terms; login only links to them. */
  footerLegal?: "signup" | "login";
};

export function JinoeAuthChrome({ children, footerLegal = "signup" }: JinoeAuthChromeProps) {
  return (
    <div className={`relative min-h-dvh ${pageBg} font-sans text-[var(--ink-strong)] antialiased`}>
      <Link
        href="/"
        className="absolute left-6 top-6 z-10 flex cursor-pointer items-center rounded-md ring-[var(--accent)]/0 transition hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-line)]"
        aria-label="Jinoe home"
      >
        <span className="relative block h-10 w-[11.5rem] max-w-[min(184px,calc(100vw-5rem))] shrink-0 sm:h-10 sm:w-[12.5rem] sm:max-w-[208px]">
          <Image
            src="/logo_and_name_v2.png"
            alt=""
            fill
            className="jinoe-wordmark object-contain object-left"
            sizes="(max-width:640px) min(184px,calc(100vw-5rem)), 208px"
            priority
          />
        </span>
      </Link>

      <main className="flex min-h-dvh w-full flex-col items-center justify-center px-4 py-16 pb-28 sm:px-6 sm:py-20 sm:pb-32">
        <div className="mx-auto w-full max-w-[400px]">{children}</div>
      </main>

      <footer className="absolute inset-x-0 bottom-0 px-4 pb-8 pt-2 sm:px-6">
        <FooterLegal variant={footerLegal} />
      </footer>
    </div>
  );
}
