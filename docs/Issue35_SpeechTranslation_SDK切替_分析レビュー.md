# Issue #35: Speech Translation SDK 切替 — 深掘り分析レビュー

**作成日**: 2025-07-15  
**レビュアー**: ReviewAAgent  
**ステータス**: 分析完了  
**関連 Issue**: #33（セグメント差分翻訳）, #34（フレーズリスト）  
**前提**: #33（PR #116 merged）, #34（PR #115 merged）完了済み

---

## 1. エグゼクティブサマリー

**問題の本質**: 現在の「SpeechRecognizer（音声認識）→ Translator REST API（翻訳）」の2段階構成では、セグメント確定→REST呼び出し→レスポンス受信の間に **300〜800ms の翻訳遅延** が不可避。Azure Speech SDK 内蔵の `TranslationRecognizer` に統合すれば、認識と翻訳が1パイプラインで同時出力され、**翻訳レイテンシをほぼゼロ** にできる。

**影響範囲**: リアルタイム翻訳を使用する全ユーザー（推定利用率 60〜80%）。話者識別 OFF 時のみ SDK モード適用、ON 時は既存の API モード（#33）にフォールバック。

**緊急度**: **Medium（P1）** — 機能改善。既存システムは #33 で大幅改善済みのため、即座の修正は不要だが、UX 向上のインパクトが大きい。

---

## 2. アーキテクチャ概観

### 2.1 現行アーキテクチャ（2段階構成）

```
マイク → [SpeechRecognizer / ConversationTranscriber]
           │
           ├─ recognizing → interimTranscript（中間結果）
           │                  ↓ 300ms debounce
           │                  translateInterim() → Translator REST API → interimTranslation
           │
           └─ recognized → segment 確定
                              ↓ 即座
                              translateSegment() → Translator REST API → translatedSegments[]
```

**レイテンシ**: segment 確定後 300〜800ms（REST API ラウンドトリップ）

### 2.2 目標アーキテクチャ（SDK 統合）

```
マイク → [TranslationRecognizer（SpeechTranslationConfig）]
           │
           ├─ recognizing → event.result.text（原文中間）
           │                 event.result.translations.get("en")（翻訳中間）
           │                 → 同時出力、追加 API 呼び出し不要
           │
           └─ recognized → event.result.text（原文確定）
                            event.result.translations.get("en")（翻訳確定）
                            → 同時出力、追加 API 呼び出し不要
```

**レイテンシ**: ≈ 0ms（認識と翻訳が同一イベントで出力）

### 2.3 コンポーネント依存関係図

```
page.tsx
├── useSpeechRecognition ─── SpeechRecognizer / ConversationTranscriber
│     ├── segments (LiveSegment[])
│     ├── interimTranscript
│     └── transcript
│
├── useTranslation ────── Translator REST API
│     ├── translateSegment(seg, from, to) → translatedSegments[]
│     ├── translateInterim(text, from, to) → interimTranslation
│     └── translatedFullText
│
├── [NEW] useTranslationRecognizer ── TranslationRecognizer (SpeechTranslationConfig)
│     ├── segments (LiveSegment[])
│     ├── translatedSegments (TranslatedSegment[])
│     ├── interimTranscript + interimTranslation（同時出力）
│     └── transcript + translatedFullText
│
├── useAudioRecorder ─── MediaRecorder
├── useRecordingStateMachine ─── FSM
├── useSpeakerManager ─── 話者ラベル管理
└── useTextToSpeech ─── SpeechSynthesizer
```

### 2.4 モード切替ロジック

```
if (enableSpeakerDiarization === true)
  → "api" モード: useSpeechRecognition + useTranslation（既存、#33 差分翻訳）
else
  → "sdk" モード: useTranslationRecognizer（新規、認識+翻訳同時）
```

### 2.5 状態管理の構造

| State 変数 | 管理場所 | SDK モード | API モード |
|------------|---------|-----------|-----------|
| `isListening` | Hook | useTranslationRecognizer | useSpeechRecognition |
| `isPaused` | Hook | useTranslationRecognizer | useSpeechRecognition |
| `segments` | Hook | useTranslationRecognizer | useSpeechRecognition |
| `translatedSegments` | Hook | useTranslationRecognizer | useTranslation |
| `interimTranscript` | Hook | useTranslationRecognizer | useSpeechRecognition |
| `interimTranslation` | Hook | useTranslationRecognizer | useTranslation |
| `transcript` | Hook (derived) | useMemo from segments | useMemo from segments |
| `translatedFullText` | Hook (derived) | useMemo from translatedSegments | useMemo from translatedSegments |
| `recordingState` | useRecordingStateMachine | 共通（FSM） | 共通（FSM） |
| `displayTranslation` | page.tsx (useMemo) | 共通（統合ロジック） | 共通（統合ロジック） |

---

## 3. 重大バグ分析 🔴

> **注**: Issue #35 は機能追加であり、既存コードに重大バグはない。  
> 以下は **実装時に発生しうるリスクの高いバグパターン** を事前分析する。

### BUG-1: TranslationRecognizer の pause/resume でコンテキスト喪失 [Medium]

**場所**: `web/src/hooks/useSpeechRecognition.ts` L236-L282（pause/resume 実装パターン）  
**コード**:
```typescript
// 現行 SpeechRecognizer の pause: stopContinuousRecognitionAsync → 再 start
// 現行 ConversationTranscriber の pause: stopTranscribingAsync → 新インスタンス作成
```
**問題**: `TranslationRecognizer` には `pause` API がない。`SpeechRecognizer` と同様に `stopContinuousRecognitionAsync` → `startContinuousRecognitionAsync` で再開する必要がある。ただし `SpeechRecognizer` の場合は同じインスタンスを再利用できるが、`TranslationRecognizer` でも同じ動作が保証されるか未検証。  
**影響**: 一時停止→再開後に翻訳が出なくなる可能性。  
**根本原因**: SDK の内部状態管理が stop 後の再 start をサポートしているかが不明確。  
**修正方針**: `SpeechRecognizer` と同じパターン（同一インスタンスの stop/re-start）を先に試し、失敗する場合は `ConversationTranscriber` パターン（インスタンス再作成）にフォールバック。segments は state で保持しているため表示データは失われない。

### BUG-2: targetLanguage コード変換の不整合 [High]

**場所**: `web/src/lib/config.ts` L62-L71（SUPPORTED_LANGUAGES 定義）  
**コード**:
```typescript
{ code: "zh-CN", name: "中文（简体）", translatorCode: "zh-Hans", flag: "🇨🇳" },
```
**問題**: `TranslationRecognizer.addTargetLanguage()` に渡すコードは Translator API 形式（`"zh-Hans"`）だが、実装計画書では `targetLanguage.split("-")[0]`（= `"zh"`）で変換している。中国語の場合 `"zh"` と `"zh-Hans"` は異なり、`"zh"` では翻訳が返らない可能性がある。  
**影響**: 中国語翻訳が失敗する。全ユーザーの言語選択肢に影響。  
**根本原因**: `SUPPORTED_LANGUAGES` の `translatorCode` フィールドを使わず、`code.split("-")[0]` で簡易変換している。  
**修正方針**: `SUPPORTED_LANGUAGES` から `translatorCode` を引いて `addTargetLanguage()` に渡す。

```typescript
// ❌ 間違い
const targetLangCode = targetLanguage.split("-")[0]; // "zh-CN" → "zh"（不正確）

// ✅ 正しい
const langConfig = SUPPORTED_LANGUAGES.find(l => l.code === targetLanguage);
const targetLangCode = langConfig?.translatorCode || targetLanguage.split("-")[0];
// "zh-CN" → "zh-Hans"（正確）
```

### BUG-3: 両モードの Hook が常に初期化される問題 [High]

**場所**: `web/src/app/page.tsx` L121-L165（Hook 初期化部分）  
**問題**: React の Hook ルール上、条件付きで Hook を呼び出すことはできない。実装計画書の設計（`translationMode === "sdk" ? sdkSegments : apiSegments`）では、**両方の Hook が常にマウントされる**。SDK モードでも `useSpeechRecognition` + `useTranslation` が初期化され、API モードでも `useTranslationRecognizer` が初期化される。  
**影響**: 使わないモードの Hook が無駄にリソースを確保。ただし `startListening` を呼ばなければ実際のリソース（マイク、WebSocket）は消費されないため、パフォーマンス影響は軽微。  
**根本原因**: React Hooks の呼び出しルール（条件分岐不可）。  
**修正方針**: 
- **方針A**: 両モード常に初期化するが、`startListening` はアクティブモードのみ呼ぶ（推奨）
- **方針B**: Hook 内部で `enabled: boolean` フラグを受け取り、`false` 時は一切の副作用を無効化

---

## 4. 設計上の問題 🟡

### DESIGN-1: useSpeechRecognition と useTranslationRecognizer の重複コード [Medium]

**場所**: `web/src/hooks/useSpeechRecognition.ts` 全体 (343行)  
**問題**: `useTranslationRecognizer` の認識処理（`recognizing`, `recognized`, pause/resume, segments 管理等）は `useSpeechRecognition` の SpeechRecognizer モードとほぼ同一。コードの大部分が重複する。  
**影響**: 保守性の低下。バグ修正が2箇所必要になる。  
**対策**: 
- **Phase 1**: 独立した Hook として実装（速度優先）
- **Phase 2**: 共通ロジック（segments 管理、pause/resume FSM、エラーハンドリング）を `useRecognizerBase` として抽出

### DESIGN-2: page.tsx のモード切替が複雑化 [Medium]

**場所**: `web/src/app/page.tsx`（現時点で 1508 行）  
**問題**: SDK/API の2モード分のデータソースを `active*` 変数で切り替えると、page.tsx がさらに肥大化する。保存処理 (`handleSaveWithTitle`)、議事録生成 (`handleGenerateSummary`)、コピー (`handleCopy`) 等すべてがモード分岐を意識する必要がある。  
**影響**: page.tsx の可読性・保守性がさらに低下。  
**対策**: 
- `useTranslationRecognizer` の返却インターフェースを `useSpeechRecognition` + `useTranslation` の結合と互換にする
- page.tsx 側では **モード共通のインターフェース** を使い、内部でどちらの Hook が動いているか意識しない設計にする

```typescript
// 推奨: 統合インターフェース
const recognitionResult = useUnifiedRecognition({
  mode: enableSpeakerDiarization ? "api" : "sdk",
  // ... 共通パラメータ
});
// → segments, translatedSegments, interimTranscript, interimTranslation, ...
```

### DESIGN-3: SDK モードで話者識別が利用不可の UX ガイダンス不足 [Low]

**問題**: 話者識別 ON/OFF の切替で翻訳モードが自動変更されるが、ユーザーにその理由やトレードオフが伝わらない。  
**対策**: 設定画面 or 録音コントロールバーに「話者識別 ON → API 翻訳（やや遅延あり）」「OFF → SDK 翻訳（低遅延）」の説明を表示。

### DESIGN-4: ✅ Good — セグメントベースの型設計 (TranslatedSegment)

Issue #33 で導入された `TranslatedSegment` 型が、SDK モードでも API モードでもそのまま利用できる。型の設計が将来の拡張を見据えていた点は評価できる。

### DESIGN-5: ✅ Good — PhraseList の抽象化 (Issue #34)

`PhraseListGrammar.fromRecognizer()` は `SpeechRecognizer`, `ConversationTranscriber`, `TranslationRecognizer` いずれにも適用可能。#34 の実装が SDK 切替に直接活かせる設計。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
#34（PhraseList）✅ merged
  │  phraseList パラメータを TranslationRecognizer にも適用可能
  ↓
#33（セグメント差分翻訳）✅ merged
  │  TranslatedSegment 型、translatedSegments 管理パターンを再利用
  │  話者識別 ON 時のフォールバック（API モード）として機能
  ↓
#35（本 Issue）
  │  SDK モード（話者識別 OFF）: TranslationRecognizer で認識+翻訳同時
  │  API モード（話者識別 ON）: #33 の差分翻訳にフォールバック
  ↓
将来 Issue: 話者識別 + 翻訳の両立
```

**ブロッカー**: なし（#33, #34 は完了済み）  
**並行作業**: 他の Issue と独立して実装可能

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| `useTranslationRecognizer` | `microsoft-cognitiveservices-speech-sdk` v1.47+ | Low — 既に導入済み | SDK バージョン固定 |
| `useTranslationRecognizer` | Azure Speech Translation サービス | Medium — 別料金体系 | 従量課金の監視・アラート |
| `page.tsx` モード切替 | `useSpeechRecognition` / `useTranslation` | Low — 既存コード維持 | 両モードのリグレッションテスト |
| `TranslationRecognizer` | `SpeechTranslationConfig` | Low — SDK 内蔵 | API 互換性は SDK バージョンで担保 |
| `SUPPORTED_LANGUAGES.translatorCode` | Azure Translator 言語コード | Medium — 言語コード不一致リスク | BUG-2 の修正方針を適用 |

### 5.3 他 Issue/機能との相互作用

| 既存機能 | 影響 | 詳細 |
|---------|------|------|
| **#33 差分翻訳** | ✅ 共存 | API モードのフォールバックとして維持 |
| **#34 PhraseList** | ✅ 活用 | `PhraseListGrammar.fromRecognizer(translationRecognizer)` で適用 |
| **#70 LLM 文字起こし補正** | ⚠️ 要確認 | SDK モードの transcript がLLM補正入力として使えるか |
| **FSM (useRecordingStateMachine)** | ✅ 互換 | dispatch は共通、Hook 切替のみ |
| **話者識別** | ⚠️ 排他 | SDK モードでは使用不可、自動切替で対応 |
| **保存処理** | ⚠️ 要修正 | `translatedSegments` のデータソース切替が必要 |
| **議事録生成** | ✅ 互換 | `transcript`（テキスト）ベースのため影響なし |

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Chrome (Desktop) | ✅ 完全対応 | Low |
| Edge (Desktop) | ✅ 完全対応 | Low |
| Firefox (Desktop) | ⚠️ 部分対応 | Medium — Speech SDK の WebSocket が正常動作するか要検証 |
| Safari (Desktop/iOS) | ⚠️ 制限あり | Medium — getUserMedia の制限、AudioContext の自動再生ポリシー |
| Chrome (Android) | ⚠️ 要検証 | Medium — バックグラウンド時の WebSocket 切断 |
| iOS Safari | ⚠️ 制限大 | High — メディアストリーム + WebSocket の同時利用に制限 |

**注**: `TranslationRecognizer` は内部的に `SpeechRecognizer` と同じ WebSocket プロトコルを使用するため、既存の `useSpeechRecognition` が動作するブラウザでは基本的に動作する。追加のブラウザ API は不要。

---

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0）— 実装時の必須対応

#### 7.1 BUG-2 修正: translatorCode の正しい利用

```typescript
// web/src/hooks/useTranslationRecognizer.ts

const startListening = useCallback(() => {
  const translationConfig = SpeechSDK.SpeechTranslationConfig.fromSubscription(
    subscriptionKey, region
  );
  translationConfig.speechRecognitionLanguage = sourceLanguage;

  // ✅ SUPPORTED_LANGUAGES から translatorCode を取得
  const langConfig = SUPPORTED_LANGUAGES.find(l => l.code === targetLanguage);
  const targetLangCode = langConfig?.translatorCode || targetLanguage.split("-")[0];
  translationConfig.addTargetLanguage(targetLangCode);

  // ... 以下同様
}, [subscriptionKey, region, sourceLanguage, targetLanguage]);
```

**変更ファイル**: `web/src/hooks/useTranslationRecognizer.ts`（新規）

#### 7.2 BUG-3 修正: Hook 初期化の安全な設計

```typescript
// page.tsx — 両モード常に初期化、startListening のみ切替

// SDK モード（常に初期化）
const sdkResult = useTranslationRecognizer({
  subscriptionKey: speechConfig.subscriptionKey,
  region: speechConfig.region,
  sourceLanguage,
  targetLanguage,
  phraseList: settings.phraseList ?? [],
});

// API モード（常に初期化）
const apiRecognition = useSpeechRecognition({ /* ... */ });
const apiTranslation = useTranslation({ /* ... */ });

// アクティブモードのデータソースを選択
const translationMode = enableSpeakerDiarization ? "api" : "sdk";
const activeSegments = translationMode === "sdk" ? sdkResult.segments : apiRecognition.segments;
// ...
```

**変更ファイル**: `web/src/app/page.tsx`

### Phase 2: 設計改善（P1）

#### 7.3 useTranslationRecognizer フック新規作成

**新規ファイル**: `web/src/hooks/useTranslationRecognizer.ts`

インターフェース設計:
```typescript
interface UseTranslationRecognizerOptions {
  subscriptionKey: string;
  region: string;
  sourceLanguage: string;
  targetLanguage: string;
  phraseList?: string[];
}

interface UseTranslationRecognizerReturn {
  isListening: boolean;
  isPaused: boolean;
  transcript: string;            // derived from segments
  segments: LiveSegment[];
  translatedSegments: TranslatedSegment[];
  interimTranscript: string;
  interimTranslation: string;
  translatedFullText: string;    // derived from translatedSegments
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  pauseListening: () => void;
  resumeListening: () => void;
  resetTranscript: () => void;
}
```

**重要な実装ポイント**:
1. `recognizing` イベントで `event.result.text`（原文中間）と `event.result.translations.get(targetLangCode)`（翻訳中間）を同時取得
2. `recognized` イベントで `LiveSegment` と `TranslatedSegment` を同時生成
3. `PhraseListGrammar.fromRecognizer(recognizer)` で #34 のフレーズリスト適用
4. pause は `stopContinuousRecognitionAsync` → resume は同一インスタンスで `startContinuousRecognitionAsync`（失敗時はインスタンス再作成）

#### 7.4 page.tsx モード切替統合

**変更ファイル**: `web/src/app/page.tsx`

主な変更点:
1. `useTranslationRecognizer` の import 追加
2. `translationMode` の決定ロジック追加
3. `handleStartRecording` で `translationMode` に応じた `startListening` 呼び出し
4. `handleStopRecording` / `handlePauseRecording` / `handleResumeRecording` 同様
5. `displayTranslation` の `useMemo` を SDK モード対応に更新
6. #33 の `useEffect`（セグメント差分翻訳）を API モード限定に（SDK モードでは不要）

#### 7.5 hooks/index.ts エクスポート追加

```typescript
export { useTranslationRecognizer } from "./useTranslationRecognizer";
```

#### 7.6 i18n キー追加

```json
// messages/ja.json
{
  "HomePage": {
    "translationModeSdk": "⚡ SDK翻訳（低遅延）",
    "translationModeApi": "🌐 API翻訳（話者識別対応）",
    "translationModeTooltip": "話者識別をONにするとAPI翻訳に切り替わります"
  }
}
```

### Phase 3: 堅牢性強化（P2）

#### 7.7 翻訳品質の比較検証

SDK モード（TranslationRecognizer）と API モード（Translator REST API）で同一入力に対する翻訳品質を比較。品質差が大きい場合は、設定画面で翻訳モードの手動選択を提供。

#### 7.8 エラーフォールバック

SDK モードで `TranslationRecognizer` の初期化が失敗した場合（サービス非対応、ネットワークエラー等）、自動的に API モードにフォールバック:

```typescript
try {
  // SDK モード開始
  sdkResult.startListening();
} catch {
  // フォールバック: API モードに切替
  console.warn("SDK モード失敗。API モードにフォールバック");
  apiRecognition.startListening();
}
```

#### 7.9 サポート言語ペアの事前チェック

`TranslationRecognizer` がサポートしない言語ペアが存在する場合、事前にチェックして API モードにフォールバック。

---

## 8. テスト戦略

### 8.1 状態遷移テスト（Unit）

| テストケース | 入力 | 期待出力 |
|------------|------|---------|
| SDK モード開始 | `startListening()` 呼び出し | `isListening=true`, TranslationRecognizer 初期化 |
| SDK モード中間結果 | `recognizing` イベント | `interimTranscript` + `interimTranslation` 同時更新 |
| SDK モード確定結果 | `recognized` イベント | `segments` + `translatedSegments` に同時追加 |
| SDK モード一時停止 | `pauseListening()` | `isPaused=true`, `isListening` 維持 |
| SDK モード再開 | `resumeListening()` | `isPaused=false`, 認識再開 |
| SDK モード停止 | `stopListening()` | `isListening=false`, リソース解放 |
| SDK モードリセット | `resetTranscript()` | segments, translatedSegments 両方クリア |
| API モードフォールバック | `enableSpeakerDiarization=true` | 既存の useSpeechRecognition + useTranslation 動作 |

### 8.2 統合テスト

| シナリオ | テスト内容 |
|---------|----------|
| モード自動切替 | 話者識別 OFF で録音開始 → SDK モード確認 → 停止 → 話者識別 ON → 再録音 → API モード確認 |
| 言語切替（録音中） | SDK モードで録音中に targetLanguage 変更 → Recognizer 再作成 → 新言語で翻訳再開 |
| 保存処理 | SDK モード録音 → 停止 → 保存 → `translatedSegments` が正しく永続化 |
| PhraseList 統合 | フレーズリスト設定あり → SDK モード開始 → PhraseListGrammar 適用確認 |
| 長時間録音 | SDK モード 30分録音 → メモリリーク・パフォーマンス劣化なし |
| ネットワーク切断 | 録音中にネットワーク切断 → `canceled` イベント → エラー表示 → 復旧時の挙動 |

### 8.3 手動テスト

| テスト | Chrome | Edge | Firefox | Safari | Mobile |
|--------|--------|------|---------|--------|--------|
| SDK モード基本動作 | ○ | ○ | △ | △ | △ |
| 中間翻訳リアルタイム表示 | ○ | ○ | △ | △ | △ |
| pause/resume | ○ | ○ | △ | △ | △ |
| 言語ペア（ja→en, en→ja, zh→en, ar→en） | ○ | ○ | — | — | — |
| 翻訳品質比較（SDK vs API） | ○ | — | — | — | — |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | `useTranslationRecognizer.ts` 新規作成（基本構造 + 型定義） | 30min | 新規ファイル |
| 2 | `recognizing` / `recognized` イベントハンドラ実装（BUG-2 の translatorCode 修正含む） | 30min | 新規ファイル |
| 3 | pause / resume / stop / reset 実装 | 20min | 新規ファイル |
| 4 | エラーハンドリング（`canceled`, `sessionStopped`） | 15min | 新規ファイル |
| 5 | PhraseList 統合 (#34 互換) | 10min | 新規ファイル |
| 6 | `hooks/index.ts` エクスポート追加 | 2min | 既存ファイル（小） |
| 7 | `page.tsx` モード切替ロジック追加（Hook 初期化 + `translationMode` 決定） | 30min | 既存ファイル（大） |
| 8 | `page.tsx` `handleStartRecording` 等のモード対応 | 20min | 既存ファイル（大） |
| 9 | `page.tsx` #33 useEffect を API モード限定に修正 | 10min | 既存ファイル（中） |
| 10 | `page.tsx` `displayTranslation` 統合 + 翻訳モード表示UI | 15min | 既存ファイル（中） |
| 11 | i18n キー追加（ja, en, es） | 10min | 既存ファイル（小） |
| 12 | テスト・動作確認・デバッグ | 40min | — |
| **合計** | | **約 3.5 時間** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| **BUG-2**: translatorCode 不一致で中国語翻訳失敗 | High | High | `SUPPORTED_LANGUAGES.translatorCode` を使用（必須） |
| TranslationRecognizer の翻訳品質が Translator API と異なる | Medium | Medium | 両モードの出力を比較検証、品質が低い場合は API モードを推奨 |
| 話者識別 + 翻訳の両立要望がユーザーから出る | High | Medium | Phase 2 で検討。当面はモード切替で対応。FAQ で説明 |
| pause/resume 時の Recognizer 再作成で翻訳コンテキスト喪失 | Medium | Low | segments で履歴保持しているため表示には影響なし |
| Speech Translation 料金がユーザーにとって高い ($2.50/h vs $0.96/h) | Medium | Medium | 設定画面で翻訳モード選択を提供（将来）。デフォルトは SDK モード |
| `SpeechTranslationConfig` 非対応の言語ペアが存在 | Low | High | サポート言語を事前チェック、非対応ペアは API モードにフォールバック |
| page.tsx の肥大化（1508行→推定1600行超） | High | Low | Phase 2 でカスタム Hook 統合を検討 |
| 両モード Hook 同時初期化のメモリオーバーヘッド | Low | Low | Hook 内部で `enabled` フラグ制御（将来最適化） |

---

## 11. コスト比較詳細

### Azure Speech Translation 料金体系（2025年時点）

| 項目 | 料金 |
|------|------|
| Speech Translation (Standard) | **$2.50/h**（2言語まで込み） |
| Speech to Text (Standard) | $0.96/h |
| Translator API (F0 Free) | $0/月（2M文字まで） |
| Translator API (S1 Standard) | $10/1M文字 |

### シナリオ別コスト比較

| シナリオ | 現行（Speech + Translator F0） | SDK モード | 差額 |
|---------|------------------------------|-----------|------|
| 1時間会議 | $0.96 | $2.50 | +$1.54 |
| 月20時間（個人） | $19.20 | $50.00 | +$30.80 |
| 月100時間（チーム） | $96.00 | $250.00 | +$154.00 |

### 混合運用時の予想コスト

話者識別 ON（API モード）: 40%、OFF（SDK モード）: 60% と仮定:

| 月利用時間 | API モード (40%) | SDK モード (60%) | 合計 |
|-----------|-----------------|-----------------|------|
| 20時間 | $0.96×8 = $7.68 | $2.50×12 = $30.00 | **$37.68** |
| 50時間 | $0.96×20 = $19.20 | $2.50×30 = $75.00 | **$94.20** |

**結論**: コスト増は避けられないが、翻訳レイテンシ解消によるUX向上が十分なトレードオフとなる。将来的にユーザー設定で翻訳モード選択（速度 vs コスト）を提供することで対応。

---

## 12. 結論

### 最大の問題点
1. **BUG-2（translatorCode 不一致）**: 実装計画書の `split("-")[0]` 方式では中国語等で翻訳失敗。`SUPPORTED_LANGUAGES.translatorCode` を使う修正が必須。
2. **BUG-3（Hook 常時初期化）**: React Hooks ルールにより両モードの Hook が常に初期化される。パフォーマンス影響は軽微だが、設計上の認識が必要。

### 推奨する修正順序
1. `useTranslationRecognizer.ts` 新規作成（BUG-2 修正含む）
2. `hooks/index.ts` エクスポート追加
3. `page.tsx` モード切替ロジック追加（BUG-3 の方針A で対応）
4. i18n キー追加
5. テスト・動作確認

### 他 Issue への影響
- **#33, #34**: 完了済み。API モードのフォールバックとして正常に機能する。
- **将来 Issue（話者識別+翻訳両立）**: Phase 2 として計画。本 Issue のモード切替基盤が前提。
- **#70（LLM 補正）**: SDK モードの transcript も同様に使用可能。影響なし。

### 判定: **GO** ✅

#33, #34 が完了しており、技術的な前提条件はすべて満たされている。  
`TranslationRecognizer` の API は SDK 内蔵で安定しており、実装リスクは限定的。  
BUG-2 の translatorCode 修正を確実に適用すれば、**実装着手可** と判断する。

---

## 変更ファイル一覧

| ファイル | 変更種別 | 変更規模 |
|---------|---------|---------|
| `web/src/hooks/useTranslationRecognizer.ts` | **新規** | 大（〜200行） |
| `web/src/hooks/index.ts` | 修正 | 小（1行追加） |
| `web/src/app/page.tsx` | 修正 | 大（〜80行追加・修正） |
| `web/messages/ja.json` | 修正 | 小（3キー追加） |
| `web/messages/en.json` | 修正 | 小（3キー追加） |
| `web/messages/es.json` | 修正 | 小（3キー追加） |
