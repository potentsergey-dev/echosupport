const TOKEN_KEY = 'es_admin_token';
const ROLE_KEY = 'es_admin_role';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export function isAuthenticated(): boolean {
  return getToken() !== null;
}

export function getRole(): string | null {
  return localStorage.getItem(ROLE_KEY);
}

export function setRole(role: string): void {
  localStorage.setItem(ROLE_KEY, role);
}

export function clearRole(): void {
  localStorage.removeItem(ROLE_KEY);
}

export function isAdminRole(): boolean {
  const role = getRole();
  return role === 'OWNER' || role === 'ADMIN';
}
