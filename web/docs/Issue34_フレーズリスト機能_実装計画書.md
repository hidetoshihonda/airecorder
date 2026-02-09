# Issue #34: フレーズリスト機能 実装計画書

## 概要

Azure Speech SDK の `PhraseListGrammar` を活用し、ユーザーが頻出する固有名詞・専門用語を事前登録できるようにする。モデル変更不要、コスト ¥0 で音声認識精度を向上させる。

## 現状分析

### 現在の音声認識の仕組み

```
マイク → [SpeechConfig] → SpeechRecognizer / ConversationTranscriber → テキスト
                ↑
           言語設定のみ
```

- `SpeechConfig.fromSubscription(key, region)` で初期化
- `speechRecognitionLanguage` を設定
- **フレーズリストは未設定**（SDK 標準モデルのみ）

### 問題点

- 固有名詞（社名、人名、製品名）が誤認識される
- 専門用語（業界用語、略語）が別の一般語として認識される
- 例: 「AIrecorder」→「AIレコーダー」、「Cosmos DB」→「コスモスディービー」

### PhraseListGrammar とは

Azure Speech SDK のクライアント側機能で、認識時に優先すべきフレーズを指定する：
- サーバー側のモデルに一時的にヒントを送信
- カスタムモデル（Custom Speech）より手軽
- コスト追加なし
- 最大 500 フレーズまで登録可能

## 設計

### 1. UserSettings の拡張

```typescript
// types/index.ts
export interface UserSettings {
  defaultSourceLanguage: string;
  defaultTargetLanguages: string[];
  autoSaveRecordings: boolean;
  noiseSuppression: boolean;
  theme: "light" | "dark" | "system";
  audioQuality: "low" | "medium" | "high";
  enableSpeakerDiarization: boolean;
  phraseList: string[];              // ← 追加
}
```

### 2. AuthContext のデフォルト設定

```typescript
// contexts/AuthContext.tsx
const defaultSettings: UserSettings = {
  // ... 既存
  phraseList: [],  // ← 追加
};
```

### 3. useSpeechRecognition への適用

#### SpeechRecognizer モード

```typescript
// hooks/useSpeechRecognition.ts
interface UseSpeechRecognitionOptions {
  subscriptionKey: string;
  region: string;
  language?: string;
  enableSpeakerDiarization?: boolean;
  sharedStream?: MediaStream | null;
  phraseList?: string[];              // ← 追加
}

// startListening() 内の SpeechRecognizer 作成後:
const recognizer = new SpeechSDK.SpeechRecognizer(speechConfig, audioConfig);

// フレーズリスト適用
if (options.phraseList && options.phraseList.length > 0) {
  const phraseListGrammar = SpeechSDK.PhraseListGrammar.fromRecognizer(recognizer);
  for (const phrase of options.phraseList) {
    phraseListGrammar.addPhrase(phrase);
  }
}
```

#### ConversationTranscriber モード

```typescript
// startConversationTranscriber() 内:
const transcriber = new SpeechSDK.ConversationTranscriber(speechConfig, audioConfig);

// ConversationTranscriber には PhraseListGrammar が直接使えない場合がある
// → SpeechConfig.setProfanity() や setProperty() でワークアラウンド
// → 要検証: PhraseListGrammar.fromRecognizer() が ConversationTranscriber を受け付けるか
```

**検証ポイント**: `PhraseListGrammar.fromRecognizer()` は `SpeechRecognizer` 型を期待するため、`ConversationTranscriber` で利用可能かを検証する必要がある。利用不可の場合は `SpeechConfig` レベルでの設定（`setProperty` でフレーズリスト JSON を送信）を検討する。

### 4. page.tsx からフレーズリストを渡す

```typescript
// page.tsx
const {
  // ... 既存
} = useSpeechRecognition({
  subscriptionKey: speechConfig.subscriptionKey,
  region: speechConfig.region,
  language: sourceLanguage,
  enableSpeakerDiarization,
  phraseList: settings.phraseList,  // ← 追加
});
```

### 5. 設定画面のUI

```
┌─────────────────────────────────────────┐
│ 📝 フレーズリスト                         │
│ よく使う単語を登録して認識精度を向上        │
├─────────────────────────────────────────┤
│                                         │
│  ┌─────────────────────────────┐        │
│  │ AIrecorder               ✕ │        │
│  │ Cosmos DB                ✕ │        │
│  │ Azure Functions          ✕ │        │
│  │ スプリントレビュー         ✕ │        │
│  └─────────────────────────────┘        │
│                                         │
│  ┌──────────────────────┐ [追加]        │
│  │ 新しいフレーズを入力    │              │
│  └──────────────────────┘              │
│                                         │
│  ⓘ 最大500フレーズまで登録可能            │
│  ⓘ 固有名詞・専門用語を登録すると         │
│    認識精度が向上します                   │
│                                         │
└─────────────────────────────────────────┘
```

#### 実装詳細

```typescript
// settings/page.tsx に追加するセクション

const [newPhrase, setNewPhrase] = useState("");

const handleAddPhrase = () => {
  const phrase = newPhrase.trim();
  if (!phrase || settings.phraseList.includes(phrase)) return;
  if (settings.phraseList.length >= 500) return; // SDK上限
  updateSettings({ phraseList: [...settings.phraseList, phrase] });
  setNewPhrase("");
};

const handleRemovePhrase = (phrase: string) => {
  updateSettings({
    phraseList: settings.phraseList.filter(p => p !== phrase),
  });
};

// 一括入力（改行区切り）もサポート
const handleBulkAdd = (text: string) => {
  const phrases = text.split("\n").map(p => p.trim()).filter(Boolean);
  const unique = [...new Set([...settings.phraseList, ...phrases])].slice(0, 500);
  updateSettings({ phraseList: unique });
};
```

### 6. i18n 対応

```json
// messages/ja.json → SettingsPage に追加
{
  "phraseList": "フレーズリスト",
  "phraseListDesc": "よく使う単語を登録すると音声認識の精度が向上します",
  "addPhrase": "追加",
  "phrasePlaceholder": "新しいフレーズを入力",
  "phraseLimit": "最大500フレーズまで登録できます",
  "phraseHint": "固有名詞や専門用語を登録すると効果的です",
  "bulkAdd": "一括追加",
  "bulkAddPlaceholder": "改行区切りで複数のフレーズを入力"
}
```

```json
// messages/en.json
{
  "phraseList": "Phrase List",
  "phraseListDesc": "Register frequently used words to improve speech recognition accuracy",
  "addPhrase": "Add",
  "phrasePlaceholder": "Enter a new phrase",
  "phraseLimit": "Up to 500 phrases can be registered",
  "phraseHint": "Proper nouns and technical terms are most effective",
  "bulkAdd": "Bulk Add",
  "bulkAddPlaceholder": "Enter multiple phrases separated by newlines"
}
```

```json
// messages/es.json
{
  "phraseList": "Lista de frases",
  "phraseListDesc": "Registre palabras frecuentes para mejorar la precisión del reconocimiento de voz",
  "addPhrase": "Agregar",
  "phrasePlaceholder": "Ingrese una nueva frase",
  "phraseLimit": "Se pueden registrar hasta 500 frases",
  "phraseHint": "Los nombres propios y términos técnicos son más efectivos",
  "bulkAdd": "Agregar en lote",
  "bulkAddPlaceholder": "Ingrese varias frases separadas por saltos de línea"
}
```

## 変更ファイル一覧

| ファイル | 変更内容 | 変更規模 |
|---------|---------|---------|
| `web/src/types/index.ts` | `UserSettings` に `phraseList: string[]` 追加 | 小 |
| `web/src/contexts/AuthContext.tsx` | `defaultSettings` に `phraseList: []` 追加 | 小 |
| `web/src/hooks/useSpeechRecognition.ts` | `PhraseListGrammar` 適用ロジック追加 | 中 |
| `web/src/app/page.tsx` | `phraseList` を `useSpeechRecognition` に渡す | 小 |
| `web/src/app/settings/page.tsx` | フレーズリスト管理UIセクション追加 | 中 |
| `web/messages/ja.json` | フレーズリスト関連キー追加 | 小 |
| `web/messages/en.json` | 同上 | 小 |
| `web/messages/es.json` | 同上 | 小 |

## 実装ステップ

| Step | 作業内容 | 見積り |
|------|---------|--------|
| 1 | `types/index.ts` に `phraseList` フィールド追加 | 5min |
| 2 | `AuthContext.tsx` のデフォルト設定更新 | 5min |
| 3 | `useSpeechRecognition.ts` に `PhraseListGrammar` 適用 | 30min |
| 4 | `ConversationTranscriber` での動作検証 | 15min |
| 5 | `settings/page.tsx` にフレーズリスト管理UI追加 | 30min |
| 6 | `page.tsx` から `phraseList` を渡す | 5min |
| 7 | i18n キー追加（3言語） | 10min |
| 8 | テスト・動作確認 | 20min |
| **合計** | | **約 2 時間** |

## テスト観点

| テストケース | 確認内容 |
|------------|---------|
| フレーズ追加・削除 | settings 画面で CRUD が正常動作 |
| 500フレーズ上限 | 上限超過時にUIが適切に制限 |
| 登録フレーズの認識 | フレーズ登録前後で認識結果が改善 |
| ConversationTranscriber | 話者識別モードでもフレーズリストが効く |
| 空フレーズ・重複 | バリデーションが機能する |
| 一括追加 | 改行区切りで複数フレーズが登録される |
| localStorage 永続化 | ページリロード後もフレーズが保持される |

## リスクと対策

| リスク | 確率 | 対策 |
|--------|------|------|
| ConversationTranscriber で PhraseListGrammar が使えない | 中 | `SpeechConfig.setProperty()` でフォールバック |
| フレーズ数が多すぎて接続が遅くなる | 低 | 500上限を設定（SDK 推奨値） |
| localStorage 容量制限 | 低 | 500フレーズ × 平均20文字 = 10KB → 問題なし |
