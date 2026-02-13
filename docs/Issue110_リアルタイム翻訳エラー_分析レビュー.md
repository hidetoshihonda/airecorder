# Issue #110: リアルタイム翻訳がクォータ超過で常時エラー — 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: Azure Translator F0（無料枠・月200万文字）のクォータを使い切り、全翻訳APIコールが401/403エラーとなった。リアルタイム翻訳が500msデバウンスで**全文テキスト**を毎回送信する設計がクォータ消費を加速した。
- **影響範囲**: 全ユーザー（100%）のリアルタイム翻訳・録音後翻訳が完全に利用不可。
- **修正の緊急度**: 🔴 **Critical（P0）** — インフラ対応（SKUアップグレード）で即座に復旧。コード改善で再発防止が必要。

---

## 2. アーキテクチャ概観

### 2.1 翻訳データフロー

```
録音中（リアルタイム翻訳ON）:
  useSpeechRecognition → segments 変化 → transcript 更新
    ↓ useEffect (500ms debounce)
  useTranslation.translate(全文transcript, sourceLanguage, targetLanguage)
    ↓
  POST https://api.cognitive.microsofttranslator.com/translate?api-version=3.0
    Headers: Ocp-Apim-Subscription-Key, Ocp-Apim-Subscription-Region
    Body: [{"text": "全文テキスト"}]
    ↓
  🔴 Azure Translator API → 401 Unauthorized (クォータ超過)
    ↓
  useTranslation: setError("翻訳エラー: 401 Unauthorized")
    ↓
  page.tsx: errors 配列に追加 → 画面にエラー表示
```

### 2.2 クォータ消費の計算

リアルタイム翻訳の送信パターン:
- 500msデバウンスで全文テキストを送信
- 例: 60分の会議（3000文字/分 × 60分 = 180,000文字の文字起こし）
- 500msごとに送信 → 1秒あたり2回 × 60分 × 60秒 = 7,200回の翻訳コール
- 各コールで全文（平均90,000文字）を送信 → 合計約 6.5億文字

**F0の200万文字/月は1回の長時間会議で枯渇する可能性がある。**

実際にはデバウンスと `lastTranslatedTextRef` による重複回避があるため、もう少し効率的だが、累積すれば十分にクォータを消費する。

---

## 3. 重大バグ分析 🔴

### BUG-1: Azure Translator F0クォータ超過（Critical）

**場所**: インフラ（Azure Translator リソース `translator-airecorder-dev`）

**エラー詳細**:
```json
{
  "error": {
    "code": "403",
    "message": "Out of call volume quota for TextTranslator F0 pricing tier. Please retry after 16 days. To increase your call volume switch to a paid tier."
  }
}
```

**問題**: F0無料枠（200万文字/月）を使い切った。Translator APIの直接コールは401を返すが、トークンエンドポイント（`/sts/v1.0/issueToken`）が本当のエラー（403 + クォータ超過メッセージ）を返す。

**影響**: 全ユーザーの翻訳機能が完全停止。

**根本原因**: 
1. リアルタイム翻訳が**全文テキスト**を毎回送信する設計
2. F0の月間クォータが低い（200万文字）
3. クォータ監視・警告メカニズムが未実装

**緊急対応（実施済み）**:
- ✅ Translator SKU を F0 → S1 に変更（従量課金: $10/100万文字）
- ✅ APIキー再生成 + .env.local 更新 + GitHub Secret 更新
- ✅ API疎通確認: `"Hello, how are you?"` → `"こんにちは、お元気ですか?"` 成功

---

### BUG-2: リアルタイム翻訳が全文送信で非効率（High）

**場所**: `web/src/app/page.tsx` L240-247

**コード**:
```typescript
// Real-time translation with debounce (500ms delay to avoid too many API calls)
if (showRecordingUI && isRealtimeTranslation && textToTranslate) {
  translationTimeoutRef.current = setTimeout(async () => {
    lastTranslatedTextRef.current = textToTranslate;
    const result = await translate(textToTranslate, sourceLanguage, targetLanguage);
    if (result) {
      setTranslatedText(result);
    }
  }, 500);
}
```

**問題**: `textToTranslate = transcript || interimTranscript` で全文テキストを毎回送信。録音が進むにつれて送信文字数が線形増加し、APIコスト（S1の場合）も増大する。

**影響**: 
- S1でもコストが想定以上に高額になるリスク
- 長時間録音時のレスポンス遅延（全文翻訳は時間がかかる）
- ネットワーク帯域の浪費

**修正方針**: 差分翻訳（新規セグメントのみ翻訳）に変更

```typescript
// 改善案: 新規セグメントのみ翻訳
const lastTranslatedSegmentCountRef = useRef(0);

useEffect(() => {
  if (!showRecordingUI || !isRealtimeTranslation || segments.length === 0) return;
  
  const newSegments = segments.slice(lastTranslatedSegmentCountRef.current);
  if (newSegments.length === 0 && !interimTranscript) return;
  
  const textToTranslate = newSegments.map(s => s.text).join(" ") + 
    (interimTranscript ? " " + interimTranscript : "");
  
  translationTimeoutRef.current = setTimeout(async () => {
    const result = await translate(textToTranslate, sourceLanguage, targetLanguage);
    if (result) {
      setTranslatedText(prev => prev + " " + result);
      lastTranslatedSegmentCountRef.current = segments.length;
    }
  }, 500);
  
  return () => clearTimeout(translationTimeoutRef.current!);
}, [segments, interimTranscript, ...]);
```

---

### BUG-3: 翻訳エラーの不明確な表示（Medium）

**場所**: `web/src/hooks/useTranslation.ts` L74-76

**コード**:
```typescript
if (!response.ok) {
  throw new Error(`翻訳エラー: ${response.status} ${response.statusText}`);
}
```

**問題**: HTTPステータスコードのみでエラーメッセージを生成。クォータ超過（403）も認証エラー（401）も「翻訳エラー: 401 Unauthorized」としか表示されず、ユーザーが対処できない。実際にはAzure Translator APIのレスポンスボディに詳細なエラー情報が含まれるが、パースされていない。

**修正方針**:
```typescript
if (!response.ok) {
  let errorMessage = `翻訳エラー: ${response.status}`;
  try {
    const errorData = await response.json();
    if (errorData?.error?.message) {
      if (errorData.error.code === 403 || response.status === 401) {
        errorMessage = "翻訳サービスの利用上限に達しました。管理者にお問い合わせください。";
      } else {
        errorMessage = errorData.error.message;
      }
    }
  } catch { /* ignore parse errors */ }
  throw new Error(errorMessage);
}
```

---

### BUG-4: CI/CDでTranslator Region未設定（Medium）

**場所**: `.github/workflows/azure-static-web-apps.yml` L70-72

**コード**:
```yaml
env:
  NEXT_PUBLIC_AZURE_SPEECH_KEY: ${{ secrets.NEXT_PUBLIC_AZURE_SPEECH_KEY }}
  NEXT_PUBLIC_AZURE_SPEECH_REGION: ${{ secrets.NEXT_PUBLIC_AZURE_SPEECH_REGION }}
  NEXT_PUBLIC_AZURE_TRANSLATOR_KEY: ${{ secrets.NEXT_PUBLIC_AZURE_TRANSLATOR_KEY }}
  # ← NEXT_PUBLIC_AZURE_TRANSLATOR_REGION が欠落
```

**問題**: `NEXT_PUBLIC_AZURE_TRANSLATOR_REGION` がCI/CDのビルド環境変数に含まれていない。Next.js static exportではビルド時にenv varが埋め込まれるため、デフォルトの "global" が使用される。現在のリソースは "global" ロケーションなので動作するが、明示的に設定すべき。

**修正方針**: CI/CDにregion環境変数を追加 + GitHub Secretに登録

---

## 4. 設計上の問題 🟡

### 4.1 🟡 High: 全文再翻訳のコスト効率
リアルタイム翻訳で毎回全文を送信する設計は、API コスト・レスポンス時間・ネットワーク帯域の全てで非効率。差分翻訳（新規セグメントのみ）に変更すべき。

### 4.2 🟡 Medium: APIレート制限/クォータの監視なし
翻訳APIのエラーレスポンスを詳細に解析していない。クォータ超過・レート制限・認証エラーの区別がなく、ユーザーに適切なフィードバックを提供できない。

### 4.3 ✅ Good: デバウンス機構
500msのデバウンスは適切。`lastTranslatedTextRef` による重複翻訳回避も良い設計。

### 4.4 ✅ Good: リアルタイム翻訳ON/OFF切替
`isRealtimeTranslation` フラグでユーザーがリアルタイム翻訳を制御できる。

---

## 5. 依存関係マトリクス 📊

### 5.1 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---|---|---|---|
| `useTranslation.ts` | Azure Translator API | 🔴 クォータ/キー問題で全停止 | S1アップグレード済み |
| `page.tsx` 翻訳Effect | `useTranslation.translate` | 🟡 全文送信でコスト増大 | 差分翻訳に変更 |
| CI/CD | GitHub Secrets | 🟡 REGION未設定 | Secret追加 |

### 5.2 他Issue/機能との相互作用

- **Issue #33（セグメント単位差分翻訳）**: 本Issue の恒久対策と重複。差分翻訳の実装として統合可能
- **Issue #35（Speech Translation SDK切替）**: SDK統合翻訳に移行すれば、REST API翻訳のクォータ問題は根本的に解消

---

## 6. 修正提案（優先順位付き）

### Phase 1: 即座の復旧（P0） — ✅ 実施済み

| 対応 | 状態 |
|---|---|
| Translator SKU F0 → S1 アップグレード | ✅ 完了 |
| APIキー再生成 + .env.local 更新 | ✅ 完了 |
| GitHub Secret 更新 | ✅ 完了 |
| API疎通確認 | ✅ 成功 |

### Phase 2: デプロイ反映（P0）

1. 再生成されたキーを含むビルドを再デプロイ
2. CI/CDに `NEXT_PUBLIC_AZURE_TRANSLATOR_REGION` を追加

### Phase 3: コード改善（P1）

1. **差分翻訳実装**: 新規セグメントのみを翻訳APIに送信
2. **エラーハンドリング改善**: クォータ超過時の明確なメッセージ
3. **翻訳キャッシュ**: 同一テキストの再翻訳を防止

---

## 7. テスト戦略

| テストケース | 期待結果 |
|---|---|
| リアルタイム翻訳ON + 録音 | 翻訳がリアルタイムに表示される |
| 録音停止後の翻訳 | 最終テキストの翻訳が表示される |
| 長時間録音（30分+） | コストが線形増加しないこと |
| ネットワーク切断時 | エラーメッセージ表示（翻訳タブ） |

---

## 8. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|---|---|---|---|
| 1 | CI/CDにregion env追加 + Secret登録 | 5分 | `.github/workflows/azure-static-web-apps.yml` |
| 2 | 再デプロイトリガー | 3分 | GitHub Actions |
| 3 | エラーハンドリング改善 | 15分 | `useTranslation.ts` |
| 4 | 差分翻訳実装 | 30分 | `page.tsx` |
| 5 | デプロイ + 動作確認 | 10分 | 本番環境 |

---

## 9. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|---|---|---|---|
| S1でもコスト超過 | 中 | 高 | 差分翻訳実装 + 月間コスト監視 |
| キー再生成で既存セッション切断 | 低 | 低 | クライアント再読み込みで復旧 |
| CI/CDでのキー反映漏れ | 低 | 高 | GitHub Secret更新済み確認 |

---

## 10. 結論

### 最大の問題点
Azure Translator F0無料枠（200万文字/月）のクォータ超過。リアルタイム翻訳の「全文再送信」設計がクォータ消費を加速した。

### 実施済み対応
- ✅ Translator SKU: F0 → S1 にアップグレード
- ✅ APIキー再生成 + .env.local + GitHub Secret 更新
- ✅ API疎通確認: 翻訳成功

### 推奨する修正順序
1. **[P0]** CI/CDにregion追加 + 再デプロイ（デプロイ済みアプリのキーを最新化）
2. **[P1]** 差分翻訳実装（コスト最適化）
3. **[P1]** エラーハンドリング改善（ユーザー向けメッセージ）

### 判定: `CONDITIONAL GO` ⚠️

インフラ対応は完了。コード側の差分翻訳実装とCI/CD修正 + 再デプロイが必要。

---

*分析日: 2026-02-13*
*分析者: ReviewAAgent*
