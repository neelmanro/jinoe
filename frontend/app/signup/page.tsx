"use client";

import Link from "next/link";
import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
  type AuthResponse,
  setStoredToken,
} from "@/components/auth/auth-context";
import { AuthSubmitSpinner } from "@/components/auth/AuthSubmitChrome";
import { AUTH_SUBMIT_MIN_MS, ensureMinElapsedSince } from "@/components/auth/auth-submit-ux";

type Step = "form" | "code";

function SignupPageInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const inviteToken = searchParams.get("invite");

  const [step, setStep] = useState<Step>("form");
  const [fullName, setFullName] = useState("");
  const [companyName, setCompanyName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [inviteEmailLocked, setInviteEmailLocked] = useState(false);
  const [inviteResolving, setInviteResolving] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const isInviteSignup = Boolean(inviteToken);

  useEffect(() => {
    if (!inviteToken) return;

    let cancelled = false;
    void (async () => {
      setInviteResolving(true);
      try {
        const res = await apiRequest<{ status: string; email: string }>(
          "/auth/invite/open",
          { method: "POST", body: JSON.stringify({ token: inviteToken }) },
          null,
        );
        if (!cancelled) {
          setEmail(res.email);
          setInviteEmailLocked(true);
          setCompanyName("");
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not validate this invite.");
          setInviteEmailLocked(false);
        }
      } finally {
        if (!cancelled) setInviteResolving(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [inviteToken]);

  async function handleFormSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const started = performance.now();
    try {
      const res = await apiRequest<AuthResponse>("/auth/signup", {
        method: "POST",
        body: JSON.stringify({
          full_name: fullName,
          company_name: isInviteSignup ? null : companyName.trim() || null,
          email,
          password,
          invite_token: inviteToken || null,
        }),
      });
      if (res.verification_required && res.challenge_id) {
        setChallengeId(res.challenge_id);
        setStep("code");
        return;
      }
      if (res.access_token) {
        await ensureMinElapsedSince(started, AUTH_SUBMIT_MIN_MS);
        setStoredToken(res.access_token);
        router.push(res.role === "owner" ? "/projects/new" : "/tasks");
        return;
      }
      setError("Unexpected response from server");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create account");
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
      router.push(payload.role === "owner" ? "/projects/new" : "/tasks");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code");
    } finally {
      setSubmitting(false);
    }
  }

  function backToForm() {
    setStep("form");
    setChallengeId(null);
    setCode("");
    setError(null);
  }

  const formDisabled = Boolean(inviteToken && (inviteResolving || (error && !inviteEmailLocked)));

  const emailFieldClass =
    inviteEmailLocked || inviteResolving
      ? `${inputClass} cursor-not-allowed border-blue-200 bg-blue-50/80 text-slate-700`
      : inputClass;

  return (
    <JinoeAuthChrome>
      {step === "form" ? (
        <>
          <div className="mb-8 space-y-2 text-center">
            <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-tight text-neutral-950">Create account</h1>
            <p className={authMutedBodyClass}>Build software with your team and AI in one workspace.</p>
          </div>

          <form onSubmit={handleFormSubmit} className="space-y-3">
            {inviteToken && (inviteResolving || inviteEmailLocked) ? (
              <div className="rounded-[6px] border-2 border-blue-300 bg-blue-50/90 px-3 py-2.5 text-sm font-semibold text-blue-950">
                {inviteResolving
                  ? "Checking your invite…"
                  : "You’re joining with a team invite. Your email matches the invite , add your name and password below."}
              </div>
            ) : null}
            {error ? (
              <div
                className="rounded-[6px] border-2 border-red-400 bg-red-50 px-3 py-2.5 text-sm font-semibold text-red-900"
                role="alert"
              >
                {error}
              </div>
            ) : null}
            <input
              id="signup-full-name"
              name="fullName"
              type="text"
              autoComplete="name"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className={inputClass}
              placeholder="Full name"
              disabled={formDisabled}
              aria-label="Full name"
            />
            {!isInviteSignup ? (
              <input
                id="signup-company"
                name="companyName"
                type="text"
                autoComplete="organization"
                value={companyName}
                onChange={(e) => setCompanyName(e.target.value)}
                className={inputClass}
                placeholder="Company name (optional)"
                disabled={formDisabled}
                aria-label="Company name (optional)"
              />
            ) : null}
            <input
              id="signup-email"
              name="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => {
                if (!inviteEmailLocked) setEmail(e.target.value);
              }}
              readOnly={inviteEmailLocked || inviteResolving}
              className={emailFieldClass}
              placeholder={inviteEmailLocked ? "Email (from invite)" : "Enter your email address"}
              disabled={formDisabled}
              aria-label="Email"
            />
            <PasswordInputWithToggle
              id="signup-password"
              name="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Password (at least 8 characters)"
              ariaLabel="Password"
              disabled={formDisabled}
            />
            <div className="space-y-2 pt-1">
              <button type="submit" disabled={submitting || formDisabled} className={primaryBtnClass}>
                <span className="inline-flex items-center justify-center gap-2.5">
                  {submitting ? <AuthSubmitSpinner /> : null}
                  {submitting ? "Setting up your account, one moment…" : "Create account"}
                </span>
              </button>
            </div>
          </form>

          <div className="mt-6 text-center text-sm font-semibold text-slate-600">
            <span>Already have an account? </span>
            <Link href="/login" className={authLinkClass}>
              Sign in
            </Link>
          </div>
        </>
      ) : (
        <>
          <div className="mb-8 space-y-2 text-center">
            <h1 className="text-[1.65rem] font-extrabold leading-tight tracking-tight text-neutral-950">Verify your email</h1>
            <p className={authMutedBodyClass}>
              {isInviteSignup
                ? "Unexpected step , invite signups skip email verification."
                : `We sent a 6-digit code to ${email}. Enter it to finish setting up your workspace.`}
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
              idPrefix="signup"
              value={code}
              onChange={setCode}
              disabled={submitting}
              autoFocus
            />
            <div className="space-y-2">
              <button type="submit" disabled={submitting || code.length < 6} className={primaryBtnClass}>
                <span className="inline-flex items-center justify-center gap-2.5">
                  {submitting ? <AuthSubmitSpinner /> : null}
                  {submitting ? "Checking your code, one moment…" : "Verify and continue"}
                </span>
              </button>
            </div>
          </form>

          <p className="mt-6 text-center">
            <button type="button" className={authLinkClass} onClick={backToForm}>
              Back
            </button>
          </p>
        </>
      )}
    </JinoeAuthChrome>
  );
}

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-dvh items-center justify-center bg-[#f3f6fb] text-sm font-bold text-blue-700">
          Loading…
        </div>
      }
    >
      <SignupPageInner />
    </Suspense>
  );
}
