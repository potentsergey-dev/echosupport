import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PlusIcon, CheckIcon, XIcon, CalendarIcon } from 'lucide-react';
import {
  listAppointments,
  createAppointment,
  confirmAppointment,
  cancelAppointment,
  rescheduleAppointment,
  listSpecialists,
  listServices,
} from '../lib/api';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { Label } from '../components/ui/Label';
import { useToastContext } from '../components/Layout';
import type { Appointment, AppointmentStatus, Specialist, Service } from '../types';

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDateTime(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

const STATUS_LABELS: Record<AppointmentStatus, string> = {
  PENDING: 'Ожидает',
  CONFIRMED: 'Подтверждена',
  CANCELLED: 'Отменена',
  COMPLETED: 'Завершена',
  NO_SHOW: 'Неявка',
};

const STATUS_COLORS: Record<AppointmentStatus, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  CONFIRMED: 'bg-green-100 text-green-800',
  CANCELLED: 'bg-red-100 text-red-800',
  COMPLETED: 'bg-gray-100 text-gray-700',
  NO_SHOW: 'bg-red-50 text-red-500',
};

// ── Reschedule Modal ──────────────────────────────────────────────────────────

function RescheduleModal({
  appointment,
  onClose,
}: {
  appointment: Appointment;
  onClose: () => void;
}) {
  const { addToast } = useToastContext();
  const qc = useQueryClient();
  const [startsAt, setStartsAt] = useState(
    new Date(appointment.startsAt).toISOString().slice(0, 16),
  );

  const mutation = useMutation({
    mutationFn: () => rescheduleAppointment(appointment.id, new Date(startsAt).toISOString()),
    onSuccess: () => {
      addToast('Запись перенесена', 'success');
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      onClose();
    },
    onError: (err: Error) => {
      addToast(err.message, 'error');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Перенос записи</h2>
        <div>
          <Label htmlFor="new-time">Новое время</Label>
          <input
            id="new-time"
            type="datetime-local"
            value={startsAt}
            onChange={(e) => setStartsAt(e.target.value)}
            className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          />
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>
            Перенести
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Create Appointment Modal ──────────────────────────────────────────────────

function CreateAppointmentModal({
  specialists,
  services,
  onClose,
}: {
  specialists: Specialist[];
  services: Service[];
  onClose: () => void;
}) {
  const { addToast } = useToastContext();
  const qc = useQueryClient();
  const [specialistId, setSpecialistId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [visitorName, setVisitorName] = useState('');
  const [visitorPhone, setVisitorPhone] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [notes, setNotes] = useState('');

  const filteredServices = services.filter(
    (s) => !specialistId || !s.specialistId || s.specialistId === specialistId,
  );

  const mutation = useMutation({
    mutationFn: () =>
      createAppointment({
        ...(specialistId ? { specialistId } : {}),
        ...(serviceId ? { serviceId } : {}),
        visitorName,
        visitorPhone,
        startsAt: new Date(startsAt).toISOString(),
        ...(notes ? { notes } : {}),
      }),
    onSuccess: () => {
      addToast('Запись создана', 'success');
      void qc.invalidateQueries({ queryKey: ['appointments'] });
      onClose();
    },
    onError: (err: Error) => {
      addToast(err.message, 'error');
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">Новая запись</h2>
        <div className="space-y-3">
          <div>
            <Label htmlFor="ca-specialist">Специалист</Label>
            <select
              id="ca-specialist"
              value={specialistId}
              onChange={(e) => setSpecialistId(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">— Любой —</option>
              {specialists
                .filter((s) => s.isActive)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
            </select>
          </div>
          <div>
            <Label htmlFor="ca-service">Услуга</Label>
            <select
              id="ca-service"
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            >
              <option value="">— Без услуги —</option>
              {filteredServices
                .filter((s) => s.isActive)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.durationMin} мин)
                  </option>
                ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="ca-name">Имя клиента *</Label>
              <Input
                id="ca-name"
                value={visitorName}
                onChange={(e) => setVisitorName(e.target.value)}
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="ca-phone">Телефон *</Label>
              <Input
                id="ca-phone"
                value={visitorPhone}
                onChange={(e) => setVisitorPhone(e.target.value)}
                className="mt-1"
                placeholder="+79001234567"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="ca-time">Дата и время *</Label>
            <input
              id="ca-time"
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <div>
            <Label htmlFor="ca-notes">Примечание</Label>
            <Input
              id="ca-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="mt-1"
            />
          </div>
        </div>
        <div className="mt-6 flex justify-end gap-3">
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button
            loading={mutation.isPending}
            disabled={!visitorName.trim() || !visitorPhone.trim() || !startsAt}
            onClick={() => mutation.mutate()}
          >
            Создать
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── Appointment Row ───────────────────────────────────────────────────────────

function AppointmentRow({
  appt,
  onConfirm,
  onCancel,
  onReschedule,
}: {
  appt: Appointment;
  onConfirm: () => void;
  onCancel: () => void;
  onReschedule: () => void;
}) {
  const canConfirm = appt.status === 'PENDING';
  const canCancel = appt.status === 'PENDING' || appt.status === 'CONFIRMED';
  const canReschedule = appt.status === 'PENDING' || appt.status === 'CONFIRMED';

  return (
    <tr className="border-b border-gray-100 hover:bg-gray-50">
      <td className="px-4 py-3 text-sm text-gray-900 whitespace-nowrap">
        {formatDateTime(appt.startsAt)}
      </td>
      <td className="px-4 py-3 text-sm text-gray-900">
        <div className="font-medium">{appt.visitorName}</div>
        <div className="text-xs text-gray-500">{appt.visitorPhone}</div>
      </td>
      <td className="px-4 py-3 text-sm text-gray-600">{appt.specialist?.name ?? '—'}</td>
      <td className="px-4 py-3 text-sm text-gray-600">{appt.service?.name ?? '—'}</td>
      <td className="px-4 py-3">
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_COLORS[appt.status]}`}
        >
          {STATUS_LABELS[appt.status]}
        </span>
      </td>
      <td className="px-4 py-3">
        <div className="flex gap-1">
          {canConfirm && (
            <button
              onClick={onConfirm}
              className="rounded p-1 text-green-600 hover:bg-green-50"
              title="Подтвердить"
            >
              <CheckIcon size={14} />
            </button>
          )}
          {canReschedule && (
            <button
              onClick={onReschedule}
              className="rounded p-1 text-indigo-600 hover:bg-indigo-50"
              title="Перенести"
            >
              <CalendarIcon size={14} />
            </button>
          )}
          {canCancel && (
            <button
              onClick={onCancel}
              className="rounded p-1 text-red-500 hover:bg-red-50"
              title="Отменить"
            >
              <XIcon size={14} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export function AppointmentsPage() {
  const { addToast } = useToastContext();
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<AppointmentStatus | ''>('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [specialistFilter, setSpecialistFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [rescheduling, setRescheduling] = useState<Appointment | null>(null);

  const appointmentsQuery = useQuery<Appointment[]>({
    queryKey: ['appointments', statusFilter, fromDate, toDate, specialistFilter],
    queryFn: () =>
      listAppointments({
        ...(statusFilter ? { status: statusFilter } : {}),
        ...(fromDate ? { from: new Date(fromDate).toISOString() } : {}),
        ...(toDate ? { to: new Date(toDate).toISOString() } : {}),
        ...(specialistFilter ? { specialistId: specialistFilter } : {}),
      }),
  });

  const specialistsQuery = useQuery<Specialist[]>({
    queryKey: ['specialists'],
    queryFn: () => listSpecialists(),
  });

  const servicesQuery = useQuery<Service[]>({
    queryKey: ['services'],
    queryFn: () => listServices(),
  });

  const appointments: Appointment[] = appointmentsQuery.data ?? [];
  const specialists: Specialist[] = specialistsQuery.data ?? [];
  const services: Service[] = servicesQuery.data ?? [];
  const isLoading = appointmentsQuery.isLoading;

  const confirmMutation = useMutation({
    mutationFn: confirmAppointment,
    onSuccess: () => {
      addToast('Запись подтверждена', 'success');
      void qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (err: Error) => {
      addToast(err.message, 'error');
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => cancelAppointment(id),
    onSuccess: () => {
      addToast('Запись отменена', 'success');
      void qc.invalidateQueries({ queryKey: ['appointments'] });
    },
    onError: (err: Error) => {
      addToast(err.message, 'error');
    },
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Записи на приём</h1>
          <p className="mt-1 text-sm text-gray-500">Управление записями клиентов</p>
        </div>
        <Button onClick={() => setShowCreate(true)}>
          <PlusIcon size={16} /> Добавить
        </Button>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap gap-3">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as AppointmentStatus | '')}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">Все статусы</option>
          {(Object.keys(STATUS_LABELS) as AppointmentStatus[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABELS[s]}
            </option>
          ))}
        </select>
        <select
          value={specialistFilter}
          onChange={(e) => setSpecialistFilter(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
        >
          <option value="">Все специалисты</option>
          {specialists.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={fromDate}
          onChange={(e) => setFromDate(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="С"
        />
        <input
          type="date"
          value={toDate}
          onChange={(e) => setToDate(e.target.value)}
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm shadow-sm focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
          placeholder="По"
        />
      </div>

      {/* Table */}
      {isLoading ? (
        <p className="py-12 text-center text-sm text-gray-400">Загрузка...</p>
      ) : appointments.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-gray-200 p-12 text-center">
          <p className="text-gray-400">Нет записей</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-gray-200 bg-white shadow-sm">
          <table className="min-w-full">
            <thead>
              <tr className="border-b border-gray-100 bg-gray-50 text-left text-xs font-medium uppercase tracking-wide text-gray-500">
                <th className="px-4 py-3">Дата / время</th>
                <th className="px-4 py-3">Клиент</th>
                <th className="px-4 py-3">Специалист</th>
                <th className="px-4 py-3">Услуга</th>
                <th className="px-4 py-3">Статус</th>
                <th className="px-4 py-3">Действия</th>
              </tr>
            </thead>
            <tbody>
              {appointments.map((a) => (
                <AppointmentRow
                  key={a.id}
                  appt={a}
                  onConfirm={() => confirmMutation.mutate(a.id)}
                  onCancel={() => {
                    if (confirm('Отменить запись?')) cancelMutation.mutate(a.id);
                  }}
                  onReschedule={() => setRescheduling(a)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {rescheduling && (
        <RescheduleModal appointment={rescheduling} onClose={() => setRescheduling(null)} />
      )}
      {showCreate && (
        <CreateAppointmentModal
          specialists={specialists}
          services={services}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
