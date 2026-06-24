'use strict';
const fs = require('fs');
const PDFDocument = require('pdfkit');

// ── helpers ────────────────────────────────────────────────────────────────────
function t(doc, text, x, y, opts = {}) {
  doc.text(String(text ?? ''), x, y, { lineBreak: false, ...opts });
}

function fmtDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.getFullYear() < 2000 ? '—' : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function fmt(n) {
  return Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function statusColor(status) {
  const map = { Paid: '#16A34A', Partial: '#D97706', Unpaid: '#DC2626', Returned: '#7C3AED' };
  return map[status] || '#6B7280';
}

// ── main ───────────────────────────────────────────────────────────────────────
function generateInvoicePdf(sale, config, logoPath) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margins: { top: 0, left: 0, right: 0, bottom: 0 }, autoFirstPage: true });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end',  () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const PW = doc.page.width;   // 595.28
    const PH = doc.page.height;  // 841.89

    // Palette
    const navy   = '#0F2040';
    const teal   = '#0D9488';
    const red    = '#DC2626';
    const gray   = '#64748B';
    const lgray  = '#F8FAFC';
    const border = '#E2E8F0';
    const black  = '#0F172A';
    const white  = '#FFFFFF';

    const ML = 48;  // left margin
    const MR = 48;  // right margin
    const CW = PW - ML - MR;  // content width

    // ── 1. Header band ──────────────────────────────────────────────────────────
    doc.rect(0, 0, PW, 90).fill(navy);

    let textX = ML;
    const hasLogo = logoPath && fs.existsSync(logoPath);
    if (hasLogo) {
      try {
        doc.image(logoPath, ML, 14, { fit: [62, 62] });
        textX = ML + 72;
      } catch {
        // skip broken logo files
      }
    }

    // Company name
    doc.font('Helvetica-Bold').fontSize(hasLogo ? 18 : 22).fillColor(white)
       .text(config?.CompanyName || 'Printing Plates Inventory', textX, 22, { lineBreak: false });

    // Sub-labels
    const companyMeta = [config?.CompanyPhone, config?.CompanyAddress].filter(Boolean).join('  ·  ');
    if (companyMeta) {
      doc.font('Helvetica').fontSize(9).fillColor('rgba(255,255,255,0.55)')
         .text(companyMeta, textX, 52, { lineBreak: false });
    }

    // "INVOICE" label — top right
    doc.font('Helvetica-Bold').fontSize(26).fillColor('rgba(255,255,255,0.12)')
       .text('INVOICE', PW - 190, 18, { width: 140, align: 'right', lineBreak: false });

    // Teal accent bar below header
    doc.rect(0, 90, PW, 4).fill(teal);

    // ── 2. Info row (Bill To | Invoice Details) ──────────────────────────────────
    const infoY = 112;
    const halfW = CW / 2 - 10;

    // Bill To block
    doc.font('Helvetica-Bold').fontSize(7.5).fillColor(teal)
       .text('BILL TO', ML, infoY, { lineBreak: false });

    doc.font('Helvetica-Bold').fontSize(14).fillColor(black)
       .text(sale.ClientName || '—', ML, infoY + 14, { lineBreak: false });

    let bty = infoY + 32;
    if (sale.ClientPhone) {
      doc.font('Helvetica').fontSize(9.5).fillColor(gray)
         .text(sale.ClientPhone, ML, bty, { lineBreak: false });
      bty += 14;
    }
    if (sale.ClientEmail) {
      doc.font('Helvetica').fontSize(9).fillColor(gray)
         .text(sale.ClientEmail, ML, bty, { lineBreak: false });
    }

    // Invoice Details block (right half)
    const detX = ML + halfW + 20;
    const detW = halfW;

    const detPairs = [
      ['Invoice #',  sale.InvoiceNumber || '—'],
      ['Date',       fmtDate(sale.SaleDate)],
      ['Due Date',   fmtDate(sale.DueDate)],
    ];

    let dety = infoY;
    detPairs.forEach(([label, value]) => {
      doc.font('Helvetica').fontSize(9).fillColor(gray)
         .text(label, detX, dety, { width: 70, align: 'left', lineBreak: false });
      doc.font('Helvetica-Bold').fontSize(9).fillColor(black)
         .text(value, detX + 72, dety, { width: detW - 72, align: 'left', lineBreak: false });
      dety += 16;
    });

    // Status pill
    const sColor = statusColor(sale.PaymentStatus);
    const statusLabel = sale.PaymentStatus || 'Unpaid';
    doc.font('Helvetica').fontSize(9).fillColor(gray)
       .text('Status', detX, dety, { lineBreak: false });
    doc.roundedRect(detX + 72, dety - 2, 60, 16, 4).fill(sColor + '22');
    doc.font('Helvetica-Bold').fontSize(9).fillColor(sColor)
       .text(statusLabel, detX + 72, dety, { width: 60, align: 'center', lineBreak: false });

    // ── 3. Thin divider ─────────────────────────────────────────────────────────
    const divY = Math.max(dety + 22, bty + 22);
    doc.moveTo(ML, divY).lineTo(PW - MR, divY).lineWidth(0.75).strokeColor(border).stroke();

    // ── 4. Items table ──────────────────────────────────────────────────────────
    const TL = divY + 12;

    // Column positions (left edge) and widths
    const C = {
      item:  { x: ML,       w: 145 },
      size:  { x: ML+148,   w: 60  },
      qty:   { x: ML+211,   w: 40  },
      price: { x: ML+254,   w: 90  },
      disc:  { x: ML+347,   w: 80  },
      total: { x: ML+430,   w: CW - 430 },
    };

    // Header band
    doc.rect(ML, TL, CW, 22).fill(navy);
    doc.font('Helvetica-Bold').fontSize(8).fillColor(white);
    t(doc, 'ITEM',       C.item.x + 4,  TL + 7, { width: C.item.w,  align: 'left'  });
    t(doc, 'SIZE',       C.size.x,       TL + 7, { width: C.size.w,  align: 'left'  });
    t(doc, 'QTY',        C.qty.x,        TL + 7, { width: C.qty.w,   align: 'right' });
    t(doc, 'UNIT PRICE', C.price.x,      TL + 7, { width: C.price.w, align: 'right' });
    t(doc, 'DISCOUNT',   C.disc.x,       TL + 7, { width: C.disc.w,  align: 'right' });
    t(doc, 'AMOUNT',     C.total.x,      TL + 7, { width: C.total.w, align: 'right' });

    let iy = TL + 22;
    (sale.Items || []).forEach((item, idx) => {
      const rowH = 22;
      const bg = idx % 2 === 0 ? lgray : white;
      doc.rect(ML, iy, CW, rowH).fill(bg);

      doc.font('Helvetica').fontSize(9).fillColor(black);
      t(doc, item.ItemName || '—',          C.item.x + 4,  iy + 6, { width: C.item.w - 4, align: 'left'  });
      t(doc, item.PlateSize || '—',         C.size.x,      iy + 6, { width: C.size.w,      align: 'left'  });
      t(doc, String(item.Quantity || 0),    C.qty.x,       iy + 6, { width: C.qty.w,       align: 'right' });
      t(doc, fmt(item.UnitPrice),           C.price.x,     iy + 6, { width: C.price.w,     align: 'right' });
      t(doc, fmt(item.DiscountAmount || 0), C.disc.x,      iy + 6, { width: C.disc.w,      align: 'right' });
      doc.font('Helvetica-Bold');
      t(doc, fmt(item.LineTotal),           C.total.x,     iy + 6, { width: C.total.w,     align: 'right' });
      iy += rowH;
    });

    // Bottom border of table
    doc.moveTo(ML, iy).lineTo(PW - MR, iy).lineWidth(0.75).strokeColor(border).stroke();
    iy += 16;

    // ── 5. Totals box ────────────────────────────────────────────────────────────
    const totBoxX = PW - MR - 220;
    const totBoxW = 220;
    const totLW   = 110;
    const totVX   = totBoxX + totLW + 8;
    const totVW   = totBoxW - totLW - 8;
    const totRH   = 17;

    // Left teal accent stripe on totals area
    doc.rect(totBoxX - 4, iy - 4, 3, 4 + 6 * totRH + 36).fill(teal);

    const totRows = [
      { label: 'Subtotal',    value: `PKR ${fmt(sale.Subtotal)}`,       bold: false, lColor: gray,  vColor: black },
      { label: 'Discount',    value: `− PKR ${fmt(sale.OverallDiscount)}`, bold: false, lColor: gray,  vColor: black },
      { label: 'Tax',         value: `PKR ${fmt(sale.TaxAmount)}`,      bold: false, lColor: gray,  vColor: black },
      { label: 'TOTAL',       value: `PKR ${fmt(sale.TotalAmount)}`,    bold: true,  lColor: navy,  vColor: navy,  divBefore: true, larger: true },
      { label: 'Paid',        value: `PKR ${fmt(sale.PaidAmount)}`,     bold: false, lColor: gray,  vColor: '#16A34A' },
      { label: 'BALANCE DUE', value: `PKR ${fmt(sale.Balance)}`,        bold: true,  lColor: red,   vColor: red,   divBefore: true, larger: true },
    ];

    totRows.forEach((r) => {
      if (r.divBefore) {
        doc.moveTo(totBoxX, iy - 4).lineTo(PW - MR, iy - 4)
           .lineWidth(0.5).strokeColor(border).stroke();
        iy += 4;
      }
      const sz = r.larger ? 11 : 9.5;
      doc.font(r.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(sz);
      doc.fillColor(r.lColor)
         .text(r.label, totBoxX, iy, { width: totLW, align: 'right', lineBreak: false });
      doc.fillColor(r.vColor)
         .text(r.value, totVX, iy, { width: totVW, align: 'right', lineBreak: false });
      iy += r.divBefore ? totRH + 2 : totRH;
    });

    // ── 6. Notes ─────────────────────────────────────────────────────────────────
    if (sale.Notes) {
      iy += 20;
      doc.roundedRect(ML, iy, CW, 1, 0).fill(border);
      iy += 10;
      doc.font('Helvetica-Bold').fontSize(8).fillColor(teal)
         .text('NOTES', ML, iy, { lineBreak: false });
      iy += 13;
      doc.font('Helvetica').fontSize(9.5).fillColor(black)
         .text(sale.Notes, ML, iy, { width: CW - 230 });
    }

    // ── 7. Footer ─────────────────────────────────────────────────────────────────
    const FY = PH - 48;
    doc.rect(0, FY, PW, 48).fill(navy);
    // Teal line above footer
    doc.rect(0, FY, PW, 3).fill(teal);

    doc.font('Helvetica-Bold').fontSize(10).fillColor(white)
       .text('Thank you for your business!', ML, FY + 12, { lineBreak: false });

    const footMeta = [config?.CompanyPhone, config?.SesFromEmail || ''].filter(Boolean).join('   ·   ');
    if (footMeta) {
      doc.font('Helvetica').fontSize(8.5).fillColor('rgba(255,255,255,0.55)')
         .text(footMeta, 0, FY + 30, { align: 'center', width: PW, lineBreak: false });
    }

    doc.end();
  });
}

module.exports = { generateInvoicePdf };
