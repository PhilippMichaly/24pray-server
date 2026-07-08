import type { PrismaClient, PrayerProject } from '@prisma/client';
import { maskName } from './slotGrid.js';

export interface ProjectWithStats {
  id: string;
  title: string;
  description: string | null;
  status: string;
  visibility: string;
  startDate: string;
  endDate: string;
  timezone: string;
  slotDurationMinutes: number;
  maskNames: boolean;
  notifyOnBooking: boolean;
  linkWhatsapp: string | null;
  linkTelegram: string | null;
  linkSignal: string | null;
  locationName: string | null;
  inviteToken: string;
  organizerId: string;
  createdAt: string;
  totalSlots: number;
  bookedSlots: number;
  organizerName: string;
}

/**
 * Batch-Variante für Listen (Lasttest-Fix): EINE groupBy-Query für alle bookedSlots
 * statt einem COUNT pro Projekt (N+1 — kollabierte bei 1000 Projekten ab c=10).
 */
export async function toProjectListWithStats(
  prisma: PrismaClient,
  projects: (PrayerProject & { organizer?: { name: string } })[],
  requesterId?: string,
): Promise<ProjectWithStats[]> {
  const counts = await prisma.prayerSlot.groupBy({
    by: ['projectId'],
    where: { projectId: { in: projects.map((p) => p.id) }, status: 'BOOKED' },
    _count: { _all: true },
  });
  const byProject = new Map(counts.map((c) => [c.projectId, c._count._all]));
  return Promise.all(
    projects.map((p) => toProjectWithStats(prisma, p, requesterId, byProject.get(p.id) ?? 0)),
  );
}

export async function toProjectWithStats(
  prisma: PrismaClient,
  project: PrayerProject & { organizer?: { name: string } },
  requesterId?: string,
  precomputedBookedSlots?: number, // aus toProjectListWithStats (vermeidet N+1)
): Promise<ProjectWithStats> {
  const organizerName =
    project.organizer?.name ??
    (await prisma.user.findUnique({ where: { id: project.organizerId } }))?.name ??
    '';
  const bookedSlots =
    precomputedBookedSlots ??
    (await prisma.prayerSlot.count({
      where: { projectId: project.id, status: 'BOOKED' },
    }));
  const slotMs = project.slotDurationMinutes * 60 * 1000;
  const totalSlots = Math.max(
    0,
    Math.round((project.endDate.getTime() - project.startDate.getTime()) / slotMs),
  );
  return {
    id: project.id,
    title: project.title,
    description: project.description,
    status: project.status,
    visibility: project.visibility,
    startDate: project.startDate.toISOString(),
    endDate: project.endDate.toISOString(),
    timezone: project.timezone,
    slotDurationMinutes: project.slotDurationMinutes,
    maskNames: project.maskNames,
    notifyOnBooking: project.notifyOnBooking,
    linkWhatsapp: project.linkWhatsapp,
    linkTelegram: project.linkTelegram,
    linkSignal: project.linkSignal,
    locationName: project.locationName,
    inviteToken: project.organizerId === requesterId ? project.inviteToken : '',
    organizerId: project.organizerId,
    createdAt: project.createdAt.toISOString(),
    totalSlots,
    bookedSlots,
    // Masking nur bei Projekt-Opt-in (§E5-Revision 2026-07-08) — Default ist Klartext.
    organizerName: !requesterId && project.maskNames ? maskName(organizerName) ?? '' : organizerName,
  };
}
