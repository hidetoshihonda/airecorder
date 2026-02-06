// ========== 型定義 ==========

export interface ClientPrincipal {
  identityProvider: string;
  userId: string;
  userDetails: string;
  userRoles: string[];
}

export interface AuthInfo {
  clientPrincipal: ClientPrincipal | null;
}

// ========== キャッシュ ==========

let cachedAuthInfo: AuthInfo | null = null;
let cacheTimestamp = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5分

// ========== 関数 ==========

/**
 * SWAから認証情報を取得
 */
export async function getAuthInfo(forceRefresh = false): Promise<AuthInfo> {
  const now = Date.now();
  
  // キャッシュが有効ならそれを返す
  if (!forceRefresh && cachedAuthInfo && (now - cacheTimestamp) < CACHE_TTL) {
    return cachedAuthInfo;
  }
  
  try {
    const response = await fetch('/.auth/me', {
      credentials: 'include'
    });
    
    if (!response.ok) {
      cachedAuthInfo = { clientPrincipal: null };
      cacheTimestamp = now;
      return cachedAuthInfo;
    }
    
    cachedAuthInfo = await response.json() as AuthInfo;
    cacheTimestamp = now;
    return cachedAuthInfo;
  } catch (error) {
    console.error('Failed to fetch auth info:', error);
    return { clientPrincipal: null };
  }
}

/**
 * キャッシュをクリア（ログアウト時など）
 */
export function clearAuthCache(): void {
  cachedAuthInfo = null;
  cacheTimestamp = 0;
}

/**
 * 認証済みかどうか
 */
export function isAuthenticated(authInfo: AuthInfo): boolean {
  return authInfo.clientPrincipal !== null &&
         authInfo.clientPrincipal.userRoles.includes('authenticated');
}

/**
 * ユーザーID取得
 */
export function getUserId(authInfo: AuthInfo): string | null {
  return authInfo.clientPrincipal?.userId ?? null;
}

/**
 * ユーザー名取得
 */
export function getUserName(authInfo: AuthInfo): string | null {
  return authInfo.clientPrincipal?.userDetails ?? null;
}

/**
 * IDプロバイダー取得
 */
export function getIdentityProvider(authInfo: AuthInfo): string | null {
  return authInfo.clientPrincipal?.identityProvider ?? null;
}

// ========== ログインURL ==========

export const LOGIN_URL = '/.auth/login/github';
export const LOGOUT_URL = '/.auth/logout';

export function getLoginUrl(redirectUri?: string): string {
  const redirect = redirectUri || (typeof window !== 'undefined' ? window.location.pathname : '/');
  return `${LOGIN_URL}?post_login_redirect_uri=${encodeURIComponent(redirect)}`;
}

export function getLogoutUrl(redirectUri = '/'): string {
  return `${LOGOUT_URL}?post_logout_redirect_uri=${encodeURIComponent(redirectUri)}`;
}
