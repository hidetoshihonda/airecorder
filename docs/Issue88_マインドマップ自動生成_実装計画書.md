# Issue #88: マインドマップ自動生成 — 実装計画書

## 概要

会議内容を視覚的なマインドマップとして自動生成する機能を録音詳細画面に追加する。  
GPT で Markmap 形式 Markdown を生成し、`markmap-lib` + `markmap-view` でフロントエンドレンダリングする。

- **新規ファイル**: 3ファイル（API / フロントAPI / コンポーネント）
- **修正ファイル**: 9ファイル（型定義 / ページ / i18n / package.json / index.ts）
- **見積り**: 約3時間

---

## 変更対象ファイル一覧

| # | ファイル | 種別 | 概要 |
|---|---------|------|------|
| 1 | `web/package.json` | 修正 | markmap 依存追加 |
| 2 | `api/src/models/Recording.ts` | 修正 | `mindmapMarkdown` フィールド追加 |
| 3 | `web/src/types/index.ts` | 修正 | `mindmapMarkdown` フィールド追加 |
| 4 | `api/src/functions/mindmap.ts` | **新規** | マインドマップ生成 API |
| 5 | `api/src/index.ts` | 修正 | `import "./functions/mindmap"` 追加 |
| 6 | `web/src/services/mindmapApi.ts` | **新規** | フロントエンド API クライアント |
| 7 | `web/src/services/index.ts` | 修正 | `mindmapApi` エクスポート追加 |
| 8 | `web/src/components/MindMapPanel.tsx` | **新規** | マインドマップ表示コンポーネント |
| 9 | `web/src/app/recording/page.tsx` | 修正 | マインドマップタブ追加 |
| 10 | `web/messages/ja.json` | 修正 | i18n キー追加 |
| 11 | `web/messages/en.json` | 修正 | i18n キー追加 |
| 12 | `web/messages/es.json` | 修正 | i18n キー追加 |

---

## Step 1: npm 依存追加

```bash
cd web && npm install markmap-lib markmap-view markmap-common
```

---

## Step 2: データモデル拡張

### 2.1 `api/src/models/Recording.ts` — Recording インターフェースに追加

```typescript
// マインドマップ (Issue #88)
mindmapMarkdown?: string;
```

`speakerLabels` フィールドの後に追加。

### 2.2 `web/src/types/index.ts` — Recording インターフェースに追加

```typescript
// マインドマップ (Issue #88)
mindmapMarkdown?: string;
```

`speakerLabels` フィールドの後に追加。

### 2.3 `web/src/services/recordingsApi.ts` — UpdateRecordingInput に追加

```typescript
mindmapMarkdown?: string;
```

---

## Step 3: API エンドポイント作成

### `api/src/functions/mindmap.ts`

```typescript
import {
  app,
  HttpRequest,
  HttpResponseInit,
  InvocationContext,
} from "@azure/functions";
import { AzureOpenAI } from "openai";

interface MindmapRequest {
  transcript: string;
  language?: string;
}

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

const MINDMAP_SYSTEM_PROMPT = `あなたは会議内容を構造化するエキスパートです。
与えられた文字起こしから、マインドマップ用の Markdown を生成してください。

【出力形式】
- Markdown の見出し構造（#, ##, ###, ####）のみを使用してください
- ルートノード（#）は会議名またはテーマ（1つのみ）
- 第2レベル（##）は主要な議題・トピック（3-8個程度）
- 第3レベル（###）はサブトピック・詳細
- 第4レベル（####）は具体的な決定事項・アクションアイテム
- 各ノードは簡潔に（1行、20文字以内を推奨）
- 箇条書き（-）でノードの補足情報を追加可能
- 全ての重要な議題を漏れなく含める
- 決定事項は「✅」、アクションアイテムは「📌」、課題は「⚠️」の絵文字でマーク

【重要ルール】
- 純粋な Markdown のみを出力（コードブロック \`\`\` で囲まない）
- 余計な説明文は付けない
- ノードは短く簡潔に

【出力例】
# プロジェクト進捗会議
## 開発進捗
### フロントエンド
- React 移行 80% 完了
#### ✅ 来週中にβ版リリース
### バックエンド
- API v2 設計完了
#### 📌 負荷テスト実施（田中）
## 課題・リスク
### ⚠️ パフォーマンス問題
- ページ読み込み3秒超過
#### 📌 CDN 導入検討
## 次回アクション
### 来週火曜 14:00 再MTG`;

function getLanguageInstruction(language?: string): string {
  if (!language || language === "ja-JP" || language === "ja") return "";
  const langMap: Record<string, string> = {
    "en-US": "English", "en-GB": "English", en: "English",
    "es-ES": "Spanish", "es-MX": "Spanish", es: "Spanish",
    "zh-CN": "Chinese", "ko-KR": "Korean",
    "fr-FR": "French", "de-DE": "German",
  };
  const langName = langMap[language] || language;
  return `\n\n重要：出力は${langName}で記述してください。`;
}

const MAX_TRANSCRIPT_CHARS = 60000;

app.http("generateMindmap", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "mindmap/generate",
  handler: async (
    request: HttpRequest,
    _context: InvocationContext
  ): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    try {
      const body = (await request.json()) as MindmapRequest;

      if (!body.transcript) {
        return jsonResponse(
          { success: false, error: "transcript is required" },
          400
        );
      }

      const endpoint = process.env.AZURE_OPENAI_ENDPOINT;
      const apiKey = process.env.AZURE_OPENAI_KEY;
      const deploymentName = process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5-mini";

      if (!endpoint || !apiKey) {
        return jsonResponse(
          { success: false, error: "Azure OpenAI is not configured" },
          500
        );
      }

      const systemPrompt = MINDMAP_SYSTEM_PROMPT + getLanguageInstruction(body.language);

      // transcript 切り詰め
      let transcript = body.transcript;
      if (transcript.length > MAX_TRANSCRIPT_CHARS) {
        transcript = "...(前半省略)...\n\n" + transcript.slice(-MAX_TRANSCRIPT_CHARS);
      }

      const client = new AzureOpenAI({
        endpoint,
        apiKey,
        apiVersion: "2024-08-01-preview",
      });

      const response = await client.chat.completions.create({
        model: deploymentName,
        messages: [
          { role: "system", content: systemPrompt },
          {
            role: "user",
            content: `以下は会議の文字起こしです。この内容からマインドマップ用の Markdown を生成してください。\n\n---\n${transcript}`,
          },
        ],
        temperature: 0.3,
        max_tokens: 4000,
      });

      const content = response.choices[0]?.message?.content;

      if (!content) {
        return jsonResponse(
          { success: false, error: "No response from OpenAI" },
          500
        );
      }

      // コードブロックで囲まれている場合は除去
      let markdown = content.trim();
      if (markdown.startsWith("```markdown")) {
        markdown = markdown.slice("```markdown".length);
      } else if (markdown.startsWith("```")) {
        markdown = markdown.slice(3);
      }
      if (markdown.endsWith("```")) {
        markdown = markdown.slice(0, -3);
      }
      markdown = markdown.trim();

      const usage = response.usage;
      console.log(
        `[Mindmap] model=${deploymentName}, prompt_tokens=${usage?.prompt_tokens}, completion_tokens=${usage?.completion_tokens}, output_length=${markdown.length}`
      );

      return jsonResponse<{ markdown: string }>({
        success: true,
        data: { markdown },
      });
    } catch (error) {
      console.error("Mindmap generation error:", error);
      return jsonResponse(
        { success: false, error: (error as Error).message },
        500
      );
    }
  },
});
```

### `api/src/index.ts` — import 追加

```typescript
import "./functions/mindmap";
```

既存の `import "./functions/askAi";` の後に追加。

---

## Step 4: フロントエンド API クライアント

### `web/src/services/mindmapApi.ts`

```typescript
import { ApiResponse } from "@/types";

const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL ||
  "https://func-airecorder-dev.azurewebsites.net/api";

export interface GenerateMindmapInput {
  transcript: string;
  language?: string;
}

export interface MindmapResult {
  markdown: string;
}

class MindmapApiService {
  private baseUrl: string;

  constructor() {
    this.baseUrl = API_BASE_URL;
  }

  async generateMindmap(input: GenerateMindmapInput): Promise<ApiResponse<MindmapResult>> {
    const url = `${this.baseUrl}/mindmap/generate`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(input),
      });

      const text = await response.text();
      let data: Record<string, unknown> | null = null;

      if (text) {
        try {
          data = JSON.parse(text);
        } catch {
          return { error: `Parse error: ${text.substring(0, 100)}` };
        }
      }

      if (!response.ok) {
        return {
          error: (data?.error as string) || `HTTP error ${response.status}`,
        };
      }

      return {
        data: (data?.data as MindmapResult) || (data as unknown as MindmapResult),
      };
    } catch (error) {
      return {
        error: (error as Error).message || "Network error",
      };
    }
  }
}

export const mindmapApi = new MindmapApiService();
```

### `web/src/services/index.ts` — エクスポート追加

```typescript
export { mindmapApi } from "./mindmapApi";
```

---

## Step 5: MindMapPanel コンポーネント

### `web/src/components/MindMapPanel.tsx`

```tsx
"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Sparkles, RefreshCw, Download, ZoomIn, ZoomOut } from "lucide-react";
import { mindmapApi } from "@/services/mindmapApi";
import { recordingsApi } from "@/services";
import { Recording } from "@/types";

interface MindMapPanelProps {
  recording: Recording;
  transcript: string;          // getTranscriptWithSpeakerLabels() の結果
  onRecordingUpdate: (r: Recording) => void;
}

export function MindMapPanel({ recording, transcript, onRecordingUpdate }: MindMapPanelProps) {
  const t = useTranslations("RecordingDetail");
  const svgRef = useRef<SVGSVGElement>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [markmapInstance, setMarkmapInstance] = useState<unknown>(null);

  const markdown = recording.mindmapMarkdown;

  // markmap レンダリング（CSR のみ）
  const renderMindmap = useCallback(async (md: string) => {
    if (!svgRef.current || !md) return;

    try {
      // Dynamic import（SSR 回避）
      const { Transformer } = await import("markmap-lib");
      const { Markmap } = await import("markmap-view");

      const transformer = new Transformer();
      const { root } = transformer.transform(md);

      // 既存インスタンスをクリア
      svgRef.current.innerHTML = "";

      const mm = Markmap.create(svgRef.current, {
        autoFit: true,
        duration: 500,
        maxWidth: 300,
        paddingX: 16,
      }, root);

      setMarkmapInstance(mm);
    } catch (err) {
      console.error("Markmap render error:", err);
      setError(t("mindmapRenderError"));
    }
  }, [t]);

  // markdown が変わったらレンダリング
  useEffect(() => {
    if (markdown) {
      renderMindmap(markdown);
    }
  }, [markdown, renderMindmap]);

  // 生成ハンドラ
  const handleGenerate = async () => {
    if (!transcript) return;
    setIsGenerating(true);
    setError(null);

    const response = await mindmapApi.generateMindmap({
      transcript,
      language: recording.sourceLanguage,
    });

    if (response.error) {
      setError(response.error);
      setIsGenerating(false);
      return;
    }

    if (response.data?.markdown) {
      // キャッシュ保存
      const updateResponse = await recordingsApi.updateRecording(recording.id, {
        mindmapMarkdown: response.data.markdown,
      });

      if (updateResponse.data) {
        onRecordingUpdate(updateResponse.data);
      }

      await renderMindmap(response.data.markdown);
    }

    setIsGenerating(false);
  };

  // SVG エクスポート
  const handleExportSvg = () => {
    if (!svgRef.current) return;
    const svgData = new XMLSerializer().serializeToString(svgRef.current);
    const blob = new Blob([svgData], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${recording.title || "mindmap"}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ズーム操作
  const handleZoom = (direction: "in" | "out") => {
    if (!markmapInstance || typeof (markmapInstance as { rescale?: unknown }).rescale !== "function") return;
    const mm = markmapInstance as { rescale: (scale: number) => void };
    mm.rescale(direction === "in" ? 1.25 : 0.8);
  };

  return (
    <div className="space-y-4">
      {/* ヘッダー */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {markdown && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleGenerate()}
                disabled={isGenerating || !transcript}
              >
                <RefreshCw className={`h-4 w-4 mr-1 ${isGenerating ? "animate-spin" : ""}`} />
                {t("regenerate")}
              </Button>
              <Button variant="outline" size="sm" onClick={handleExportSvg}>
                <Download className="h-4 w-4 mr-1" />
                SVG
              </Button>
              <Button variant="outline" size="icon" onClick={() => handleZoom("in")}>
                <ZoomIn className="h-4 w-4" />
              </Button>
              <Button variant="outline" size="icon" onClick={() => handleZoom("out")}>
                <ZoomOut className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      </div>

      {/* エラー表示 */}
      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-600">
          {error}
        </div>
      )}

      {/* マインドマップ表示 or 生成ボタン */}
      {markdown ? (
        <div className="rounded-md border bg-white p-2 overflow-hidden" style={{ minHeight: "400px" }}>
          <svg
            ref={svgRef}
            className="w-full"
            style={{ minHeight: "400px" }}
          />
        </div>
      ) : (
        <div className="py-12 text-center text-gray-500">
          {transcript ? (
            <>
              <Sparkles className="mx-auto h-12 w-12 text-gray-300 mb-4" />
              <p className="mb-4">{t("mindmapEmpty")}</p>
              <Button
                onClick={handleGenerate}
                disabled={isGenerating}
                className="gap-2"
              >
                {isGenerating ? (
                  <>
                    <Spinner className="h-4 w-4" />
                    {t("mindmapGenerating")}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" />
                    {t("mindmapGenerate")}
                  </>
                )}
              </Button>
            </>
          ) : (
            <p>{t("mindmapNoTranscript")}</p>
          )}
        </div>
      )}
    </div>
  );
}
```

---

## Step 6: `recording/page.tsx` タブ追加

### 6.1 import 追加

```typescript
import { MindMapPanel } from "@/components/MindMapPanel";
```

lucide-react import に `GitBranch` を追加（マインドマップアイコン）:

```typescript
import { ..., GitBranch } from "lucide-react";
```

### 6.2 TabsList 変更

```tsx
<TabsList className="grid w-full grid-cols-5">
```

### 6.3 TabsTrigger 追加（askAi の後）

```tsx
<TabsTrigger value="mindmap" className="gap-2">
  <GitBranch className="h-4 w-4" />
  {t("mindmapTab")}
</TabsTrigger>
```

### 6.4 TabsContent 追加（askAi TabsContent の後、`</Tabs>` の前）

```tsx
{/* Mind Map Tab (Issue #88) */}
<TabsContent value="mindmap">
  <Card>
    <CardHeader>
      <CardTitle className="text-lg">{t("mindmap")}</CardTitle>
    </CardHeader>
    <CardContent>
      <MindMapPanel
        recording={recording}
        transcript={getTranscriptWithSpeakerLabels()}
        onRecordingUpdate={setRecording}
      />
    </CardContent>
  </Card>
</TabsContent>
```

---

## Step 7: `UpdateRecordingInput` にフィールド追加

### `web/src/services/recordingsApi.ts`

```typescript
export interface UpdateRecordingInput {
  // ...existing fields...
  mindmapMarkdown?: string;  // Issue #88
}
```

---

## Step 8: i18n メッセージ追加

### RecordingDetail セクションに追加

| キー | ja | en | es |
|------|-----|-----|-----|
| `mindmapTab` | マップ | Map | Mapa |
| `mindmap` | マインドマップ | Mind Map | Mapa Mental |
| `mindmapEmpty` | 「生成」ボタンでマインドマップを作成できます | Click "Generate" to create a mind map | Haga clic en "Generar" para crear un mapa mental |
| `mindmapGenerate` | AIで生成 | Generate with AI | Generar con IA |
| `mindmapGenerating` | 生成中... | Generating... | Generando... |
| `mindmapNoTranscript` | 文字起こしデータがないため生成できません | No transcript data available | Sin datos de transcripción |
| `mindmapRenderError` | マインドマップの表示に失敗しました | Failed to render mind map | Error al mostrar el mapa mental |

---

## Step 9: ビルド確認

```bash
cd api && npm run build
cd web && npm run build
```

---

## 注意事項

### markmap の SSR 回避

`markmap-view` は DOM（SVG）を直接操作するため、SSR環境では動作しない。  
`MindMapPanel.tsx` 内で `await import("markmap-lib")` / `await import("markmap-view")` を使用し、`useEffect` 内でのみ初期化することで回避。

### markmap の型定義

`markmap-lib` と `markmap-view` は TypeScript 型定義を同梱しているが、バージョンによっては `@types/` が必要な場合がある。ビルド時に確認。

### transcript の切り詰め

GPT のトークン制限に対応するため、transcript が 60,000 文字を超える場合は末尾（最新部分）を優先保持する（`askAi.ts` と同パターン）。

### タブテキストの短縮

5タブ目追加に伴い、モバイルでの表示を考慮して `mindmapTab` は短い「マップ」を使用。

---

## 完了条件

- [ ] 録音詳細画面に「マップ」タブが表示される
- [ ] transcript ありの録音で「AIで生成」ボタンが表示される
- [ ] ボタンクリックでマインドマップが SVG でレンダリングされる
- [ ] 生成結果が CosmosDB にキャッシュされる
- [ ] ページリロード後もキャッシュからマインドマップが表示される
- [ ] 再生成ボタンで新しいマインドマップに置換される
- [ ] SVG エクスポートでファイルダウンロードできる
- [ ] ズームイン/ズームアウトが動作する
- [ ] transcript なしの録音では「データなし」メッセージが表示される
- [ ] モバイルでの表示が崩れない
- [ ] ESLint / TypeScript エラーなし
- [ ] API / Web 両方のビルド成功
