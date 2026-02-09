# Issue #35: Speech Translation SDK への切替 実装計画書

## 概要

現在の「Speech SDK（音声認識）+ Translator REST API（翻訳）」の2段階構成を、Azure Speech SDK 内蔵の `TranslationRecognizer` に統合する。音声認識と翻訳が1パイプラインで同時出力されるため、翻訳レイテンシを根本的に解消する。

## 現状分析

### 現在のアーキテクチャ

```
マイク → [Speech SDK]        → テキスト確定
              ↓                      ↓
         SpeechRecognizer     [500ms debounce]
         or                         ↓
         ConversationTranscriber  [Translator REST API]
                                     ↓
                                翻訳テキスト
```

- 2つの独立したサービスを逐次呼び出し
- 音声認識完了 → HTTP リクエスト → 翻訳結果 のレイテンシチェーン
- debounce 500ms が追加遅延

### 改善後のアーキテクチャ

```
マイク → [Speech SDK: TranslationRecognizer] → テキスト + 翻訳（同時出力）
```

- 1パイプラインで完結
- HTTP リクエスト不要
- debounce 不要
- 中間結果（interim）も翻訳付き

## Speech Translation SDK の技術仕様

### TranslationRecognizer の基本構造

```typescript
import * as SpeechSDK from "microsoft-cognitiveservices-speech-sdk";

// SpeechTranslationConfig（SpeechConfig の翻訳拡張版）
const translationConfig = SpeechSDK.SpeechTranslationConfig.fromSubscription(key, region);
translationConfig.speechRecognitionLanguage = "ja-JP";   // 原文言語
translationConfig.addTargetLanguage("en");                // 翻訳先言語（複数可）

const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
const recognizer = new SpeechSDK.TranslationRecognizer(translationConfig, audioConfig);

// 中間結果（リアルタイム）
recognizer.recognizing = (sender, event) => {
  const text = event.result.text;                           // 原文（中間）
  const translatedText = event.result.translations.get("en"); // 翻訳（中間）
};

// 確定結果
recognizer.recognized = (sender, event) => {
  const text = event.result.text;                           // 原文（確定）
  const translatedText = event.result.translations.get("en"); // 翻訳（確定）
};
```

### 制約事項

| 制約 | 影響 | 対策 |
|------|------|------|
| `ConversationTranscriber` と併用不可 | 話者識別 + 同時翻訳ができない | モード切替で対応 |
| 翻訳先言語を途中で変更不可 | Recognizer の再作成が必要 | 停止→再作成→開始のシーケンス |
| 料金が通常 Speech より高い | $2.50/h vs $0.96/h | ユーザーに選択肢を提供 |

## 設計

### 1. 新規フック: useTranslationRecognizer

```typescript
// hooks/useTranslationRecognizer.ts

interface UseTranslationRecognizerOptions {
  subscriptionKey: string;
  region: string;
  sourceLanguage: string;        // "ja-JP"
  targetLanguage: string;        // "en" (Translator 言語コード形式)
  phraseList?: string[];         // Issue #34 との統合
}

interface UseTranslationRecognizerReturn {
  isListening: boolean;
  isPaused: boolean;
  segments: LiveSegment[];              // 原文セグメント
  translatedSegments: TranslatedSegment[]; // 翻訳セグメント
  interimTranscript: string;            // 原文中間結果
  interimTranslation: string;           // 翻訳中間結果
  transcript: string;                   // 原文全文（結合）
  translatedFullText: string;           // 翻訳全文（結合）
  error: string | null;
  startListening: () => void;
  stopListening: () => void;
  pauseListening: () => void;
  resumeListening: () => void;
  resetTranscript: () => void;
}
```

### 2. TranslationRecognizer の内部実装

```typescript
export function useTranslationRecognizer(options: UseTranslationRecognizerOptions): UseTranslationRecognizerReturn {
  const { subscriptionKey, region, sourceLanguage, targetLanguage, phraseList } = options;

  const [segments, setSegments] = useState<LiveSegment[]>([]);
  const [translatedSegments, setTranslatedSegments] = useState<TranslatedSegment[]>([]);
  const [interimTranscript, setInterimTranscript] = useState("");
  const [interimTranslation, setInterimTranslation] = useState("");
  // ... 他 state

  const recognizerRef = useRef<SpeechSDK.TranslationRecognizer | null>(null);

  const startListening = useCallback(() => {
    const translationConfig = SpeechSDK.SpeechTranslationConfig.fromSubscription(
      subscriptionKey, region
    );
    translationConfig.speechRecognitionLanguage = sourceLanguage;

    // 翻訳先言語を追加（Translator 形式: "en", "es" 等）
    const targetLangCode = targetLanguage.split("-")[0]; // "en-US" → "en"
    translationConfig.addTargetLanguage(targetLangCode);

    const audioConfig = SpeechSDK.AudioConfig.fromDefaultMicrophoneInput();
    const recognizer = new SpeechSDK.TranslationRecognizer(translationConfig, audioConfig);

    // フレーズリスト適用（Issue #34）
    if (phraseList && phraseList.length > 0) {
      const grammar = SpeechSDK.PhraseListGrammar.fromRecognizer(recognizer);
      for (const phrase of phraseList) {
        grammar.addPhrase(phrase);
      }
    }

    // 中間結果
    recognizer.recognizing = (_sender, event) => {
      if (event.result.reason === SpeechSDK.ResultReason.TranslatingSpeech) {
        setInterimTranscript(event.result.text);
        setInterimTranslation(event.result.translations.get(targetLangCode) || "");
      }
    };

    // 確定結果
    recognizer.recognized = (_sender, event) => {
      if (event.result.reason === SpeechSDK.ResultReason.TranslatedSpeech) {
        const segId = `seg-${++segmentIdRef.current}`;
        const newText = event.result.text;
        const newTranslation = event.result.translations.get(targetLangCode) || "";

        setSegments(prev => [...prev, {
          id: segId,
          text: newText,
          timestamp: Date.now() - startTimeRef.current,
        }]);

        setTranslatedSegments(prev => [...prev, {
          segmentId: segId,
          originalText: newText,
          translatedText: newTranslation,
        }]);

        setInterimTranscript("");
        setInterimTranslation("");
      }
    };

    // エラー・セッション終了ハンドラ
    recognizer.canceled = (_sender, event) => { /* ... */ };
    recognizer.sessionStopped = () => { /* ... */ };

    recognizerRef.current = recognizer;
    recognizer.startContinuousRecognitionAsync(
      () => setIsListening(true),
      (err) => setError(`開始エラー: ${err}`)
    );
  }, [subscriptionKey, region, sourceLanguage, targetLanguage, phraseList]);

  // ... stop, pause, resume, reset の実装
}
```

### 3. page.tsx のモード切替ロジック

```typescript
// page.tsx

// 翻訳モード: 
//   - "sdk"    : TranslationRecognizer（低レイテンシ、話者識別不可）
//   - "api"    : SpeechRecognizer + Translator API（話者識別可、差分翻訳 Issue #33）
const translationMode = enableSpeakerDiarization ? "api" : "sdk";

// SDK モード
const {
  isListening: sdkIsListening,
  segments: sdkSegments,
  translatedSegments: sdkTranslatedSegments,
  interimTranscript: sdkInterimTranscript,
  interimTranslation: sdkInterimTranslation,
  // ...
} = useTranslationRecognizer({
  subscriptionKey: speechConfig.subscriptionKey,
  region: speechConfig.region,
  sourceLanguage,
  targetLanguage,
  phraseList: settings.phraseList,
});

// API モード（既存の useSpeechRecognition + useTranslation）
const {
  isListening: apiIsListening,
  segments: apiSegments,
  // ...
} = useSpeechRecognition({ /* ... */ });

// モードに応じて使用するデータを切替
const activeSegments = translationMode === "sdk" ? sdkSegments : apiSegments;
const activeTranslation = translationMode === "sdk" ? sdkTranslatedFullText : translatedText;
// ...
```

### 4. 段階的移行戦略

```
Phase 1（本 Issue）:
  ├── useTranslationRecognizer フック作成
  ├── page.tsx でモード自動切替（話者識別 OFF → SDK モード）
  └── 既存の SpeechRecognizer + Translator はフォールバックとして維持

Phase 2（将来）:
  ├── 話者識別 + 翻訳の両立方法を検証
  │   ├── 案A: タイムスタンプベースの話者マッピング
  │   └── 案B: 2つの Recognizer を並行動作
  └── ユーザーに翻訳モード選択UIを提供

Phase 3（将来）:
  └── 安定動作確認後、Translator API 依存を optional に
```

### 5. UI での翻訳モード表示

録音中のコントロールバーに現在の翻訳モードを表示：

```
┌──────────────────────────────────────────────────┐
│ ⚡ SDK翻訳（低遅延）  or  🌐 API翻訳（話者識別対応） │
└──────────────────────────────────────────────────┘
```

話者識別 ON/OFF を切り替えると翻訳モードも自動切替される旨を表示。

## 変更ファイル一覧

| ファイル | 変更内容 | 変更規模 |
|---------|---------|---------|
| `web/src/hooks/useTranslationRecognizer.ts` | **新規**: TranslationRecognizer フック | 大（新規） |
| `web/src/hooks/index.ts` | エクスポート追加 | 小 |
| `web/src/app/page.tsx` | モード切替ロジック、データソース切替 | 大 |
| `web/src/types/index.ts` | `TranslatedSegment` 型（Issue #33 と共有） | 小 |
| `web/messages/{ja,en,es}.json` | 翻訳モード表示の i18n キー | 小 |

## Issue #33, #34 との依存関係

```
#34（フレーズリスト）── phraseList オプションを
  │                    TranslationRecognizer にも適用
  ↓
#33（差分翻訳）──── 話者識別 ON 時のフォールバックとして機能
  │
  ↓
#35（本 Issue）──── SDK モード（話者識別 OFF 時）
                    API モード（話者識別 ON 時 → #33 の差分翻訳）
```

**推奨実装順序**: #33 → #34 → #35

- #33 が先にあると、API モード（フォールバック）が高速化された状態で #35 に入れる
- #34 は独立して実装可能だが、#35 の `useTranslationRecognizer` にも `phraseList` を渡す設計のため先に実装するのが効率的

## 実装ステップ

| Step | 作業内容 | 見積り |
|------|---------|--------|
| 1 | `useTranslationRecognizer.ts` 新規作成（基本構造） | 60min |
| 2 | `recognized` / `recognizing` イベントハンドラ実装 | 30min |
| 3 | pause / resume / stop / reset 実装 | 20min |
| 4 | `page.tsx` にモード切替ロジック追加 | 40min |
| 5 | `hooks/index.ts` エクスポート追加 | 5min |
| 6 | i18n キー追加 | 10min |
| 7 | テスト・動作確認 | 35min |
| **合計** | | **約 4 時間** |

## テスト観点

| テストケース | 確認内容 |
|------------|---------|
| SDK モード（話者識別 OFF） | TranslationRecognizer で原文 + 翻訳が同時に出る |
| API モード（話者識別 ON） | 従来の SpeechRecognizer + Translator にフォールバック |
| 中間結果（interim） | 原文と翻訳の両方がリアルタイム表示される |
| 言語切替（録音停止中） | Recognizer が正しく再作成される |
| 一時停止 → 再開 | Recognizer 再作成で翻訳が継続される |
| フレーズリスト（#34 統合） | TranslationRecognizer でも PhraseListGrammar が効く |
| エラーハンドリング | ネットワーク切断時に適切なエラー表示 |
| モード自動切替表示 | UI に現在の翻訳モードが表示される |

## コスト比較

### 1時間の会議の場合

| 構成 | 認識コスト | 翻訳コスト | 合計 |
|------|-----------|-----------|------|
| 現在（Speech + Translator F0） | $0.96 | $0 | **$0.96** |
| SDK モード（TranslationRecognizer） | - | - | **$2.50** |
| 差額 | | | **+$1.54/h** |

### 月30時間利用の場合

| 構成 | 月額 |
|------|------|
| 現在 | **$28.80** |
| 全て SDK モード | **$75.00** |
| 混合（話者識別 ON=API, OFF=SDK） | **$40〜60**（利用比率による） |

## リスクと対策

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| TranslationRecognizer の翻訳品質が Translator API と異なる | 中 | 中 | 両モードの出力を比較検証、品質が低い場合はAPI モードを推奨 |
| 話者識別と同時翻訳の両立要望 | 高 | 中 | Phase 2 で検討。当面はモード切替で対応 |
| Speech Translation の料金がユーザーにとって高い | 中 | 低 | 設定画面で翻訳モード選択を提供（コスト vs 速度のトレードオフ） |
| `startContinuousRecognitionAsync` で翻訳が出ない言語ペアがある | 低 | 高 | サポート言語を事前チェック、非対応ペアは API モードにフォールバック |
| pause/resume 時の Recognizer 再作成で翻訳コンテキストが失われる | 中 | 低 | segments で翻訳履歴を保持しているため表示には影響なし |
