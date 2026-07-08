import type { FastifyInstance } from 'fastify';
import type { PrismaClient } from '@prisma/client';
import { generateToken } from '../lib/tokens.js';
import { requireUser } from '../plugins/auth.js';
import { CreateProjectBody, ShiftProjectBody, UpdateProjectBody } from '../schemas/projects.js';
import { toProjectWithStats, toProjectListWithStats } from '../lib/projectView.js';
import { canReadProject, ensureMembership } from '../lib/access.js';
import type { Mailer } from '../lib/mailer.js';
import type { Env } from '../env.js';

function httpError(status: number, message: string) {
  const e = new Error(message) as Error & { statusCode?: number };
  e.statusCode = status;
  return e;
}

/** Künftige BOOKED-Slots eines Projekts, dedupliziert pro Empfänger-E-Mail (User oder Gast).
 *  Gemeinsam genutzt von Shift (Feature 1) und Delete (Feature 2) — beide müssen vor der
 *  jeweiligen Aktion wissen, wer noch betroffen ist. */
interface FutureRecipient {
  email: string;
  name: string;
  slots: { startTime: Date; endTime: Date }[];
}

async function collectFutureBookedRecipients(
  prisma: PrismaClient,
  projectId: string,
  now: Date,
): Promise<FutureRecipient[]> {
  const slots = await prisma.prayerSlot.findMany({
    where: { projectId, status: 'BOOKED', startTime: { gt: now } },
    include: { user: true },
  });
  const byEmail = new Map<string, FutureRecipient>();
  for (const s of slots) {
    const email = s.user?.email ?? s.guestEmail;
    if (!email) continue; // Gast ohne E-Mail: Slot wird trotzdem verschoben/gelöscht, nur keine Mail
    const name = s.user?.name ?? s.guestName ?? '';
    const entry = byEmail.get(email) ?? { email, name, slots: [] };
    entry.slots.push({ startTime: s.startTime, endTime: s.endTime });
    byEmail.set(email, entry);
  }
  return [...byEmail.values()];
}

export function projectRoutes(app: FastifyInstance, deps: { prisma: PrismaClient; mailer?: Mailer; env?: Env }) {
  const { prisma, mailer, env } = deps;

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
    return toProjectListWithStats(prisma, projects, req.user?.id);
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
        maskNames: body.maskNames,
        notifyOnBooking: body.notifyOnBooking,
        linkWhatsapp: body.linkWhatsapp ?? null,
        linkTelegram: body.linkTelegram ?? null,
        linkSignal: body.linkSignal ?? null,
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
        ...(body.maskNames !== undefined ? { maskNames: body.maskNames } : {}),
        ...(body.notifyOnBooking !== undefined ? { notifyOnBooking: body.notifyOnBooking } : {}),
        ...(body.linkWhatsapp !== undefined ? { linkWhatsapp: body.linkWhatsapp } : {}),
        ...(body.linkTelegram !== undefined ? { linkTelegram: body.linkTelegram } : {}),
        ...(body.linkSignal !== undefined ? { linkSignal: body.linkSignal } : {}),
        ...(body.startDate !== undefined ? { startDate: new Date(body.startDate) } : {}),
        ...(body.endDate !== undefined ? { endDate: new Date(body.endDate) } : {}),
        ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
        ...(body.locationName !== undefined ? { locationName: body.locationName } : {}),
        ...(body.locationLat !== undefined ? { locationLat: body.locationLat } : {}),
        ...(body.locationLon !== undefined ? { locationLon: body.locationLon } : {}),
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

  // Wache verschieben (organizer only): Delta zwischen altem und neuem Start wandert
  // 1:1 auf Projekt-Zeitraum UND alle Slots (auch CANCELLED/COMPLETED — Historie bleibt
  // konsistent). Prisma legt DateTime auf SQLite als Unix-Epoch-Millisekunden (INTEGER-
  // Spalte) ab — bewiesen per Direktinspektion der data/24pray.db (`typeof(startTime)` =
  // 'integer', Werte wie 1783540980000). Deshalb ist eine reine Integer-Addition per
  // $executeRaw exakt UND die einzig günstige Variante: eine JS-Schleife über alle Slots
  // einer großen Wache wäre O(n) Round-Trips statt eines einzigen Statements.
  app.post('/projects/:id/shift', async (req) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const body = ShiftProjectBody.parse(req.body);
    const project = await prisma.prayerProject.findUnique({ where: { id } });
    if (!project) throw httpError(404, 'Projekt nicht gefunden');
    if (project.organizerId !== user.id) throw httpError(403, 'Nur der Organisator darf die Wache verschieben');

    const newStart = new Date(body.newStartDate);
    const deltaMs = newStart.getTime() - project.startDate.getTime();

    if (deltaMs !== 0) {
      const now = new Date();
      // Empfänger + ihre Original-Zeiten VOR dem Shift einsammeln — nach dem Shift
      // wäre "künftig" relativ zu now nicht mehr von "alter Zeitpunkt" zu unterscheiden.
      const recipients = await collectFutureBookedRecipients(prisma, id, now);

      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`UPDATE PrayerProject SET startDate = startDate + ${deltaMs}, endDate = endDate + ${deltaMs} WHERE id = ${id}`;
        await tx.$executeRaw`UPDATE PrayerSlot SET startTime = startTime + ${deltaMs}, endTime = endTime + ${deltaMs} WHERE projectId = ${id}`;
        // Reminder sollen für alle (nach dem Shift) künftigen Slots neu feuern.
        await tx.$executeRaw`UPDATE PrayerSlot SET remindedAt = NULL WHERE projectId = ${id} AND startTime > ${now.getTime()}`;
      });

      if (mailer?.sendScheduleChange && env) {
        const updatedProject = await prisma.prayerProject.findUniqueOrThrow({ where: { id } });
        for (const r of recipients) {
          mailer.sendScheduleChange(r.email, {
            name: r.name,
            projectTitle: updatedProject.title,
            oldStartDate: project.startDate.toISOString(),
            newStartDate: updatedProject.startDate.toISOString(),
            timezone: updatedProject.timezone,
            slots: r.slots.map((s) => ({
              oldStartTime: s.startTime.toISOString(),
              newStartTime: new Date(s.startTime.getTime() + deltaMs).toISOString(),
            })),
            projectUrl: `${env.APP_URL}/projects/${id}`,
          }).catch((err) => console.error(`[mail] schedule change failed for ${r.email}:`, err));
        }
      }
    }

    const updated = await prisma.prayerProject.findUniqueOrThrow({ where: { id }, include: { organizer: true } });
    return toProjectWithStats(prisma, updated, user.id);
  });

  // Wache löschen (organizer only): Abschieds-Mail an künftige Gebuchte, dann komplett
  // löschen. Die Kaskade (Slots/Memberships/RecurringCommitments/PrayerRequests) läuft
  // über die FK onDelete:Cascade-Regeln im Schema — dasselbe Muster wie DELETE /me
  // (dort: prayerProject.deleteMany für alle eigenen Projekte). Ein eigenes
  // Cascade-Helper wäre hier reine Indirektion: Prisma übernimmt die Kaskade bereits
  // vollständig mit einem einzigen delete() — es gibt nichts zu duplizieren.
  app.delete('/projects/:id', async (req, reply) => {
    const user = requireUser(req);
    const { id } = req.params as { id: string };
    const project = await prisma.prayerProject.findUnique({ where: { id } });
    if (!project) throw httpError(404, 'Projekt nicht gefunden');
    if (project.organizerId !== user.id) throw httpError(403, 'Nur der Organisator darf die Wache löschen');

    const recipients = await collectFutureBookedRecipients(prisma, id, new Date());

    await prisma.prayerProject.delete({ where: { id } });

    if (mailer?.sendProjectFarewell) {
      for (const r of recipients) {
        mailer.sendProjectFarewell(r.email, {
          name: r.name,
          projectTitle: project.title,
          timezone: project.timezone,
          slots: r.slots.map((s) => s.startTime.toISOString()),
        }).catch((err) => console.error(`[mail] project farewell failed for ${r.email}:`, err));
      }
    }

    return reply.code(204).send();
  });
}
