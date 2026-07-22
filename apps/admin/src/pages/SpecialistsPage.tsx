import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon, EditIcon, TrashIcon, ClockIcon, XIcon, CheckIcon } from 'lucide-react';
import {
  listSpecialists,
  createSpecialist,
  updateSpecialist,
  deleteSpecialist,
  saveSpecialistWorkingHours,
} from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { Textarea } from '../components/ui/Textarea';
import { useToastContext } from '../components/Layout';
import type { Specialist, SpecialistWorkingHours } from '../types';

// ── Working Hours Editor ───────────────────────────────────────────────────────

const DAY_NAMES = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];

function minutesToTime(minutes: number): string {
  const h = Math.floor(minutes / 60)
    .toString()
    .padStart(2, '0');
  const m = (minutes % 60).toString().padStart(2, '0');
  return `${h}:${m}`;
}

function timeToMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function formatWorkingHoursSummary(hours: SpecialistWorkingHours[] | undefined): string {
  if (!hours || hours.length === 0) return 'Рабочие часы не настроены';

  return hours
    .map((entry) => {
      const day = DAY_NAMES[entry.dayOfWeek] ?? 'День';
      return `${day} ${minutesToTime(entry.fromMinutes)}-${minutesToTime(entry.toMinutes)}`;
    })
    .join(', ');
}

interface WorkingHoursEditorProps {
  specialistId: string;
  initialHours: SpecialistWorkingHours[];
  onSaved: () => void;
  onCancel: () => void;
}

function WorkingHoursEditor({
  specialistId,
  initialHours,
  onSaved,
  onCancel,
}: WorkingHoursEditorProps) {
  const { addToast } = useToastContext();
  const qc = useQueryClient();

  // State: array per day (0=Sun..6=Sat), each day can have one entry (simplified MVP)
  type DayEntry = { enabled: boolean; from: string; to: string };
  const initDays = (): DayEntry[] =>
    Array.from({ length: 7 }, (_, dow) => {
      const entry = initialHours.find((h) => h.dayOfWeek === dow);
      if (entry) {
        return {
          enabled: true,
          from: minutesToTime(entry.fromMinutes),
          to: minutesToTime(entry.toMinutes),
        };
      }
      return { enabled: false, from: '09:00', to: '18:00' };
    });

  const [days, setDays] = useState<DayEntry[]>(initDays);

  const mutation = useMutation({
    mutationFn: () => {
      const entries = days
        .map((d, dow) =>
          d.enabled
            ? { dayOfWeek: dow, fromMinutes: timeToMinutes(d.from), toMinutes: timeToMinutes(d.to) }
            : null,
        )
        .filter(Boolean) as Array<{ dayOfWeek: number; fromMinutes: number; toMinutes: number }>;
      return saveSpecialistWorkingHours(specialistId, entries);
    },
    onSuccess: () => {
      addToast('Расписание сохранено', 'success');
      void qc.invalidateQueries({ queryKey: ['specialists'] });
      onSaved();
    },
    onError: (err: Error) => {
      addToast(err.message, 'error');
    },
  });

  return (
    <div className="space-y-3">
      <p className="text-sm font-medium text-gray-700">Рабочие часы</p>
      {days.map((day, dow) => (
        <div key={dow} className="flex items-center gap-3">
          <input
            type="checkbox"
            id={`dow-${dow}`}
            checked={day.enabled}
            onChange={(e) => {
              const next = [...days];
              next[dow] = { ...next[dow]!, enabled: e.target.checked };
              setDays(next);
            }}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600"
          />
          <label htmlFor={`dow-${dow}`} className="w-8 text-sm text-gray-600">
            {DAY_NAMES[dow]}
          </label>
          {day.enabled ? (
            <>
              <input
                type="time"
                value={day.from}
                onChange={(e) => {
                  const next = [...days];
                  next[dow] = { ...next[dow]!, from: e.target.value };
                  setDays(next);
                }}
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              />
              <span className="text-gray-400">—</span>
              <input
                type="time"
                value={day.to}
                onChange={(e) => {
                  const next = [...days];
                  next[dow] = { ...next[dow]!, to: e.target.value };
                  setDays(next);
                }}
                className="rounded border border-gray-300 px-2 py-1 text-sm"
              />
            </>
          ) : (
            <span className="text-sm text-gray-400">Выходной</span>
          )}
        </div>
      ))}
      <div className="flex gap-2 pt-2">
        <Button size="sm" loading={mutation.isPending} onClick={() => mutation.mutate()}>
          <CheckIcon size={14} /> Сохранить
        </Button>
        <Button size="sm" variant="secondary" onClick={onCancel}>
          <XIcon size={14} /> Отмена
        </Button>
      </div>
    </div>
  );
}

// ── Specialist Form ────────────────────────────────────────────────────────────

interface SpecialistFormProps {
  initial?: Partial<Specialist>;
  onSubmit: (data: { name: string; role: string; description: string; isActive: boolean }) => void;
  onCancel: () => void;
  loading?: boolean;
}

function SpecialistForm({ initial, onSubmit, onCancel, loading }: SpecialistFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [role, setRole] = useState(initial?.role ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);

  return (
    <div className="space-y-4">
      <div>
        <Label htmlFor="spec-name">Имя *</Label>
        <Input
          id="spec-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="mt-1"
          placeholder="Иванова Мария"
        />
      </div>
      <div>
        <Label htmlFor="spec-role">Должность / специализация</Label>
        <Input
          id="spec-role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className="mt-1"
          placeholder="Косметолог"
        />
      </div>
      <div>
        <Label htmlFor="spec-desc">Описание</Label>
        <Textarea
          id="spec-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="mt-1"
        />
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="spec-active"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600"
        />
        <label htmlFor="spec-active" className="text-sm text-gray-700">
          Активен
        </label>
      </div>
      <div className="flex gap-2">
        <Button
          loading={loading ?? false}
          disabled={!name.trim()}
          onClick={() => onSubmit({ name, role, description, isActive })}
        >
          {initial?.id ? 'Сохранить' : 'Создать'}
        </Button>
        <Button variant="secondary" onClick={onCancel}>
          Отмена
        </Button>
      </div>
    </div>
  );
}

// ── Specialist Card ────────────────────────────────────────────────────────────

function SpecialistCard({
  specialist,
  onEdit,
  onDelete,
}: {
  specialist: Specialist;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [showHours, setShowHours] = useState(false);

  return (
    <div className="rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="font-semibold text-gray-900">{specialist.name}</h3>
            {!specialist.isActive && (
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
                Неактивен
              </span>
            )}
          </div>
          {specialist.role && <p className="mt-0.5 text-sm text-gray-500">{specialist.role}</p>}
          {specialist.description && (
            <p className="mt-1 text-sm text-gray-600">{specialist.description}</p>
          )}
          {specialist._count && (
            <p className="mt-2 text-xs text-gray-400">
              Услуг: {specialist._count.services} · Записей: {specialist._count.appointments}
            </p>
          )}
          <p className="mt-2 text-xs text-gray-500">
            {formatWorkingHoursSummary(specialist.workingHours)}
          </p>
        </div>
        <div className="flex gap-1">
          <button
            onClick={() => setShowHours((v) => !v)}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            title="Рабочие часы"
          >
            <ClockIcon size={16} />
          </button>
          <button
            onClick={onEdit}
            className="rounded p-1.5 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
            title="Редактировать"
          >
            <EditIcon size={16} />
          </button>
          <button
            onClick={onDelete}
            className="rounded p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600"
            title="Удалить"
          >
            <TrashIcon size={16} />
          </button>
        </div>
      </div>
      {showHours && (
        <div className="mt-4 border-t border-gray-100 pt-4">
          <WorkingHoursEditor
            specialistId={specialist.id}
            initialHours={specialist.workingHours ?? []}
            onSaved={() => setShowHours(false)}
            onCancel={() => setShowHours(false)}
          />
        </div>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function SpecialistsPage() {
  const { addToast } = useToastContext();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const specialistsQuery = useQuery<Specialist[]>({
    queryKey: ['specialists'],
    queryFn: () => listSpecialists(),
  });

  const specialists: Specialist[] = specialistsQuery.data ?? [];
  const isLoading = specialistsQuery.isLoading;

  const createMutation = useMutation({
    mutationFn: (data: { name: string; role: string; description: string; isActive: boolean }) =>
      createSpecialist(data),
    onSuccess: () => {
      addToast('Специалист создан', 'success');
      void qc.invalidateQueries({ queryKey: ['specialists'] });
      setShowCreate(false);
    },
    onError: (err: Error) => {
      addToast(err.message, 'error');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: { name: string; role: string; description: string; isActive: boolean };
    }) => updateSpecialist(id, data),
    onSuccess: () => {
      addToast('Специалист обновлён', 'success');
      void qc.invalidateQueries({ queryKey: ['specialists'] });
      setEditingId(null);
    },
    onError: (err: Error) => {
      addToast(err.message, 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteSpecialist,
    onSuccess: () => {
      addToast('Специалист деактивирован', 'success');
      void qc.invalidateQueries({ queryKey: ['specialists'] });
    },
    onError: (err: Error) => {
      addToast(err.message, 'error');
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-gray-400">Загрузка...</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Специалисты</h1>
          <p className="mt-1 text-sm text-gray-500">Управление специалистами для записи на приём</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <PlusIcon size={16} /> Добавить
        </Button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50 p-5">
          <h2 className="mb-4 font-semibold text-gray-900">Новый специалист</h2>
          <SpecialistForm
            onSubmit={(data) => createMutation.mutate(data)}
            onCancel={() => setShowCreate(false)}
            loading={createMutation.isPending}
          />
        </div>
      )}

      {/* List */}
      <div className="space-y-4">
        {specialists.length === 0 && !showCreate && (
          <div className="rounded-xl border-2 border-dashed border-gray-200 p-12 text-center">
            <p className="text-gray-400">Нет специалистов. Добавьте первого!</p>
          </div>
        )}
        {specialists.map((s) =>
          editingId === s.id ? (
            <div key={s.id} className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
              <h2 className="mb-4 font-semibold text-gray-900">Редактировать: {s.name}</h2>
              <SpecialistForm
                initial={s}
                onSubmit={(data) => updateMutation.mutate({ id: s.id, data })}
                onCancel={() => setEditingId(null)}
                loading={updateMutation.isPending}
              />
              <div className="mt-6 border-t border-indigo-100 pt-5">
                <WorkingHoursEditor
                  specialistId={s.id}
                  initialHours={s.workingHours ?? []}
                  onSaved={() => undefined}
                  onCancel={() => setEditingId(null)}
                />
              </div>
            </div>
          ) : (
            <SpecialistCard
              key={s.id}
              specialist={s}
              onEdit={() => setEditingId(s.id)}
              onDelete={() => {
                if (confirm(`Деактивировать специалиста ${s.name}?`)) {
                  deleteMutation.mutate(s.id);
                }
              }}
            />
          ),
        )}
      </div>
    </div>
  );
}
