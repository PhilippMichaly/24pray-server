import { describe, it, expect } from 'vitest';
import { buildSlotGrid, maskName } from './slotGrid.js';

const REQ = 'requester-1';

describe('buildSlotGrid', () => {
  it('produces slots of slotDurationMinutes across the range', () => {
    const start = new Date('2026-06-15T00:00:00.000Z');
    const end = new Date('2026-06-15T03:00:00.000Z');
    const grid = buildSlotGrid(start, end, [], REQ, 60);
    expect(grid).toHaveLength(3);
    expect(grid[0]).toEqual({
      slotId: null,
      startTime: '2026-06-15T00:00:00.000Z',
      endTime: '2026-06-15T01:00:00.000Z',
      status: 'FREE',
      userName: null,
      isMine: false,
    });
  });

  it('honours a non-60 slotDurationMinutes (30 → 6 slots über 3h)', () => {
    const start = new Date('2026-06-15T00:00:00.000Z');
    const end = new Date('2026-06-15T03:00:00.000Z');
    const grid = buildSlotGrid(start, end, [], REQ, 30);
    expect(grid).toHaveLength(6);
    expect(grid[0].endTime).toBe('2026-06-15T00:30:00.000Z');
  });

  it('marks booked slots with slotId, booker name and isMine', () => {
    const start = new Date('2026-06-15T00:00:00.000Z');
    const end = new Date('2026-06-15T02:00:00.000Z');
    const grid = buildSlotGrid(
      start,
      end,
      [{ id: 'slot-x', userId: REQ, startTime: new Date('2026-06-15T01:00:00.000Z'), userName: 'Alice', guestName: null }],
      REQ,
      60,
    );
    expect(grid[0].status).toBe('FREE');
    expect(grid[1].status).toBe('BOOKED');
    expect(grid[1].slotId).toBe('slot-x');
    expect(grid[1].userName).toBe('Alice');
    expect(grid[1].isMine).toBe(true);
  });

  it('isMine=false for another user; requesterId=null masks the name (§E5)', () => {
    const start = new Date('2026-06-15T00:00:00.000Z');
    const end = new Date('2026-06-15T01:00:00.000Z');
    const booked = [
      { id: 's', userId: 'someone-else', startTime: start, userName: 'Ruth Klein', guestName: null },
    ];
    const asOther = buildSlotGrid(start, end, booked, REQ, 60);
    expect(asOther[0].isMine).toBe(false);
    expect(asOther[0].userName).toBe('Ruth Klein'); // eingeloggt: voller Name

    const asAnon = buildSlotGrid(start, end, booked, null, 60);
    expect(asAnon[0].userName).toBe('Ruth K.'); // anonym: maskiert
    expect(asAnon[0].isMine).toBe(false);
  });
});

describe('maskName', () => {
  it('Vorname + Initial', () => {
    expect(maskName('Ruth Klein')).toBe('Ruth K.');
    expect(maskName('Anna Maria Schmidt')).toBe('Anna S.');
    expect(maskName('Cher')).toBe('Cher');
    expect(maskName(null)).toBe(null);
  });
});
