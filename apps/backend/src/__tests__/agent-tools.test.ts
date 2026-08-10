/* eslint-disable @typescript-eslint/unbound-method */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../db/prisma.js', () => ({
  prisma: {
    agent: { findUnique: vi.fn() },
    specialist: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock('../services/realtime-hub.js', () => ({
  publishToOperators: vi.fn(),
}));
vi.mock('../services/specialist-services.js', () => ({
  getActiveServicesForSpecialist: vi.fn(),
}));
vi.mock('../services/slot-finder.js', () => ({
  findAvailableSlots: vi.fn(),
  formatAvailableSlotForBusinessTime: vi.fn((slot: { startsAt: string; endsAt: string }) => ({
    localDate: '2026-08-04',
    localStartTime: '10:00',
    localEndTime: '11:00',
    bookingValue: '2026-08-04 10:00',
    display: '2026-08-04 10:00–11:00',
    ...slot,
  })),
  formatBusinessDateTime: vi.fn(),
  getZonedDateTimeParts: vi.fn(),
  isSlotWithinWorkingHours: vi.fn(),
  parseBusinessDateTime: vi.fn(),
}));
vi.mock('../services/business-hours.js', () => ({
  getBusinessTimezone: vi.fn().mockResolvedValue('Europe/Minsk'),
  getOutOfHoursMessage: vi.fn(),
  isBusinessHoursNow: vi.fn(),
}));

import { prisma } from '../db/prisma.js';
import {
  findAvailableSlots,
  getZonedDateTimeParts,
  parseBusinessDateTime,
} from '../services/slot-finder.js';
import { getActiveServicesForSpecialist } from '../services/specialist-services.js';
import { AGENT_TOOLS, executeTool } from '../services/agent-tools.js';

describe('agent tools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns specialist matching hints for inflected Russian names', async () => {
    vi.mocked(prisma.agent.findUnique).mockResolvedValueOnce({ tenantId: 'tenant-1' } as never);
    vi.mocked(prisma.specialist.findMany).mockResolvedValueOnce([
      {
        id: 'specialist-eva',
        name: 'Ева Король',
        role: 'Эстетист и ведущая Face practice',
        description: 'Skin ritual, Face practice',
      },
    ] as never);

    const toolResult = await executeTool(
      'list_specialists',
      {},
      { sessionId: 'session-1', agentId: 'agent-1', tenantId: 'tenant-1' },
    );

    const payload = JSON.parse(toolResult.result) as {
      specialists: Array<{ matchingHints: string[] }>;
    };
    expect(payload.specialists[0]?.matchingHints).toEqual(
      expect.arrayContaining(['Ева Король', 'Ева', 'Еве', 'Еву', 'Король']),
    );
  });
  it('marks returned group slots as bookable in the create tool contract', () => {
    const createTool = AGENT_TOOLS.find(
      (tool) => tool.type === 'function' && tool.function.name === 'create_appointment_request',
    );
    expect(createTool?.type === 'function' ? createTool.function.description : '').toContain(
      'A group slot returned by find_available_slots is bookable',
    );
  });

  it('allows appointment creation with specialist and service names when IDs are uncertain', () => {
    const createTool = AGENT_TOOLS.find(
      (tool) => tool.type === 'function' && tool.function.name === 'create_appointment_request',
    );
    const properties =
      createTool?.type === 'function'
        ? (createTool.function.parameters as { properties?: Record<string, unknown> }).properties
        : undefined;

    expect(properties).toHaveProperty('specialist_name');
    expect(properties).toHaveProperty('service_name');
    expect(properties).toHaveProperty('group_participants');
    expect(createTool?.type === 'function' ? createTool.function.description : '').toContain(
      'the backend will resolve them',
    );
    expect(createTool?.type === 'function' ? createTool.function.description : '').toContain(
      'appointments must not be created without a service',
    );
  });
});
it('finds slots for every compatible specialist when only service and date are given', async () => {
  vi.mocked(prisma.agent.findUnique).mockResolvedValueOnce({ tenantId: 'tenant-1' } as never);
  vi.mocked(prisma.specialist.findMany).mockResolvedValueOnce([
    { id: 'anna', name: 'Анна Левина', role: 'Колорист' },
    { id: 'maria', name: 'Мария Соколова', role: 'Колорист' },
  ] as never);
  vi.mocked(getActiveServicesForSpecialist)
    .mockResolvedValueOnce([
      { id: 'dimensional-color', name: 'Dimensional color', isGroup: false, capacity: 1 },
    ] as never)
    .mockResolvedValueOnce([
      { id: 'dimensional-color', name: 'Dimensional color', isGroup: false, capacity: 1 },
    ] as never);
  vi.mocked(findAvailableSlots)
    .mockResolvedValueOnce([
      { startsAt: '2026-08-04T07:00:00.000Z', endsAt: '2026-08-04T08:00:00.000Z' },
    ])
    .mockResolvedValueOnce([
      { startsAt: '2026-08-04T10:00:00.000Z', endsAt: '2026-08-04T11:00:00.000Z' },
    ]);
  const toolResult = await executeTool(
    'find_available_slots',
    { service_name: 'Dimensional color', date_from: '2026-08-04', date_to: '2026-08-04' },
    { sessionId: 'session-1', agentId: 'agent-1', tenantId: 'tenant-1' },
  );
  const payload = JSON.parse(toolResult.result) as {
    specialists: Array<{ specialist: { name: string }; slots: Array<{ startsAt: string }> }>;
  };
  expect(payload.specialists.map((entry) => entry.specialist.name)).toEqual([
    'Анна Левина',
    'Мария Соколова',
  ]);
  expect(payload.specialists.flatMap((entry) => entry.slots)).toHaveLength(2);
  expect(findAvailableSlots).toHaveBeenCalledWith(
    'anna',
    'dimensional-color',
    '2026-08-04',
    '2026-08-04',
    'Europe/Minsk',
  );
});

describe('booking date guard', () => {
  it('blocks slot lookup for a newly selected service until the visitor gives a date', async () => {
    vi.clearAllMocks();
    const toolResult = await executeTool(
      'find_available_slots',
      {
        specialist_name: 'Ева',
        service_name: 'Face practice',
        date_from: '2026-08-06',
        date_to: '2026-08-06',
      },
      {
        sessionId: 'session-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        bookingContext: {
          serviceId: 'face-practice',
          serviceName: 'Face practice',
          needsDate: true,
        },
      },
    );

    expect(JSON.parse(toolResult.result)).toMatchObject({
      error: 'DATE_REQUIRED_FOR_NEW_SERVICE',
    });
    expect(findAvailableSlots).not.toHaveBeenCalled();
  });

  it('blocks appointment creation until the visitor explicitly selects a date and time', async () => {
    vi.clearAllMocks();
    const toolResult = await executeTool(
      'create_appointment_request',
      {
        specialist_name: 'Ева',
        service_name: 'Face practice',
        starts_at: '2026-08-07 12:00',
        name: 'Сергей',
        phone: '+375290000004',
      },
      {
        sessionId: 'session-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        bookingContext: {
          serviceId: 'face-practice',
          serviceName: 'Face practice',
          needsDate: false,
        },
        visitorText: '1 человек',
      },
    );

    expect(JSON.parse(toolResult.result)).toMatchObject({
      error: 'EXPLICIT_SLOT_SELECTION_REQUIRED',
    });
  });
  it('allows contact collection after the visitor selected a slot in an earlier message', async () => {
    vi.clearAllMocks();
    vi.mocked(parseBusinessDateTime).mockReturnValue(new Date('2026-08-07T06:00:00.000Z'));
    const toolResult = await executeTool(
      'create_appointment_request',
      {
        specialist_name: 'Ева',
        service_name: 'Face practice',
        starts_at: '2026-08-07 09:00',
        name: 'Сергей',
        phone: '+375290000004',
      },
      {
        sessionId: 'session-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        bookingContext: {
          serviceId: 'face-practice',
          serviceName: 'Face practice',
          needsDate: false,
          selectedSlot: true,
        },
        visitorText: 'Сергей +375290000004',
      },
    );

    expect(JSON.parse(toolResult.result)).not.toMatchObject({
      error: 'EXPLICIT_SLOT_SELECTION_REQUIRED',
    });
  });
  it('blocks creation when the requested time differs from the visitor-selected slot', async () => {
    vi.clearAllMocks();
    const toolResult = await executeTool(
      'create_appointment_request',
      {
        specialist_name: 'Ева',
        service_name: 'Face practice',
        starts_at: '2026-08-07 12:00',
        name: 'Сергей',
        phone: '+375290000004',
      },
      {
        sessionId: 'session-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        bookingContext: {
          serviceId: 'face-practice',
          serviceName: 'Face practice',
          needsDate: false,
          selectedSlot: true,
          selectedSlotTime: '09:00',
        },
        visitorText: 'Сергей +375290000004',
      },
    );

    expect(JSON.parse(toolResult.result)).toMatchObject({
      error: 'SELECTED_SLOT_TIME_MISMATCH',
    });
  });
  it('blocks appointment creation for a newly selected service until the visitor gives a date', async () => {
    vi.clearAllMocks();
    const toolResult = await executeTool(
      'create_appointment_request',
      {
        specialist_name: 'Ева',
        service_name: 'Face practice',
        starts_at: '2026-08-06 10:00',
        name: 'Сергей',
        phone: '+375290000004',
      },
      {
        sessionId: 'session-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        bookingContext: {
          serviceId: 'face-practice',
          serviceName: 'Face practice',
          needsDate: true,
        },
      },
    );

    expect(JSON.parse(toolResult.result)).toMatchObject({
      error: 'DATE_REQUIRED_FOR_NEW_SERVICE',
    });
  });
});

describe('booking selection continuity', () => {
  beforeEach(() => vi.clearAllMocks());

  it('resolves a selected service by name before looking up a specialist’s slots', async () => {
    vi.mocked(getZonedDateTimeParts).mockReturnValue({
      dateKey: '2026-08-10',
      dayOfWeek: 1,
      minutes: 600,
    });
    vi.mocked(prisma.agent.findUnique).mockResolvedValueOnce({ tenantId: 'tenant-1' } as never);
    vi.mocked(prisma.specialist.findMany).mockResolvedValueOnce([
      { id: 'anna', name: 'Анна Левина', role: 'Колорист' },
    ] as never);
    vi.mocked(getActiveServicesForSpecialist)
      .mockResolvedValueOnce([
        {
          id: 'signature-cut',
          name: 'Signature cut',
          durationMin: 90,
          priceLabel: 'от 140 BYN',
          isGroup: false,
          capacity: 1,
        },
      ] as never)
      .mockResolvedValueOnce([
        {
          id: 'signature-cut',
          name: 'Signature cut',
          durationMin: 90,
          priceLabel: 'от 140 BYN',
          isGroup: false,
          capacity: 1,
        },
      ] as never);
    vi.mocked(findAvailableSlots).mockResolvedValueOnce([
      { startsAt: '2026-08-11T07:00:00.000Z', endsAt: '2026-08-11T08:30:00.000Z' },
    ]);

    const toolResult = await executeTool(
      'find_available_slots',
      {
        specialist_name: 'Анны',
        service_name: 'Signature cut',
        date_from: '2026-08-11',
        date_to: '2026-08-11',
      },
      { sessionId: 'session-1', agentId: 'agent-1', tenantId: 'tenant-1' },
    );

    const payload = JSON.parse(toolResult.result) as {
      service?: { id: string; name: string };
      error?: string;
    };
    expect(payload.error).toBeUndefined();
    expect(payload.service).toMatchObject({ id: 'signature-cut', name: 'Signature cut' });
    expect(findAvailableSlots).toHaveBeenCalledWith(
      'anna',
      'signature-cut',
      '2026-08-11',
      '2026-08-11',
      'Europe/Minsk',
    );
  });

  it('rejects an accidental switch away from the already selected service', async () => {
    const toolResult = await executeTool(
      'find_available_slots',
      {
        service_name: 'Dimensional color',
        date_from: '2026-08-11',
        date_to: '2026-08-11',
      },
      {
        sessionId: 'session-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        bookingContext: {
          serviceId: 'signature-cut',
          serviceName: 'Signature cut',
          needsDate: false,
        },
      },
    );

    expect(JSON.parse(toolResult.result)).toMatchObject({ error: 'SELECTED_SERVICE_MISMATCH' });
    expect(findAvailableSlots).not.toHaveBeenCalled();
  });

  it('searches the next 14 days for an alternative-date request using the saved selection', async () => {
    vi.mocked(getZonedDateTimeParts).mockReturnValue({
      dateKey: '2026-08-10',
      dayOfWeek: 1,
      minutes: 600,
    });
    vi.mocked(prisma.agent.findUnique).mockResolvedValueOnce({ tenantId: 'tenant-1' } as never);
    vi.mocked(prisma.specialist.findFirst).mockResolvedValueOnce({
      id: 'anna',
      name: 'Анна Левина',
      role: 'Колорист',
    } as never);
    vi.mocked(getActiveServicesForSpecialist).mockResolvedValueOnce([
      {
        id: 'signature-cut',
        name: 'Signature cut',
        durationMin: 90,
        priceLabel: 'от 140 BYN',
        isGroup: false,
        capacity: 1,
      },
    ] as never);
    vi.mocked(findAvailableSlots).mockResolvedValueOnce([
      { startsAt: '2026-08-11T07:00:00.000Z', endsAt: '2026-08-11T08:30:00.000Z' },
    ]);

    const toolResult = await executeTool(
      'find_available_slots',
      { search_next_available: true },
      {
        sessionId: 'session-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        visitorText: 'А какие есть даты?',
        bookingContext: {
          serviceId: 'signature-cut',
          serviceName: 'Signature cut',
          specialistId: 'anna',
          specialistName: 'Анна Левина',
          needsDate: false,
          alternativeDatesRequested: true,
        },
      },
    );

    expect(JSON.parse(toolResult.result)).not.toMatchObject({ error: 'NO_SLOTS' });
    expect(findAvailableSlots).toHaveBeenCalledWith(
      'anna',
      'signature-cut',
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      'Europe/Minsk',
    );
  });

  it('resolves a relative week from the visitor message before requiring date fields', async () => {
    vi.mocked(getZonedDateTimeParts).mockReturnValue({
      dateKey: '2026-08-10',
      dayOfWeek: 1,
      minutes: 600,
    });
    vi.mocked(prisma.agent.findUnique).mockResolvedValueOnce({ tenantId: 'tenant-1' } as never);
    vi.mocked(prisma.specialist.findFirst).mockResolvedValueOnce({
      id: 'anna',
      name: 'Анна Левина',
      role: 'Колорист',
    } as never);
    vi.mocked(getActiveServicesForSpecialist).mockResolvedValueOnce([
      {
        id: 'signature-cut',
        name: 'Signature cut',
        durationMin: 90,
        priceLabel: 'от 140 BYN',
        isGroup: false,
        capacity: 1,
      },
    ] as never);
    vi.mocked(findAvailableSlots).mockResolvedValueOnce([
      { startsAt: '2026-08-11T07:00:00.000Z', endsAt: '2026-08-11T08:30:00.000Z' },
    ]);

    const toolResult = await executeTool(
      'find_available_slots',
      {},
      {
        sessionId: 'session-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        visitorText: 'на этой неделе',
        bookingContext: {
          serviceId: 'signature-cut',
          serviceName: 'Signature cut',
          specialistId: 'anna',
          specialistName: 'Анна Левина',
          needsDate: false,
        },
      },
    );

    expect(JSON.parse(toolResult.result)).not.toMatchObject({
      error: expect.stringContaining('date_from'),
    });
    expect(findAvailableSlots).toHaveBeenCalledWith(
      'anna',
      'signature-cut',
      expect.any(Date),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
      'Europe/Minsk',
    );
  });

  it('returns a precise no-slots result for the selected date without guessing why', async () => {
    vi.mocked(getZonedDateTimeParts).mockReturnValue({
      dateKey: '2026-08-10',
      dayOfWeek: 1,
      minutes: 600,
    });
    vi.mocked(prisma.agent.findUnique).mockResolvedValueOnce({ tenantId: 'tenant-1' } as never);
    vi.mocked(prisma.specialist.findFirst).mockResolvedValueOnce({
      id: 'anna',
      name: 'Анна Левина',
      role: 'Колорист',
    } as never);
    vi.mocked(getActiveServicesForSpecialist).mockResolvedValueOnce([
      {
        id: 'signature-cut',
        name: 'Signature cut',
        durationMin: 90,
        priceLabel: 'от 140 BYN',
        isGroup: false,
        capacity: 1,
      },
    ] as never);
    vi.mocked(findAvailableSlots).mockResolvedValueOnce([]);

    const toolResult = await executeTool(
      'find_available_slots',
      { date_from: '2026-08-10', date_to: '2026-08-10' },
      {
        sessionId: 'session-1',
        agentId: 'agent-1',
        tenantId: 'tenant-1',
        bookingContext: {
          serviceId: 'signature-cut',
          serviceName: 'Signature cut',
          specialistId: 'anna',
          specialistName: 'Анна Левина',
          needsDate: false,
        },
      },
    );

    expect(JSON.parse(toolResult.result)).toMatchObject({
      error: 'NO_SLOTS',
      specialist: { name: 'Анна Левина' },
      service: { name: 'Signature cut' },
    });
  });
});
