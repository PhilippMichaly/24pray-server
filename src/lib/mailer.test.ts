import { describe, it, expect, vi } from 'vitest';
import { createMailer } from './mailer.js';

describe('mailer', () => {
  it('logs the link to console when SMTP is not configured', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mailer = createMailer({ smtpUrl: '', from: 'a@b' });
    await mailer.sendMagicLink('user@example.com', 'http://app/verify?token=abc');
    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('http://app/verify?token=abc');
    expect(logged).toContain('user@example.com');
    spy.mockRestore();
  });

  it('sendScheduleChange loggt im Testmodus, wenn SMTP nicht konfiguriert ist', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mailer = createMailer({ smtpUrl: '', from: 'a@b' });
    await mailer.sendScheduleChange!('ruth@example.com', {
      name: 'Ruth',
      projectTitle: 'Nachtwache',
      oldStartDate: '2026-07-10T00:00:00.000Z',
      newStartDate: '2026-07-11T00:00:00.000Z',
      timezone: 'Europe/Berlin',
      slots: [{ oldStartTime: '2026-07-10T02:00:00.000Z', newStartTime: '2026-07-11T02:00:00.000Z' }],
      projectUrl: 'http://app/projects/p1',
    });
    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('ruth@example.com');
    expect(logged).toContain('Nachtwache');
    spy.mockRestore();
  });

  it('sendReminder zeigt Uhrzeit für Stunden-Slots (Standard)', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mailer = createMailer({ smtpUrl: '', from: 'a@b' });
    await mailer.sendReminder!('ruth@example.com', {
      name: 'Ruth',
      projectTitle: 'Nachtwache',
      startTime: '2026-07-14T02:00:00.000Z',
      timezone: 'UTC',
    });
    const logged = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toMatch(/\d{2}:\d{2}/); // Uhrzeit im Format HH:MM enthalten
    spy.mockRestore();
  });

  it('sendReminder zeigt das Datum (kein Uhrzeit-Punkt) für Tages-Slots (isAllDay)', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mailer = createMailer({ smtpUrl: '', from: 'a@b' });
    await mailer.sendReminder!('ruth@example.com', {
      name: 'Ruth',
      projectTitle: '3-Wochen-Wache',
      startTime: '2026-07-14T12:00:00.000Z',
      timezone: 'Europe/Berlin',
      isAllDay: true,
    });
    const logged = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).not.toMatch(/\d{2}:\d{2}/); // keine Uhrzeit
    expect(logged).toContain('Juli'); // Monatsname statt Uhrzeit
    spy.mockRestore();
  });

  it('sendBookingNotice ist tagesbewusst (isAllDay ⇒ Datum statt Uhrzeit)', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mailer = createMailer({ smtpUrl: '', from: 'a@b' });
    await mailer.sendBookingNotice!('organizer@example.com', {
      projectTitle: '3-Wochen-Wache',
      bookerName: 'Ruth',
      startTime: '2026-07-14T12:00:00.000Z',
      endTime: '2026-07-15T12:00:00.000Z',
      timezone: 'Europe/Berlin',
      isAllDay: true,
    });
    const logged = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).not.toMatch(/\d{2}:\d{2}/);
    expect(logged).toContain('Juli');
    spy.mockRestore();
  });

  it('sendProjectFarewell loggt im Testmodus, wenn SMTP nicht konfiguriert ist', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mailer = createMailer({ smtpUrl: '', from: 'a@b' });
    await mailer.sendProjectFarewell!('ruth@example.com', {
      name: 'Ruth',
      projectTitle: 'Nachtwache',
      timezone: 'Europe/Berlin',
      slots: ['2026-07-10T02:00:00.000Z'],
    });
    expect(spy).toHaveBeenCalled();
    const logged = spy.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('ruth@example.com');
    expect(logged).toContain('Nachtwache');
    spy.mockRestore();
  });
});
