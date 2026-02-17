# Issue #126: リアルタイムAI補正 — 実装計画書

## 📋 概要

録音中にリアルタイムで文字起こしテキストをLLMで補正する機能。  
AI Cues（Issue #89）で実績のある「バッチ + デバウンス」パターンを転用し、アプローチB（5セグメントごとのバッチ補正）で実装する。

**コスト**: $0.014/会議（gpt-4o-mini）  
**レイテンシ**: 5〜10秒（バッチ蓄積 + API応答）  
**見積り工数**: 17h

---

## 🏗️ 変更ファイル一覧

### 新規作成

| # | ファイル | 内容 |
|---|---------|------|
| 1 | `api/src/functions/realtimeCorrection.ts` | リアルタイム補正APIエンドポイント |
| 2 | `web/src/services/correctionApi.ts` | フロントエンドAPIサービス |
| 3 | `web/src/hooks/useRealtimeCorrection.ts` | リアルタイム補正フック |

### 変更

| # | ファイル | 内容 |
|---|---------|------|
| 4 | `web/src/types/index.ts` | `LiveSegment` に `correctedText`, `isCorrected` 追加; `UserSettings` に `enableRealtimeCorrection` 追加 |
| 5 | `web/src/hooks/useSpeechRecognition.ts` | `updateSegment` メソッド追加 |
| 6 | `web/src/hooks/useTranslationRecognizer.ts` | `updateSegment` メソッド追加 |
| 7 | `web/src/hooks/index.ts` | エクスポート追加 |
| 8 | `web/src/app/page.tsx` | フック統合、UI表示、保存時統合 |

---

## 📝 実装手順

### Step 1: API エンドポイント作成

**ファイル**: `api/src/functions/realtimeCorrection.ts`

```typescript
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { AzureOpenAI } from "openai";

interface RealtimeCorrectionRequest {
  segments: Array<{ id: string; text: string }>;
  language: string;
  phraseList?: string[];
}

interface CorrectionItem {
  id: string;
  original: string;
  corrected: string;
}

interface CorrectionResponse {
  corrections: CorrectionItem[];
}

const REALTIME_CORRECTION_PROMPT = `あなたは音声認識結果をリアルタイムで校正する専門家です。
与えられた複数の発言セグメントを確認し、明らかな誤認識のみを修正してください。

【修正すべきもの】
- 同音異義語の誤り（例：「機関」→「期間」、「以上」→「異常」）
- 明らかな聞き間違い
- 不自然な単語の区切り
- 固有名詞の誤認識（文脈から推測可能な場合）

【修正してはいけないもの】
- 話者の意図や内容を変える
- 文体や口調（話し言葉のまま）
- 文法的に正しい表現への書き換え
- 修正不要なセグメント

JSON形式で出力:
{
  "corrections": [
    { "id": "セグメントID", "original": "原文", "corrected": "補正後テキスト" }
  ]
}

修正が不要な場合は "corrections": [] を返してください。
修正があるセグメントのみ出力してください。`;

function jsonResponse<T>(
  data: { success: boolean; data?: T; error?: string },
  status: number = 200
): HttpResponseInit {
  return {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
    body: JSON.stringify(data),
  };
}

app.http("realtimeCorrection", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "correction/realtime",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const body = (await request.json()) as RealtimeCorrectionRequest;

      if (!body.segments || body.segments.length === 0) {
        return jsonResponse(
          { success: false, error: "segments array is required" },
          400
        );
      }

      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      const apiKey = process.env.AZURE_OPENAI_KEY;
      const deploymentName =
        process.env.AZURE_OPENAI_CORRECTION_DEPLOYMENT_NAME ||
        process.env.AZURE_OPENAI_DEPLOYMENT_NAME ||
        "gpt-4o-mini";

      if (!endpoint || !apiKey) {
        return jsonResponse(
          { success: false, error: "Azure OpenAI is not configured" },
          500
        );
      }

      // 言語指示
      const langInstruction = body.language?.startsWith("ja")
        ? ""
        : `\n\n出力は元のテキストと同じ言語で記述してください。`;

      // フレーズリスト追加（精度向上）
      const phraseHint = body.phraseList?.length
        ? `\n\n【参考: よく使われる固有名詞・専門用語】\n${body.phraseList.join("、")}`
        : "";

      const systemPrompt =
        REALTIME_CORRECTION_PROMPT + langInstruction + phraseHint;

      const segmentsText = body.segments
        .map((s) => `[${s.id}] ${s.text}`)
        .join("\n");

      const client = new AzureOpenAI({
        endpoint,
        apiKey,
        apiVersion: "2024-08-01-preview",
      });

      const response = await client.chat.completions.create({
        model: deploymentName,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `以下の発言セグメントを確認してください:\n\n${segmentsText}` },
        ],
        temperature: 0.2,
        max_tokens: 2000,
        response_format: { type: "json_object" },
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return jsonResponse(
          { success: false, error: "No response from OpenAI" },
          500
        );
      }

      const parsed = JSON.parse(content) as CorrectionResponse;

      return jsonResponse<CorrectionResponse>({
        success: true,
        data: { corrections: parsed.corrections || [] },
      });
    } catch (error) {
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});
```

---

### Step 2: フロントエンド API サービス

**ファイル**: `web/src/services/correctionApi.ts`

```typescript
import { ApiResponse } from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://func-airecorder-dev.azurewebsites.net/api";

export interface RealtimeCorrectionInput {
  segments: Array<{ id: string; text: string }>;
  language: string;
  phraseList?: string[];
}

export interface CorrectionItem {
  id: string;
  original: string;
  corrected: string;
}

export interface CorrectionApiResponse {
  corrections: CorrectionItem[];
}

class CorrectionApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  async correctSegments(
    input: RealtimeCorrectionInput,
    signal?: AbortSignal
  ): Promise<ApiResponse<CorrectionApiResponse>> {
    const url = `${this.baseUrl}/correction/realtime`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
        signal,
      });

      const text = await response.text();
      let data: Record<string, unknown> | null = null;

      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          return { error: `JSON parse error: ${text.substring(0, 100)}` };
        }
      }

      if (!response.ok) {
        return {
          error: (data?.error as string) || `HTTP error ${response.status}`,
        };
      }

      return { data: data?.data as CorrectionApiResponse };
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        return { error: "REQUEST_ABORTED" };
      }
      return { error: (err as Error).message };
    }
  }
}

export const correctionApi = new CorrectionApiService();
```

---

### Step 3: `LiveSegment` 型拡張

**ファイル**: `web/src/types/index.ts`

`LiveSegment` に以下を追加:

```typescript
export interface LiveSegment {
  id: string;
  text: string;
  speaker?: string;
  speakerLabel?: string;
  timestamp: number;
  duration?: number;
  // ★ Issue #126: リアルタイムAI補正
  correctedText?: string;    // 補正後テキスト
  isCorrected?: boolean;     // 補正済みフラグ
}
```

`UserSettings` に以下を追加:

```typescript
export interface UserSettings {
  // ... 既存フィールド ...
  enableRealtimeCorrection?: boolean;  // ★ Issue #126
}
```

---

### Step 4: `useSpeechRecognition` に `updateSegment` 追加

**ファイル**: `web/src/hooks/useSpeechRecognition.ts`

返り値に `updateSegment` メソッドを追加:

```typescript
const updateSegment = useCallback((segmentId: string, patch: Partial<LiveSegment>) => {
  setSegments(prev => prev.map(seg =>
    seg.id === segmentId ? { ...seg, ...patch } : seg
  ));
}, []);

// return に追加
return {
  // ... 既存プロパティ ...
  updateSegment,
};
```

Interface `UseSpeechRecognitionReturn` にも追加:

```typescript
interface UseSpeechRecognitionReturn {
  // ... 既存 ...
  updateSegment: (segmentId: string, patch: Partial<LiveSegment>) => void;
}
```

---

### Step 5: `useTranslationRecognizer` に同様の `updateSegment` 追加

**ファイル**: `web/src/hooks/useTranslationRecognizer.ts`

Step 4 と同じパターン。

---

### Step 6: `useRealtimeCorrection` フック

**ファイル**: `web/src/hooks/useRealtimeCorrection.ts`

```typescript
"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { LiveSegment } from "@/types";
import { correctionApi } from "@/services/correctionApi";

// ─── 設定定数 ───
const BATCH_SIZE = 5;
const DEBOUNCE_MS = 3000;
const MAX_CALLS_PER_SESSION = 50;
const CONTEXT_WINDOW = 10;

export interface UseRealtimeCorrectionOptions {
  segments: LiveSegment[];
  language: string;
  enabled: boolean;
  isRecording: boolean;
  phraseList?: string[];
  onCorrection: (corrections: Array<{ segmentId: string; correctedText: string }>) => void;
}

export interface UseRealtimeCorrectionReturn {
  isCorrecting: boolean;
  correctionCount: number;
  correctedSegmentCount: number;
  error: string | null;
}

export function useRealtimeCorrection({
  segments,
  language,
  enabled,
  isRecording,
  phraseList = [],
  onCorrection,
}: UseRealtimeCorrectionOptions): UseRealtimeCorrectionReturn {
  const [isCorrecting, setIsCorrecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [correctionCount, setCorrectionCount] = useState(0);
  const [correctedSegmentCount, setCorrectedSegmentCount] = useState(0);

  const segmentsRef = useRef(segments);
  segmentsRef.current = segments;

  const onCorrectionRef = useRef(onCorrection);
  onCorrectionRef.current = onCorrection;

  const lastProcessedIndexRef = useRef(0);
  const callCountRef = useRef(0);
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // セッション開始時にリセット
  useEffect(() => {
    if (isRecording) {
      setError(null);
      setCorrectionCount(0);
      setCorrectedSegmentCount(0);
      lastProcessedIndexRef.current = 0;
      callCountRef.current = 0;
    }
  }, [isRecording]);

  // アンマウント時のクリーンアップ
  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (abortControllerRef.current) abortControllerRef.current.abort();
    };
  }, []);

  // コアAPI呼び出し
  const fetchCorrections = useCallback(
    async (targetSegments: LiveSegment[]) => {
      if (callCountRef.current >= MAX_CALLS_PER_SESSION) return;

      if (abortControllerRef.current) abortControllerRef.current.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsCorrecting(true);
      setError(null);
      callCountRef.current += 1;
      setCorrectionCount(callCountRef.current);

      try {
        const response = await correctionApi.correctSegments(
          {
            segments: targetSegments.map(s => ({ id: s.id, text: s.text })),
            language,
            phraseList: phraseList.length > 0 ? phraseList : undefined,
          },
          controller.signal
        );

        if (controller.signal.aborted) return;

        if (response.error) {
          if (response.error !== "REQUEST_ABORTED") {
            setError(response.error);
          }
          return;
        }

        if (response.data?.corrections && response.data.corrections.length > 0) {
          const mappedCorrections = response.data.corrections.map(c => ({
            segmentId: c.id,
            correctedText: c.corrected,
          }));
          onCorrectionRef.current(mappedCorrections);
          setCorrectedSegmentCount(prev => prev + mappedCorrections.length);
        }
      } catch {
        // Network error — silent failure
      } finally {
        setIsCorrecting(false);
        abortControllerRef.current = null;
      }
    },
    [language, phraseList]
  );

  // セグメント監視 → バッチ + デバウンス
  useEffect(() => {
    if (!enabled || !isRecording) return;
    if (callCountRef.current >= MAX_CALLS_PER_SESSION) return;

    const newCount = segments.length - lastProcessedIndexRef.current;
    if (newCount < BATCH_SIZE) return;

    if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);

    debounceTimerRef.current = setTimeout(() => {
      const current = segmentsRef.current;
      // 未補正セグメントのみ対象
      const startIdx = Math.max(0, current.length - CONTEXT_WINDOW);
      const targetSegments = current.slice(startIdx).filter(s => !s.isCorrected);

      if (targetSegments.length > 0) {
        lastProcessedIndexRef.current = current.length;
        fetchCorrections(targetSegments);
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, [segments.length, enabled, isRecording, fetchCorrections]);

  // 録音停止時にキャンセル
  useEffect(() => {
    if (!isRecording) {
      if (abortControllerRef.current) abortControllerRef.current.abort();
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    }
  }, [isRecording]);

  return {
    isCorrecting,
    correctionCount,
    correctedSegmentCount,
    error,
  };
}
```

---

### Step 7: `page.tsx` 統合

**ファイル**: `web/src/app/page.tsx`

#### 7a. フック呼び出し追加

AI Cues の直後に配置:

```typescript
// Issue #126: リアルタイムAI補正
const enableRealtimeCorrection = settings.enableRealtimeCorrection ?? false;
const {
  isCorrecting,
  correctionCount,
  correctedSegmentCount,
  error: correctionError,
} = useRealtimeCorrection({
  segments,
  language: sourceLanguage,
  enabled: enableRealtimeCorrection,
  isRecording: showRecordingUI,
  phraseList: settings.phraseList ?? [],
  onCorrection: useCallback((corrections) => {
    for (const { segmentId, correctedText } of corrections) {
      if (translationMode === "sdk") {
        sdkUpdateSegment(segmentId, { correctedText, isCorrected: true });
      } else {
        apiUpdateSegment(segmentId, { correctedText, isCorrected: true });
      }
    }
  }, [translationMode]),
});
```

#### 7b. errors 配列に追加

```typescript
const errors = [speechError, translationError, ttsError, audioError, fsmError, correctionError]
  .filter(Boolean) as string[];
```

#### 7c. 文字起こし表示で correctedText を優先

`labeledSegments` の useMemo で、表示テキストに `correctedText` を適用:

```typescript
const labeledSegments = useMemo(() => {
  return segments.map((seg) => ({
    ...seg,
    // リアルタイム補正テキストがあれば優先表示
    text: seg.correctedText || seg.text,
    speakerLabel: enableSpeakerDiarization && seg.speaker
      ? getSpeakerLabel(seg.speaker)
      : undefined,
  }));
}, [segments, enableSpeakerDiarization, getSpeakerLabel]);
```

#### 7d. 保存時に補正テキストを統合

`handleSaveWithTitle` 内の `fullText` を補正版で構成:

```typescript
const finalTranscript = labeledSegments.map(seg => seg.text).join(" ");
// ...
transcript: {
  segments: labeledSegments.map((seg, i) => ({
    // ...既存...
    text: seg.correctedText || seg.text,  // 補正版テキスト
  })),
  fullText: finalTranscript,
},
```

#### 7e. UI にインジケーター追加

録音中のステータスバーに補正状況を表示:

```tsx
{enableRealtimeCorrection && showRecordingUI && (
  <div className="flex items-center gap-1 text-xs text-purple-500">
    {isCorrecting && <Loader2 className="h-3 w-3 animate-spin" />}
    <span>✨ AI補正: {correctedSegmentCount}件修正 ({correctionCount}回)</span>
  </div>
)}
```

---

### Step 8: 設定画面に ON/OFF 追加

設定画面（`web/src/app/settings/page.tsx` 等）に以下のトグルを追加:

```tsx
<label className="flex items-center gap-2">
  <Switch
    checked={settings.enableRealtimeCorrection ?? false}
    onCheckedChange={(v) => updateSettings({ enableRealtimeCorrection: v })}
  />
  <span>リアルタイムAI補正（録音中に文字起こしを自動補正）</span>
</label>
```

---

## ⚠️ 注意事項

### AI Cues との競合回避

AI Cues とリアルタイム補正の両方が ON の場合、Azure OpenAI へのリクエストが約2倍になる。

**対策**:
1. 両方有効時はリアルタイム補正の `DEBOUNCE_MS` を `5000` に延長
2. `MAX_CALLS_PER_SESSION` を `30` に縮小
3. UI で「AI Cues と補正は排他推奨」のヒント表示

### 保存後バッチ補正との統合

リアルタイム補正済みの録音を保存する際:
- `correctionStatus: "realtime-completed"` を設定
- 保存後のバッチ補正はこのステータスでスキップ
- ユーザーが手動で「再補正」ボタンを押した場合のみバッチ補正を実行

---

## 🧪 テスト確認項目

| # | テスト | 期待結果 |
|---|--------|---------|
| 1 | enableRealtimeCorrection=false | 補正APIが呼ばれない |
| 2 | 5セグメント蓄積 | 3秒後にAPI呼び出し |
| 3 | 補正結果の表示 | セグメントテキストが更新される |
| 4 | 補正結果なし（修正不要） | 空配列、UIに変化なし |
| 5 | API エラー | error表示、原文保持 |
| 6 | 50回上限到達 | 以降の呼び出しスキップ |
| 7 | 録音停止 | 進行中のリクエストキャンセル |
| 8 | 保存 → 補正テキスト保持 | correctedText が fullText に統合 |
| 9 | AI Cues 同時ON | レートリミット超過しない |

---

*計画作成日: 2026-02-17*
*計画者: ReviewAAgent*
