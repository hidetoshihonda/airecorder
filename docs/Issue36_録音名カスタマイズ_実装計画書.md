# Issue #36: 録音保存時に名前を設定可能にする — 実装計画書

## 1. 概要

### 現状の問題
録音保存時にタイトルが自動生成（「録音 2026/02/08 14:30」形式）されており、ユーザーが任意の名前を付けることができない。
- `page.tsx` L365 で `t("recordingTitle", { date, time })` により固定的にタイトルを生成
- 履歴画面で録音を区別しづらい

### 目標
- 保存ボタン押下後、ダイアログを表示して録音タイトルを入力できるようにする
- デフォルト値として現在の自動生成タイトルを表示（そのままでも保存可能）
- 空文字の場合はデフォルトタイトルにフォールバック

## 2. アーキテクチャ設計

### データフロー
```
保存ボタン押下
    ↓
SaveDialog（ダイアログ）表示
    ↓ ユーザーがタイトルを入力（or デフォルトのまま）
    ↓ 「保存」ボタン押下
handleSave(customTitle)
    ↓ title = customTitle || defaultTitle
Audio Upload → API → Cosmos DB
```

### UI 設計
- Radix UI Dialog（既存の `dialog.tsx` を利用）
- 入力欄: `<Input>` コンポーネント（既存）
- ボタン: 「キャンセル」「保存」
- デフォルト値: 現在の自動生成タイトル（`録音 YYYY/MM/DD HH:MM`）

## 3. 変更対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `web/src/app/page.tsx` | SaveDialog の追加、handleSave をダイアログ経由に変更 |
| `web/messages/ja.json` | i18n キー追加（ダイアログ関連） |
| `web/messages/en.json` | i18n キー追加 |
| `web/messages/es.json` | i18n キー追加 |

## 4. 実装詳細

### 4.1 page.tsx の変更

#### 新規 state 追加
```typescript
const [isSaveDialogOpen, setIsSaveDialogOpen] = useState(false);
const [recordingTitle, setRecordingTitle] = useState("");
```

#### 保存ボタンのクリックハンドラ変更
```typescript
// 変更前: 直接 handleSave() を呼ぶ
// 変更後: ダイアログを開く
const handleSaveClick = () => {
  if (!transcript) return;
  if (!requireAuth(t("saveRecording"))) return;
  
  // デフォルトタイトルを生成してダイアログを開く
  const now = new Date();
  const dateLocale = appLocale === "ja" ? "ja-JP" : appLocale === "es" ? "es-ES" : "en-US";
  const defaultTitle = t("recordingTitle", {
    date: now.toLocaleDateString(dateLocale),
    time: now.toLocaleTimeString(dateLocale, { hour: "2-digit", minute: "2-digit" }),
  });
  setRecordingTitle(defaultTitle);
  setIsSaveDialogOpen(true);
};
```

#### handleSave にタイトル引数を追加
```typescript
const handleSave = async (customTitle: string) => {
  // ...
  const title = customTitle.trim() || defaultTitle;
  // 以降は既存ロジックのまま（title 変数の値が変わるだけ）
};
```

#### SaveDialog コンポーネント（page.tsx 内にインライン定義）
```tsx
<Dialog open={isSaveDialogOpen} onOpenChange={setIsSaveDialogOpen}>
  <DialogContent className="sm:max-w-md">
    <DialogHeader>
      <DialogTitle>{t("saveDialogTitle")}</DialogTitle>
      <DialogDescription>{t("saveDialogDescription")}</DialogDescription>
    </DialogHeader>
    <div className="space-y-4 py-2">
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">
          {t("recordingNameLabel")}
        </label>
        <Input
          value={recordingTitle}
          onChange={(e) => setRecordingTitle(e.target.value)}
          placeholder={t("recordingNamePlaceholder")}
          maxLength={100}
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              setIsSaveDialogOpen(false);
              handleSave(recordingTitle);
            }
          }}
        />
      </div>
    </div>
    <DialogFooter>
      <Button variant="outline" onClick={() => setIsSaveDialogOpen(false)}>
        {t("cancel")}
      </Button>
      <Button
        onClick={() => {
          setIsSaveDialogOpen(false);
          handleSave(recordingTitle);
        }}
        disabled={isSaving}
      >
        {isSaving ? <Spinner size="sm" /> : <Save className="h-4 w-4 mr-1" />}
        {t("save")}
      </Button>
    </DialogFooter>
  </DialogContent>
</Dialog>
```

### 4.2 i18n キーの追加

#### ja.json（HomePage セクション内）
```json
"saveDialogTitle": "録音を保存",
"saveDialogDescription": "録音にタイトルを付けてください",
"recordingNameLabel": "録音タイトル",
"recordingNamePlaceholder": "例: 定例ミーティング 2月8日",
"cancel": "キャンセル"
```

#### en.json
```json
"saveDialogTitle": "Save Recording",
"saveDialogDescription": "Give your recording a title",
"recordingNameLabel": "Recording Title",
"recordingNamePlaceholder": "e.g. Weekly Meeting Feb 8",
"cancel": "Cancel"
```

#### es.json
```json
"saveDialogTitle": "Guardar grabación",
"saveDialogDescription": "Dale un título a tu grabación",
"recordingNameLabel": "Título de la grabación",
"recordingNamePlaceholder": "Ej: Reunión semanal 8 de feb",
"cancel": "Cancelar"
```

## 5. テスト計画

| テストケース | 期待結果 |
|------------|---------|
| 保存ボタン押下 → ダイアログ表示 | ダイアログが開き、デフォルトタイトルが入力欄に表示される |
| タイトルを入力して保存 | 入力したタイトルで録音が保存される |
| タイトル未入力（空文字）で保存 | デフォルトタイトル（日時）で保存される |
| Enter キーで保存 | ダイアログが閉じて保存が実行される |
| キャンセルボタン押下 | ダイアログが閉じ、保存されない |
| タイトル100文字超入力 | maxLength で制限される |
| 各言語(ja/en/es)で確認 | ダイアログのラベルが正しく翻訳される |

## 6. 見積もり

| 作業 | 見積もり |
|------|---------|
| page.tsx のダイアログ実装 | 30 分 |
| i18n キー追加（3言語） | 10 分 |
| テスト・動作確認 | 20 分 |
| **合計** | **1 時間** |

## 7. リスク

| リスク | 影響度 | 対策 |
|--------|--------|------|
| Dialog コンポーネントの import 追加忘れ | Low | 既存の dialog.tsx をそのまま使用 |
| Enter キーでフォーム送信される可能性 | Low | onKeyDown で明示的にハンドリング |

## 8. 履歴詳細画面でのタイトル編集（追加機能）

Issue の記述に「後で変更できる機能」が含まれているため、履歴詳細画面でもタイトル編集を可能にする。

### 8.1 UI 設計
```
[タイトル表示] + [✏️ 編集アイコン]
       ↓ クリック
[Input 編集モード] + [✓ 保存] [✕ キャンセル]
       ↓ 保存 or Enter
[API 更新] → [タイトル表示に戻る]
```

### 8.2 変更対象
| ファイル | 変更内容 |
|---------|---------|
| `web/src/app/recording/page.tsx` | インライン編集UI追加 |

### 8.3 実装詳細

#### 新規 state 追加
```typescript
const [isEditingTitle, setIsEditingTitle] = useState(false);
const [editedTitle, setEditedTitle] = useState("");
const [isUpdatingTitle, setIsUpdatingTitle] = useState(false);
```

#### タイトル表示エリアの変更
```tsx
{/* Title & Meta */}
<div className="mb-6">
  {isEditingTitle ? (
    <div className="flex items-center gap-2">
      <Input
        value={editedTitle}
        onChange={(e) => setEditedTitle(e.target.value)}
        className="text-xl font-bold"
        maxLength={100}
        autoFocus
        onKeyDown={(e) => {
          if (e.key === "Enter") handleTitleSave();
          if (e.key === "Escape") setIsEditingTitle(false);
        }}
      />
      <Button size="sm" variant="ghost" onClick={handleTitleSave} disabled={isUpdatingTitle}>
        {isUpdatingTitle ? <Spinner size="sm" /> : <Check className="h-4 w-4" />}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setIsEditingTitle(false)}>
        <X className="h-4 w-4" />
      </Button>
    </div>
  ) : (
    <div className="flex items-center gap-2">
      <h1 className="text-2xl font-bold text-gray-900">{recording.title}</h1>
      <Button size="sm" variant="ghost" onClick={handleTitleEdit}>
        <PenSquare className="h-4 w-4" />
      </Button>
    </div>
  )}
  {/* 日時・長さなど既存のメタ情報 */}
</div>
```

#### ハンドラ関数
```typescript
const handleTitleEdit = () => {
  setEditedTitle(recording.title);
  setIsEditingTitle(true);
};

const handleTitleSave = async () => {
  const trimmed = editedTitle.trim();
  if (!trimmed || trimmed === recording.title) {
    setIsEditingTitle(false);
    return;
  }
  
  setIsUpdatingTitle(true);
  const response = await recordingsApi.updateRecording(recording.id, { title: trimmed });
  setIsUpdatingTitle(false);
  
  if (response.error) {
    alert(`タイトル更新に失敗しました: ${response.error}`);
    return;
  }
  
  // recording state を更新
  setRecording({ ...recording, title: trimmed });
  setIsEditingTitle(false);
};
```

### 8.4 追加見積もり
| 作業 | 見積もり |
|------|---------|
| recording/page.tsx 編集機能 | 20 分 |

**合計見積もり（全体）**: **1 時間 20 分**

## 9. 備考

- 既存 API (`recordingsApi.updateRecording`) を使用するため、バックエンド変更なし
- コスト影響: なし（フロントエンドのみの変更）
