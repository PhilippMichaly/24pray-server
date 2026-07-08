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
  locationName: string | null;
  inviteToken: string;
  organizerId: string;
  createdAt: string;
  totalSlots: number;
  bookedSlots: number;
  organizerName: string;
}

export async function toProjectWithStats(
  prisma: PrismaClient,
  project: PrayerProject & { organizer?: { name: string } },
  requesterId?: string,
): Promise<ProjectWithStats> {
  const organizerName =
    project.organizer?.name ??
    (await prisma.user.findUnique({ where: { id: project.organizerId } }))?.name ??
    '';
  const bookedSlots = await prisma.prayerSlot.count({
    where: { projectId: project.id, status: 'BOOKED' },
  });
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
