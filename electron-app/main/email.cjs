'use strict';
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');

const ses = new SESClient({
  region: process.env.AWS_REGION || 'us-east-1',
  credentials: {
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  },
});

const FROM_EMAIL = process.env.SES_FROM_EMAIL || 'info@alpha-devs.cloud';

function renderTemplate(template, vars) {
  return template.replace(/\{(\w+)\}/g, (_, key) => vars[key] ?? `{${key}}`);
}

// Professional HTML email template (populates at runtime with renderTemplate)
const DEFAULT_HTML_TEMPLATE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<style>
  body { margin:0; padding:0; background:#F3F4F6; font-family:Arial,sans-serif; }
  .wrap { max-width:600px; margin:32px auto; background:#fff; border-radius:8px; overflow:hidden; box-shadow:0 2px 8px rgba(0,0,0,.08); }
  .header { background:#1A2B4A; padding:28px 32px; }
  .header h1 { margin:0; color:#fff; font-size:20px; font-weight:700; }
  .header p { margin:4px 0 0; color:rgba(255,255,255,.65); font-size:13px; }
  .body { padding:28px 32px; }
  .greeting { font-size:15px; color:#111827; margin-bottom:16px; }
  .highlight { background:#F0F4FF; border-left:4px solid #1A2B4A; border-radius:4px; padding:16px 20px; margin:20px 0; }
  .highlight table { width:100%; border-collapse:collapse; }
  .highlight td { padding:4px 0; font-size:13px; color:#374151; }
  .highlight td.label { color:#6B7280; width:130px; }
  .highlight td.amount { font-weight:700; font-size:16px; color:#DC2626; }
  .message { font-size:14px; color:#374151; line-height:1.6; margin:16px 0; }
  .cta { text-align:center; margin:24px 0; }
  .cta a { background:#1A2B4A; color:#fff; text-decoration:none; padding:12px 28px; border-radius:6px; font-size:14px; font-weight:600; }
  .footer { background:#F9FAFB; padding:20px 32px; border-top:1px solid #E5E7EB; }
  .footer p { margin:0; font-size:12px; color:#9CA3AF; }
  .company { font-weight:700; color:#1A2B4A; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <h1>{CompanyName}</h1>
    <p>Payment Reminder Notice</p>
  </div>
  <div class="body">
    <p class="greeting">Dear <strong>{ClientName}</strong>,</p>
    <p class="message">
      We hope this message finds you well. This is a courtesy reminder that the following invoice remains outstanding and requires your attention.
    </p>
    <div class="highlight">
      <table>
        <tr><td class="label">Invoice Number</td><td><strong>{InvoiceNumber}</strong></td></tr>
        <tr><td class="label">Invoice Date</td><td>{SaleDate}</td></tr>
        <tr><td class="label">Invoice Total</td><td>PKR {Amount}</td></tr>
        <tr><td class="label">Days Outstanding</td><td><strong>{Days} days</strong></td></tr>
        <tr><td class="label">Balance Due</td><td class="amount">PKR {Balance}</td></tr>
      </table>
    </div>
    <p class="message">
      As per our agreed credit terms, this invoice has now exceeded the standard payment period.
      We kindly request that you arrange payment at your earliest convenience to avoid any disruption to your account.
    </p>
    <p class="message">
      If you have already made the payment or believe there is a discrepancy, please contact us immediately so we can update our records.
    </p>
    <div class="cta">
      <a href="mailto:{SenderEmail}">Contact Us to Resolve</a>
    </div>
  </div>
  <div class="footer">
    <p class="company">{CompanyName}</p>
    <p style="margin-top:4px">This is an automated reminder. Please do not reply to this email — contact us directly using the button above.</p>
  </div>
</div>
</body>
</html>`;

const DEFAULT_SUBJECT_TEMPLATE = 'Payment Reminder — Invoice {InvoiceNumber} | {Days} Days Outstanding';

const DEFAULT_BODY_TEMPLATE = `Dear {ClientName},

This is a payment reminder for Invoice #{InvoiceNumber} dated {SaleDate}.

Invoice Total : PKR {Amount}
Balance Due   : PKR {Balance}
Days Outstanding: {Days} days

Your invoice has exceeded our standard credit period. Please arrange payment at your earliest convenience.

If you have already made the payment, please disregard this message or contact us to reconcile.

Kind regards,
{CompanyName}`;

async function sendPaymentReminder(sale, config) {
  if (!sale.ClientEmail) return false;
  const vars = {
    ClientName:     sale.ClientName || 'Valued Customer',
    InvoiceNumber:  sale.InvoiceNumber || '',
    SaleDate:       sale.SaleDate ? new Date(sale.SaleDate).toLocaleDateString('en-US') : '',
    Amount:         Number(sale.TotalAmount || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 }),
    Balance:        Number(sale.Balance || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 }),
    Days:           Math.floor((Date.now() - new Date(sale.SaleDate).getTime()) / 86400000),
    CompanyName:    config.CompanyName || 'Printing Plates Inventory',
    SenderEmail:    FROM_EMAIL,
  };

  const subject  = renderTemplate(config.EmailSubjectTemplate || DEFAULT_SUBJECT_TEMPLATE, vars);
  const textBody = renderTemplate(config.EmailBodyTemplate    || DEFAULT_BODY_TEMPLATE,    vars);
  const htmlBody = renderTemplate(DEFAULT_HTML_TEMPLATE, vars);

  return sendEmail(sale.ClientEmail, subject, textBody, htmlBody);
}

async function sendEmail(to, subject, textBody, htmlBody) {
  return sendEmailToMany(Array.isArray(to) ? to : [to], subject, textBody, htmlBody);
}

async function sendEmailToMany(recipients, subject, textBody, htmlBody) {
  const addresses = [...new Set((recipients || []).map((e) => String(e).trim()).filter(Boolean))];
  if (!addresses.length) return false;
  try {
    const msgBody = { Text: { Data: textBody, Charset: 'UTF-8' } };
    if (htmlBody) msgBody.Html = { Data: htmlBody, Charset: 'UTF-8' };
    const cmd = new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: {
        ToAddresses: [FROM_EMAIL],
        BccAddresses: addresses,
      },
      Message: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: msgBody },
    });
    await ses.send(cmd);
    return true;
  } catch (err) {
    console.error('SES error:', err.message);
    return false;
  }
}

function fmtPkr(n) {
  return Number(n || 0).toLocaleString('en-PK', { minimumFractionDigits: 2 });
}

function buildOwnerDigestContent(config, sales) {
  const creditDays = Number(config.CreditDays) || 45;
  const company = config.CompanyName || 'Printing Plates Inventory';
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  const rows = sales.map((s) => {
    const days = Math.floor((Date.now() - new Date(s.SaleDate).getTime()) / 86400000);
    const overdue = days > creditDays;
    return {
      invoice: s.InvoiceNumber || '—',
      client: s.ClientName || '—',
      date: s.SaleDate ? new Date(s.SaleDate).toLocaleDateString('en-US') : '—',
      days,
      balance: Number(s.Balance || 0),
      status: s.PaymentStatus || '—',
      overdue,
    };
  });

  const totalOutstanding = rows.reduce((sum, r) => sum + r.balance, 0);
  const overdueCount = rows.filter((r) => r.overdue).length;

  const subject = sales.length
    ? `Daily Payment Digest — ${sales.length} pending invoice${sales.length === 1 ? '' : 's'} | PKR ${fmtPkr(totalOutstanding)} outstanding`
    : `Daily Payment Digest — No pending payments`;

  const textLines = [
    `${company} — Daily Pending Payments Digest`,
    `Report date: ${today}`,
    '',
  ];

  if (!sales.length) {
    textLines.push('There are no unpaid or partially paid invoices at this time.');
  } else {
    textLines.push(`Total outstanding: PKR ${fmtPkr(totalOutstanding)}`);
    textLines.push(`Pending invoices: ${sales.length}`);
    textLines.push(`Overdue (>${creditDays} days): ${overdueCount}`);
    textLines.push('');
    textLines.push('Invoice\tClient\tDate\tDays\tBalance\tStatus');
    rows.forEach((r) => {
      textLines.push(`${r.invoice}\t${r.client}\t${r.date}\t${r.days}\tPKR ${fmtPkr(r.balance)}\t${r.status}${r.overdue ? ' (OVERDUE)' : ''}`);
    });
  }

  textLines.push('', '—', 'Automated daily summary from Stock Inventory Manager');

  const tableRows = rows.length
    ? rows.map((r) => `
        <tr style="background:${r.overdue ? '#FEF2F2' : '#fff'}">
          <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;font-family:monospace;font-size:12px">${r.invoice}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;font-size:12px">${r.client}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;font-size:12px">${r.date}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;font-size:12px;text-align:center">${r.days}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;font-size:12px;text-align:right;font-weight:700;color:#DC2626">PKR ${fmtPkr(r.balance)}</td>
          <td style="padding:8px 10px;border-bottom:1px solid #E5E7EB;font-size:12px">${r.status}${r.overdue ? ' <span style="color:#DC2626;font-weight:700">OVERDUE</span>' : ''}</td>
        </tr>`).join('')
    : '';

  const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head>
<body style="margin:0;padding:0;background:#F3F4F6;font-family:Arial,sans-serif">
  <div style="max-width:720px;margin:32px auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)">
    <div style="background:#1A2B4A;padding:24px 28px">
      <h1 style="margin:0;color:#fff;font-size:20px">${company}</h1>
      <p style="margin:6px 0 0;color:rgba(255,255,255,.7);font-size:13px">Daily Pending Payments Digest · ${today}</p>
    </div>
    <div style="padding:24px 28px">
      ${sales.length ? `
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <div style="flex:1;min-width:140px;background:#F0F4FF;border-radius:8px;padding:14px 16px">
          <div style="font-size:11px;color:#6B7280;font-weight:600;text-transform:uppercase">Total Outstanding</div>
          <div style="font-size:20px;font-weight:700;color:#DC2626;margin-top:4px">PKR ${fmtPkr(totalOutstanding)}</div>
        </div>
        <div style="flex:1;min-width:120px;background:#F9FAFB;border-radius:8px;padding:14px 16px">
          <div style="font-size:11px;color:#6B7280;font-weight:600;text-transform:uppercase">Pending Invoices</div>
          <div style="font-size:20px;font-weight:700;color:#1A2B4A;margin-top:4px">${sales.length}</div>
        </div>
        <div style="flex:1;min-width:120px;background:#FEF2F2;border-radius:8px;padding:14px 16px">
          <div style="font-size:11px;color:#6B7280;font-weight:600;text-transform:uppercase">Overdue (&gt;${creditDays}d)</div>
          <div style="font-size:20px;font-weight:700;color:#DC2626;margin-top:4px">${overdueCount}</div>
        </div>
      </div>
      <table style="width:100%;border-collapse:collapse;border:1px solid #E5E7EB;border-radius:6px;overflow:hidden">
        <thead>
          <tr style="background:#F9FAFB">
            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6B7280">Invoice</th>
            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6B7280">Client</th>
            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6B7280">Date</th>
            <th style="padding:8px 10px;text-align:center;font-size:11px;color:#6B7280">Days</th>
            <th style="padding:8px 10px;text-align:right;font-size:11px;color:#6B7280">Balance</th>
            <th style="padding:8px 10px;text-align:left;font-size:11px;color:#6B7280">Status</th>
          </tr>
        </thead>
        <tbody>${tableRows}</tbody>
      </table>` : `
      <div style="background:#F0FDF4;border:1px solid #BBF7D0;border-radius:8px;padding:20px 24px;text-align:center">
        <p style="margin:0;font-size:16px;font-weight:700;color:#16A34A">✓ No pending payments</p>
        <p style="margin:8px 0 0;font-size:13px;color:#374151">All invoices are fully paid or returned. Nothing requires follow-up today.</p>
      </div>`}
    </div>
    <div style="background:#F9FAFB;padding:16px 28px;border-top:1px solid #E5E7EB">
      <p style="margin:0;font-size:11px;color:#9CA3AF">Automated daily summary from Stock Inventory Manager</p>
    </div>
  </div>
</body>
</html>`;

  return { subject, textBody: textLines.join('\n'), htmlBody, totalOutstanding, count: sales.length };
}

async function sendOwnerDailyDigest(config, sales, recipients) {
  const { subject, textBody, htmlBody } = buildOwnerDigestContent(config, sales);
  return sendEmailToMany(recipients, subject, textBody, htmlBody);
}

module.exports = {
  sendPaymentReminder,
  sendEmail,
  sendEmailToMany,
  sendOwnerDailyDigest,
  buildOwnerDigestContent,
  DEFAULT_SUBJECT_TEMPLATE,
  DEFAULT_BODY_TEMPLATE,
};
