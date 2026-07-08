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
