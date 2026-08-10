export interface BookingServiceReference {
  id: string;
  name: string;
}

export interface BookingSpecialistReference {
  id: string;
  name: string;
}

export interface BookingContext {
  serviceId: string;
  serviceName: string;
  needsDate: boolean;
  specialistId?: string;
  specialistName?: string;
  selectedSlot?: true;
  selectedSlotTime?: string;
  groupParticipants?: number;
  alternativeDatesRequested?: true;
  availabilitySearchRequested?: true;
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
    ...(typeof candidate.specialistId === 'string' && typeof candidate.specialistName === 'string'
      ? { specialistId: candidate.specialistId, specialistName: candidate.specialistName }
      : {}),
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
    ...(candidate.alternativeDatesRequested === true
      ? { alternativeDatesRequested: true as const }
      : {}),
    ...(candidate.availabilitySearchRequested === true
      ? { availabilitySearchRequested: true as const }
      : {}),
  };
}

export function hasExplicitDateReference(text: string): boolean {
  return /\b(?:today|tomorrow|tonight|this\s+week|next\s+week|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b|(?<!\p{L})(?:сегодня|завтра|послезавтра|понедельник|вторник|среда|четверг|пятница|суббота|воскресенье)(?!\p{L})|(?:эт|текущ|следующ)\p{L}*\s+недел\p{L}*|\b\d{4}-\d{2}-\d{2}\b|\b(?:0?[1-9]|[12]\d|3[01])\.(?:0?[1-9]|1[0-2])(?:\.\d{2,4})?\b|\b\d{1,2}\s*(?:янв(?:аря)?|фев(?:раля)?|марта|апреля|мая|июн(?:я)?|июл(?:я)?|авг(?:уста)?|сен(?:тября)?|окт(?:ября)?|ноя(?:бря)?|дек(?:абря)?|jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)(?!\p{L})/iu.test(
    text,
  );
}

function hasAlternativeDateRequest(text: string): boolean {
  return /(?:какие|другие|ближайшие|следующие)\s+(?:есть\s+)?(?:даты|дни|варианты|слоты)|(?:покажи|провер(?:ь|ить)|посмотр(?:и|еть))\s+(?:другие|ближайшие|следующие)\s+(?:даты|дни|варианты|слоты)|\b(?:what|which|other|next)\s+(?:dates|days|slots|options)\b/iu.test(
    text,
  );
}

function specialistNameForms(name: string): string[] {
  const [firstName] = name.trim().split(/\s+/);
  if (!firstName || firstName.length < 2) return [];
  if (/а$/iu.test(firstName)) {
    const stem = firstName.slice(0, -1);
    return [firstName, `${stem}ы`, `${stem}е`, `${stem}у`, `${stem}ой`];
  }
  if (/я$/iu.test(firstName)) {
    const stem = firstName.slice(0, -1);
    return [firstName, `${stem}и`, `${stem}е`, `${stem}ю`, `${stem}ей`];
  }
  return [firstName];
}

function findMentionedSpecialist(
  text: string,
  specialists: BookingSpecialistReference[],
): BookingSpecialistReference | undefined {
  const normalizedText = ` ${normalize(text).replace(/[^\p{L}\p{N}]+/gu, ' ')} `;
  const matches = specialists.filter((specialist) => {
    const fullName = normalize(specialist.name).replace(/[^\p{L}\p{N}]+/gu, ' ');
    return [fullName, ...specialistNameForms(specialist.name).map(normalize)].some(
      (candidate) => candidate.length >= 2 && normalizedText.includes(` ${candidate} `),
    );
  });
  return matches.length === 1 ? matches[0] : undefined;
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

function withAlternativeDateRequest(context: BookingContext, visitorText: string): BookingContext {
  const result = { ...context };
  if (hasAlternativeDateRequest(visitorText)) {
    result.alternativeDatesRequested = true;
  } else {
    delete result.alternativeDatesRequested;
  }
  return result;
}

function withAvailabilitySearchRequest(context: BookingContext, hasDate: boolean): BookingContext {
  const result = { ...context };
  if (hasDate) {
    result.availabilitySearchRequested = true;
  } else {
    delete result.availabilitySearchRequested;
  }
  return result;
}

export function deriveBookingContext(
  currentValue: unknown,
  visitorText: string,
  services: BookingServiceReference[],
  specialists: BookingSpecialistReference[] = [],
): BookingContext | null {
  const current = parseBookingContext(currentValue);
  const normalizedText = normalize(visitorText);
  const mentionedService = services
    .filter((service) => normalizedText.includes(normalize(service.name)))
    .sort((left, right) => right.name.length - left.name.length)[0];
  const mentionedSpecialist = findMentionedSpecialist(visitorText, specialists);
  const hasDate = hasExplicitDateReference(visitorText);
  const selectedSlotTime = extractBookingTime(visitorText);
  const hasDateTime = hasDate && selectedSlotTime !== null;
  const groupParticipants = extractConfirmedGroupParticipants(visitorText);

  const withConfirmedParticipants = (context: BookingContext | null): BookingContext | null =>
    context && groupParticipants !== null ? { ...context, groupParticipants } : context;
  const finalize = (context: BookingContext | null): BookingContext | null => {
    const withParticipants = withConfirmedParticipants(context);
    return withParticipants
      ? withAvailabilitySearchRequest(
          withAlternativeDateRequest(withParticipants, visitorText),
          hasDate,
        )
      : null;
  };
  const withSpecialist = (context: BookingContext): BookingContext =>
    mentionedSpecialist
      ? {
          ...context,
          specialistId: mentionedSpecialist.id,
          specialistName: mentionedSpecialist.name,
        }
      : context;

  if (mentionedService) {
    if (!current || current.serviceId !== mentionedService.id) {
      return finalize({
        serviceId: mentionedService.id,
        serviceName: mentionedService.name,
        needsDate: !hasDate,
        ...(mentionedSpecialist
          ? { specialistId: mentionedSpecialist.id, specialistName: mentionedSpecialist.name }
          : {}),
        ...(hasDateTime ? { selectedSlot: true as const, selectedSlotTime } : {}),
      });
    }
    if (hasDateTime) {
      return finalize({
        ...withSpecialist(current),
        needsDate: false,
        selectedSlot: true,
        selectedSlotTime,
      });
    }
    if (hasDate)
      return finalize({ ...withoutSelectedSlot(withSpecialist(current)), needsDate: false });
    return finalize(withSpecialist(current));
  }

  if (
    current?.specialistId &&
    mentionedSpecialist &&
    current.specialistId !== mentionedSpecialist.id
  ) {
    // A new specialist without an explicitly named service must not inherit a
    // possibly incompatible service from the previous specialist.
    return null;
  }

  if (current?.needsDate && hasDate) {
    return finalize(
      hasDateTime
        ? { ...withSpecialist(current), needsDate: false, selectedSlot: true, selectedSlotTime }
        : { ...withoutSelectedSlot(withSpecialist(current)), needsDate: false },
    );
  }
  if (current && hasDate) {
    return finalize(
      hasDateTime
        ? { ...withSpecialist(current), selectedSlot: true, selectedSlotTime }
        : withoutSelectedSlot(withSpecialist(current)),
    );
  }
  return finalize(current ? withSpecialist(current) : null);
}

export function buildBookingStateContext(context: BookingContext | null): string | null {
  if (!context) return null;

  const selection = [
    `The selected service is "${context.serviceName}" (service_id=${context.serviceId}).`,
    context.specialistId && context.specialistName
      ? `The selected specialist is "${context.specialistName}" (specialist_id=${context.specialistId}).`
      : 'No specialist has been selected yet.',
  ];
  const instructions = [
    'This is authoritative server-side booking state. Keep this service and specialist unless the latest visitor message explicitly names a different one.',
    'Do not ask the visitor to confirm this service or their wish to search for slots again.',
  ];
  if (context.alternativeDatesRequested && context.specialistId) {
    instructions.push(
      'The visitor is asking for other available dates. Call find_available_slots now with the selected service_id and specialist_id plus search_next_available=true. Do not ask a clarifying question first.',
    );
  } else if (context.availabilitySearchRequested) {
    instructions.push(
      'The latest visitor message includes the date or date range to check. Call find_available_slots now with the selected service_id and, when present, specialist_id. Do not ask the visitor to confirm the service first.',
    );
  }

  return `## Booking state\n\n${selection.join(' ')}\n${instructions.join(' ')}`;
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
