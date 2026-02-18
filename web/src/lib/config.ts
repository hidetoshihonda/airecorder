// Azure AD B2C Configuration
export const msalConfig = {
  auth: {
    clientId: process.env.NEXT_PUBLIC_AZURE_AD_B2C_CLIENT_ID || "",
    authority: `https://${process.env.NEXT_PUBLIC_AZURE_AD_B2C_TENANT_NAME}.b2clogin.com/${process.env.NEXT_PUBLIC_AZURE_AD_B2C_TENANT_NAME}.onmicrosoft.com/${process.env.NEXT_PUBLIC_AZURE_AD_B2C_POLICY_NAME}`,
    knownAuthorities: [
      `${process.env.NEXT_PUBLIC_AZURE_AD_B2C_TENANT_NAME}.b2clogin.com`,
    ],
    redirectUri:
      typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
    postLogoutRedirectUri:
      typeof window !== "undefined" ? window.location.origin : "http://localhost:3000",
  },
  cache: {
    cacheLocation: "sessionStorage" as const,
    storeAuthStateInCookie: false,
  },
};

export const loginRequest = {
  scopes: ["openid", "profile", "email"],
};

// Azure Speech Services Configuration
export const speechConfig = {
  subscriptionKey: process.env.NEXT_PUBLIC_AZURE_SPEECH_KEY || "",
  region: process.env.NEXT_PUBLIC_AZURE_SPEECH_REGION || "japaneast",
};

// Azure Translator Configuration
// Note: Translator resource is deployed globally, so region must be "global"
export const translatorConfig = {
  subscriptionKey: process.env.NEXT_PUBLIC_AZURE_TRANSLATOR_KEY || "",
  region: process.env.NEXT_PUBLIC_AZURE_TRANSLATOR_REGION || "global",
  endpoint: "https://api.cognitive.microsofttranslator.com",
};

// Azure OpenAI Configuration
export const openaiConfig = {
  endpoint: process.env.AZURE_OPENAI_ENDPOINT || "",
  apiKey: process.env.AZURE_OPENAI_KEY || "",
  deploymentName: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || "gpt-5-mini",
};

// Azure Storage Configuration
export const storageConfig = {
  connectionString: process.env.AZURE_STORAGE_CONNECTION_STRING || "",
  containerName: process.env.AZURE_STORAGE_CONTAINER_NAME || "recordings",
};

// Azure Cosmos DB Configuration
export const cosmosConfig = {
  endpoint: process.env.AZURE_COSMOS_ENDPOINT || "",
  key: process.env.AZURE_COSMOS_KEY || "",
  databaseId: process.env.AZURE_COSMOS_DATABASE || "airecorder",
  containerId: "recordings",
};

// Supported Languages
export const SUPPORTED_LANGUAGES = [
  { code: "ja-JP", name: "日本語", translatorCode: "ja", flag: "🇯🇵" },
  { code: "en-US", name: "English", translatorCode: "en", flag: "🇺🇸" },
  { code: "es-ES", name: "Español", translatorCode: "es", flag: "🇪🇸" },
  { code: "zh-CN", name: "中文（简体）", translatorCode: "zh-Hans", flag: "🇨🇳" },
  { code: "ko-KR", name: "한국어", translatorCode: "ko", flag: "🇰🇷" },
  { code: "fr-FR", name: "Français", translatorCode: "fr", flag: "🇫🇷" },
  { code: "de-DE", name: "Deutsch", translatorCode: "de", flag: "🇩🇪" },
  { code: "pt-BR", name: "Português", translatorCode: "pt", flag: "🇧🇷" },
  { code: "it-IT", name: "Italiano", translatorCode: "it", flag: "🇮🇹" },
  { code: "ar-SA", name: "العربية", translatorCode: "ar", flag: "🇸🇦", rtl: true },
] as const;

export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];
