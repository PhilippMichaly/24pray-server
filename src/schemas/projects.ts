import { z } from 'zod';

export const ProjectStatus = z.enum(['DRAFT', 'ACTIVE', 'PAUSED', 'ARCHIVED']);
export const ProjectVisibility = z.enum(['PUBLIC', 'PRIVATE']);

export const CreateProjectBody = z.object({
  title: z.string().min(1),
  description: z.string().optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  timezone: z.string().min(1).default('Europe/Berlin'),
  slotDurationMinutes: z.number().int().positive().max(1440).default(60),
  visibility: ProjectVisibility.default('PRIVATE'),
});

export const UpdateProjectBody = z.object({
  title: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  status: ProjectStatus.optional(),
  visibility: ProjectVisibility.optional(),
  startDate: z.string().datetime().optional(),
  endDate: z.string().datetime().optional(),
  timezone: z.string().min(1).optional(),
});
