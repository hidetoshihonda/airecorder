# Issue #5 音声ファイルの再生・ダウンロード不可 — 分析レビュー

## 1. エグゼクティブサマリー

- **本質**: 録音の再生・ダウンロードが機能しない原因は、履歴画面で `audioUrl`（Azure Blob の生 URL）をそのまま `<a href>` / `<audio src>` に渡しているため。Blob Storage はプライベートアクセスのため SAS トークンなしではアクセス不可。
- **影響範囲**: 録音を保存した全ユーザーの再生・DL が 100% 失敗
- **緊急度**: **P0 Critical** — コア機能の完全停止

## 2. アーキテクチャ概観

```
[録音ページ page.tsx]
    │ handleSave()
    ├── blobApi.uploadAudio(blob, fileName)
    │     ├── getUploadSas(fileName) → API /blob/upload-sas → SAS付きURL取得
    │     └── PUT blob to Azure Blob Storage (SAS付き)
    │         → 返却値: blobUrl (SASなしの生URL)
    │
    └── recordingsApi.createRecording({ audioUrl: blobUrl })
          └── Cosmos DB に blobUrl を保存

[履歴ページ history/page.tsx]
    │ recordingsApi.listRecordings()
    │   → recording.audioUrl = 生のblobUrl (SASなし)
    │
    ├── <a href={recording.audioUrl}> Play  → ❌ 403 Forbidden
    └── <a href={recording.audioUrl} download> DL → ❌ 403 Forbidden

[録音詳細ページ recording/page.tsx]
    │ recordingsApi.getRecording(id)
    │   → recording.audioUrl
    │
    ├── blobApi.getPlayableUrl(audioUrl) → SAS付きURL取得 ✅ (正しい)
    │     → audioUrl state に設定
    │     → new Audio(audioUrl).play() → ✅ 動作可能
    │
    └── <audio src={recording.audioUrl}> → ❌ 生URL (SASなし)
        <a href={recording.audioUrl} download> → ❌ 生URL (SASなし)
```

## 3. 重大バグ分析 🔴

### BUG-1: 履歴画面で SAS トークンなしの生 URL を使用 (Critical)

**場所**: [history/page.tsx](../src/app/history/page.tsx) L251-L268

**コード**:
```tsx
{recording.audioUrl && (
  <>
    <Button variant="ghost" size="sm" asChild>
      <a href={recording.audioUrl} target="_blank" rel="noopener noreferrer">
        <Play className="h-4 w-4" />
      </a>
    </Button>
    <Button variant="ghost" size="sm" asChild>
      <a href={recording.audioUrl} download>
        <Download className="h-4 w-4" />
      </a>
    </Button>
  </>
)}
```

**問題**: `recording.audioUrl` は `https://<account>.blob.core.windows.net/recordings/<blob>` という SAS トークンなしの生 URL。Azure Blob Storage はプライベートコンテナのため、SAS なしアクセスは **403 Forbidden**。

**影響**: 履歴画面からの再生・ダウンロードが 100% 失敗。

**根本原因**: `blobApi.getPlayableUrl()` / `blobApi.getDownloadSas()` を呼ばずに直接 URL を使用している。

**修正方針**: Play/Download ボタンクリック時に `blobApi.getPlayableUrl()` で SAS 付き URL を取得してから開く/DL する。

---

### BUG-2: 録音詳細画面の `<audio>` と DL ボタンが生 URL を使用 (Critical)

**場所**: [recording/page.tsx](../src/app/recording/page.tsx) L314-L325

**コード**:
```tsx
{recording.audioUrl && (
  <Card className="mb-6">
    <CardContent className="py-4">
      <div className="flex items-center gap-4">
        <audio controls className="flex-1" src={recording.audioUrl}>
          お使いのブラウザは音声再生をサポートしていません。
        </audio>
        <Button variant="outline" size="sm" asChild>
          <a href={recording.audioUrl} download>
            <Download className="mr-2 h-4 w-4" />
            ダウンロード
          </a>
        </Button>
      </div>
    </CardContent>
  </Card>
)}
```

**問題**: `recording.audioUrl` は生 URL。上部に `blobApi.getPlayableUrl()` で SAS 付き URL を取得するロジックがあるが（L101-106）、その `audioUrl` state をここで使っていない。

**影響**: `<audio>` コントロールと DL ボタンが 403 で失敗。一方、カスタム Play ボタン（L113-133）は SAS 付き `audioUrl` を使うため動作する。**同一画面に動くプレイヤーと壊れたプレイヤーが同居している。**

**修正方針**: `<audio src>` と `<a download>` を SAS 付き `audioUrl` state に変更。重複する2つのプレイヤーを1つに統合。

---

### BUG-3: SAS トークンの有効期限管理がない (High)

**場所**: [recording/page.tsx](../src/app/recording/page.tsx) L97-106, [blobApi.ts](../src/services/blobApi.ts) L154-160

**問題**: ダウンロード SAS は 1 時間有効（API 側で設定）だが、ユーザーがページを1時間以上開きっぱなしにすると SAS が期限切れになり再生不可に。期限切れの検知・更新ロジックがない。

**影響**: 長時間ページを開いたユーザー（会議中など）の再生が静かに失敗。

**修正方針**: SAS の `expiresOn` を保持し、再生/DL 時に期限チェック → 期限切れなら再取得。

---

### BUG-4: 音声ファイル未生成時のエラー表示がない (Medium)

**場所**: [history/page.tsx](../src/app/history/page.tsx) L245-269

**問題**: `recording.audioUrl` が `undefined`（= 音声未保存）の場合、Play/DL ボタン自体が非表示になるが、ユーザーには「音声なし」の理由が分からない。Issue の受け入れ条件に「失敗時のエラー表示（権限/期限切れ/未生成など）を明確化」とある。

**修正方針**: `audioUrl` がない場合に「音声ファイルなし」バッジを表示。SAS 取得失敗時にはエラーメッセージを表示。

## 4. 設計上の問題 🟡

### DESIGN-1: 録音詳細画面に重複するオーディオプレイヤーが2つある

**場所**: [recording/page.tsx](../src/app/recording/page.tsx) L275-311 と L314-325

- L275-311: カスタム Play ボタン（SAS 付き URL を使用 → 動作する）
- L314-325: HTML `<audio controls>` （生 URL を使用 → 動作しない）

**問題**: 2つのプレイヤーが同居し、一方は動き一方は壊れている。UX が混乱する。

**修正方針**: HTML `<audio controls>` を SAS 付き URL で統一し、カスタムボタンは削除。または、カスタムプレイヤーに `<audio>` を内部利用して一本化。

### DESIGN-2: 履歴画面の再生が別タブで開く

**場所**: [history/page.tsx](../src/app/history/page.tsx) L254-260

```tsx
<a href={recording.audioUrl} target="_blank" rel="noopener noreferrer">
```

**問題**: 音声再生が別タブで開く（`target="_blank"`）。ユーザーは画面内で再生を期待する。

**修正方針**: インライン `<audio>` プレイヤーを展開するか、詳細ページに遷移させる。

### DESIGN-3: `blobService.ts` (API側) の `generateSasUrl` が未完成

**場所**: [blobService.ts](../../api/src/services/blobService.ts) L63-72

```typescript
export async function generateSasUrl(
  blobName: string,
  expiresInMinutes: number = 60
): Promise<string> {
  // For production, you should use proper SAS token generation
  // This is a simplified version that returns the direct URL
  return blockBlobClient.url;  // ← SAS なしの生 URL を返す
}
```

**問題**: コメントで「production では SAS を使え」と書いてあるが、実装は生 URL を返すだけ。ただし、この関数は blob.ts の HTTP handler からは使われておらず、直接の影響はない。

### DESIGN-4: Audio の MIME タイプとファイル拡張子の不整合

**場所**: [page.tsx](../src/app/page.tsx) L299

```typescript
const fileName = `recording-${now.getTime()}.webm`;
```

ファイル名は常に `.webm` だが、実際の MIME タイプは `useAudioRecorder` が選択したもの（`audio/webm;codecs=opus` / `audio/mp4` / `audio/wav`）。Safari では `audio/mp4` が選ばれるので、`.webm` 拡張子と不整合。

**修正方針**: 実際の MIME タイプに応じた拡張子を使用。

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係
```
Issue #5 (本Issue) ──→ Issue #2 (録音制御) [修正済み: audioBlob の生成が正常化]
Issue #5 ──→ なし (独立して修正可能)
```

### 5.2 技術的依存関係
| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| history/page.tsx | blobApi.getPlayableUrl | 非同期化が必要 | onClick handler で SAS 取得 |
| recording/page.tsx | blobApi.getPlayableUrl | 既存ロジックあり | audioUrl state を活用 |
| blobApi | API /blob/download-sas | API側は正しく動く | フロント修正のみ |
| audioUrl (DB) | Blob Storage | URL 形式の変更なし | 影響なし |

### 5.3 他 Issue/機能との相互作用
- Issue #2 の修正で `useAudioRecorder` に duration 統合済み → `audioBlob` は正しく生成される
- Issue #4（スクロール問題）とは独立

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Chrome/Edge | ✅ `audio/webm;codecs=opus` サポート | 低 |
| Safari/iOS | ⚠️ webm 非サポート、`audio/mp4` にフォールバック | ファイル拡張子の不整合（DESIGN-4） |
| Firefox | ✅ webm サポート | 低 |
| `<audio>` download 属性 | ⚠️ cross-origin で無効化される場合あり | SAS 付き URL では同一オリジンではないので `download` 属性が効かない可能性 |

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0）

#### 7.1 履歴画面: SAS 付き URL で再生・DL (BUG-1)

**変更ファイル**: `web/src/app/history/page.tsx`

Play/DL ボタンを `<a href>` 直接リンクから、onClick で SAS 付き URL を取得してから開く方式に変更。

```tsx
// 音声再生ハンドラ
const handlePlay = async (audioUrl: string) => {
  const playableUrl = await blobApi.getPlayableUrl(audioUrl);
  if (playableUrl) {
    window.open(playableUrl, '_blank');
  } else {
    alert("音声ファイルを読み込めませんでした");
  }
};

// 音声ダウンロードハンドラ
const handleDownload = async (audioUrl: string, title: string) => {
  const playableUrl = await blobApi.getPlayableUrl(audioUrl);
  if (playableUrl) {
    const a = document.createElement('a');
    a.href = playableUrl;
    a.download = `${title}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } else {
    alert("音声ファイルをダウンロードできませんでした");
  }
};
```

#### 7.2 録音詳細画面: 重複プレイヤー統合 + SAS URL 使用 (BUG-2, DESIGN-1)

**変更ファイル**: `web/src/app/recording/page.tsx`

- 2つのプレイヤーを1つに統合
- `<audio>` タグに SAS 付き `audioUrl` state を使用
- DL ボタンも SAS 付き URL を使用

```tsx
{/* Audio Player - 統合版 */}
{recording.audioUrl && (
  <Card className="mb-6">
    <CardContent className="py-4">
      {isLoadingAudio ? (
        <div className="flex items-center gap-2">
          <Spinner size="sm" />
          <span className="text-sm text-gray-600">音声を読み込み中...</span>
        </div>
      ) : audioUrl ? (
        <div className="flex items-center gap-4">
          <audio controls className="flex-1" src={audioUrl}>
            お使いのブラウザは音声再生をサポートしていません。
          </audio>
          <Button variant="outline" size="sm" onClick={() => handleDownload()}>
            <Download className="mr-2 h-4 w-4" />
            ダウンロード
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 text-yellow-700">
          <AlertCircle className="h-4 w-4" />
          <span className="text-sm">音声ファイルを読み込めませんでした</span>
        </div>
      )}
    </CardContent>
  </Card>
)}
```

#### 7.3 MIME タイプに応じた拡張子 (DESIGN-4)

**変更ファイル**: `web/src/app/page.tsx`

```typescript
const mimeToExtension: Record<string, string> = {
  "audio/webm;codecs=opus": ".webm",
  "audio/webm": ".webm",
  "audio/mp4": ".m4a",
  "audio/wav": ".wav",
};
const ext = mimeToExtension[audioBlob.type] || ".webm";
const fileName = `recording-${now.getTime()}${ext}`;
```

### Phase 2: 堅牢性強化（P1）

#### 7.4 SAS 期限切れ対策 (BUG-3)

`expiresOn` を state に保持し、再生/DL 時に期限チェック。

#### 7.5 音声なし時の明示表示 (BUG-4)

履歴画面で `audioUrl` 未設定時に「音声なし」バッジ表示。

## 8. テスト戦略

- **Unit**: `blobApi.getPlayableUrl()` のモック（成功/失敗/タイムアウト）
- **統合**: 録音 → 保存 → 履歴画面 → 再生 → DL の E2E フロー
- **手動テスト**:
  | テスト | Chrome | Safari | Firefox |
  |--------|--------|--------|---------|
  | 履歴画面再生 | - | - | - |
  | 履歴画面DL | - | - | - |
  | 詳細画面再生 | - | - | - |
  | 詳細画面DL | - | - | - |
  | SAS 期限切れ後の再生 | - | - | - |
  | audioUrl なしの録音 | - | - | - |

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | history/page.tsx: SAS 対応 + インポート追加 | 15min | 履歴画面 |
| 2 | recording/page.tsx: プレイヤー統合 + SAS 統一 | 20min | 詳細画面 |
| 3 | page.tsx: MIME→拡張子マッピング | 5min | 録音保存 |
| 4 | ビルド検証・PR | 10min | - |

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| SAS 取得 API がダウン | 低 | 高 | エラーメッセージ表示 |
| cross-origin で download 属性が無効 | 中 | 中 | Blob経由のDLフォールバック |
| Safari で webm 再生不可 | 中 | 中 | MIME フォールバック済み (Issue #2) |

## 11. 結論

- **最大の問題**: 履歴画面の再生・DL が SAS なし URL のため 100% 失敗
- **推奨修正順序**: BUG-1 (履歴) → BUG-2 (詳細統合) → DESIGN-4 (拡張子) → BUG-3 (期限管理)
- **他 Issue への影響**: なし（独立修正可能）
- **判定**: **GO** — フロントエンドのみの修正で解決。API 側は正しく動作している。
