"use client";

import { ReactNode } from "react";
import { AuthProvider } from "@/contexts/AuthContext";
import { RecordingProvider } from "@/contexts/RecordingContext";
import { TooltipProvider } from "@/components/ui/tooltip";

interface ProvidersProps {
  children: ReactNode;
}

export function Providers({ children }: ProvidersProps) {
  return (
    <AuthProvider>
      <RecordingProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </RecordingProvider>
    </AuthProvider>
  );
}
