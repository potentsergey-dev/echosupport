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
  };
}

export function hasExplicitDateReference(text: string): boolean {
  return /\b(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|(?<!\p{L})(?:сегодня|завтра|послезавтра|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)(?!\p{L})|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s*(?:янв(?:аря)?|фев(?:раля)?|марта|апреля|мая|июн(?:я)?|июл(?:я)?|авг(?:уста)?|сен(?:тября)?|окт(?:ября)?|ноя(?:бря)?|дек(?:абря)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?!\p{L})/iu.test(
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

  if (mentionedService) {
    if (!current || current.serviceId !== mentionedService.id) {
      return {
        serviceId: mentionedService.id,
        serviceName: mentionedService.name,
        needsDate: !hasDate,
        ...(hasDateTime ? { selectedSlot: true as const, selectedSlotTime } : {}),
      };
    }
    if (hasDateTime) {
      return { ...current, needsDate: false, selectedSlot: true, selectedSlotTime };
    }
    if (hasDate) return { ...withoutSelectedSlot(current), needsDate: false };
    return current;
  }

  if (current?.needsDate && hasDate) {
    return hasDateTime
      ? { ...current, needsDate: false, selectedSlot: true, selectedSlotTime }
      : { ...withoutSelectedSlot(current), needsDate: false };
  }
  if (current && hasDate) {
    return hasDateTime
      ? { ...current, selectedSlot: true, selectedSlotTime }
      : withoutSelectedSlot(current);
  }
  return current;
}

export function buildBookingDateQuestion(serviceName: string, visitorText: string): string {
  if (/\p{Script=Cyrillic}/u.test(visitorText)) {
    return `Для записи на «${serviceName}» укажите, пожалуйста, дату.`;
  }
  return `Please tell me which date you would like for ${serviceName}.`;
}
