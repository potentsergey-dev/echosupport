export interface SuggestedReplyMessage {
  content: string;
  authorType: string;
  isInternal: boolean;
}

export function buildSuggestedReplyTranscript(messages: SuggestedReplyMessage[]): string {
  return messages
    .filter((message) => !message.isInternal && message.content.trim().length > 0)
    .map((message) => {
      const role =
        message.authorType === 'VISITOR'
          ? 'Visitor'
          : message.authorType === 'OPERATOR'
            ? 'Operator'
            : 'Agent';
      return `${role}: ${message.content.trim()}`;
    })
    .join('\n');
}
