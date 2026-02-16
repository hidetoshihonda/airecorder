# Issue #140: 話者ラベル編集が他の録音に波及するバグ — 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: `useSpeakerManager` フックが話者ラベルを**録音IDでスコープせずグローバルな localStorage** に保存するため、録音Aで設定したラベルが録音Bに自動適用される。さらに保存時に **元のSDK speaker IDが破壊的に上書き**され、復元不可能になる。
- **影響範囲**: 話者分離(Speaker Diarization)を有効にしている全ユーザーに影響。録音を重ねるほど汚染が広がる。
- **緊急度**: 🔴 **High** — データ破壊（元speaker ID喪失）を伴うため早期修正が必要。

---

## 2. アーキテクチャ概観

### 2.1 コンポーネント依存関係

```
[Azure Speech SDK]
  │ ConversationTranscriber
  │ speakerId: "Guest-1", "Guest-2", ...
  ▼
[useSpeechRecognition.ts]
  │ segments: LiveSegment[]
  │  └ speaker: "Guest-1"
  ▼
[page.tsx (メインページ)]
  ├── useSpeakerManager()
  │     ├── speakers: Map<string, SpeakerInfo>
  │     ├── renameSpeaker(id, label) → localStorage 書込
  │     ├── updateFromSegments(segs) → localStorage 読込
  │     ├── getSpeakerLabel(id)
  │     └── resetSpeakers() → Map クリアのみ
  │
  ├── labeledSegments = segments + speakerLabel
  │
  ├── [TranscriptView] ← labeledSegments で表示
  │     └── SegmentItem: segment.speakerLabel || segment.speaker
  │
  └── [保存処理] createRecording()
        └── speaker: seg.speakerLabel || seg.speaker ← 破壊的上書き
              ▼
        [CosmosDB] Recording.transcript.segments[].speaker = "田中" (元ID消失)
              ▼
        [recording/page.tsx (詳細ページ)]
            └── segment.speaker をそのまま表示 ("田中")
```

### 2.2 データフロー

```
録音時:
  SDK → speakerId("Guest-1") → segments[] → updateFromSegments()
                                              ↓
                                    localStorage["airecorder-speaker-Guest-1"]
                                              ↓ 読込
                                    SpeakerInfo { id: "Guest-1", label: "田中" }
                                              ↓
                                    labeledSegments[].speakerLabel = "田中"

保存時:
  labeledSegments[].speakerLabel || .speaker → CosmosDB segment.speaker = "田中"
  (元の "Guest-1" は消失)

次の録音:
  SDK → speakerId("Guest-1") → updateFromSegments()
                                  ↓
                        localStorage["airecorder-speaker-Guest-1"] → "田中"
                                  ↓
                        別人なのに "田中" と表示される
```

### 2.3 状態管理の構造

| 状態 | 管理場所 | スコープ | 問題 |
|------|---------|---------|------|
| `speakers` Map | `useSpeakerManager` (useState) | 現在のセッション | ✅ OK（セッション限定） |
| ラベル永続化 | `localStorage["airecorder-speaker-{id}"]` | **ブラウザ全体** | 🔴 録音IDスコープなし |
| 保存済みspeaker | `CosmosDB segment.speaker` | 各録音ドキュメント | 🔴 元IDが上書きされる |

---

## 3. 重大バグ分析 🔴

### BUG-1: localStorage キーが録音IDでスコープされていない

**場所**: [web/src/hooks/useSpeakerManager.ts](../web/src/hooks/useSpeakerManager.ts) L27, L43, L57

**コード**:
```ts
// L27: グローバルなプレフィックス（録音IDなし）
const STORAGE_PREFIX = "airecorder-speaker-";

// L43: 書込 — キーにrecordingIdが含まれない
localStorage.setItem(`${STORAGE_PREFIX}${id}`, label);

// L57: 読込 — 他の録音で設定したラベルを読み込んでしまう
saved = localStorage.getItem(`${STORAGE_PREFIX}${seg.speaker}`);
```

**問題**: `localStorage` のキー形式が `airecorder-speaker-Guest-1` であり、**録音IDを含まない**。全ての録音で同一の speaker ID ("Guest-1") に対して同じラベルが適用される。

**影響**: 話者分離を使う全ユーザー。録音Aで設定したラベルが録音Bの別人に自動適用される。ユーザーが混乱し、議事録の信頼性が損なわれる。

**根本原因**: `useSpeakerManager` が「同じ speaker ID = 同じ人物」と仮定しているが、Azure Speech SDK の ConversationTranscriber は録音セッションごとに speaker ID をリセットするため、Guest-1 は常に同じ人物とは限らない。

**修正方針**: localStorage キーに録音ID（または新規録音セッションID）を含める。

**重要度**: 🔴 Critical

---

### BUG-2: 保存時に元の speaker ID が破壊的に上書きされる

**場所**: [web/src/app/page.tsx](../web/src/app/page.tsx) L674

**コード**:
```ts
// L672-674: 保存処理
segments: labeledSegments.map((seg, i) => ({
  id: seg.id,
  speaker: seg.speakerLabel || seg.speaker,  // "Guest-1" → "田中" に上書き
  text: seg.text,
  startTime: seg.timestamp / 1000,
  ...
})),
```

**問題**: `speakerLabel`（ユーザー設定のラベル "田中"）が `speaker` フィールドに直接書き込まれ、元のSDK speaker ID ("Guest-1") が**永久に失われる**。

**影響**:
- 元のspeaker IDで話者をグルーピングする処理が不可能に
- 詳細ページ (recording/page.tsx) で表示される `segment.speaker` がラベルに置換されている
- AI補正 (correctedTranscript) は元のセグメント配列をそのまま使うので、speaker IDが "田中" になったセグメントがそのまま渡される
- TranscriptView の `getSpeakerColorIndex` がspeaker IDから数値を抽出してカラーを決定するが、"田中" には数値がないためハッシュフォールバックになり、カラーが変わる

**根本原因**: Recording モデルに `speakerLabels` マッピングが設計されておらず、 唯一のspeakerフィールドを2つの目的（SDK ID保持 + 表示名）に兼用している。

**修正方針**: Recording モデルに `speakerLabels: Record<string, string>` を追加し、`segment.speaker` は常にSDK由来のIDを保持する。

**重要度**: 🔴 Critical

---

### BUG-3: resetSpeakers が localStorage をクリアしない

**場所**: [web/src/hooks/useSpeakerManager.ts](../web/src/hooks/useSpeakerManager.ts) L97-99

**コード**:
```ts
const resetSpeakers = useCallback(() => {
  setSpeakers(new Map());  // in-memory のみクリア
  // ← localStorage はクリアされない！
}, []);
```

**問題**: `resetSpeakers()` は新規録音開始時 ([page.tsx L424](../web/src/app/page.tsx)) で呼ばれるが、in-memory の `speakers` Map のみクリアし、localStorage のエントリは残存する。直後に `updateFromSegments` が呼ばれると localStorage から古いラベルを再読込してしまう。

**影響**: BUG-1 と複合し、録音を開始するたびに前の録音のラベルが自動復元される。

**根本原因**: リセット処理が不完全。localStorage の管理が `renameSpeaker` と `updateFromSegments` にのみ存在し、クリーンアップが設計されていない。

**修正方針**: 録音IDスコープ化 (BUG-1修正) で解決。もしくは resetSpeakers に localStorage クリア処理を追加。

**重要度**: 🟠 High

---

## 4. 設計上の問題 🟡

### DESIGN-1: Recording モデルに speakerLabels マッピングがない

| 現状 | あるべき姿 |
|------|-----------|
| `segment.speaker = "田中"` (上書き) | `segment.speaker = "Guest-1"` (元ID保持) |
| ラベル情報なし | `recording.speakerLabels = { "Guest-1": "田中" }` |

API側の `Recording` 型 ([api/src/models/recording.ts](../api/src/models/recording.ts)) にも、Web側の `Recording` 型 ([web/src/types/index.ts](../web/src/types/index.ts)) にも `speakerLabels` フィールドが存在しない。

### DESIGN-2: 詳細ページ (recording/page.tsx) に話者ラベル編集機能がない

[recording/page.tsx L951-953](../web/src/app/recording/page.tsx) では `segment.speaker` をそのまま表示するのみ:

```tsx
{segment.speaker && (
  <span className="...">{segment.speaker}</span>
)}
```

保存済み録音のラベルを後から編集する手段がない。BUG-2で元IDが消失しているため、正しいラベルに修正することも困難。

### DESIGN-3: TranscriptView のカラー決定がspeaker IDの数値に依存

[TranscriptView.tsx L20-29](../web/src/components/TranscriptView.tsx):
```ts
function getSpeakerColorIndex(speakerId: string): number {
  const match = speakerId.match(/(\d+)/);
  if (match) return (parseInt(match[1]) - 1) % SPEAKER_COLORS.length;
  // ハッシュフォールバック
}
```

BUG-2でspeakerフィールドが "田中" のように非数値になると、ハッシュフォールバックになりカラーが変わる。保存前と保存後で色が異なるUX上の問題。

### DESIGN-4: ✅ Good — 録音開始時に resetSpeakers を呼んでいる

[page.tsx L424](../web/src/app/page.tsx) で新規録音開始時に `resetSpeakers()` を呼ぶ設計は正しい。ただし localStorage がクリアされないため効果が不完全。

---

## 5. 依存関係マトリクス 📊

### 5.1 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| `useSpeakerManager` | localStorage | グローバル汚染 | 録音IDスコープ化 |
| `page.tsx` 保存処理 | `labeledSegments` | speaker ID消失 | speakerLabels 分離 |
| `recording/page.tsx` 詳細表示 | `segment.speaker` (DB) | 汚染データの表示 | speakerLabels でマッピング表示 |
| `TranscriptView` | `segment.speaker` (カラー) | ラベル上書きで色変化 | 元ID保持で解決 |
| AI補正 (`transcriptCorrectionService`) | `transcript.segments` | 汚染speaker入り | 元ID保持で解決 |
| コピー機能 (`getTranscriptWithSpeakerLabels`) | `segment.speaker` / `speakerLabel` | ラベル二重表示リスク | speakerLabels で一元管理 |

### 5.2 他 Issue/機能との相互作用

| Issue | 相互作用 | 対策 |
|-------|---------|------|
| #135 タイムコード同期 | 詳細ページのセグメント表示で speaker を使用 | 元ID + speakerLabels で表示ロジック変更 |
| #120 AI補正版コピー | `getTranscriptWithSpeakerLabels` が speaker を参照 | 影響小（修正で自然に改善） |
| #41 話者分離設定永続化 | enableSpeakerDiarization のON/OFF | 無関係 |

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| localStorage | 全ブラウザ対応 | プライベートブラウジングで容量制限あり（既にcatchで対処済み ✅） |
| Safari ITP | localStorage 7日制限 | 長期未使用で自動クリアされる可能性（結果的にバグが緩和される） |
| 複数タブ | localStorage は同期的に共有 | 複数タブで録音すると相互汚染（エッジケース） |

---

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0） 🔴

#### 修正1: localStorage 廃止 + speakerLabels を Recording モデルに追加

**方針**: localStorage でのラベル永続化を**完全に廃止**し、各録音ドキュメント内に `speakerLabels` マッピングを保存する。

**変更ファイル一覧**:

| ファイル | 変更内容 |
|---------|---------|
| `api/src/models/recording.ts` | `Recording` に `speakerLabels?: Record<string, string>` 追加 |
| `web/src/types/index.ts` | `Recording` に `speakerLabels?: Record<string, string>` 追加 |
| `web/src/hooks/useSpeakerManager.ts` | localStorage 読み書きを完全削除。初期ラベル注入メソッド追加 |
| `web/src/app/page.tsx` L674 | 保存時: `speaker: seg.speaker`（元ID保持）、`speakerLabels` をマップとして送信 |
| `web/src/app/recording/page.tsx` | 表示時: `speakerLabels` マッピングを適用 |

**コード例**:

```ts
// api/src/models/recording.ts — Recording インターフェースに追加
export interface Recording {
  // ... 既存フィールド
  speakerLabels?: Record<string, string>; // { "Guest-1": "田中", "Guest-2": "佐藤" }
}
```

```ts
// useSpeakerManager.ts — localStorage 削除版
const STORAGE_PREFIX = "airecorder-speaker-"; // 削除

export function useSpeakerManager(): UseSpeakerManagerReturn {
  const [speakers, setSpeakers] = useState<Map<string, SpeakerInfo>>(new Map());

  const renameSpeaker = useCallback((id: string, label: string) => {
    setSpeakers((prev) => {
      const next = new Map(prev);
      const info = next.get(id);
      if (info) {
        next.set(id, { ...info, label });
      }
      return next;
    });
    // localStorage 書込を削除
  }, []);

  const updateFromSegments = useCallback((segments: LiveSegment[]) => {
    setSpeakers((prev) => {
      const next = new Map(prev);
      let changed = false;
      for (const seg of segments) {
        if (seg.speaker && !next.has(seg.speaker)) {
          // localStorage 読込を削除 — デフォルトはspeaker IDそのまま
          next.set(seg.speaker, {
            id: seg.speaker,
            label: seg.speaker,
            color: next.size,
            segmentCount: 0,
          });
          changed = true;
        }
      }
      // segmentCount 更新は現状通り
      // ...
      return changed ? next : prev;
    });
  }, []);

  // speakers Map から speakerLabels Record を生成
  const getSpeakerLabelsMap = useCallback((): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const [id, info] of speakers) {
      if (info.label !== id) {
        map[id] = info.label;
      }
    }
    return map;
  }, [speakers]);

  const resetSpeakers = useCallback(() => {
    setSpeakers(new Map());
  }, []);

  return { speakers, renameSpeaker, getSpeakerLabel, getSpeakerLabelsMap, updateFromSegments, resetSpeakers };
}
```

```ts
// page.tsx 保存処理 — 元ID保持 + speakerLabels 送信
const response = await recordingsApi.createRecording({
  title,
  sourceLanguage,
  duration,
  audioUrl,
  transcript: {
    segments: labeledSegments.map((seg, i) => ({
      id: seg.id,
      speaker: seg.speaker,  // ← 元のSDK ID を保持（speakerLabel ではなく）
      text: seg.text,
      startTime: seg.timestamp / 1000,
      endTime: i < labeledSegments.length - 1
        ? labeledSegments[i + 1].timestamp / 1000
        : duration,
    })),
    fullText: transcript,
  },
  speakerLabels: getSpeakerLabelsMap(),  // ← 新規フィールド
  // ...
});
```

#### 修正2: 既存の localStorage エントリをクリーンアップ

既にlocalStorageに保存されている古いエントリを初回起動時にクリアするワンタイム処理:

```ts
// page.tsx or useSpeakerManager.ts 初期化時
if (!localStorage.getItem("airecorder-speaker-migrated")) {
  const keysToRemove: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith("airecorder-speaker-")) {
      keysToRemove.push(key);
    }
  }
  keysToRemove.forEach(k => localStorage.removeItem(k));
  localStorage.setItem("airecorder-speaker-migrated", "1");
}
```

### Phase 2: 設計改善（P1） 🟡

#### 修正3: 詳細ページで speakerLabels を使った表示

```tsx
// recording/page.tsx — セグメント表示
{segment.speaker && (
  <span className="...">
    {recording?.speakerLabels?.[segment.speaker] || segment.speaker}
  </span>
)}
```

#### 修正4: 詳細ページに話者ラベル編集UI追加（将来）

保存済み録音でも話者名を編集できるようにする。変更は `speakerLabels` の更新APIで保存。

### Phase 3: 堅牢性強化（P2）

#### 修正5: CreateRecordingRequest / UpdateRecordingRequest に speakerLabels 追加

API側の型定義も更新し、speakerLabels の保存・更新を正式サポート。

---

## 8. テスト戦略

### 状態遷移テスト（Unit）

| テストケース | 期待結果 |
|---|---|
| 録音AでGuest-1→"田中"にリネーム → 録音B開始 | 録音Bの Guest-1 はデフォルトの "Guest-1" のまま |
| 録音保存 → DB確認 | `segment.speaker` = "Guest-1" (元ID保持), `speakerLabels` = {"Guest-1": "田中"} |
| 録音保存 → 詳細ページ表示 | "田中" と表示される（speakerLabels経由） |
| resetSpeakers() → 新しいsegment到着 | クリーンなspeaker情報（前の録音のラベルなし） |

### 手動テスト

| シナリオ | 手順 | 期待結果 |
|---------|------|---------|
| 基本フロー | 話者分離ON → 録音 → Guest-1を"田中"にリネーム → 保存 | 詳細ページで "田中" 表示、DBのspeaker="Guest-1" |
| 波及テスト | 上記後 → 新規録音開始 | Guest-1が "Guest-1" のまま（"田中" にならない） |
| 既存データ互換 | 修正前に保存した録音を詳細ページで開く | speaker="田中"(旧データ)はそのまま表示される |
| localStorage クリーンアップ | 修正版を初回起動 | airecorder-speaker-* キーが削除される |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | API/Web の Recording 型に `speakerLabels` 追加 | 10分 | 型定義のみ |
| 2 | `useSpeakerManager` から localStorage 読み書きを削除 + `getSpeakerLabelsMap` 追加 | 15分 | フック内部のみ |
| 3 | `page.tsx` 保存処理: 元ID保持 + speakerLabels 送信 | 10分 | 保存処理 |
| 4 | `recording/page.tsx` 詳細ページ: speakerLabels で表示 | 10分 | 表示処理 |
| 5 | localStorage クリーンアップ処理追加 | 5分 | 初回起動時 |
| 6 | ビルド確認 + テスト | 10分 | 全体 |
| **合計** | | **約60分** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| 既存保存データの後方互換性 | 高 | 中 | 旧データ（speaker="田中"）はspeakerLabelsがないのでそのまま表示。劣化なし |
| CreateRecordingRequest に speakerLabels がないとAPI拒否 | 低 | 高 | `speakerLabels` はオプショナル（`?`）で追加 |
| localStorage クリーンアップで他のデータを誤削除 | 低 | 中 | プレフィックス `airecorder-speaker-` で厳密にフィルタ |
| 複数タブでの同時録音 | 低 | 低 | localStorage 廃止で解決 |

---

## 11. 結論

- **最大の問題**: `useSpeakerManager` が**グローバル localStorage** でラベルを永続化しており、全録音で同じspeaker IDに同じラベルが適用される。加えて保存時に**元のspeaker IDが破壊的に上書き**される。
- **推奨する修正順序**:
  1. localStorage 永続化の廃止 + `speakerLabels` フィールド追加（根本解決）
  2. 保存処理で元speaker IDを保持
  3. 詳細ページで speakerLabels を使った表示
  4. localStorage クリーンアップ
- **他 Issue への影響**: #135 (タイムコード同期) の詳細ページ表示に軽微な影響（speakerLabels でのマッピング表示に変更）
- **判定**: ✅ **GO** — 修正範囲が限定的で後方互換性も保てるため、即座に着手可能
