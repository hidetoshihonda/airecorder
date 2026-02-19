# Issue #125: 翻訳テキストの保存後AI補正機能 — 分析レビュー

**作成日**: 2026-02-19  
**対象Issue**: [#125 feat: 翻訳テキストの保存後AI補正機能](https://github.com/hidetoshihonda/airecorder/issues/125)  
**関連Issue**: #70 (LLM文字起こし補正), #126 (リアルタイムAI補正), PR #163 (セグメント単位補正)

---

## 1. エグゼクティブサマリー

- **問題の本質**: 保存後のLLM AI補正が文字起こし（transcript）にのみ実装されており、翻訳テキスト（translation）には **機能が一切存在しない**。API エンドポイント、データモデルフィールド、UI切り替え全てが未実装。
- **影響範囲**: 翻訳機能を使用する全ユーザーに影響。翻訳の品質向上が保存後にできない状態。
- **修正の緊急度**: **P3 (Low)** — 新機能追加であり、既存機能が壊れているわけではない。

---

## 2. アーキテクチャ概観

### 2.1 コンポーネント依存関係（現状）

```
┌─────────────────────────────────────────────────────────────┐
│                    Web (Next.js Frontend)                    │
│                                                              │
│  page.tsx (録音) ──save──► recordingsApi.createRecording()   │
│       ↓                         ↓                            │
│  recording/page.tsx         API Request                      │
│    ├─ transcriptView        POST /api/recordings             │
│    │  (original/corrected)                                   │
│    └─ translationTab        ← correctedTranscript ✅         │
│       (fullText only)       ← correctedTranslations ❌       │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│                    API (Azure Functions)                      │
│                                                              │
│  recordings.ts                                               │
│    ├─ createRecording → recordingService.createRecording()   │
│    │                      └─ processTranscriptCorrection() ✅ │
│    │                      └─ processTranslationCorrection() ❌│
│    └─ correctRecording → processTranscriptCorrection()      │
│                          processTranslationCorrection() ❌   │
│                                                              │
│  transcriptCorrectionService.ts                              │
│    ├─ correctTranscript()  ✅ (fullText + segments)          │
│    ├─ correctSegmentsBatch() ✅                              │
│    └─ processTranscriptCorrection() ✅                       │
│                                                              │
│  translationCorrectionService.ts  ❌ (存在しない)            │
└─────────────────────────────────────────────────────────────┘
                              ↕
┌─────────────────────────────────────────────────────────────┐
│                    Cosmos DB                                 │
│                                                              │
│  Recording document:                                         │
│    transcript          ✅                                    │
│    correctedTranscript ✅                                    │
│    translations        ✅ { [langCode]: Translation }        │
│    correctedTranslations ❌ (フィールド未定義)               │
│    correctionStatus    ✅ (transcript用のみ)                 │
│    translationCorrectionStatus ❌ (フィールド未定義)         │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 データフロー（現状 — 文字起こし補正のみ）

```
録音保存 → createRecording() → Cosmos DB 保存
                                    ↓
                        processTranscriptCorrection() (fire-and-forget)
                                    ↓
                        correctTranscript() → Azure OpenAI
                                    ↓
                        Cosmos DB patch: correctedTranscript, correctionStatus
                                    ↓
                        Frontend polling → correctionStatus === "completed"
                                    ↓
                        recording/page.tsx: original/AI補正版 切り替え表示
```

### 2.3 翻訳データの構造

**API側 (api/src/models/recording.ts L15-18)**:
```typescript
interface Translation {
  language: string;
  segments: TranscriptSegment[];  // ← TranscriptSegment を再利用
  fullText: string;
}
```

**Frontend側 (web/src/types/index.ts L71-75)**:
```typescript
interface Translation {
  languageCode: string;           // ← API側と名前が異なる (language vs languageCode)
  segments: TranslationSegment[];  // ← 独自型
  fullText: string;
}
```

**Frontend TranslationSegment (web/src/types/index.ts L77-80)**:
```typescript
interface TranslationSegment {
  originalSegmentId: string;
  text: string;
}
```

> ⚠️ **設計上の注意**: API側は `TranscriptSegment` を再利用しているが、Frontend側は `TranslationSegment` という独自型を使用。フィールド名も異なる（`language` vs `languageCode`）。

---

## 3. 重大バグ分析 🔴

### BUG-1: 翻訳AI補正機能が完全未実装 [Critical]

**場所**: プロジェクト全体  
**問題**: Issue #125 が要求する機能が一切存在しない。以下の全てが未実装：

| コンポーネント | 状態 |
|---------------|------|
| `Recording.correctedTranslations` フィールド (API Model) | ❌ 未定義 |
| `Recording.correctedTranslations` フィールド (Frontend Type) | ❌ 未定義 |
| `Recording.translationCorrectionStatus` フィールド | ❌ 未定義 |
| 翻訳補正サービス (`translationCorrectionService.ts`) | ❌ 未作成 |
| 翻訳補正APIエンドポイント | ❌ 未作成 |
| 翻訳補正の自動キック (保存時) | ❌ 未実装 |
| 翻訳タブの original/AI補正版 切り替えUI | ❌ 未実装 |
| Frontend API サービス (`retryTranslationCorrection`) | ❌ 未実装 |
| i18n メッセージ（翻訳補正関連） | ❌ 未追加 |

**影響**: 翻訳を使用する全ユーザー。SDK/API の直訳が不自然なまま閲覧される。  
**根本原因**: Issue #70 で文字起こし補正のみを実装し、翻訳への横展開が行われなかった。  

---

## 4. 設計上の問題 🟡

### DESIGN-1: Translation 型の API / Frontend 不整合 [Medium]

**場所**:  
- API: `api/src/models/recording.ts` L15-18  
- Frontend: `web/src/types/index.ts` L71-75

**問題**: API側では `language` フィールド、Frontend側では `languageCode` フィールドと名称が異なる。また API側は `segments: TranscriptSegment[]` を再利用しているが、Frontend側は `TranslationSegment[]` を使用。

**影響**: 翻訳補正実装時にフィールド名のマッピングが必要。既存の保存処理ではフロントエンドが `languageCode` で送信しているが、API側は `language` として格納するため、データの不整合が起きている可能性がある。

### DESIGN-2: 補正ステータスが transcript 専用設計 [Medium]

**場所**: `api/src/models/recording.ts` L80-83

```typescript
correctionStatus?: "pending" | "processing" | "completed" | "failed";
correctionError?: string;
correctedAt?: string;
```

**問題**: 補正ステータス管理が transcript 用の単一ステータスのみ。翻訳補正を追加すると、transcript は完了だが翻訳は処理中、というケースが発生する。

**推奨**: 翻訳用に別のステータスフィールドを追加するか、統合的な補正ステータス管理に拡張する。

### DESIGN-3: ✅ Good — 文字起こし補正の設計パターンが横展開しやすい

`processTranscriptCorrection()` → `correctTranscript()` → `correctSegmentsBatch()` のパターンは、翻訳補正にもそのまま適用可能。fire-and-forget + ステータスポーリングのアーキテクチャが確立されている。

### DESIGN-4: ✅ Good — UI切り替えパターンの再利用

`transcriptView` state + `displayTranscript` memo の切り替えパターンは、翻訳タブにも同一パターンで適用できる。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #70  (LLM文字起こし補正) ──完了──► Issue #125 (翻訳AI補正) [パターン再利用]
PR #163    (セグメント単位補正) ──完了──► Issue #125 [セグメント補正の横展開]
Issue #126 (リアルタイムAI補正) ──独立──  Issue #125 [保存後 vs リアルタイム]
Issue #33  (セグメント単位差分翻訳) ──独立── Issue #125 [リアルタイム翻訳 vs 保存後補正]
```

- **ブロッカー**: なし。Issue #70 と PR #163 は完了済み。
- **並行作業可能**: 全ての他 Issue と並行作業可能。

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| translationCorrectionService | Azure OpenAI (gpt-5-mini) | API クォータ消費増 | transcript と同じデプロイメントを共有 |
| Recording.correctedTranslations | Cosmos DB スキーマ | スキーマレス DB なのでリスク低 | 新フィールド追加のみ |
| 翻訳タブ UI | recording/page.tsx | ファイルが 1678行で複雑 | 既存パターン踏襲 |
| Frontend Recording 型 | web/src/types/index.ts | 型追加のみ | 後方互換 |

### 5.3 他 Issue/機能との相互作用

- **Issue #103 (補正リトライ)**: 翻訳補正にもリトライ機能を追加する必要がある
- **Issue #70 (文字起こし補正)**: 同一 LLM を使用するため、連続呼び出しでレート制限リスク

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Azure OpenAI | 共有デプロイメント使用 | 2つの補正が同時にリクエストされるとレート制限リスク |
| Cosmos DB | スキーマレス | 低（新フィールド追加のみ） |
| ブラウザ | 影響なし | - |

---

## 7. 修正提案（優先順位付き）

### Phase 1: データモデル拡張（P0）

#### 7.1.1 API モデル拡張

**ファイル**: `api/src/models/recording.ts`

`Recording` インターフェースに以下を追加:

```typescript
// 翻訳AI補正 (Issue #125)
correctedTranslations?: { [languageCode: string]: Translation };
translationCorrectionStatus?: "pending" | "processing" | "completed" | "failed";
translationCorrectionError?: string;
translationCorrectedAt?: string;
```

#### 7.1.2 Frontend 型拡張

**ファイル**: `web/src/types/index.ts`

`Recording` インターフェースに以下を追加:

```typescript
// 翻訳AI補正 (Issue #125)
correctedTranslations?: Record<string, Translation>;
translationCorrectionStatus?: "pending" | "processing" | "completed" | "failed";
translationCorrectionError?: string;
translationCorrectedAt?: string;
```

### Phase 2: バックエンド補正サービス実装（P0）

#### 7.2.1 翻訳補正サービス作成

**新規ファイル**: `api/src/services/translationCorrectionService.ts`

文字起こし補正サービス (`transcriptCorrectionService.ts`) のパターンを横展開:

```typescript
// 翻訳テキスト用プロンプト（翻訳品質に特化）
const TRANSLATION_CORRECTION_PROMPT = `あなたは翻訳テキストを校正する専門家です。
以下の機械翻訳テキストを確認し、不自然な表現のみを修正してください。

【修正すべきもの】
- 不自然な直訳表現
- ぎこちない語順
- 文脈に合わない単語選択
- 固有名詞の不適切な翻訳

【修正してはいけないもの】
- 原文の意味や情報
- 専門用語（文脈が不明な場合）
- 翻訳スタイルの大幅な変更

修正後のテキスト全文のみを返してください。説明は不要です。`;

export async function correctTranslation(
  translation: Translation,
  sourceLanguage: string,
  targetLanguage: string
): Promise<Translation> { ... }

export async function processTranslationCorrection(
  recordingId: string,
  userId: string
): Promise<void> { ... }
```

#### 7.2.2 保存時の自動キック

**ファイル**: `api/src/services/recordingService.ts`

`createRecording()` と `saveRecordingWithAudio()` で翻訳が存在する場合に `processTranslationCorrection()` を fire-and-forget でキック。

**重要**: transcript 補正と翻訳補正は **順次実行** にする（同時実行だとレート制限リスク）。

推奨パターン:
```typescript
if (request.transcript?.fullText) {
  processTranscriptCorrection(result.id, result.userId)
    .then(() => {
      // transcript 補正完了後に翻訳補正を開始
      if (request.translations && Object.keys(request.translations).length > 0) {
        return processTranslationCorrection(result.id, result.userId);
      }
    })
    .catch((err) => { ... });
}
```

#### 7.2.3 手動リトライ API エンドポイント

**ファイル**: `api/src/functions/recordings.ts`

新規エンドポイント追加:
```
POST /api/recordings/{id}/correct-translation
```

### Phase 3: フロントエンド UI 実装（P1）

#### 7.3.1 翻訳タブにオリジナル/AI補正版 切り替え

**ファイル**: `web/src/app/recording/page.tsx`

文字起こしタブの `transcriptView` パターンを翻訳タブに横展開:

1. `translationView` state 追加 (`"original" | "corrected"`)
2. `displayTranslations` memo 追加
3. 翻訳タブヘッダーに切り替えボタン追加
4. 翻訳補正ステータスバッジ追加
5. リトライボタン追加

#### 7.3.2 Frontend API サービス

**ファイル**: `web/src/services/recordingsApi.ts`

```typescript
async retryTranslationCorrection(id: string): Promise<ApiResponse<{ message: string }>> {
  // POST /api/recordings/{id}/correct-translation
}
```

#### 7.3.3 i18n メッセージ追加

**ファイル**: `web/messages/{ja,en,es}.json`

```json
"translationCorrectionPending": "⏳ 翻訳AI補正中...",
"translationCorrectionCompleted": "✨ 翻訳AI補正済み",
"translationCorrectionFailed": "❌ 翻訳補正失敗",
"retryTranslationCorrection": "再試行",
"originalTranslation": "オリジナル",
"aiCorrectedTranslation": "AI補正版"
```

### Phase 4: 堅牢性強化（P2）

- 翻訳補正の並列実行ガード
- レート制限対応（transcript 補正との間に delay 挿入）
- エラーハンドリングの充実
- ポーリング UI の統合（transcript + translation ステータスの両方を監視）

---

## 8. テスト戦略

### 8.1 状態遷移テスト（Unit）

| テストケース | 期待結果 |
|-------------|---------|
| 翻訳なし → 補正不要 | `translationCorrectionStatus` は `undefined` |
| 翻訳あり → 補正開始 | `translationCorrectionStatus: "pending"` → `"processing"` → `"completed"` |
| 補正失敗 → エラー記録 | `translationCorrectionStatus: "failed"`, `translationCorrectionError` に詳細 |
| リトライ → 再実行 | `translationCorrectionStatus: "pending"` に戻る |
| 処理中にリトライ → 拒否 | 409 レスポンス |

### 8.2 統合テスト

| シナリオ | モック | 確認事項 |
|---------|--------|---------|
| 保存 → transcript 補正 → 翻訳補正 | Azure OpenAI | 順次実行、データ整合性 |
| 翻訳補正 API エンドポイント | Cosmos DB | リクエスト/レスポンス |
| 複数言語の翻訳補正 | Azure OpenAI | 各言語の補正結果 |

### 8.3 手動テスト

| テスト | 確認事項 |
|--------|---------|
| 録音保存後、翻訳タブで補正ステータスバッジ表示 | ⏳ → ✨ |
| オリジナル/AI補正版の切り替え | テキスト内容が異なる |
| 補正失敗時のリトライボタン | 再実行で成功 |
| 複数言語の翻訳がある場合 | 全言語が補正される |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | データモデル拡張（API + Frontend） | 15分 | recording.ts, index.ts |
| 2 | translationCorrectionService.ts 作成 | 45分 | 新規ファイル |
| 3 | recordingService.ts に翻訳補正キック追加 | 20分 | recordingService.ts |
| 4 | 手動リトライ API エンドポイント追加 | 15分 | recordings.ts |
| 5 | Frontend API サービスに retryTranslationCorrection 追加 | 10分 | recordingsApi.ts |
| 6 | recording/page.tsx に翻訳切り替え UI 追加 | 40分 | recording/page.tsx |
| 7 | i18n メッセージ追加（3言語） | 10分 | ja/en/es.json |
| 8 | ポーリング UI 統合 | 15分 | recording/page.tsx |
| 9 | ビルド確認・テスト | 20分 | 全体 |
| **合計** | | **約3時間** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| Azure OpenAI レート制限 | 中 | 高 | transcript 補正と翻訳補正の間に 5秒 delay |
| 複数言語の補正で API クォータ超過 | 低 | 中 | 補正対象を 1言語に限定 or 順次実行 |
| Cosmos DB ドキュメントサイズ増大 | 低 | 低 | 翻訳テキストは通常短い |
| recording/page.tsx の更なる肥大化 | 中 | 低 | 将来的にコンポーネント分割を検討 |
| Translation 型の API/Frontend 不整合 | 中 | 中 | 型変換ロジックで吸収 |

---

## 11. 結論

- **最大の問題点**: 翻訳AI補正機能が **完全に未実装**。API、データモデル、UI の全レイヤーで新規実装が必要。
- **推奨する修正順序**: データモデル → バックエンドサービス → API エンドポイント → フロントエンド UI
- **他 Issue への影響**: 他の Issue と独立しており、影響は限定的。
- **判定**: **`GO`** — 文字起こし補正（Issue #70, PR #163）の設計パターンがそのまま横展開可能で、技術的リスクは低い。

---

## 変更ファイル一覧

### 新規作成
| ファイル | 内容 |
|---------|------|
| `api/src/services/translationCorrectionService.ts` | 翻訳補正サービス |

### 変更
| ファイル | 変更内容 |
|---------|---------|
| `api/src/models/recording.ts` | `correctedTranslations` 等のフィールド追加 |
| `api/src/services/recordingService.ts` | 保存時の翻訳補正キック追加 |
| `api/src/functions/recordings.ts` | 翻訳補正リトライ API 追加 |
| `web/src/types/index.ts` | `correctedTranslations` 等の型追加 |
| `web/src/services/recordingsApi.ts` | `retryTranslationCorrection()` 追加 |
| `web/src/app/recording/page.tsx` | 翻訳タブに切り替え UI 追加 |
| `web/messages/ja.json` | 翻訳補正関連メッセージ追加 |
| `web/messages/en.json` | 翻訳補正関連メッセージ追加 |
| `web/messages/es.json` | 翻訳補正関連メッセージ追加 |
