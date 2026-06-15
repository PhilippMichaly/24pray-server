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
});
