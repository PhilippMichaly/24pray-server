import { describe, it, expect } from 'vitest';
import { buildIcs, googleCalendarUrl } from './calendar.js';

describe('calendar — Stunden-Slot (Standard)', () => {
  const ev = {
    uid: 'slot-1',
    title: 'Gebetsstunde — Nachtwache',
    startTime: new Date('2026-07-14T02:00:00.000Z'),
    endTime: new Date('2026-07-14T03:00:00.000Z'),
    url: 'https://24pray.org/projects/p1',
  };

  it('buildIcs erzeugt einen Uhrzeit-Termin (DTSTART/DTEND ohne VALUE=DATE)', () => {
    const ics = buildIcs(ev);
    expect(ics).toContain('DTSTART:20260714T020000Z');
    expect(ics).toContain('DTEND:20260714T030000Z');
    expect(ics).not.toContain('VALUE=DATE');
  });

  it('googleCalendarUrl nutzt volle Zeitstempel im dates-Parameter', () => {
    const url = googleCalendarUrl(ev);
    const dates = new URL(url).searchParams.get('dates');
    expect(dates).toBe('20260714T020000Z/20260714T030000Z');
  });
});

describe('calendar — Tages-Slot (allDay, slotDurationMinutes=1440)', () => {
  // Start 14:00 Europe/Berlin (Sommerzeit = UTC+2) am 14.7., Ende 24h später am 15.7.
  const ev = {
    uid: 'slot-day-1',
    title: 'Gebetstag — 3-Wochen-Wache',
    startTime: new Date('2026-07-14T12:00:00.000Z'), // 14:00 Berlin
    endTime: new Date('2026-07-15T12:00:00.000Z'), // 14:00 Berlin, Folgetag
    url: 'https://24pray.org/projects/p2',
    allDay: true,
    timezone: 'Europe/Berlin',
  };

  it('buildIcs erzeugt einen Ganztagestermin (DTSTART/DTEND;VALUE=DATE, Ende=Folgetag)', () => {
    const ics = buildIcs(ev);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260714');
    expect(ics).toContain('DTEND;VALUE=DATE:20260715');
    expect(ics).not.toContain('DTSTART:2026'); // kein Uhrzeit-DTSTART parallel
  });

  it('DTSTAMP bleibt ein voller UTC-Zeitstempel (RFC 5545 verlangt das immer)', () => {
    const ics = buildIcs(ev);
    expect(ics).toContain('DTSTAMP:20260714T120000Z');
  });

  it('googleCalendarUrl nutzt reine Kalendertage (YYYYMMDD) ohne Uhrzeit/Z', () => {
    const url = googleCalendarUrl(ev);
    const dates = new URL(url).searchParams.get('dates');
    expect(dates).toBe('20260714/20260715');
  });

  it('respektiert die Projekt-Zeitzone bei der Tagesgrenze (nicht UTC-Kalendertag)', () => {
    // 23:30 Europe/Berlin (Sommerzeit) am 14.7. == 21:30 UTC — UTC-Tag wäre noch der 14.,
    // aber knapp vor Mitternacht Berlin; Ende 24h später ebenso in Berlin-Tagesgrenze.
    const lateEv = {
      ...ev,
      startTime: new Date('2026-07-14T21:30:00.000Z'), // 23:30 Berlin, 14.7.
      endTime: new Date('2026-07-15T21:30:00.000Z'), // 23:30 Berlin, 15.7.
    };
    const ics = buildIcs(lateEv);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260714');
    expect(ics).toContain('DTEND;VALUE=DATE:20260715');
  });

  it('fällt ohne timezone auf UTC-Kalendertage zurück', () => {
    const { timezone: _tz, ...noTz } = ev;
    void _tz;
    const ics = buildIcs(noTz);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260714');
  });
});
