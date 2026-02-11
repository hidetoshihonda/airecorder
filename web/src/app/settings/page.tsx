"use client";

import { useState, useEffect } from "react";
import { Save, Globe, Mic, Palette, Users, Plus, Pencil, Trash2, FileText } from "lucide-react";
import { useTranslations } from "next-intl";
import { useLocale as useAppLocale, AppLocale } from "@/contexts/I18nContext";
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
import { useAuth } from "@/contexts/AuthContext";
import { CustomTemplate } from "@/types";
import { loadCustomTemplates, addCustomTemplate, updateCustomTemplate, deleteCustomTemplate } from "@/lib/meetingTemplates";

export default function SettingsPage() {
  const { settings, updateSettings } = useAuth();
  const [isSaving, setIsSaving] = useState(false);
  const t = useTranslations("SettingsPage");
  const { locale: appLocale, setLocale } = useAppLocale();

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
    const newTemplate = await addCustomTemplate(templateForm);
    if (newTemplate) {
      setCustomTemplates((prev) => [...prev, newTemplate]);
    }
    setTemplateForm({ name: "", description: "", systemPrompt: "" });
    setIsCreating(false);
  };

  const handleUpdateTemplate = async () => {
    if (!editingTemplate || !templateForm.name || !templateForm.systemPrompt) return;
    const updated = await updateCustomTemplate(editingTemplate.id, templateForm);
    if (updated) {
      setCustomTemplates((prev) =>
        prev.map((t) => (t.id === updated.id ? updated : t))
      );
    }
    setEditingTemplate(null);
    setTemplateForm({ name: "", description: "", systemPrompt: "" });
  };

  const handleDeleteTemplate = async (id: string) => {
    const success = await deleteCustomTemplate(id);
    if (success) {
      setCustomTemplates((prev) => prev.filter((t) => t.id !== id));
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

  const handleSave = async () => {
    setIsSaving(true);
    // TODO: Save settings to backend
    await new Promise((resolve) => setTimeout(resolve, 1000));
    setIsSaving(false);
  };

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">{t("title")}</h1>
        <p className="mt-1 text-gray-600">{t("description")}</p>
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
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t("defaultInputLang")}
              </label>
              <Select
                value={settings.defaultSourceLanguage}
                onValueChange={(value) =>
                  updateSettings({ defaultSourceLanguage: value })
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
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t("defaultTargetLang")}
              </label>
              <Select
                value={settings.defaultTargetLanguages[0] || "en-US"}
                onValueChange={(value) =>
                  updateSettings({ defaultTargetLanguages: [value] })
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
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t("audioQuality")}
              </label>
              <Select
                value={settings.audioQuality}
                onValueChange={(value: "low" | "medium" | "high") =>
                  updateSettings({ audioQuality: value })
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
                <p className="text-sm font-medium text-gray-700">{t("autoSave")}</p>
                <p className="text-xs text-gray-500">
                  {t("autoSaveDesc")}
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={settings.autoSaveRecordings}
                  onChange={(e) =>
                    updateSettings({ autoSaveRecordings: e.target.checked })
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
                <p className="text-sm font-medium text-gray-700">{t("speakerDiarizationToggle")}</p>
                <p className="text-xs text-gray-500">
                  {t("speakerDiarizationToggleDesc")}
                </p>
              </div>
              <label className="relative inline-flex cursor-pointer items-center">
                <input
                  type="checkbox"
                  checked={settings.enableSpeakerDiarization ?? false}
                  onChange={(e) =>
                    updateSettings({ enableSpeakerDiarization: e.target.checked })
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
              <label className="mb-2 block text-sm font-medium text-gray-700">
                {t("theme")}
              </label>
              <Select
                value={settings.theme}
                onValueChange={(value: "light" | "dark" | "system") =>
                  updateSettings({ theme: value })
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

        {/* Save Button */}
        <div className="flex justify-end">
          <Button onClick={handleSave} disabled={isSaving} className="gap-2">
            <Save className="h-4 w-4" />
            {isSaving ? t("saving") : t("saveSettings")}
          </Button>
        </div>
      </div>
    </div>
  );
}
