export type RelativeBookingRange = 'today' | 'tomorrow' | 'this_week' | 'next_week';

export interface BookingDateRange {
  kind: RelativeBookingRange;
  dateFrom: string;
  dateTo: string;
}

function getZonedDateParts(date: Date, timeZone: string) {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const dayOfWeek = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  return { dateKey: `${get('year')}-${get('month')}-${get('day')}`, dayOfWeek };
}
interface SpecialistCandidate {
  id: string;
  name: string;
  matchingHints?: string[];
}

function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1, day! + days)).toISOString().slice(0, 10);
}

export function resolveRelativeBookingDateRange(
  text: string,
  now: Date,
  timeZone: string,
): BookingDateRange | null {
  const normalized = text.toLocaleLowerCase('ru-RU').replace(/ё/g, 'е');
  const today = getZonedDateParts(now, timeZone);
  let kind: RelativeBookingRange | null = null;

  if (
    /\b(?:next\s+week|next_week)\b/.test(normalized) ||
    /следующ\p{L}*\s+недел\p{L}*/u.test(normalized)
  ) {
    kind = 'next_week';
  } else if (
    /\b(?:this\s+week|this_week)\b/.test(normalized) ||
    /(?:эт|текущ)\p{L}*\s+недел\p{L}*/u.test(normalized)
  ) {
    kind = 'this_week';
  } else if (/\btomorrow\b/.test(normalized) || normalized.includes('завтра')) {
    kind = 'tomorrow';
  } else if (/\btoday\b/.test(normalized) || normalized.includes('сегодня')) {
    kind = 'today';
  }

  if (!kind) return null;
  if (kind === 'today') return { kind, dateFrom: today.dateKey, dateTo: today.dateKey };
  if (kind === 'tomorrow') {
    const tomorrow = addDays(today.dateKey, 1);
    return { kind, dateFrom: tomorrow, dateTo: tomorrow };
  }

  const daysSinceMonday = (today.dayOfWeek + 6) % 7;
  const thisMonday = addDays(today.dateKey, -daysSinceMonday);
  const monday = kind === 'next_week' ? addDays(thisMonday, 7) : thisMonday;
  return { kind, dateFrom: monday, dateTo: addDays(monday, 6) };
}

export function normalizeSpecialistName(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

export function matchSpecialistsByName<T extends SpecialistCandidate>(
  query: string,
  specialists: T[],
): T[] {
  const normalizedQuery = normalizeSpecialistName(query);
  const queryTokens = normalizedQuery.split(' ').filter((token) => token.length >= 2);
  if (!normalizedQuery || queryTokens.length === 0) return [];

  const scored = specialists
    .map((specialist) => {
      const hints = [specialist.name, ...(specialist.matchingHints ?? [])]
        .map(normalizeSpecialistName)
        .filter(Boolean);
      let score = hints.includes(normalizedQuery) ? 3 : 0;
      if (score === 0 && queryTokens.some((token) => hints.includes(token))) score = 2;
      if (
        score === 0 &&
        hints.some(
          (hint) =>
            (normalizedQuery.length >= 3 && hint.includes(normalizedQuery)) ||
            (hint.length >= 3 && normalizedQuery.includes(hint)),
        )
      ) {
        score = 1;
      }
      return { specialist, score };
    })
    .filter(({ score }) => score > 0);

  const bestScore = Math.max(0, ...scored.map(({ score }) => score));
  return scored.filter(({ score }) => score === bestScore).map(({ specialist }) => specialist);
}

const RU_MONTHS = [
  'янв',
  'фев',
  'мар',
  'апр',
  'мая',
  'июн',
  'июл',
  'авг',
  'сен',
  'окт',
  'ноя',
  'дек',
];

export function buildSlotQuickReplies(
  slots: Array<{ localDate: string; localStartTime: string }>,
): string[] {
  if (slots.length === 0) return [];
  const replies = slots.slice(0, 3).map((slot) => {
    const [, month, day] = slot.localDate.split('-').map(Number);
    return `${day} ${RU_MONTHS[month! - 1]} ${slot.localStartTime}`;
  });
  return [...replies, 'Другой день'];
}
