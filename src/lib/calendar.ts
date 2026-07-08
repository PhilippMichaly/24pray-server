/** Kalender-Helfer: .ics-Datei + Google-Calendar-Link für eine Gebetsstunde. */

export interface CalendarEvent {
  uid: string; // Slot-ID — stabil, damit Re-Import denselben Eintrag aktualisiert
  title: string;
  startTime: Date;
  endTime: Date;
  url?: string; // Link zur Kette
}

/** UTC-Format für ICS/Google: 20260620T020000Z */
export function icsDate(d: Date): string {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

function escapeIcs(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\n/g, '\\n');
}

export function buildIcs(ev: CalendarEvent): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//24pray//DE',
    'BEGIN:VEVENT',
    `UID:${ev.uid}@24pray.org`,
    `DTSTAMP:${icsDate(ev.startTime)}`,
    `DTSTART:${icsDate(ev.startTime)}`,
    `DTEND:${icsDate(ev.endTime)}`,
    `SUMMARY:${escapeIcs(ev.title)}`,
    ...(ev.url ? [`URL:${ev.url}`, `DESCRIPTION:${escapeIcs(`Zur Gebetswache: ${ev.url}`)}`] : []),
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
}

export function googleCalendarUrl(ev: CalendarEvent): string {
  const p = new URLSearchParams({
    action: 'TEMPLATE',
    text: ev.title,
    dates: `${icsDate(ev.startTime)}/${icsDate(ev.endTime)}`,
    ...(ev.url ? { details: `Zur Gebetswache: ${ev.url}` } : {}),
  });
  return `https://calendar.google.com/calendar/render?${p.toString()}`;
}
