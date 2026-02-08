export interface Recording {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  duration: number; // seconds
  audioUrl?: string;
  sourceLanguage: string;
  transcript?: Transcript;
  translations?: Record<string, Translation>;
  summary?: Summary;
  tags?: string[];
  folderId?: string;
  status?: "recording" | "processing" | "completed" | "error";
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

/** リアルタイム表示用のセグメント型（TranscriptSegment は保存用） */
export interface LiveSegment {
  /** ユニーク ID（React key として使用） */
  id: string;
  /** 確定テキスト */
  text: string;
  /** 話者 ID（ConversationTranscriber: "Guest-1" 等、通常モード: undefined） */
  speaker?: string;
  /** 話者ラベル（ユーザーが設定した表示名、例: "田中さん"） */
  speakerLabel?: string;
  /** 発話開始タイムスタンプ（ms, 録音開始からの相対） */
  timestamp: number;
  /** 発話時間（ms） */
  duration?: number;
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
  enableSpeakerDiarization: boolean;
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
