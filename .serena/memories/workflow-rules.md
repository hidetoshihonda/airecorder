# GitHub ワークフロー規則 - 再発防止策

## 今回の問題点
1. **rebase中にブランチを切り替えた** → コンフリクト地獄
2. **複数のブランチで同時作業** → 混乱
3. **CIを待たずにマージ試行** → 失敗の連続
4. **ローカルとリモートの状態確認不足** → 無駄な作業

---

## 必須ワークフロー（GitHub Flow）

### 1. 作業開始前（毎回必須）
```bash
# 必ずmainを最新にしてから作業開始
git checkout main
git pull origin main
git status  # クリーンな状態を確認
```

### 2. ブランチ作成（1機能 = 1ブランチ）
```bash
# mainから直接ブランチを作成
git checkout -b fix/issue-name
```
**命名規則**: `fix/`, `feat/`, `docs/`, `refactor/` + 説明的な名前

### 3. 開発中
```bash
# こまめにコミット（1コミット = 1変更）
git add <specific-files>
git commit -m "fix: 説明"

# プッシュ前にローカルでlint確認
npm run lint
```

### 4. PR作成前（必須チェック）
```bash
# ローカルでlintが通ることを確認
cd web && npm run lint

# エラーがある場合は修正してからプッシュ
```

### 5. PRマージ
```bash
# CIが完了するまで待つ（約2分）
gh pr checks <PR番号> --watch

# CIが通ったらマージ
gh pr merge <PR番号> --merge
```

---

## 禁止事項

### ❌ 絶対にやってはいけないこと
1. **rebase中にブランチを切り替えない**
2. **CIが通る前にadmin mergeしない**
3. **mainブランチで直接作業しない**
4. **複数の機能を1ブランチで作業しない**

### ❌ rebase状態になったら
```bash
# すぐに中止してやり直す
git rebase --abort
git checkout main
git pull origin main
# 新しいブランチで最初からやり直し
```

---

## CI失敗時の対処

### ESLintエラーの場合
1. ローカルで `npm run lint` を実行
2. エラーを修正
3. 再コミット＆プッシュ
4. CIを待つ

### コンフリクトの場合
1. mainを最新にする
2. ブランチでmerge main（rebaseではなく）
3. コンフリクト解決
4. 再プッシュ

---

## ドキュメント配置ルール

### 統一フォルダ: `docs/`（ルート直下）

- **全ての分析レビュー・実装計画書は `docs/` に配置**
- `web/docs/` は **廃止済み**（使用禁止）
- `docs/` はプロジェクト横断（web / api 共通）のドキュメント置き場
- 命名規則: `Issue{番号}_{概要}_{種別}.md`
  - 種別: `分析レビュー`, `実装計画書`, `深掘り分析` 等

### ❌ やってはいけないこと
- `web/docs/` にドキュメントを作成する
- サブプロジェクト内にドキュメントフォルダを作る

---

## 推奨ツール設定

### pre-commitフック（将来追加推奨）
```bash
# .husky/pre-commit
npm run lint
```

### VS Code設定
- ESLint拡張機能を有効化
- 保存時に自動lint

---

## チェックリスト（作業前に確認）

- [ ] mainブランチが最新か
- [ ] git statusがクリーンか
- [ ] 新しいブランチを作成したか
- [ ] ローカルでlintが通るか
- [ ] CIが完了してからマージしたか
