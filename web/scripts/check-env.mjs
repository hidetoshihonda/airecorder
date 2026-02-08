/**
 * ビルド前環境変数チェックスクリプト
 * 
 * npm run build を実行すると自動的にこのスクリプトが走り、
 * 必須の NEXT_PUBLIC_* 環境変数が未設定の場合はビルドを中断する。
 * 
 * 背景:
 *   Next.js の output:"export" (静的エクスポート) では NEXT_PUBLIC_* は
 *   ビルド時にバンドルに埋め込まれる。.env.local なしでビルドすると
 *   空文字列が埋め込まれ、デプロイ後に「API設定が必要です」エラーが出る。
 *   deploy.ps1 にはチェックがあったが、直接 npm run build を叩くと
 *   バイパスされてしまうため、ビルドプロセス自体にガードを組み込む。
 * 
 * CI環境:
 *   GitHub Actions では secrets から env に注入されるため問題なく通過する。
 */

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const webDir = resolve(__dirname, "..");

// ─── 必須環境変数の定義 ───
const REQUIRED_VARS = [
  {
    name: "NEXT_PUBLIC_AZURE_SPEECH_KEY",
    description: "Azure Speech Services API キー",
  },
  {
    name: "NEXT_PUBLIC_AZURE_SPEECH_REGION",
    description: "Azure Speech Services リージョン",
  },
  {
    name: "NEXT_PUBLIC_AZURE_TRANSLATOR_KEY",
    description: "Azure Translator API キー",
  },
];

// ─── .env.local からの読み込み ───
function loadEnvFile() {
  const envPath = resolve(webDir, ".env.local");
  if (!existsSync(envPath)) return {};

  const content = readFileSync(envPath, "utf-8");
  const vars = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();
    // Remove surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    vars[key] = value;
  }
  return vars;
}

// ─── チェック実行 ───
function main() {
  // CI環境かどうか（GitHub Actions は CI=true を設定する）
  const isCI = process.env.CI === "true";

  // .env.local の値を process.env にマージ（process.env が優先）
  if (!isCI) {
    const envFileVars = loadEnvFile();
    for (const [key, value] of Object.entries(envFileVars)) {
      if (!process.env[key]) {
        process.env[key] = value;
      }
    }
  }

  const missing = [];
  const placeholder = [];

  for (const v of REQUIRED_VARS) {
    const value = process.env[v.name];
    if (!value) {
      missing.push(v);
    } else if (value.match(/^your-.*-here$/)) {
      placeholder.push(v);
    }
  }

  if (missing.length === 0 && placeholder.length === 0) {
    console.log("✅ 環境変数チェック OK — 全ての必須変数が設定されています");
    return;
  }

  // ─── エラー出力 ───
  console.error("");
  console.error("╔══════════════════════════════════════════════════════════╗");
  console.error("║  ❌ ビルド中断: 必須環境変数が未設定です                  ║");
  console.error("╚══════════════════════════════════════════════════════════╝");
  console.error("");

  if (missing.length > 0) {
    console.error("  未設定の変数:");
    for (const v of missing) {
      console.error(`    ❌ ${v.name} — ${v.description}`);
    }
  }

  if (placeholder.length > 0) {
    console.error("  プレースホルダーのまま:");
    for (const v of placeholder) {
      console.error(`    ⚠️  ${v.name} — ${v.description}`);
    }
  }

  console.error("");
  console.error("  対処法:");
  console.error("    1. .env.local を作成して必須変数を設定する");
  console.error("       cp .env.local.example .env.local  (初回のみ)");
  console.error("    2. または deploy.ps1 -AutoFix で Azure から自動取得する");
  console.error("       .\\scripts\\deploy.ps1 -AutoFix");
  console.error("");
  console.error("  ℹ️  Next.js の静的エクスポートでは NEXT_PUBLIC_* はビルド時に");
  console.error("     バンドルに埋め込まれます。未設定のままビルドすると");
  console.error("     デプロイ後に「API設定が必要です」エラーが表示されます。");
  console.error("");

  process.exit(1);
}

main();
