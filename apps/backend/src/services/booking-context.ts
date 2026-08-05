export interface BookingServiceReference {
  id: string;
  name: string;
}

export interface BookingContext {
  serviceId: string;
  serviceName: string;
  needsDate: boolean;
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
  };
}

export function hasExplicitDateReference(text: string): boolean {
  return /\b(?:today|tomorrow|tonight|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|(?<!\p{L})(?:сегодня|завтра|послезавтра|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)(?!\p{L})|\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}\s*(?:янв(?:аря)?|фев(?:раля)?|марта|апреля|мая|июн(?:я)?|июл(?:я)?|авг(?:уста)?|сен(?:тября)?|окт(?:ября)?|ноя(?:бря)?|дек(?:абря)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?!\p{L})/iu.test(
    text,
  );
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

  if (mentionedService) {
    if (!current || current.serviceId !== mentionedService.id) {
      return {
        serviceId: mentionedService.id,
        serviceName: mentionedService.name,
        needsDate: !hasDate,
      };
    }
    return { ...current, needsDate: hasDate ? false : current.needsDate };
  }

  if (current?.needsDate && hasDate) return { ...current, needsDate: false };
  return current;
}
