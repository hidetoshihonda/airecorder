export interface Recording {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  duration: number; // seconds
  audioUrl: string;
  sourceLanguage: string;
  transcript?: Transcript;
  translations?: Record<string, Translation>;
  summary?: Summary;
  tags?: string[];
  folderId?: string;
}

export interface Transcript {
  segments: TranscriptSegment[];
  fullText: string;
}

export interface TranscriptSegment {
  id: string;
  speaker?: string;
  text: string;
  startTime: number;
  endTime: number;
  confidence?: number;
}

export interface Translation {
  languageCode: string;
  segments: TranslationSegment[];
  fullText: string;
}

export interface TranslationSegment {
  originalSegmentId: string;
  text: string;
}

export interface Summary {
  overview: string;
  keyPoints: string[];
  actionItems: ActionItem[];
  generatedAt: string;
}

// Alias for backward compatibility
export type MeetingMinutes = Summary;

export interface ActionItem {
  id: string;
  description: string;
  assignee?: string;
  dueDate?: string;
  completed: boolean;
}

export interface User {
  id: string;
  email: string;
  displayName: string;
  settings: UserSettings;
  subscription?: Subscription;
  createdAt: string;
  updatedAt: string;
}

export interface UserSettings {
  defaultSourceLanguage: string;
  defaultTargetLanguages: string[];
  autoSaveRecordings: boolean;
  noiseSuppression: boolean;
  theme: "light" | "dark" | "system";
  audioQuality: "low" | "medium" | "high";
}

export interface Subscription {
  plan: "free" | "premium" | "enterprise";
  usageThisMonth: {
    speechMinutes: number;
    translationCharacters: number;
  };
  expiresAt?: string;
}

// Recording state during recording session
export interface RecordingSession {
  isRecording: boolean;
  isPaused: boolean;
  duration: number;
  sourceLanguage: string;
  targetLanguage: string;
  liveTranscript: TranscriptSegment[];
  liveTranslation: TranslationSegment[];
}

// API Response types
export interface ApiResponse<T> {
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
