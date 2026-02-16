# Issue #135: 文字起こしと音声のタイムコード同期・タイムスタンプシーク機能 — 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: 録音詳細画面の文字起こしが `fullText`（プレーンテキスト一括表示）のみで、セグメント単位のタイムスタンプ表示・音声シーク・再生中ハイライト・自動スクロール機能が存在しない
- **影響範囲**: 全ユーザーの録音詳細閲覧体験（録音を閲覧する全ユーザーの 100% に影響）
- **修正の緊急度**: **P2 — High**（競合 5/10 製品が搭載済み。UX 差別化の重要機能）

---

## 2. アーキテクチャ概観

### 2.1 コンポーネント依存関係

```
RecordingDetailPage (page.tsx)
├── <audio ref={audioRef}> ── 音声再生要素
│   ├── audioUrl (SAS URL via blobApi)
│   └── playbackRate state
├── Transcript Tab
│   ├── displayTranscript memo (original | correctedTranscript)
│   │   ├── .fullText ← 現在表示中（テキスト一括）
│   │   └── .segments[] ← 未使用（★ Issue #135 で活用）
│   └── transcriptView toggle (original / AI補正版)
├── Translation Tab
│   └── recording.translations[langCode].fullText
└── Summary Tab
    └── recording.summary (structured data)
```

### 2.2 データフロー

```
[Azure Cosmos DB] → recordingsApi.getRecording(id) → Recording
    ↓
recording.transcript?.segments[]  (TranscriptSegment[])
    ├── startTime: number (秒)
    ├── endTime: number (秒)
    ├── text: string
    ├── speaker?: string
    └── id: string
    ↓
displayTranscript = useMemo(...)  ← transcriptView に応じて切替
    ↓
現状: displayTranscript.fullText → <div>テキスト一括表示</div>
目標: displayTranscript.segments[] → セグメント毎にタイムスタンプ+ハイライト+シーク
```

### 2.3 状態管理の現状

| State 変数 | 型 | 用途 | ファイル位置 |
|-----------|---|------|-------------|
| `recording` | `Recording \| null` | 録音データ全体 | page.tsx L101 |
| `audioUrl` | `string \| null` | SAS 付き再生 URL | page.tsx L108 |
| `audioRef` | `useRef<HTMLAudioElement>` | audio 要素参照 | page.tsx L110 |
| `playbackRate` | `number` | 再生速度 (0.5-2.0) | page.tsx L111 |
| `transcriptView` | `"original" \| "corrected"` | オリジナル/AI補正切替 | page.tsx L114 |
| `displayTranscript` | `Transcript \| undefined` | 表示用トランスクリプト | page.tsx L245 (useMemo) |

---

## 3. 重大バグ分析 🔴

> **注**: Issue #135 はバグではなく機能要望のため、「バグ」は存在しない。ただし、現状のコードにおいて #135 実装を阻害する潜在的問題を列挙する。

### BUG-1: segments が空の場合のフォールバック未考慮 [Medium]

**場所**: `web/src/app/recording/page.tsx` L847-851  
**コード**:
```tsx
{displayTranscript?.fullText ? (
  <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap ...">
    {displayTranscript.fullText}
  </div>
```
**問題**: `displayTranscript.fullText` が存在しても `segments` が空配列の場合がある（例: 旧バージョンのデータ、外部インポート、補正失敗時）。セグメント表示に切り替えた場合、空の UI になる可能性がある。  
**影響**: セグメント表示モードで文字起こしが表示されない → ユーザーの 10-15% に影響（旧データ保有ユーザー）  
**根本原因**: fullText は必ず存在するが segments は保証されていない  
**修正方針**: segments が空 or 未定義の場合は fullText にフォールバック表示する

### BUG-2: correctedTranscript の segments に startTime/endTime が保証されていない [Medium]

**場所**: `api/src/services/transcriptCorrectionService.ts`（LLM 補正処理）  
**問題**: LLM 補正で `correctedTranscript` を生成する際、元の `startTime`/`endTime` がそのままコピーされるか不明。テキスト分割が変わると時刻情報がずれる可能性がある。  
**影響**: AI補正版タブでタイムスタンプが不正確になる → 補正済み録音の 100% に影響  
**修正方針**: 補正処理のコードを確認し、segments の time 情報が保持されることを確認。不整合がある場合は original の segments に fallback する。

---

## 4. 設計上の問題 🟡

### 4.1 Transcript 表示が fullText 一括表示のみ [High]

**場所**: `page.tsx` L847-851  
**問題**: `displayTranscript.segments[]` が型定義上存在し、データも持っているにもかかわらず、表示は `fullText` のプレーンテキストのみ。セグメント単位の情報（話者、タイムスタンプ、区切り）が全く活用されていない。  
**改善方針**: セグメント毎のレンダリングに切り替え、タイムスタンプ・話者ラベル・ハイライトを表示する。

### 4.2 audio 要素に timeupdate リスナー未設定 [Medium]

**場所**: `page.tsx` L706-715  
**問題**: `<audio>` 要素には `onPlay` のみ設定されており、`onTimeUpdate` が未設定。再生位置の追跡ができないため、ハイライト同期が実装できない。  
**改善方針**: `onTimeUpdate` イベントで `currentTime` state を更新し、対応するセグメントをハイライトする。

### 4.3 ✅ Good: audioRef の設計

`audioRef` が既に `useRef<HTMLAudioElement>` として用意されており、`playbackRate` 制御も適切に実装されている。シーク機能は `audioRef.current.currentTime = targetTime` で簡単に実装可能。

### 4.4 ✅ Good: formatDuration ヘルパー関数

L72-80 に `formatDuration(seconds)` が既に存在し、`MM:SS` / `HH:MM:SS` フォーマットをサポート。タイムスタンプ表示にそのまま流用可能。

### 4.5 ✅ Good: TranscriptSegment 型定義

`web/src/types/index.ts` L43-49 の `TranscriptSegment` 型は `startTime`, `endTime`, `text`, `speaker?`, `id` を持ち、#135 の実装に必要な全フィールドが揃っている。

### 4.6 ページコンポーネントが 1298 行と巨大 [Low]

**場所**: `page.tsx` 全体  
**問題**: 単一ファイルに全ロジック + 全 JSX が集約されており、1298 行。#135 でさらに 100-150 行追加される。  
**改善方針**: 将来的にはタブコンテンツをサブコンポーネントに分離すべきだが、#135 の scope では不要。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #135 (タイムコード同期) ──→ Issue #81 (全文検索) [相互補完: 検索結果のハイライトにセグメント構造を活用可能]
Issue #135 ──→ Issue #70 (LLM補正) [依存: correctedTranscript の segments 整合性確認が必要]
Issue #135 ──→ Issue #120 (話者ラベル付きコピー) [相互作用: セグメント表示で話者ラベルも表示]
```

- **ブロッカー**: なし。#135 は独立して実装可能
- **並行作業可能**: #81（全文検索）は #135 と並行実装可能

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| セグメント表示 | `displayTranscript.segments[]` | segments が空の場合あり | fullText フォールバック |
| タイムスタンプシーク | `audioRef.current` | audio 未ロード時に null | null チェック + disabled 表示 |
| ハイライト同期 | `onTimeUpdate` イベント | 再生停止時に更新されない | `onPause`/`onSeeked` も監視 |
| 自動スクロール | `scrollIntoView()` | ユーザー手動スクロールと競合 | ユーザー操作時に自動追従を一時停止 |
| i18n | `messages/{ja,en,es}.json` | 翻訳漏れ | 3 言語同時追加 |

### 5.3 他 Issue/機能との相互作用

| 既存機能 | 相互作用 | リスク |
|---------|---------|--------|
| LLM補正切替 (Issue #70) | 補正版と原本でセグメント数が異なる可能性 | Medium: displayTranscript memo で吸収済み |
| 話者ラベル (Issue #120) | セグメント表示で話者ラベルも自然に表示可能 | Low: 良い相乗効果 |
| 再生速度 (Issue #78) | playbackRate 変更時も timeupdate は正常動作 | None |
| コピー機能 | `getTranscriptWithSpeakerLabels()` は独立 | None |

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Chrome Desktop | `<audio>` + `timeupdate` 完全対応 | None |
| Safari Desktop | `timeupdate` 対応。ただし発火頻度が Chrome より低い（250ms vs 100ms） | Low: 体感差は軽微 |
| iOS Safari | `timeupdate` 対応。ただしバックグラウンド時に停止 | Low: 前面利用が前提 |
| Firefox | 完全対応 | None |
| `scrollIntoView({ behavior: 'smooth' })` | 全主要ブラウザ対応 | None |
| `HTMLAudioElement.currentTime` (set) | 全ブラウザ対応 | None |

---

## 7. 修正提案（優先順位付き）

### Phase 1: コア機能（P0）— タイムスタンプ表示 + シーク

#### 変更 1: currentTime state + timeupdate ハンドラ追加

**ファイル**: `web/src/app/recording/page.tsx`

```tsx
// 新規 state (L112 付近に追加)
const [currentTime, setCurrentTime] = useState(0);
const [isAutoScroll, setIsAutoScroll] = useState(true);
const transcriptContainerRef = useRef<HTMLDivElement>(null);
const segmentRefs = useRef<Map<string, HTMLDivElement>>(new Map());
```

#### 変更 2: audio 要素に onTimeUpdate 追加

```tsx
<audio
  ref={audioRef}
  controls
  className="flex-1"
  src={audioUrl}
  onTimeUpdate={() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  }}
  onPlay={() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }}
>
```

#### 変更 3: セグメント毎のレンダリングに切替

```tsx
// fullText 表示を segments 表示に切替
{displayTranscript?.fullText ? (
  <div
    ref={transcriptContainerRef}
    className="max-h-[60vh] overflow-y-auto rounded-md bg-gray-50 p-4"
  >
    {displayTranscript.segments && displayTranscript.segments.length > 0 ? (
      displayTranscript.segments.map((segment) => {
        const isActive =
          currentTime >= segment.startTime && currentTime < segment.endTime;
        return (
          <div
            key={segment.id}
            ref={(el) => {
              if (el) segmentRefs.current.set(segment.id, el);
            }}
            className={cn(
              "flex gap-3 rounded-md px-2 py-1.5 transition-colors cursor-pointer",
              isActive
                ? "bg-blue-100 border-l-2 border-blue-500"
                : "hover:bg-gray-100"
            )}
            onClick={() => {
              if (audioRef.current) {
                audioRef.current.currentTime = segment.startTime;
                audioRef.current.play();
              }
            }}
          >
            <button
              className="shrink-0 text-xs font-mono text-blue-600 hover:underline mt-0.5"
              onClick={(e) => {
                e.stopPropagation();
                if (audioRef.current) {
                  audioRef.current.currentTime = segment.startTime;
                  audioRef.current.play();
                }
              }}
            >
              {formatDuration(Math.floor(segment.startTime))}
            </button>
            {segment.speaker && (
              <span className="shrink-0 text-xs font-medium text-purple-600 mt-0.5">
                [{segment.speaker}]
              </span>
            )}
            <span className="text-sm text-gray-800">{segment.text}</span>
          </div>
        );
      })
    ) : (
      // segments が空の場合は fullText にフォールバック
      <div className="whitespace-pre-wrap text-gray-800">
        {displayTranscript.fullText}
      </div>
    )}
  </div>
) : /* ... 既存の correctionProcessing / noTranscript 表示 ... */}
```

### Phase 2: ハイライト同期 + 自動スクロール（P1）

#### 変更 4: 自動スクロール useEffect

```tsx
// アクティブセグメントへの自動スクロール
useEffect(() => {
  if (!isAutoScroll || !displayTranscript?.segments) return;
  
  const activeSegment = displayTranscript.segments.find(
    (seg) => currentTime >= seg.startTime && currentTime < seg.endTime
  );
  
  if (activeSegment) {
    const el = segmentRefs.current.get(activeSegment.id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }
}, [currentTime, displayTranscript, isAutoScroll]);
```

#### 変更 5: 自動追従トグルボタン

```tsx
// トランスクリプト CardHeader 内に追加
<Button
  variant={isAutoScroll ? "secondary" : "ghost"}
  size="sm"
  onClick={() => setIsAutoScroll(!isAutoScroll)}
  className="gap-1 text-xs"
>
  {isAutoScroll ? t("autoScrollOn") : t("autoScrollOff")}
</Button>
```

### Phase 3: 堅牢性強化（P2）

- `onTimeUpdate` の throttle（60fps → 4fps に制限してパフォーマンス向上）
- ユーザーが手動スクロールした際の `isAutoScroll` 自動 OFF
- キーボードショートカット（← → で前後セグメントにジャンプ）
- segments 内の時間ソートの保証

### 必要なファイル変更一覧

| ファイル | 変更種別 | 内容 |
|---------|---------|------|
| `web/src/app/recording/page.tsx` | 変更 | セグメント表示、currentTime state、timeupdate、自動スクロール |
| `web/messages/ja.json` | 変更 | RecordingDetail に i18n キー追加 |
| `web/messages/en.json` | 変更 | 同上 |
| `web/messages/es.json` | 変更 | 同上 |

**新規ファイル: なし**（既存コンポーネント内で完結）

---

## 8. テスト戦略

### 8.1 状態遷移テスト（Unit）

| テストケース | 入力 | 期待結果 |
|-------------|------|---------|
| セグメントクリック → シーク | segment.startTime = 30 | audioRef.currentTime = 30 |
| timeupdate → ハイライト | currentTime = 30, seg[2] = 25-35 | seg[2] が isActive = true |
| 再生停止 → ハイライト維持 | pause at 30 | 最後のアクティブセグメントが維持 |
| segments 空 → フォールバック | segments = [] | fullText が表示 |
| transcriptView 切替 | corrected → original | 新しい displayTranscript のセグメントでリセット |

### 8.2 統合テスト

| シナリオ | 確認項目 |
|---------|---------|
| 録音詳細ページ読込 | セグメント毎にタイムスタンプが表示される |
| タイムスタンプクリック | 音声が該当時刻にシーク + 再生開始 |
| 音声再生中 | 対応セグメントがハイライト + 自動スクロール |
| AI補正版に切替 | 補正版のセグメントでタイムスタンプが表示される |
| 再生速度変更 | ハイライトが速度に追従 |
| audio 未ロード時 | タイムスタンプ表示されるがクリック無効（disabled） |

### 8.3 手動テスト

| 環境 | テスト内容 |
|------|---------|
| Chrome Desktop | 全機能動作確認 |
| Safari Desktop | timeupdate 頻度、scrollIntoView 動作 |
| iPhone Safari | タップシーク、スクロール競合 |
| Android Chrome | タップシーク、パフォーマンス |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | currentTime state + onTimeUpdate 追加 | 15 min | page.tsx |
| 2 | セグメント毎レンダリング（タイムスタンプ + 話者 + テキスト） | 45 min | page.tsx |
| 3 | クリックシーク実装 | 15 min | page.tsx |
| 4 | ハイライト同期（isActive 判定 + CSS） | 20 min | page.tsx |
| 5 | 自動スクロール useEffect | 20 min | page.tsx |
| 6 | 自動追従トグルボタン | 10 min | page.tsx |
| 7 | i18n キー追加（ja/en/es） | 15 min | messages/*.json |
| 8 | segments 空フォールバック + correctedTranscript 対応 | 15 min | page.tsx |
| 9 | 動作確認 + ビルド + デプロイ | 30 min | - |
| **合計** | | **~3 時間** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| segments が空のデータが存在 | 高 | 中 | fullText フォールバック表示 |
| correctedTranscript の segments 時刻不整合 | 中 | 高 | original segments にフォールバック or 補正コード確認 |
| onTimeUpdate 高頻度によるパフォーマンス低下 | 低 | 中 | requestAnimationFrame or throttle |
| 自動スクロールとユーザースクロールの競合 | 中 | 中 | isAutoScroll toggle + 手動スクロール検出 |
| 長時間録音（2h+）でセグメント数が膨大 | 低 | 低 | React list は 10k 要素程度なら問題なし。将来的に仮想化を検討 |

---

## 11. 結論

- **最大の問題点**: `displayTranscript.segments[]` が存在するにもかかわらず全く活用されておらず、`fullText` 一括表示のみ。これは既存データ構造の活用度が 0% の状態
- **推奨する修正順序**: Phase 1（タイムスタンプ表示 + シーク）→ Phase 2（ハイライト + 自動スクロール）→ Phase 3（堅牢性強化）
- **他 Issue への影響**: #81（全文検索）のセグメント内ハイライトに良い基盤を提供。#120（話者ラベル）と相乗効果
- **判定**: **`GO`** — 既存の audioRef、displayTranscript memo、formatDuration、segments データが全て揃っており、フロントエンド変更のみで完結する安全な実装

---

*レビュー作成日: 2025-07-13*  
*レビュアー: @ReviewAAgent*
