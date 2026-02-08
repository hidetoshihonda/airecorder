"use client";

import { ReactNode } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { RecordingProvider } from "@/contexts/RecordingContext";
import { I18nProvider } from "@/contexts/I18nContext";
import { TooltipProvider } from "@/components/ui/tooltip";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <AuthProvider>
      <I18nProvider>
        <RecordingProvider>
          <TooltipProvider>{children}</TooltipProvider>
        </RecordingProvider>
      </I18nProvider>
    </AuthProvider>
  );
}
