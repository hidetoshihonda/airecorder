# Issue #105: リアルタイム翻訳の表示が長文化しスクロールが必要になる — 深掘り分析レポート

**Issue**: [#105](https://github.com/hidetoshihonda/airecorder/issues/105) [P1] リアルタイム翻訳の表示が長文化しスクロールが必要になる  
**分析日**: 2026-02-14  
**分析者**: ReviewAAgent  
**対象ブランチ**: `main`  

---

## 1. エグゼクティブサマリー

- **問題の本質**: 翻訳タブにオートスクロール＋表示制限が部分的に実装済みだが、**翻訳テキストが単一文字列として蓄積・全文表示される設計** のため、長時間録音で翻訳テキストが際限なく伸び続け、ユーザーが最新翻訳を追跡しにくい。
- **影響範囲**: リアルタイム翻訳を使用する **全ユーザーの100%** に影響。10分以上の録音で顕著化し、30分以上の会議では UX が著しく低下。
- **修正の緊急度**: **High (P1)** — Issue #4 で基盤実装済みだが、「表示制限」と「UX改善」が未実装。

---

## 2. アーキテクチャ概観

### 2.1 コンポーネント依存関係

```
page.tsx (HomePage)
├── useRecordingStateMachine()          → FSM 状態管理
├── useSpeechRecognition()              → transcript, segments, interimTranscript
│   └── Azure Speech SDK
├── useTranslation()                    → translate() 関数
│   └── Azure Translator REST API
├── 差分翻訳ロジック (page.tsx内)       → translatedText (useState)
│   ├── lastTranslatedLengthRef         → 最後に翻訳した transcript の長さ
│   ├── accumulatedTranslationRef       → 蓄積翻訳テキスト
│   └── 500ms debounce                  → 翻訳タイミング制御
└── UI Components
    ├── TranscriptView                  → 文字起こしタブ（segments ベース、自動追従付き ✅）
    └── 翻訳タブ                        → translatedText を直接表示（★問題箇所）
        ├── translationScrollRef        → スクロールコンテナ ref
        ├── translationAutoFollow       → 自動追従 state
        └── handleTranslationScroll     → 手動スクロール検知
```

### 2.2 データフロー（翻訳）

```
マイク入力
  ↓
Azure Speech SDK
  ↓ segments[] 確定 → transcript（全文結合string）
  ↓
page.tsx useEffect (L217-283)
  ├─ [録音停止時] transcript 全文 → translate() → setTranslatedText(全文翻訳)
  └─ [録音中] 差分翻訳ロジック (Issue #110)
       ├─ newConfirmedText = transcript.slice(lastTranslatedLengthRef)
       ├─ deltaText → translate() → accumulatedTranslationRef に追記
       └─ setTranslatedText(accumulated + interimPart)  ← ★単一文字列として蓄積
                ↓
翻訳タブ表示 (L955-1008)
  ├─ <div ref={translationScrollRef}>  ← flex-1 overflow-y-auto ✅
  │    └─ <div className="bg-blue-50 p-4">{translatedText}</div>  ← ★全文が1つのdivに展開
  └─ autoFollow ボタン ✅ (showRecordingUI 時のみ表示)
```

### 2.3 状態管理の構造

| State 変数 | 管理場所 | 型 | 用途 |
|---|---|---|---|
| `translatedText` | page.tsx (useState) | `string` | 翻訳結果全文（累積追記） |
| `translationAutoFollow` | page.tsx (useState) | `boolean` | 翻訳タブの自動追従 |
| `translationScrollRef` | page.tsx (useRef) | `RefObject<HTMLDivElement>` | スクロールコンテナ参照 |
| `lastTranslatedLengthRef` | page.tsx (useRef) | `number` | 最後に翻訳した transcript の位置 |
| `accumulatedTranslationRef` | page.tsx (useRef) | `string` | 蓄積された翻訳テキスト |
| `isRealtimeTranslation` | page.tsx (useState) | `boolean` | リアルタイム翻訳の有効/無効 |

**✅ Good**: 
- Issue #4 で翻訳タブにもオートスクロール＋追従トグルが実装されている
- Issue #110 で差分翻訳（新規テキストのみ翻訳）が実装されている
- TranscriptView コンポーネントは segments ベースで表示制限が容易な設計

---

## 3. 重大バグ分析 🔴

### BUG-1: 翻訳テキストが単一文字列として全文表示される [High]

**場所**: `web/src/app/page.tsx` L972-974

**コード**:
```tsx
<div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-gray-800">
  {translatedText}
</div>
```

**問題**: 
- `translatedText` は `accumulatedTranslationRef.current + interimPart` を `trim()` した単一文字列
- 30分の会議で数千文字のテキストが1つの `<div>` にレンダリングされ続ける
- Issue の要件「画面には最新の4〜5文のみを表示」が未実装
- スクロールコンテナ（`translationScrollRef`）内に翻訳文 + 原文の**両方**が配置されており、スクロール量が倍増する

**影響**: リアルタイム翻訳使用時、10分以上の録音で翻訳テキストが画面外に溢れ、手動スクロールが頻繁に必要になる。

**根本原因**: `translatedText` が `string` 型の単一変数で管理されており、セグメント単位の表示制限ができない構造。

**修正方針**:
1. **即時対応（Phase 1）**: 翻訳表示を最新N文に制限するユーティリティ関数を追加
2. **本格対応（Phase 2）**: Issue #33 のセグメント単位翻訳を実装し、翻訳もセグメント配列で管理

---

### BUG-2: 翻訳タブのスクロールコンテナに翻訳文＋原文が混在 [High]

**場所**: `web/src/app/page.tsx` L950-1007

**コード**:
```tsx
<div
  ref={translationScrollRef}
  onScroll={handleTranslationScroll}
  className="min-h-0 flex-1 overflow-y-auto space-y-4"
>
  {/* 翻訳テキスト（青背景） */}
  <div>
    <div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-gray-800">
      {translatedText}
    </div>
  </div>
  {/* 原文テキスト（灰色背景） */}
  <div>
    {enableSpeakerDiarization ? (
      <TranscriptView segments={labeledSegments} ... />
    ) : (
      <div className="whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
        {transcript}
      </div>
    )}
  </div>
</div>
```

**問題**:
- 翻訳テキストと原文テキストが**同一スクロールコンテナ**内に縦に配置
- 両方が全文表示されるため、スクロール領域が翻訳文の**約2倍**の高さになる
- オートスクロールが `scrollHeight` に追従するため、原文エリアの最下部（＝スクロールコンテナの最下部）にジャンプする→翻訳テキストの最新部分が見えなくなる可能性

**影響**: 翻訳タブのオートスクロールが、翻訳テキストではなく原文テキストの末尾に追従してしまう。

**根本原因**: 翻訳と原文を1つの `overflow-y-auto` コンテナで管理している設計。

**修正方針**:
- 翻訳テキストと原文テキストを**分離**して表示する
- 方法A: 原文セクションをデフォルト折りたたみ（Accordion）にする
- 方法B: 翻訳のみのスクロールコンテナ + 原文は別のスクロールコンテナ
- **推奨**: 方法A（UIシンプル化）+ 翻訳テキストの最新N文表示

---

### BUG-3: 録音停止後にオートスクロールボタンが非表示 [Medium]

**場所**: `web/src/app/page.tsx` L1009

**コード**:
```tsx
{showRecordingUI && !translationAutoFollow && (
  <div className="flex justify-center mt-2">
    <button onClick={() => setTranslationAutoFollow(true)} ...>
```

**問題**: 
- `showRecordingUI && !translationAutoFollow` の条件により、録音停止後はボタンが表示されない
- 録音停止後に全文翻訳が実行され長文テキストが生成されるが、追従ボタンなし

**影響**: 録音停止後、翻訳テキストが長い場合に手動スクロールのみとなる（ただし録音停止後は新規テキストは追加されないため影響は限定的）。

**修正方針**: 停止後も翻訳テキストが長い場合は「先頭に戻る」ボタンを表示する（優先度は低い）。

---

## 4. 設計上の問題 🟡

### DESIGN-1: translatedText が単一 string で管理されている [High]

**場所**: `web/src/app/page.tsx` L59, L237, L270

```tsx
const [translatedText, setTranslatedText] = useState("");
// ...
setTranslatedText(result);  // 全文翻訳結果
// ...
setTranslatedText(
  (accumulatedTranslationRef.current + interimPart).trim()
);  // 差分翻訳の蓄積結果
```

**問題**:
- 文字起こしは `segments: LiveSegment[]` 配列で管理されており、`TranscriptView` で段落ごとの表示が可能
- しかし翻訳は `translatedText: string` の単一文字列で管理されている
- この非対称性により、翻訳タブでは「最新N文表示」「セグメント単位の話者ラベル表示」が困難

**改善案**: Issue #33 のセグメント単位差分翻訳を実装し、`translatedSegments: TranslatedSegment[]` 配列で管理する。翻訳タブでも `TranscriptView` を再利用可能にする。

---

### DESIGN-2: 差分翻訳ロジックが page.tsx に直接記述されている [Medium]

**場所**: `web/src/app/page.tsx` L217-283

**問題**:
- 差分翻訳のロジック（`lastTranslatedLengthRef`, `accumulatedTranslationRef`, deltaText 計算等）が page.tsx の useEffect 内に直接記述
- page.tsx は既に 1447 行あり、単一責任原則に違反
- `useTranslation` フックの責務として管理すべき

**改善案**: `useTranslation` フックを拡張し、差分翻訳ロジックをフック内に移動。

---

### DESIGN-3: 差分翻訳で2回の API 呼び出しが発生する場合がある [Medium]

**場所**: `web/src/app/page.tsx` L256-268

```tsx
const result = await translate(deltaText, sourceLanguage, targetLanguage);
if (result) {
  if (newConfirmedText.trim()) {
    const confirmedResult = interimTranscript
      ? await translate(newConfirmedText, sourceLanguage, targetLanguage)  // ← 2回目の API 呼び出し
      : result;
```

**問題**:
- `interimTranscript` がある場合、deltaText (confirmed + interim) と newConfirmedText の**2回** translate() が呼ばれる
- API コスト・レート制限の観点で非効率
- Issue #33 のセグメント単位翻訳で根本解決される

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #105 (翻訳長文化) ←── Issue #4 (自動追従) [基盤実装済み ✅]
  └─ 理由: オートスクロール基盤は Issue #4 で実装済み

Issue #105 (翻訳長文化) ──→ Issue #33 (セグメント差分翻訳) [本格解決に必要]
  └─ 理由: 翻訳をセグメント単位で管理すれば、最新N文表示が容易に実現
  └─ 対策: Phase 1 で暫定対応（string ベースの表示制限）、Phase 2 で Issue #33 と統合

Issue #105 (翻訳長文化) ⊥ Issue #34 (フレーズリスト) [独立]
Issue #105 (翻訳長文化) ⊥ Issue #35 (Speech Translation SDK) [独立]
Issue #105 (翻訳長文化) ⊥ Issue #104 (再生速度表示) [独立]
```

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---|---|---|---|
| 翻訳テキスト表示制限 | `translatedText` の文字列フォーマット | Low | 文区切りユーティリティで対応可 |
| 原文セクション折りたたみ | Radix Accordion or Details/Summary | Low | HTML details 要素で簡易実装可 |
| セグメント単位翻訳表示 | `TranslatedSegment[]` 型 + TranscriptView | Medium | Issue #33 と同時実装が効率的 |
| 翻訳自動追従 | `translationScrollRef` | None | 既存実装を維持 |

### 5.3 他 Issue/機能との相互作用

- **Issue #33 (セグメント差分翻訳)**: 本 Issue の根本解決策。翻訳をセグメント配列で管理すれば、TranscriptView の `fillHeight` + 自動追従がそのまま使える。**強い正の相互作用**。
- **Issue #110 (リアルタイム翻訳エラー)**: 差分翻訳ロジックが既に部分実装されている。Issue #33 実装時にリファクタリングされるため**干渉なし**。

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|---|---|---|
| Chrome (Desktop) | `overflow-y: auto`, `scrollTop`, `requestAnimationFrame` 完全対応 | None |
| Safari (Desktop) | 同上 | None |
| Firefox | 同上 | None |
| Safari (iOS) | `<details>` 要素は iOS 12+ で対応 | None |
| Chrome (Android) | 同上 | None |

使用する Web API は全モダンブラウザで完全対応。**リスクなし**。

---

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0）— 翻訳表示の即時改善

#### 7.1 翻訳テキストの最新N文表示ユーティリティ

**新規**: 表示用に末尾の文を切り出すユーティリティ関数

```tsx
/**
 * テキストを文区切りで分割し、最新の N 文のみ返す。
 * 全文は別途保持し、ここでは表示用の切り出しのみ行う。
 */
function getRecentSentences(text: string, count: number = 5): string {
  if (!text) return "";
  // 日本語句点、英語ピリオド、!?で区切り
  const sentences = text.split(/(?<=[。.!?！？])\s*/g).filter(Boolean);
  if (sentences.length <= count) return text;
  return "…" + sentences.slice(-count).join(" ");
}
```

#### 7.2 翻訳タブの表示改善

**場所**: `web/src/app/page.tsx` L950-1007

**変更内容**:
1. 録音中は `getRecentSentences(translatedText, 5)` で最新5文のみ表示
2. 原文セクションをデフォルト折りたたみ（`<details>`）にする
3. 録音停止後は全文表示（スクロール可能）

```tsx
{/* 翻訳テキスト表示 */}
<div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-gray-800">
  {showRecordingUI ? getRecentSentences(translatedText, 5) : translatedText}
</div>

{/* 原文セクション: 折りたたみ */}
<details className="mt-4">
  <summary className="text-sm text-gray-500 cursor-pointer hover:text-gray-700">
    {t("sourceLabel", { language: ... })} ▼
  </summary>
  <div className="mt-2">
    {/* 既存の原文表示 */}
  </div>
</details>
```

#### 7.3 変更ファイル一覧

| ファイル | 変更内容 | 変更規模 |
|---|---|---|
| `web/src/app/page.tsx` | getRecentSentences 追加、翻訳表示を最新N文に制限、原文セクション折りたたみ | 中 |

---

### Phase 2: 設計改善（P1）— セグメント単位翻訳への移行（Issue #33 と統合）

#### 7.4 TranslatedSegment 型と useTranslation 拡張

Issue #33 の実装計画書に詳細あり。要点:
- `TranslatedSegment[]` 配列で翻訳を管理
- `translateSegment()` で新規セグメントのみ翻訳
- 翻訳タブでも `TranscriptView` コンポーネントを再利用
- オートスクロール・追従トグルは既存の TranscriptView の機能をそのまま活用

#### 7.5 翻訳タブの TranscriptView 再利用

```tsx
// translatedSegments を LiveSegment 形式に変換
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

// 翻訳タブで TranscriptView を使用
<TranscriptView
  segments={translationViewSegments}
  interimTranscript={interimTranslation}
  showSpeaker={enableSpeakerDiarization}
  isRecording={showRecordingUI}
  fillHeight
/>
```

---

### Phase 3: 堅牢性強化（P2）

#### 7.6 全文表示/最新のみ表示の切り替えオプション

Issue の要件:
> オプションとして「全文表示」と「最新のみ表示」の切り替えを提供

```tsx
const [translationDisplayMode, setTranslationDisplayMode] = 
  useState<"recent" | "full">("recent");
```

UIトグル:
```tsx
<label className="flex items-center gap-1.5 text-xs">
  <input
    type="checkbox"
    checked={translationDisplayMode === "full"}
    onChange={(e) => setTranslationDisplayMode(e.target.checked ? "full" : "recent")}
  />
  全文表示
</label>
```

#### 7.7 録音停止後の「先頭に戻る」ボタン

録音停止後、翻訳テキストが長い場合に先頭/末尾ジャンプボタンを表示。

---

## 8. テスト戦略

### 8.1 状態遷移テスト（Unit）

| テストケース | 期待結果 |
|---|---|
| 録音開始 → 翻訳タブ表示 | 最新5文のみ表示 |
| 10文以上蓄積 → 表示確認 | 先頭に「…」が表示、最新5文が見える |
| 録音停止 → 翻訳タブ確認 | 全文翻訳が表示される |
| 原文セクション折りたたみ | デフォルトで非表示、クリックで展開 |
| 「全文表示」トグル ON | 録音中でも全文が表示される |
| 自動追従ボタンクリック | スクロールが最下部に移動 |
| 手動スクロール → 上方向 | autoFollow が false に変化 |

### 8.2 統合テスト

| シナリオ | 確認事項 |
|---|---|
| 30分間の連続録音 + RT翻訳 ON | 翻訳タブで最新5文が常に見える |
| 話者識別 ON + RT翻訳 | 翻訳表示に話者情報が付与される（Phase 2） |
| RT翻訳 OFF → ON 切替 | 表示制限が正しく適用される |
| タブ切り替え | 翻訳タブに戻った際にオートスクロール状態が維持 |

### 8.3 手動テスト

| ブラウザ | テスト項目 |
|---|---|
| Chrome Desktop | 基本動作、最新N文表示、折りたたみ |
| Safari Desktop | `<details>` 要素の挙動 |
| Chrome Android | タッチスクロール、折りたたみ操作 |
| Safari iOS | タッチスクロール、`<details>` 対応 |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|---|---|---|---|
| 1 | `getRecentSentences` ユーティリティ関数追加 | 10分 | page.tsx |
| 2 | 翻訳テキスト表示を録音中は最新5文に制限 | 10分 | page.tsx L972 |
| 3 | 原文セクションを `<details>` で折りたたみ化 | 15分 | page.tsx L978-1003 |
| 4 | 動作確認・デバッグ | 15分 | — |
| 5 | (Phase 2) Issue #33 セグメント単位翻訳実装 | 3時間 | useTranslation.ts, page.tsx, types/ |
| 6 | (Phase 3) 全文/最新切り替えトグル追加 | 20分 | page.tsx |
| **Phase 1 合計** | | **約50分** | |
| **全体合計** | | **約4.5時間** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|---|---|---|---|
| 文区切り（`getRecentSentences`）が日本語/英語以外で不正確 | Medium | Low | 区切りパターンを言語別に拡張可能。保守的に5文以上表示 |
| 原文折りたたみで原文を見たいユーザーが不便に感じる | Low | Low | デフォルト折りたたみ、ワンクリックで展開可能 |
| Phase 2 の Issue #33 実装が大規模で他機能に影響 | Low | Medium | Phase 1 の暫定対応で十分な UX 改善を先行 |
| `<details>` 要素のスタイリングがブラウザ間で異なる | Low | Low | Tailwind CSS で統一的にスタイリング |
| 最新N文表示で文脈が失われ翻訳理解に支障 | Low | Medium | 全文表示モードへの切り替えを提供 |

---

## 11. 結論

### 最大の問題点

**翻訳テキストが単一文字列（`translatedText: string`）として管理・全文表示されており、長時間録音で表示が際限なく伸びる。** Issue #4 でオートスクロール基盤は実装済みだが、**表示制限**（最新N文）と**原文セクションの分離**が未実装。

### 推奨する修正順序

1. **Phase 1 (P0)**: `getRecentSentences` + 原文折りたたみ → **即時対応・工数50分**
2. **Phase 2 (P1)**: Issue #33 セグメント単位翻訳 → 翻訳も TranscriptView で表示 → **根本解決**
3. **Phase 3 (P2)**: 全文/最新切り替えトグル → UX 最適化

### 他 Issue への影響サマリー

- **Issue #33 (セグメント差分翻訳)**: Phase 2 で統合。相互に正の影響
- **Issue #4 (自動追従)**: 既存実装を活用。干渉なし
- **Issue #110 (翻訳エラー)**: 差分翻訳ロジックは Issue #33 でリファクタリング。干渉なし
- **Issue #104 (再生速度)**: 完全に独立

### 判定

## **🟢 GO**

Phase 1 は `web/src/app/page.tsx` の **1ファイルのみ** の変更で完了し、既存の自動追従基盤を壊さない。工数は約50分。ブロッカーとなる他 Issue もなく、即時着手可能。
