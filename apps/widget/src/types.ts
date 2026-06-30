export interface AgentInfo {
  name: string;
  role: string | null;
  avatarUrl: string | null;
  greetingMessage: string | null;
  proactiveMessageDelay: number | null;
  proactiveMessageText: string | null;
}

export type MessageRole = 'user' | 'assistant' | 'operator' | 'system';
export type SessionStatus = 'ACTIVE' | 'WAITING_OPERATOR' | 'WITH_OPERATOR' | 'RESOLVED' | 'CLOSED';

export interface Message {
  id: string;
  role: MessageRole;
  text: string;
}

export interface SseTypingEvent {
  typing: boolean;
}

export interface SseDeltaEvent {
  text: string;
}

export interface SseDoneEvent {
  messageId: string;
  fullText: string;
  handoffRequested?: boolean;
}

export interface SseErrorEvent {
  code: string;
  message: string;
}

export interface SseQuickRepliesEvent {
  replies: string[];
}

// ── WebSocket Events (visitor channel) ───────────────────────────────────────

export interface WsOperatorMessage {
  type: 'operator:message';
  sessionId: string;
  content: string;
  authorId: string;
}

export interface WsOperatorTyping {
  type: 'operator:typing_visitor';
  sessionId: string;
  typing: boolean;
}

export interface WsOperatorJoined {
  type: 'operator:joined';
  sessionId: string;
  operatorName?: string;
}

export interface WsSessionStatus {
  type: 'session:status';
  sessionId: string;
  status: SessionStatus;
}

export type WsVisitorEvent =
  | WsOperatorMessage
  | WsOperatorTyping
  | WsOperatorJoined
  | WsSessionStatus;
