// Recording data model
export interface TranscriptSegment {
  id?: string;
  speaker?: string;
  text: string;
  startTime: number;
  endTime: number;
}

export interface Transcript {
  segments: TranscriptSegment[];
  fullText: string;
}

export interface Translation {
  language: string;
  segments: TranscriptSegment[];
  fullText: string;
}

export interface Summary {
  // 新形式（v2）
  caution?: string;
  meetingInfo?: {
    title: string;
    participants: string[];
    datetime: string;
    purpose: string;
  };
  agenda?: string[];
  topics?: Array<{
    title: string;
    content?: string;
    background?: string;
    currentStatus?: string;
    issues?: string;
    discussion?: string;
    examples?: string;
    nextActions?: string;
  }>;
  qaItems?: Array<{
    question: string;
    answer: string;
  }>;
  decisions?: string[];
  actionItems: Array<{
    id: string;
    task: string;
    assignee: string;
    dueDate: string;
    context: string;
  }> | string[];
  importantNotes?: string[];
  nextSteps?: string[];
  generatedAt?: string;
  // 後方互換性（旧形式）
  overview?: string;
  keyPoints?: string[];
}

export interface Recording {
  id: string;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  duration: number; // in seconds
  sourceLanguage: string;
  audioUrl?: string;
  audioBlobName?: string;
  transcript?: Transcript;
  translations?: { [languageCode: string]: Translation };
  summary?: Summary;
  tags?: string[];
  folderId?: string;
  status: "recording" | "processing" | "completed" | "error";
  // LLM 文字起こし補正 (Issue #70)
  correctedTranscript?: Transcript;
  correctionStatus?: "pending" | "processing" | "completed" | "failed";
  correctionError?: string;
  correctedAt?: string;
  // 翻訳AI補正 (Issue #125)
  correctedTranslations?: { [languageCode: string]: Translation };
  translationCorrectionStatus?: "pending" | "processing" | "completed" | "failed";
  translationCorrectionError?: string;
  translationCorrectedAt?: string;
  // 話者ラベルマッピング (Issue #140)
  speakerLabels?: Record<string, string>;
  // マインドマップ (Issue #88)
  mindmapMarkdown?: string;
}

// API request/response types
export interface CreateRecordingRequest {
  userId: string;
  title: string;
  sourceLanguage: string;
  duration: number;
  audioUrl?: string;
  transcript?: Transcript;
  translations?: { [languageCode: string]: Translation };
  speakerLabels?: Record<string, string>;
}

export interface UpdateRecordingRequest {
  title?: string;
  transcript?: Transcript;
  translations?: { [languageCode: string]: Translation };
  summary?: Summary;
  tags?: string[];
  folderId?: string;
  status?: Recording["status"];
  speakerLabels?: Record<string, string>;
}

export interface ListRecordingsQuery {
  userId: string;
  page?: number;
  limit?: number;
  folderId?: string;
  search?: string;
  tag?: string;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  hasMore: boolean;
}

// User Settings model
export interface UserSettings {
  defaultSourceLanguage: string;
  defaultTargetLanguages: string[];
  theme: "light" | "dark" | "system";
  autoSaveRecordings: boolean;
  audioQuality: "low" | "medium" | "high";
  noiseSuppression: boolean;
  enableSpeakerDiarization: boolean;
  phraseList?: string[];
  defaultAudioSource?: "mic" | "system" | "both";  // Issue #167
}

export interface UserSettingsDocument {
  id: string;           // = userId
  userId: string;       // パーティションキー
  settings: UserSettings;
  updatedAt: string;    // ISO 8601
  createdAt: string;    // ISO 8601
}
