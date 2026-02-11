# Issue #70: LLMによる文字起こし補正機能 - 実装計画書

## 1. エグゼクティブサマリー

録音完了後に LLM（Azure OpenAI）を使用して音声認識結果を **自動補正** する機能を追加。録音保存時にバックグラウンドで補正処理が実行され、ユーザーは詳細画面で **オリジナル** と **AI補正版** の両方を切り替えて確認できる。

**影響範囲**: 録音保存処理、詳細画面、API、DB スキーマ  
**見積り**: 約 6 時間  
**リスク**: 低〜中（非同期処理の追加）

---

## 2. アーキテクチャ設計

### 2.1 処理フロー（自動補正）

```
┌─────────────────────────────────────────────────────────────────┐
│                      録音完了時                                  │
├─────────────────────────────────────────────────────────────────┤
│  1. POST /api/recordings (transcript 保存)                      │
│         │                                                       │
│         ▼                                                       │
│  2. correctionStatus = "pending" で保存                         │
│         │                                                       │
│         ▼                                                       │
│  3. 非同期で補正処理をキック                                     │
│         │                                                       │
│         ▼                                                       │
│  4. LLM で補正 → correctedTranscript に保存                     │
│         │                                                       │
│         ▼                                                       │
│  5. correctionStatus = "completed"                              │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                   詳細画面 (recording/page.tsx)                  │
├─────────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────┐                    │
│  │ [オリジナル] [AI補正版 ✨]              │  ← タブ切り替え    │
│  └─────────────────────────────────────────┘                    │
│                                                                 │
│  補正中の場合: 「AI補正中... ⏳」表示                           │
│  完了の場合: 両方のテキストを表示                                │
│  失敗の場合: オリジナルのみ表示                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 データモデル変更

#### Recording 型の拡張

```typescript
interface Recording {
  // ... 既存フィールド
  transcript?: Transcript;              // オリジナル（常に保持）
  correctedTranscript?: Transcript;     // AI補正版（自動生成）
  correctionStatus?: "pending" | "processing" | "completed" | "failed";
  correctionError?: string;             // 失敗時のエラーメッセージ
  correctedAt?: string;                 // 補正完了日時
}
```

### 2.3 API 設計

#### 既存エンドポイントの拡張

| メソッド | ルート | 変更内容 |
|---------|--------|---------|
| POST | `/api/recordings` | 保存後に補正ジョブをキック |
| GET | `/api/recordings/{id}` | correctedTranscript も返す |
| PUT | `/api/recordings/{id}` | correctedTranscript の更新対応 |

#### 新規エンドポイント（内部用）

| メソッド | ルート | 説明 |
|---------|--------|------|
| POST | `/api/recordings/{id}/correct` | 補正処理を実行（内部呼び出し） |

### 2.4 LLM プロンプト設計

```
あなたは音声認識結果を校正する専門家です。
以下の文字起こしテキストを確認し、明らかな誤認識のみを修正してください。

【修正すべきもの】
- 同音異義語の誤り（例：「機関」→「期間」、「以上」→「異常」）
- 明らかな聞き間違い
- 不自然な単語の区切り
- 固有名詞の誤認識（文脈から推測可能な場合）

【修正してはいけないもの】
- 話者の意図や内容
- 文体や口調（話し言葉のまま）
- 文法的に正しい表現への過度な書き換え
- 句読点の大幅な変更

修正後のテキスト全文を返してください。
```

---

## 3. データモデル詳細

### 3.1 Cosmos DB ドキュメント構造

```typescript
// api/src/models/recording.ts に追加
interface Recording {
  id: string;
  userId: string;
  title: string;
  // ... 既存フィールド
  
  // オリジナル文字起こし（常に保持）
  transcript?: Transcript;
  
  // AI補正版（自動生成）
  correctedTranscript?: Transcript;
  
  // 補正ステータス
  correctionStatus?: "pending" | "processing" | "completed" | "failed";
  correctionError?: string;
  correctedAt?: string;
}
```

### 3.2 フロントエンド型定義

```typescript
// web/src/types/index.ts に追加
interface Recording {
  // ... 既存フィールド
  correctedTranscript?: Transcript;
  correctionStatus?: "pending" | "processing" | "completed" | "failed";
  correctionError?: string;
  correctedAt?: string;
}
```

---

## 4. 実装詳細

### Phase 1: バックエンド API (api/)

#### Step 1-1: 型定義更新 (10min)

**ファイル**: `api/src/models/recording.ts`

```typescript
// 追加フィールド
export interface Recording {
  // ... 既存
  correctedTranscript?: Transcript;
  correctionStatus?: "pending" | "processing" | "completed" | "failed";
  correctionError?: string;
  correctedAt?: string;
}
```

#### Step 1-2: 補正サービス実装 (45min)

**ファイル**: `api/src/services/transcriptCorrectionService.ts` (新規)

```typescript
import { AzureOpenAI } from "openai";
import { Transcript } from "../models";

const CORRECTION_PROMPT = `あなたは音声認識結果を校正する専門家です。
以下の文字起こしテキストを確認し、明らかな誤認識のみを修正してください。

【修正すべきもの】
- 同音異義語の誤り（例：「機関」→「期間」、「以上」→「異常」）
- 明らかな聞き間違い
- 不自然な単語の区切り
- 固有名詞の誤認識（文脈から推測可能な場合）

【修正してはいけないもの】
- 話者の意図や内容
- 文体や口調（話し言葉のまま）
- 文法的に正しい表現への過度な書き換え
- 句読点の大幅な変更

修正後のテキスト全文のみを返してください。説明は不要です。`;

export async function correctTranscript(
  transcript: Transcript,
  language?: string
): Promise<Transcript> {
  const client = new AzureOpenAI({
    apiKey: process.env.AZURE_OPENAI_API_KEY,
    endpoint: process.env.AZURE_OPENAI_ENDPOINT,
    apiVersion: "2024-02-15-preview",
  });

  const response = await client.chat.completions.create({
    model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-4o",
    messages: [
      { role: "system", content: CORRECTION_PROMPT },
      { role: "user", content: `【言語: ${language || "ja-JP"}】\n\n${transcript.fullText}` },
    ],
    temperature: 0.3,
  });

  const correctedText = response.choices[0]?.message?.content?.trim();
  if (!correctedText) {
    throw new Error("No response from OpenAI");
  }

  // セグメントも補正（簡易版：fullText のみ更新）
  return {
    segments: transcript.segments,  // セグメントは元のまま
    fullText: correctedText,
  };
}
```

#### Step 1-3: 録音保存時の補正ジョブキック (30min)

**ファイル**: `api/src/services/recordingService.ts` 変更

```typescript
import { correctTranscript } from "./transcriptCorrectionService";

export async function createRecording(request: CreateRecordingRequest): Promise<Recording> {
  const container = await getRecordingsContainer();
  const now = new Date().toISOString();

  const recording: Recording = {
    id: uuidv4(),
    userId: request.userId,
    title: request.title,
    // ... 既存フィールド
    transcript: request.transcript,
    // 補正ステータスを pending で初期化
    correctionStatus: request.transcript ? "pending" : undefined,
    createdAt: now,
    updatedAt: now,
    status: "completed",
  };

  const { resource } = await container.items.create(recording);
  
  // 非同期で補正処理をキック（await しない）
  if (request.transcript?.fullText) {
    processTranscriptCorrection(recording.id, recording.userId).catch(err => {
      console.error(`[Correction] Failed for ${recording.id}:`, err);
    });
  }

  return resource as Recording;
}

// 非同期補正処理
async function processTranscriptCorrection(recordingId: string, userId: string): Promise<void> {
  const container = await getRecordingsContainer();
  
  try {
    // ステータスを processing に更新
    const { resource: recording } = await container.item(recordingId, userId).read<Recording>();
    if (!recording?.transcript) return;

    await container.item(recordingId, userId).patch([
      { op: "replace", path: "/correctionStatus", value: "processing" },
    ]);

    // LLM で補正
    const correctedTranscript = await correctTranscript(
      recording.transcript,
      recording.sourceLanguage
    );

    // 結果を保存
    await container.item(recordingId, userId).patch([
      { op: "add", path: "/correctedTranscript", value: correctedTranscript },
      { op: "replace", path: "/correctionStatus", value: "completed" },
      { op: "add", path: "/correctedAt", value: new Date().toISOString() },
    ]);

  } catch (error) {
    // エラー時
    await container.item(recordingId, userId).patch([
      { op: "replace", path: "/correctionStatus", value: "failed" },
      { op: "add", path: "/correctionError", value: (error as Error).message },
    ]);
  }
}
```

#### Step 1-4: 手動補正エンドポイント (20min)

**ファイル**: `api/src/functions/recordings.ts` に追加

```typescript
// POST /api/recordings/{id}/correct - 手動で補正を再実行
app.http("correctRecording", {
  methods: ["POST", "OPTIONS"],
  authLevel: "anonymous",
  route: "recordings/{id}/correct",
  handler: async (request: HttpRequest, _context: InvocationContext): Promise<HttpResponseInit> => {
    if (request.method === "OPTIONS") {
      return jsonResponse({ success: true });
    }

    const id = request.params.id;
    const userId = request.query.get("userId");

    if (!userId) {
      return jsonResponse({ success: false, error: "userId is required" }, 400);
    }

    // 補正処理をキック
    processTranscriptCorrection(id!, userId).catch(console.error);

    return jsonResponse({ success: true, message: "Correction started" });
  },
});
```

---

### Phase 2: フロントエンド実装 (web/)

#### Step 2-1: 型定義更新 (10min)

**ファイル**: `web/src/types/index.ts`

```typescript
export interface Recording {
  // ... 既存フィールド
  correctedTranscript?: Transcript;
  correctionStatus?: "pending" | "processing" | "completed" | "failed";
  correctionError?: string;
  correctedAt?: string;
}
```

#### Step 2-2: recording/page.tsx UI 変更 (60min)

**変更内容**: 文字起こしタブをオリジナル/AI補正版の切り替え表示に

```tsx
// 追加 state
const [transcriptView, setTranscriptView] = useState<"original" | "corrected">("corrected");

// 表示するテキストを決定
const displayTranscript = useMemo(() => {
  if (transcriptView === "corrected" && recording?.correctedTranscript) {
    return recording.correctedTranscript;
  }
  return recording?.transcript;
}, [recording, transcriptView]);

// 補正ステータスに応じたバッジ表示
const correctionStatusBadge = useMemo(() => {
  switch (recording?.correctionStatus) {
    case "pending":
    case "processing":
      return <span className="text-xs text-blue-600 animate-pulse">⏳ AI補正中...</span>;
    case "completed":
      return <span className="text-xs text-green-600">✨ AI補正済み</span>;
    case "failed":
      return <span className="text-xs text-red-600">❌ 補正失敗</span>;
    default:
      return null;
  }
}, [recording?.correctionStatus]);
```

**UI（タブ切り替え）:**

```tsx
<CardHeader className="flex flex-row items-center justify-between">
  <div className="flex items-center gap-4">
    <CardTitle className="text-lg">文字起こし</CardTitle>
    {correctionStatusBadge}
  </div>
  
  {/* オリジナル / AI補正版 切り替え */}
  {recording?.correctedTranscript && (
    <div className="flex rounded-lg border p-1">
      <Button
        variant={transcriptView === "original" ? "secondary" : "ghost"}
        size="sm"
        onClick={() => setTranscriptView("original")}
      >
        オリジナル
      </Button>
      <Button
        variant={transcriptView === "corrected" ? "secondary" : "ghost"}
        size="sm"
        onClick={() => setTranscriptView("corrected")}
        className="gap-1"
      >
        <Sparkles className="h-3 w-3" />
        AI補正版
      </Button>
    </div>
  )}
</CardHeader>

<CardContent>
  {displayTranscript?.fullText ? (
    <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
      {displayTranscript.fullText}
    </div>
  ) : recording?.correctionStatus === "processing" ? (
    <div className="py-8 text-center text-gray-500">
      <Spinner className="mx-auto mb-2" />
      AI補正処理中です...
    </div>
  ) : (
    <div className="py-8 text-center text-gray-500">
      文字起こしデータがありません
    </div>
  )}
</CardContent>
```

#### Step 2-3: ポーリングで補正完了を検知 (20min)

```tsx
// 補正中の場合、定期的に再取得
useEffect(() => {
  if (recording?.correctionStatus === "pending" || recording?.correctionStatus === "processing") {
    const interval = setInterval(async () => {
      const response = await recordingsApi.getRecording(id!);
      if (response.data) {
        setRecording(response.data);
        if (response.data.correctionStatus === "completed" || response.data.correctionStatus === "failed") {
          clearInterval(interval);
        }
      }
    }, 3000); // 3秒ごとにチェック

    return () => clearInterval(interval);
  }
}, [recording?.correctionStatus, id]);
```

---

## 5. 実装ロードマップ

| Step | 作業内容 | 見積り | 依存 |
|------|---------|--------|------|
| 1-1 | 型定義更新 (api/models) | 10min | - |
| 1-2 | transcriptCorrectionService 実装 | 45min | 1-1 |
| 1-3 | recordingService に補正処理追加 | 30min | 1-2 |
| 1-4 | 手動補正エンドポイント追加 | 20min | 1-3 |
| 2-1 | 型定義更新 (web/types) | 10min | 1-1 |
| 2-2 | recording/page.tsx UI変更 | 60min | 2-1 |
| 2-3 | ポーリング処理追加 | 20min | 2-2 |
| 3-1 | テスト・動作確認 | 30min | All |

**合計**: 約 6 時間

---

## 6. UI/UX 設計

### 6.1 詳細画面の文字起こしタブ

```
┌─────────────────────────────────────────────────────────────────┐
│ 文字起こし                              ✨ AI補正済み           │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │  [オリジナル]  [AI補正版 ✨]                                │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │                                                             │ │
│ │  補正されたテキストがここに表示されます。                    │ │
│ │  オリジナルとの切り替えが可能です。                         │ │
│ │                                                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│                                            [コピー] [ダウンロード]│
└─────────────────────────────────────────────────────────────────┘
```

### 6.2 補正中の表示

```
┌─────────────────────────────────────────────────────────────────┐
│ 文字起こし                              ⏳ AI補正中...          │
│                                                                 │
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │                                                             │ │
│ │  オリジナルのテキストが表示されます。                        │ │
│ │                                                             │ │
│ │  ─────────────────────────────────────────                  │ │
│ │  💡 AI補正が完了すると「AI補正版」タブが表示されます        │ │
│ │  ─────────────────────────────────────────                  │ │
│ │                                                             │ │
│ └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
```

### 6.3 ステータス表示

| ステータス | 表示 | 説明 |
|-----------|------|------|
| pending | ⏳ AI補正中... | 処理待ち |
| processing | ⏳ AI補正中... | 処理実行中 |
| completed | ✨ AI補正済み | 完了（タブ切り替え可能） |
| failed | ❌ 補正失敗 | エラー（オリジナルのみ表示） |
| なし | （表示なし） | transcript がない場合 |

---

## 7. コスト考慮

### 7.1 トークン使用量の目安

| 録音時間 | 文字数目安 | 入力トークン | 出力トークン | 概算コスト |
|---------|-----------|-------------|-------------|-----------|
| 5分 | ~1,500字 | ~2,000 | ~2,000 | ~$0.02 |
| 30分 | ~9,000字 | ~12,000 | ~12,000 | ~$0.10 |
| 60分 | ~18,000字 | ~24,000 | ~24,000 | ~$0.20 |

### 7.2 コスト対策

1. **長いテキストのセグメント分割**: 10,000文字以上は分割処理
2. **録音ごとに1回のみ**: 自動補正は録音保存時に1回だけ実行
3. **手動再実行は任意**: ユーザーが明示的にリクエストした場合のみ

---

## 8. テストシナリオ

### 8.1 正常系

| # | シナリオ | 期待結果 |
|---|---------|---------|
| 1 | 新規録音を保存 | correctionStatus = "pending" で保存 |
| 2 | 補正処理が完了 | correctedTranscript が追加される |
| 3 | 詳細画面を開く | オリジナル/AI補正版 の切り替えが可能 |
| 4 | 補正中に詳細画面を開く | 「AI補正中...」が表示される |
| 5 | 補正完了後に再度開く | タブ切り替えが可能になる |

### 8.2 異常系

| # | シナリオ | 期待結果 |
|---|---------|---------|
| 1 | OpenAI API エラー | correctionStatus = "failed"、オリジナルのみ表示 |
| 2 | transcript なしで保存 | 補正処理はスキップ |
| 3 | 長時間の録音（60分超） | セグメント分割で処理 |

---

## 9. 将来の拡張（スコープ外）

- **差分表示**: オリジナルと補正版の差分をハイライト表示
- **セグメント単位の補正**: 個別セグメントごとに補正・承認
- **カスタム辞書連携**: #34 フレーズリストとの統合
- **補正品質フィードバック**: ユーザーが補正品質を評価
- **補正のやり直し**: 手動で再補正をリクエスト

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| LLM が意味を変えてしまう | 中 | 高 | オリジナルを常に保持、切り替え可能 |
| 長いテキストでタイムアウト | 中 | 中 | セグメント分割処理 |
| 非同期処理の失敗 | 低 | 中 | エラーステータスで明示、オリジナルで継続 |
| コスト超過 | 低 | 中 | 録音ごとに1回のみ自動実行 |

---

## 11. 結論

- **GO** 判定: 自動補正でUX向上、オリジナル保持でリスク軽減
- 推奨: Phase 1 → Phase 2 の順序で実装
- 注意点: 
  - オリジナルは常に保持（上書きしない）
  - 非同期処理のエラーハンドリングを確実に
  - ポーリングで補正完了を検知
