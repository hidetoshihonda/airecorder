# Issue #34: フレーズリスト機能で音声認識精度を向上 — 分析レビュー

> 作成日: 2026-02-14  
> 対象 Issue: #34  
> Phase: P1（最優先）  
> 工数見積: S（約2時間）  
> 既存計画書: [Issue34_フレーズリスト機能_実装計画書.md](../web/docs/Issue34_フレーズリスト機能_実装計画書.md)

---

## 1. エグゼクティブサマリー

- **問題の本質**: 音声認識で固有名詞・専門用語が誤認識される。Azure Speech SDKの `PhraseListGrammar` を使えばコスト¥0で精度向上できるが、現在は未実装。
- **影響範囲**: 録音機能を使う全ユーザー（100%）。特に社名・人名・技術用語を多用するビジネスユーザーへの影響大。
- **修正の緊急度**: **Medium** — 機能追加。既存機能の破壊なし。ただしP1最優先の根拠は「最小工数で最大効果 + #33, #35への恩恵」。

---

## 2. アーキテクチャ概観

### 2.1 現在の音声認識パイプライン

```
マイク
  │
  ▼
SpeechConfig.fromSubscription(key, region)
  │ speechRecognitionLanguage = "ja-JP"
  │ ← フレーズリスト未設定 ❌
  ▼
┌─ enableSpeakerDiarization ?
│  ├─ true  → ConversationTranscriber → segments (with speakerId)
│  └─ false → SpeechRecognizer       → segments (no speakerId)
│
▼
transcript = segments.map(s => s.text).join(" ")
```

### 2.2 変更後のパイプライン（計画）

```
マイク
  │
  ▼
SpeechConfig.fromSubscription(key, region)
  │ speechRecognitionLanguage = "ja-JP"
  ▼
┌─ enableSpeakerDiarization ?
│  ├─ true  → ConversationTranscriber
│  │           └── PhraseListGrammar.fromRecognizer(transcriber) ← ⚠️ 要検証
│  └─ false → SpeechRecognizer
│               └── PhraseListGrammar.fromRecognizer(recognizer) ← ✅ 動作確認済
│
▼
transcript（精度向上）
```

### 2.3 データフロー（設定の保存と適用）

```
Settings画面 → updateSettings({ phraseList: [...] })
  │
  ├─→ AuthContext state 更新
  ├─→ localStorage 保存 (SETTINGS_STORAGE_KEY)
  └─→ settingsApi.saveUserSettings() → Azure Functions → Cosmos DB
  
録音開始時:
  page.tsx → settings.phraseList 取得
    │
    └─→ useSpeechRecognition({ phraseList }) → SDK に適用
```

---

## 3. 重大バグ分析 🔴

本Issueは新機能追加のため、既存バグはなし。  
ただし **計画書の検証で以下の問題を発見**：

### BUG-1: 計画書にAPI側モデル更新が欠落 [High]

**場所**: `api/src/models/recording.ts` L93-101

**コード（API側のUserSettings）**:
```typescript
export interface UserSettings {
  defaultSourceLanguage: string;
  defaultTargetLanguages: string[];
  theme: "light" | "dark" | "system";
  autoSaveRecordings: boolean;
  audioQuality: "low" | "medium" | "high";
  noiseSuppression: boolean;
  enableSpeakerDiarization: boolean;
  // ← phraseList が存在しない
}
```

**問題**: 計画書では `web/src/types/index.ts` の `UserSettings` に `phraseList: string[]` を追加する計画だが、**API側にも同名の `UserSettings` インターフェースがあり、こちらの更新が記載されていない**。

**影響**: API経由で設定を保存/読み込みする際に `phraseList` フィールドが型定義に含まれないため、TypeScriptビルドエラーにはならないが（`Partial<UserSettings>` で送信するため）、型安全性が低下する。

**修正方針**: `api/src/models/recording.ts` の `UserSettings` にも `phraseList?: string[]` を追加する。オプショナルにすることで既存データとの後方互換性を維持。

### BUG-2: ConversationTranscriber での PhraseListGrammar 互換性が未検証 [Medium]

**場所**: `web/src/hooks/useSpeechRecognition.ts` L55-115

**問題**: Azure公式ドキュメントとサンプルコードにおいて、`PhraseListGrammar.fromRecognizer()` は `SpeechRecognizer` でのみ使用例が確認されている。`ConversationTranscriber` に対して使用可能かの公式確認がない。

**SDKの型定義**: `PhraseListGrammar.fromRecognizer()` は `Recognizer` 基底クラスを受け付ける。`ConversationTranscriber` が `Recognizer` を継承していれば動作するはずだが、内部的にサポートされているかは別問題。

**影響**: 話者識別ONの場合にフレーズリストが効かない可能性。

**修正方針**（計画書の案を採用）:
1. まず `PhraseListGrammar.fromRecognizer(transcriber)` を試行
2. TypeScript型エラーが出る場合は `as unknown as SpeechSDK.Recognizer` でキャスト
3. ランタイムエラーが出る場合は `SpeechConfig.setProperty()` でフォールバック

---

## 4. 設計上の問題 🟡

### DESIGN-1: UserSettings型がWeb/APIで二重定義 [Medium]

**現状**: 
- `web/src/types/index.ts` L147 — Web側の `UserSettings`
- `api/src/models/recording.ts` L93 — API側の `UserSettings`

同じ `UserSettings` インターフェースが2つの場所に独立して定義されている。フィールド追加時に両方の更新が必要で、同期漏れのリスクがある。

**提案**: 将来的にはモノレポ共有パッケージ（`packages/shared/types`）に統合すべき。本Issueでは両方に追加する形で対応。

### DESIGN-2: resumeListening でフレーズリストが再適用されるか [Medium]

**場所**: `web/src/hooks/useSpeechRecognition.ts` L275-302

**現状**: `resumeListening` では `ConversationTranscriber` モードの場合、新しいインスタンスを作成して `startConversationTranscriber(speechConfig)` を呼ぶ。しかし `startConversationTranscriber` は引数として `speechConfig` のみを受け取り、**フレーズリストを適用するロジックが含まれていない**。

**影響**: 話者識別ON + 一時停止→再開 でフレーズリストが消失する可能性。

**修正方針**: `startConversationTranscriber` のパラメータに `phraseList` を追加するか、`speechConfig` レベルでの設定（再利用可能）を検討。

✅ **Good**: 計画書のUI設計はプロジェクトの既存設定画面パターン（Card + toggle/input）と一致しており、良い設計判断。

✅ **Good**: 500フレーズ上限はAzure SDK推奨値に準拠。localStorage容量（10KB）も問題なし。

✅ **Good**: i18n 3言語対応が計画済み。

---

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
#34（本Issue: フレーズリスト）── 独立実装可能
  │
  ├──→ #33（差分翻訳）に恩恵: 認識精度が高いとセグメント品質向上
  └──→ #35（SDK切替）に恩恵: TranslationRecognizer にも phraseList 適用可能
```

- **ブロッカー**: なし。完全に独立して実装可能。
- **並行作業**: #33, #35 と並行可能（ただし計画書推奨順序は #34 → #33 → #35）

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| PhraseListGrammar | Azure Speech SDK | Low | SDK標準機能、追加コストなし |
| UserSettings 拡張 | Web型 + API型 | Medium | 両方同時更新必須 |
| Settings UI | AuthContext.updateSettings | Low | 既存パターン踏襲 |
| Cosmos DB | 設定ドキュメント | Low | Partial更新、スキーマレス |

### 5.3 他Issue/機能との相互作用

- **#33（差分翻訳）**: 干渉なし。翻訳パイプラインは別レイヤー。
- **#35（SDK切替）**: `TranslationRecognizer` にも `PhraseListGrammar` が使える。#34が先に実装されていれば、#35実装時に `useTranslationRecognizer.ts` にも適用するだけ。
- **設定画面**: 他の設定UI変更と競合しない位置（Speaker Diarization カードの後）に追加。

---

## 6. ブラウザ / 環境互換性リスク

| 環境 | 対応状況 | リスク |
|------|---------|--------|
| Chrome / Edge | ✅ Speech SDK完全サポート | — |
| Firefox | ✅ Speech SDK完全サポート | — |
| Safari / iOS | ⚠️ Speech SDKのマイク入力に制限あり | PhraseList自体は問題なし |
| Node.js (API側) | N/A | API側は型定義のみ |

PhraseListGrammar はクライアントSDK機能のため、ブラウザ固有のリスクはなし。

---

## 7. 修正提案（優先順位付き）

### Phase 1: コア実装（P0）

#### 変更ファイル一覧（計画書を補完）

| # | ファイル | 変更内容 | 変更規模 |
|---|---------|---------|---------|
| 1 | `web/src/types/index.ts` | `UserSettings` に `phraseList?: string[]` 追加 | 小 |
| 2 | `api/src/models/recording.ts` | **API側** `UserSettings` に `phraseList?: string[]` 追加 ← **計画書に欠落** | 小 |
| 3 | `web/src/contexts/AuthContext.tsx` | `defaultSettings` に `phraseList: []` 追加 | 小 |
| 4 | `web/src/hooks/useSpeechRecognition.ts` | options に `phraseList` 追加、SDK適用ロジック | 中 |
| 5 | `web/src/app/page.tsx` | `phraseList` を hook に渡す | 小 |
| 6 | `web/src/app/settings/page.tsx` | フレーズリスト管理UIセクション追加 | 中 |
| 7 | `web/messages/ja.json` | i18n キー追加 | 小 |
| 8 | `web/messages/en.json` | i18n キー追加 | 小 |
| 9 | `web/messages/es.json` | i18n キー追加 | 小 |

### Phase 2: 堅牢性強化（P1）

- ConversationTranscriber でのフレーズリスト動作検証
- 動作しない場合は `SpeechConfig.setProperty()` フォールバック実装
- `resumeListening` でのフレーズリスト再適用確認

---

## 8. テスト戦略

### 状態遷移テスト（手動）

| # | 操作 | 期待結果 |
|---|------|---------|
| 1 | 設定画面でフレーズ追加 | リストに表示、トースト表示 |
| 2 | フレーズ削除 | リストから消去 |
| 3 | 500フレーズ到達時に追加試行 | 追加ボタン無効化 or 警告表示 |
| 4 | 空文字・重複フレーズ追加 | バリデーションで拒否 |
| 5 | 一括追加（改行区切り） | 複数フレーズが一度に登録 |
| 6 | 録音開始（SpeechRecognizer） | フレーズが認識に反映 |
| 7 | 録音開始（ConversationTranscriber） | フレーズが認識に反映（要検証） |
| 8 | 一時停止→再開 | フレーズリストが再適用 |
| 9 | ページリロード | localStorage からフレーズ復元 |
| 10 | 別デバイスでログイン | Cosmos DB からフレーズ同期 |

### ブラウザ別テストマトリクス

| テスト項目 | Chrome | Firefox | Safari | Edge |
|-----------|--------|---------|--------|------|
| フレーズリストUI | — | — | — | — |
| 認識精度の改善確認 | — | — | — | — |
| 設定の永続化 | — | — | — | — |

---

## 9. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | `types/index.ts` + `api/models/recording.ts` 型追加 | 5min | 型定義 |
| 2 | `AuthContext.tsx` デフォルト設定 | 5min | 設定初期値 |
| 3 | `useSpeechRecognition.ts` PhraseListGrammar適用 | 30min | 認識エンジン |
| 4 | `settings/page.tsx` UI追加 | 30min | 設定画面 |
| 5 | `page.tsx` phraseList引き渡し | 5min | 録音画面 |
| 6 | i18n キー追加（3言語） | 10min | 多言語 |
| 7 | ビルド確認 (Web + API) | 10min | — |
| 8 | テスト・動作確認 | 20min | — |
| **合計** | | **約2時間15分** | |

---

## 10. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| ConversationTranscriber で PhraseListGrammar 非対応 | 中 | Medium | SpeechConfig.setProperty() フォールバック |
| API側の UserSettings 型同期漏れ | — | Medium | 本レビューで検出済み、追加予定 |
| resumeListening でフレーズ消失 | 中 | Low | speechConfig 再作成時に再適用 |
| フレーズ数過多で接続遅延 | 低 | Low | 500上限 (SDK推奨) |
| localStorage 容量制限 | 極低 | Low | 500 × 20文字 = 10KB |

---

## 11. 結論

### 最大の問題点

計画書は全体的に質が高いが、**API側の `UserSettings` 型への `phraseList` 追加が欠落** していた点を本レビューで補完。また `ConversationTranscriber` 互換性と `resumeListening` 時のフレーズリスト再適用が要注意。

### 推奨する修正順序

1. 型定義追加（Web + API両方）
2. AuthContext デフォルト設定
3. `useSpeechRecognition` へのPhraseListGrammar適用（SpeechRecognizerモード先行）
4. Settings画面UI
5. page.tsx引き渡し
6. i18n
7. ConversationTranscriberモードの検証・対応

### 他 Issue への影響

- **#33, #35**: ポジティブな影響のみ（認識精度向上が翻訳品質にも寄与）
- **破壊的変更**: なし（`phraseList` はオプショナルフィールド）

### 判定: **GO** ✅

- 計画書の品質は高く、本レビューの補完事項を追加すれば即座に着手可能
- 工数は約2時間15分（API側追加を含む）
- リスクは限定的で、フォールバック戦略も明確
