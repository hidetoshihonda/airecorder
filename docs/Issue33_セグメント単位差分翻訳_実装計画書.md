# Issue #33: セグメント単位の差分翻訳 実装計画書

## 概要

リアルタイム翻訳を「全文まとめて翻訳」から「セグメント単位の差分翻訳」に変更し、翻訳レスポンスを 1-2秒 → 100-200ms に改善する。

## 現状分析

### 現在のフロー

```
[useSpeechRecognition] ──segments 確定──→ transcript（全文結合）
                                              ↓
[page.tsx useEffect] ──500ms debounce──→ [useTranslation.translate()]
                                              ↓
                                    Translator REST API（全文送信）
                                              ↓
                                    translatedText（全文上書き）
```

### 現在のコード（page.tsx L193-240）

```typescript
useEffect(() => {
  const textToTranslate = transcript || interimTranscript;
  if (!textToTranslate || textToTranslate === lastTranslatedTextRef.current) return;
  // ...
  // 毎回 transcript 全文を translate() に送信
  translationTimeoutRef.current = setTimeout(async () => {
    const result = await translate(textToTranslate, sourceLanguage, targetLanguage);
    if (result) setTranslatedText(result);
  }, 500);
}, [transcript, interimTranscript, ...]);
```

### 問題点

| 問題 | 影響 |
|------|------|
| テキスト量に比例してレスポンスが遅くなる | 30分会議後半で 1-2 秒の遅延 |
| 既に翻訳済みの部分も毎回再送信 | API 転送量が冗長 |
| 500ms debounce が体感遅延を悪化 | ユーザーが待たされる |
| F0 のレート制限に引っかかる可能性 | 翻訳が途切れるリスク |

## 設計

### 改善後のフロー

```
[useSpeechRecognition] ──新セグメント確定──→ segments 配列
                                                  ↓
[page.tsx useEffect] ──新規セグメントのみ検知──→ [useTranslation.translateSegment()]
                                                  ↓
                                        Translator REST API（50文字程度）
                                                  ↓
                                        translatedSegments に追記
```

### 1. useTranslation フックの拡張

#### 新規追加メソッド・state

```typescript
// 追加する型
interface TranslatedSegment {
  segmentId: string;       // 元の LiveSegment.id
  originalText: string;    // 原文
  translatedText: string;  // 翻訳文
  speaker?: string;        // 話者情報引き継ぎ
  speakerLabel?: string;   // 話者ラベル引き継ぎ
}

// useTranslation の返り値に追加
interface UseTranslationReturn {
  // ... 既存
  translatedSegments: TranslatedSegment[];         // 翻訳済みセグメント配列
  translateSegment: (segment: LiveSegment, from: string, to: string) => Promise<void>;
  translatedFullText: string;                       // 結合済み翻訳テキスト（表示用）
  interimTranslation: string;                       // 中間結果の翻訳
  translateInterim: (text: string, from: string, to: string) => Promise<void>;
  resetSegments: () => void;                        // リセット
}
```

#### 内部実装方針

```typescript
// セグメントキャッシュ（翻訳済み segmentId を管理）
const translatedIdsRef = useRef<Set<string>>(new Set());
const [translatedSegments, setTranslatedSegments] = useState<TranslatedSegment[]>([]);

const translateSegment = useCallback(async (segment: LiveSegment, from: string, to: string) => {
  // 既に翻訳済みならスキップ
  if (translatedIdsRef.current.has(segment.id)) return;
  translatedIdsRef.current.add(segment.id);

  const result = await translate(segment.text, from, to);
  if (result) {
    setTranslatedSegments(prev => [...prev, {
      segmentId: segment.id,
      originalText: segment.text,
      translatedText: result,
      speaker: segment.speaker,
      speakerLabel: segment.speakerLabel,
    }]);
  }
}, [translate]);
```

### 2. page.tsx の翻訳ロジック変更

#### 変更前: 全文翻訳

```typescript
// transcript 全体を監視 → 500ms debounce → 全文翻訳
useEffect(() => {
  const textToTranslate = transcript || interimTranscript;
  // ...全文を translate()
}, [transcript, interimTranscript, ...]);
```

#### 変更後: セグメント差分翻訳

```typescript
// segments 配列を監視 → 新規セグメントのみ即時翻訳
const prevSegmentCountRef = useRef(0);

useEffect(() => {
  if (!isRealtimeTranslation || !showRecordingUI) return;

  // 新規セグメントのみ処理
  const newSegments = segments.slice(prevSegmentCountRef.current);
  prevSegmentCountRef.current = segments.length;

  for (const seg of newSegments) {
    translateSegment(seg, sourceLanguage, targetLanguage);
  }
}, [segments, sourceLanguage, targetLanguage, isRealtimeTranslation, showRecordingUI, translateSegment]);

// Interim（中間結果）の翻訳は debounce 付き（300ms）
useEffect(() => {
  if (!interimTranscript || !isRealtimeTranslation) return;
  const timeout = setTimeout(() => {
    translateInterim(interimTranscript, sourceLanguage, targetLanguage);
  }, 300);
  return () => clearTimeout(timeout);
}, [interimTranscript, sourceLanguage, targetLanguage, isRealtimeTranslation, translateInterim]);
```

### 3. 翻訳タブの表示変更

#### 変更前
```typescript
// 単一文字列を表示
<p>{translatedText}</p>
```

#### 変更後
```typescript
// TranscriptView コンポーネントを再利用（話者ラベル付き翻訳セグメント表示）
// translatedSegments を LiveSegment 形式に変換して渡す
const translationViewSegments = useMemo(() =>
  translatedSegments.map(ts => ({
    id: ts.segmentId,
    text: ts.translatedText,
    speaker: ts.speaker,
    speakerLabel: ts.speakerLabel,
    timestamp: 0,
  })),
  [translatedSegments]
);
```

### 4. 録音停止時の全文翻訳（フォールバック）

録音停止時は、セグメント単位の翻訳結果を結合して表示。  
差分が生じた場合（ネットワークエラーで一部未翻訳）は、全文翻訳にフォールバック：

```typescript
useEffect(() => {
  if (!showRecordingUI && transcript && translatedSegments.length < segments.length) {
    // 一部未翻訳がある → 全文翻訳にフォールバック
    translate(transcript, sourceLanguage, targetLanguage).then(result => {
      if (result) setTranslatedText(result);
    });
  }
}, [showRecordingUI]);
```

## 変更ファイル一覧

| ファイル | 変更内容 | 変更規模 |
|---------|---------|---------|
| `web/src/hooks/useTranslation.ts` | `translateSegment()`, `translatedSegments` 追加 | 大 |
| `web/src/app/page.tsx` | 翻訳 useEffect をセグメント単位に変更、表示を差分対応 | 大 |
| `web/src/types/index.ts` | `TranslatedSegment` 型追加 | 小 |

## 実装ステップ

| Step | 作業内容 | 見積り |
|------|---------|--------|
| 1 | `types/index.ts` に `TranslatedSegment` 型追加 | 10min |
| 2 | `useTranslation.ts` に `translateSegment`, `translatedSegments` state 追加 | 45min |
| 3 | `page.tsx` の翻訳 useEffect をセグメント差分方式に変更 | 45min |
| 4 | 翻訳タブの表示を `translatedSegments` ベースに変更 | 30min |
| 5 | 録音停止時のフォールバック実装 | 20min |
| 6 | テスト・動作確認 | 30min |
| **合計** | | **約 3 時間** |

## テスト観点

| テストケース | 確認内容 |
|------------|---------|
| 通常録音 + RT翻訳 ON | セグメントごとに翻訳が追記される |
| 長時間録音（50セグメント以上） | パフォーマンス低下がないこと |
| RT翻訳 OFF → ON 切替 | 切替時に未翻訳セグメントがまとめて翻訳される |
| 録音停止後 | 全翻訳結果が表示される |
| ネットワークエラー時 | 一部失敗しても他セグメントは表示される |
| 話者識別 ON | 翻訳セグメントに speaker 情報が付与される |
| 言語切替 | 既存翻訳キャッシュがクリアされ、再翻訳される |

## リスクと対策

| リスク | 確率 | 対策 |
|--------|------|------|
| セグメント単位だと文脈が不足し翻訳品質が下がる | 中 | 前後1セグメントのコンテキストを付与して送信（オプション） |
| API 呼び出し回数が増加しレート制限に到達 | 低 | セグメント確定間隔は数秒→F0 でも問題なし |
| セグメント順序の不整合 | 低 | segmentId で順序管理、非同期完了順に依存しない |
