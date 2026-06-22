'use strict';

let twilioModule = null;

function getTwilio() {
  if (!twilioModule) twilioModule = require('twilio');
  return twilioModule;
}

function fmtPkr(n) {
  return Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 });
}

function normalizePhone(raw) {
  let p = String(raw || '').replace(/[\s\-().]/g, '');
  if (!p) return '';
  if (p.startsWith('00')) p = '+' + p.slice(2);
  if (p.startsWith('+')) return p;
  if (p.startsWith('0')) return '+92' + p.slice(1);
  if (p.startsWith('92')) return '+' + p;
  return '+92' + p;
}

function getTwilioClient() {
  const accountSid = process.env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = process.env.TWILIO_AUTH_TOKEN?.trim();
  const apiKeySid = process.env.TWILIO_API_KEY_SID?.trim();
  const apiKeySecret = process.env.TWILIO_API_KEY_SECRET?.trim();

  if (!accountSid) {
    throw new Error('TWILIO_ACCOUNT_SID is missing in .env — copy the AC... value from console.twilio.com (Account Info on the dashboard home page)');
  }
  const twilio = getTwilio();
  if (apiKeySid && apiKeySecret) {
    return twilio(apiKeySid, apiKeySecret, { accountSid });
  }
  if (authToken) {
    return twilio(accountSid, authToken);
  }
  throw new Error('Add TWILIO_AUTH_TOKEN or TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET to .env');
}

function buildDigestText(config, sales) {
  const creditDays = Number(config.CreditDays) || 45;
  const company = config.CompanyName || 'Printing Plates Inventory';
  const today = new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });

  if (!sales.length) {
    return `*${company} — Daily Payment Digest*\n${today}\n\n✅ No pending payments. All invoices are paid or returned.`;
  }

  const rows = sales.map((s) => {
    const days = Math.floor((Date.now() - new Date(s.SaleDate).getTime()) / 86400000);
    const overdue = days > creditDays;
    return {
      invoice: s.InvoiceNumber || '—',
      client: s.ClientName || '—',
      balance: Number(s.Balance || 0),
      days,
      overdue,
    };
  });

  const totalOutstanding = rows.reduce((sum, r) => sum + r.balance, 0);
  const overdueCount = rows.filter((r) => r.overdue).length;

  const lines = [
    `*${company} — Daily Payment Digest*`,
    today,
    '',
    `💰 Total outstanding: PKR ${fmtPkr(totalOutstanding)}`,
    `📋 Pending invoices: ${sales.length}`,
    `⚠️ Overdue (>${creditDays}d): ${overdueCount}`,
    '',
  ];

  const top = rows.slice(0, 8);
  top.forEach((r) => {
    lines.push(`• ${r.invoice} | ${r.client} | PKR ${fmtPkr(r.balance)} | ${r.days}d${r.overdue ? ' *OVERDUE*' : ''}`);
  });

  if (rows.length > 8) {
    lines.push(`…and ${rows.length - 8} more. Open the app for the full list.`);
  }

  lines.push('', '_Stock Inventory Manager_');
  return lines.join('\n').slice(0, 1550);
}

async function sendOwnerWhatsAppDigest(config, sales, phones) {
  const from = process.env.TWILIO_WHATSAPP_FROM || 'whatsapp:+14155238886';
  const recipients = [...new Set(phones.map(normalizePhone).filter(Boolean))];
  if (!recipients.length) return { sent: false, count: 0, errors: ['no phone numbers'] };

  let client;
  try {
    client = getTwilioClient();
  } catch (err) {
    console.error('WhatsApp:', err.message);
    return { sent: false, count: 0, errors: [err.message] };
  }

  const body = buildDigestText(config, sales);
  let count = 0;
  const errors = [];

  for (const phone of recipients) {
    try {
      await client.messages.create({
        from,
        to: `whatsapp:${phone}`,
        body,
      });
      count++;
      console.log(`WhatsApp digest sent to ${phone}`);
    } catch (err) {
      const msg = `${phone}: ${err.message}`;
      console.error('WhatsApp error:', msg);
      errors.push(msg);
    }
  }

  return { sent: count > 0, count, errors };
}

module.exports = {
  sendOwnerWhatsAppDigest,
  buildDigestText,
  normalizePhone,
};
