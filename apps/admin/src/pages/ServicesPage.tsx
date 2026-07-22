import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon, EditIcon, TrashIcon } from 'lucide-react';
import {
  listServices,
  createService,
  updateService,
  deleteService,
  listSpecialists,
} from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { Textarea } from '../components/ui/Textarea';
import { useToastContext } from '../components/Layout';
import type { Service, Specialist } from '../types';

// ── Service Form ─────────────────────────────────────────────────────────────

interface ServiceFormData {
  name: string;
  durationMin: number;
  priceLabel: string;
  description: string;
  specialistId: string;
  isGroup: boolean;
  capacity: number;
  isActive: boolean;
}

interface ServiceFormProps {
  initial?: Partial<Service>;
  specialists: Specialist[];
  onSubmit: (data: ServiceFormData) => void;
  onCancel: () => void;
  loading?: boolean;
}

function ServiceForm({ initial, specialists, onSubmit, onCancel, loading }: ServiceFormProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [durationMin, setDurationMin] = useState(initial?.durationMin ?? 60);
  const [priceLabel, setPriceLabel] = useState(initial?.priceLabel ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [specialistId, setSpecialistId] = useState(initial?.specialistId ?? '');
  const [isGroup, setIsGroup] = useState(initial?.isGroup ?? false);
  const [capacity, setCapacity] = useState(initial?.capacity ?? 2);
  const [isActive, setIsActive] = useState(initial?.isActive ?? true);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2">
          <Label htmlFor="svc-name">Название услуги *</Label>
          <Input
            id="svc-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="mt-1"
            placeholder="Чистка лица"
          />
        </div>
        <div>
          <Label htmlFor="svc-duration">Длительность (мин) *</Label>
          <Input
            id="svc-duration"
            type="number"
            min={5}
            max={480}
            value={durationMin}
            onChange={(e) => setDurationMin(parseInt(e.target.value) || 60)}
            className="mt-1"
          />
        </div>
        <div>
          <Label htmlFor="svc-price">Цена</Label>
          <Input
            id="svc-price"
            value={priceLabel}
            onChange={(e) => setPriceLabel(e.target.value)}
            className="mt-1"
            placeholder="от 80 руб"
          />
        </div>
      </div>
      <div>
        <Label htmlFor="svc-specialist">Специалист</Label>
        <select
          id="svc-specialist"
          value={specialistId}
          onChange={(e) => setSpecialistId(e.target.value)}
          className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">— Любой специалист —</option>
          {specialists
            .filter((s) => s.isActive)
            .map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.role ? ` (${s.role})` : ''}
              </option>
            ))}
        </select>
      </div>
      <div>
        <Label htmlFor="svc-desc">Описание</Label>
        <Textarea
          id="svc-desc"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          className="mt-1"
        />
      </div>
      <div className="rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="svc-group"
            checked={isGroup}
            onChange={(e) => setIsGroup(e.target.checked)}
            className="h-4 w-4 rounded border-gray-300 text-indigo-600"
          />
          <label htmlFor="svc-group" className="text-sm font-medium text-gray-700">
            Групповое занятие
          </label>
        </div>
        {isGroup && (
          <div className="mt-3 max-w-xs">
            <Label htmlFor="svc-capacity">Количество мест</Label>
            <Input
              id="svc-capacity"
              type="number"
              min={1}
              max={500}
              value={capacity}
              onChange={(e) => setCapacity(parseInt(e.target.value) || 1)}
              className="mt-1"
            />
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          id="svc-active"
          checked={isActive}
          onChange={(e) => setIsActive(e.target.checked)}
          className="h-4 w-4 rounded border-gray-300 text-indigo-600"
        />
        <label htmlFor="svc-active" className="text-sm text-gray-700">
          Активна
        </label>
      </div>
      <div className="flex gap-2">
        <Button
          loading={loading ?? false}
          disabled={!name.trim()}
          onClick={() =>
            onSubmit({
              name,
              durationMin,
              priceLabel,
              description,
              specialistId,
              isGroup,
              capacity: isGroup ? capacity : 1,
              isActive,
            })
          }
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

// ── Service Card ──────────────────────────────────────────────────────────────

function ServiceCard({
  service,
  onEdit,
  onDelete,
}: {
  service: Service;
  onEdit: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-start justify-between rounded-xl border border-gray-200 bg-white p-5 shadow-sm">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="font-semibold text-gray-900">{service.name}</h3>
          {!service.isActive && (
            <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-500">
              Неактивна
            </span>
          )}
        </div>
        <div className="mt-1 flex flex-wrap gap-3 text-sm text-gray-500">
          <span>{service.durationMin} мин</span>
          {service.priceLabel && <span>{service.priceLabel}</span>}
          {service.isGroup && <span>· группа до {service.capacity} чел.</span>}
          {service.specialist && <span>· {service.specialist.name}</span>}
          {!service.specialist && <span className="text-gray-400">· любой специалист</span>}
        </div>
        {service.description && <p className="mt-1 text-sm text-gray-600">{service.description}</p>}
        {service._count && (
          <p className="mt-2 text-xs text-gray-400">Записей: {service._count.appointments}</p>
        )}
      </div>
      <div className="flex gap-1">
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
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function ServicesPage() {
  const { addToast } = useToastContext();
  const qc = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);

  const servicesQuery = useQuery<Service[]>({
    queryKey: ['services'],
    queryFn: () => listServices(),
  });

  const specialistsQuery = useQuery<Specialist[]>({
    queryKey: ['specialists'],
    queryFn: () => listSpecialists(),
  });

  const services: Service[] = servicesQuery.data ?? [];
  const specialists: Specialist[] = specialistsQuery.data ?? [];
  const isLoading = servicesQuery.isLoading;

  type FormData = {
    name: string;
    durationMin: number;
    priceLabel: string;
    description: string;
    specialistId: string;
    isGroup: boolean;
    capacity: number;
    isActive: boolean;
  };

  const createMutation = useMutation({
    mutationFn: (data: FormData) =>
      createService({
        name: data.name,
        durationMin: data.durationMin,
        priceLabel: data.priceLabel.trim() || null,
        description: data.description.trim() || null,
        specialistId: data.specialistId || null,
        isGroup: data.isGroup,
        capacity: data.isGroup ? data.capacity : 1,
        isActive: data.isActive,
      }),
    onSuccess: () => {
      addToast('Услуга создана', 'success');
      void qc.invalidateQueries({ queryKey: ['services'] });
      setShowCreate(false);
    },
    onError: (err: Error) => {
      addToast(err.message, 'error');
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: FormData }) =>
      updateService(id, {
        name: data.name,
        durationMin: data.durationMin,
        priceLabel: data.priceLabel.trim() || null,
        description: data.description.trim() || null,
        specialistId: data.specialistId || null,
        isGroup: data.isGroup,
        capacity: data.isGroup ? data.capacity : 1,
        isActive: data.isActive,
      }),
    onSuccess: () => {
      addToast('Услуга обновлена', 'success');
      void qc.invalidateQueries({ queryKey: ['services'] });
      setEditingId(null);
    },
    onError: (err: Error) => {
      addToast(err.message, 'error');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteService,
    onSuccess: () => {
      addToast('Услуга деактивирована', 'success');
      void qc.invalidateQueries({ queryKey: ['services'] });
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
          <h1 className="text-2xl font-bold text-gray-900">Услуги</h1>
          <p className="mt-1 text-sm text-gray-500">
            Услуги, доступные для записи через чат-агента
          </p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <PlusIcon size={16} /> Добавить
        </Button>
      </div>

      {/* Create form */}
      {showCreate && (
        <div className="mb-6 rounded-xl border border-indigo-200 bg-indigo-50 p-5">
          <h2 className="mb-4 font-semibold text-gray-900">Новая услуга</h2>
          <ServiceForm
            specialists={specialists}
            onSubmit={(data) => createMutation.mutate(data)}
            onCancel={() => setShowCreate(false)}
            loading={createMutation.isPending}
          />
        </div>
      )}

      {/* List */}
      <div className="space-y-4">
        {services.length === 0 && !showCreate && (
          <div className="rounded-xl border-2 border-dashed border-gray-200 p-12 text-center">
            <p className="text-gray-400">Нет услуг. Добавьте первую!</p>
          </div>
        )}
        {services.map((s) =>
          editingId === s.id ? (
            <div key={s.id} className="rounded-xl border border-indigo-200 bg-indigo-50 p-5">
              <h2 className="mb-4 font-semibold text-gray-900">Редактировать: {s.name}</h2>
              <ServiceForm
                initial={s}
                specialists={specialists}
                onSubmit={(data) => updateMutation.mutate({ id: s.id, data })}
                onCancel={() => setEditingId(null)}
                loading={updateMutation.isPending}
              />
            </div>
          ) : (
            <ServiceCard
              key={s.id}
              service={s}
              onEdit={() => setEditingId(s.id)}
              onDelete={() => {
                if (confirm(`Деактивировать услугу "${s.name}"?`)) {
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
