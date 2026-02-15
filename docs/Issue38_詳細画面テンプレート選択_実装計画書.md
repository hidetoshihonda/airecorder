# Issue #38: 録音詳細画面の議事録生成にテンプレート選択を追加 — 実装計画書

## 1. 概要

### 現状の問題
履歴から録音詳細ページ（`/recording?id=xxx`）に遷移すると、議事録タブに「AIで生成」ボタンがあるが、テンプレートや出力言語を選択する UI がない。
- `handleGenerateSummary` で `templateId` / `customPrompt` / `language` を渡していない
- メイン録音画面（`page.tsx`）にはテンプレート選択 + 出力言語セレクトが既にあるが、詳細画面には未実装
- 結果として、詳細画面から再生成すると常にデフォルト（general テンプレート、音声言語固定）で生成される

### 目標
- 録音詳細画面の議事録タブに、メイン画面と同等のテンプレート選択 UI を追加
- 出力言語セレクターも追加
- API へ `templateId` / `customPrompt` / `language` を正しく送信

## 2. アーキテクチャ設計

### 現状のデータフロー（詳細画面）
```
「AIで生成」ボタン押下
    ↓
summaryApi.generateSummary({
  transcript: recording.transcript.fullText,
  language: recording.sourceLanguage,    // ← 固定
  // templateId なし
  // customPrompt なし
})
    ↓
議事録表示 + Cosmos DB 更新
```

### 変更後のデータフロー
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
    ↓
議事録表示 + Cosmos DB 更新
```

## 3. 変更対象ファイル

| ファイル | 変更内容 |
|---------|---------|
| `web/src/app/recording/page.tsx` | テンプレート選択 UI・出力言語セレクト追加、handleGenerateSummary 修正 |

## 4. 実装詳細

### 4.1 import 追加

```typescript
import { useMemo } from "react";  // 既存の import に追加
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
// Lucide icons 追加: Users, CalendarCheck, Handshake, Code, Lightbulb, PenSquare
```

### 4.2 新規 state 追加

```typescript
const [selectedTemplateId, setSelectedTemplateId] = useState<TemplateId>("general");
const [summaryLanguage, setSummaryLanguage] = useState(recording?.sourceLanguage || "ja-JP");
```

※ `summaryLanguage` は `recording` ロード後に初期化するため、`useEffect` での同期も必要：
```typescript
useEffect(() => {
  if (recording) {
    setSummaryLanguage(recording.sourceLanguage);
  }
}, [recording]);
```

### 4.3 テンプレート一覧の生成

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

### 4.4 handleGenerateSummary の修正

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

  if (response.error) {
    alert(`議事録生成に失敗しました: ${response.error}`);
  } else if (response.data) {
    const updateResponse = await recordingsApi.updateRecording(id, {
      summary: response.data,
    });
    if (updateResponse.data) {
      setRecording(updateResponse.data);
    }
  }
};
```

### 4.5 テンプレート選択 UI の追加

議事録タブの `CardContent` 内、「AIで生成」ボタンの下（議事録がまだない場合）にテンプレート選択 UI を追加。
メイン画面のテンプレート選択 UI と同じレイアウトを使用する。

```tsx
{/* テンプレート選択 & 出力言語（議事録未生成 & 生成中でない場合） */}
{recording.transcript?.fullText && !isGeneratingSummary && (
  <div className="mb-4 space-y-3">
    {/* 出力言語 */}
    <div className="flex items-center gap-2">
      <label className="text-sm font-medium text-gray-700 whitespace-nowrap">
        出力言語
      </label>
      <Select value={summaryLanguage} onValueChange={setSummaryLanguage}>
        <SelectTrigger className="h-8 w-44 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {SUPPORTED_LANGUAGES.map((lang) => (
            <SelectItem key={lang.code} value={lang.code}>
              {lang.flag} {lang.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>

    {/* テンプレート選択グリッド */}
    <label className="text-sm font-medium text-gray-700 mb-2 block">
      テンプレート
    </label>
    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
      {allTemplates.map((tmpl) => (
        <button
          key={tmpl.id}
          onClick={() => setSelectedTemplateId(tmpl.id)}
          className={cn(
            "flex items-center gap-2 rounded-lg border p-2.5 text-left text-sm transition-colors",
            selectedTemplateId === tmpl.id
              ? "border-blue-500 bg-blue-50 text-blue-800"
              : "border-gray-200 bg-white text-gray-700 hover:border-gray-300 hover:bg-gray-50"
          )}
        >
          {TEMPLATE_ICONS[tmpl.icon] || <FileText className="h-4 w-4" />}
          <div className="min-w-0">
            <div className="font-medium truncate text-xs">{tmpl.nameKey}</div>
            <div className="text-xs text-gray-500 truncate">{tmpl.descriptionKey}</div>
          </div>
        </button>
      ))}
    </div>
  </div>
)}
```

### 4.6 i18n 対応について

現状、`recording/page.tsx` は i18n（`next-intl`）を使用していない（日本語ハードコード）。
本 Issue では既存の画面と同じハードコード方針を維持し、i18n 化は別 Issue として扱う。

ただしプリセットテンプレートの `nameKey` / `descriptionKey` は i18n キーのため、直接表示する場合は
テンプレート名のフォールバック表示を行う（`tmpl.isPreset` の場合はハードコードマッピング、
またはシンプルに `nameKey` をそのまま表示）。

## 5. テスト計画

| テストケース | 期待結果 |
|------------|---------|
| 詳細画面でテンプレート選択 → AIで生成 | 選択したテンプレートで議事録生成される |
| 出力言語を変更 → 生成 | 選択した言語で議事録が出力される |
| カスタムテンプレートが表示される | settings で作成したカスタムテンプレートも一覧に含まれる |
| 再生成ボタンでも適用される | テンプレート・言語の変更が再生成にも反映される |
| テンプレート未選択（デフォルト）で生成 | general テンプレートで生成される |
| 文字起こしデータなしの場合 | テンプレート選択 UI は表示されない |

## 6. 見積もり

| 作業 | 見積もり |
|------|---------|
| import・state・useMemo 追加 | 10 分 |
| handleGenerateSummary 修正 | 10 分 |
| テンプレート選択 UI 追加 | 20 分 |
| テスト・動作確認 | 20 分 |
| **合計** | **1 時間** |

## 7. リスク

| リスク | 影響度 | 対策 |
|--------|--------|------|
| i18n キーの不整合（`nameKey` がそのまま表示される） | Medium | プリセットの場合はハードコードマッピング or フォールバック表示 |
| recording が null の段階で summaryLanguage 初期化 | Low | useEffect で recording ロード後に同期 |
| テンプレート選択 UI のスペース圧迫 | Low | 折りたたみパネル化も検討可能 |

## 8. メイン画面との UI 共通化

現時点ではメイン画面と詳細画面でテンプレート選択 UI のコードが重複するが、
共通コンポーネント化（`<TemplatePicker />`）は将来のリファクタリング Issue として扱う。
本 Issue ではまず機能実装を優先する。
