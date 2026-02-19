# PWA + iOSネイティブ風UI 実装計画書

## 1. エグゼクティブサマリー

AI Recorderを **Progressive Web App（PWA）** として構築し、iPhoneのネイティブアプリと遜色ない操作感を実現する。Apple Store申請不要でホーム画面追加→フルスクリーン起動を可能にし、ネイティブ風のナビゲーション・ジェスチャー・アニメーションを実装する。

**現状**: Web標準のPC向けレイアウト（トップヘッダー + フッター）、PWA対応ゼロ  
**目標**: iOSネイティブアプリと同等の体験（Standalone起動、タブバー、スムーズ遷移、Safe Area対応）

---

## 2. 現状分析

### 2.1 PWA対応状況: ❌ 未対応

| 項目 | 状態 |
|------|------|
| `manifest.webmanifest` | ❌ なし |
| Service Worker | ❌ なし |
| PWAプラグイン (next-pwa等) | ❌ なし |
| `apple-mobile-web-app-capable` | ❌ なし |
| `theme-color` メタタグ | ❌ なし |
| PWAアイコン (192/512px) | ❌ なし（SVGのみ） |
| apple-touch-icon | ❌ なし |
| スプラッシュスクリーン | ❌ なし |

### 2.2 モバイルUI状況: ⚠️ 部分的

| 項目 | 状態 |
|------|------|
| レスポンシブ (Tailwind `sm:`/`md:`) | ✅ 対応済み |
| `100dvh` ビューポート | ✅ メインページ使用 |
| `maximumScale: 1` | ✅ ピンチズーム無効 |
| BottomNavigation (タブバー) | ❌ なし（ハンバーガーメニュー） |
| ページ遷移アニメーション | ❌ なし |
| スワイプジェスチャー | ❌ なし |
| Safe Area (ノッチ/ホームバー) | ❌ なし |
| Haptic Feedback | ❌ なし |
| プルダウンリフレッシュ | ❌ なし |

### 2.3 技術スタック

- **Next.js 16.1.6** (`output: "export"` = SSG)
- **React 19.2.3**
- **Tailwind CSS v4**
- **Radix UI + shadcn/ui** コンポーネント
- **Azure Static Web Apps** デプロイ
- **Azure AD (MSAL)** 認証

### 2.4 現在のレイアウト構造

```
┌────────────────────────────┐
│ Header (sticky, 56px)      │  ← PC: ナビ3項目 / モバイル: ハンバーガー
│ Logo | Nav | Auth           │
├────────────────────────────┤
│                            │
│ Main Content               │  ← flex-1, overflow-hidden
│ (calc(100dvh - 56px))      │
│                            │
├────────────────────────────┤
│ Footer (border-t)          │  ← Copyright, Links, Tech Stack
│ © AI Voice Recorder        │
└────────────────────────────┘
```

### 2.5 `output: "export"` による制約

`next-pwa` 等のプラグインは SSR/ISR 前提のため使用不可。  
→ **手動 PWA 実装**（`public/` にファイル配置 + layout.tsx でメタ設定）が必要。

---

## 3. 目標: iOSネイティブ風の体験

### 3.1 iOSネイティブアプリの特徴的UX

| UX要素 | 説明 | 実装方針 |
|--------|------|----------|
| **タブバー (TabBar)** | 画面下部に常時表示、3-5項目 | BottomNavigation コンポーネント新規作成 |
| **ナビゲーションバー** | 画面上部、タイトル + 戻るボタン | コンパクトヘッダー（モバイル時変更） |
| **スムーズ遷移** | プッシュ/ポップのスライドアニメーション | framer-motion or View Transitions API |
| **Safe Area** | ノッチ・Dynamic Island・ホームバー回避 | `env(safe-area-inset-*)` CSS |
| **Haptic Feedback** | 操作確認の振動 | `navigator.vibrate()` |
| **プルダウンリフレッシュ** | リスト上部で引っ張って更新 | カスタム実装 or ライブラリ |
| **スプラッシュスクリーン** | 起動時のブランドスクリーン | `apple-touch-startup-image` |
| **全画面表示** | ブラウザUIなし | `display: standalone` |
| **角丸カード** | iOS風のグルーピング | Tailwind `rounded-xl` |
| **ブラー背景** | ナビバーの `backdrop-blur` | `backdrop-blur-xl bg-white/80` |

### 3.2 理想レイアウト（モバイル Standalone時）

```
┌────────────────────────────┐
│ Safe Area Top (Dynamic Is.) │  ← env(safe-area-inset-top)
├────────────────────────────┤
│ NavBar (44px, blur)        │  ← タイトル + 戻る/アクション
│ 「AI Recorder」             │
├────────────────────────────┤
│                            │
│ Scrollable Content         │  ← flex-1
│                            │
│                            │
├────────────────────────────┤
│ TabBar (49px + safe-area)  │  ← 録音 / 履歴 / 設定
│ 🎙️  📋  ⚙️               │
│ Safe Area Bottom           │  ← env(safe-area-inset-bottom)
└────────────────────────────┘
```

---

## 4. 実装フェーズ

### Phase 1: PWA基盤（ホーム画面追加可能にする）
### Phase 2: iOSネイティブ風レイアウト（タブバー + ナビバー）
### Phase 3: アニメーション & ジェスチャー
### Phase 4: オフライン & 高度な機能

---

## 5. Phase 1: PWA基盤 🔴 P0

**目的**: iPhoneでホーム画面に追加 → Standaloneモードで起動可能にする

### 5.1 Web App Manifest の作成

**ファイル**: `web/public/manifest.webmanifest` (新規)

```json
{
  "name": "AI Recorder - リアルタイム文字起こし＆翻訳",
  "short_name": "AI Recorder",
  "description": "音声を録音して、リアルタイムで文字起こしと多言語翻訳",
  "start_url": "/",
  "scope": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#ffffff",
  "theme_color": "#2563eb",
  "categories": ["productivity", "utilities"],
  "icons": [
    {
      "src": "/icons/icon-72x72.png",
      "sizes": "72x72",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-96x96.png",
      "sizes": "96x96",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-128x128.png",
      "sizes": "128x128",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-144x144.png",
      "sizes": "144x144",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-152x152.png",
      "sizes": "152x152",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-192x192.png",
      "sizes": "192x192",
      "type": "image/png",
      "purpose": "any maskable"
    },
    {
      "src": "/icons/icon-384x384.png",
      "sizes": "384x384",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512x512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

### 5.2 アイコン画像の生成

**ツール**: `@vite-pwa/assets-generator` または手動作成

必要ファイル（`web/public/icons/` 配下）:

| ファイル | サイズ | 用途 |
|----------|--------|------|
| `icon-72x72.png` | 72×72 | Android |
| `icon-96x96.png` | 96×96 | Android |
| `icon-128x128.png` | 128×128 | Android |
| `icon-144x144.png` | 144×144 | Android |
| `icon-152x152.png` | 152×152 | iOS |
| `icon-192x192.png` | 192×192 | PWA標準 |
| `icon-384x384.png` | 384×384 | PWA |
| `icon-512x512.png` | 512×512 | PWA標準 |
| `apple-touch-icon.png` | 180×180 | iOS ホーム画面 |

**デザイン方針**:
- 背景: ブルーグラデーション (#2563eb → #1d4ed8)
- アイコン: 白いマイクアイコン（角丸四角形）
- iOS風の角丸・光沢感

### 5.3 layout.tsx にPWAメタタグ追加

**変更ファイル**: `web/src/app/layout.tsx`

```typescript
export const metadata: Metadata = {
  // ... 既存設定に追加
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "AI Recorder",
  },
  other: {
    "mobile-web-app-capable": "yes",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",  // ← Safe Area用に追加
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};
```

### 5.4 apple-touch-icon リンク追加

layout.tsx の `<head>` に追加:

```tsx
<head>
  <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
  {/* iOS スプラッシュスクリーン（主要デバイス向け） */}
  <link rel="apple-touch-startup-image"
    media="(device-width: 430px) and (device-height: 932px) and (-webkit-device-pixel-ratio: 3)"
    href="/icons/splash-1290x2796.png" />
  <link rel="apple-touch-startup-image"
    media="(device-width: 393px) and (device-height: 852px) and (-webkit-device-pixel-ratio: 3)"
    href="/icons/splash-1179x2556.png" />
  <link rel="apple-touch-startup-image"
    media="(device-width: 390px) and (device-height: 844px) and (-webkit-device-pixel-ratio: 3)"
    href="/icons/splash-1170x2532.png" />
  <link rel="apple-touch-startup-image"
    media="(device-width: 375px) and (device-height: 812px) and (-webkit-device-pixel-ratio: 3)"
    href="/icons/splash-1125x2436.png" />
</head>
```

### 5.5 Service Worker (基本版)

**ファイル**: `web/public/sw.js` (新規)

```javascript
const CACHE_NAME = 'ai-recorder-v1';
const STATIC_ASSETS = [
  '/',
  '/history/',
  '/settings/',
  '/manifest.webmanifest',
  '/icons/icon-192x192.png',
  '/icons/icon-512x512.png',
];

// インストール: 静的アセットをプリキャッシュ
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

// アクティベート: 古いキャッシュを削除
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// フェッチ: Network First (API) / Stale While Revalidate (静的)
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // API リクエストは常にネットワーク優先
  if (url.pathname.startsWith('/api/') || url.hostname !== self.location.hostname) {
    event.respondWith(
      fetch(request).catch(() => caches.match(request))
    );
    return;
  }

  // 静的アセット: Stale While Revalidate
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request).then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
        }
        return response;
      });
      return cached || fetchPromise;
    })
  );
});
```

### 5.6 Service Worker 登録コンポーネント

**ファイル**: `web/src/components/ServiceWorkerRegistration.tsx` (新規)

```tsx
"use client";

import { useEffect } from "react";

export function ServiceWorkerRegistration() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js")
        .then((reg) => {
          console.log("[SW] Registered:", reg.scope);
          // 更新検知
          reg.addEventListener("updatefound", () => {
            const newWorker = reg.installing;
            if (newWorker) {
              newWorker.addEventListener("statechange", () => {
                if (newWorker.state === "activated") {
                  // 新バージョン利用可能 → リロード促進
                  if (confirm("新しいバージョンがあります。更新しますか？")) {
                    window.location.reload();
                  }
                }
              });
            }
          });
        })
        .catch((err) => console.error("[SW] Registration failed:", err));
    }
  }, []);

  return null;
}
```

### 5.7 Providers に追加

**変更ファイル**: `web/src/components/providers/Providers.tsx`

```tsx
import { ServiceWorkerRegistration } from "@/components/ServiceWorkerRegistration";

// ... 既存のProviders内に追加
<ServiceWorkerRegistration />
```

### 5.8 staticwebapp.config.json 更新

manifest と Service Worker の正しいMIME配信を保証:

```json
{
  "mimeTypes": {
    ".webmanifest": "application/manifest+json"
  }
}
```

### Phase 1 変更ファイル一覧

| 操作 | ファイル |
|------|---------|
| 新規 | `web/public/manifest.webmanifest` |
| 新規 | `web/public/sw.js` |
| 新規 | `web/public/icons/` (9ファイル) |
| 新規 | `web/src/components/ServiceWorkerRegistration.tsx` |
| 変更 | `web/src/app/layout.tsx` (metadata + viewport + head) |
| 変更 | `web/src/components/providers/Providers.tsx` |
| 変更 | `web/staticwebapp.config.json` |

### Phase 1 見積り: 3-4時間

---

## 6. Phase 2: iOSネイティブ風レイアウト 🟡 P1

**目的**: タブバー、ナビバー、Safe Area対応でネイティブ級のレイアウトに変更

### 6.1 BottomNavigation コンポーネント

**ファイル**: `web/src/components/layout/BottomNav.tsx` (新規)

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Mic, History, Settings } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const tabs = [
  { key: "recording" as const, href: "/", icon: Mic },
  { key: "history" as const, href: "/history", icon: History },
  { key: "settings" as const, href: "/settings", icon: Settings },
];

export function BottomNav() {
  const pathname = usePathname();
  const t = useTranslations("Header");

  return (
    <nav className={cn(
      "fixed bottom-0 left-0 right-0 z-50 md:hidden",
      "border-t border-gray-200/60 dark:border-gray-700/60",
      "bg-white/80 backdrop-blur-xl dark:bg-gray-900/80",
      "pb-[env(safe-area-inset-bottom)]"
    )}>
      <div className="flex items-center justify-around px-2 pt-2 pb-1">
        {tabs.map((tab) => {
          const isActive = tab.href === "/"
            ? pathname === "/"
            : pathname.startsWith(tab.href);
          return (
            <Link
              key={tab.key}
              href={tab.href}
              className={cn(
                "flex flex-col items-center gap-0.5 rounded-lg px-4 py-1",
                "transition-colors duration-200",
                "active:scale-95 active:opacity-70",
                isActive
                  ? "text-blue-600 dark:text-blue-400"
                  : "text-gray-400 dark:text-gray-500"
              )}
            >
              <tab.icon
                className={cn("h-6 w-6", isActive && "stroke-[2.5]")}
              />
              <span className={cn(
                "text-[10px] leading-tight",
                isActive ? "font-semibold" : "font-medium"
              )}>
                {t(tab.key)}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
```

### 6.2 ナビバー (iOS風ヘッダー) への変更

**変更ファイル**: `web/src/components/layout/Header.tsx`

モバイル時のヘッダーをiOS風ナビゲーションバーに変更:

```
変更点:
- モバイル時: ハンバーガーメニュー廃止 → コンパクトなタイトルバーに
- 高さ: 44px (iOS標準)
- 背景: backdrop-blur-xl でブラー効果
- Safe Area上部: env(safe-area-inset-top) パディング
- デスクトップ時: 現状のナビゲーションを維持
```

ヘッダーの構造変更:

```tsx
// モバイル版 (md以下)
<header className={cn(
  "sticky top-0 z-50 w-full",
  "bg-white/80 backdrop-blur-xl dark:bg-gray-900/80",
  "border-b border-gray-200/60 dark:border-gray-700/60",
  "pt-[env(safe-area-inset-top)]"  // Safe Area対応
)}>
  {/* モバイル: コンパクトナビバー (44px) */}
  <div className="flex h-11 items-center justify-between px-4 md:hidden">
    <span className="text-lg font-semibold">AI Recorder</span>
    <div className="flex items-center gap-2">
      {/* 言語切替・ユーザーアイコン */}
    </div>
  </div>
  
  {/* デスクトップ: 既存ナビゲーション維持 */}
  <nav className="hidden md:flex ...">
    {/* 既存の PC ナビゲーション */}
  </nav>
</header>
```

### 6.3 レイアウト構造の変更

**変更ファイル**: `web/src/app/layout.tsx`

```tsx
export default function RootLayout({ children }) {
  return (
    <html lang="ja" suppressHydrationWarning>
      <head>
        <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
      </head>
      <body className={`${inter.variable} font-sans antialiased`}>
        <Providers>
          <div className="flex min-h-[100dvh] flex-col">
            <Header />
            <main className={cn(
              "min-h-0 flex-1 overflow-hidden",
              // モバイル時: BottomNav分のパディング
              "pb-[calc(49px+env(safe-area-inset-bottom))] md:pb-0"
            )}>
              {children}
            </main>
            {/* デスクトップのみFooter表示 */}
            <div className="hidden md:block">
              <Footer />
            </div>
            {/* モバイルのみBottomNav表示 */}
            <BottomNav />
          </div>
        </Providers>
      </body>
    </html>
  );
}
```

### 6.4 Safe Area CSS対応

**変更ファイル**: `web/src/app/globals.css`

```css
/* iOS PWA Safe Area 対応 */
@supports (padding: env(safe-area-inset-top)) {
  :root {
    --sat: env(safe-area-inset-top);
    --sab: env(safe-area-inset-bottom);
    --sal: env(safe-area-inset-left);
    --sar: env(safe-area-inset-right);
  }
}

/* Standalone モード判定 */
@media (display-mode: standalone) {
  body {
    /* PWAとして起動時の追加調整 */
    overscroll-behavior-y: none; /* バウンススクロール抑制 */
    -webkit-user-select: none;   /* テキスト選択抑制（入力欄除く） */
    user-select: none;
  }

  input, textarea, [contenteditable] {
    -webkit-user-select: text;
    user-select: text;
  }
}

/* iOS風のタッチフィードバック */
.tap-highlight {
  -webkit-tap-highlight-color: transparent;
}

.active\:scale-95:active {
  transform: scale(0.95);
  transition: transform 0.1s ease;
}
```

### 6.5 録音ページのモバイル最適化

**変更ファイル**: `web/src/app/page.tsx`

録音コントロールバーの高さ調整:

```
変更点:
- h-[calc(100dvh-56px)] → h-[calc(100dvh-44px-49px-env(safe-area-inset-top)-env(safe-area-inset-bottom))]
  (ナビバー44px + タブバー49px + Safe Area)
- BottomNav と重ならないよう padding-bottom 追加
```

### 6.6 履歴ページのiOS風リストUI

**変更ファイル**: `web/src/app/history/page.tsx`

```
変更点:
- カード → iOS風のグループ化されたリスト（rounded-xl bg-white shadow-sm）
- セクションヘッダー（日付別グルーピング）
- リスト項目のシェブロン（>）表示
- `active:bg-gray-100` のタッチフィードバック
```

### 6.7 設定ページのiOS風UI

**変更ファイル**: `web/src/app/settings/page.tsx`

```
変更点:
- カード → iOS設定アプリ風のグループ化されたリスト
- セクションタイトル（大文字、グレー、小さめ）
- トグルスイッチ → iOS風のデザイン
- Disclosure indicator（>）
- inset-grouped スタイル（角丸、マージン）
```

### Phase 2 変更ファイル一覧

| 操作 | ファイル |
|------|---------|
| 新規 | `web/src/components/layout/BottomNav.tsx` |
| 変更 | `web/src/components/layout/Header.tsx` |
| 変更 | `web/src/app/layout.tsx` |
| 変更 | `web/src/app/globals.css` |
| 変更 | `web/src/app/page.tsx` (高さ計算調整) |
| 変更 | `web/src/app/history/page.tsx` (iOS風リスト) |
| 変更 | `web/src/app/settings/page.tsx` (iOS風設定UI) |

### Phase 2 見積り: 6-8時間

---

## 7. Phase 3: アニメーション & ジェスチャー 🟢 P2

**目的**: ネイティブレベルのスムーズなインタラクション

### 7.1 ページ遷移アニメーション

**方法**: `framer-motion` を使用

**パッケージ追加**: `npm install framer-motion`

**ファイル**: `web/src/components/PageTransition.tsx` (新規)

```tsx
"use client";

import { motion, AnimatePresence } from "framer-motion";
import { usePathname } from "next/navigation";

const variants = {
  initial: { opacity: 0, x: 20 },
  in: { opacity: 1, x: 0 },
  out: { opacity: 0, x: -20 },
};

const transition = {
  type: "tween",
  ease: "easeInOut",
  duration: 0.2,
};

export function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={pathname}
        initial="initial"
        animate="in"
        exit="out"
        variants={variants}
        transition={transition}
        className="h-full"
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}
```

### 7.2 スワイプバックジェスチャー

**ファイル**: `web/src/hooks/useSwipeBack.ts` (新規)

```
- 画面左端からの右スワイプを検出
- router.back() を呼び出し
- 閾値: 100px以上のスワイプ距離
- 録音ページでは無効化（誤操作防止）
```

### 7.3 プルダウンリフレッシュ

**対象ページ**: `/history` (録音履歴)

```
- overscroll-behavior: none でブラウザデフォルト抑制
- touchstart / touchmove / touchend でカスタム実装
- 60px 以上引っ張ると更新トリガー
- リフレッシュインジケーター表示（iOS風スピナー）
```

### 7.4 Haptic Feedback

**対象操作**: 録音開始/停止、保存完了、コピー成功

```typescript
function haptic(style: "light" | "medium" | "heavy" = "medium") {
  if ("vibrate" in navigator) {
    const patterns = { light: [10], medium: [20], heavy: [30] };
    navigator.vibrate(patterns[style]);
  }
}
```

### 7.5 iOS風モーダル（ハーフシート）

```
- Dialog の下からスライドイン
- ドラッグで閉じる（下方向スワイプ）
- backdrop-blur 背景
- 上部にグラブハンドル表示
```

### 7.6 iOS風アラート/アクションシート

```
- 既存の Dialog をアクションシートスタイルに変更（モバイル時）
- 画面下部から出現
- 角丸、キャンセルボタン分離
```

### Phase 3 変更ファイル一覧

| 操作 | ファイル |
|------|---------|
| 追加 | `package.json` (framer-motion依存追加) |
| 新規 | `web/src/components/PageTransition.tsx` |
| 新規 | `web/src/hooks/useSwipeBack.ts` |
| 新規 | `web/src/hooks/usePullToRefresh.ts` |
| 新規 | `web/src/lib/haptic.ts` |
| 新規 | `web/src/components/ui/action-sheet.tsx` |
| 変更 | `web/src/app/layout.tsx` (PageTransition組み込み) |
| 変更 | `web/src/app/page.tsx` (haptic追加) |
| 変更 | `web/src/app/history/page.tsx` (PullToRefresh追加) |

### Phase 3 見積り: 5-6時間

---

## 8. Phase 4: オフライン & 高度な機能 🟢 P3

**目的**: ネイティブアプリに匹敵するオフライン体験と高度な機能

### 8.1 Workbox によるService Worker最適化

```
npm install --save-dev workbox-cli
```

```
キャッシュ戦略:
├── App Shell (HTML/JS/CSS): StaleWhileRevalidate
├── API (録音データ): NetworkFirst + IndexedDB fallback
├── 音声ファイル (.webm): CacheFirst (変更なし)
├── フォント: CacheFirst (長期)
└── アイコン/画像: CacheFirst
```

### 8.2 オフラインインジケーター

**ファイル**: `web/src/components/OfflineIndicator.tsx` (新規)

```
- navigator.onLine + online/offline イベント監視
- オフライン時: 画面上部に「オフライン」バナー表示
- 復帰時: 自動で非表示
```

### 8.3 IndexedDB による録音データオフライン保存

```
- 新規録音をIndexedDBに一時保存
- オンライン復帰時にAPIへ同期
- バックグラウンド同期（Background Sync API）
```

### 8.4 Web Share API

```
- 録音詳細画面の「共有」ボタン追加
- テキスト（文字起こし/翻訳/議事録）の共有
- 音声ファイルの共有
```

### 8.5 App Badge API

```
- 未確認の録音数をアプリバッジに表示
- navigator.setAppBadge() / navigator.clearAppBadge()
```

### Phase 4 見積り: 8-10時間

---

## 9. i18n メッセージ追加

新規UIコンポーネントに必要なメッセージ（Phase 2用）:

```json
// ja.json
{
  "BottomNav": {
    "recording": "録音",
    "history": "履歴",
    "settings": "設定"
  },
  "PWA": {
    "newVersionAvailable": "新しいバージョンがあります。更新しますか？",
    "offlineMessage": "オフラインです",
    "installPrompt": "ホーム画面に追加して、アプリとして使えます"
  }
}

// en.json
{
  "BottomNav": {
    "recording": "Record",
    "history": "History",
    "settings": "Settings"
  },
  "PWA": {
    "newVersionAvailable": "A new version is available. Update?",
    "offlineMessage": "You are offline",
    "installPrompt": "Add to Home Screen to use as an app"
  }
}

// es.json
{
  "BottomNav": {
    "recording": "Grabar",
    "history": "Historial",
    "settings": "Ajustes"
  },
  "PWA": {
    "newVersionAvailable": "Nueva versión disponible. ¿Actualizar?",
    "offlineMessage": "Sin conexión",
    "installPrompt": "Añadir a pantalla de inicio para usar como app"
  }
}
```

---

## 10. iOS PWA 固有の注意点

### 10.1 iOS Safari の PWA 制限

| 制約 | 影響 | 対策 |
|------|------|------|
| Push Notification | iOS 16.4+ で対応 | Web Push API 実装可 |
| Background Audio | Standalone でも動作 | `<audio>` タグによる再生は問題なし |
| マイク使用 | Standalone で動作 | `getUserMedia()` は使用可 |
| Service Worker | iOS 11.3+ で対応 | ✅ 問題なし |
| 50MB キャッシュ制限 | 音声ファイルの大量キャッシュ不可 | APIから都度取得（SAS URL使用済み） |
| バックグラウンド制限 | タブ非表示で停止 | 録音中は画面維持を促す |
| `display: standalone` | iOS対応 | ✅ 問題なし |
| `beforeinstallprompt` | iOS非対応 | 手動「ホーム画面に追加」案内を表示 |

### 10.2 iOS固有のUX対策

```
1. ラバーバンドスクロール抑制:
   - overscroll-behavior: none (Standalone時)

2. 300ms タッチ遅延:
   - touch-action: manipulation で解消
   - viewport maximumScale=1 で既に解消済み

3. Safe Area:
   - viewport-fit: cover でフルスクリーン
   - env(safe-area-inset-*) でパディング

4. ステータスバーの色:
   - apple-mobile-web-app-status-bar-style: default (白背景に黒テキスト)
   - ダークモード時: black-translucent
```

### 10.3 「ホーム画面に追加」促進バナー

iOS では `beforeinstallprompt` イベントが発火しないため、独自のインストール案内を表示:

```
- 初回訪問時にバナー表示:「ホーム画面に追加してアプリとして使えます」
- 手順アニメーション: 共有ボタン → 「ホーム画面に追加」を案内
- 1回閉じたら localStorage で記憶（再表示しない）
- Standalone起動時は表示しない
```

---

## 11. 実装ロードマップ

| Phase | Step | 作業内容 | 見積り | 前提 |
|-------|------|---------|--------|------|
| **1** | 1.1 | manifest.webmanifest 作成 | 0.5h | - |
| **1** | 1.2 | アイコン画像生成 (9ファイル) | 1h | デザイン決定 |
| **1** | 1.3 | layout.tsx にPWAメタタグ追加 | 0.5h | - |
| **1** | 1.4 | Service Worker (基本版) 作成 | 1h | - |
| **1** | 1.5 | SW登録コンポーネント + Providers 連携 | 0.5h | 1.4 |
| **1** | 1.6 | staticwebapp.config.json 更新 | 0.5h | - |
| **2** | 2.1 | BottomNav コンポーネント作成 | 1h | - |
| **2** | 2.2 | Header iOS風ナビバー変更 | 1.5h | - |
| **2** | 2.3 | layout.tsx 構造変更 (BottomNav+SafeArea) | 1h | 2.1, 2.2 |
| **2** | 2.4 | globals.css Safe Area + Standalone対応 | 0.5h | - |
| **2** | 2.5 | 各ページ高さ計算調整 | 1h | 2.3 |
| **2** | 2.6 | 履歴ページ iOS風リストUI | 1.5h | - |
| **2** | 2.7 | 設定ページ iOS風UI | 1.5h | - |
| **3** | 3.1 | framer-motion 導入 + PageTransition | 1.5h | - |
| **3** | 3.2 | スワイプバックジェスチャー | 1h | 3.1 |
| **3** | 3.3 | プルダウンリフレッシュ | 1.5h | - |
| **3** | 3.4 | Haptic Feedback 追加 | 0.5h | - |
| **3** | 3.5 | iOS風アクションシート | 1h | - |
| **4** | 4.1 | Workbox SW最適化 | 2h | 1.4 |
| **4** | 4.2 | オフラインインジケーター | 1h | - |
| **4** | 4.3 | IndexedDB オフライン保存 | 3h | 4.1 |
| **4** | 4.4 | Web Share API | 1h | - |
| **4** | 4.5 | ホーム画面追加促進バナー | 1h | 1.1 |

### 合計見積り

| Phase | 内容 | 見積り |
|-------|------|--------|
| Phase 1 | PWA基盤 | 3-4h |
| Phase 2 | iOSネイティブ風レイアウト | 6-8h |
| Phase 3 | アニメーション & ジェスチャー | 5-6h |
| Phase 4 | オフライン & 高度な機能 | 8-10h |
| **合計** | | **22-28h** |

---

## 12. リスクアセスメント

| リスク | 確率 | 影響度 | 対策 |
|--------|------|--------|------|
| iOS Safari の Service Worker 不安定 | 中 | 中 | SW なしでも動作するよう Progressive Enhancement |
| framer-motion のバンドルサイズ増大 | 低 | 低 | dynamic import + tree shaking |
| `output: "export"` と SW の不整合 | 低 | 高 | `public/sw.js` 手動管理で回避済み |
| iOS キャッシュ50MB制限 | 中 | 低 | 音声はAPIからSAS URLで都度取得（キャッシュ不要） |
| Standalone時のOAuth認証フロー | 中 | 高 | SWA Easy Auth はリダイレクト型なので動作確認必須 |
| BottomNav + 録音コントロール表示域の競合 | 高 | 中 | 録音中はBottomNavを最小化/非表示にする |

---

## 13. 結論

### 推奨実装順序

1. **Phase 1 (PWA基盤)** → まず「ホーム画面に追加」でStandalone起動を実現  
2. **Phase 2 (ネイティブ風レイアウト)** → タブバー + ナビバーで操作感を大幅改善  
3. **Phase 3 (アニメーション)** → スムーズ遷移でネイティブ感を完成  
4. **Phase 4 (オフライン)** → 信頼性向上（Nice to have）

### 最大のインパクト

**Phase 1 + Phase 2** だけで、ユーザー体験は劇的に変わる:
- ブラウザUI消滅 → フルスクリーンのアプリ体験
- ハンバーガーメニュー廃止 → ワンタップのタブバー
- Safe Area対応 → ノッチ/ホームバーと共存

### 判定: `GO`

技術的リスクは低く、段階的に実装可能。Phase 1 + 2 の **約10-12時間** で iOSネイティブ風の体験を実現できる。
