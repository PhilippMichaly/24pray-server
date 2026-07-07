import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { generateToken } from '../lib/tokens.js';
import { requireUser } from '../plugins/auth.js';
import { CreateProjectBody, UpdateProjectBody } from '../schemas/projects.js';
import { toProjectWithStats } from '../lib/projectView.js';
import { canReadProject, ensureMembership } from '../lib/access.js';

function httpError(status: number, message: string) {
  const e = new Error(message) as Error & { statusCode?: number };
  e.statusCode = status;
  return e;
}

export function projectRoutes(app: FastifyInstance, deps: { prisma: PrismaClient }) {
  const { prisma } = deps;

  // List: public projects + caller's own
  app.get('/projects', async (req) => {
    const user = req.user;
    const projects = await prisma.prayerProject.findMany({
      where: user
        ? { OR: [{ visibility: 'PUBLIC' }, { organizerId: user.id }] }
        : { visibility: 'PUBLIC' },
      include: { organizer: true },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(projects.map((p) => toProjectWithStats(prisma, p, req.user?.id)));
  });

  // Create
  app.post('/projects', async (req) => {
    const user = requireUser(req);
    const body = CreateProjectBody.parse(req.body);
    if (new Date(body.endDate) <= new Date(body.startDate)) {
      throw httpError(400, 'endDate muss nach startDate liegen');
    }
    const project = await prisma.prayerProject.create({
      data: {
        title: body.title,
        description: body.description,
        startDate: new Date(body.startDate),
        endDate: new Date(body.endDate),
        timezone: body.timezone,
        slotDurationMinutes: body.slotDurationMinutes,
        visibility: body.visibility,
        locationName: body.locationName ?? null,
        locationLat: body.locationLat ?? null,
        locationLon: body.locationLon ?? null,
        status: 'ACTIVE',
        inviteToken: generateToken(),
        organizerId: user.id,
      },
      include: { organizer: true },
    });
    await ensureMembership(prisma, user.id, project.id, 'ORGANIZER'); // W3.2
    return toProjectWithStats(prisma, project, user.id);
  });

  // Get one (PRIVATE: Organizer, Mitglied oder ?invite=<token> — W3-Gap-Fix)
  app.get('/projects/:id', async (req) => {
    const { id } = req.params as { id: string };
    const { invite } = (req.query ?? {}) as { invite?: string };
    const project = await prisma.prayerProject.findUnique({ where: { id }, include: { organizer: true } });
    if (!project) throw httpError(404, 'Projekt nicht gefunden');
    if (!(await canReadProject(prisma, project, req.user, invite))) {
      throw httpError(403, 'Kein Zugriff auf dieses Projekt');
    }
    return toProjectWithStats(prisma, project, req.user?.id);
  });

  // Patch (organizer only)
  app.patch('/projects/:id', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const body = UpdateProjectBody.parse(req.body);
    const existing = await prisma.prayerProject.findUnique({ where: { id } });
    if (!existing) throw httpError(404, 'Projekt nicht gefunden');
    if (existing.organizerId !== user.id) throw httpError(403, 'Nur der Organisator darf ändern');
    const updated = await prisma.prayerProject.update({
      where: { id },
      data: {
        ...(body.title !== undefined ? { title: body.title } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.visibility !== undefined ? { visibility: body.visibility } : {}),
        ...(body.startDate !== undefined ? { startDate: new Date(body.startDate) } : {}),
        ...(body.endDate !== undefined ? { endDate: new Date(body.endDate) } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      },
      include: { organizer: true },
    });
    return toProjectWithStats(prisma, updated, user.id);
  });

  // Join by invite token
  app.get('/join/:token', async (req) => {
    const { token } = req.params as { token: string };
    const project = await prisma.prayerProject.findUnique({ where: { inviteToken: token }, include: { organizer: true } });
    if (!project) throw httpError(404, 'Einladung ungültig');
    return toProjectWithStats(prisma, project, undefined);
  });
}
