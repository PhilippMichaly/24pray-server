export interface SlotView {
  startTime: string;
  endTime: string;
  status: 'FREE' | 'BOOKED';
  userName: string | null;
}

export interface BookedSlotInput {
  startTime: Date;
  userName: string | null;
  guestName: string | null;
}

const SLOT_MS = 60 * 60 * 1000;

export function buildSlotGrid(start: Date, end: Date, booked: BookedSlotInput[]): SlotView[] {
  const byStart = new Map<number, BookedSlotInput>();
  for (const b of booked) byStart.set(b.startTime.getTime(), b);

  const grid: SlotView[] = [];
  for (let t = start.getTime(); t + SLOT_MS <= end.getTime(); t += SLOT_MS) {
    const hit = byStart.get(t);
    grid.push({
      startTime: new Date(t).toISOString(),
      endTime: new Date(t + SLOT_MS).toISOString(),
      status: hit ? 'BOOKED' : 'FREE',
      userName: hit ? hit.userName ?? hit.guestName ?? null : null,
    });
  }
  return grid;
}

export const SLOT_LENGTH_MS = SLOT_MS;
