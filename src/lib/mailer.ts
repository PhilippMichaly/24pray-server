import nodemailer from 'nodemailer';

export interface ReminderMail {
  name: string;
  projectTitle: string;
  startTime: string; // ISO
  timezone: string;
  icsUrl?: string; // Kalendereintrag (.ics)
  googleUrl?: string; // Google-Calendar-Link
}

export interface BookingMail {
  name: string;
  projectTitle: string;
  startTime: string; // ISO
  timezone: string;
  icsUrl: string;
  googleUrl: string;
}

export interface Mailer {
  sendMagicLink(email: string, url: string, code?: string): Promise<void>;
  sendReminder?(email: string, reminder: ReminderMail): Promise<void>;
  sendBookingConfirmation?(email: string, booking: BookingMail): Promise<void>;
}

function formatReminderTime(r: ReminderMail): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: r.timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(r.startTime));
}

/** Kalender-Absatz (Text+HTML) für Mails — Google-Link + .ics-Download. */
function calendarBlock(googleUrl?: string, icsUrl?: string): { text: string; html: string } {
  if (!googleUrl && !icsUrl) return { text: '', html: '' };
  const text = `\n\nIn den Kalender eintragen:${googleUrl ? `\n  Google Kalender: ${googleUrl}` : ''}${icsUrl ? `\n  Andere Kalender (.ics): ${icsUrl}` : ''}`;
  const html = `<p>In den Kalender eintragen:${googleUrl ? ` <a href="${googleUrl}">Google&nbsp;Kalender</a>` : ''}${googleUrl && icsUrl ? ' · ' : ''}${icsUrl ? `<a href="${icsUrl}">Andere Kalender (.ics)</a>` : ''}</p>`;
  return { text, html };
}

export interface MailerConfig {
  smtpUrl: string;
  from: string;
}

export function createMailer(config: MailerConfig): Mailer {
  if (!config.smtpUrl) {
    return {
      async sendMagicLink(email, url, code) {
        console.log(`[mailer:dev] magic link for ${email}: ${url} (code: ${code})`);
      },
      async sendReminder(email, r) {
        console.log(`[mailer:dev] reminder for ${email}: ${r.projectTitle} @ ${formatReminderTime(r)}`);
      },
      async sendBookingConfirmation(email, b) {
        console.log(`[mailer:dev] booking confirmation for ${email}: ${b.projectTitle} (${b.icsUrl})`);
      },
    };
  }
  const transport = nodemailer.createTransport(config.smtpUrl);
  return {
    async sendMagicLink(email, url, code) {
      const codeText = code
        ? `\n\nOder gib diesen Code auf der Anmeldeseite ein — praktisch, wenn du dich auf einem anderen Gerät anmelden willst (z. B. am PC, während du diese Mail auf dem Handy liest):\n\n    ${code}\n`
        : '';
      const codeHtml = code
        ? `<p>Oder gib diesen Code auf der Anmeldeseite ein — praktisch, wenn du dich auf einem <strong>anderen Gerät</strong> anmelden willst (z.&nbsp;B. am PC, während du diese Mail auf dem Handy liest):</p><p style="font-size:28px;letter-spacing:6px;font-weight:bold">${code}</p>`
        : '';
      await transport.sendMail({
        from: config.from,
        to: email,
        subject: '24pray — dein Login-Link',
        text: `Klicke zum Einloggen: ${url}${codeText}\nLink und Code sind 15 Minuten gültig und nur einmal verwendbar.`,
        html: `<p>Klicke zum Einloggen: <a href="${url}">${url}</a></p>${codeHtml}<p>Link und Code sind 15 Minuten gültig und nur einmal verwendbar.</p>`,
      });
    },
    async sendReminder(email, r) {
      const when = formatReminderTime(r);
      const cal = calendarBlock(r.googleUrl, r.icsUrl);
      await transport.sendMail({
        from: config.from,
        to: email,
        subject: `24pray — deine Gebetsstunde beginnt bald (${r.projectTitle})`,
        text: `${r.name ? r.name + ', ' : ''}deine Stunde in „${r.projectTitle}" beginnt ${when} (${r.timezone}).${cal.text}`,
        html: `<p>${r.name ? r.name + ', ' : ''}deine Stunde in „<strong>${r.projectTitle}</strong>" beginnt <strong>${when}</strong> (${r.timezone}).</p>${cal.html}`,
      });
    },
    async sendBookingConfirmation(email, b) {
      const when = formatReminderTime(b);
      const cal = calendarBlock(b.googleUrl, b.icsUrl);
      await transport.sendMail({
        from: config.from,
        to: email,
        subject: `24pray — deine Gebetsstunde ist eingetragen (${b.projectTitle})`,
        text: `${b.name ? b.name + ', ' : ''}danke! Deine Stunde in „${b.projectTitle}" ist eingetragen: ${when} (${b.timezone}).${cal.text}`,
        html: `<p>${b.name ? b.name + ', ' : ''}danke! Deine Stunde in „<strong>${b.projectTitle}</strong>" ist eingetragen: <strong>${when}</strong> (${b.timezone}).</p>${cal.html}`,
      });
    },
  };
}
