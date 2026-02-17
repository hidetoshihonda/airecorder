# Issue #147: 録音詳細画面（History）で話者ラベル編集 — 実装計画書

## 概要

録音詳細画面（`/recording?id=xxx`）に話者ラベル編集機能を追加する。  
録音画面と同様の UI を提供し、変更は即座に CosmosDB に永続化される。

- **前提**: バックエンド変更不要（`UpdateRecordingInput.speakerLabels` サポート済み）
- **影響範囲**: フロントエンドのみ（1コンポーネント + i18n 3ファイル）
- **見積り**: 35分

---

## 変更対象ファイル一覧

| # | ファイル | 変更種別 | 概要 |
|---|---------|---------|------|
| 1 | `web/src/app/recording/page.tsx` | 修正 | 話者一覧パネル + 編集ロジック追加 |
| 2 | `web/messages/ja.json` | 修正 | RecordingDetail に話者関連キー追加 |
| 3 | `web/messages/en.json` | 修正 | 同上 |
| 4 | `web/messages/es.json` | 修正 | 同上 |

---

## Step 1: `recording/page.tsx` — 話者一覧の導出

### 挿入位置

`displayTranscript` useMemo（L251付近）の直後に追加。

### コード

```typescript
// transcript segments から話者一覧を導出
const speakerList = useMemo(() => {
  const segments = displayTranscript || [];
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
}, [displayTranscript]);
```

---

## Step 2: `recording/page.tsx` — 話者ラベル編集ハンドラ

### 挿入位置

`handleRenameSpeaker` を他のハンドラ関数の近く（例: `handleTitleChange` の付近）に追加。

### コード

```typescript
const handleRenameSpeaker = async (speakerId: string, currentLabel: string) => {
  const newName = prompt(t("enterSpeakerName"), currentLabel);
  if (!newName || !newName.trim() || newName.trim() === currentLabel) return;
  if (!recording || !id) return;
  
  const updatedLabels = {
    ...recording.speakerLabels,
    [speakerId]: newName.trim(),
  };
  
  try {
    const response = await recordingsApi.updateRecording(id, {
      speakerLabels: updatedLabels,
    });
    
    if (response.data) {
      setRecording(response.data);
    }
  } catch {
    // エラー時は状態を変更しない（楽観更新しない設計）
    console.error("Failed to update speaker label");
  }
};
```

---

## Step 3: `recording/page.tsx` — 話者一覧パネル UI

### 挿入位置

transcript タブの `CardContent` 内、既存の transcript 表示の直前に追加。  
具体的には、タブ切替ボタン（original/corrected/translated）の直後、セグメント一覧の直前。

### コード

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
            <span className="text-gray-400">
              ({t("speakerCount", { count: speaker.count })})
            </span>
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

### `Users` アイコンの import 確認

既存の lucide-react import に `Users` が含まれているか確認し、なければ追加する。

---

## Step 4: `recording/page.tsx` — セグメント内話者ラベルをクリック可能に

### 変更箇所

`recording/page.tsx` L979-983 付近の `<span>` を `<button>` に変更。

### Before

```tsx
{segment.speaker && (
  <span className="shrink-0 text-xs font-medium text-purple-600 mt-0.5">
    {recording?.speakerLabels?.[segment.speaker] || segment.speaker}
  </span>
)}
```

### After

```tsx
{segment.speaker && (
  <button
    type="button"
    onClick={() => handleRenameSpeaker(
      segment.speaker!,
      recording?.speakerLabels?.[segment.speaker!] || segment.speaker!
    )}
    className="shrink-0 text-xs font-medium text-purple-600 mt-0.5 hover:text-purple-800 hover:underline cursor-pointer bg-transparent border-none p-0"
    title={t("renameSpeaker")}
  >
    {recording?.speakerLabels?.[segment.speaker] || segment.speaker}
  </button>
)}
```

---

## Step 5: i18n メッセージ追加

### `web/messages/ja.json` — RecordingDetail セクション内に追加

```json
"speakerList": "話者一覧",
"speakerCount": "{count}回",
"renameSpeaker": "名前を変更",
"enterSpeakerName": "話者名を入力してください"
```

### `web/messages/en.json` — RecordingDetail セクション内に追加

```json
"speakerList": "Speakers",
"speakerCount": "{count} times",
"renameSpeaker": "Rename",
"enterSpeakerName": "Enter speaker name"
```

### `web/messages/es.json` — RecordingDetail セクション内に追加

```json
"speakerList": "Hablantes",
"speakerCount": "{count} veces",
"renameSpeaker": "Cambiar nombre",
"enterSpeakerName": "Ingrese el nombre del hablante"
```

---

## Step 6: ビルド・ESLint 確認

```bash
cd web && npm run build
```

- ESLint エラーがないことを確認
- TypeScript 型エラーがないことを確認
- `console.error` は ESLint で禁止されている場合は削除するか `// eslint-disable-next-line` を追加

---

## 注意事項

### getTranscriptWithSpeakerLabels は変更不要

既存の `getTranscriptWithSpeakerLabels()` 関数（L447付近）は `recording?.speakerLabels?.[seg.speaker]` を参照しているため、`handleRenameSpeaker` で `setRecording(response.data)` を呼べば、次回のコピー/議事録生成時に自動的に新ラベルが使用される。

### Ask AI (Issue #85) への影響なし

Ask AI API はサーバー側で `recording.speakerLabels` を参照して transcript を構築するため、ラベルが CosmosDB に保存されれば次回の質問から自動反映される。

### useSpeakerManager は使用しない

`useSpeakerManager` フックは録音中のリアルタイム話者管理向けに設計されているため、録音詳細画面では使用しない。代わりに、`useMemo` + `handleRenameSpeaker` のシンプルな構成で実装する。

---

## 完了条件

- [ ] 話者分離ありの録音を詳細画面で開くと話者一覧パネルが表示される
- [ ] 話者一覧の ✏️ ボタンで名前変更ダイアログが表示される
- [ ] セグメント内の話者名クリックでも名前変更ダイアログが表示される
- [ ] 名前変更後、全セグメントの話者ラベルが即座に反映される
- [ ] ページリロード後も変更が保持される
- [ ] コピーボタンで新しい話者名が使用される
- [ ] 議事録再生成で新しい話者名が使用される
- [ ] 話者なしの録音では話者一覧パネルが非表示
- [ ] ESLint / TypeScript エラーなし
