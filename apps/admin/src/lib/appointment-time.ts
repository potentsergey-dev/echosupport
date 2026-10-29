/** Calendar and datetime-local fields explicitly use the browser timezone. */
export function appointmentLocalValue(iso: string): string {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function appointmentLocalToIso(value: string, originalIso?: string): string {
  if (originalIso && value === appointmentLocalValue(originalIso)) return originalIso;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime()) || appointmentLocalValue(date.toISOString()) !== value)
    throw new Error('Такого местного времени не существует. Выберите другое время.');
  for (let offset = 15; offset <= 180; offset += 15) {
    if (
      [-1, 1].some(
        (direction) =>
          appointmentLocalValue(
            new Date(date.getTime() + direction * offset * 60000).toISOString(),
          ) === value,
      )
    )
      throw new Error('Это время встречается дважды при переводе часов. Выберите другое время.');
  }
  return date.toISOString();
}
