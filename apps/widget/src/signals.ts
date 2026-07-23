import { signal } from '@preact/signals';
import type { AgentInfo, Message, SessionStatus } from './types';

export const isOpen = signal(false);
export const messages = signal<Message[]>([]);
export const isTyping = signal(false);
export const isRecording = signal(false);
export const sessionId = signal<string | null>(null);
export const agentInfo = signal<AgentInfo | null>(null);
export const inputText = signal('');
export const apiBase = signal('');
export const agentKey = signal('');
export const languageOverride = signal<'ru' | 'en' | null>(null);

// Phase 10.5 — operator handoff state
export const sessionStatus = signal<SessionStatus>('ACTIVE');
export const operatorTyping = signal(false);
export const handoffPending = signal(false);

// Phase 10.7 — CSAT
export const csatDone = signal(false);
export const quickReplies = signal<string[]>([]);
export const proactivePrompt = signal<string | null>(null);
