'use strict';
const cron = require('node-cron');
const db = require('./db.cjs');
const { sendPaymentReminder } = require('./email.cjs');

let task = null;

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
    console.log(`Alert run: ${sent}/${pending.length} sent`);
    return { processed: pending.length, sent };
  } catch (err) {
    console.error('Alert processing error:', err.message);
    return { processed: 0, sent: 0, error: err.message };
  }
}

function startAlertService() {
  // Run every 6 hours
  task = cron.schedule('0 */6 * * *', processAlerts);
  console.log('Alert service started (runs every 6 hours)');
}

function stopAlertService() {
  if (task) { task.destroy(); task = null; }
}

module.exports = { startAlertService, stopAlertService, processAlerts };
