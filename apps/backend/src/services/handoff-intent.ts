export function isExplicitHandoffRequest(text: string): boolean {
  const normalized = text.toLowerCase().replace(/ё/g, 'е');

  const englishIntent =
    /\b(connect|transfer|switch|route|send|pass|get|call|need|want|speak|talk|chat)\b[\s\S]{0,80}\b(operator|human|person|representative|specialist|manager|support agent)\b/i.test(
      normalized,
    ) ||
    /\b(operator|human|person|representative|specialist|manager|support agent)\b[\s\S]{0,80}\b(connect|transfer|switch|help|please|now)\b/i.test(
      normalized,
    ) ||
    /\b(live|real)\s+(operator|agent|person|human|representative)\b/i.test(normalized);

  const russianAction =
    '(позови|позовите|соедини|соедините|переведи|переведите|переключи|переключите|дай|дайте|нужен|нужна|нужны|хочу|можно|поговорить|связаться)';
  const russianTarget =
    '(оператор|оператору|оператора|человек|человеком|человека|специалист|специалистом|специалиста|менеджер|менеджером|менеджера|живой|живого|живым)';
  const russianIntent =
    new RegExp(`${russianAction}[\\s\\S]{0,80}${russianTarget}`, 'i').test(normalized) ||
    new RegExp(`${russianTarget}[\\s\\S]{0,80}${russianAction}`, 'i').test(normalized);

  return englishIntent || russianIntent;
}
