# Issue #41 話者分離設定がユーザーレベルで永続化されない - 分析レビュー

## 1. エグゼクティブサマリー

- **問題の本質**: 話者分離設定はlocalStorageに正しく保存されているが、**Next.jsのSSR/ハイドレーション時にサーバー側でlocalStorageにアクセスできない**ため、初期レンダリング時にデフォルト値（false）が使用される
- **影響範囲**: 話者識別を有効にした全ユーザー（機能を必要とするユーザーの100%に影響）
- **修正の緊急度**: **Medium** - 機能自体は動作するが、UX上の問題がある

## 2. アーキテクチャ概観

### コンポーネント依存関係

```
AuthProvider (settings state)
    │
    ├── localStorage読み込み（初期化時）
    │   └── SSR時: window === undefined → defaultSettings使用 ⚠️
    │   └── クライアント時: 正しく読み込まれる ✅
    │
    └── settings変更時
        └── localStorage書き込み ✅
            
HomePage
    │
    ├── useAuth() → settings取得
    │   └── enableSpeakerDiarization = settings.enableSpeakerDiarization ?? false
    │
    └── useSpeechRecognition({ enableSpeakerDiarization })
        └── 録音開始時にこの値で ConversationTranscriber を選択
```

### データフロー

```
[設定画面]
    │
    ▼ updateSettings({ enableSpeakerDiarization: true })
    │
[AuthContext]
    │
    ├── setSettings() → state更新
    └── localStorage.setItem("airecorder-settings", JSON.stringify(updated))
    
[ページリロード / 再訪問]
    │
    ▼ AuthProvider初期化
    │
[useState初期化関数]
    │
    ├── SSR: typeof window === "undefined" → defaultSettings (false) ⚠️
    │
    └── CSR hydration: useState初期化関数は再実行されない
        └── settings.enableSpeakerDiarization = false のまま ⚠️
```

## 3. 重大バグ分析 🔴

### BUG-1: SSRハイドレーションによる設定値の不一致

**場所**: [AuthContext.tsx](../src/contexts/AuthContext.tsx#L87-L100)

**コード**:
```typescript
const [settings, setSettings] = useState<UserSettings>(() => {
  // Load settings from localStorage on initial render (client-side only)
  if (typeof window !== "undefined") {
    try {
      const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        return { ...defaultSettings, ...parsed };
      }
    } catch (error) {
      console.error("Failed to load settings from localStorage:", error);
    }
  }
  return defaultSettings;  // ← SSR時はここに到達
});
```

**問題**: 
1. SSR時は `typeof window !== "undefined"` が false なので `defaultSettings` が返される
2. Reactのハイドレーション時、`useState` の初期化関数は**再実行されない**
3. 結果として、クライアント側でもサーバー側の初期値（defaultSettings）が使われ続ける

**影響**: 
- ユーザーが話者分離を有効にして保存しても、次回ページ訪問時に無効状態で表示・動作する
- 録音開始すると `SpeechRecognizer`（話者識別なし）が使用され、話者情報が取得できない

**根本原因**: 
- Next.js のSSRとクライアントサイドのハイドレーションにおける状態の不整合
- `useState` の初期化関数がサーバー・クライアントで異なる値を返す設計

**修正方針**: 
useEffectでクライアントサイドでの再読み込みを行う

```typescript
// 方法1: useEffectでクライアントサイド読み込み
export function AuthProvider({ children }: AuthProviderProps) {
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // クライアントサイドでのみlocalStorageから読み込む
  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        setSettings({ ...defaultSettings, ...parsed });
      }
    } catch (error) {
      console.error("Failed to load settings from localStorage:", error);
    }
    setSettingsLoaded(true);
  }, []);

  // settingsがロードされるまで録音ボタンを無効化するオプション
  const value: AuthContextType = {
    ...
    settingsLoaded, // 追加
  };
}
```

### BUG-2: useSpeechRecognitionのオプション変更が反映されない（潜在的問題）

**場所**: [useSpeechRecognition.ts](../src/hooks/useSpeechRecognition.ts#L33)

**コード**:
```typescript
const { subscriptionKey, region, language = "ja-JP", enableSpeakerDiarization = false, sharedStream = null } = options;
```

**問題**: 
- `enableSpeakerDiarization` が録音開始後に変更されても、既に作成された `SpeechRecognizer` / `ConversationTranscriber` には反映されない
- ただし、これは設計上の想定動作（録音中に切り替えることはない）

**影響**: Low（現在の使用パターンでは問題なし）

## 4. 設計上の問題 🟡

### DESIGN-1: SSRフレンドリーでない設定管理

**問題**: 
- `useState` の初期化関数でlocalStorageを読み込む設計は、SSR環境では正しく動作しない
- Reactのハイドレーションの仕組みを考慮していない

**改善案**:
1. **useEffectパターン**: クライアントサイドでのみ設定を読み込む（推奨）
2. **useSyncExternalStore**: React 18のAPIでSSR対応のlocalStorage読み込み
3. **next-themes方式**: ハイドレーション完了までデフォルト表示し、完了後に実際の値を反映

### DESIGN-2: 設定読み込み完了の可視性がない

**問題**: 
- 設定がlocalStorageから読み込まれたかどうかを判別する手段がない
- UIが「設定読み込み中」なのか「デフォルト値」なのか区別できない

**改善案**:
```typescript
interface AuthContextType {
  settings: UserSettings;
  settingsLoaded: boolean; // 追加
  updateSettings: (settings: Partial<UserSettings>) => void;
}
```

## 5. 依存関係マトリクス 📊

### 5.1 Issue 間依存関係

```
Issue #41 (話者分離設定永続化)
    │
    └── Issue #9 (話者識別実装) - 完了済み
        話者識別機能の根幹に影響
```

### 5.2 技術的依存関係

| コンポーネント | 依存先 | リスク | 対策 |
|---------------|--------|--------|------|
| AuthContext | localStorage | SSR非対応 | useEffectで読み込み |
| HomePage | settings.enableSpeakerDiarization | 初期値false | settingsLoaded待ち |
| useSpeechRecognition | enableSpeakerDiarization prop | Stale props | 録音開始時に最新値を使用 |

### 5.3 影響を受けるファイル

- `web/src/contexts/AuthContext.tsx` - 主な修正箇所
- `web/src/app/page.tsx` - settingsLoaded対応（オプション）
- `web/src/types/index.ts` - AuthContextType拡張（オプション）

## 6. 修正提案（優先順位付き）

### Phase 1: 致命的バグ修正（P0）- 見積り: 1時間

#### Step 1.1: AuthContextでuseEffectパターンに変更

```typescript
// web/src/contexts/AuthContext.tsx

export function AuthProvider({ children }: AuthProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  
  // 修正: 初期値はdefaultSettingsで固定
  const [settings, setSettings] = useState<UserSettings>(defaultSettings);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // 追加: クライアントサイドでlocalStorageから設定を読み込む
  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem(SETTINGS_STORAGE_KEY);
      if (savedSettings) {
        const parsed = JSON.parse(savedSettings);
        setSettings((prev) => ({ ...prev, ...parsed }));
      }
    } catch (error) {
      console.error("Failed to load settings from localStorage:", error);
    }
    setSettingsLoaded(true);
  }, []);

  // ... rest of the code
  
  const value: AuthContextType = {
    user,
    setUser,
    isAuthenticated,
    isLoading,
    setIsLoading,
    settings,
    settingsLoaded, // 追加
    updateSettings,
    login,
    logout,
  };
```

#### Step 1.2: AuthContextType型の更新

```typescript
// web/src/types/index.ts または AuthContext.tsx内

interface AuthContextType {
  // ... existing fields
  settingsLoaded: boolean; // 追加
}
```

### Phase 2: UX改善（P1）- 見積り: 30分

#### Step 2.1: 録音ボタンのローディング状態対応（オプション）

```typescript
// web/src/app/page.tsx

const { settings, settingsLoaded } = useAuth();

// 設定読み込み完了まで録音開始を遅延
const handleStartRecording = useCallback(async () => {
  if (!settingsLoaded) {
    console.warn("Settings not loaded yet");
    return;
  }
  // ... existing logic
}, [settingsLoaded, /* ... */]);
```

### Phase 3: 堅牢性強化（P2）- 見積り: 1時間

#### Step 3.1: 設定変更時の即時反映確認

```typescript
// 設定変更後にページ遷移せずに録音を開始する場合の対応
// useSpeechRecognitionが最新のenableSpeakerDiarizationを使用していることを確認

// 現状: page.tsxでsettingsから取得しているので問題なし
const enableSpeakerDiarization = settings.enableSpeakerDiarization ?? false;
```

## 7. テスト戦略

### 7.1 手動テストシナリオ

| # | シナリオ | 期待結果 |
|---|---------|---------|
| 1 | 設定画面で話者分離を有効化 → 保存 → ページリロード | 設定が有効のまま表示される |
| 2 | 設定画面で話者分離を有効化 → 録音開始 | ConversationTranscriberが使用され、話者IDが表示される |
| 3 | 設定画面で話者分離を有効化 → ブラウザを閉じる → 再度開く | 設定が有効のまま |
| 4 | 設定画面で話者分離を無効化 → 録音開始 | SpeechRecognizerが使用され、話者IDは「Unknown」 |

### 7.2 開発者ツールでの確認方法

1. Application → Local Storage → `airecorder-settings` を確認
2. `enableSpeakerDiarization: true` が保存されていることを確認
3. ページリロード後、React DevToolsでAuthContextの `settings.enableSpeakerDiarization` を確認

## 8. 実装ロードマップ

| Step | 作業内容 | 見積り | 影響範囲 |
|------|---------|--------|---------|
| 1 | AuthContext.tsx の修正 | 30分 | 設定管理全体 |
| 2 | AuthContextType 型の更新 | 10分 | 型定義 |
| 3 | 手動テスト | 20分 | - |
| 4 | （オプション）録音ボタンのローディング対応 | 30分 | HomePage |

**合計見積り**: 約1.5時間

## 9. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| ハイドレーションミスマッチ警告 | 低 | 低 | useEffectでの読み込みにより回避 |
| 設定読み込み前の録音開始 | 中 | 中 | settingsLoaded フラグでガード |
| 他の設定項目への影響 | 低 | 低 | 同じパターンなので一括で修正される |

## 10. 結論

### 最大の問題点
- Next.jsのSSR環境で `useState` 初期化関数内で `localStorage` を読み込む設計が、ハイドレーション時に正しく動作しない

### 推奨する修正順序
1. **AuthContext.tsx** を `useEffect` パターンに修正（根本修正）
2. **settingsLoaded** フラグを追加してUI側で設定読み込み完了を判別可能に
3. 手動テストで動作確認

### 他 Issue への影響
- Issue #9（話者識別）: 本修正により、話者識別設定が正しく永続化される
- Issue #35（Speech Translation SDK）: 同様のSSR問題がある場合は同時に修正

### 判定: **GO**
- 修正は単純で影響範囲が限定的
- 根本原因が明確で、修正方針も確立されたパターン
- ユーザー体験に直接影響する問題なので早期修正を推奨
