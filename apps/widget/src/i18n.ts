import { agentInfo, languageOverride } from './signals';

export type WidgetLanguage = 'ru' | 'en';

type TranslationKey = keyof typeof translations.en;

const translations = {
  en: {
    agentFallback: 'Agent',
    supportFallback: 'Support',
    launcherOpenChat: 'Open chat',
    launcherOpenChatWith: 'Chat with {name}',
    close: 'Close',
    chatUnavailable: 'Chat is temporarily unavailable',
    waitingOperator: 'Waiting for operator',
    withOperator: 'With operator',
    findingOperator: 'Looking for an available operator...',
    handoffRequested: 'The request has been sent to an operator. Please wait for connection...',
    operator: 'Operator',
    operatorJoined: 'Operator joined',
    operatorJoinedNamed: 'Operator {name} joined',
    csatThanks: 'Thanks for your rating!',
    quickRepliesLabel: 'Reply options',
    messagePlaceholder: 'Write a message...',
    send: 'Send',
    connectionError: 'Connection error',
    noActiveSession: 'No active session',
    transcriptionFailed: 'Transcription failed',
    microphoneDenied: 'Microphone access denied',
    stopRecording: 'Stop recording',
    voiceInput: 'Voice input',
    csatError: 'Failed to submit rating',
    csatGood: 'Good',
    csatBad: 'Bad',
    csatTitle: 'Rate support quality',
    csatCommentPlaceholder: 'Comment (optional)',
    csatSending: 'Sending...',
    csatSubmit: 'Submit rating',
    createSessionFailed: 'Failed to create session',
    submitRatingFailed: 'Failed to submit rating',
    endChat: 'End chat',
    endingChat: 'Ending...',
    endChatHint: 'Finish the conversation and rate the answer.',
    closeSessionFailed: 'Failed to close chat',
    startNewChat: 'Start new chat',
    startingNewChat: 'Starting...',
    startNewChatFailed: 'Failed to start a new chat',
    chatClosedAfterRating: 'This chat is closed. You can start a new one.',
    errorOriginNotAllowed:
      'This website is not allowed to use the chat widget. Add the site origin in the agent profile.',
    errorMissingAgentKey: 'The widget is missing an agent key. Check the embed code.',
    errorAgentUnavailable: 'This chat agent is unavailable. Check that the agent is active.',
    errorMissingLlmKey:
      'AI provider key is not configured. Add an OpenRouter or compatible API key in admin settings.',
    errorMissingEmbeddingKey:
      'Embeddings key is not configured. Add an embeddings key before indexing the knowledge base.',
    errorRateLimited: 'Too many requests. Please try again a little later.',
    errorServerSetup:
      'The chat is not fully configured yet. Please contact the site owner or check the admin setup checklist.',
  },
  ru: {
    agentFallback: 'Агент',
    supportFallback: 'Поддержка',
    launcherOpenChat: 'Открыть чат',
    launcherOpenChatWith: 'Чат с {name}',
    close: 'Закрыть',
    chatUnavailable: 'Чат временно недоступен',
    waitingOperator: 'Ожидание оператора',
    withOperator: 'С оператором',
    findingOperator: 'Ищем свободного оператора...',
    handoffRequested: 'Запрос передан оператору. Ожидайте подключения...',
    operator: 'Оператор',
    operatorJoined: 'Оператор подключился',
    operatorJoinedNamed: 'Оператор {name} подключился',
    csatThanks: 'Спасибо за оценку!',
    quickRepliesLabel: 'Варианты ответа',
    messagePlaceholder: 'Напишите сообщение...',
    send: 'Отправить',
    connectionError: 'Ошибка соединения',
    noActiveSession: 'Нет активной сессии',
    transcriptionFailed: 'Ошибка транскрибации',
    microphoneDenied: 'Нет доступа к микрофону',
    stopRecording: 'Остановить запись',
    voiceInput: 'Голосовой ввод',
    csatError: 'Не удалось отправить оценку',
    csatGood: 'Хорошо',
    csatBad: 'Плохо',
    csatTitle: 'Оцените качество поддержки',
    csatCommentPlaceholder: 'Комментарий (необязательно)',
    csatSending: 'Отправка...',
    csatSubmit: 'Отправить оценку',
    createSessionFailed: 'Не удалось создать сессию',
    submitRatingFailed: 'Не удалось отправить оценку',
    endChat: 'Завершить чат',
    endingChat: 'Завершаем...',
    endChatHint: 'Завершите диалог и оцените ответ.',
    closeSessionFailed: 'Не удалось завершить чат',
    startNewChat: 'Начать новый чат',
    startingNewChat: 'Начинаем...',
    startNewChatFailed: 'Не удалось начать новый чат',
    chatClosedAfterRating: 'Этот чат завершен. Вы можете начать новый.',
    errorOriginNotAllowed:
      'Этот сайт не разрешен для виджета. Добавьте origin сайта в профиле агента.',
    errorMissingAgentKey: 'В embed-коде виджета не найден ключ агента. Проверьте код установки.',
    errorAgentUnavailable: 'Этот агент сейчас недоступен. Проверьте, что агент включен.',
    errorMissingLlmKey:
      'Не настроен ключ AI-провайдера. Добавьте OpenRouter или compatible API key в админке.',
    errorMissingEmbeddingKey:
      'Не настроен ключ embeddings. Добавьте ключ для индексации базы знаний.',
    errorRateLimited: 'Слишком много запросов. Попробуйте еще раз немного позже.',
    errorServerSetup:
      'Чат еще не полностью настроен. Свяжитесь с владельцем сайта или проверьте чек-лист в админке.',
  },
} as const;

function normalizeLanguage(value: string | null | undefined): WidgetLanguage | null {
  if (!value || value === 'auto') return null;
  const normalized = value.toLowerCase();
  if (normalized.startsWith('ru')) return 'ru';
  if (normalized.startsWith('en')) return 'en';
  return null;
}

export function getWidgetLanguage(): WidgetLanguage {
  if (languageOverride.value) return languageOverride.value;

  const agentLanguage = normalizeLanguage(agentInfo.value?.language);
  if (agentLanguage) return agentLanguage;

  if (typeof navigator !== 'undefined') {
    const browserLanguage = normalizeLanguage(navigator.language);
    if (browserLanguage) return browserLanguage;
  }

  return 'en';
}

export function t(key: TranslationKey, vars: Record<string, string> = {}): string {
  let text: string = translations[getWidgetLanguage()][key] ?? translations.en[key];
  for (const [name, value] of Object.entries(vars)) {
    text = text.replaceAll(`{${name}}`, value);
  }
  return text;
}
