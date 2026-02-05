import { Recording } from "@/types";
import { SUPPORTED_LANGUAGES } from "@/lib/config";

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDuration(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}時間${minutes}分${secs}秒`;
  }
  return `${minutes}分${secs}秒`;
}

/**
 * Generate plain text export of a recording
 */
export function exportAsText(recording: Recording): string {
  const langName =
    SUPPORTED_LANGUAGES.find((l) => l.code === recording.sourceLanguage)?.name ||
    recording.sourceLanguage;

  let content = `=====================================
AI Voice Recorder - 録音データ
=====================================

■ 基本情報
タイトル: ${recording.title}
録音日時: ${formatDate(recording.createdAt)}
録音時間: ${formatDuration(recording.duration)}
言語: ${langName}
`;

  if (recording.transcript?.fullText) {
    content += `
=====================================
■ 文字起こし
=====================================

${recording.transcript.fullText}
`;
  }

  if (recording.translations && Object.keys(recording.translations).length > 0) {
    content += `
=====================================
■ 翻訳
=====================================
`;
    for (const [langCode, translation] of Object.entries(recording.translations)) {
      const lang = SUPPORTED_LANGUAGES.find(
        (l) => l.code === langCode || l.translatorCode === langCode
      );
      content += `
【${lang?.name || langCode}】
${translation.fullText}
`;
    }
  }

  if (recording.summary) {
    content += `
=====================================
■ 議事録
=====================================

【概要】
${recording.summary.overview}
`;

    if (recording.summary.keyPoints && recording.summary.keyPoints.length > 0) {
      content += `
【重要ポイント】
${recording.summary.keyPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}
`;
    }

    if (recording.summary.actionItems && recording.summary.actionItems.length > 0) {
      content += `
【アクションアイテム】
${recording.summary.actionItems
  .map(
    (item) =>
      `- ${item.description}${item.assignee ? ` (担当: ${item.assignee})` : ""}${item.dueDate ? ` (期限: ${item.dueDate})` : ""}`
  )
  .join("\n")}
`;
    }
  }

  content += `
=====================================
エクスポート日時: ${formatDate(new Date().toISOString())}
=====================================
`;

  return content;
}

/**
 * Generate Markdown export of a recording
 */
export function exportAsMarkdown(recording: Recording): string {
  const langName =
    SUPPORTED_LANGUAGES.find((l) => l.code === recording.sourceLanguage)?.name ||
    recording.sourceLanguage;

  let content = `# ${recording.title}

## 基本情報

| 項目 | 値 |
|------|-----|
| 録音日時 | ${formatDate(recording.createdAt)} |
| 録音時間 | ${formatDuration(recording.duration)} |
| 言語 | ${langName} |

`;

  if (recording.transcript?.fullText) {
    content += `## 文字起こし

${recording.transcript.fullText}

`;
  }

  if (recording.translations && Object.keys(recording.translations).length > 0) {
    content += `## 翻訳

`;
    for (const [langCode, translation] of Object.entries(recording.translations)) {
      const lang = SUPPORTED_LANGUAGES.find(
        (l) => l.code === langCode || l.translatorCode === langCode
      );
      content += `### ${lang?.flag || ""} ${lang?.name || langCode}

${translation.fullText}

`;
    }
  }

  if (recording.summary) {
    content += `## 議事録

### 概要

${recording.summary.overview}

`;

    if (recording.summary.keyPoints && recording.summary.keyPoints.length > 0) {
      content += `### 重要ポイント

${recording.summary.keyPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}

`;
    }

    if (recording.summary.actionItems && recording.summary.actionItems.length > 0) {
      content += `### アクションアイテム

| 内容 | 担当 | 期限 |
|------|------|------|
${recording.summary.actionItems
  .map(
    (item) =>
      `| ${item.description} | ${item.assignee || "-"} | ${item.dueDate || "-"} |`
  )
  .join("\n")}

`;
    }
  }

  content += `---

*エクスポート日時: ${formatDate(new Date().toISOString())}*
`;

  return content;
}

/**
 * Download content as a file
 */
export function downloadFile(
  content: string,
  filename: string,
  mimeType: string
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Export recording as text file
 */
export function downloadAsText(recording: Recording): void {
  const content = exportAsText(recording);
  const filename = `${recording.title.replace(/[/\\?%*:|"<>]/g, "-")}.txt`;
  downloadFile(content, filename, "text/plain;charset=utf-8");
}

/**
 * Export recording as markdown file
 */
export function downloadAsMarkdown(recording: Recording): void {
  const content = exportAsMarkdown(recording);
  const filename = `${recording.title.replace(/[/\\?%*:|"<>]/g, "-")}.md`;
  downloadFile(content, filename, "text/markdown;charset=utf-8");
}

/**
 * Export recording as JSON file
 */
export function downloadAsJson(recording: Recording): void {
  const content = JSON.stringify(recording, null, 2);
  const filename = `${recording.title.replace(/[/\\?%*:|"<>]/g, "-")}.json`;
  downloadFile(content, filename, "application/json;charset=utf-8");
}
