"use client";

import { useState, useEffect } from "react";
import { Globe, Mic, Palette, Users, Plus, Pencil, Trash2, FileText, LogIn, Check, List, X, Sparkles } from "lucide-react";
import { Spinner } from "@/components/ui/spinner";
import { useTranslations } from "next-intl";
import { useLocale as useAppLocale, AppLocale } from "@/contexts/I18nContext";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SUPPORTED_LANGUAGES } from "@/lib/config";
import { cn } from "@/lib/utils";
import { useAuth } from "@/contexts/AuthContext";
import { CustomTemplate } from "@/types";
import { loadCustomTemplates, addCustomTemplate, updateCustomTemplate, deleteCustomTemplate } from "@/lib/meetingTemplates";

export default function SettingsPage() {
  const { settings, updateSettings, isAuthenticated, isLoading: authLoading, login, settingsLoaded } = useAuth();
  const [showSaved, setShowSaved] = useState(false);
  const t = useTranslations("SettingsPage");
  const { locale: appLocale, setLocale } = useAppLocale();

  // next-themes との同期
  const { setTheme } = useTheme();

  useEffect(() => {
    if (settingsLoaded) {
      setTheme(settings.theme);
    }
  }, [settings.theme, settingsLoaded, setTheme]);

  // 設定変更ハンドラ: updateSettings + トースト通知
  const handleSettingChange = (newSettings: Partial<typeof settings>) => {
    updateSettings(newSettings);
    setShowSaved(true);
    setTimeout(() => setShowSaved(false), 2000);
  };

  // Phrase list state (Issue #34)
  const [newPhrase, setNewPhrase] = useState("");

  const handleAddPhrase = () => {
    const phrase = newPhrase.trim();
    if (!phrase) return;
    const currentList = settings.phraseList ?? [];
    if (currentList.includes(phrase)) {
      setNewPhrase("");
      return;
    }
    if (currentList.length >= 500) return;
    handleSettingChange({ phraseList: [...currentList, phrase] });
    setNewPhrase("");
  };

  const handleRemovePhrase = (phrase: string) => {
    const currentList = settings.phraseList ?? [];
    handleSettingChange({ phraseList: currentList.filter(p => p !== phrase) });
  };

  // Custom template state
  const [customTemplates, setCustomTemplates] = useState<CustomTemplate[]>([]);
  const [isLoadingTemplates, setIsLoadingTemplates] = useState(true);
  const [editingTemplate, setEditingTemplate] = useState<CustomTemplate | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [templateForm, setTemplateForm] = useState({ name: "", description: "", systemPrompt: "" });

  // Load templates on mount
  useEffect(() => {
    const load = async () => {
      setIsLoadingTemplates(true);
      try {
        const templates = await loadCustomTemplates();
        setCustomTemplates(templates);
      } finally {
        setIsLoadingTemplates(false);
      }
    };
    load();
  }, []);

  const handleCreateTemplate = async () => {
    if (!templateForm.name || !templateForm.systemPrompt) return;
    try {
      const newTemplate = await addCustomTemplate(templateForm);
      if (newTemplate) {
        setCustomTemplates((prev) => [...prev, newTemplate]);
      } else {
        alert(t("templateCreateFailed"));
      }
    } catch {
      alert(t("templateCreateFailed"));
    }
    setTemplateForm({ name: "", description: "", systemPrompt: "" });
    setIsCreating(false);
  };

  const handleUpdateTemplate = async () => {
    if (!editingTemplate || !templateForm.name || !templateForm.systemPrompt) return;
    try {
      const updated = await updateCustomTemplate(editingTemplate.id, templateForm);
      if (updated) {
        setCustomTemplates((prev) =>
          prev.map((t) => (t.id === updated.id ? updated : t))
        );
      } else {
        alert(t("templateUpdateFailed"));
      }
    } catch {
      alert(t("templateUpdateFailed"));
    }
    setEditingTemplate(null);
    setTemplateForm({ name: "", description: "", systemPrompt: "" });
  };

  const handleDeleteTemplate = async (id: string) => {
    try {
      const success = await deleteCustomTemplate(id);
      if (success) {
        setCustomTemplates((prev) => prev.filter((t) => t.id !== id));
      } else {
        alert(t("templateDeleteFailed"));
      }
    } catch {
      alert(t("templateDeleteFailed"));
    }
  };

  const startEditing = (tmpl: CustomTemplate) => {
    setEditingTemplate(tmpl);
    setTemplateForm({ name: tmpl.name, description: tmpl.description, systemPrompt: tmpl.systemPrompt });
    setIsCreating(false);
  };

  const startCreating = () => {
    setIsCreating(true);
    setEditingTemplate(null);
    setTemplateForm({ name: "", description: "", systemPrompt: "" });
  };

  const cancelForm = () => {
    setIsCreating(false);
    setEditingTemplate(null);
    setTemplateForm({ name: "", description: "", systemPrompt: "" });
  };

  const UI_LANGUAGES: { code: AppLocale; flag: string; name: string }[] = [
    { code: "ja", flag: "🇯🇵", name: "日本語" },
    { code: "en", flag: "🇺🇸", name: "English" },
    { code: "es", flag: "🇪🇸", name: "Español" },
  ];

  // 認証ローディング中
  if (authLoading) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[400px] items-center justify-center">
          <Spinner size="lg" />
        </div>
      </div>
    );
  }

  // 未認証時のログイン誘導UI (Issue #72)
  if (!isAuthenticated) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex min-h-[400px] flex-col items-center justify-center space-y-6">
          <div className="rounded-full bg-blue-100 p-6 dark:bg-blue-900/30">
            <LogIn className="h-12 w-12 text-blue-600 dark:text-blue-400" />
          </div>
          <div className="text-center">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
              {t("loginRequired")}
            </h2>
            <p className="mt-2 text-gray-600 dark:text-gray-400">
              {t("loginRequiredDescription")}
            </p>
          </div>
          <Button onClick={login} size="lg" className="mt-4">
            <LogIn className="mr-2 h-5 w-5" />
            {t("loginButton")}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t("title")}</h1>
        <p className="mt-1 text-gray-600 dark:text-gray-400">{t("description")}</p>
        <p className="mt-2 flex items-center gap-1 text-xs text-green-600 dark:text-green-400">
          <Check className="h-3 w-3" />
          {t("autoSaveNote")}
        </p>
      </div>

      <div className="space-y-6">
        {/* Language Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-lg">{t("languageSettings")}</CardTitle>
            </div>
            <CardDescription>
              {t("languageSettingsDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("defaultInputLang")}
              </label>
              <Select
                value={settings.defaultSourceLanguage}
                onValueChange={(value) =>
                  handleSettingChange({ defaultSourceLanguage: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.flag} {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("defaultTargetLang")}
              </label>
              <Select
                value={settings.defaultTargetLanguages[0] || "en-US"}
                onValueChange={(value) =>
                  handleSettingChange({ defaultTargetLanguages: [value] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SUPPORTED_LANGUAGES.map((lang) => (
                    <SelectItem key={lang.code} value={lang.code}>
                      {lang.flag} {lang.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Audio Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Mic className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-lg">{t("recordingSettings")}</CardTitle>
            </div>
            <CardDescription>
              {t("recordingSettingsDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("audioQuality")}
              </label>
              <Select
                value={settings.audioQuality}
                onValueChange={(value: "low" | "medium" | "high") =>
                  handleSettingChange({ audioQuality: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="low">{t("qualityLow")}</SelectItem>
                  <SelectItem value="medium">{t("qualityMedium")}</SelectItem>
                  <SelectItem value="high">{t("qualityHigh")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t("autoSave")}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("autoSaveDesc")}
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={settings.autoSaveRecordings}
                  onChange={(e) =>
                    handleSettingChange({ autoSaveRecordings: e.target.checked })
                  }
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300"></div>
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Speaker Diarization Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-lg">{t("speakerDiarization")}</CardTitle>
            </div>
            <CardDescription>
              {t("speakerDiarizationDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t("speakerDiarizationToggle")}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("speakerDiarizationToggleDesc")}
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={settings.enableSpeakerDiarization ?? false}
                  onChange={(e) =>
                    handleSettingChange({ enableSpeakerDiarization: e.target.checked })
                  }
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300"></div>
              </label>
            </div>
            {(settings.enableSpeakerDiarization ?? false) && (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                <p className="font-medium mb-1">⚠️ {t("speakerNotes")}</p>
                <ul className="list-disc list-inside space-y-1">
                  <li>{t("speakerNote1")}</li>
                  <li>{t("speakerNote2")}</li>
                  <li>{t("speakerNote3")}</li>
                </ul>
              </div>
            )}
          </CardContent>
        </Card>

        {/* AI Cues Settings (Issue #89) */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-600" />
              <CardTitle className="text-lg">{t("enableAICues")}</CardTitle>
            </div>
            <CardDescription>
              {t("enableAICuesDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t("enableAICues")}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("enableAICuesDesc")}
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={settings.enableAICues ?? false}
                  onChange={(e) =>
                    handleSettingChange({ enableAICues: e.target.checked })
                  }
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300"></div>
              </label>
            </div>

            {/* AI Cue Pro Mode Selector */}
            {settings.enableAICues && (
              <div className="mt-4 rounded-lg border border-purple-100 bg-purple-50 p-4 dark:border-purple-800 dark:bg-purple-950">
                <p className="text-sm font-medium text-purple-800 dark:text-purple-300">
                  {t("aiCueMode")}
                </p>
                <p className="mt-0.5 text-xs text-purple-600 dark:text-purple-400">
                  {t("aiCueModeDesc")}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {(["general", "tech_support", "interview"] as const).map((m) => (
                    <button
                      key={m}
                      onClick={() => handleSettingChange({ aiCueMode: m })}
                      className={cn(
                        "rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                        settings.aiCueMode === m || (!settings.aiCueMode && m === "general")
                          ? "bg-purple-600 text-white"
                          : "bg-white text-gray-700 hover:bg-purple-100 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-purple-900"
                      )}
                    >
                      {t(`aiCueMode_${m}`)}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Issue #126: Realtime AI Correction Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-purple-600" />
              <CardTitle className="text-lg">{t("enableRealtimeCorrection")}</CardTitle>
            </div>
            <CardDescription>
              {t("enableRealtimeCorrectionDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-gray-700 dark:text-gray-300">{t("enableRealtimeCorrection")}</p>
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  {t("enableRealtimeCorrectionDesc")}
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={settings.enableRealtimeCorrection ?? false}
                  onChange={(e) =>
                    handleSettingChange({ enableRealtimeCorrection: e.target.checked })
                  }
                  className="peer sr-only"
                />
                <div className="peer h-6 w-11 rounded-full bg-gray-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300"></div>
              </label>
            </div>
          </CardContent>
        </Card>

        {/* Phrase List Settings (Issue #34) */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <List className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-lg">{t("phraseList")}</CardTitle>
            </div>
            <CardDescription>
              {t("phraseListDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 入力フォーム */}
            <div className="flex gap-2">
              <input
                type="text"
                value={newPhrase}
                onChange={(e) => setNewPhrase(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    handleAddPhrase();
                  }
                }}
                className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                placeholder={t("phrasePlaceholder")}
                maxLength={100}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddPhrase}
                disabled={!newPhrase.trim() || (settings.phraseList ?? []).length >= 500}
                className="gap-1"
              >
                <Plus className="h-4 w-4" />
                {t("addPhrase")}
              </Button>
            </div>

            {/* フレーズ一覧 */}
            {(settings.phraseList ?? []).length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {(settings.phraseList ?? []).map((phrase) => (
                  <span
                    key={phrase}
                    className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-3 py-1 text-sm text-blue-700 dark:bg-blue-900/30 dark:text-blue-300"
                  >
                    {phrase}
                    <button
                      type="button"
                      onClick={() => handleRemovePhrase(phrase)}
                      className="ml-0.5 rounded-full p-0.5 hover:bg-blue-200 dark:hover:bg-blue-800 transition-colors"
                      aria-label={`Remove ${phrase}`}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-500 text-center py-2">
                {t("noPhrases")}
              </p>
            )}

            {/* ヘルプテキスト */}
            <div className="rounded-md border border-blue-100 bg-blue-50 p-3 text-xs text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
              <p className="font-medium mb-1">💡 {t("phraseHint")}</p>
              <p className="text-blue-600 dark:text-blue-400">
                {t("phraseLimit")} ({(settings.phraseList ?? []).length}/500)
              </p>
            </div>
          </CardContent>
        </Card>

        {/* UI Language Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Globe className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-lg">{t("uiLanguage")}</CardTitle>
            </div>
            <CardDescription>
              {t("uiLanguageDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Select
              value={appLocale}
              onValueChange={(value) => setLocale(value as AppLocale)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {UI_LANGUAGES.map((lang) => (
                  <SelectItem key={lang.code} value={lang.code}>
                    {lang.flag} {lang.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        {/* Appearance Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Palette className="h-5 w-5 text-blue-600" />
              <CardTitle className="text-lg">{t("appearance")}</CardTitle>
            </div>
            <CardDescription>
              {t("appearanceDesc")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="mb-2 block text-sm font-medium text-gray-700 dark:text-gray-300">
                {t("theme")}
              </label>
              <Select
                value={settings.theme}
                onValueChange={(value: "light" | "dark" | "system") =>
                  handleSettingChange({ theme: value })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="light">{t("themeLight")}</SelectItem>
                  <SelectItem value="dark">{t("themeDark")}</SelectItem>
                  <SelectItem value="system">{t("themeSystem")}</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        {/* Custom Templates */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-blue-600" />
                <CardTitle className="text-lg">{t("customTemplates")}</CardTitle>
              </div>
              <Button variant="outline" size="sm" onClick={startCreating} className="gap-1">
                <Plus className="h-4 w-4" />
                {t("addTemplate")}
              </Button>
            </div>
            <CardDescription>{t("customTemplatesDesc")}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 作成/編集フォーム */}
            {(isCreating || editingTemplate) && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-4 space-y-3">
                <h4 className="font-medium text-sm">
                  {editingTemplate ? t("editTemplate") : t("newTemplate")}
                </h4>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("templateName")}
                  </label>
                  <input
                    type="text"
                    value={templateForm.name}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, name: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    placeholder={t("templateNamePlaceholder")}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("templateDescription")}
                  </label>
                  <input
                    type="text"
                    value={templateForm.description}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, description: e.target.value }))}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    placeholder={t("templateDescPlaceholder")}
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    {t("systemPrompt")}
                  </label>
                  <textarea
                    value={templateForm.systemPrompt}
                    onChange={(e) => setTemplateForm((f) => ({ ...f, systemPrompt: e.target.value }))}
                    rows={5}
                    className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
                    placeholder={t("systemPromptPlaceholder")}
                  />
                </div>
                <div className="flex gap-2 justify-end">
                  <Button variant="outline" size="sm" onClick={cancelForm}>
                    {t("cancel")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={editingTemplate ? handleUpdateTemplate : handleCreateTemplate}
                    disabled={!templateForm.name || !templateForm.systemPrompt}
                  >
                    {editingTemplate ? t("updateTemplate") : t("createTemplate")}
                  </Button>
                </div>
              </div>
            )}

            {/* テンプレート一覧 */}
            {isLoadingTemplates ? (
              <div className="text-sm text-gray-500 text-center py-4">
                読み込み中...
              </div>
            ) : customTemplates.length === 0 && !isCreating ? (
              <p className="text-sm text-gray-500 text-center py-4">
                {t("noCustomTemplates")}
              </p>
            ) : (
              <div className="space-y-2">
                {customTemplates.map((tmpl) => (
                  <div
                    key={tmpl.id}
                    className="flex items-center justify-between rounded-lg border border-gray-200 p-3"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="font-medium text-sm">{tmpl.name}</div>
                      {tmpl.description && (
                        <div className="text-xs text-gray-500 truncate">{tmpl.description}</div>
                      )}
                    </div>
                    <div className="flex gap-1 ml-2">
                      <Button variant="ghost" size="sm" onClick={() => startEditing(tmpl)}>
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleDeleteTemplate(tmpl.id)}>
                        <Trash2 className="h-3.5 w-3.5 text-red-500" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Toast notification */}
        {showSaved && (
          <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-lg bg-green-600 px-4 py-2 text-sm text-white shadow-lg transition-opacity">
            <Check className="h-4 w-4" />
            {t("settingsSaved")}
          </div>
        )}
      </div>
    </div>
  );
}
