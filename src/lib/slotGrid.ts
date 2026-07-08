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
): SlotView[] {
  const slotMs = slotLengthMs(slotDurationMinutes);
  const byStart = new Map<number, BookedSlotInput>();
  for (const b of booked) byStart.set(b.startTime.getTime(), b);

  const grid: SlotView[] = [];
  for (let t = start.getTime(); t + slotMs <= end.getTime(); t += slotMs) {
    const hit = byStart.get(t);
    const rawName = hit ? hit.userName ?? hit.guestName ?? null : null;
    grid.push({
      slotId: hit ? hit.id : null,
      startTime: new Date(t).toISOString(),
      endTime: new Date(t + slotMs).toISOString(),
      status: hit ? 'BOOKED' : 'FREE',
      // Für anonyme Betrachter (requesterId == null) Namen maskieren (§E5).
      userName: requesterId === null ? maskName(rawName) : rawName,
      isMine: requesterId !== null && hit?.userId === requesterId,
    });
  }
  return grid;
}
