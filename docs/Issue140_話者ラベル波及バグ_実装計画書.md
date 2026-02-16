# Issue #140: 話者ラベル波及バグ — 実装計画書

## 概要

話者ラベルの永続化方式を **グローバル localStorage** → **各 Recording ドキュメント内の `speakerLabels` フィールド** に移行する。  
併せて保存時の speaker ID 破壊的上書きを修正し、元の SDK speaker ID を保持する。

---

## 変更ファイル一覧

| # | ファイル | 変更種別 | 内容 |
|---|---------|---------|------|
| 1 | `api/src/models/recording.ts` | 型追加 | `Recording` / `CreateRecordingRequest` / `UpdateRecordingRequest` に `speakerLabels?` 追加 |
| 2 | `web/src/types/index.ts` | 型追加 | `Recording` に `speakerLabels?` 追加 |
| 3 | `web/src/hooks/useSpeakerManager.ts` | リファクタ | localStorage 読み書き全削除、`getSpeakerLabelsMap()` 追加 |
| 4 | `web/src/app/page.tsx` | バグ修正 | 保存処理: `speaker: seg.speaker`（元ID保持）、`speakerLabels` 送信 |
| 5 | `web/src/app/recording/page.tsx` | 表示改善 | `speakerLabels` マッピングで話者名表示 |
| 6 | `web/src/services/api.ts` | 型整合 | createRecording の引数型に `speakerLabels` が含まれることを確認（型が通ればOK） |

---

## Step 1: API モデル型の拡張

**ファイル**: `api/src/models/recording.ts`

### Recording インターフェース

```ts
export interface Recording {
  // ... 既存フィールド
  speakerLabels?: Record<string, string>; // 追加: { "Guest-1": "田中", "Guest-2": "佐藤" }
}
```

### CreateRecordingRequest

```ts
export interface CreateRecordingRequest {
  // ... 既存フィールド
  speakerLabels?: Record<string, string>; // 追加
}
```

### UpdateRecordingRequest

```ts
export interface UpdateRecordingRequest {
  // ... 既存フィールド
  speakerLabels?: Record<string, string>; // 追加
}
```

> **Note**: CosmosDB はスキーマレスなので、フィールド追加にマイグレーション不要。APIの `createRecording` / `updateRecording` はリクエストボディをそのまま保存するため、サービスロジックの変更も不要。

---

## Step 2: Web 側の Recording 型拡張

**ファイル**: `web/src/types/index.ts`

```ts
export interface Recording {
  // ... 既存フィールド（correctedAt の後に追加）
  speakerLabels?: Record<string, string>; // 追加
}
```

---

## Step 3: useSpeakerManager の修正

**ファイル**: `web/src/hooks/useSpeakerManager.ts`

### 変更内容

1. **`STORAGE_PREFIX` 定数を削除**
2. **`renameSpeaker`**: localStorage.setItem 呼び出しを削除
3. **`updateFromSegments`**: localStorage.getItem 呼び出しを削除。ラベルのデフォルトは speaker ID そのまま
4. **`getSpeakerLabelsMap()` を追加**: speakers Map からリネームされたエントリのみ `Record<string, string>` で返す
5. **返り値に `getSpeakerLabelsMap` を追加**

### 修正後コード全体

```ts
"use client";

import { useState, useCallback } from "react";
import { LiveSegment } from "@/types";

export interface SpeakerInfo {
  id: string;
  label: string;
  color: number;
  segmentCount: number;
}

interface UseSpeakerManagerReturn {
  speakers: Map<string, SpeakerInfo>;
  renameSpeaker: (id: string, label: string) => void;
  getSpeakerLabel: (id: string) => string;
  getSpeakerLabelsMap: () => Record<string, string>;
  updateFromSegments: (segments: LiveSegment[]) => void;
  resetSpeakers: () => void;
}

export function useSpeakerManager(): UseSpeakerManagerReturn {
  const [speakers, setSpeakers] = useState<Map<string, SpeakerInfo>>(new Map());

  const renameSpeaker = useCallback((id: string, label: string) => {
    setSpeakers((prev) => {
      const next = new Map(prev);
      const info = next.get(id);
      if (info) {
        next.set(id, { ...info, label });
      }
      return next;
    });
  }, []);

  const updateFromSegments = useCallback((segments: LiveSegment[]) => {
    setSpeakers((prev) => {
      const next = new Map(prev);
      let changed = false;

      for (const seg of segments) {
        if (seg.speaker && !next.has(seg.speaker)) {
          next.set(seg.speaker, {
            id: seg.speaker,
            label: seg.speaker,
            color: next.size,
            segmentCount: 0,
          });
          changed = true;
        }
      }

      const counts = new Map<string, number>();
      for (const seg of segments) {
        if (seg.speaker) {
          counts.set(seg.speaker, (counts.get(seg.speaker) || 0) + 1);
        }
      }
      for (const [id, info] of next) {
        const count = counts.get(id) || 0;
        if (info.segmentCount !== count) {
          next.set(id, { ...info, segmentCount: count });
          changed = true;
        }
      }

      return changed ? next : prev;
    });
  }, []);

  const getSpeakerLabel = useCallback(
    (id: string) => {
      return speakers.get(id)?.label || id;
    },
    [speakers]
  );

  const getSpeakerLabelsMap = useCallback((): Record<string, string> => {
    const map: Record<string, string> = {};
    for (const [id, info] of speakers) {
      if (info.label !== id) {
        map[id] = info.label;
      }
    }
    return map;
  }, [speakers]);

  const resetSpeakers = useCallback(() => {
    setSpeakers(new Map());
  }, []);

  return { speakers, renameSpeaker, getSpeakerLabel, getSpeakerLabelsMap, updateFromSegments, resetSpeakers };
}
```

---

## Step 4: page.tsx 保存処理の修正

**ファイル**: `web/src/app/page.tsx`

### 4a: useSpeakerManager の分割代入に `getSpeakerLabelsMap` 追加

```ts
// L229 変更前:
const { speakers, renameSpeaker, getSpeakerLabel, updateFromSegments, resetSpeakers } = useSpeakerManager();

// L229 変更後:
const { speakers, renameSpeaker, getSpeakerLabel, getSpeakerLabelsMap, updateFromSegments, resetSpeakers } = useSpeakerManager();
```

### 4b: 保存処理で元 speaker ID を保持 + speakerLabels 送信

```ts
// L672-680 変更前:
transcript: {
  segments: labeledSegments.map((seg, i) => ({
    id: seg.id,
    speaker: seg.speakerLabel || seg.speaker,  // ← ラベルで上書き
    text: seg.text,
    startTime: seg.timestamp / 1000,
    endTime: i < labeledSegments.length - 1
      ? labeledSegments[i + 1].timestamp / 1000
      : duration,
  })),
  fullText: transcript,
},

// L672-680 変更後:
transcript: {
  segments: labeledSegments.map((seg, i) => ({
    id: seg.id,
    speaker: seg.speaker,  // ← 元のSDK speaker ID を保持
    text: seg.text,
    startTime: seg.timestamp / 1000,
    endTime: i < labeledSegments.length - 1
      ? labeledSegments[i + 1].timestamp / 1000
      : duration,
  })),
  fullText: transcript,
},
speakerLabels: getSpeakerLabelsMap(),  // ← 新規: ラベルマッピングを別フィールドで送信
```

---

## Step 5: recording/page.tsx 詳細ページの表示修正

**ファイル**: `web/src/app/recording/page.tsx`

### 5a: セグメント表示で speakerLabels マッピング適用

```tsx
// 変更前 (L951-953):
{segment.speaker && (
  <span className="...">{segment.speaker}</span>
)}

// 変更後:
{segment.speaker && (
  <span className="...">
    {recording?.speakerLabels?.[segment.speaker] || segment.speaker}
  </span>
)}
```

### 5b: コピー機能で speakerLabels 適用

```ts
// getTranscriptWithSpeakerLabels 関数内 (L438):
// 変更前:
const label = seg.speaker || t("unknownSpeaker");

// 変更後:
const label = (recording?.speakerLabels?.[seg.speaker || ""] || seg.speaker) || t("unknownSpeaker");
```

---

## Step 6: localStorage クリーンアップ（ワンタイム）

**ファイル**: `web/src/hooks/useSpeakerManager.ts` のモジュールトップレベル

```ts
// モジュール初期化時に旧 localStorage エントリをクリア
if (typeof window !== "undefined") {
  try {
    if (!localStorage.getItem("airecorder-speaker-cleanup-v1")) {
      const keysToRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key?.startsWith("airecorder-speaker-")) {
          keysToRemove.push(key);
        }
      }
      keysToRemove.forEach((k) => localStorage.removeItem(k));
      localStorage.setItem("airecorder-speaker-cleanup-v1", "1");
    }
  } catch {
    // ignore
  }
}
```

---

## 後方互換性

| ケース | 挙動 |
|--------|------|
| 修正前に保存された録音（speaker="田中"、speakerLabels なし） | `speakerLabels` が `undefined` なのでフォールバックで `segment.speaker` ("田中") をそのまま表示。**劣化なし** |
| 修正後に保存された録音（speaker="Guest-1"、speakerLabels={"Guest-1":"田中"}） | `speakerLabels["Guest-1"]` → "田中" を表示。**正常動作** |
| 修正後に保存、speakerLabels なし（ラベル未編集） | `speakerLabels` が空/undefinedなのでフォールバックで `segment.speaker` ("Guest-1") を表示。**正常動作** |

---

## 実装順序

```
Step 1 (API型) → Step 2 (Web型) → Step 3 (useSpeakerManager) → Step 4 (page.tsx保存) → Step 5 (recording/page.tsx表示) → Step 6 (localStorage cleanup) → ビルド確認
```

全 Step は直列依存。Step 1-2 は型のみなので並行可能。

---

## 見積り

| Step | 作業 | 時間 |
|------|------|------|
| 1-2 | 型定義追加 | 5分 |
| 3 | useSpeakerManager 修正 | 10分 |
| 4 | page.tsx 保存処理修正 | 10分 |
| 5 | recording/page.tsx 表示修正 | 10分 |
| 6 | localStorage クリーンアップ | 5分 |
| 7 | ビルド確認・テスト | 10分 |
| **合計** | | **約50分** |
