# Issue #38: 録音詳細画面の議事録生成にテンプレート選択機能を追加 — 分析レビュー

**レビュー日**: 2026-02-10  
**レビュアー**: ReviewAAgent

---

## 1. エグゼクティブサマリー

- **問題の本質**: 録音詳細画面（`/recording?id=xxx`）の `handleGenerateSummary` が `templateId` / `customPrompt` / `language` を API に渡しておらず、常にデフォルト設定で議事録が生成される
- **影響範囲**: 履歴から詳細画面を開いて議事録を再生成する全ユーザー（100%）に影響
- **修正の緊急度**: **Medium** — 機能欠損だが、メイン画面からの新規生成は正常動作

---

## 2. アーキテクチャ概観

### 2.1 コンポーネント依存関係

```
/recording?id=xxx (RecordingDetailPage)
├── summaryApi.generateSummary()  ← 問題箇所: パラメータ不足
├── recordingsApi.updateRecording()
└── blobApi.getPlayableUrl()

/page.tsx (メイン録音画面) ← 正常実装の参考
├── selectedTemplateId state
├── summaryLanguage state
├── allTemplates (PRESET + custom)
└── summaryApi.generateSummary({ templateId, customPrompt, language })
```

### 2.2 データフロー（現状 vs 期待）

**現状（詳細画面）**:
```
「AIで生成」ボタン押下
    ↓
summaryApi.generateSummary({
  transcript: recording.transcript.fullText,
  language: recording.sourceLanguage,    // ← 音声言語固定
  // templateId: なし ❌
  // customPrompt: なし ❌
})
    ↓
常にデフォルト（general）テンプレートで生成
```

**期待（修正後）**:
```
テンプレート選択 & 出力言語選択
    ↓
「AIで生成」ボタン押下
    ↓
summaryApi.generateSummary({
  transcript: ...,
  language: selectedLanguage,      // ← ユーザー選択
  templateId: selectedTemplateId,  // ← ユーザー選択
  customPrompt: ...,               // ← カスタムテンプレート時
})
```

---

## 3. 重大バグ分析 🔴

### BUG-1: handleGenerateSummary のパラメータ不足 [High]

**場所**: [recording/page.tsx#L198-L218](../src/app/recording/page.tsx#L198)

**コード**:
```typescript
const handleGenerateSummary = async () => {
  if (!id || !recording?.transcript?.fullText) return;

  setIsGeneratingSummary(true);

  const response = await summaryApi.generateSummary({
    transcript: recording.transcript.fullText,
    language: recording.sourceLanguage,  // ← 固定値
    // templateId 欠落
    // customPrompt 欠落
  });
  // ...
};
```

**問題**: 
- `templateId` が渡されないため、API はデフォルトの `general` テンプレートを使用
- `customPrompt` が渡されないため、カスタムテンプレートが無効
- `language` が `recording.sourceLanguage`（音声言語）固定で、出力言語を選択できない

**影響**: 
- 定例ミーティング、1on1 等の用途別テンプレートが詳細画面から利用不可
- カスタムテンプレートが詳細画面で完全に無効
- 出力言語を変更できない（例: 日本語音声 → 英語議事録）

**根本原因**: 
メイン画面（`page.tsx`）実装時に詳細画面への展開を考慮しなかった設計漏れ

**修正方針**:
```typescript
// 1. state 追加
const [selectedTemplateId, setSelectedTemplateId] = useState<TemplateId>("general");
const [summaryLanguage, setSummaryLanguage] = useState(recording?.sourceLanguage || "ja-JP");

// 2. handleGenerateSummary 修正
const response = await summaryApi.generateSummary({
  transcript: recording.transcript.fullText,
  language: summaryLanguage,
  templateId: selectedTemplateId,
  ...(selectedTemplateId.startsWith("custom-")
    ? { customPrompt: getTemplateById(selectedTemplateId)?.systemPrompt }
    : {}),
});
```

---

### BUG-2: テンプレート選択 UI の欠如 [High]

**場所**: [recording/page.tsx#L517-L541](../src/app/recording/page.tsx#L517) （議事録タブ）

**問題**: 
- 議事録タブに「AIで生成」ボタンはあるが、テンプレート・言語選択 UI がない
- メイン画面（`page.tsx` L920-980）には実装済み

**影響**: ユーザーは詳細画面からテンプレートを選択する方法がない

**修正方針**: 実装計画書の 4.5 節に従い、テンプレート選択グリッドを追加

---

## 4. 設計上の問題 🟡

### DESIGN-1: テンプレート選択 UI のコード重複 [Medium]

**問題**: 
- メイン画面（`page.tsx` L920-980）と詳細画面で同一のテンプレート選択 UI が必要
- 実装計画書では「本 Issue ではまず機能実装を優先」とあるが、将来的に `<TemplatePicker />` として共通化すべき

**対策**: 
- 本 Issue ではコピー実装を許容
- 後続 Issue で共通コンポーネント化を検討

### DESIGN-2: i18n 非対応（詳細画面） [Low]

**問題**: 
- `recording/page.tsx` は日本語ハードコード
- メイン画面は `next-intl` 使用（`useTranslations`）
- テンプレート名の表示方法が異なる

**対策**: 
- 実装計画書の方針に従い、本 Issue では既存と同じハードコード方針
- 別 Issue で全体 i18n 化

### DESIGN-3: summaryLanguage の初期化タイミング [Low]

**問題**: 
- `recording` は非同期でロードされるため、初期値設定に注意が必要
- `useState(recording?.sourceLanguage)` では `recording` が `null` の場合に不正

**対策**: 
```typescript
const [summaryLanguage, setSummaryLanguage] = useState("ja-JP");

useEffect(() => {
  if (recording) {
    setSummaryLanguage(recording.sourceLanguage);
  }
}, [recording]);
```

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #38 (本Issue)
    └── 依存なし（独立して実装可能）

Issue #32 (カスタムテンプレート Cosmos DB 移行)
    └── 本Issue完了後に実施推奨（UIが先にあると移行テストしやすい）
```

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| `summaryApi.generateSummary` | 既に `templateId` / `customPrompt` 対応済み | なし | - |
| `PRESET_TEMPLATES` | `meetingTemplates.ts` | なし | import 追加のみ |
| `loadCustomTemplates` | localStorage | localStorage 容量制限 | 将来の #32 で解消 |
| `Select` / UI コンポーネント | `@/components/ui` | なし | 既存コンポーネント |

### 5.3 他 Issue/機能との相互作用

| 関連 Issue | 相互作用 | 対応 |
|-----------|---------|------|
| #32 カスタムテンプレート DB 移行 | `loadCustomTemplates` の実装変更 | 本 Issue では localStorage 版を使用、#32 で差し替え |
| #42 議事録フォーマット品質改善 | テンプレートの systemPrompt 改善 | 独立（本 Issue は UI のみ） |

---

## 6. ブラウザ / 環境互換性リスク

該当なし（フロントエンドのみの変更、新規 Web API 不使用）

---

## 7. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0）

#### Step 1: import 追加
```typescript
// recording/page.tsx の先頭 import に追加
import { useMemo } from "react";
import { TemplateId } from "@/types";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PRESET_TEMPLATES, getTemplateById, loadCustomTemplates, customToMeetingTemplate } from "@/lib/meetingTemplates";
import { cn } from "@/lib/utils";
import { Users, CalendarCheck, Handshake, Code, Lightbulb } from "lucide-react";
```

#### Step 2: state 追加（L63-70 付近）
```typescript
const [selectedTemplateId, setSelectedTemplateId] = useState<TemplateId>("general");
const [summaryLanguage, setSummaryLanguage] = useState("ja-JP");
```

#### Step 3: useEffect で summaryLanguage 同期
```typescript
useEffect(() => {
  if (recording) {
    setSummaryLanguage(recording.sourceLanguage);
  }
}, [recording]);
```

#### Step 4: allTemplates / TEMPLATE_ICONS 生成
```typescript
const allTemplates = useMemo(() => {
  const customs = loadCustomTemplates().map(customToMeetingTemplate);
  return [...PRESET_TEMPLATES, ...customs];
}, []);

const TEMPLATE_ICONS: Record<string, React.ReactNode> = useMemo(() => ({
  FileText: <FileText className="h-4 w-4" />,
  CalendarCheck: <CalendarCheck className="h-4 w-4" />,
  Users: <Users className="h-4 w-4" />,
  Handshake: <Handshake className="h-4 w-4" />,
  Code: <Code className="h-4 w-4" />,
  Lightbulb: <Lightbulb className="h-4 w-4" />,
  PenSquare: <PenSquare className="h-4 w-4" />,
}), []);
```

#### Step 5: handleGenerateSummary 修正
```typescript
const handleGenerateSummary = async () => {
  if (!id || !recording?.transcript?.fullText) return;

  setIsGeneratingSummary(true);

  const response = await summaryApi.generateSummary({
    transcript: recording.transcript.fullText,
    language: summaryLanguage,
    templateId: selectedTemplateId,
    ...(selectedTemplateId.startsWith("custom-")
      ? { customPrompt: getTemplateById(selectedTemplateId)?.systemPrompt }
      : {}),
  });

  setIsGeneratingSummary(false);
  // ... 以下同じ
};
```

#### Step 6: テンプレート選択 UI 追加（議事録タブ CardContent 内）

議事録がまだない場合の表示部分に、テンプレート選択 UI を追加。
詳細は実装計画書の 4.5 節参照。

### Phase 2: 設計改善（P1）

- 共通コンポーネント `<TemplatePicker />` の抽出（別 Issue）

### Phase 3: 堅牢性強化（P2）

- i18n 対応（別 Issue）

---

## 8. テスト戦略

### 単体テスト（推奨）

| テストケース | 期待結果 |
|------------|---------|
| デフォルト（general）で生成 | general テンプレートで生成される |
| regularテンプレートを選択して生成 | 定例会議用フォーマットで生成 |
| カスタムテンプレートを選択して生成 | customPrompt が API に送信される |
| 出力言語を en-US に変更して生成 | 英語で議事録が出力される |
| 文字起こしデータなしの場合 | テンプレート選択 UI は非表示 |

### 手動テスト

| 操作 | 確認項目 |
|------|---------|
| 詳細画面 → テンプレート選択 → 生成 | 選択テンプレートが反映される |
| 出力言語変更 → 生成 | 選択言語で出力される |
| 再生成ボタン | テンプレート・言語設定が引き継がれる |
| カスタムテンプレートの表示 | settings で作成したカスタムテンプレートが一覧に表示される |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | import・state・useMemo 追加 | 10 分 | recording/page.tsx |
| 2 | handleGenerateSummary 修正 | 10 分 | recording/page.tsx |
| 3 | テンプレート選択 UI 追加 | 20 分 | recording/page.tsx |
| 4 | テスト・動作確認 | 20 分 | - |
| **合計** | | **1 時間** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| i18n キー不整合（nameKey がそのまま表示） | 中 | Low | プリセットはハードコード or フォールバック表示 |
| recording が null 時の summaryLanguage 初期化 | 低 | Low | useEffect で同期 |
| テンプレート選択 UI のスペース圧迫 | 低 | Low | 折りたたみパネル化も検討可能 |

---

## 11. 結論

### 最大の問題点
- `handleGenerateSummary` が `templateId` / `customPrompt` / `language` を送信していない（**BUG-1**）
- テンプレート選択 UI が詳細画面に存在しない（**BUG-2**）

### 推奨する修正順序
1. import・state 追加
2. handleGenerateSummary 修正
3. テンプレート選択 UI 追加
4. 動作確認

### 他 Issue への影響
- #32（カスタムテンプレート DB 移行）: 本 Issue 完了後に実施推奨（UI が先にあるとテストしやすい）
- 他 Issue への影響なし

### 判定: **GO** ✅

実装計画書の内容は妥当であり、実装可能です。  
API は既に `templateId` / `customPrompt` / `language` に対応済みのため、フロントエンドのみの変更で完結します。

---

## 良い設計判断 ✅ Good

1. **API の事前対応**: `summaryApi.generateSummary` が既に全パラメータに対応しており、フロントエンド修正のみで完結
2. **メイン画面での実績あるUI**: テンプレート選択 UI はメイン画面で実装・検証済みであり、同じパターンを適用可能
3. **段階的な改善方針**: i18n・共通コンポーネント化は別 Issue に分離し、本 Issue は機能実装に集中
