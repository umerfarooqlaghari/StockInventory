'use strict';
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
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
  try {
    const msgBody = { Text: { Data: textBody, Charset: 'UTF-8' } };
    if (htmlBody) msgBody.Html = { Data: htmlBody, Charset: 'UTF-8' };
    const cmd = new SendEmailCommand({
      Source: FROM_EMAIL,
      Destination: { ToAddresses: [to] },
      Message: { Subject: { Data: subject, Charset: 'UTF-8' }, Body: msgBody },
    });
    await ses.send(cmd);
    return true;
  } catch (err) {
    console.error('SES error:', err.message);
    return false;
  }
}

module.exports = {
  sendPaymentReminder,
  sendEmail,
  DEFAULT_SUBJECT_TEMPLATE,
  DEFAULT_BODY_TEMPLATE,
};
