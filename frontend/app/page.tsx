import Link from "next/link";
import Image from "next/image";

export default function Home() {
  return (
    <div className="flex min-h-full flex-1 flex-col items-center justify-center bg-[var(--surface-app)] px-6 py-20">
      <div className="w-full max-w-md text-center">
        <div className="mx-auto mb-8 flex justify-center">
          <span className="relative block h-12 w-[13rem]">
            <Image
              src="/logo_and_name_v2.png"
              alt="Jinoe"
              fill
              className="object-contain object-center"
              sizes="208px"
              priority
            />
          </span>
        </div>
        <h1 className="text-3xl font-extrabold tracking-tight text-[var(--ink-strong)]">
          Ship software from one AI workspace
        </h1>
        <p className="mt-3 text-sm font-semibold leading-relaxed text-[var(--ink-4)]">
          Create a project, invite teammates, assign tasks, and approve completed work before it ships.
        </p>
        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <Link
            className="inline-flex items-center justify-center rounded-[6px] border border-black/10 bg-[var(--accent)] px-5 py-2.5 text-sm font-extrabold text-[var(--ink-strong)] shadow-[0_8px_18px_rgba(11,10,8,0.08)] transition hover:border-black/20 hover:bg-[var(--accent-hover)]"
            href="/tasks"
          >
            Open app
          </Link>
          <Link
            className="inline-flex items-center justify-center rounded-[6px] border border-[var(--line-strong)] bg-white px-5 py-2.5 text-sm font-bold text-[var(--ink-3)] transition hover:border-[var(--ink-strong)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)]"
            href="/login"
          >
            Sign in
          </Link>
          <Link
            className="inline-flex items-center justify-center rounded-[6px] border border-[var(--line-strong)] bg-white px-5 py-2.5 text-sm font-bold text-[var(--ink-3)] transition hover:border-[var(--ink-strong)] hover:bg-[var(--bg-sunken)] hover:text-[var(--ink-strong)]"
            href="/signup"
          >
            Sign up
          </Link>
        </div>
      </div>
    </div>
  );
}
