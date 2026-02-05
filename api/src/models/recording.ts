// Recording data model
export interface TranscriptSegment {
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
  overview: string;
  keyPoints: string[];
  actionItems: string[];
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
}

// API request/response types
export interface CreateRecordingRequest {
  userId: string;
  title: string;
  sourceLanguage: string;
  duration: number;
  transcript?: Transcript;
  translations?: { [languageCode: string]: Translation };
}

export interface UpdateRecordingRequest {
  title?: string;
  transcript?: Transcript;
  translations?: { [languageCode: string]: Translation };
  summary?: Summary;
  tags?: string[];
  folderId?: string;
  status?: Recording["status"];
}

export interface ListRecordingsQuery {
  userId: string;
  page?: number;
  limit?: number;
  folderId?: string;
  search?: string;
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
