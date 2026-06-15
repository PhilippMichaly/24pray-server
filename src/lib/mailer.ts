import nodemailer from 'nodemailer';

export interface Mailer {
  sendMagicLink(email: string, url: string): Promise<void>;
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
  };
}
