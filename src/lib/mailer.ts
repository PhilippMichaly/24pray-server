import nodemailer from 'nodemailer';

export interface ReminderMail {
  name: string;
  projectTitle: string;
  startTime: string; // ISO
  timezone: string;
  icsUrl?: string; // Kalendereintrag (.ics)
  googleUrl?: string; // Google-Calendar-Link
  isAllDay?: boolean; // Tages-Wache (slotDurationMinutes=1440): Datum statt Uhrzeit anzeigen
}

export interface BookingMail {
  name: string;
  projectTitle: string;
  startTime: string; // ISO
  timezone: string;
  icsUrl: string;
  googleUrl: string;
  isAllDay?: boolean;
}

/** Owner-Benachrichtigung bei neuer Buchung in der eigenen Kette (Punkt 10). */
export interface BookingNoticeMail {
  projectTitle: string;
  bookerName: string;
  startTime: string; // ISO
  endTime: string; // ISO
  timezone: string;
  isAllDay?: boolean;
}

/** Eine verschobene Stunde für die Zeitplan-Änderungs-Mail. */
export interface ScheduleChangeSlotItem {
  oldStartTime: string; // ISO, vor der Verschiebung
  newStartTime: string; // ISO, nach der Verschiebung
}

/** Wache verschoben (Ersteller-Lebenszyklus): alle künftigen Stunden einer Person in EINER Mail. */
export interface ScheduleChangeMail {
  name: string;
  projectTitle: string;
  oldStartDate: string; // ISO, alter Projekt-Start
  newStartDate: string; // ISO, neuer Projekt-Start
  timezone: string;
  slots: ScheduleChangeSlotItem[];
  projectUrl: string; // zum Freigeben, falls die neue Zeit nicht mehr passt
}

/** Wache gelöscht (Ersteller-Lebenszyklus): Abschieds-Mail an künftige Gebuchte. */
export interface ProjectFarewellMail {
  name: string;
  projectTitle: string;
  timezone: string;
  slots: string[]; // ISO-Starts der betroffenen (nicht mehr stattfindenden) Stunden
}

/** Owner-Update im „Neues"-Tab → Mail an alle Teilnehmer (Backlog 1). */
export interface UpdateNoticeMail {
  projectTitle: string;
  authorName: string;
  text: string; // Update-Text (User-Content — im HTML escapen!)
  projectUrl: string;
  unsubscribeUrl: string;
  locale: string; // de|en|es|he|ar; Unbekanntes → de
}

// Einzige lokalisierte Mail (Entscheidung 2026-07-09): Empfänger-Locale wird seit Backlog 1
// erfasst; die Alt-Mails bleiben vorerst deutsch (separater Backlog-Punkt).
// he/ar: Muttersprachler-Review steht noch aus (Backlog-Merkposten).
const UPDATE_NOTICE_TEXTS: Record<string, {
  subject: (title: string) => string;
  posted: (author: string) => string;
  toWatch: string;
  unsubscribe: string;
  dir: 'ltr' | 'rtl';
}> = {
  de: { subject: (t) => `24pray — Neues aus der Gebetswache (${t})`, posted: (a) => `${a} hat ein Update zum Anliegen gepostet:`, toWatch: 'Zur Gebetswache', unsubscribe: 'Keine Update-Mails mehr für diese Wache', dir: 'ltr' },
  en: { subject: (t) => `24pray — news from the prayer watch (${t})`, posted: (a) => `${a} posted an update on the concern:`, toWatch: 'Open the prayer watch', unsubscribe: 'Stop update emails for this watch', dir: 'ltr' },
  es: { subject: (t) => `24pray — novedades de la vigilia de oración (${t})`, posted: (a) => `${a} publicó una novedad sobre la intención:`, toWatch: 'Ir a la vigilia de oración', unsubscribe: 'No recibir más correos de novedades de esta vigilia', dir: 'ltr' },
  he: { subject: (t) => `24pray — חדש ממשמרת התפילה (${t})`, posted: (a) => `${a} פרסם/ה עדכון על הבקשה:`, toWatch: 'למשמרת התפילה', unsubscribe: 'להפסקת מיילי עדכונים עבור משמרת זו', dir: 'rtl' },
  ar: { subject: (t) => `24pray — جديد من سهرة الصلاة (${t})`, posted: (a) => `نشر ${a} تحديثًا حول الطلب:`, toWatch: 'إلى سهرة الصلاة', unsubscribe: 'إيقاف رسائل التحديثات لهذه السهرة', dir: 'rtl' },
};

/** Minimal-Escaping für User-Content in Mail-HTML (Update-Text, Autor-Name). */
function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface Mailer {
  sendMagicLink(email: string, url: string, code?: string): Promise<void>;
  sendReminder?(email: string, reminder: ReminderMail): Promise<void>;
  sendBookingConfirmation?(email: string, booking: BookingMail): Promise<void>;
  sendBookingNotice?(email: string, notice: BookingNoticeMail): Promise<void>;
  sendScheduleChange?(email: string, change: ScheduleChangeMail): Promise<void>;
  sendProjectFarewell?(email: string, farewell: ProjectFarewellMail): Promise<void>;
  sendUpdateNotice?(email: string, notice: UpdateNoticeMail): Promise<void>;
}

function formatReminderTime(r: { startTime: string; timezone: string; isAllDay?: boolean }): string {
  if (r.isAllDay) {
    // Tages-Wache: kein Uhrzeit-Punkt, sondern das Datum des Tages („Montag, 14. Juli").
    return new Intl.DateTimeFormat('de-DE', {
      timeZone: r.timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    }).format(new Date(r.startTime));
  }
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
      async sendBookingNotice(email, n) {
        console.log(`[mailer:dev] booking notice for ${email}: ${n.bookerName} @ ${n.projectTitle} (${formatReminderTime(n)})`);
      },
      async sendScheduleChange(email, c) {
        console.log(`[mailer:dev] schedule change for ${email}: ${c.projectTitle} (${c.slots.length} slot(s))`);
      },
      async sendProjectFarewell(email, f) {
        console.log(`[mailer:dev] project farewell for ${email}: ${f.projectTitle} (${f.slots.length} slot(s))`);
      },
      async sendUpdateNotice(email, n) {
        console.log(`[mailer:dev] update notice for ${email}: ${n.projectTitle} (${n.locale})`);
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
    async sendBookingNotice(email, n) {
      const when = formatReminderTime(n);
      await transport.sendMail({
        from: config.from,
        to: email,
        subject: `24pray — neue Stunde in deiner Gebetswache (${n.projectTitle})`,
        text: `${n.bookerName} hat eine Stunde in „${n.projectTitle}" übernommen: ${when} (${n.timezone}).`,
        html: `<p><strong>${n.bookerName}</strong> hat eine Stunde in „<strong>${n.projectTitle}</strong>" übernommen: <strong>${when}</strong> (${n.timezone}).</p>`,
      });
    },
    async sendScheduleChange(email, c) {
      const oldWhen = formatReminderTime({ startTime: c.oldStartDate, timezone: c.timezone });
      const newWhen = formatReminderTime({ startTime: c.newStartDate, timezone: c.timezone });
      const rows = c.slots.map((s) => ({
        oldWhen: formatReminderTime({ startTime: s.oldStartTime, timezone: c.timezone }),
        newWhen: formatReminderTime({ startTime: s.newStartTime, timezone: c.timezone }),
      }));
      const hoursText = rows.map((r) => `  ${r.oldWhen} → ${r.newWhen}`).join('\n');
      const hoursHtml = rows.map((r) => `<li>${r.oldWhen} → <strong>${r.newWhen}</strong></li>`).join('');
      await transport.sendMail({
        from: config.from,
        to: email,
        subject: `24pray — Zeitplan geändert (${c.projectTitle})`,
        text: `${c.name ? c.name + ', ' : ''}die Gebetswache „${c.projectTitle}" wurde verschoben: ${oldWhen} → ${newWhen} (${c.timezone}).\n\nDeine Stunden:\n${hoursText}\n\nPasst es nicht mehr? Gib deine Stunde in der Gebetswache frei: ${c.projectUrl}`,
        html: `<p>${c.name ? c.name + ', ' : ''}die Gebetswache „<strong>${c.projectTitle}</strong>" wurde verschoben: ${oldWhen} → <strong>${newWhen}</strong> (${c.timezone}).</p><p>Deine Stunden:</p><ul>${hoursHtml}</ul><p>Passt es nicht mehr? <a href="${c.projectUrl}">Gib deine Stunde in der Gebetswache frei</a>.</p>`,
      });
    },
    async sendProjectFarewell(email, f) {
      const list = f.slots.map((s) => formatReminderTime({ startTime: s, timezone: f.timezone })).join(', ');
      const plural = f.slots.length > 1;
      await transport.sendMail({
        from: config.from,
        to: email,
        subject: `24pray — Gebetswache beendet (${f.projectTitle})`,
        text: `Die Gebetswache „${f.projectTitle}" wurde beendet. Deine Stunde${plural ? `n am ${list} finden` : ` am ${list} findet`} nicht mehr statt. Danke fürs Mitwachen.`,
        html: `<p>Die Gebetswache „<strong>${f.projectTitle}</strong>" wurde beendet. Deine Stunde${plural ? `n am <strong>${list}</strong> finden` : ` am <strong>${list}</strong> findet`} nicht mehr statt. Danke fürs Mitwachen.</p>`,
      });
    },
    async sendUpdateNotice(email, n) {
      const tr = UPDATE_NOTICE_TEXTS[n.locale] ?? UPDATE_NOTICE_TEXTS.de;
      await transport.sendMail({
        from: config.from,
        to: email,
        subject: tr.subject(n.projectTitle),
        text: `${tr.posted(n.authorName)}\n\n${n.text}\n\n${tr.toWatch}: ${n.projectUrl}\n\n${tr.unsubscribe}: ${n.unsubscribeUrl}`,
        html: `<div dir="${tr.dir}"><p>${tr.posted(escapeHtml(n.authorName))}</p>` +
          `<blockquote style="margin:0;padding-inline-start:12px;border-inline-start:3px solid #ccc;white-space:pre-wrap">${escapeHtml(n.text)}</blockquote>` +
          `<p><a href="${n.projectUrl}">${tr.toWatch}</a></p>` +
          `<p style="font-size:12px;color:#888"><a href="${n.unsubscribeUrl}">${tr.unsubscribe}</a></p></div>`,
      });
    },
  };
}
