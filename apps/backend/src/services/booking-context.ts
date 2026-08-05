export interface BookingServiceReference {
  id: string;
  name: string;
}

export interface BookingContext {
  serviceId: string;
  serviceName: string;
  needsDate: boolean;
  selectedSlot?: true;
  selectedSlotTime?: string;
  groupParticipants?: number;
}

function normalize(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/ё/g, 'е');
}

export function parseBookingContext(value: unknown): BookingContext | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.serviceId !== 'string' ||
    typeof candidate.serviceName !== 'string' ||
    typeof candidate.needsDate !== 'boolean'
  ) {
    return null;
  }
  return {
    serviceId: candidate.serviceId,
    serviceName: candidate.serviceName,
    needsDate: candidate.needsDate,
    ...(candidate.selectedSlot === true ? { selectedSlot: true as const } : {}),
    ...(typeof candidate.selectedSlotTime === 'string'
      ? { selectedSlotTime: candidate.selectedSlotTime }
      : {}),
    ...(Number.isInteger(candidate.groupParticipants) &&
    typeof candidate.groupParticipants === 'number' &&
    candidate.groupParticipants >= 1 &&
    candidate.groupParticipants <= 20
      ? { groupParticipants: candidate.groupParticipants }
      : {}),
  };
}

export function hasExplicitDateReference(text: string): boolean {
  return /\b(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|(?<!\p{L})(?:сегодня|завтра|послезавтра|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)(?!\p{L})|\b\d{4}-\d{2}-\d{2}\b|\b(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])(?:\.\d{2,4})?\b|\b\d{1,2}\s*(?:янв(?:аря)?|фев(?:раля)?|марта|апреля|мая|июн(?:я)?|июл(?:я)?|авг(?:уста)?|сен(?:тября)?|окт(?:ября)?|ноя(?:бря)?|дек(?:абря)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?!\p{L})/iu.test(
    text,
  );
}

export function extractBookingTime(text: string): string | null {
  const match = /\b(?:[01]?\d|2[0-3]):[0-5]\d\b/.exec(text);
  if (!match) return null;
  const [hour, minute] = match[0].split(':').map(Number);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function hasExplicitBookingDateTime(text: string): boolean {
  return hasExplicitDateReference(text) && extractBookingTime(text) !== null;
}

function extractConfirmedGroupParticipants(text: string): number | null {
  const normalizedText = normalize(text);
  if (
    /(?:только\s+(?:я|для\s+себя|себя)|(?:я\s+)?один\s+человек|(?<!\d)1(?!\d)\s*(?:человек|участник)?|only\s+(?:me|myself)|just\s+me)/iu.test(
      normalizedText,
    )
  ) {
    return 1;
  }
  return null;
}

function withoutSelectedSlot(context: BookingContext): BookingContext {
  const result = { ...context };
  delete result.selectedSlot;
  delete result.selectedSlotTime;
  return result;
}

export function deriveBookingContext(
  currentValue: unknown,
  visitorText: string,
  services: BookingServiceReference[],
): BookingContext | null {
  const current = parseBookingContext(currentValue);
  const normalizedText = normalize(visitorText);
  const mentionedService = services
    .filter((service) => normalizedText.includes(normalize(service.name)))
    .sort((left, right) => right.name.length - left.name.length)[0];
  const hasDate = hasExplicitDateReference(visitorText);
  const selectedSlotTime = extractBookingTime(visitorText);
  const hasDateTime = hasDate && selectedSlotTime !== null;
  const groupParticipants = extractConfirmedGroupParticipants(visitorText);

  const withConfirmedParticipants = (context: BookingContext | null): BookingContext | null =>
    context && groupParticipants !== null ? { ...context, groupParticipants } : context;

  if (mentionedService) {
    if (!current || current.serviceId !== mentionedService.id) {
      return withConfirmedParticipants({
        serviceId: mentionedService.id,
        serviceName: mentionedService.name,
        needsDate: !hasDate,
        ...(hasDateTime ? { selectedSlot: true as const, selectedSlotTime } : {}),
      });
    }
    if (hasDateTime) {
      return withConfirmedParticipants({
        ...current,
        needsDate: false,
        selectedSlot: true,
        selectedSlotTime,
      });
    }
    if (hasDate)
      return withConfirmedParticipants({ ...withoutSelectedSlot(current), needsDate: false });
    return withConfirmedParticipants(current);
  }

  if (current?.needsDate && hasDate) {
    return withConfirmedParticipants(
      hasDateTime
        ? { ...current, needsDate: false, selectedSlot: true, selectedSlotTime }
        : { ...withoutSelectedSlot(current), needsDate: false },
    );
  }
  if (current && hasDate) {
    return withConfirmedParticipants(
      hasDateTime
        ? { ...current, selectedSlot: true, selectedSlotTime }
        : withoutSelectedSlot(current),
    );
  }
  return withConfirmedParticipants(current);
}
function usesRussianLanguage(text: string): boolean {
  return /\p{Script=Cyrillic}/u.test(text) || /^(?:ru|be|uk)(?:[-_]|$)/iu.test(text.trim());
}

function usesEnglishLanguage(text: string): boolean {
  return /[a-z]/iu.test(text);
}

export function buildBookingDateQuestion(
  serviceName: string,
  visitorText: string,
  conversationLanguage = '',
): string {
  const useRussian = usesRussianLanguage(visitorText)
    ? true
    : usesEnglishLanguage(visitorText)
      ? false
      : usesRussianLanguage(conversationLanguage);

  if (useRussian) {
    return `Для записи на «${serviceName}» укажите, пожалуйста, дату.`;
  }
  return `Please tell me which date you would like for ${serviceName}.`;
}
