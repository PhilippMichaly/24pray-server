export interface SlotView {
  slotId: string | null; // DB-PrayerSlot.id, null wenn FREE (§6.1)
  startTime: string;
  endTime: string;
  status: 'FREE' | 'BOOKED';
  userName: string | null;
  isMine: boolean; // requester hält diesen Slot (§6.1)
}

export interface BookedSlotInput {
  id: string;
  userId: string | null;
  startTime: Date;
  userName: string | null;
  guestName: string | null;
}

const MINUTE_MS = 60 * 1000;

/** Obergrenze für Grid-Einträge (366 Tage à 24 Stunden) — schützt vor Alt-Projekten mit absurder Dauer. */
export const MAX_GRID_SLOTS = 366 * 24;

/** „Ruth Klein" → „Ruth K." — serverseitige Maskierung für anonyme Betrachter (§E5). */
export function maskName(n: string | null): string | null {
  if (!n) return n;
  const parts = n.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return n;
  // Magic-Link-Accounts heißen wie ihr E-Mail-Prefix (ein Wort, oft volle Identität
  // wie „max.mustermann") — Ein-Wort-Namen deshalb auf 2 Zeichen kürzen.
  if (parts.length === 1) return `${parts[0].slice(0, 2)}…`;
  return `${parts[0]} ${parts[parts.length - 1][0].toUpperCase()}.`;
}

export function slotLengthMs(slotDurationMinutes: number): number {
  return slotDurationMinutes * MINUTE_MS;
}

export function buildSlotGrid(
  start: Date,
  end: Date,
  booked: BookedSlotInput[],
  requesterId: string | null,
  slotDurationMinutes: number,
  maskNames = false, // Opt-in pro Projekt — Default ist Klartext (schafft Verbindung)
): SlotView[] {
  const slotMs = slotLengthMs(slotDurationMinutes);
  const byStart = new Map<number, BookedSlotInput>();
  for (const b of booked) byStart.set(b.startTime.getTime(), b);

  const grid: SlotView[] = [];
  const limit = Math.min(end.getTime(), start.getTime() + MAX_GRID_SLOTS * slotMs);
  for (let t = start.getTime(); t + slotMs <= limit; t += slotMs) {
    const hit = byStart.get(t);
    const rawName = hit ? hit.userName ?? hit.guestName ?? null : null;
    grid.push({
      slotId: hit ? hit.id : null,
      startTime: new Date(t).toISOString(),
      endTime: new Date(t + slotMs).toISOString(),
      status: hit ? 'BOOKED' : 'FREE',
      // Nur bei Projekt-Opt-in: Namen für anonyme Betrachter maskieren (§E5-Revision).
      userName: requesterId === null && maskNames ? maskName(rawName) : rawName,
      isMine: requesterId !== null && hit?.userId === requesterId,
    });
  }
  return grid;
}
