import { createRoute } from '@hono/zod-openapi';
import { z } from 'zod';
import { prisma, Prisma } from '@budget-tracker/db';
import {
  UtilityProviderSchema,
  UtilityProviderListResponseSchema,
  CreateUtilityProviderSchema,
  UpdateUtilityProviderSchema,
  UtilityServiceSchema,
  UtilityServiceListResponseSchema,
  CreateUtilityServiceSchema,
  UpdateUtilityServiceSchema,
} from '@budget-tracker/core';
import type { ServiceType } from '@budget-tracker/core';
import { ErrorSchema, createRouter } from '../lib/errors.js';
import { invalidateSchedule } from '../lib/schedule-generator.js';

const app = createRouter();

// ─── Param schemas ───

const providerIdParam = z.object({ id: z.string() });
const providerIdNestedParam = z.object({ providerId: z.string() });
const serviceIdParam = z.object({ id: z.string() });

// ─── Serialization helpers ───

function serializeProvider(r: {
  id: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
  services?: { serviceType: ServiceType }[];
}) {
  return {
    id: r.id,
    name: r.name,
    // Distinct and sorted, so a list can show what a provider IS without a
    // request per row. Absent `services` means the caller did not include them,
    // which is not the same as "supplies nothing" — but an empty array is the
    // honest answer either way for a consumer that only reads this to pick an icon.
    serviceTypes: [...new Set((r.services ?? []).map((s) => s.serviceType))].sort(),
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

function serializeService(r: {
  id: string;
  providerId: string;
  serviceType: string;
  metering: string;
  expenseId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: r.id,
    providerId: r.providerId,
    serviceType: r.serviceType as z.infer<typeof UtilityServiceSchema>['serviceType'],
    metering: r.metering as z.infer<typeof UtilityServiceSchema>['metering'],
    expenseId: r.expenseId,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// Provider CRUD
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /providers ───

const listProvidersRoute = createRoute({
  method: 'get',
  path: '/providers',
  tags: ['Utility Providers'],
  summary: 'List all utility providers',
  responses: {
    200: {
      content: { 'application/json': { schema: UtilityProviderListResponseSchema } },
      description: 'List of utility providers',
    },
  },
});

app.openapi(listProvidersRoute, async (c) => {
  const providers = await prisma.utilityProvider.findMany({
    orderBy: { name: 'asc' },
    include: { services: { select: { serviceType: true } } },
  });
  return c.json(providers.map(serializeProvider), 200);
});

// ─── POST /providers ───

const createProviderRoute = createRoute({
  method: 'post',
  path: '/providers',
  tags: ['Utility Providers'],
  summary: 'Create a utility provider',
  request: {
    body: { content: { 'application/json': { schema: CreateUtilityProviderSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: UtilityProviderSchema } },
      description: 'Provider created',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Conflict',
    },
  },
});

app.openapi(createProviderRoute, async (c) => {
  const { name } = c.req.valid('json');

  const existing = await prisma.utilityProvider.findFirst({
    where: { name: { equals: name, mode: 'insensitive' } },
  });
  if (existing) {
    return c.json({ error: 'A provider with this name already exists' }, 409);
  }

  const provider = await prisma.utilityProvider.create({
    data: { name },
    include: { services: { select: { serviceType: true } } },
  });
  return c.json(serializeProvider(provider), 201);
});

// ─── PUT /providers/:id ───

const updateProviderRoute = createRoute({
  method: 'put',
  path: '/providers/{id}',
  tags: ['Utility Providers'],
  summary: 'Update a utility provider name',
  request: {
    params: providerIdParam,
    body: { content: { 'application/json': { schema: UpdateUtilityProviderSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UtilityProviderSchema } },
      description: 'Provider updated',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Conflict',
    },
  },
});

app.openapi(updateProviderRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { name } = c.req.valid('json');

  const provider = await prisma.utilityProvider.findUnique({ where: { id } });
  if (!provider) {
    return c.json({ error: 'Provider not found' }, 404);
  }

  const duplicate = await prisma.utilityProvider.findFirst({
    where: { name: { equals: name, mode: 'insensitive' }, id: { not: id } },
  });
  if (duplicate) {
    return c.json({ error: 'A provider with this name already exists' }, 409);
  }

  const updated = await prisma.utilityProvider.update({
    where: { id },
    data: { name },
    include: { services: { select: { serviceType: true } } },
  });
  return c.json(serializeProvider(updated), 200);
});

// ─── DELETE /providers/:id ───

const deleteProviderRoute = createRoute({
  method: 'delete',
  path: '/providers/{id}',
  tags: ['Utility Providers'],
  summary: 'Delete a utility provider',
  request: { params: providerIdParam },
  responses: {
    204: { description: 'Provider deleted' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Conflict',
    },
  },
});

app.openapi(deleteProviderRoute, async (c) => {
  const { id } = c.req.valid('param');

  const provider = await prisma.utilityProvider.findUnique({ where: { id } });
  if (!provider) {
    return c.json({ error: 'Provider not found' }, 404);
  }

  const serviceCount = await prisma.utilityService.count({ where: { providerId: id } });
  if (serviceCount > 0) {
    return c.json({ error: 'Cannot delete provider that has active services' }, 409);
  }

  await prisma.utilityProvider.delete({ where: { id } });
  return c.body(null, 204);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Service CRUD
// ═══════════════════════════════════════════════════════════════════════════════

// ─── GET /providers/:providerId/services ───

const listServicesRoute = createRoute({
  method: 'get',
  path: '/providers/{providerId}/services',
  tags: ['Utility Services'],
  summary: 'List services for a provider',
  request: { params: providerIdNestedParam },
  responses: {
    200: {
      content: { 'application/json': { schema: UtilityServiceListResponseSchema } },
      description: 'List of services',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(listServicesRoute, async (c) => {
  const { providerId } = c.req.valid('param');

  const provider = await prisma.utilityProvider.findUnique({ where: { id: providerId } });
  if (!provider) {
    return c.json({ error: 'Provider not found' }, 404);
  }

  const services = await prisma.utilityService.findMany({
    where: { providerId },
    orderBy: { serviceType: 'asc' },
  });
  return c.json(services.map(serializeService), 200);
});

// ─── POST /providers/:providerId/services ───

const createServiceRoute = createRoute({
  method: 'post',
  path: '/providers/{providerId}/services',
  tags: ['Utility Services'],
  summary: 'Create a service under a provider',
  request: {
    params: providerIdNestedParam,
    body: { content: { 'application/json': { schema: CreateUtilityServiceSchema } } },
  },
  responses: {
    201: {
      content: { 'application/json': { schema: UtilityServiceSchema } },
      description: 'Service created',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Conflict',
    },
  },
});

app.openapi(createServiceRoute, async (c) => {
  const { providerId } = c.req.valid('param');
  const { serviceType, metering } = c.req.valid('json');

  const provider = await prisma.utilityProvider.findUnique({ where: { id: providerId } });
  if (!provider) {
    return c.json({ error: 'Provider not found' }, 404);
  }

  try {
    const service = await prisma.utilityService.create({
      data: { providerId, serviceType, metering },
    });
    return c.json(serializeService(service), 201);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2002') {
        return c.json({ error: 'This provider already has a service of this type' }, 409);
      }
    }
    throw err;
  }
});

// ─── PUT /services/:id ───

const updateServiceRoute = createRoute({
  method: 'put',
  path: '/services/{id}',
  tags: ['Utility Services'],
  summary: 'Update a service metering classification',
  request: {
    params: serviceIdParam,
    body: { content: { 'application/json': { schema: UpdateUtilityServiceSchema } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UtilityServiceSchema } },
      description: 'Service updated',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(updateServiceRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { metering } = c.req.valid('json');

  try {
    const service = await prisma.utilityService.update({
      where: { id },
      data: { metering },
    });
    return c.json(serializeService(service), 200);
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError) {
      if (err.code === 'P2025') return c.json({ error: 'Service not found' }, 404);
    }
    throw err;
  }
});

// ─── DELETE /services/:id ───

const deleteServiceRoute = createRoute({
  method: 'delete',
  path: '/services/{id}',
  tags: ['Utility Services'],
  summary: 'Delete a service',
  request: { params: serviceIdParam },
  responses: {
    204: { description: 'Service deleted' },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
    409: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Conflict',
    },
  },
});

app.openapi(deleteServiceRoute, async (c) => {
  const { id } = c.req.valid('param');

  const service = await prisma.utilityService.findUnique({ where: { id } });
  if (!service) {
    return c.json({ error: 'Service not found' }, 404);
  }

  const readingCount = await prisma.utilityReading.count({ where: { serviceId: id } });
  if (readingCount > 0) {
    return c.json({ error: 'Cannot delete service that has associated readings' }, 409);
  }

  await prisma.utilityService.delete({ where: { id } });
  return c.body(null, 204);
});

// ═══════════════════════════════════════════════════════════════════════════════
// Expense Linking
// ═══════════════════════════════════════════════════════════════════════════════

// ─── PUT /services/:id/link ───

const linkServiceRoute = createRoute({
  method: 'put',
  path: '/services/{id}/link',
  tags: ['Utility Services'],
  summary: 'Link a service to a recurring expense',
  request: {
    params: serviceIdParam,
    body: { content: { 'application/json': { schema: z.object({ expenseId: z.string() }) } } },
  },
  responses: {
    200: {
      content: { 'application/json': { schema: UtilityServiceSchema } },
      description: 'Service linked to expense',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(linkServiceRoute, async (c) => {
  const { id } = c.req.valid('param');
  const { expenseId } = c.req.valid('json');

  const service = await prisma.utilityService.findUnique({ where: { id } });
  if (!service) {
    return c.json({ error: 'Service not found' }, 404);
  }

  // Invalidate old linked expense schedule if changing link
  if (service.expenseId && service.expenseId !== expenseId) {
    await invalidateSchedule('EXPENSE', service.expenseId);
  }

  const updated = await prisma.utilityService.update({
    where: { id },
    data: { expenseId },
  });

  // Invalidate new linked expense schedule
  await invalidateSchedule('EXPENSE', expenseId);

  return c.json(serializeService(updated), 200);
});

// ─── DELETE /services/:id/link ───

const unlinkServiceRoute = createRoute({
  method: 'delete',
  path: '/services/{id}/link',
  tags: ['Utility Services'],
  summary: 'Unlink a service from its expense',
  request: { params: serviceIdParam },
  responses: {
    200: {
      content: { 'application/json': { schema: UtilityServiceSchema } },
      description: 'Service unlinked from expense',
    },
    404: {
      content: { 'application/json': { schema: ErrorSchema } },
      description: 'Not Found',
    },
  },
});

app.openapi(unlinkServiceRoute, async (c) => {
  const { id } = c.req.valid('param');

  const service = await prisma.utilityService.findUnique({ where: { id } });
  if (!service) {
    return c.json({ error: 'Service not found' }, 404);
  }

  // Invalidate old linked expense schedule
  if (service.expenseId) {
    await invalidateSchedule('EXPENSE', service.expenseId);
  }

  const updated = await prisma.utilityService.update({
    where: { id },
    data: { expenseId: null },
  });

  return c.json(serializeService(updated), 200);
});

export { app as utilitiesProvidersRouter };
export default app;
