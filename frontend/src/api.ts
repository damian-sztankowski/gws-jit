export function getStoredToken(): string | null {
  return localStorage.getItem('jit_token');
}

export function isAuthenticatedSession(): boolean {
  return Boolean(localStorage.getItem('jit_token') || sessionStorage.getItem('jit_iap_session') === '1');
}

export function setIapSessionActive(active: boolean): void {
  if (active) {
    sessionStorage.setItem('jit_iap_session', '1');
  } else {
    sessionStorage.removeItem('jit_iap_session');
  }
}

export function getAuthHeaders(includeJsonContentType = false): Record<string, string> {
  const headers: Record<string, string> = {};
  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }
  const token = localStorage.getItem('jit_token');
  if (token && token !== 'IAP_SESSION') {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}
