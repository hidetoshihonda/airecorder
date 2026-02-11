import { Recording } from "@/types";
import { SUPPORTED_LANGUAGES } from "@/lib/config";

const LOCALE_MAP: Record<string, string> = { ja: "ja-JP", en: "en-US", es: "es-ES" };

function formatDate(dateString: string, locale = "ja"): string {
  const date = new Date(dateString);
  return date.toLocaleDateString(LOCALE_MAP[locale] || locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const LABELS: Record<string, Record<string, string>> = {
  ja: {
    recordingData: "録音データ",
    basicInfo: "基本情報",
    title: "タイトル:",
    recordingDate: "録音日時:",
    duration: "録音時間:",
    language: "言語:",
    transcript: "文字起こし",
    translation: "翻訳",
    minutes: "議事録",
    overview: "概要",
    keyPoints: "重要ポイント",
    actionItems: "アクションアイテム",
    assignee: "担当:",
    dueDate: "期限:",
    exportDate: "エクスポート日時:",
    item: "項目",
    value: "値",
    content: "内容",
    hours: "時間",
    minutes_unit: "分",
    seconds: "秒",
  },
  en: {
    recordingData: "Recording Data",
    basicInfo: "Basic Info",
    title: "Title:",
    recordingDate: "Recording Date:",
    duration: "Duration:",
    language: "Language:",
    transcript: "Transcript",
    translation: "Translation",
    minutes: "Minutes",
    overview: "Overview",
    keyPoints: "Key Points",
    actionItems: "Action Items",
    assignee: "Assignee:",
    dueDate: "Due:",
    exportDate: "Export Date:",
    item: "Item",
    value: "Value",
    content: "Content",
    hours: "h",
    minutes_unit: "min",
    seconds: "s",
  },
  es: {
    recordingData: "Datos de Grabación",
    basicInfo: "Información Básica",
    title: "Título:",
    recordingDate: "Fecha de grabación:",
    duration: "Duración:",
    language: "Idioma:",
    transcript: "Transcripción",
    translation: "Traducción",
    minutes: "Acta",
    overview: "Resumen",
    keyPoints: "Puntos Clave",
    actionItems: "Acciones Pendientes",
    assignee: "Responsable:",
    dueDate: "Fecha límite:",
    exportDate: "Fecha de exportación:",
    item: "Elemento",
    value: "Valor",
    content: "Contenido",
    hours: "h",
    minutes_unit: "min",
    seconds: "s",
  },
};

function getLabels(locale = "ja") {
  return LABELS[locale] || LABELS.ja;
}

function formatDuration(seconds: number, locale = "ja"): string {
  const l = getLabels(locale);
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}${l.hours}${minutes}${l.minutes_unit}${secs}${l.seconds}`;
  }
  return `${minutes}${l.minutes_unit}${secs}${l.seconds}`;
}

/**
 * Generate plain text export of a recording
 */
export function exportAsText(recording: Recording, locale = "ja"): string {
  const l = getLabels(locale);
  const langName =
    SUPPORTED_LANGUAGES.find((l) => l.code === recording.sourceLanguage)?.name ||
    recording.sourceLanguage;

  let content = `=====================================
AI Voice Recorder - ${l.recordingData}
=====================================

■ ${l.basicInfo}
${l.title} ${recording.title}
${l.recordingDate} ${formatDate(recording.createdAt, locale)}
${l.duration} ${formatDuration(recording.duration, locale)}
${l.language} ${langName}
`;

  if (recording.transcript?.fullText) {
    content += `
=====================================
■ ${l.transcript}
=====================================

${recording.transcript.fullText}
`;
  }

  if (recording.translations && Object.keys(recording.translations).length > 0) {
    content += `
=====================================
■ ${l.translation}
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
■ ${l.minutes}
=====================================

【${l.overview}】
${recording.summary.overview}
`;

    if (recording.summary.keyPoints && recording.summary.keyPoints.length > 0) {
      content += `
【${l.keyPoints}】
${recording.summary.keyPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}
`;
    }

    if (recording.summary.actionItems && recording.summary.actionItems.length > 0) {
      content += `
【${l.actionItems}】
${recording.summary.actionItems
  .map(
    (item) =>
      `- ${item.description}${item.assignee ? ` (${l.assignee} ${item.assignee})` : ""}${item.dueDate ? ` (${l.dueDate} ${item.dueDate})` : ""}`
  )
  .join("\n")}
`;
    }
  }

  content += `
=====================================
${l.exportDate} ${formatDate(new Date().toISOString(), locale)}
=====================================
`;

  return content;
}

/**
 * Generate Markdown export of a recording
 */
export function exportAsMarkdown(recording: Recording, locale = "ja"): string {
  const l = getLabels(locale);
  const langName =
    SUPPORTED_LANGUAGES.find((l) => l.code === recording.sourceLanguage)?.name ||
    recording.sourceLanguage;

  let content = `# ${recording.title}

## ${l.basicInfo}

| ${l.item} | ${l.value} |
|------|-----|
| ${l.recordingDate} | ${formatDate(recording.createdAt, locale)} |
| ${l.duration} | ${formatDuration(recording.duration, locale)} |
| ${l.language} | ${langName} |

`;

  if (recording.transcript?.fullText) {
    content += `## ${l.transcript}

${recording.transcript.fullText}

`;
  }

  if (recording.translations && Object.keys(recording.translations).length > 0) {
    content += `## ${l.translation}

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
    content += `## ${l.minutes}

### ${l.overview}

${recording.summary.overview}

`;

    if (recording.summary.keyPoints && recording.summary.keyPoints.length > 0) {
      content += `### ${l.keyPoints}

${recording.summary.keyPoints.map((p, i) => `${i + 1}. ${p}`).join("\n")}

`;
    }

    if (recording.summary.actionItems && recording.summary.actionItems.length > 0) {
      content += `### ${l.actionItems}

| ${l.content} | ${l.assignee} | ${l.dueDate} |
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

*${l.exportDate} ${formatDate(new Date().toISOString(), locale)}*
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
export function downloadAsText(recording: Recording, locale = "ja"): void {
  const content = exportAsText(recording, locale);
  const filename = `${recording.title.replace(/[/\\?%*:|"<>]/g, "-")}.txt`;
  downloadFile(content, filename, "text/plain;charset=utf-8");
}

/**
 * Export recording as markdown file
 */
export function downloadAsMarkdown(recording: Recording, locale = "ja"): void {
  const content = exportAsMarkdown(recording, locale);
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
