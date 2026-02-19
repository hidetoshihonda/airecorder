"use client";

import { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { AuthProvider } from "@/contexts/AuthContext";
import { RecordingProvider } from "@/contexts/RecordingContext";
import { I18nProvider } from "@/contexts/I18nContext";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeSync } from "@/components/providers/ThemeSync";
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";
import { SwipeBackProvider } from "@/components/providers/SwipeBackProvider";
import { OfflineIndicator } from "@/components/pwa/OfflineIndicator";
import { InstallBanner } from "@/components/pwa/InstallBanner";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
      <AuthProvider>
        <ThemeSync />
        <ServiceWorkerRegistration />
        <SwipeBackProvider />
        <OfflineIndicator />
        <InstallBanner />
        <I18nProvider>
          <RecordingProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </RecordingProvider>
        </I18nProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
