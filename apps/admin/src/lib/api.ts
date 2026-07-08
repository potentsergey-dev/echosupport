import { getToken, clearToken } from './auth';
import type {
  Agent,
  AgentListItem,
  Document,
  KnowledgeSource,
  MaskedSecrets,
  Session,
  InboxSession,
  InboxSessionDetail,
  BusinessHours,
  CannedResponse,
  Specialist,
  SpecialistWorkingHours,
  Service,
  Appointment,
} from '../types';

const BASE_URL = (import.meta.env['VITE_API_URL'] as string | undefined) ?? '';

function formatApiError(error: unknown, fallback: string): string {
  if (typeof error === 'string' && error.trim()) return error;

  if (Array.isArray(error)) {
    const messages = error.filter((item): item is string => typeof item === 'string' && !!item);
    if (messages.length > 0) return messages.join(', ');
  }

  if (error && typeof error === 'object') {
    const fieldErrors = Object.entries(error as Record<string, unknown>)
      .flatMap(([field, value]) => {
        if (!Array.isArray(value)) return [];
        const messages = value.filter((item): item is string => typeof item === 'string' && !!item);
        return messages.map((message) => `${field}: ${message}`);
      })
      .join('; ');
    if (fieldErrors) return fieldErrors;
  }

  return fallback;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(init?.body !== undefined && !(init?.body instanceof FormData)
      ? { 'Content-Type': 'application/json' }
      : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(init?.headers as Record<string, string> | undefined),
  };

  const res = await fetch(`${BASE_URL}/api/v1${path}`, {
    ...init,
    headers,
  });

  if (!res.ok) {
    if (res.status === 401) {
      clearToken();
      window.location.href = '/admin/login';
      throw new Error('Session expired. Please log in again.');
    }
    const body = (await res.json().catch(() => ({ error: res.statusText }))) as {
      error?: unknown;
    };
    throw new Error(formatApiError(body.error, res.statusText));
  }

  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Auth ─────────────────────────────────────────────────────────────────────

export function login(
  email: string,
  password: string,
): Promise<{ token: string; user: { id: string; email: string; role: string } }> {
  return request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
}

// ── Agents ───────────────────────────────────────────────────────────────────

export function listAgents(): Promise<AgentListItem[]> {
  return request('/admin/agents');
}

export function getAgent(id: string): Promise<Agent> {
  return request(`/admin/agents/${id}`);
}

export function createAgent(data: { name: string; systemPrompt: string }): Promise<Agent> {
  return request('/admin/agents', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateAgent(id: string, data: Partial<Agent>): Promise<Agent> {
  return request(`/admin/agents/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteAgent(id: string): Promise<void> {
  return request(`/admin/agents/${id}`, { method: 'DELETE' });
}

export function uploadAvatar(id: string, file: File): Promise<Agent> {
  const form = new FormData();
  form.append('avatar', file);
  return request(`/admin/agents/${id}/avatar`, {
    method: 'POST',
    body: form,
  });
}

export function getSecrets(id: string): Promise<MaskedSecrets> {
  return request(`/admin/agents/${id}/secrets`);
}

export function saveSecrets(
  id: string,
  secrets: {
    openrouterKey?: string;
    openrouterEmbeddingKey?: string;
    openaiKey?: string;
    openaiEmbeddingKey?: string;
    deepgramKey?: string;
  },
): Promise<MaskedSecrets> {
  return request(`/admin/agents/${id}/secrets`, {
    method: 'POST',
    body: JSON.stringify(secrets),
  });
}

export function getEmbedSnippet(
  id: string,
): Promise<{ snippet: string; agentKey: string; publicBaseUrl: string }> {
  return request(`/admin/agents/${id}/embed-snippet`);
}

// ── Documents ────────────────────────────────────────────────────────────────

export function listDocuments(agentId: string): Promise<Document[]> {
  return request(`/admin/agents/${agentId}/documents`);
}

export function uploadDocument(agentId: string, file: File): Promise<Document> {
  const form = new FormData();
  form.append('file', file);
  return request(`/admin/agents/${agentId}/documents`, {
    method: 'POST',
    body: form,
  });
}

export function deleteDocument(agentId: string, docId: string): Promise<void> {
  return request(`/admin/agents/${agentId}/documents/${docId}`, { method: 'DELETE' });
}

// ── Knowledge Sources ────────────────────────────────────────────────────────

export function listSources(agentId: string): Promise<KnowledgeSource[]> {
  return request(`/admin/agents/${agentId}/sources`);
}

export function addSource(
  agentId: string,
  data: { url: string; maxDepth: number },
): Promise<KnowledgeSource> {
  return request(`/admin/agents/${agentId}/sources`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function deleteSource(agentId: string, sourceId: string): Promise<void> {
  return request(`/admin/agents/${agentId}/sources/${sourceId}`, { method: 'DELETE' });
}

// ── Reindex / Jobs ───────────────────────────────────────────────────────────

export function triggerReindex(agentId: string): Promise<{ jobId: string }> {
  return request(`/admin/agents/${agentId}/reindex`, { method: 'POST' });
}

// ── Sessions ─────────────────────────────────────────────────────────────────

export function listSessions(agentId: string): Promise<Session[]> {
  return request(`/admin/agents/${agentId}/sessions`);
}

export function deleteSession(sessionId: string): Promise<void> {
  return request(`/admin/sessions/${sessionId}`, { method: 'DELETE' });
}

// ── Operator Inbox ────────────────────────────────────────────────────────────

export function listInboxSessions(params?: {
  status?: string;
  agentId?: string;
}): Promise<InboxSession[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.agentId) qs.set('agentId', params.agentId);
  const query = qs.toString();
  return request(`/operator/inbox${query ? `?${query}` : ''}`);
}

export function getInboxSession(sessionId: string): Promise<InboxSessionDetail> {
  return request(`/operator/sessions/${sessionId}`);
}

export function takeSession(sessionId: string): Promise<{ ok: boolean }> {
  return request(`/operator/sessions/${sessionId}/take`, { method: 'POST' });
}

export function resolveSession(
  sessionId: string,
  data?: { tags?: string[]; note?: string },
): Promise<{ ok: boolean }> {
  return request(`/operator/sessions/${sessionId}/resolve`, {
    method: 'POST',
    body: JSON.stringify(data ?? {}),
  });
}

export function returnToAgent(sessionId: string): Promise<{ ok: boolean }> {
  return request(`/operator/sessions/${sessionId}/return-to-agent`, { method: 'POST' });
}

export function sendOperatorMessage(
  sessionId: string,
  data: { content: string; isInternal?: boolean },
): Promise<{ id: string }> {
  return request(`/operator/sessions/${sessionId}/messages`, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateSessionMeta(
  sessionId: string,
  data: { tags?: string[]; internalNote?: string; visitorName?: string; visitorContact?: string },
): Promise<{ ok: boolean }> {
  return request(`/operator/sessions/${sessionId}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ── Canned Responses ─────────────────────────────────────────────────────────

export function listCannedResponses(): Promise<CannedResponse[]> {
  return request('/operator/canned-responses');
}

export function createCannedResponse(data: {
  shortcut: string;
  content: string;
}): Promise<CannedResponse> {
  return request('/operator/canned-responses', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function deleteCannedResponse(id: string): Promise<void> {
  return request(`/operator/canned-responses/${id}`, { method: 'DELETE' });
}

// ── Business Hours ────────────────────────────────────────────────────────────

export function getBusinessHours(agentId: string): Promise<BusinessHours | null> {
  return request(`/admin/agents/${agentId}/business-hours`);
}

export function saveBusinessHours(
  agentId: string,
  data: Omit<BusinessHours, 'id' | 'agentId' | 'updatedAt'>,
): Promise<BusinessHours> {
  return request(`/admin/agents/${agentId}/business-hours`, {
    method: 'PUT',
    body: JSON.stringify(data),
  });
}

// ── Specialists (Phase 10.6) ──────────────────────────────────────────────────

export function listSpecialists(params?: { agentId?: string }): Promise<Specialist[]> {
  const qs = params?.agentId ? `?agentId=${params.agentId}` : '';
  return request(`/admin/specialists${qs}`);
}

export function getSpecialist(id: string): Promise<Specialist> {
  return request(`/admin/specialists/${id}`);
}

export function createSpecialist(data: {
  name: string;
  role?: string;
  description?: string;
  agentId?: string;
  isActive?: boolean;
}): Promise<Specialist> {
  return request('/admin/specialists', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateSpecialist(
  id: string,
  data: Partial<{
    name: string;
    role: string;
    description: string;
    avatarUrl: string;
    agentId: string;
    isActive: boolean;
  }>,
): Promise<Specialist> {
  return request(`/admin/specialists/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteSpecialist(id: string): Promise<void> {
  return request(`/admin/specialists/${id}`, { method: 'DELETE' });
}

export function getSpecialistWorkingHours(specialistId: string): Promise<SpecialistWorkingHours[]> {
  return request(`/admin/specialists/${specialistId}/working-hours`);
}

export function saveSpecialistWorkingHours(
  specialistId: string,
  entries: Array<{ dayOfWeek: number; fromMinutes: number; toMinutes: number }>,
): Promise<SpecialistWorkingHours[]> {
  return request(`/admin/specialists/${specialistId}/working-hours`, {
    method: 'PUT',
    body: JSON.stringify(entries),
  });
}

// ── Services (Phase 10.6) ─────────────────────────────────────────────────────

export function listServices(params?: { specialistId?: string }): Promise<Service[]> {
  const qs = params?.specialistId ? `?specialistId=${params.specialistId}` : '';
  return request(`/admin/services${qs}`);
}

export function createService(data: {
  name: string;
  durationMin: number;
  priceLabel?: string | null;
  description?: string | null;
  specialistId?: string | null;
  isActive?: boolean;
}): Promise<Service> {
  return request('/admin/services', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function updateService(
  id: string,
  data: Partial<{
    name: string;
    durationMin: number;
    priceLabel: string | null;
    description: string | null;
    specialistId: string | null;
    isActive: boolean;
  }>,
): Promise<Service> {
  return request(`/admin/services/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export function deleteService(id: string): Promise<void> {
  return request(`/admin/services/${id}`, { method: 'DELETE' });
}

// ── Appointments (Phase 10.6) ─────────────────────────────────────────────────

export function listAppointments(params?: {
  status?: string;
  from?: string;
  to?: string;
  specialistId?: string;
}): Promise<Appointment[]> {
  const qs = new URLSearchParams();
  if (params?.status) qs.set('status', params.status);
  if (params?.from) qs.set('from', params.from);
  if (params?.to) qs.set('to', params.to);
  if (params?.specialistId) qs.set('specialistId', params.specialistId);
  const q = qs.toString();
  return request(`/operator/appointments${q ? `?${q}` : ''}`);
}

export function createAppointment(data: {
  specialistId?: string;
  serviceId?: string;
  visitorName: string;
  visitorPhone: string;
  visitorEmail?: string;
  startsAt: string;
  notes?: string;
  sessionId?: string;
}): Promise<Appointment> {
  return request('/operator/appointments', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function confirmAppointment(id: string): Promise<Appointment> {
  return request(`/operator/appointments/${id}/confirm`, { method: 'PATCH' });
}

export function cancelAppointment(id: string, reason?: string): Promise<Appointment> {
  return request(`/operator/appointments/${id}/cancel`, {
    method: 'PATCH',
    body: JSON.stringify({ reason }),
  });
}

export function rescheduleAppointment(id: string, startsAt: string): Promise<Appointment> {
  return request(`/operator/appointments/${id}/reschedule`, {
    method: 'PATCH',
    body: JSON.stringify({ startsAt }),
  });
}

export function updateAppointment(
  id: string,
  data: Partial<{
    notes: string;
    visitorName: string;
    visitorPhone: string;
    visitorEmail: string;
    status: string;
  }>,
): Promise<Appointment> {
  return request(`/operator/appointments/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

// ── Phase 10.7 ────────────────────────────────────────────────────────────────

export function suggestReply(sessionId: string): Promise<{ draft: string }> {
  return request(`/operator/sessions/${sessionId}/suggest-reply`, { method: 'POST' });
}

export interface CsatSummary {
  summary: { total: number; positive: number; negative: number; score: number | null };
  ratings: Array<{
    id: string;
    agentId: string;
    csatRating: number;
    csatComment: string | null;
    visitorName: string | null;
    startedAt: string;
    agent: { name: string };
  }>;
}

export function getCsatReport(agentId?: string): Promise<CsatSummary> {
  const qs = agentId ? `?agentId=${agentId}` : '';
  return request(`/admin/csat${qs}`);
}
