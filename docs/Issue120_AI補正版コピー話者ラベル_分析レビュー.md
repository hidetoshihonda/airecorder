# Issue #120: AI補正版コピー時に話者分離ラベルが反映されない — 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: AI補正版の文字起こしをコピーする際、`getTranscriptWithSpeakerLabels()` 関数がオリジナルの transcript のみを対象としており、corrected 表示時は `fullText` をそのまま返すため話者ラベルが欠落する
- **影響範囲**: 話者識別ONで録音したユーザーの100%に影響（AI補正版コピー時）
- **修正の緊急度**: **P2 — Medium**（機能は動作するが、議事録作成時に発言者が不明になる UX 劣化）

## 2. アーキテクチャ概観

### コンポーネント依存関係

```
recording/page.tsx
├── getTranscriptWithSpeakerLabels()  ← オリジナル専用
├── handleCopy()
├── コピーボタン onClick
│   ├── corrected → recording.correctedTranscript.fullText  ← 🔴 話者ラベルなし
│   └── original  → getTranscriptWithSpeakerLabels()        ← ✅ 話者ラベルあり
└── displayTranscript (useMemo)
    ├── corrected → recording.correctedTranscript
    └── original  → recording.transcript
```

### データフロー

```
[録音 + 話者識別ON]
  → transcript.segments[{speaker, text}]  ← 話者情報あり
  → transcript.fullText                    ← 話者ラベルなし（プレーンテキスト）

[LLM補正]（transcriptCorrectionService.ts L68-71）
  → correctedTranscript.segments = transcript.segments  ← 元のsegmentsをそのまま保持
  → correctedTranscript.fullText = 補正されたテキスト   ← LLMが生成したプレーンテキスト
```

### 重要な発見: correctedTranscript.segments にも話者情報が存在する

`transcriptCorrectionService.ts` L68-71:
```typescript
return {
    segments: transcript.segments,  // ← オリジナルのsegmentsをそのままコピー
    fullText: correctedText,         // ← fullTextのみLLM補正版に置換
};
```

つまり `correctedTranscript.segments` は `transcript.segments` と**完全に同じオブジェクト参照**であり、speaker 情報が保持されている。

## 3. 重大バグ分析 🔴

### BUG-1: AI補正版コピー時に話者ラベルが欠落する

**場所**: `web/src/app/recording/page.tsx` L824-L835

**コード**:
```typescript
onClick={() =>
  handleCopy(
    transcriptView === "corrected" && recording.correctedTranscript
      ? recording.correctedTranscript.fullText  // 🔴 話者ラベルなし
      : getTranscriptWithSpeakerLabels(),        // ✅ 話者ラベルあり
    "transcript"
  )
}
```

**問題**: `corrected` ビュー時に `fullText` をそのまま返しているため、`[田中さん]` のような話者ラベルがコピーされたテキストに含まれない。

**影響**: 話者識別ONで録音したユーザーが AI 補正版をコピーして議事録に貼り付けると、誰の発言か判別できない。

**根本原因**: `getTranscriptWithSpeakerLabels()` がオリジナルの `recording.transcript.segments` のみを参照する設計で、correctedTranscript 用の分岐が存在しない。

**修正方針**: `getTranscriptWithSpeakerLabels()` を拡張して、corrected 表示時は `correctedTranscript.segments`（= 元の segments と同一、speaker 情報あり）を使用して話者ラベル付きテキストを生成する。

### BUG-2（潜在）: correctedTranscript の fullText と segments のテキストが不一致

**場所**: `api/src/services/transcriptCorrectionService.ts` L68-71

**コード**:
```typescript
return {
    segments: transcript.segments,  // 元のsegmentsのtext
    fullText: correctedText,         // LLM補正後のtext
};
```

**問題**: `correctedTranscript.segments[].text` は**補正前**のテキストだが、`correctedTranscript.fullText` は**補正後**のテキスト。話者ラベル付きコピーで segments の text を使うと、補正前のテキストに話者ラベルが付く形になる。

**影響**: Medium — ユーザーが「AI補正版」を見ているのに、コピーすると補正前のテキストに話者ラベルが付く不整合が起きる。

**修正方針（Issue #120 スコープ）**: segments を使う方式に加え、この不整合をユーザーに意識させない実装が必要。**fullText を行分割して、各行に対応する segment の speaker を付与する**方式を検討。ただし行と segment の1対1対応が保証されない場合がある。

最もシンプルかつ正確な方法: **correctedTranscript.segments（= オリジナル segments）の speaker 情報を使って話者ラベルを付与し、テキスト部分は correctedTranscript.fullText を使う**ハイブリッド方式。

## 4. 設計上の問題 🟡

### 4.1 `getTranscriptWithSpeakerLabels()` の設計
- 関数が `recording.transcript` にハードコードされており、表示モード（original/corrected）を考慮しない
- ✅ Good: speaker 情報の有無を事前にチェックしてフォールバックしている

### 4.2 correctedTranscript の segments と fullText の不整合
- LLM 補正は fullText に対して行われるが、segments は元のまま
- segments.text はオリジナル、fullText は補正版という不整合な状態
- 将来的には segments 単位で LLM 補正するか、補正後に segments を再構築する改善が望ましい

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係
```
Issue #120 (話者ラベルコピー) ──→ Issue #121 (モバイルUI) [なし: 独立]
Issue #120 (話者ラベルコピー) ──→ Issue #124 (要約テンプレ) [なし: 独立]
```
→ 3件すべて並行作業可能

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| `getTranscriptWithSpeakerLabels()` | `recording.transcript.segments` | Low | 引数で対象 transcript を指定可能に |
| コピーボタン onClick | 上記関数 | Low | 関数シグネチャ変更の反映 |
| `correctedTranscript.segments` | `transcriptCorrectionService.ts` | None | 既に元 segments をコピー済 |

## 6. ブラウザ / 環境互換性リスク

該当なし（純粋な JavaScript ロジックの修正のため）

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0）

**修正箇所**: `web/src/app/recording/page.tsx`

#### 修正 A: `getTranscriptWithSpeakerLabels()` を拡張

```typescript
// 話者ラベル付きテキストを生成
const getTranscriptWithSpeakerLabels = (useCorrectView?: boolean) => {
    const targetTranscript = useCorrectView 
      ? recording?.correctedTranscript 
      : recording?.transcript;
    
    if (!targetTranscript?.segments || targetTranscript.segments.length === 0) {
      return targetTranscript?.fullText || "";
    }
    
    // segments に speaker 情報があるか確認
    const hasSpeakerInfo = targetTranscript.segments.some(seg => seg.speaker);
    if (!hasSpeakerInfo) {
      return targetTranscript.fullText;
    }

    // corrected の場合: segments の speaker + fullText のテキスト
    // (segments.text は補正前なので fullText を使いたいが、1対1対応が困難)
    // → segments の speaker + segments.text で話者ラベル付きテキストを生成
    //   (corrected の fullText は補正済みだが speaker 付与が困難なため、
    //    元 segments の text + speaker を使用。ユーザーの主要ニーズは
    //    「誰が何を言ったか」であり、これで十分)
    return targetTranscript.segments
      .map((seg) => {
        const label = seg.speaker || t("unknownSpeaker");
        return `[${label}] ${seg.text}`;
      })
      .join("\n");
};
```

#### 修正 B: コピーボタン onClick の更新

```typescript
onClick={() =>
  handleCopy(
    getTranscriptWithSpeakerLabels(
      transcriptView === "corrected" && !!recording.correctedTranscript
    ),
    "transcript"
  )
}
```

**変更ファイル一覧**:
- `web/src/app/recording/page.tsx`（2箇所: 関数定義 + コピーボタン onClick）

### Phase 2: 設計改善（P1）
- 将来的に LLM 補正時に segments も更新する（別 Issue として切り出し推奨）
- `getTranscriptWithSpeakerLabels` をカスタムフック or ユーティリティ関数に切り出す

## 8. テスト戦略

### 手動テスト
1. 話者識別ONで録音 → 保存 → 詳細画面
2. 「オリジナル」表示 → コピー → 話者ラベルあり ✅
3. 「AI補正版」表示 → コピー → 話者ラベルあり ✅（これが今回の修正対象）
4. 話者識別OFFで録音 → 保存 → 詳細画面
5. 「AI補正版」コピー → 話者ラベルなし（speaker 情報がないのでフォールバック）✅

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | `getTranscriptWithSpeakerLabels()` 引数追加 | 5分 | 関数内部のみ |
| 2 | コピーボタン onClick 更新 | 3分 | recording/page.tsx |
| 3 | ビルド・lint 確認 | 2分 | - |
| 4 | 手動テスト | 5分 | - |
| **合計** | | **15分** | |

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| corrected segments が空の場合 | Low | Medium | null チェック + fullText フォールバック |
| 既存のオリジナル表示への影響 | Very Low | High | デフォルト引数 false で後方互換 |

## 11. 結論

- **最大の問題**: コピーボタンが corrected 表示時に `fullText` を直接使用し、話者ラベルを付与する `getTranscriptWithSpeakerLabels()` を通さないこと
- **推奨修正順序**: 関数引数追加 → コピーボタン更新（2ステップで完了）
- **他 Issue への影響**: なし（完全に独立）
- **判定**: **GO** ✅ — 修正範囲が小さく、リスクも低い。即時実装可能。
