# Issue #37: 文字起こしコピー時に話者ラベルを含める — 実装計画書

## 1. 概要

### 現状の問題
文字起こしのコピーボタン押下時に、`transcript`（プレーンテキスト）のみがクリップボードにコピーされる。
話者識別（Speaker Diarization）が有効な場合でも、話者ラベルが含まれない。

**現状のコード（page.tsx L348-351, L662）:**
```typescript
const handleCopy = useCallback(async (text: string, type: "transcript" | "translation") => {
  await navigator.clipboard.writeText(text);
  setCopied(type);
  setTimeout(() => setCopied(null), 2000);
}, []);

// 呼び出し箇所:
onClick={() => handleCopy(transcript, "transcript")}
```

`transcript` は `useSpeechRecognition` から返される結合テキストで、話者情報は含まれない。
一方、`labeledSegments` には `speakerLabel` が付与されているが、コピー時に活用されていない。

### 目標
- 話者識別 ON の場合: `[話者ラベル] テキスト` 形式でコピー
- 話者識別 OFF の場合: 従来通りプレーンテキストでコピー
- 録音詳細画面（`recording/page.tsx`）でも同様に対応

### コピー結果の例
```
[田中さん] 今日の議題について確認しましょう。
[鈴木さん] はい、まず売上報告からお願いします。
[田中さん] 第3四半期の売上は前年比120%でした。
```

## 2. アーキテクチャ設計

### データフロー
```
コピーボタン押下
    ↓
enableSpeakerDiarization && labeledSegments.length > 0 ?
    ├── YES → segments を話者ラベル付きテキストに整形 → clipboard
    └── NO  → transcript をそのまま → clipboard
```

### テキスト整形ロジック
```typescript
function formatSegmentsWithSpeakers(segments: LiveSegment[]): string {
  return segments
    .map((seg) => {
      if (seg.speaker && (seg.speakerLabel || seg.speaker)) {
        return `[${seg.speakerLabel || seg.speaker}] ${seg.text}`;
      }
      return seg.text;
    })
    .join("\n");
}
```

## 3. 変更対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `web/src/app/page.tsx` | コピー時に話者ラベル付きテキストを生成 |
| `web/src/app/recording/page.tsx` | 録音詳細画面でも話者ラベル付きコピーに対応 |

## 4. 実装詳細

### 4.1 page.tsx（メイン録音画面）の変更

#### コピーボタンの onClick 変更

**変更前（L662）:**
```tsx
onClick={() => handleCopy(transcript, "transcript")}
```

**変更後:**
```tsx
onClick={() => {
  const copyText = enableSpeakerDiarization && labeledSegments.length > 0
    ? labeledSegments
        .map((seg) =>
          seg.speaker
            ? `[${seg.speakerLabel || seg.speaker}] ${seg.text}`
            : seg.text
        )
        .join("\n")
    : transcript;
  handleCopy(copyText, "transcript");
}}
```

### 4.2 recording/page.tsx（録音詳細画面）の変更

#### コピーボタンの onClick 変更

**変更前（L326）:**
```tsx
onClick={() =>
  handleCopy(recording.transcript!.fullText, "transcript")
}
```

**変更後:**
```tsx
onClick={() => {
  const segments = recording.transcript?.segments || [];
  const hasSpeakers = segments.some((s) => s.speaker);
  const copyText = hasSpeakers
    ? segments
        .map((seg) =>
          seg.speaker
            ? `[${seg.speaker}] ${seg.text}`
            : seg.text
        )
        .join("\n")
    : recording.transcript!.fullText;
  handleCopy(copyText, "transcript");
}}
```

## 5. 設計判断

### なぜユーティリティ関数を別ファイルにしないか
- ロジックが 5 行程度で非常にシンプル
- 2 箇所（page.tsx と recording/page.tsx）で微妙に異なる型を使用（`LiveSegment` vs `TranscriptSegment`）
- 将来的にエクスポート機能（`lib/export.ts`）と統合する場合は別途リファクタリング

### 整形フォーマットの選択
- `[話者名] テキスト` 形式を採用（議事録/チャットログの標準的なフォーマット）
- 代替案: `話者名: テキスト` — ただし話者名にコロンが含まれる場合に曖昧になるため、角括弧を採用
- タイムスタンプは含めない（シンプルさ優先。エクスポート機能で対応済み）

## 6. テスト計画

| テストケース | 期待結果 |
|------------|---------|
| 話者識別 ON + 話者検出ありでコピー | `[話者ラベル] テキスト` 形式でコピーされる |
| 話者識別 ON + 話者未検出でコピー | 従来通りプレーンテキストでコピー |
| 話者識別 OFF でコピー | 従来通りプレーンテキストでコピー |
| リネーム済み話者でコピー | リネーム後のラベルが使用される |
| 録音詳細画面で話者付きコピー | 保存された話者名でコピーされる |
| コピー後のフィードバック | ✓アイコンが2秒間表示される |

## 7. 見積もり

| 作業 | 見積もり |
|------|---------|
| page.tsx のコピーロジック変更 | 15 分 |
| recording/page.tsx のコピーロジック変更 | 15 分 |
| テスト・動作確認 | 15 分 |
| **合計** | **45 分** |

## 8. リスク

| リスク | 影響度 | 対策 |
|--------|--------|------|
| クリップボードの文字数制限 | Low | 通常のミーティング議事録なら問題なし |
| 話者ラベルが undefined のセグメント混在 | Low | 条件分岐で seg.speaker の有無をチェック |

## 9. 将来の拡張

- コピーフォーマットの選択肢（プレーン/Markdown/リッチテキスト）
- タイムスタンプ付きコピーオプション
- `lib/export.ts` への整形ロジック統合
