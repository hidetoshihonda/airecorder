# Issue #105: リアルタイム翻訳の表示制限 実装計画書

## 概要

リアルタイム翻訳の表示を最新N文に制限し、原文セクションを折りたたみ化することで、長時間録音時のスクロール問題を解消する。

---

## 現状分析

### 現在のフロー

```
[差分翻訳ロジック] → accumulatedTranslationRef + interimPart
                     → setTranslatedText(全文string)
                     → <div>{translatedText}</div>  ← 全文が1つのdivに展開
```

### 問題点

| 問題 | 影響 |
|------|------|
| 翻訳テキストが全文表示され際限なく伸びる | 30分会議で手動スクロール必須 |
| 翻訳 + 原文が同一スクロールコンテナ内 | スクロール量が約2倍 |
| 録音中に最新翻訳が画面外に消える | リアルタイム翻訳の利便性が損なわれる |

---

## Phase 1: 即時対応（工数: 約50分）

### 1. 最新N文表示ユーティリティ関数の追加

**ファイル**: `web/src/app/page.tsx`

翻訳表示用のヘルパー関数を追加する。ページ内のローカル関数として定義。

```typescript
/**
 * テキストを文区切りで分割し、最新の N 文のみ返す。
 * 全文データは translatedText state に保持されたまま。
 */
function getRecentSentences(text: string, count: number = 5): string {
  if (!text) return "";
  // 日本語句点(。)、英語ピリオド(.)、!?で区切り
  const sentences = text.split(/(?<=[。.!?！？])\s*/g).filter(Boolean);
  if (sentences.length <= count) return text;
  return "…" + sentences.slice(-count).join(" ");
}
```

### 2. 翻訳タブの表示改善

**ファイル**: `web/src/app/page.tsx` L950-1007

#### 2.1 翻訳テキスト: 録音中は最新5文のみ表示

**変更前** (L972-974):
```tsx
<div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-gray-800">
  {translatedText}
</div>
```

**変更後**:
```tsx
<div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-gray-800">
  {showRecordingUI ? getRecentSentences(translatedText, 5) : translatedText}
</div>
```

#### 2.2 原文セクション: `<details>` で折りたたみ化

**変更前** (L976-1003):
```tsx
<div>
  <div className="flex items-center justify-between mb-1">
    <p className="text-sm text-gray-500">{t("sourceLabel", { ... })}</p>
    ...
  </div>
  {enableSpeakerDiarization ? <TranscriptView .../> : <div>{transcript}</div>}
</div>
```

**変更後**:
```tsx
<details className="group">
  <summary className="flex items-center justify-between mb-1 cursor-pointer list-none">
    <p className="text-sm text-gray-500 flex items-center gap-1">
      {t("sourceLabel", { language: ... })}
      <span className="text-xs group-open:rotate-180 transition-transform">▼</span>
    </p>
    <Button variant="ghost" size="sm" onClick={() => handleSpeak(transcript, sourceLanguage)} ...>
      ...
    </Button>
  </summary>
  <div className="mt-2">
    {enableSpeakerDiarization ? <TranscriptView .../> : <div>{transcript}</div>}
  </div>
</details>
```

### 3. 翻訳表示モード切り替え（オプション）

録音中に「全文表示」と「最新のみ表示」を切り替えるトグルを追加。

**新規state**:
```typescript
const [translationDisplayMode, setTranslationDisplayMode] = 
  useState<"recent" | "full">("recent");
```

**UIトグル** (翻訳タブのCardHeader内):
```tsx
{showRecordingUI && translatedText && (
  <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer">
    <input
      type="checkbox"
      checked={translationDisplayMode === "full"}
      onChange={(e) => setTranslationDisplayMode(e.target.checked ? "full" : "recent")}
      className="sr-only peer"
    />
    <div className="w-7 h-3.5 bg-gray-200 peer-focus:ring-2 peer-focus:ring-blue-300 rounded-full 
         peer peer-checked:after:translate-x-full after:content-[''] after:absolute 
         after:top-[1px] after:left-[1px] after:bg-white after:rounded-full after:h-2.5 
         after:w-2.5 after:transition-all peer-checked:bg-blue-600 relative"></div>
    <span>{t("fullDisplay")}</span>
  </label>
)}
```

**表示ロジック更新**:
```tsx
<div className="whitespace-pre-wrap rounded-md bg-blue-50 p-4 text-gray-800">
  {showRecordingUI && translationDisplayMode === "recent"
    ? getRecentSentences(translatedText, 5) 
    : translatedText}
</div>
```

---

## Phase 2: セグメント単位翻訳への移行（Issue #33 と統合）

Issue #33 の実装計画書を参照。翻訳を `TranslatedSegment[]` 配列で管理し、翻訳タブでも `TranscriptView` コンポーネントを再利用する。

これにより:
- 翻訳セグメントも文字起こしと同様の自動追従・表示制限が自動的に適用
- 話者ラベル付き翻訳表示が可能
- `getRecentSentences` は不要になる（TranscriptView の segments 配列で最新N件表示）

---

## 変更ファイル一覧

### Phase 1

| ファイル | 変更内容 | 変更規模 |
|---------|---------|---------|
| `web/src/app/page.tsx` | getRecentSentences追加、翻訳表示制限、原文折りたたみ、表示モードトグル | 中 |
| `web/messages/ja.json` | `"fullDisplay": "全文表示"` 追加 | 小 |
| `web/messages/en.json` | `"fullDisplay": "Show all"` 追加 | 小 |
| `web/messages/es.json` | `"fullDisplay": "Mostrar todo"` 追加 | 小 |

### Phase 2 (Issue #33)

| ファイル | 変更内容 | 変更規模 |
|---------|---------|---------|
| `web/src/hooks/useTranslation.ts` | translateSegment, translatedSegments 追加 | 大 |
| `web/src/app/page.tsx` | セグメント差分翻訳、TranscriptView 再利用 | 大 |
| `web/src/types/index.ts` | TranslatedSegment 型追加 | 小 |

---

## 実装ステップ

### Phase 1

| Step | 作業内容 | 見積り |
|------|---------|--------|
| 1 | `getRecentSentences` ユーティリティ関数を page.tsx に追加 | 10分 |
| 2 | 翻訳テキスト表示を `showRecordingUI` 時に最新5文に制限 | 10分 |
| 3 | 原文セクションを `<details>` で折りたたみ化 | 15分 |
| 4 | `translationDisplayMode` state + トグルUI 追加 | 10分 |
| 5 | i18n メッセージ追加 (ja/en/es) | 5分 |
| 6 | 動作確認・デバッグ | 15分 |
| **合計** | | **約65分** |

### Phase 2 (Issue #33)

Issue #33 実装計画書参照。約3時間。

---

## テスト観点

| テストケース | 確認内容 |
|------------|---------|
| 録音中 + RT翻訳 ON（短文） | 5文以下: 全文表示（「…」なし） |
| 録音中 + RT翻訳 ON（長文） | 6文以上: 「…」+ 最新5文のみ表示 |
| 録音停止後 | 全文翻訳が全文表示される |
| 原文セクション折りたたみ | デフォルト非表示、クリックで展開 |
| 「全文表示」トグル ON | 録音中でも全文が表示される |
| 「全文表示」トグル OFF | 最新5文に戻る |
| 日本語テキスト | 「。」で正しく区切られる |
| 英語テキスト | 「.」「!」「?」で正しく区切られる |
| 話者識別 ON | 原文セクションで TranscriptView が正しく表示 |
| オートスクロール | 表示制限後もオートスクロールが機能する |

---

## リスクと対策

| リスク | 確率 | 対策 |
|--------|------|------|
| 文区切りが言語によって不正確 | 中 | 区切りパターンを拡張可能に設計。5文は保守的な数 |
| `<details>` のスタイルがブラウザで異なる | 低 | `list-none` + Tailwind で統一化 |
| 全文表示トグルの追加で UI が煩雑に | 低 | 録音中のみ表示。小さなトグルで目立たない |
| Phase 2 移行時に Phase 1 のコードが不要に | 確実 | Phase 1 は暫定対応と明示。Phase 2 で `getRecentSentences` を削除 |
