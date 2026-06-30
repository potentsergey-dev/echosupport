// Shared TypeScript types for EchoSupport
// Add common types, enums and interfaces here as the project grows.

export type TenantId = string;
export type AgentId = string;
export type SessionId = string;
export type MessageId = string;
export type UserId = string;

export type Role = 'OWNER' | 'ADMIN' | 'AGENT';

export type AgentLanguage = 'auto' | 'ru' | 'en' | 'be';

export type JobStatus = 'PENDING' | 'RUNNING' | 'DONE' | 'FAILED';

export type DocumentStatus = 'PENDING' | 'INDEXING' | 'INDEXED' | 'FAILED';
