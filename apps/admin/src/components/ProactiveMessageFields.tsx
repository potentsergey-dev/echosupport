import { Input } from './ui/Input';
import { Label } from './ui/Label';

interface Props {
  delay: number | null;
  text: string;
  onDelayChange: (delay: number | null) => void;
  onTextChange: (text: string) => void;
}

export function ProactiveMessageFields({ delay, text, onDelayChange, onTextChange }: Props) {
  return (
    <div className="sm:col-span-2 rounded-lg border border-gray-200 bg-gray-50 p-4">
      <div className="mb-3">
        <Label htmlFor="proactive-delay">Проактивное сообщение</Label>
        <p className="mt-1 text-xs text-gray-500">
          Оставьте задержку пустой, чтобы отключить функцию. Виджет покажет подсказку, но не откроет
          чат автоматически.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-[160px_1fr]">
        <Input
          id="proactive-delay"
          type="number"
          min={5}
          max={3600}
          value={delay ?? ''}
          onChange={(event) =>
            onDelayChange(event.target.value ? Number(event.target.value) : null)
          }
          placeholder="Задержка, сек."
        />
        <Input
          id="proactive-text"
          value={text}
          maxLength={500}
          disabled={delay === null}
          onChange={(event) => onTextChange(event.target.value)}
          placeholder="Нужна помощь? Задайте нам вопрос."
        />
      </div>
    </div>
  );
}
