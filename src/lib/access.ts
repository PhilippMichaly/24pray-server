import type { PrismaClient, PrayerProject } from '@prisma/client';
import type { AuthedUser } from '../plugins/auth.js';
import { safeEqual } from './tokens.js';

/**
 * Lese-Zugriff auf ein Projekt (W3 / Private-Gast-Gap):
 * PUBLIC · Organizer · gültiger Invite-Token (?invite=) · Mitglied.
 * Damit können Gäste mit Einladungslink auch PRIVATE-Ketten sehen und buchen.
 */
export async function canReadProject(
  prisma: PrismaClient,
  project: PrayerProject,
  user: AuthedUser | null,
  inviteToken?: string,
): Promise<boolean> {
  if (project.visibility === 'PUBLIC') return true;
  if (user?.id === project.organizerId) return true;
  if (inviteToken && project.inviteToken && safeEqual(inviteToken, project.inviteToken)) return true;
  if (user) {
    const member = await prisma.membership.findUnique({
      where: { userId_projectId: { userId: user.id, projectId: project.id } },
    });
    if (member) return true;
  }
  return false;
}

/** Membership idempotent anlegen (bei Projekt-Anlage und Buchung). */
export async function ensureMembership(
  prisma: PrismaClient,
  userId: string,
  projectId: string,
  role: 'MEMBER' | 'ORGANIZER' = 'MEMBER',
): Promise<void> {
  await prisma.membership.upsert({
    where: { userId_projectId: { userId, projectId } },
    update: role === 'ORGANIZER' ? { role } : {},
    create: { userId, projectId, role },
  });
}

/**
 * Nimmt der User an der Wache teil (A9)? Organizer oder Mitglied (Membership-Zeile).
 * Ein Invite-Token allein macht NICHT zum Teilnehmer — er gibt nur Leserecht.
 * Steuert die maskNames-Maskierung: Nicht-Teilnehmer sehen abgekürzte Namen.
 */
export async function isParticipant(
  prisma: PrismaClient,
  project: Pick<PrayerProject, 'id' | 'organizerId'>,
  userId: string | null,
): Promise<boolean> {
  if (!userId) return false;
  if (userId === project.organizerId) return true;
  const member = await prisma.membership.findUnique({
    where: { userId_projectId: { userId, projectId: project.id } },
  });
  return member !== null;
}

/**
 * Batch-Variante von isParticipant für Listen: EINE Membership-Abfrage für alle
 * Projekte statt einer pro Projekt (kein N+1). Liefert die IDs der Projekte, an
 * denen der User teilnimmt.
 */
export async function participantProjectIds(
  prisma: PrismaClient,
  projects: Pick<PrayerProject, 'id' | 'organizerId'>[],
  userId: string | null,
): Promise<Set<string>> {
  const ids = new Set<string>();
  if (!userId || projects.length === 0) return ids;
  for (const p of projects) if (p.organizerId === userId) ids.add(p.id);
  const rest = projects.filter((p) => !ids.has(p.id)).map((p) => p.id);
  if (rest.length === 0) return ids;
  const memberships = await prisma.membership.findMany({
    where: { userId, projectId: { in: rest } },
    select: { projectId: true },
  });
  for (const m of memberships) ids.add(m.projectId);
  return ids;
}
