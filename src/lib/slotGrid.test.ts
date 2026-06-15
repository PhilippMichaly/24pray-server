import { describe, it, expect } from 'vitest';
import { buildSlotGrid } from './slotGrid.js';

describe('buildSlotGrid', () => {
  it('produces 1-hour slots across the range', () => {
    const start = new Date('2026-06-15T00:00:00.000Z');
    const end = new Date('2026-06-15T03:00:00.000Z');
    const grid = buildSlotGrid(start, end, []);
    expect(grid).toHaveLength(3);
    expect(grid[0]).toEqual({
      startTime: '2026-06-15T00:00:00.000Z',
      endTime: '2026-06-15T01:00:00.000Z',
      status: 'FREE',
      userName: null,
    });
  });

  it('marks booked slots with the booker name', () => {
    const start = new Date('2026-06-15T00:00:00.000Z');
    const end = new Date('2026-06-15T02:00:00.000Z');
    const grid = buildSlotGrid(start, end, [
      { startTime: new Date('2026-06-15T01:00:00.000Z'), userName: 'Alice', guestName: null },
    ]);
    expect(grid[0].status).toBe('FREE');
    expect(grid[1].status).toBe('BOOKED');
    expect(grid[1].userName).toBe('Alice');
  });
});
