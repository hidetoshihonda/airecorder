# Issue #76 実装計画書: 一部ページで言語設定が反映されず日本語のまま表示される

## 概要

本計画書は Issue #76 の分析レビュー結果に基づき、全ページの多言語対応を完了するための具体的な実装手順を記載する。

---

## Phase 1: 致命的バグ修正（P0）

### Step 1-1: recording/page.tsx の完全 i18n 対応

#### 1-1-A: メッセージファイルに `RecordingDetail` ネームスペースを追加

**対象ファイル**: `web/messages/ja.json`, `web/messages/en.json`, `web/messages/es.json`

以下のキーを3ファイル全てに追加する：

```json
"RecordingDetail": {
  "noRecordingId": "録音IDが指定されていません" / "No recording ID specified" / "No se especificó ID de grabación",
  "correctionPending": "⏳ AI補正中..." / "⏳ AI correcting..." / "⏳ Corrección IA...",
  "correctionCompleted": "✨ AI補正済み" / "✨ AI corrected" / "✨ Corregido por IA",
  "correctionFailed": "❌ 補正失敗" / "❌ Correction failed" / "❌ Corrección fallida",
  "unknownSpeaker": "不明" / "Unknown" / "Desconocido",
  "deleteConfirm": "この録音を削除しますか？この操作は取り消せません。" / "Delete this recording? This cannot be undone." / "¿Eliminar esta grabación? No se puede deshacer.",
  "deleteFailed": "削除に失敗しました: {error}" / "Delete failed: {error}" / "Error al eliminar: {error}",
  "titleUpdateFailed": "タイトル更新に失敗しました: {error}" / "Title update failed: {error}" / "Error al actualizar título: {error}",
  "summaryGenerateFailed": "議事録生成に失敗しました: {error}" / "Minutes generation failed: {error}" / "Error al generar acta: {error}",
  "loginRequired": "ログインが必要です" / "Login Required" / "Se requiere inicio de sesión",
  "loginRequiredDescription": "録音の詳細を表示するにはログインしてください。" / "Please log in to view recording details." / "Inicie sesión para ver los detalles de la grabación.",
  "loginButton": "ログイン" / "Log In" / "Iniciar sesión",
  "loading": "読み込み中..." / "Loading..." / "Cargando...",
  "notFound": "録音が見つかりません" / "Recording not found" / "Grabación no encontrada",
  "backToHistory": "履歴に戻る" / "Back to history" / "Volver al historial",
  "export": "エクスポート" / "Export" / "Exportar",
  "exportText": "テキスト (.txt)" / "Text (.txt)" / "Texto (.txt)",
  "exportMarkdown": "マークダウン (.md)" / "Markdown (.md)" / "Markdown (.md)",
  "exportJson": "JSON (.json)" / "JSON (.json)" / "JSON (.json)",
  "loadingAudio": "音声を読み込み中..." / "Loading audio..." / "Cargando audio...",
  "audioNotSupported": "お使いのブラウザは音声再生をサポートしていません。" / "Your browser does not support audio playback." / "Su navegador no admite la reproducción de audio.",
  "downloadFailed": "ダウンロードに失敗しました" / "Download failed" / "Error en la descarga",
  "download": "ダウンロード" / "Download" / "Descargar",
  "audioLoadFailed": "音声ファイルを読み込めませんでした" / "Failed to load audio file" / "No se pudo cargar el archivo de audio",
  "transcriptTab": "文字起こし" / "Transcript" / "Transcripción",
  "translationTab": "翻訳" / "Translation" / "Traducción",
  "minutesTab": "議事録" / "Minutes" / "Acta",
  "transcript": "文字起こし" / "Transcript" / "Transcripción",
  "original": "オリジナル" / "Original" / "Original",
  "aiCorrected": "AI補正版" / "AI Corrected" / "Corregido por IA",
  "copy": "コピー" / "Copy" / "Copiar",
  "correctionProcessing": "AI補正処理中です..." / "AI correction in progress..." / "Corrección IA en proceso...",
  "originalTranscript": "オリジナルの文字起こし：" / "Original transcript:" / "Transcripción original:",
  "noTranscript": "文字起こしデータがありません" / "No transcript data" / "Sin datos de transcripción",
  "translation": "翻訳" / "Translation" / "Traducción",
  "noTranslation": "翻訳データがありません" / "No translation data" / "Sin datos de traducción",
  "cautionNotes": "⚠️ 注意事項" / "⚠️ Notes" / "⚠️ Notas",
  "meetingName": "会議名:" / "Meeting Name:" / "Nombre de la reunión:",
  "dateTime": "日時:" / "Date/Time:" / "Fecha/Hora:",
  "participants": "参加者:" / "Participants:" / "Participantes:",
  "unknown": "不明" / "Unknown" / "Desconocido",
  "purpose": "目的:" / "Purpose:" / "Propósito:",
  "background": "背景・前提:" / "Background:" / "Antecedentes:",
  "currentStatus": "現状共有:" / "Current Status:" / "Estado actual:",
  "issues": "課題/懸念:" / "Issues/Concerns:" / "Problemas/Preocupaciones:",
  "discussionPoints": "議論の要点:" / "Discussion Points:" / "Puntos de discusión:",
  "examples": "具体例:" / "Examples:" / "Ejemplos:",
  "nextActions": "次アクション:" / "Next Actions:" / "Próximas acciones:",
  "regenerate": "再生成" / "Regenerate" / "Regenerar",
  "outputLanguage": "出力言語" / "Output Language" / "Idioma de salida",
  "template": "テンプレート" / "Template" / "Plantilla",
  "selectTemplate": "テンプレートを選択" / "Select template" / "Seleccionar plantilla",
  "emptyMinutesWithTranscript": "「AIで生成」ボタンをクリックして議事録を作成できます" / "Click \"Generate with AI\" to create minutes" / "Haga clic en \"Generar con IA\" para crear acta",
  "emptyMinutesNoTranscript": "文字起こしデータがないため議事録を生成できません" / "Cannot generate minutes without transcript data" / "No se puede generar acta sin datos de transcripción",
  "regenerateTitle": "議事録を再生成" / "Regenerate Minutes" / "Regenerar acta",
  "regenerateDescription": "テンプレートと出力言語を選択してください" / "Select template and output language" / "Seleccione plantilla e idioma de salida",
  "cancel": "キャンセル" / "Cancel" / "Cancelar",
  "regenerateButton": "再生成する" / "Regenerate" / "Regenerar",
  "templateSummary": "要約" / "Summary" / "Resumen",
  "templateMeeting": "会議" / "Meeting" / "Reunión",
  "templateOneOnOne": "1on1" / "1-on-1" / "1 a 1",
  "templateSales": "商談・営業" / "Sales" / "Ventas",
  "templateDevSprint": "開発MTG" / "Dev/Sprint" / "Dev/Sprint",
  "templateBrainstorm": "ブレスト" / "Brainstorm" / "Lluvia de ideas",
  "templateGeneral": "一般" / "General" / "General",
  "templateRegular": "定例会議" / "Regular Meeting" / "Reunión regular",
  "templateTechReview": "技術レビュー" / "Tech Review" / "Revisión técnica",
  "templateSummaryDesc": "シンプルな要約" / "Simple summary" / "Resumen simple",
  "templateMeetingDesc": "詳細な議事録" / "Detailed minutes" / "Acta detallada",
  "templateOneOnOneDesc": "1on1ミーティング向け" / "For 1-on-1 meetings" / "Para reuniones individuales",
  "templateSalesDesc": "商談・営業会議向け" / "For sales meetings" / "Para reuniones de ventas",
  "templateDevSprintDesc": "スプリントレビュー向け" / "For sprint reviews" / "Para revisiones de sprint",
  "templateBrainstormDesc": "アイデア出し・ブレスト向け" / "For brainstorming" / "Para lluvias de ideas",
  "templateGeneralDesc": "汎用的な議事録" / "General purpose minutes" / "Acta de propósito general",
  "templateRegularDesc": "進捗確認・定例" / "Progress check / regular" / "Progreso / regular",
  "templateTechReviewDesc": "技術検討・レビュー" / "Technical review" / "Revisión técnica"
}
```

#### 1-1-B: recording/page.tsx の書き換え

**対象ファイル**: `web/src/app/recording/page.tsx`

1. `import { useTranslations } from "next-intl";` を追加
2. `import { useLocale } from "@/contexts/I18nContext";` を追加（まだなければ）
3. コンポーネント内で `const t = useTranslations("RecordingDetail");` を宣言
4. `const { locale } = useLocale();` を宣言
5. L80: `"ja-JP"` → `locale` を使用した動的ロケール
6. L127-151: テンプレート名/説明のハードコード → `t("templateSummary")` 等に置換
7. L163〜L920: 全ハードコード日本語を対応する `t("key")` に置換

---

### Step 1-2: privacy/page.tsx の i18n 対応

#### 1-2-A: メッセージファイルに `PrivacyPage` ネームスペースを追加

**対象ファイル**: `web/messages/ja.json`, `web/messages/en.json`, `web/messages/es.json`

プライバシーポリシーの全セクション（はじめに、第1条〜等）を各言語で追加。

#### 1-2-B: privacy/page.tsx の書き換え

**対象ファイル**: `web/src/app/privacy/page.tsx`

1. `useTranslations("PrivacyPage")` を使用するように書き換え
2. 全ハードコード日本語を `t("key")` に置換

---

### Step 1-3: terms/page.tsx の i18n 対応

#### 1-3-A: メッセージファイルに `TermsPage` ネームスペースを追加

Step 1-2 と同様の手順。

#### 1-3-B: terms/page.tsx の書き換え

Step 1-2-B と同様の手順。

---

## Phase 2: 設計改善（P1）

### Step 2-1: es.json のキー名統一

**対象ファイル**: `web/messages/es.json`

`SettingsPage` セクションのキー名を ja.json / en.json に合わせる：

| 変更前（es.json） | 変更後 |
|-------------------|--------|
| `subtitle` | `description` |
| `defaultInputLanguage` | `defaultInputLang` |
| `defaultTargetLanguage` | `defaultTargetLang` |
| `speakerSettings` | `speakerDiarization` (card title) |
| `speakerSettingsDesc` | `speakerDiarizationDesc` (card desc) |
| `speakerDiarization` | `speakerDiarizationToggle` |
| `speakerDiarizationDesc` | `speakerDiarizationToggleDesc` |
| `speakerWarningTitle` | `speakerNotes` |
| `speakerWarning1` | `speakerNote1` |
| `speakerWarning2` | `speakerNote2` |
| `speakerWarning3` | `speakerNote3` |
| `appearanceSettings` | `appearance` |
| `appearanceSettingsDesc` | `appearanceDesc` |
| (欠落) | `saving: "Guardando..."` を追加 |

---

### Step 2-2: page.tsx（ホーム）の議事録表示 i18n 対応

**対象ファイル**: `web/src/app/page.tsx`, `web/messages/ja.json`, `web/messages/en.json`, `web/messages/es.json`

1. `HomePage` ネームスペースに議事録表示用キーを追加：
   - `cautionNotes`, `meetingName`, `dateTime`, `participants`, `purpose`
   - `background`, `currentStatus`, `issues`, `discussionPoints`, `examples`, `nextActions`

2. page.tsx の議事録表示部分（L1116-1163 付近）のハードコード日本語を `t("key")` に置換

---

### Step 2-3: サービス層のエラーメッセージ国際化

**対象ファイル**: 
- `web/src/services/templatesApi.ts`
- `web/src/services/settingsApi.ts`
- `web/src/services/summaryApi.ts`

**方針**: サービス層ではエラーコード（英語キー文字列）を返し、UIコンポーネント側で翻訳する。

**変更内容**:
1. `"認証が必要です"` → `"auth_required"` に変更
2. `"認証が必要です。ログインしてください。"` → `"auth_required_login"` に変更
3. `"サーバーからの応答を解析できませんでした: "` → `"server_parse_error"` に変更
4. エラーを表示するコンポーネント側で、エラーコードをメッセージファイルのキーにマッピング

**メッセージファイルに追加**:
```json
"Errors": {
  "auth_required": "認証が必要です" / "Authentication required" / "Se requiere autenticación",
  "auth_required_login": "認証が必要です。ログインしてください。" / "Authentication required. Please log in." / "Se requiere autenticación. Inicie sesión.",
  "server_parse_error": "サーバーからの応答を解析できませんでした: {detail}" / "Could not parse server response: {detail}" / "No se pudo analizar la respuesta del servidor: {detail}"
}
```

---

## Phase 3: 堅牢性強化（P2）

### Step 3-1: export.ts のロケール対応

**対象ファイル**: `web/src/lib/export.ts`

1. `exportAsText()`, `exportAsMarkdown()`, `exportAsJson()` にロケール引数を追加
2. メッセージファイルに `Export` ネームスペースを追加
3. 日付フォーマットのロケールを動的化
4. ラベル文字列を翻訳済みテキストに置換

**呼び出し元の更新**:
- `recording/page.tsx` のエクスポート呼び出し箇所にロケールを渡す
- `page.tsx` のエクスポート呼び出し箇所にロケールを渡す（存在する場合）

---

## ビルド・検証手順

各 Phase 完了後に以下を実行：

```bash
cd web && npm run build
```

- ビルドエラーがないことを確認
- 全3言語で対象ページを目視確認
- 翻訳キーの欠落警告がコンソールに出ていないことを確認

---

## PR 戦略

Phase ごとに PR を分けることを推奨：

| PR | 内容 | ブランチ名 |
|----|------|-----------|
| PR-A | Phase 1: recording, privacy, terms の i18n 対応 | `fix/issue-76-i18n-critical` |
| PR-B | Phase 2: es.json 統一 + page.tsx 議事録 + エラーメッセージ | `fix/issue-76-i18n-design` |
| PR-C | Phase 3: export.ts ロケール対応 | `fix/issue-76-i18n-export` |

もしくは、全体を1つの PR にまとめても可（変更量は多いがリスクは低い）。
