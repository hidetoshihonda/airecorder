import { getUserSettingsContainer } from "./cosmosService";
import { UserSettings, UserSettingsDocument } from "../models";

const defaultSettings: UserSettings = {
  defaultSourceLanguage: "ja-JP",
  defaultTargetLanguages: ["en-US"],
  theme: "system",
  autoSaveRecordings: true,
  audioQuality: "high",
  noiseSuppression: true,
  enableSpeakerDiarization: false,
};

export async function getUserSettings(userId: string): Promise<UserSettingsDocument> {
  const container = await getUserSettingsContainer();
  
  try {
    const { resource } = await container.item(userId, userId).read<UserSettingsDocument>();
    if (resource) {
      // 既存の設定にデフォルト値をマージ（新しい設定項目が追加された場合に対応）
      return {
        ...resource,
        settings: { ...defaultSettings, ...resource.settings },
      };
    }
  } catch (error: unknown) {
    const cosmosError = error as { code?: number };
    if (cosmosError.code !== 404) {
      throw error;
    }
  }
  
  // 初回ユーザー: デフォルト設定を返す
  return {
    id: userId,
    userId,
    settings: defaultSettings,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

export async function updateUserSettings(
  userId: string,
  partialSettings: Partial<UserSettings>
): Promise<UserSettingsDocument> {
  const container = await getUserSettingsContainer();
  const current = await getUserSettings(userId);
  
  const updated: UserSettingsDocument = {
    id: userId,
    userId,
    settings: { ...current.settings, ...partialSettings },
    createdAt: current.createdAt,
    updatedAt: new Date().toISOString(),
  };
  
  await container.items.upsert(updated);
  return updated;
}
