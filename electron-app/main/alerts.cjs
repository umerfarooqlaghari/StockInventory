'use strict';
const cron = require('node-cron');
const db = require('./db.cjs');
const { sendPaymentReminder, sendOwnerDailyDigest } = require('./email.cjs');
const { sendOwnerWhatsAppDigest } = require('./whatsapp.cjs');

let clientTask = null;
let ownerTask = null;

function sameCalendarDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

async function processAlerts() {
  try {
    const config = await db.getConfig();
    const pending = await db.getPendingAlerts(config.AlertDays);
    let sent = 0;
    for (const sale of pending) {
      const ok = await sendPaymentReminder(sale, config);
      if (ok) {
        await db.markAlertSent(sale._id.toString());
        sent++;
      }
    }
    console.log(`Client alert run: ${sent}/${pending.length} sent`);
    return { processed: pending.length, sent };
  } catch (err) {
    console.error('Alert processing error:', err.message);
    return { processed: 0, sent: 0, error: err.message };
  }
}

async function processOwnerDailyDigest({ force = false } = {}) {
  try {
    const config = await db.getConfig();
    const emails = (config.OwnerEmails || []).map((e) => String(e).trim()).filter(Boolean);
    const phones = (config.OwnerWhatsAppNumbers || []).map((p) => String(p).trim()).filter(Boolean);

    const sendEmail = force ? emails.length > 0 : config.OwnerDailyReminderEnabled && emails.length > 0;
    const sendWhatsApp = force ? phones.length > 0 : config.OwnerWhatsAppReminderEnabled && phones.length > 0;

    if (!sendEmail && !sendWhatsApp) {
      const reason = emails.length === 0 && phones.length === 0
        ? 'Add at least one notification email or WhatsApp number in Settings'
        : 'Enable email or WhatsApp digest, or add recipients and save settings';
      return { skipped: true, reason };
    }

    if (!force && config.OwnerLastDigestSentAt) {
      const last = new Date(config.OwnerLastDigestSentAt);
      if (sameCalendarDay(last, new Date())) {
        return { skipped: true, reason: 'already sent today' };
      }
    }

    const sales = await db.getPendingPaymentSales();
    let emailOk = false;
    let whatsappResult = { sent: false, count: 0, errors: [] };

    if (sendEmail) {
      emailOk = await sendOwnerDailyDigest(config, sales, emails);
      if (emailOk) console.log(`Owner email digest sent to ${emails.length} recipient(s)`);
      else console.error('Owner email digest failed');
    }

    if (sendWhatsApp) {
      whatsappResult = await sendOwnerWhatsAppDigest(config, sales, phones);
      if (whatsappResult.sent) console.log(`Owner WhatsApp digest sent to ${whatsappResult.count} number(s)`);
      else console.error('Owner WhatsApp digest failed:', whatsappResult.errors.join('; '));
    }

    const sent = emailOk || whatsappResult.sent;
    if (sent) {
      await db.markOwnerDigestSent();
      console.log(`Owner digest complete — ${sales.length} pending invoice(s)`);
    }

    return {
      sent,
      emailSent: emailOk,
      whatsappSent: whatsappResult.sent,
      recipients: emails.length,
      whatsappCount: whatsappResult.count,
      whatsappErrors: whatsappResult.errors,
      invoiceCount: sales.length,
      forced: force,
    };
  } catch (err) {
    console.error('Owner digest error:', err.message);
    return { sent: false, error: err.message };
  }
}

function startAlertService() {
  clientTask = cron.schedule('0 */6 * * *', processAlerts);
  ownerTask = cron.schedule('0 9 * * *', () => processOwnerDailyDigest());
  console.log('Alert service started (client reminders every 6h, owner digest daily at 9:00 AM)');
}

function stopAlertService() {
  if (clientTask) { clientTask.destroy(); clientTask = null; }
  if (ownerTask) { ownerTask.destroy(); ownerTask = null; }
}

module.exports = {
  startAlertService,
  stopAlertService,
  processAlerts,
  processOwnerDailyDigest,
};
