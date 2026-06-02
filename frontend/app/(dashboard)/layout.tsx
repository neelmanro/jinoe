import type { ReactNode } from "react";
import { AuthGate, AuthProvider } from "@/components/auth/auth-context";
import { DashboardToastHost } from "@/components/DashboardToastHost";
import { AppSidebar } from "@/components/sidebar/AppSidebar";
import { ProjectProvider } from "@/components/sidebar/project-context";
import { WorkspaceOnboardingGate } from "@/components/sidebar/WorkspaceOnboardingGate";
import { WorkspaceAssistantDock } from "@/components/sidebar/WorkspaceAssistantDock";
import { WorkspaceChromeProvider } from "@/components/sidebar/workspace-chrome-context";

export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <AuthGate>
        <ProjectProvider>
          <WorkspaceChromeProvider>
            <div className="relative h-dvh min-h-0 w-full overflow-hidden bg-[var(--surface-app)]">
              <div className="relative z-10 flex h-full min-h-0 w-full">
                <AppSidebar />
                <WorkspaceAssistantDock>
                  <DashboardToastHost />
                  <WorkspaceOnboardingGate>{children}</WorkspaceOnboardingGate>
                </WorkspaceAssistantDock>
              </div>
            </div>
          </WorkspaceChromeProvider>
        </ProjectProvider>
      </AuthGate>
    </AuthProvider>
  );
}
