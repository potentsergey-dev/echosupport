/**
 * Business hours helper.
 * Checks whether the current time is within configured working hours for an agent.
 */

import { prisma } from '../db/prisma.js';

interface ScheduleEntry {
  dayOfWeek: number; // 0=Sunday..6=Saturday
  from: string; // "09:00"
  to: string; // "18:00"
}

function parseTime(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Returns true if current moment (in agent's timezone) is within business hours. */
export async function isBusinessHoursNow(agentId: string): Promise<boolean> {
  const bh = await prisma.businessHours.findUnique({ where: { agentId } });
  if (!bh || !bh.enabled) return true; // no config or disabled → always "in hours"

  const tz = bh.timezone ?? 'Europe/Minsk';
  const now = new Date();

  // Get current date/time in agent's timezone
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const parts = formatter.formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';

  const dowMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  const dayOfWeek = dowMap[get('weekday')] ?? 0;
  const currentMinutes = parseInt(get('hour')) * 60 + parseInt(get('minute'));

  // Check holidays
  const dateStr = `${get('year')}-${get('month')}-${get('day')}`; // YYYY-MM-DD
  const holidays = (bh.holidays ?? []) as string[];
  if (holidays.includes(dateStr)) return false;

  // Check schedule
  const schedule = (bh.schedule ?? []) as unknown as ScheduleEntry[];
  for (const entry of schedule) {
    if (entry.dayOfWeek === dayOfWeek) {
      const from = parseTime(entry.from);
      const to = parseTime(entry.to);
      if (currentMinutes >= from && currentMinutes < to) return true;
    }
  }

  return false;
}

/** Returns the out-of-hours message for an agent, or null if not configured. */
export async function getOutOfHoursMessage(agentId: string): Promise<string | null> {
  const bh = await prisma.businessHours.findUnique({ where: { agentId } });
  if (!bh || !bh.enabled) return null;
  return bh.outOfHoursMessage ?? null;
}
