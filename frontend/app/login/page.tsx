"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CodeDigitBoxes } from "@/components/auth/CodeDigitBoxes";
import { PasswordInputWithToggle } from "@/components/auth/PasswordInputWithToggle";
import {
  JinoeAuthChrome,
  authLinkClass,
  authMutedBodyClass,
  inputClass,
  primaryBtnClass,
} from "@/components/auth/JinoeAuthChrome";
import {
  apiRequest,
  type AuthPayload,
  type LoginApiResult,
  setStoredToken,
} from "@/components/auth/auth-context";
import { AuthSubmitSpinner } from "@/components/auth/AuthSubmitChrome";
import { AUTH_SUBMIT_MIN_MS, ensureMinElapsedSince } from "@/components/auth/auth-submit-ux";

type Step = "password" | "code";

export default function LoginPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function resetToPassword() {
    setStep("password");
    setChallengeId(null);
    setCode("");
    setError(null);
  }

  async function handlePasswordSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const started = performance.now();
    try {
      const res = await apiRequest<LoginApiResult>("/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (res.verification_required && res.challenge_id) {
        setChallengeId(res.challenge_id);
        setStep("code");
        return;
      }
      if (res.access_token) {
        await ensureMinElapsedSince(started, AUTH_SUBMIT_MIN_MS);
        setStoredToken(res.access_token);
        const nextPath = new URLSearchParams(window.location.search).get("next");
        router.push(nextPath || "/tasks");
        return;
      }
      setError("Unexpected response from server");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCodeSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!challengeId) return;
    setError(null);
    setSubmitting(true);
    const started = performance.now();
    try {
      const payload = await apiRequest<AuthPayload>(
        "/auth/verify-code",
        {
          method: "POST",
          body: JSON.stringify({ challenge_id: challengeId, code }),
        },
        null,
      );
      await ensureMinElapsedSince(started, AUTH_SUBMIT_MIN_MS);
      setStoredToken(payload.access_token);
      const nextPath = new URLSearchParams(window.location.search).get("next");
      router.push(nextPath || "/tasks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <JinoeAuthChrome>
      {step === "password" ? (
        <>
          <div className="mb-8 space-y-2 text-center">
            <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-tight text-neutral-950">
              Welcome to Jinoe
            </h1>
            <p className={authMutedBodyClass}>Build software with your team and AI in one workspace.</p>
          </div>

          <form onSubmit={handlePasswordSubmit} className="space-y-3">
            {error ? (
              <div
                className="rounded-[6px] border-2 border-red-400 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-900"
                role="alert"
              >
                {error}
              </div>
            ) : null}
            <input
              id="login-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={inputClass}
              placeholder="Enter your email address"
              aria-label="Email"
            />
            <PasswordInputWithToggle
              id="login-password"
              name="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password"
              ariaLabel="Password"
            />
            <div className="space-y-2 pt-1">
              <button type="submit" disabled={submitting} className={primaryBtnClass}>
                <span className="inline-flex items-center justify-center gap-2.5">
                  {submitting ? <AuthSubmitSpinner /> : null}
                  {submitting ? "Signing you in, one moment…" : "Sign in"}
                </span>
              </button>
            </div>
          </form>

          <div className="mt-6 text-center">
            <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2">
              <Link href="/signup" className={authLinkClass}>
                Create account
              </Link>
              <span className="hidden h-4 w-px bg-blue-300 sm:inline" aria-hidden />
              <a href="#forgot" className={authLinkClass} onClick={(e) => e.preventDefault()}>
                Forgot password
              </a>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="mb-8 space-y-2 text-center">
            <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-tight text-neutral-950">Check your email</h1>
            <p className={authMutedBodyClass}>
              We sent a 6-digit code to {email}. Enter it below to finish signing in.
            </p>
          </div>

          <form onSubmit={handleCodeSubmit} className="space-y-3">
            {error ? (
              <div
                className="rounded-[6px] border-2 border-red-400 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-900"
                role="alert"
              >
                {error}
              </div>
            ) : null}
            <CodeDigitBoxes
              idPrefix="login"
              value={code}
              onChange={setCode}
              disabled={submitting}
              autoFocus
            />
            <div className="space-y-2">
              <button type="submit" disabled={submitting || code.length < 6} className={primaryBtnClass}>
                <span className="inline-flex items-center justify-center gap-2.5">
                  {submitting ? <AuthSubmitSpinner /> : null}
                  {submitting ? "Checking your code, one moment…" : "Verify and sign in"}
                </span>
              </button>
            </div>
          </form>

          <p className="mt-6 text-center">
            <button type="button" className={authLinkClass} onClick={resetToPassword}>
              Use a different email
            </button>
          </p>
        </>
      )}
    </JinoeAuthChrome>
  );
}
