// Shared TypeScript types for the Admin UI

export type SourcePriority = 'MERGE' | 'FILES_FIRST' | 'URL_FIRST';
export type SttProvider = 'DEEPGRAM' | 'WHISPER';
export type DocumentStatus = 'PENDING' | 'INDEXING' | 'INDEXED' | 'FAILED';
export type JobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED' | 'CANCELLED';
export type SessionStatus = 'ACTIVE' | 'WAITING_OPERATOR' | 'WITH_OPERATOR' | 'RESOLVED' | 'CLOSED';
export type MessageAuthorType = 'VISITOR' | 'AGENT' | 'OPERATOR' | 'SYSTEM';

export interface Agent {
  id: string;
  name: string;
  role: string | null;
  avatarUrl: string | null;
  greetingMessage: string | null;
  proactiveMessageDelay: number | null;
  proactiveMessageText: string | null;
  systemPrompt: string;
  llmModel: string;
  embeddingModel: string;
  language: string;
  sourcePriority: SourcePriority;
  sttProvider: SttProvider;
  sessionTtlMinutes: number;
  allowedOrigins: string[];
  isActive: boolean;
  publicKey: string;
  maxMessagesPerHourPerVisitor: number;
  maxSessionsPerDayPerVisitor: number;
  maxMessageLength: number;
  bookingEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  _count?: { documents: number; sources: number };
}

export interface AgentListItem {
  id: string;
  name: string;
  role: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  publicKey: string;
  createdAt: string;
  updatedAt: string;
}

export interface Document {
  id: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  status: DocumentStatus;
  chunksCount: number | null;
  errorMessage: string | null;
  createdAt: string;
  indexedAt: string | null;
}

export interface KnowledgeSource {
  id: string;
  url: string;
  maxDepth: number;
  includePaths: string[];
  excludePaths: string[];
  status: DocumentStatus;
  pagesIndexed: number | null;
  errorMessage: string | null;
  createdAt: string;
  indexedAt: string | null;
}

export interface Job {
  id: string;
  type: string;
  agentId: string;
  status: JobStatus;
  progress: number;
  errorMessage: string | null;
  scheduledAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface Session {
  id: string;
  agentId: string;
  visitorId: string;
  status: string;
  expiresAt: string;
  createdAt: string;
  summary: string | null;
  _count?: { messages: number };
}

export interface MaskedSecrets {
  openrouterKey: string | null;
  openrouterEmbeddingKey: string | null;
  openaiKey: string | null;
  openaiEmbeddingKey: string | null;
  deepgramKey: string | null;
}

export type ConfigCheckStatus = 'ok' | 'warning' | 'error';

export interface ConfigCheckItem {
  id: string;
  label: string;
  status: ConfigCheckStatus;
  message: string;
  action?: string;
}

export interface ConfigCheckReport {
  status: ConfigCheckStatus;
  checkedAt: string;
  items: ConfigCheckItem[];
}

// ── Operator Inbox ────────────────────────────────────────────────────────────

export interface InboxSession {
  id: string;
  agentId: string;
  agentName?: string;
  status: SessionStatus;
  visitorName: string | null;
  visitorContact: string | null;
  pageUrl: string | null;
  handoffReason: string | null;
  handoffRequestedAt: string | null;
  assignedOperatorId: string | null;
  unreadByOperator: number;
  internalNote: string | null;
  tags: string[];
  lastActiveAt: string;
  createdAt: string;
}

export interface OperatorMessage {
  id: string;
  sessionId: string;
  role: string;
  authorType: MessageAuthorType;
  authorId: string | null;
  content: string;
  isInternal: boolean;
  createdAt: string;
}

export interface InboxSessionDetail extends InboxSession {
  messages: OperatorMessage[];
}

// ── Business Hours ─────────────────────────────────────────────────────────────

export interface ScheduleEntry {
  dayOfWeek: number; // 0=Sun, 1=Mon … 6=Sat
  from: string; // HH:mm
  to: string; // HH:mm
}

export interface BusinessHours {
  id: string;
  agentId: string;
  timezone: string;
  enabled: boolean;
  schedule: ScheduleEntry[];
  holidays: string[];
  outOfHoursMessage: string | null;
  updatedAt: string;
}

// ── Canned Responses ─────────────────────────────────────────────────────────

export interface CannedResponse {
  id: string;
  shortcut: string;
  content: string;
}

// ── Phase 10.6 Booking ────────────────────────────────────────────────────────

export type AppointmentStatus = 'PENDING' | 'CONFIRMED' | 'CANCELLED' | 'COMPLETED' | 'NO_SHOW';
export type AppointmentSource = 'AGENT' | 'OPERATOR';

export interface SpecialistWorkingHours {
  id: string;
  specialistId: string;
  dayOfWeek: number; // 0=Sun..6=Sat
  fromMinutes: number; // e.g. 540 = 09:00
  toMinutes: number; // e.g. 1080 = 18:00
}

export interface Specialist {
  id: string;
  tenantId: string;
  agentId: string | null;
  name: string;
  role: string | null;
  description: string | null;
  avatarUrl: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  workingHours?: SpecialistWorkingHours[];
  services?: Service[];
  _count?: { services: number; appointments: number };
}

export interface Service {
  id: string;
  tenantId: string;
  specialistId: string | null;
  name: string;
  description: string | null;
  durationMin: number;
  priceLabel: string | null;
  isGroup: boolean;
  capacity: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  specialist?: { id: string; name: string; role: string | null } | null;
  _count?: { appointments: number };
}

export interface Appointment {
  id: string;
  tenantId: string;
  agentId: string | null;
  sessionId: string | null;
  specialistId: string;
  serviceId: string | null;
  visitorName: string;
  visitorPhone: string;
  visitorEmail: string | null;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  source: AppointmentSource;
  notes: string | null;
  createdByUserId: string | null;
  createdAt: string;
  updatedAt: string;
  specialist?: { id: string; name: string; role: string | null };
  service?: {
    id: string;
    name: string;
    durationMin: number;
    isGroup?: boolean;
    capacity?: number;
  } | null;
}

export interface AvailableSlot {
  startsAt: string; // ISO
  endsAt: string; // ISO
}
