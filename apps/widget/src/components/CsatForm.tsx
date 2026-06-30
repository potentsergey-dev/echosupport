import { useState } from 'preact/hooks';
import { submitCsat } from '../api';
import { csatDone } from '../signals';

export function CsatForm() {
  const [rating, setRating] = useState<1 | -1 | null>(null);
  const [comment, setComment] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit() {
    if (rating === null || isSubmitting) return;
    setIsSubmitting(true);
    setError('');
    try {
      await submitCsat(rating, comment);
      csatDone.value = true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось отправить оценку');
    } finally {
      setIsSubmitting(false);
    }
  }

  const options = [
    { value: 1 as const, icon: '👍', label: 'Хорошо' },
    { value: -1 as const, icon: '👎', label: 'Плохо' },
  ];

  return (
    <div class="flex flex-col gap-3 border-t border-gray-200 bg-gray-50 px-4 py-4">
      <p class="text-center text-sm font-medium text-gray-700">Оцените качество поддержки</p>
      <div class="flex justify-center gap-4">
        {options.map((option) => (
          <button
            type="button"
            onClick={() => setRating(option.value)}
            disabled={isSubmitting}
            class={`flex flex-col items-center gap-1 rounded-xl border bg-white px-5 py-2.5 text-2xl shadow-sm transition-colors disabled:opacity-60 ${
              rating === option.value
                ? 'border-indigo-500 ring-2 ring-indigo-100'
                : 'border-gray-200 hover:border-indigo-300'
            }`}
            aria-pressed={rating === option.value}
            title={option.label}
          >
            {option.icon}
            <span class="text-[10px] text-gray-500">{option.label}</span>
          </button>
        ))}
      </div>
      {rating !== null && (
        <>
          <textarea
            value={comment}
            onInput={(event) => setComment(event.currentTarget.value)}
            maxLength={2000}
            rows={2}
            disabled={isSubmitting}
            placeholder="Комментарий (необязательно)"
            class="w-full resize-none rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm focus:border-indigo-500 focus:outline-none"
          />
          {error && (
            <p role="alert" class="text-center text-xs text-red-600">
              {error}
            </p>
          )}
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSubmitting}
            class="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-60"
          >
            {isSubmitting ? 'Отправка…' : 'Отправить оценку'}
          </button>
        </>
      )}
    </div>
  );
}
