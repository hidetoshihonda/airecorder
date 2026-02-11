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
  // LLM 文字起こし補正 (Issue #70)
  correctedTranscript?: Transcript;
  correctionStatus?: "pending" | "processing" | "completed" | "failed";
  correctionError?: string;
  correctedAt?: string;
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
  // 注意書き（センシティブ情報がある場合）
  caution?: string;
  // 1. 会議情報
  meetingInfo?: {
    title: string;
    participants: string[];
    datetime: string;
    purpose: string;
  };
  // 2. アジェンダ一覧
  agenda?: string[];
  // 3. 議題別の詳細
  topics?: Array<{
    title: string;
    background: string;
    currentStatus: string;
    issues: string;
    discussion: string;
    examples: string;
    nextActions: string;
  }>;
  // 4. 決定事項
  decisions?: string[];
  // 5. ToDo / アクションアイテム（新形式）
  actionItems: ActionItem[];
  // 6. 重要メモ
  importantNotes?: string[];
  // メタ情報
  generatedAt: string;
  // 後方互換性のため残す（旧形式）
  overview?: string;
  keyPoints?: string[];
}

// Alias for backward compatibility
export type MeetingMinutes = Summary;

export interface ActionItem {
  id: string;
  // 新形式
  task?: string;
  context?: string;
  // 旧形式（後方互換性）
  description?: string;
  assignee?: string;
  dueDate?: string;
  completed?: boolean;
}

// ─── Meeting Template Types ───

export type TemplateId = "general" | "regular" | "one-on-one" | "sales" | "dev-sprint" | "brainstorm" | string;

export interface MeetingTemplate {
  id: TemplateId;
  nameKey: string;        // i18n key under "Templates" namespace
  descriptionKey: string;  // i18n key
  icon: string;           // Lucide icon name
  systemPrompt: string;   // System prompt sent to AI
  isPreset: boolean;      // true = built-in, false = user-created
  category?: string;
}

export interface CustomTemplate {
  id: string;
  name: string;
  description: string;
  systemPrompt: string;
  createdAt: string;
  updatedAt: string;
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
