# Issue #110: リアルタイム翻訳エラー — 実装計画書

## 概要

Azure Translator F0クォータ超過により全翻訳機能が停止したIssueの実装計画書。  
インフラ対応（SKUアップグレード + キー再生成）は**完了済み**。本計画はコードレベルの修正・デプロイに関する。

---

## 実施済み対応（インフラ）

| 対応 | 状態 | 詳細 |
|---|---|---|
| Azure Translator SKU変更 | ✅ | F0 → S1 |
| APIキー再生成 | ✅ | Key1再生成 |
| .env.local 更新 | ✅ | 新キー反映済み |
| GitHub Secret 更新 | ✅ | `NEXT_PUBLIC_AZURE_TRANSLATOR_KEY` |
| API疎通確認 | ✅ | 翻訳成功確認済み |

---

## 実装タスク

### Task 1: CI/CD 環境変数の追加（P0, 5分）

**対象ファイル**: `.github/workflows/azure-static-web-apps.yml`

**変更内容**: `NEXT_PUBLIC_AZURE_TRANSLATOR_REGION` を env セクションに追加

**変更前**:
```yaml
env:
  NEXT_PUBLIC_AZURE_SPEECH_KEY: ${{ secrets.NEXT_PUBLIC_AZURE_SPEECH_KEY }}
  NEXT_PUBLIC_AZURE_SPEECH_REGION: ${{ secrets.NEXT_PUBLIC_AZURE_SPEECH_REGION }}
  NEXT_PUBLIC_AZURE_TRANSLATOR_KEY: ${{ secrets.NEXT_PUBLIC_AZURE_TRANSLATOR_KEY }}
```

**変更後**:
```yaml
env:
  NEXT_PUBLIC_AZURE_SPEECH_KEY: ${{ secrets.NEXT_PUBLIC_AZURE_SPEECH_KEY }}
  NEXT_PUBLIC_AZURE_SPEECH_REGION: ${{ secrets.NEXT_PUBLIC_AZURE_SPEECH_REGION }}
  NEXT_PUBLIC_AZURE_TRANSLATOR_KEY: ${{ secrets.NEXT_PUBLIC_AZURE_TRANSLATOR_KEY }}
  NEXT_PUBLIC_AZURE_TRANSLATOR_REGION: ${{ secrets.NEXT_PUBLIC_AZURE_TRANSLATOR_REGION }}
```

**追加作業**: GitHub Secretに `NEXT_PUBLIC_AZURE_TRANSLATOR_REGION` = `global` を登録

---

### Task 2: エラーハンドリング改善（P1, 15分）

**対象ファイル**: `web/src/hooks/useTranslation.ts`

**変更内容**: エラーレスポンスのボディを解析し、クォータ超過時にユーザーフレンドリーなメッセージを表示

**変更箇所**: `translate` 関数内のエラーハンドリング部分

**変更前**:
```typescript
if (!response.ok) {
  throw new Error(`翻訳エラー: ${response.status} ${response.statusText}`);
}
```

**変更後**:
```typescript
if (!response.ok) {
  let errorMessage = `翻訳エラー: ${response.status} ${response.statusText}`;
  try {
    const errorBody = await response.json();
    if (errorBody?.error?.message) {
      // クォータ超過・認証エラーのユーザーフレンドリー化
      if (response.status === 401 || response.status === 403 || 
          errorBody.error.message.includes('quota')) {
        errorMessage = '翻訳サービスの利用制限に達しました。しばらく経ってから再度お試しください。';
      } else {
        errorMessage = `翻訳エラー: ${errorBody.error.message}`;
      }
    }
  } catch {
    // JSONパースエラーはデフォルトメッセージを使用
  }
  throw new Error(errorMessage);
}
```

---

### Task 3: 差分翻訳の実装（P1, 30分）

**対象ファイル**: `web/src/app/page.tsx`

**変更内容**: 全文再翻訳から差分翻訳（新規セグメントのみ）に変更

**方針**: 
- `lastTranslatedSegmentCountRef` で翻訳済みセグメント数を追跡
- 新規セグメントのみを翻訳APIに送信
- 翻訳結果を累積して表示
- interimTranscript は常に翻訳（暫定テキスト）

**変更前** (`page.tsx` L210-255付近):
```typescript
// 現在の実装: 全文テキストを毎回送信
const textToTranslate = transcript || interimTranscript;
// ...
const result = await translate(textToTranslate, sourceLanguage, targetLanguage);
```

**変更後**:
```typescript
// 差分翻訳: 新規セグメントのみ送信
const lastTranslatedIndexRef = useRef(0);
const accumulatedTranslationRef = useRef('');

// segments が変化したとき
useEffect(() => {
  if (!showRecordingUI || !isRealtimeTranslation) return;
  if (segments.length === 0 && !interimTranscript) return;
  
  // 新規セグメントのテキストを抽出
  const newSegments = segments.slice(lastTranslatedIndexRef.current);
  const newText = newSegments.map(s => s.text).join(' ');
  const textToTranslate = newText + (interimTranscript ? ' ' + interimTranscript : '');
  
  if (!textToTranslate.trim()) return;
  if (lastTranslatedTextRef.current === textToTranslate) return;
  
  if (translationTimeoutRef.current) clearTimeout(translationTimeoutRef.current);
  
  translationTimeoutRef.current = setTimeout(async () => {
    lastTranslatedTextRef.current = textToTranslate;
    const result = await translate(textToTranslate, sourceLanguage, targetLanguage);
    if (result) {
      // 確定セグメントの翻訳を累積
      if (newSegments.length > 0) {
        const confirmedText = newSegments.map(s => s.text).join(' ');
        const confirmedResult = await translate(confirmedText, sourceLanguage, targetLanguage);
        if (confirmedResult) {
          accumulatedTranslationRef.current += (accumulatedTranslationRef.current ? ' ' : '') + confirmedResult;
          lastTranslatedIndexRef.current = segments.length;
        }
      }
      // interim 部分を含めた表示
      setTranslatedText(
        accumulatedTranslationRef.current + 
        (interimTranscript ? ' ' + result.slice(result.length - interimTranscript.length) : '')
      );
    }
  }, 500);
  
  return () => {
    if (translationTimeoutRef.current) clearTimeout(translationTimeoutRef.current);
  };
}, [segments, interimTranscript, showRecordingUI, isRealtimeTranslation, sourceLanguage, targetLanguage]);
```

> **注**: 差分翻訳の実装は Issue #33（セグメント単位差分翻訳）と統合可能。  
> 簡易版として、まずは「前回翻訳時からの新規テキストのみ送信」で十分な効果がある。

---

### Task 4: 再デプロイ（P0, 10分）

**方法**: 上記変更をPRにまとめ、mainにマージすることでGitHub Actions経由の自動デプロイを実行

**確認事項**:
- 新しいAPIキーがビルドに埋め込まれること
- リアルタイム翻訳が動作すること
- エラー時のメッセージが適切であること

---

## 実装順序

```
Task 1 (CI/CD env追加) ──→ Task 4 (再デプロイ) ← 最優先: 新キーの反映
        ↓
Task 2 (エラーハンドリング) ── 同時実装可能
Task 3 (差分翻訳) ──────── Task 2完了後
```

---

## Issue #106 との統合

Issue #106（カスタムテンプレート作成不可）も未デプロイ。同一PRで以下を統合可能：

1. `api/src/index.ts` に `import "./functions/templates"` 追加 (Issue #106)
2. CI/CD env追加 (Issue #110)
3. エラーハンドリング改善 (Issue #110)
4. 差分翻訳（オプション、別PRでも可）

---

## テスト計画

| テストケース | 手順 | 期待結果 |
|---|---|---|
| リアルタイム翻訳基本動作 | 録音開始 → 翻訳ON → 日本語で発話 | 英語翻訳がリアルタイム表示 |
| 長時間翻訳コスト | 10分間録音 + 翻訳ON | Azure Portalでの消費文字数がBUG修正前より大幅に少ないこと |
| エラーハンドリング | APIキーを無効化 | 「翻訳サービスの利用制限に達しました」メッセージ表示 |
| CI/CD env | mainマージ後のデプロイ | 翻訳が正常動作すること |

---

*作成日: 2026-02-13*  
*作成者: ReviewAAgent*  
*引き継ぎ先: @EngineerDeploy*
