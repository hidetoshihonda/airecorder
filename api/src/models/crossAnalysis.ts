// Cross-Meeting Analysis data models (Issue #90)

// === Request ===
export interface CrossAnalysisRequest {
  recordingIds: string[];
  userId: string;
  analysisType: "summary" | "trends" | "action-tracking" | "full";
  dateRange?: {
    start: string; // ISO 8601
    end: string;   // ISO 8601
  };
}

// === Response ===
export interface CrossAnalysisResponse {
  /** 全体サマリー（全録音を通した概要） */
  overallSummary: string;

  /** 共通テーマ */
  commonThemes: CommonTheme[];

  /** アクションアイテム進捗追跡 */
  actionItemTracking: ActionItemTrack[];

  /** 決定事項の変遷 */
  decisionEvolution: DecisionEvolution[];

  /** トレンド分析 */
  trends: TrendAnalysis;

  /** 分析対象の録音メタデータ */
  analyzedRecordings: AnalyzedRecording[];

  /** 生成日時 */
  generatedAt: string;
}

export interface CommonTheme {
  theme: string;
  description: string;
  mentionedIn: string[];   // recording titles
  frequency: number;
}

export interface ActionItemTrack {
  task: string;
  assignee: string;
  firstMentioned: string;  // "会議名 (yyyy/mm/dd)"
  lastMentioned: string;
  status: "new" | "in-progress" | "completed" | "stalled" | "dropped";
  history: Array<{
    recordingTitle: string;
    date: string;
    update: string;
  }>;
}

export interface DecisionEvolution {
  topic: string;
  decisions: Array<{
    recordingTitle: string;
    date: string;
    decision: string;
  }>;
}

export interface TrendAnalysis {
  topicFrequency: Record<string, number>;
  sentimentTrend?: string;
  recurringIssues: string[];
}

export interface AnalyzedRecording {
  id: string;
  title: string;
  date: string;
  duration: number;
}
