import nodemailer from 'nodemailer';

export interface ReminderMail {
  name: string;
  projectTitle: string;
  startTime: string; // ISO
  timezone: string;
}

export interface Mailer {
  sendMagicLink(email: string, url: string): Promise<void>;
  sendReminder?(email: string, reminder: ReminderMail): Promise<void>;
}

function formatReminderTime(r: ReminderMail): string {
  return new Intl.DateTimeFormat('de-DE', {
    timeZone: r.timezone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(r.startTime));
}

export interface MailerConfig {
  smtpUrl: string;
  from: string;
}

export function createMailer(config: MailerConfig): Mailer {
  if (!config.smtpUrl) {
    return {
      async sendMagicLink(email, url) {
        console.log(`[mailer:dev] magic link for ${email}: ${url}`);
      },
      async sendReminder(email, r) {
        console.log(`[mailer:dev] reminder for ${email}: ${r.projectTitle} @ ${formatReminderTime(r)}`);
      },
    };
  }
  const transport = nodemailer.createTransport(config.smtpUrl);
  return {
    async sendMagicLink(email, url) {
      await transport.sendMail({
        from: config.from,
        to: email,
        subject: '24pray — dein Login-Link',
        text: `Klicke zum Einloggen: ${url}\n\nDer Link ist 15 Minuten gültig.`,
        html: `<p>Klicke zum Einloggen: <a href="${url}">${url}</a></p><p>Der Link ist 15 Minuten gültig.</p>`,
      });
    },
    async sendReminder(email, r) {
      const when = formatReminderTime(r);
      await transport.sendMail({
        from: config.from,
        to: email,
        subject: `24pray — deine Gebetsstunde beginnt bald (${r.projectTitle})`,
        text: `${r.name ? r.name + ', ' : ''}deine Stunde in „${r.projectTitle}" beginnt ${when} (${r.timezone}).`,
        html: `<p>${r.name ? r.name + ', ' : ''}deine Stunde in „<strong>${r.projectTitle}</strong>" beginnt <strong>${when}</strong> (${r.timezone}).</p>`,
      });
    },
  };
}
