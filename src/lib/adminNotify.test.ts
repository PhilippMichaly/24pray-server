import { describe, it, expect, vi } from 'vitest';
import { notifyAdmin, type AdminNotice } from './adminNotify.js';
import { parseEnv } from '../env.js';
import type { Mailer } from './mailer.js';

const NOTICE: AdminNotice = {
  kind: 'user_activated',
  name: 'an-Neuling',
  email: 'an-neuling@example.com',
  locale: 'de',
};

function envWith(adminTo: string) {
  return parseEnv({ APP_URL: 'http://localhost:3000', ADMIN_NOTIFY_TO: adminTo });
}

/** Mikrotask-Queue leeren — notifyAdmin ist bewusst fire-and-forget (kein await im Aufrufer). */
const flush = () => new Promise((r) => setTimeout(r, 0));

describe('notifyAdmin (Betreiber-Benachrichtigungen)', () => {
  it('ohne ADMIN_NOTIFY_TO wird nichts verschickt (fail-closed wie FEEDBACK_TO)', async () => {
    const sendAdminNotice = vi.fn(async (_to: string, _n: AdminNotice) => {});
    notifyAdmin(
      { env: envWith(''), mailer: { async sendMagicLink() {}, sendAdminNotice } as Mailer },
      NOTICE,
    );
    await flush();
    expect(sendAdminNotice).not.toHaveBeenCalled();
  });

  it('mit ADMIN_NOTIFY_TO geht die Notice an genau diese Adresse', async () => {
    const sendAdminNotice = vi.fn(async (_to: string, _n: AdminNotice) => {});
    notifyAdmin(
      { env: envWith('an-betreiber@example.com'), mailer: { async sendMagicLink() {}, sendAdminNotice } as Mailer },
      NOTICE,
    );
    await flush();
    expect(sendAdminNotice).toHaveBeenCalledTimes(1);
    expect(sendAdminNotice.mock.calls[0][0]).toBe('an-betreiber@example.com');
    expect(sendAdminNotice.mock.calls[0][1]).toEqual(NOTICE);
  });

  it('Mailer ohne sendAdminNotice (Test-Fake, Alt-Deployment) wirft nicht', async () => {
    expect(() =>
      notifyAdmin({ env: envWith('an-betreiber@example.com'), mailer: { async sendMagicLink() {} } }, NOTICE),
    ).not.toThrow();
    await flush();
  });

  it('fehlgeschlagener Versand kippt den Aufrufer nicht, sondern landet im Log', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const sendAdminNotice = vi.fn(async () => {
      throw new Error('an-SMTP tot');
    });
    expect(() =>
      notifyAdmin(
        { env: envWith('an-betreiber@example.com'), mailer: { async sendMagicLink() {}, sendAdminNotice } as Mailer },
        NOTICE,
      ),
    ).not.toThrow();
    await flush();
    expect(spy).toHaveBeenCalled();
    expect(String(spy.mock.calls[0][0])).toContain('user_activated');
    spy.mockRestore();
  });
});
