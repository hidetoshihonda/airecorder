# Issue #135: 文字起こしと音声のタイムコード同期・タイムスタンプシーク — 実装計画書

## 概要

録音詳細画面（`/recording`）で文字起こしセグメントにタイムスタンプを表示し、クリックで音声シーク、再生中にハイライト同期 + 自動スクロールを実現する。

## 前提条件

- 分析レビュー: `docs/Issue135_タイムコード同期シーク_分析レビュー.md`
- 関連 Issue: #70 (LLM補正), #78 (再生速度), #120 (話者ラベル)
- ブロッカー: なし

---

## 実装詳細

### Step 1: State + Ref 追加

**ファイル**: `web/src/app/recording/page.tsx`

既存の state 定義（L108-112 付近）の直後に追加:

```tsx
// Issue #135: タイムコード同期
const [currentTime, setCurrentTime] = useState(0);
const [isAutoScroll, setIsAutoScroll] = useState(true);
const transcriptContainerRef = useRef<HTMLDivElement>(null);
const segmentRefs = useRef<Map<string, HTMLDivElement>>(new Map());
```

---

### Step 2: audio 要素に onTimeUpdate + onSeeked 追加

**ファイル**: `web/src/app/recording/page.tsx`

L706 付近の `<audio>` 要素を変更:

**Before**:
```tsx
<audio
  ref={audioRef}
  controls
  className="flex-1"
  src={audioUrl}
  onPlay={() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }}
>
```

**After**:
```tsx
<audio
  ref={audioRef}
  controls
  className="flex-1"
  src={audioUrl}
  onTimeUpdate={() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  }}
  onSeeked={() => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  }}
  onPlay={() => {
    if (audioRef.current) {
      audioRef.current.playbackRate = playbackRate;
    }
  }}
>
```

---

### Step 3: セグメントレンダリング + タイムスタンプ + シーク

**ファイル**: `web/src/app/recording/page.tsx`

L847-851 の fullText 表示部分を以下に置換:

**Before**:
```tsx
{displayTranscript?.fullText ? (
  <div className="max-h-[60vh] overflow-y-auto whitespace-pre-wrap rounded-md bg-gray-50 p-4 text-gray-800">
    {displayTranscript.fullText}
  </div>
```

**After**:
```tsx
{displayTranscript?.fullText ? (
  <div
    ref={transcriptContainerRef}
    className="max-h-[60vh] overflow-y-auto rounded-md bg-gray-50 p-2 sm:p-4"
    onScroll={() => {
      // ユーザーが手動スクロールした場合、自動追従を一時停止
      // (再生中かつ自動追従ONの場合のみ)
    }}
  >
    {displayTranscript.segments && displayTranscript.segments.length > 0 ? (
      <div className="space-y-0.5">
        {displayTranscript.segments.map((segment) => {
          const isActive =
            audioUrl &&
            currentTime >= segment.startTime &&
            currentTime < segment.endTime;
          return (
            <div
              key={segment.id}
              ref={(el) => {
                if (el) segmentRefs.current.set(segment.id, el);
                else segmentRefs.current.delete(segment.id);
              }}
              className={cn(
                "group flex gap-2 sm:gap-3 rounded-md px-2 py-1.5 transition-colors",
                isActive
                  ? "bg-blue-100 border-l-2 border-blue-500"
                  : "hover:bg-gray-100 border-l-2 border-transparent"
              )}
            >
              <button
                type="button"
                className={cn(
                  "shrink-0 text-xs font-mono mt-0.5 tabular-nums",
                  audioUrl
                    ? "text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
                    : "text-gray-400 cursor-default"
                )}
                onClick={() => {
                  if (audioRef.current && audioUrl) {
                    audioRef.current.currentTime = segment.startTime;
                    audioRef.current.play();
                    setIsAutoScroll(true);
                  }
                }}
                disabled={!audioUrl}
                title={audioUrl ? t("seekToTimestamp") : ""}
              >
                {formatDuration(Math.floor(segment.startTime))}
              </button>
              {segment.speaker && (
                <span className="shrink-0 text-xs font-medium text-purple-600 mt-0.5">
                  {segment.speaker}
                </span>
              )}
              <span className="text-sm text-gray-800 leading-relaxed">
                {segment.text}
              </span>
            </div>
          );
        })}
      </div>
    ) : (
      <div className="whitespace-pre-wrap text-gray-800 p-2">
        {displayTranscript.fullText}
      </div>
    )}
  </div>
```

---

### Step 4: 自動スクロール useEffect

**ファイル**: `web/src/app/recording/page.tsx`

displayTranscript の useMemo の後（L250 付近）に追加:

```tsx
// Issue #135: アクティブセグメントへの自動スクロール
useEffect(() => {
  if (!isAutoScroll || !displayTranscript?.segments) return;

  const activeSegment = displayTranscript.segments.find(
    (seg) => currentTime >= seg.startTime && currentTime < seg.endTime
  );

  if (activeSegment) {
    const el = segmentRefs.current.get(activeSegment.id);
    if (el && transcriptContainerRef.current) {
      const container = transcriptContainerRef.current;
      const elTop = el.offsetTop - container.offsetTop;
      const elBottom = elTop + el.offsetHeight;
      const scrollTop = container.scrollTop;
      const containerHeight = container.clientHeight;

      // 要素がコンテナの表示範囲外にある場合のみスクロール
      if (elTop < scrollTop || elBottom > scrollTop + containerHeight) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }
}, [currentTime, displayTranscript, isAutoScroll]);
```

---

### Step 5: 自動追従トグルボタン

**ファイル**: `web/src/app/recording/page.tsx`

トランスクリプト CardHeader 内（L831 付近）の既存コピーボタンの前に追加:

```tsx
{/* Issue #135: 自動追従トグル */}
{audioUrl && displayTranscript?.segments && displayTranscript.segments.length > 0 && (
  <Button
    variant={isAutoScroll ? "secondary" : "ghost"}
    size="sm"
    onClick={() => setIsAutoScroll(!isAutoScroll)}
    className="gap-1 text-xs"
  >
    {isAutoScroll ? t("autoScrollOn") : t("autoScrollOff")}
  </Button>
)}
```

---

### Step 6: i18n キー追加

#### `web/messages/ja.json` — RecordingDetail セクションに追加:

```json
"seekToTimestamp": "この位置から再生",
"autoScrollOn": "自動追従 ON",
"autoScrollOff": "自動追従 OFF"
```

#### `web/messages/en.json` — RecordingDetail セクションに追加:

```json
"seekToTimestamp": "Play from this position",
"autoScrollOn": "Auto-scroll ON",
"autoScrollOff": "Auto-scroll OFF"
```

#### `web/messages/es.json` — RecordingDetail セクションに追加:

```json
"seekToTimestamp": "Reproducir desde esta posición",
"autoScrollOn": "Seguimiento auto. ON",
"autoScrollOff": "Seguimiento auto. OFF"
```

---

### Step 7: segmentRefs クリーンアップ

displayTranscript 切替時に refs をリセット:

```tsx
// displayTranscript の useMemo の後に追加
useEffect(() => {
  segmentRefs.current.clear();
}, [displayTranscript]);
```

---

## 変更ファイル一覧

| ファイル | 変更種別 | 変更内容 |
|---------|---------|---------|
| `web/src/app/recording/page.tsx` | 変更 | state追加、audio イベント追加、セグメント表示、自動スクロール、トグル |
| `web/messages/ja.json` | 変更 | 3キー追加 (seekToTimestamp, autoScrollOn, autoScrollOff) |
| `web/messages/en.json` | 変更 | 3キー追加 |
| `web/messages/es.json` | 変更 | 3キー追加 |

**新規ファイル: なし**

---

## 受入基準チェックリスト

- [ ] 文字起こしの各セグメントにタイムスタンプ（MM:SS or HH:MM:SS）が表示される
- [ ] タイムスタンプクリックで音声が該当位置にシークする
- [ ] 音声再生中、現在のセグメントがハイライト（青背景 + 左ボーダー）される
- [ ] 再生進行に応じてトランスクリプト表示が自動スクロールする
- [ ] 自動追従 ON/OFF トグルが機能する
- [ ] segments が空の場合、fullText にフォールバック表示される
- [ ] AI補正版に切り替えても正常に動作する
- [ ] PC・モバイル両方で正常に動作する
- [ ] 多言語対応（ja/en/es）のUIラベル

---

## デプロイ手順

```bash
# 1. ブランチ作成
git checkout -b feat/issue-135-timecode-sync

# 2. 実装

# 3. ビルド確認
cd web && npm run build

# 4. コミット + プッシュ
git add -A
git commit -m "feat: add timecode sync, timestamp seek, highlight & auto-scroll (#135)"
git push origin feat/issue-135-timecode-sync

# 5. PR作成 + マージ

# 6. Azure SWA 自動デプロイ
```

---

*実装計画書作成日: 2025-07-13*  
*作成者: @ReviewAAgent*
