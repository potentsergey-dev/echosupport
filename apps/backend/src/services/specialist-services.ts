import { prisma } from '../db/prisma.js';

interface SpecialistDescriptor {
  id: string;
  description: string | null;
}

interface ServiceDescriptor {
  id: string;
  name: string;
  specialistId: string | null;
}

function normalize(value: string): string {
  return value
    .toLocaleLowerCase('ru-RU')
    .replace(/ё/g, 'е')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Compatibility bridge for installations that describe specialist/service links in the
 * specialist description while the legacy schema still supports only one specialist per service.
 * Once at least one service name is explicitly mentioned, unmentioned global services are excluded.
 */
export function filterServicesForSpecialist<T extends ServiceDescriptor>(
  specialist: SpecialistDescriptor,
  services: T[],
): T[] {
  const description = normalize(specialist.description ?? '');
  const explicitlyAssigned = services.filter((service) => service.specialistId === specialist.id);
  const described = description
    ? services.filter((service) => {
        const serviceName = normalize(service.name);
        return serviceName.length >= 2 && description.includes(serviceName);
      })
    : [];

  if (explicitlyAssigned.length === 0 && described.length === 0) return services;

  const allowedIds = new Set([...explicitlyAssigned, ...described].map((service) => service.id));
  return services.filter((service) => allowedIds.has(service.id));
}

export async function getActiveServicesForSpecialist({
  tenantId,
  specialistId,
}: {
  tenantId: string;
  specialistId: string;
}) {
  const specialist = await prisma.specialist.findFirst({
    where: { id: specialistId, tenantId, isActive: true },
    select: { id: true, description: true },
  });
  if (!specialist) return [];

  const services = await prisma.service.findMany({
    where: {
      tenantId,
      isActive: true,
      OR: [{ specialistId: null }, { specialistId }],
    },
    orderBy: { name: 'asc' },
  });

  return filterServicesForSpecialist(specialist, services);
}
