"use client";

import { DashboardPage } from "@/components/sidebar/DashboardPage";
import { useAuth } from "@/components/auth/auth-context";
import { ThemeSettingsPanel } from "@/components/settings/ThemeSettingsPanel";

function initials(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map((part) => part[0])
    .slice(0, 2)
    .join("")
    .toUpperCase() || "U";
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 py-3.5 sm:grid-cols-[minmax(0,140px)_minmax(0,1fr)] sm:gap-8 sm:py-3">
      <dt className="text-[12px] font-medium text-[var(--ink-5)]">{label}</dt>
      <dd className="min-w-0 break-words text-[13px] text-[var(--ink-strong)]">{value}</dd>
    </div>
  );
}

export default function SettingsPage() {
  const { user, role } = useAuth();

  const displayName = user?.full_name?.trim() || "Account";
  const company = user?.company_name?.trim() || "Not set";
  const roleLabel = role ? role[0]!.toUpperCase() + role.slice(1) : "Member";

  return (
    <DashboardPage
      title="Profile"
      description="Your account details and preferences for this workspace."
    >
      <div className="mx-auto grid max-w-[560px] gap-10">
        <section>
          <div className="flex min-w-0 items-center gap-4">
            <div className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-[var(--ink-strong)] text-[14px] font-semibold text-white">
              {initials(displayName)}
            </div>
            <div className="min-w-0">
              <h2 className="truncate text-[16px] font-semibold tracking-tight text-[var(--ink-strong)]">{displayName}</h2>
              <p className="mt-0.5 truncate text-[13px] text-[var(--ink-4)]">{user?.email ?? "No email"}</p>
            </div>
          </div>

          <dl className="mt-6 divide-y divide-[var(--line-faint)]">
            <InfoRow label="Full name" value={displayName} />
            <InfoRow label="Email" value={user?.email ?? "Not available"} />
            <InfoRow label="Company" value={company} />
            <InfoRow label="Account role" value={roleLabel} />
          </dl>
        </section>

        <ThemeSettingsPanel />
      </div>
    </DashboardPage>
  );
}
