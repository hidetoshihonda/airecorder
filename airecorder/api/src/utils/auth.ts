import { HttpRequest, HttpResponseInit } from "@azure/functions";

// ========== 型定義 ==========

export interface ClientPrincipal {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
}

// ========== エラークラス ==========

export class AuthenticationError extends Error {
  constructor(message: string = "Authentication required") {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class AuthorizationError extends Error {
  constructor(message: string = "Access denied") {
    super(message);
    this.name = "AuthorizationError";
  }
}

// ========== ヘルパー関数 ==========

/**
 * x-ms-client-principal ヘッダーをパースしてユーザー情報を取得
 */
export function getClientPrincipal(request: HttpRequest): ClientPrincipal | null {
  const header = request.headers.get("x-ms-client-principal");
  
  if (!header) {
    return null;
  }

  try {
    const decoded = Buffer.from(header, "base64").toString("utf-8");
    const principal = JSON.parse(decoded) as ClientPrincipal;
    
    // 必須フィールドの検証
    if (!principal.userId || !principal.userRoles) {
      return null;
    }
    
    return principal;
  } catch (error) {
    console.error("Failed to parse client principal:", error);
    return null;
  }
}

/**
 * 認証を要求し、失敗時は例外をスロー
 */
export function requireAuth(request: HttpRequest): ClientPrincipal {
  const principal = getClientPrincipal(request);
  
  if (!principal) {
    throw new AuthenticationError();
  }
  
  if (!principal.userRoles.includes("authenticated")) {
    throw new AuthorizationError();
  }
  
  return principal;
}

/**
 * 認証エラーをHTTPレスポンスに変換
 */
export function handleAuthError(error: unknown, corsHeaders: Record<string, string>): HttpResponseInit {
  if (error instanceof AuthenticationError) {
    return {
      status: 401,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        success: false,
        error: error.message,
        code: "AUTH_REQUIRED"
      })
    };
  }
  
  if (error instanceof AuthorizationError) {
    return {
      status: 403,
      headers: { "Content-Type": "application/json", ...corsHeaders },
      body: JSON.stringify({
        success: false,
        error: error.message,
        code: "ACCESS_DENIED"
      })
    };
  }
  
  // 予期しないエラー
  console.error("Unexpected auth error:", error);
  return {
    status: 500,
    headers: { "Content-Type": "application/json", ...corsHeaders },
    body: JSON.stringify({
      success: false,
      error: "Internal server error",
      code: "INTERNAL_ERROR"
    })
  };
}

// ========== 開発環境用 ==========

const DEV_USER: ClientPrincipal = {
  identityProvider: "local",
  userId: "dev-user-001",
  userDetails: "Developer",
  userRoles: ["anonymous", "authenticated"]
};

/**
 * 開発環境では認証をスキップ
 */
export function getClientPrincipalWithDevFallback(request: HttpRequest): ClientPrincipal | null {
  const principal = getClientPrincipal(request);
  
  if (principal) {
    return principal;
  }
  
  // 開発環境でのフォールバック
  if (process.env.NODE_ENV === "development" || process.env.AZURE_FUNCTIONS_ENVIRONMENT === "Development") {
    console.warn("Using development user fallback");
    return DEV_USER;
  }
  
  return null;
}
