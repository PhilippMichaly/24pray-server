import type { PrismaClient, PrayerProject } from '@prisma/client';
import type { AuthedUser } from '../plugins/auth.js';

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
  if (inviteToken && inviteToken === project.inviteToken) return true;
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
