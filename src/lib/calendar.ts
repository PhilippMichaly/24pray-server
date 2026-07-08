/** Kalender-Helfer: .ics-Datei + Google-Calendar-Link für eine Gebetsstunde. */

export interface CalendarEvent {
  uid: string; // Slot-ID — stabil, damit Re-Import denselben Eintrag aktualisiert
  title: string;
  startTime: Date;
  endTime: Date;
  url?: string; // Link zur Kette
  // Tages-Wache (slotDurationMinutes=1440): als Ganztagestermin darstellen statt Uhrzeit-Termin.
  allDay?: boolean;
  timezone?: string; // nötig für die Ganztages-Datumsgrenzen (Projekt-Zeitzone), Default UTC
}

/** UTC-Format für ICS/Google: 20260620T020000Z */
export function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/** Kalendertag (YYYYMMDD) in einer Ziel-Zeitzone — für VALUE=DATE-Termine (Ganztag). */
function icsAllDayDate(d: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return `${get('year')}${get('month')}${get('day')}`;
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function buildIcs(ev: CalendarEvent): string {
  const tz = ev.timezone ?? 'UTC';
  const dtstart = ev.allDay
    ? `DTSTART;VALUE=DATE:${icsAllDayDate(ev.startTime, tz)}`
    : `DTSTART:${icsDate(ev.startTime)}`;
  // Ganztag: Slot-Ende ist bei 1440-Min-Slots bereits der Folgetag zum Start — passt direkt
  // als (exklusives) DTEND;VALUE=DATE nach RFC 5545.
  const dtend = ev.allDay
    ? `DTEND;VALUE=DATE:${icsAllDayDate(ev.endTime, tz)}`
    : `DTEND:${icsDate(ev.endTime)}`;
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//24pray//DE',
    'BEGIN:VEVENT',
    `UID:${ev.uid}@24pray.org`,
    `DTSTAMP:${icsDate(ev.startTime)}`,
    dtstart,
    dtend,
    `SUMMARY:${escapeIcs(ev.title)}`,
    ...(ev.url ? [`URL:${ev.url}`, `DESCRIPTION:${escapeIcs(`Zur Gebetswache: ${ev.url}`)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export function googleCalendarUrl(ev: CalendarEvent): string {
  const tz = ev.timezone ?? 'UTC';
  const dates = ev.allDay
    ? `${icsAllDayDate(ev.startTime, tz)}/${icsAllDayDate(ev.endTime, tz)}`
    : `${icsDate(ev.startTime)}/${icsDate(ev.endTime)}`;
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates,
    ...(ev.url ? { details: `Zur Gebetswache: ${ev.url}` } : {}),
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
