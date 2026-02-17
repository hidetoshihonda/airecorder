# Issue #147: 録音詳細画面（History）で話者ラベル編集 — 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: 録音詳細画面（`/recording?id=xxx`）で保存済みの話者ラベルが表示されるが、編集機能が存在しない。録音後にラベルを修正する手段がない。
- **影響範囲**: 話者分離（Speaker Diarization）を利用する全ユーザーに影響。録音後に話者名を修正したいケースは頻繁に発生する。
- **修正の緊急度**: **Medium（P2）** — 機能欠損だが、録音中に設定すれば回避可能。

---

## 2. アーキテクチャ概観

### 2.1 コンポーネント依存関係

```
録音画面 (page.tsx)                       録音詳細画面 (recording/page.tsx)
├── useSpeakerManager()                   ├── recording.speakerLabels ← 表示のみ
│   ├── speakers: Map<string, SpeakerInfo>│   └── 編集UI なし ← ★ここが問題
│   ├── renameSpeaker()                   │
│   └── getSpeakerLabelsMap()             ├── getTranscriptWithSpeakerLabels()
│                                         │   └── recording.speakerLabels を参照
└── 保存時に getSpeakerLabelsMap()        └── recordingsApi.updateRecording()
    → speakerLabels フィールドに保存          └── speakerLabels 更新サポート済み ✅
```

### 2.2 データフロー

```
[録音中] 
  話者検出 → useSpeakerManager.speakers → UI表示 → ユーザー編集 → renameSpeaker()
  → 録音停止 → getSpeakerLabelsMap() → API.createRecording({ speakerLabels }) → CosmosDB

[録音詳細] (現状)
  CosmosDB → API.getRecording() → recording.speakerLabels → 表示のみ（編集不可）

[録音詳細] (あるべき姿)
  CosmosDB → API.getRecording() → recording.speakerLabels → 表示 + 編集UI
  → ユーザー編集 → API.updateRecording({ speakerLabels }) → CosmosDB → state更新
```

### 2.3 状態管理

| 状態 | 現在の管理場所 | 型 |
|------|-------------|-----|
| `recording.speakerLabels` | Recording オブジェクト内 | `Record<string, string>` |
| 話者一覧（録音中） | `useSpeakerManager` フック | `Map<string, SpeakerInfo>` |
| 話者一覧（詳細画面） | **存在しない** ← 新規追加必要 | `useMemo` で segments から導出 |

---

## 3. 重大バグ分析 🔴

該当なし。Issue #147 は新機能追加であり、既存バグではない。

---

## 4. 設計上の問題 🟡

### DESIGN-1: 話者一覧パネルの不在

**場所**: `web/src/app/recording/page.tsx`  
**問題**: 録音画面には話者一覧パネル（`speakers.size > 0` 時に表示）があるが、録音詳細画面には対応するUIがない。  
**影響**: 録音後に話者名を特定・修正できない。  
**修正方針**: `recording.transcript.segments` から speaker ID を抽出し、`recording.speakerLabels` と結合して話者一覧パネルを表示する。

### DESIGN-2: 話者ラベルクリック編集の不在

**場所**: `web/src/app/recording/page.tsx` L979-983  
**コード**:
```tsx
{segment.speaker && (
  <span className="shrink-0 text-xs font-medium text-purple-600 mt-0.5">
    {recording?.speakerLabels?.[segment.speaker] || segment.speaker}
  </span>
)}
```
**問題**: 話者名が `<span>` で表示されるのみで、クリック/編集不可。  
**修正方針**: 話者名クリックで `prompt()` またはインライン編集UIを表示し、`renameSpeaker()` 相当の処理を呼び出す。

### ✅ Good: データモデル・API は準備済み

- `Recording.speakerLabels: Record<string, string>` — 既に定義済み
- `UpdateRecordingInput.speakerLabels` — 既にサポート済み
- `recordingsApi.updateRecording()` — 既に speakerLabels を送信可能
- `getTranscriptWithSpeakerLabels()` — 既に `recording.speakerLabels` を参照
- → バックエンドの変更は **不要**

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #147 ──→ Issue #140 [前提/完了済み: speakerLabels フィールド追加]
Issue #147 ──→ Issue #120 [関連/完了済み: AI補正版コピー時の話者ラベル]
Issue #147 ──→ Issue #70  [関連/完了済み: correctedTranscript]
Issue #147 ──→ Issue #85  [相互作用: Ask AI の transcript にも speakerLabels 反映]
```

ブロッカーなし。全依存 Issue は完了済み。

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| 話者一覧パネル | transcript.segments | 低 | segments なしの場合は非表示 |
| ラベル永続化 | recordingsApi.updateRecording | 低 | 既にサポート済み |
| コピー/議事録生成 | getTranscriptWithSpeakerLabels | 低 | 既に recording.speakerLabels 参照 |

### 5.3 他 Issue/機能との相互作用

- **Issue #85 (Ask AI)**: API側で `recording.speakerLabels` を参照して transcript を構築するため、ラベル変更後は次回の Ask AI 質問から自動的に反映される。変更不要。
- **Issue #135 (タイムコード同期)**: UI上の話者ラベル表示位置に影響するが、構造的な変更は不要。

---

## 6. ブラウザ / 環境互換性リスク

該当なし。使用するのは標準的な React 状態管理とfetch API のみ。

---

## 7. 修正提案（優先順位付き）

### Phase 1: 話者ラベル編集機能の実装（P0）

#### 変更対象ファイル

| # | ファイル | 変更内容 | 種別 |
|---|---------|---------|------|
| 1 | `web/src/app/recording/page.tsx` | 話者一覧パネル追加 + ラベル編集ロジック | 修正 |
| 2 | `web/messages/ja.json` | RecordingDetail セクションに話者関連キー追加 | 修正 |
| 3 | `web/messages/en.json` | 同上 | 修正 |
| 4 | `web/messages/es.json` | 同上 | 修正 |

#### 1. `recording/page.tsx` の変更

##### 1.1 話者一覧の導出（useMemo）

```typescript
// transcript segments から話者一覧を導出
const speakerList = useMemo(() => {
  const segments = recording?.transcript?.segments || [];
  const speakerMap = new Map<string, { id: string; count: number }>();
  
  for (const seg of segments) {
    if (seg.speaker) {
      const existing = speakerMap.get(seg.speaker);
      if (existing) {
        existing.count++;
      } else {
        speakerMap.set(seg.speaker, { id: seg.speaker, count: 1 });
      }
    }
  }
  
  return Array.from(speakerMap.values());
}, [recording?.transcript?.segments]);
```

##### 1.2 話者ラベル編集ハンドラ

```typescript
const handleRenameSpeaker = async (speakerId: string, currentLabel: string) => {
  const newName = prompt(t("enterSpeakerName"), currentLabel);
  if (!newName || !newName.trim() || newName.trim() === currentLabel) return;
  if (!recording || !id) return;
  
  const updatedLabels = {
    ...recording.speakerLabels,
    [speakerId]: newName.trim(),
  };
  
  const response = await recordingsApi.updateRecording(id, {
    speakerLabels: updatedLabels,
  });
  
  if (response.data) {
    setRecording(response.data);
  }
};
```

##### 1.3 話者一覧パネルUI（CardHeader 内 or CardContent 先頭）

transcript タブの CardContent 先頭に追加：

```tsx
{/* 話者一覧パネル（Issue #147） */}
{speakerList.length > 0 && (
  <div className="mb-2 flex-none rounded-md border border-gray-200 p-2">
    <h4 className="text-xs font-semibold text-gray-500 mb-1 flex items-center gap-1">
      <Users className="h-3 w-3" />
      {t("speakerList")}
    </h4>
    <div className="flex flex-wrap gap-2">
      {speakerList.map((speaker) => {
        const label = recording?.speakerLabels?.[speaker.id] || speaker.id;
        return (
          <div
            key={speaker.id}
            className="flex items-center gap-1 rounded-full border border-gray-200 px-3 py-1 text-xs bg-white"
          >
            <span className="font-bold text-gray-700">{label}</span>
            <span className="text-gray-400">({t("speakerCount", { count: speaker.count })})</span>
            <button
              onClick={() => handleRenameSpeaker(speaker.id, label)}
              className="ml-1 text-gray-400 hover:text-gray-600 transition-colors"
              title={t("renameSpeaker")}
            >
              ✏️
            </button>
          </div>
        );
      })}
    </div>
  </div>
)}
```

##### 1.4 セグメント内話者ラベルのクリック編集

既存の `<span>` を `<button>` に変更：

```tsx
{segment.speaker && (
  <button
    type="button"
    onClick={() => handleRenameSpeaker(
      segment.speaker!,
      recording?.speakerLabels?.[segment.speaker!] || segment.speaker!
    )}
    className="shrink-0 text-xs font-medium text-purple-600 mt-0.5 hover:text-purple-800 hover:underline cursor-pointer"
    title={t("renameSpeaker")}
  >
    {recording?.speakerLabels?.[segment.speaker] || segment.speaker}
  </button>
)}
```

#### 2. i18n メッセージ追加

RecordingDetail セクションに以下を追加：

| キー | ja | en | es |
|------|-----|-----|-----|
| `speakerList` | 話者一覧 | Speakers | Hablantes |
| `speakerCount` | {count}回 | {count} times | {count} veces |
| `renameSpeaker` | 名前を変更 | Rename | Cambiar nombre |
| `enterSpeakerName` | 話者名を入力してください | Enter speaker name | Ingrese el nombre del hablante |
| `speakerLabelUpdated` | 話者ラベルを更新しました | Speaker label updated | Etiqueta de hablante actualizada |
| `speakerLabelUpdateFailed` | 話者ラベルの更新に失敗しました | Failed to update speaker label | Error al actualizar la etiqueta |

---

## 8. テスト戦略

### 状態遷移テスト（Unit）
- 話者ラベルなしの録音 → 話者一覧パネル非表示
- 話者ラベルありの録音 → 話者一覧パネル表示
- ラベル編集 → API 呼び出し → recording state 更新 → UI 反映
- ラベル編集 → コピー時に新ラベル使用
- ラベル編集キャンセル（prompt で空文字/Cancel） → 変更なし

### 手動テスト
- 話者分離ありの録音を開く → 話者一覧パネル表示確認
- 話者名クリック → prompt 表示 → 名前変更 → 全セグメントに反映
- 話者一覧の ✏️ クリック → 同上
- ページリロード → 変更が永続化されていること
- AI補正版切り替え → 新ラベルが反映されること
- コピーボタン → 新ラベルでコピーされること
- 議事録再生成 → 新ラベルで生成されること

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | recording/page.tsx に speakerList useMemo 追加 | 5分 | 録音詳細画面 |
| 2 | handleRenameSpeaker ハンドラ追加 | 5分 | 録音詳細画面 |
| 3 | 話者一覧パネルUI追加 | 10分 | 録音詳細画面 |
| 4 | セグメント内話者ラベルをクリック可能に | 5分 | 録音詳細画面 |
| 5 | i18n メッセージ追加 (3ファイル) | 5分 | メッセージファイル |
| 6 | ビルド・ESLint 確認 | 5分 | - |
| **合計** | | **35分** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| API 更新が失敗した場合のUI不整合 | 低 | 中 | エラー時は state を戻さない（楽観更新しない） |
| 大量セグメントでの話者一覧パフォーマンス | 低 | 低 | useMemo で最適化済み |
| prompt() のUX（ネイティブダイアログ） | - | 低 | 録音画面と同じUXを維持。Phase 2 でインライン編集化可能 |

---

## 11. 結論

- **最大のポイント**: バックエンド・データモデルは完全に準備済み。フロントエンドの UI 追加のみで実装完了する。
- **推奨する修正順序**: 1ファイル（`recording/page.tsx`）の修正 + 3ファイル（i18n）の更新のみ。
- **他 Issue への影響**: なし（既存の `getTranscriptWithSpeakerLabels()` や Ask AI API は `recording.speakerLabels` を既に参照しているため、ラベル更新後は自動的に反映）。
- **判定**: **GO** ✅ — 実装着手可能。低リスク・低工数の改善。
