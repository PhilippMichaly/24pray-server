import { describe, it, expect, vi } from 'vitest';
import { createMailer, escapeHtml } from './mailer.js';
import nodemailer from 'nodemailer';

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

describe('Backlog 4 — Einladungs-Absatz in der Bestätigungsmail', () => {
  it('Dev-Mailer akzeptiert projectUrl im BookingMail (Typ-/Smoke-Test)', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mailer = createMailer({ smtpUrl: '', from: 'a@b' });
    await mailer.sendBookingConfirmation!('un4-x@example.com', {
      name: 'Maria', projectTitle: 'Wache', startTime: new Date().toISOString(),
      timezone: 'Europe/Berlin', icsUrl: 'http://x/ics', googleUrl: 'http://x/g',
      projectUrl: 'https://24pray.org/projects/p1',
    });
    expect(spy.mock.calls.flat().join(' ')).toContain('un4-x@example.com');
    spy.mockRestore();
  });
});

describe('sendUpdateNotice (Backlog 1)', () => {
  it('Dev-Mailer loggt Empfänger, Titel und Locale', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mailer = createMailer({ smtpUrl: '', from: 'a@b' });
    await mailer.sendUpdateNotice!('un1-x@y.z', {
      projectTitle: 'Wache Lena', authorName: 'Ruth', text: 'Es geht ihr besser!',
      projectUrl: 'http://app/projects/p1', unsubscribeUrl: 'http://app/api/unsub', locale: 'en',
    });
    const logged = spy.mock.calls.flat().join(' ');
    expect(logged).toContain('un1-x@y.z');
    expect(logged).toContain('Wache Lena');
    expect(logged).toContain('en');
    spy.mockRestore();
  });
});

describe('sendFeedback (User-Zusatzpunkt)', () => {
  it('Dev-Mailer loggt Empfänger', async () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const mailer = createMailer({ smtpUrl: '', from: 'a@b' });
    await mailer.sendFeedback!('un9-owner@example.com', { message: 'Testfeedback', replyTo: 'x@y.zz' });
    expect(spy.mock.calls.flat().join(' ')).toContain('un9-owner@example.com');
    spy.mockRestore();
  });
});

describe('HTML-Escaping in Mail-Templates (Security)', () => {
  const EVIL = '<a href="https://evil">x</a>';
  const ESCAPED = '&lt;a href=&quot;https://evil&quot;&gt;';

  function setup() {
    const sendMail = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    const mailer = createMailer({ smtpUrl: 'smtp://fake', from: 'no-reply@24pray.org' });
    return { mailer, sendMail };
  }
  const sent = (sendMail: ReturnType<typeof vi.fn>) => sendMail.mock.calls[0][0] as { html: string; text: string };

  function expectEscaped(m: { html: string; text: string }) {
    expect(m.html).toContain(ESCAPED);
    expect(m.html).not.toContain('<a href="https://evil"');
    expect(m.text).toContain(EVIL); // text bleibt roh
  }

  it('escaped Nutzerwerte in Reminder, Bestätigung, Owner-Notice und Storno-Mails', async () => {
    const base = { startTime: '2026-07-14T02:00:00.000Z', timezone: 'UTC' };
    {
      const { mailer, sendMail } = setup();
      await mailer.sendReminder!('a@b', { ...base, name: EVIL, projectTitle: EVIL });
      expectEscaped(sent(sendMail));
    }
    {
      const { mailer, sendMail } = setup();
      await mailer.sendBookingConfirmation!('a@b', { ...base, name: EVIL, projectTitle: EVIL, icsUrl: 'http://x/i', googleUrl: 'http://x/g' });
      expectEscaped(sent(sendMail));
    }
    {
      const { mailer, sendMail } = setup();
      await mailer.sendBookingNotice!('a@b', { ...base, bookerName: EVIL, projectTitle: EVIL, endTime: '2026-07-14T03:00:00.000Z' });
      expectEscaped(sent(sendMail));
    }
    {
      const { mailer, sendMail } = setup();
      await mailer.sendScheduleChange!('a@b', {
        name: EVIL, projectTitle: EVIL, oldStartDate: base.startTime, newStartDate: base.startTime, timezone: 'UTC',
        slots: [{ oldStartTime: base.startTime, newStartTime: base.startTime }], projectUrl: 'http://x/p',
      });
      expectEscaped(sent(sendMail));
    }
    {
      const { mailer, sendMail } = setup();
      await mailer.sendProjectFarewell!('a@b', { name: EVIL, projectTitle: EVIL, timezone: 'UTC', slots: [base.startTime] });
      expectEscaped(sent(sendMail));
    }
  });

  it('URLs landen escaped (& als &amp;, Quotes neutralisiert) im href', async () => {
    const { mailer, sendMail } = setup();
    await mailer.sendBookingConfirmation!('a@b', {
      name: 'A', projectTitle: 'T', startTime: '2026-07-14T02:00:00.000Z', timezone: 'UTC',
      icsUrl: 'http://x/i.ics?a=1&b=2',
      googleUrl: 'https://calendar.google.com/render?action=TEMPLATE&text=T&dates=1',
      projectUrl: 'http://x/p?invite=1&x="><script>',
    });
    const { html } = sent(sendMail);
    expect(html).toContain('href="https://calendar.google.com/render?action=TEMPLATE&amp;text=T&amp;dates=1"');
    expect(html).toContain('href="http://x/i.ics?a=1&amp;b=2"');
    expect(html).not.toContain('<script>');
  });

  it('Magic-Link: URL und Code escaped', async () => {
    const { mailer, sendMail } = setup();
    await mailer.sendMagicLink('a@b', 'http://x/v?t=1&u=2', '<b>1</b>');
    const { html } = sent(sendMail);
    expect(html).toContain('href="http://x/v?t=1&amp;u=2"');
    expect(html).toContain('&lt;b&gt;1&lt;/b&gt;');
  });

  it('Update-Notice, Feedback, Admin-Notice: kein Doppel-Escaping', async () => {
    {
      const { mailer, sendMail } = setup();
      await mailer.sendUpdateNotice!('a@b', {
        projectTitle: 'T', authorName: 'A&B', text: 'x<y', projectUrl: 'http://x/p?a=1&b=2', unsubscribeUrl: 'http://x/u?a=1&b=2', locale: 'de',
      });
      const { html } = sent(sendMail);
      expect(html).toContain('A&amp;B hat ein Update');
      expect(html).toContain('x&lt;y');
      expect(html).toContain('href="http://x/p?a=1&amp;b=2"');
      expect(html).not.toContain('&amp;amp;');
    }
    {
      const { mailer, sendMail } = setup();
      await mailer.sendFeedback!('o@b', { message: 'a&b', page: '/x?a=1&b=2' });
      expect(sent(sendMail).html).toContain('a&amp;b');
      expect(sent(sendMail).html).not.toContain('&amp;amp;');
    }
    {
      const { mailer, sendMail } = setup();
      await mailer.sendAdminNotice!('o@b', { kind: 'user_activated', name: EVIL, email: 'a@b', locale: 'de' });
      expect(sent(sendMail).html).toContain(ESCAPED);
      expect(sent(sendMail).html).not.toContain('&amp;lt;');
    }
  });

  it('escapeHtml escaped auch einfache Anführungszeichen', () => {
    expect(escapeHtml(`'`)).toBe('&#39;');
  });
});

describe('Tages-Wachen: Mails sprechen von Tagen, nicht von Stunden', () => {
  function setup() {
    const sendMail = vi.fn().mockResolvedValue(undefined);
    vi.spyOn(nodemailer, 'createTransport').mockReturnValue({ sendMail } as never);
    const mailer = createMailer({ smtpUrl: 'smtp://fake', from: 'no-reply@24pray.org' });
    return { mailer, sendMail };
  }
  const sent = (sendMail: ReturnType<typeof vi.fn>) =>
    sendMail.mock.calls[0][0] as { subject: string; html: string; text: string };
  const all = (m: { subject: string; html: string; text: string }) => `${m.subject}\n${m.text}\n${m.html}`;
  const base = { startTime: '2026-07-14T02:00:00.000Z', timezone: 'UTC', projectTitle: 'Fastenzeit' };

  async function renderAll(isAllDay: boolean) {
    const out: string[] = [];
    {
      const { mailer, sendMail } = setup();
      await mailer.sendReminder!('a@b', { ...base, name: 'Ruth', isAllDay });
      out.push(all(sent(sendMail)));
    }
    {
      const { mailer, sendMail } = setup();
      await mailer.sendBookingConfirmation!('a@b', {
        ...base, name: 'Ruth', isAllDay, icsUrl: 'http://x/i', googleUrl: 'http://x/g', projectUrl: 'http://x/p',
      });
      out.push(all(sent(sendMail)));
    }
    {
      const { mailer, sendMail } = setup();
      await mailer.sendBookingNotice!('a@b', { ...base, bookerName: 'Ruth', endTime: '2026-07-15T02:00:00.000Z', isAllDay });
      out.push(all(sent(sendMail)));
    }
    {
      const { mailer, sendMail } = setup();
      await mailer.sendScheduleChange!('a@b', {
        name: 'Ruth', projectTitle: base.projectTitle, oldStartDate: base.startTime, newStartDate: '2026-07-16T02:00:00.000Z',
        timezone: 'UTC', slots: [{ oldStartTime: base.startTime, newStartTime: '2026-07-16T02:00:00.000Z' }],
        projectUrl: 'http://x/p', isAllDay,
      });
      out.push(all(sent(sendMail)));
    }
    for (const slots of [[base.startTime], [base.startTime, '2026-07-15T02:00:00.000Z']]) {
      const { mailer, sendMail } = setup();
      await mailer.sendProjectFarewell!('a@b', { name: 'Ruth', projectTitle: base.projectTitle, timezone: 'UTC', slots, isAllDay });
      out.push(all(sent(sendMail)));
    }
    return out;
  }

  it('Tages-Wache: keine einzige Mail enthält „Stunde"', async () => {
    for (const mail of await renderAll(true)) {
      expect(mail).not.toMatch(/stunde/i);
      expect(mail).toMatch(/Tag/);
    }
  });

  it('Stunden-Wache: Wording bleibt bei „Stunde"', async () => {
    for (const mail of await renderAll(false)) expect(mail).toMatch(/Stunde/);
  });

  it('Tages-Wache: Zeitplan- und Abschiedsmail zeigen das Datum statt Wochentag+Uhrzeit', async () => {
    const [, , , schedule, farewell] = await renderAll(true);
    expect(schedule).toContain('14. Juli');
    expect(schedule).toContain('16. Juli');
    expect(schedule).not.toContain('02:00');
    expect(farewell).toContain('14. Juli');
    expect(farewell).not.toContain('02:00');
  });

  it('Betreiber-Notiz zur Buchung nennt bei Tages-Wachen den Tag', async () => {
    const { mailer, sendMail } = setup();
    await mailer.sendAdminNotice!('op@b', {
      kind: 'slot_booked', projectTitle: 'Fastenzeit', bookerName: 'Ruth', isGuest: true, isFirstBooking: true,
      startTime: base.startTime, timezone: 'UTC', isAllDay: true, bookedSlots: 1, projectUrl: 'http://x/p',
    });
    const m = all(sent(sendMail));
    expect(m).not.toMatch(/stunde/i);
    expect(m).toContain('ERSTER Tag übernommen');
  });
});
