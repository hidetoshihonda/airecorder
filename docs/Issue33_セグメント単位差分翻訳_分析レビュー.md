# Issue #33: セグメント単位の差分翻訳 — 深掘り分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: 現在のリアルタイム翻訳は、Issue #110 で「テキスト長さベースの差分翻訳」に改善済みだが、依然として **文字列スライス+結合** という脆い方法に依存しており、セグメント（音声認識確定単位）の境界を無視している。セグメント単位に切り替えることで、翻訳粒度の最適化・キャッシュ・話者情報の保持が可能になる。
- **影響範囲**: リアルタイム翻訳を利用する全ユーザー（推定 60-80%）の翻訳体験に直接影響。長時間録音（30分+）では特に効果大。
- **緊急度**: **P1（High）** — 現行の Issue #110 差分翻訳は動作するが、設計的に脆弱（後述 BUG-1, BUG-2）。#35 (Speech Translation SDK) の前提条件でもある。

---

## 2. アーキテクチャ概観

### 2.1 コンポーネント依存関係

```
page.tsx (HomePage)
  ├── useSpeechRecognition  → segments: LiveSegment[], transcript, interimTranscript
  ├── useTranslation        → translate(text, from, to): Promise<string>
  ├── useAudioRecorder      → audioBlob, duration
  ├── useTextToSpeech       → speak()
  ├── useRecordingStateMachine → showRecordingUI, fsmIsRecording
  └── useSpeakerManager     → getSpeakerLabel()
```

### 2.2 現在の翻訳データフロー

```
useSpeechRecognition
  │
  ├── segments[] (LiveSegment[])  ── useMemo ──→ transcript (全文結合)
  │                                                    │
  │                                              ┌─────┴─────┐
  │                                              │  useEffect │ (L234-299)
  │                                              │ 500ms deb  │
  └── interimTranscript ────────────────────────→│            │
                                                 └─────┬─────┘
                                                       │
                                              ┌────────▼────────┐
                                              │  translate()     │  Translator REST API
                                              │  (useTranslation)│
                                              └────────┬────────┘
                                                       │
                                              ┌────────▼────────┐
                                              │  translatedText  │  useState<string>
                                              │  (単一文字列)     │
                                              └────────┬────────┘
                                                       │
                                              ┌────────▼────────┐
                                              │  翻訳タブ表示    │
                                              │  getRecentSentences() │
                                              └─────────────────┘
```

### 2.3 Issue #110 で導入済みの差分翻訳メカニズム

`page.tsx` L95-97 で管理:
```typescript
const lastTranslatedLengthRef = useRef(0);       // 前回翻訳済みの transcript 長さ
const accumulatedTranslationRef = useRef("");     // 蓄積された翻訳結果
```

**差分計算ロジック** (L263-289):
```typescript
const newConfirmedText = transcript.slice(lastTranslatedLengthRef.current);
const deltaText = newConfirmedText + (interimTranscript ? " " + interimTranscript : "");
// ...
accumulatedTranslationRef.current += confirmedResult;
lastTranslatedLengthRef.current = transcript.length;
```

### 2.4 提案するセグメント単位翻訳後のデータフロー

```
useSpeechRecognition
  │
  ├── segments[] (LiveSegment[]) ──────────→ useEffect (新規セグメント検知)
  │                                                  │
  │                                          translateSegment()
  │                                                  │
  └── interimTranscript ───── 300ms deb ──→ translateInterim()
                                                     │
                                            translatedSegments[]
                                            (TranslatedSegment[])
                                                     │
                                            translatedFullText
                                            (useMemo: 結合済み)
                                                     │
                                            翻訳タブ表示
                                            (セグメント単位 or 全文)
```

---

## 3. 重大バグ分析 🔴

### BUG-1: テキストスライスベースの差分翻訳がセグメント境界を無視 [High]

**場所**: `web/src/app/page.tsx` L263-265
**コード**:
```typescript
const newConfirmedText = transcript.slice(lastTranslatedLengthRef.current);
const deltaText = newConfirmedText + (interimTranscript ? " " + interimTranscript : "");
```
**問題**: `transcript` は `segments.map(s => s.text).join(" ")` で結合された文字列。`slice()` で切り出すと、セグメント境界の途中で切れる可能性がある。例:
- セグメント1: "本日はお越しいただき" → transcript: "本日はお越しいただき"
- lastTranslatedLengthRef = 8 → `slice(8)` = "いただき"（文の途中）

**影響**: 翻訳品質の劣化。文脈のない断片が翻訳APIに送信される。
**根本原因**: Issue #110 がセグメントの存在を知らず、文字列長ベースで差分を計算している。
**修正方針**: セグメント単位の差分検知に切り替え（本 Issue の主題）。

### BUG-2: accumulatedTranslationRef と interim の結合ロジックが不正確 [High]

**場所**: `web/src/app/page.tsx` L280-288
**コード**:
```typescript
// Translate only confirmed portion to accumulate
const confirmedResult = interimTranscript
  ? await translate(newConfirmedText, sourceLanguage, targetLanguage)
  : result;
// ...
const interimPart = interimTranscript
  ? " " + result.split(" ").slice(-interimTranscript.split(" ").length).join(" ")
  : "";
setTranslatedText((accumulatedTranslationRef.current + interimPart).trim());
```
**問題**:
1. `interimTranscript` が存在すると **2回** translate() が呼ばれる（deltaText全体 + newConfirmedText のみ）→ API コスト2倍
2. `result.split(" ").slice(-interimTranscript.split(" ").length)` — 翻訳後テキストの単語数と原文の単語数が一致する保証はない（特に日本語→英語など語順が変わる言語ペア）
3. この不正確な結合により、翻訳結果に重複や欠落が発生する。

**影響**: ユーザーの約 60-80% に影響。日本語↔英語ペアで翻訳テキストが乱れる。
**根本原因**: 文字列操作で翻訳の差分を組み立てようとする設計上の限界。
**修正方針**: セグメント単位で翻訳を管理し、確定セグメントは再翻訳しない。interim は最後のセグメントとして独立管理。

### BUG-3: 録音停止時の全文翻訳がセグメント翻訳と重複 [Medium]

**場所**: `web/src/app/page.tsx` L248-256
**コード**:
```typescript
if (!showRecordingUI && transcript) {
  lastTranslatedTextRef.current = transcript;
  translate(transcript, sourceLanguage, targetLanguage).then((result) => {
    if (result) {
      setTranslatedText(result);
    }
  });
  return;
}
```
**問題**: 録音停止時に **常に全文を再翻訳** する。リアルタイム翻訳で既に全セグメント翻訳済みでも重複送信。長時間録音では3000文字超のテキストが送信される。
**影響**: 不要なAPI呼び出し、F0 レート制限へのリスク。
**根本原因**: リアルタイム翻訳結果の信頼性が低いため、停止時に全文再翻訳で補正する設計。
**修正方針**: セグメント翻訳でカバー率が100%なら再翻訳不要。未翻訳セグメントがある場合のみフォールバック。

---

## 4. 設計上の問題 🟡

### DESIGN-1: 翻訳状態が単一文字列で管理されている [High]

**場所**: `web/src/app/page.tsx` L71
```typescript
const [translatedText, setTranslatedText] = useState("");
```
**問題**: 全翻訳結果を1つの文字列に格納。セグメントとの対応関係が失われ、以下ができない:
- 個別セグメントの再翻訳（言語切替時の部分更新）
- 話者ラベル付き翻訳表示
- セグメント単位のコピー
- 翻訳結果の永続化（Recording.translations.segments との整合性）

### DESIGN-2: Ref 多用による可読性・デバッグ困難 [Medium]

**場所**: `web/src/app/page.tsx` L91-97
```typescript
const lastTranslatedTextRef = useRef<string>("");
const translationTimeoutRef = useRef<NodeJS.Timeout | null>(null);
const lastTranslatedLengthRef = useRef(0);
const accumulatedTranslationRef = useRef("");
```
**問題**: 4つの Ref で翻訳状態を管理。React DevTools でデバッグ不可。リセット漏れのリスク。
**修正方針**: セグメント単位管理に移行し、Ref は `translatedIdsRef` (Set) のみに簡素化。

### DESIGN-3: useTranslation フックが薄すぎる [Medium]

**場所**: `web/src/hooks/useTranslation.ts` (全130行)
**問題**: 現在の useTranslation は単純な `translate(text, from, to)` ラッパーのみ。セグメント管理・キャッシュ・バッチ処理の責務がすべて page.tsx に漏れ出している。
**修正方針**: `translateSegment()`, `translatedSegments`, `translatedFullText`, `resetSegments()` をフックに内包する。

### DESIGN-4: 保存時の翻訳データが貧弱 [Medium]

**場所**: `web/src/app/page.tsx` L600-608
```typescript
translations: translatedText ? {
  [targetLanguage]: {
    languageCode: targetLanguage,
    segments: [{
      originalSegmentId: "1",
      text: translatedText,
    }],
    fullText: translatedText,
  },
} : undefined,
```
**問題**: `segments` が常に1要素（全文を1セグメントとして保存）。`TranslationSegment.originalSegmentId` が `"1"` 固定で、元の音声セグメントとの紐づけが不可能。
**修正方針**: `translatedSegments` から `TranslationSegment[]` を生成し、セグメント対応で保存。

### ✅ Good: transcript が segments から派生している

`useSpeechRecognition.ts` L43-46:
```typescript
const transcript = useMemo(
  () => segments.map((s) => s.text).join(" "),
  [segments]
);
```
segments が Primary Data Source として機能しており、セグメント単位翻訳への移行が自然にできる良い設計。

### ✅ Good: LiveSegment にユニーク ID がある

```typescript
id: `seg-${++segmentIdRef.current}`,
```
セグメントごとに一意な ID が付与されており、翻訳キャッシュのキーとして即座に利用可能。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #34 (PhraseList) ✅ 完了
      │
      ▼
Issue #33 (セグメント差分翻訳) ← 本 Issue
      │
      ▼
Issue #35 (Speech Translation SDK)
      │  - #33 でセグメント翻訳基盤ができれば、
      │    話者識別 ON 時のフォールバックとして活用可能
      │  - TranslationRecognizer の translatedSegments と
      │    Translator API の translatedSegments を同じ型で管理
      ▼
Issue #110 (差分翻訳) ✅ 完了（#33 で置換される）
```

**依存関係の結論**:
- **#34 → #33**: #34 完了済み。#33 は独立して着手可能。
- **#33 → #35**: #33 の `TranslatedSegment` 型・`translatedSegments` 管理は #35 でそのまま活用される。#33 を先に実装すべき。
- **#33 → #110**: #33 は #110 の差分翻訳ロジックを **完全に置換** する。#110 の Ref ベースの差分管理は不要になる。

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| `useTranslation.translateSegment()` | Translator REST API | F0 レート制限 | セグメント確定間隔（3-5秒）で十分余裕 |
| `translatedSegments` state | `LiveSegment.id` | ID フォーマット変更 | `seg-N` 形式は安定、変更リスク低 |
| 保存ロジック | `Translation.segments` 型 | 既存データとの互換性 | 追記方式で後方互換を維持 |
| 翻訳タブ表示 | `translatedText` → `translatedSegments` | 表示ロジック全面変更 | `translatedFullText` (useMemo) で既存の単一文字列表示も維持 |

### 5.3 他機能との相互作用

| 機能 | 影響 | 対策 |
|------|------|------|
| Issue #105 (表示モード切替) | `getRecentSentences()` は `translatedFullText` に対して動作可能 | `translatedFullText` を提供すれば互換性維持 |
| Issue #4 (自動追従スクロール) | `translatedText` の変更トリガーが `translatedFullText` に変わる | useEffect の依存を差し替え |
| 話者識別表示 | 翻訳セグメントにも speaker 情報を付与可能に | TranslatedSegment に speaker/speakerLabel を含める |
| コピー機能 | 翻訳テキストのコピーは `translatedFullText` で動作 | 互換性維持 |
| 読み上げ機能 | `speak(translatedText)` → `speak(translatedFullText)` | 参照先の差し替えのみ |

---

## 6. ブラウザ / 環境互換性リスク

該当なし。本 Issue は Translator REST API の呼び出し方の変更であり、ブラウザ API には依存しない。

---

## 7. 修正提案（優先順位付き）

### Phase 1: セグメント翻訳基盤（P0 — 致命的バグ修正）

#### Step 1: `TranslatedSegment` 型の追加

**ファイル**: `web/src/types/index.ts`

```typescript
/** セグメント単位の翻訳結果 */
export interface TranslatedSegment {
  segmentId: string;       // 元の LiveSegment.id
  originalText: string;    // 原文
  translatedText: string;  // 翻訳文
  speaker?: string;        // 話者 ID
  speakerLabel?: string;   // 話者ラベル
}
```

#### Step 2: `useTranslation` フックの拡張

**ファイル**: `web/src/hooks/useTranslation.ts`

追加する state とメソッド:
```typescript
// State
const translatedIdsRef = useRef<Set<string>>(new Set());
const [translatedSegments, setTranslatedSegments] = useState<TranslatedSegment[]>([]);
const [interimTranslation, setInterimTranslation] = useState("");

// Derived
const translatedFullText = useMemo(
  () => translatedSegments.map(s => s.translatedText).join(" "),
  [translatedSegments]
);

// Methods
const translateSegment = useCallback(async (segment: LiveSegment, from, to) => {
  if (translatedIdsRef.current.has(segment.id)) return; // キャッシュチェック
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

const translateInterim = useCallback(async (text, from, to) => {
  const result = await translate(text, from, to);
  if (result) setInterimTranslation(result);
}, [translate]);

const resetSegments = useCallback(() => {
  translatedIdsRef.current.clear();
  setTranslatedSegments([]);
  setInterimTranslation("");
}, []);
```

#### Step 3: `page.tsx` の翻訳ロジック書き換え

**削除**:
- `lastTranslatedLengthRef`, `accumulatedTranslationRef` (Issue #110 の Ref)
- 既存の翻訳 useEffect (L234-299) 全体

**追加**:
```typescript
// セグメント差分翻訳: 新規セグメントのみ即時翻訳
const prevSegmentCountRef = useRef(0);

useEffect(() => {
  if (!isRealtimeTranslation || !showRecordingUI) return;
  const newSegments = segments.slice(prevSegmentCountRef.current);
  prevSegmentCountRef.current = segments.length;
  for (const seg of newSegments) {
    translateSegment(seg, sourceLanguage, targetLanguage);
  }
}, [segments, sourceLanguage, targetLanguage, isRealtimeTranslation, showRecordingUI, translateSegment]);

// Interim 翻訳 (300ms debounce)
useEffect(() => {
  if (!interimTranscript || !isRealtimeTranslation || !showRecordingUI) return;
  const timeout = setTimeout(() => {
    translateInterim(interimTranscript, sourceLanguage, targetLanguage);
  }, 300);
  return () => clearTimeout(timeout);
}, [interimTranscript, sourceLanguage, targetLanguage, isRealtimeTranslation, showRecordingUI, translateInterim]);
```

**translatedText の派生**:
```typescript
// translatedFullText + interimTranslation を結合して表示
const displayTranslation = useMemo(() => {
  const base = translatedFullText;
  return interimTranslation
    ? (base ? base + " " + interimTranslation : interimTranslation)
    : base;
}, [translatedFullText, interimTranslation]);
```

### Phase 2: 表示・保存の改善（P1 — 設計改善）

#### Step 4: 翻訳タブ表示の更新

- `translatedText` → `displayTranslation` に差し替え
- `getRecentSentences()` は `displayTranslation` に対して引き続き動作
- 将来的にはセグメント単位表示（話者ラベル付き）に拡張可能

#### Step 5: 保存ロジックの改善

```typescript
translations: translatedSegments.length > 0 ? {
  [targetLanguage]: {
    languageCode: targetLanguage,
    segments: translatedSegments.map(ts => ({
      originalSegmentId: ts.segmentId,
      text: ts.translatedText,
    })),
    fullText: translatedFullText,
  },
} : undefined,
```

#### Step 6: 録音停止時フォールバック

```typescript
useEffect(() => {
  if (!showRecordingUI && transcript && translatedSegments.length < segments.length) {
    // 一部未翻訳がある場合のみ全文翻訳にフォールバック
    translate(transcript, sourceLanguage, targetLanguage).then(result => {
      if (result) setTranslatedText(result); // 後方互換
    });
  }
}, [showRecordingUI]);
```

### Phase 3: 堅牢性強化（P2）

#### Step 7: 言語切替時のキャッシュクリア

```typescript
useEffect(() => {
  resetSegments();
  prevSegmentCountRef.current = 0;
  // 既存セグメントを新言語で再翻訳
  for (const seg of segments) {
    translateSegment(seg, sourceLanguage, targetLanguage);
  }
}, [targetLanguage]); // eslint-disable-line
```

#### Step 8: エラーリトライ

翻訳失敗セグメントを `translatedIdsRef` から除外し、次回の useEffect サイクルで自動リトライ。

---

## 8. テスト戦略

### 状態遷移テスト（Unit）

| テストケース | 入力 | 期待結果 |
|------------|------|---------|
| 新規セグメント追加 | segments に1件追加 | translateSegment() が1回呼ばれる |
| 同一セグメント再追加 | 同じ id のセグメント | translate() は呼ばれない（キャッシュ） |
| interim テキスト | interimTranscript 変更 | 300ms 後に translateInterim() |
| 言語切替 | targetLanguage 変更 | resetSegments() → 全セグメント再翻訳 |
| 録音停止 | showRecordingUI → false | 未翻訳がなければ再翻訳なし |
| リセット | resetSegments() | translatedSegments = [], ids クリア |

### 統合テスト

| シナリオ | 確認内容 |
|---------|---------|
| 通常録音 + RT翻訳 ON | セグメント確定ごとに翻訳が追記される |
| 長時間録音（50+ セグメント） | パフォーマンス低下なし、メモリリークなし |
| RT翻訳 OFF → ON 切替 | 未翻訳セグメントがまとめて翻訳される |
| ネットワークエラー時 | 失敗セグメントのみリトライ、他は表示 |
| 話者識別 ON | 翻訳セグメントに speaker 情報が保持される |
| 保存 | Recording.translations.segments に正しくマッピング |

### 手動テスト

| テストケース | 確認内容 |
|------------|---------|
| 日本語→英語 5分間録音 | 各セグメントがリアルタイムで翻訳表示 |
| 日本語→中国語 言語切替 | 全セグメントが新言語で再翻訳 |
| RT翻訳トグル OFF/ON | 状態の整合性確認 |
| 録音停止後にコピー | 翻訳全文が正しくクリップボードにコピー |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | `TranslatedSegment` 型追加 (`types/index.ts`) | 10min | 型定義のみ |
| 2 | `useTranslation` に `translateSegment` 等を追加 | 45min | hooks 内部 |
| 3 | `page.tsx` 翻訳 useEffect をセグメント方式に書き換え | 45min | メインページ |
| 4 | `page.tsx` 翻訳タブ表示を `displayTranslation` に差し替え | 20min | 表示層 |
| 5 | 保存ロジックをセグメント対応に変更 | 15min | API連携 |
| 6 | 録音停止時フォールバック | 15min | エッジケース |
| 7 | 言語切替時のキャッシュクリア＋再翻訳 | 15min | ユーザー操作 |
| 8 | Issue #110 の Ref 群を削除（クリーンアップ） | 10min | コード削減 |
| 9 | ビルド・テスト・動作確認 | 30min | 全体 |
| **合計** | | **約 3.5 時間** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| セグメント単位だと翻訳文脈が不足 | 中 | 中 | 各セグメントは通常1文程度なので Translator API の品質は維持される。必要なら前セグメントをコンテキストとして付与 |
| API 呼び出し回数の増加 | 低 | 低 | セグメント確定間隔は3-5秒。F0 は10リクエスト/秒なので十分余裕 |
| セグメント順序の不整合 | 低 | 中 | segmentId ベースで順序管理。非同期翻訳が完了順に到着しても、配列には追加順に格納 |
| translatedText を直接参照する既存コードの見落とし | 中 | 高 | `displayTranslation` を導入し、既存参照を漏れなく差し替え。grep で全参照を確認 |
| 言語切替時の再翻訳でレート制限 | 低 | 中 | 50セグメント一気に送信 → 並列制限 (Promise.all with concurrency 3) |

---

## 11. 結論

### 最大の問題点

1. **BUG-1/BUG-2**: Issue #110 の文字列スライスベースの差分翻訳は、セグメント境界を無視し翻訳品質を損なう設計。早期にセグメント単位管理への移行が必要。
2. **DESIGN-1**: 翻訳結果が単一文字列で管理されており、話者付き翻訳表示・セグメント対応保存ができない。

### 推奨する修正順序

1. **Step 1-3** (型 + フック + page.tsx ロジック): コア機能の実装
2. **Step 4-5** (表示 + 保存): UI と永続化の改善
3. **Step 6-8** (フォールバック + 言語切替 + クリーンアップ): 堅牢性

### 他 Issue への影響

- **Issue #35 (Speech Translation SDK)**: #33 で作った `TranslatedSegment` 型と `translatedSegments` 管理は #35 でそのまま活用。`TranslationRecognizer` が返す翻訳をセグメントとして格納する。
- **Issue #110 (差分翻訳)**: #33 完了後、#110 の Ref ベースロジックは完全に不要になる。

### 判定: **GO** ✅

- 既存の実装計画書が詳細で、実装方針は明確
- 依存 Issue (#34) は完了済み
- リスクは管理可能
- #35 への布石として重要な基盤作業

---

**レビュー実施日**: 2026-02-15
**レビュアー**: ReviewAAgent (Staff+ Engineer / Senior PM / Solution Architect)
