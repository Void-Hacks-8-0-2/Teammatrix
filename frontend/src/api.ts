/**
 * Offline Law Enforcement Authentication & Fetch Utility
 * Manages JWT tokens, session lifecycle, and automatic Authorization header injection.
 */

export const TOKEN_KEY = 'officer_token';
export const USERNAME_KEY = 'officer_username';
export const ROLE_KEY = 'officer_role';

export function getAuthToken(): string | null {
  return sessionStorage.getItem(TOKEN_KEY);
}

export function getOfficerUsername(): string {
  return sessionStorage.getItem(USERNAME_KEY) || 'Investigating Officer';
}

export function setOfficerSession(token: string, username: string, role?: string) {
  sessionStorage.setItem(TOKEN_KEY, token);
  sessionStorage.setItem(USERNAME_KEY, username);
  if (role) {
    sessionStorage.setItem(ROLE_KEY, role);
  }
}

export function clearOfficerSession() {
  sessionStorage.removeItem(TOKEN_KEY);
  sessionStorage.removeItem(USERNAME_KEY);
  sessionStorage.removeItem(ROLE_KEY);
}

export function isAuthenticated(): boolean {
  return !!getAuthToken();
}

/**
 * Returns an object with Authorization header if officer is authenticated
 */
export function getAuthHeaders(extraHeaders: Record<string, string> = {}): Record<string, string> {
  const token = getAuthToken();
  const headers: Record<string, string> = { ...extraHeaders };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

/**
 * Global fetch interceptor ensuring every /api/* call carries the Authorization Bearer header
 */
export function setupFetchInterceptor() {
  if (typeof window === 'undefined') return;

  const originalFetch = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const token = getAuthToken();
    const urlStr =
      typeof input === 'string'
        ? input
        : input instanceof URL
        ? input.toString()
        : (input as Request).url;

    // Only attach token to local /api calls and not to login itself
    if (token && (urlStr.startsWith('/api') || urlStr.includes('/api/')) && !urlStr.includes('/api/login')) {
      const headers = new Headers(init.headers || (input instanceof Request ? input.headers : {}));
      if (!headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
      }
      init.headers = headers;
    }

    const response = await originalFetch(input, init);

    // If session expired or unauthorized on protected endpoint, trigger logout
    if (response.status === 401 && !urlStr.includes('/api/login') && !urlStr.includes('/api/health')) {
      clearOfficerSession();
      window.dispatchEvent(new CustomEvent('auth:unauthorized'));
    }

    return response;
  };
}
