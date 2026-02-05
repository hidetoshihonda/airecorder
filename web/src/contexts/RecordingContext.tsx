"use client";

import { createContext, useContext, useState, useCallback, ReactNode } from "react";
import { Recording, Transcript, Translation, MeetingMinutes } from "@/types";

interface RecordingContextType {
  // Current recording state
  currentRecording: Recording | null;
  setCurrentRecording: (recording: Recording | null) => void;
  
  // Recordings list
  recordings: Recording[];
  setRecordings: (recordings: Recording[]) => void;
  addRecording: (recording: Recording) => void;
  removeRecording: (id: string) => void;
  
  // Active transcript
  activeTranscript: Transcript | null;
  setActiveTranscript: (transcript: Transcript | null) => void;
  
  // Translations
  translations: Translation[];
  setTranslations: (translations: Translation[]) => void;
  addTranslation: (translation: Translation) => void;
  
  // Meeting minutes
  meetingMinutes: MeetingMinutes | null;
  setMeetingMinutes: (minutes: MeetingMinutes | null) => void;
  
  // UI state
  isTranscribing: boolean;
  setIsTranscribing: (value: boolean) => void;
  isTranslating: boolean;
  setIsTranslating: (value: boolean) => void;
  isGeneratingMinutes: boolean;
  setIsGeneratingMinutes: (value: boolean) => void;
}

const RecordingContext = createContext<RecordingContextType | undefined>(undefined);

interface RecordingProviderProps {
  children: ReactNode;
}

export function RecordingProvider({ children }: RecordingProviderProps) {
  const [currentRecording, setCurrentRecording] = useState<Recording | null>(null);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [activeTranscript, setActiveTranscript] = useState<Transcript | null>(null);
  const [translations, setTranslations] = useState<Translation[]>([]);
  const [meetingMinutes, setMeetingMinutes] = useState<MeetingMinutes | null>(null);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [isTranslating, setIsTranslating] = useState(false);
  const [isGeneratingMinutes, setIsGeneratingMinutes] = useState(false);

  const addRecording = useCallback((recording: Recording) => {
    setRecordings((prev) => [recording, ...prev]);
  }, []);

  const removeRecording = useCallback((id: string) => {
    setRecordings((prev) => prev.filter((r) => r.id !== id));
  }, []);

  const addTranslation = useCallback((translation: Translation) => {
    setTranslations((prev) => {
      // Replace if same language exists
      const exists = prev.findIndex((t) => t.languageCode === translation.languageCode);
      if (exists >= 0) {
        const updated = [...prev];
        updated[exists] = translation;
        return updated;
      }
      return [...prev, translation];
    });
  }, []);

  const value: RecordingContextType = {
    currentRecording,
    setCurrentRecording,
    recordings,
    setRecordings,
    addRecording,
    removeRecording,
    activeTranscript,
    setActiveTranscript,
    translations,
    setTranslations,
    addTranslation,
    meetingMinutes,
    setMeetingMinutes,
    isTranscribing,
    setIsTranscribing,
    isTranslating,
    setIsTranslating,
    isGeneratingMinutes,
    setIsGeneratingMinutes,
  };

  return (
    <RecordingContext.Provider value={value}>
      {children}
    </RecordingContext.Provider>
  );
}

export function useRecordingContext() {
  const context = useContext(RecordingContext);
  if (context === undefined) {
    throw new Error("useRecordingContext must be used within a RecordingProvider");
  }
  return context;
}
