import PDFDocument from 'pdfkit';

export interface InvoiceEmployee {
  name:          string;
  days_attended: number;
  amount:        number;
}

export interface InvoiceData {
  gymName:         string;
  institutionName: string;
  month:           string;          // YYYY-MM
  employees:       InvoiceEmployee[];
  total:           number;
  ratePerSession:  number;
  paymentStatus:   string | null;
  paidAt:          string | null;
  paymentRef:      string | null;
  invoiceToken?:   string;          // for portal link
}

// Colours
const GREEN  = '#1a7a4a';
const NAVY   = '#1E293B';
const SLATE  = '#64748b';
const ALT    = '#f0f9f4';
const WHITE  = '#ffffff';
const BORDER = '#e2e8f0';

function hexToRgb(hex: string): [number, number, number] {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return [r, g, b];
}

function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-');
  return new Date(Number(y), Number(m) - 1, 1)
    .toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function fmtNum(n: number): string {
  return n.toLocaleString('en-US');
}

export function generateInvoicePdf(data: InvoiceData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
  const chunks: Buffer[] = [];

  const doc = new PDFDocument({
    size:    'A4',
    margins: { top: 0, bottom: 0, left: 0, right: 0 },
  });

  doc.on('data',  (chunk: Buffer) => chunks.push(chunk));
  doc.on('error', reject);

  const W   = 595.28;  // A4 width in points
  const H   = 841.89;  // A4 height in points
  const LM  = 48;
  const RM  = W - LM;
  const CW  = RM - LM; // content width

  // ── Header bar ───────────────────────────────────────────────────
  const [gr, gg, gb] = hexToRgb(GREEN);
  doc.rect(0, 0, W, 72).fill(GREEN);

  // GymMind logo text (left)
  doc.font('Helvetica-Bold').fontSize(22).fillColor(WHITE).text('GymMind', LM, 24);

  // INVOICE label (right)
  doc.font('Helvetica-Bold').fontSize(26).fillColor(WHITE)
     .text('INVOICE', 0, 20, { align: 'right', width: W - LM });

  // ── Two-column section ───────────────────────────────────────────
  let y = 96;

  const col1x = LM;
  const col2x = W / 2 + 8;
  const colW  = W / 2 - LM - 8;

  // FROM (gym)
  doc.font('Helvetica-Bold').fontSize(9).fillColor(SLATE)
     .text('FROM', col1x, y);
  y += 14;
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY)
     .text(data.gymName, col1x, y, { width: colW });
  y += 16;
  doc.font('Helvetica').fontSize(9).fillColor(SLATE)
     .text(`Invoice period: ${fmtMonth(data.month)}`, col1x, y);
  y += 12;

  const invoiceNo = `INV-${data.month.replace('-', '')}-${(data.institutionName.slice(0, 4).toUpperCase())}`;
  doc.font('Helvetica').fontSize(9).fillColor(SLATE)
     .text(`Invoice No: ${invoiceNo}`, col1x, y);
  y += 12;

  const [ym, mm] = data.month.split('-').map(Number);
  const dueDate  = new Date(ym, mm, 5); // 5th of next month
  doc.font('Helvetica').fontSize(9).fillColor(SLATE)
     .text(`Due date: ${dueDate.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}`, col1x, y);

  // INVOICE TO (right column) – positioned beside FROM
  const rightTopY = 96;
  doc.font('Helvetica-Bold').fontSize(9).fillColor(SLATE)
     .text('INVOICE TO', col2x, rightTopY);
  doc.font('Helvetica-Bold').fontSize(13).fillColor(NAVY)
     .text(data.institutionName, col2x, rightTopY + 14, { width: colW });
  doc.font('Helvetica').fontSize(9).fillColor(SLATE)
     .text(`Rate per session: ${fmtNum(data.ratePerSession)} RWF`, col2x, rightTopY + 30);

  // Horizontal rule
  y = 158;
  doc.moveTo(LM, y).lineTo(RM, y).strokeColor(BORDER).lineWidth(0.75).stroke();
  y += 16;

  // ── Employee table ───────────────────────────────────────────────
  const colWidths = [CW * 0.50, CW * 0.20, CW * 0.30];
  const colX = [LM, LM + colWidths[0], LM + colWidths[0] + colWidths[1]];
  const rowH = 22;

  // Table header
  doc.rect(LM, y, CW, rowH).fill(GREEN);
  doc.font('Helvetica-Bold').fontSize(9).fillColor(WHITE);
  doc.text('Employee', colX[0] + 6, y + 7, { width: colWidths[0] - 6 });
  doc.text('Days', colX[1] + 6, y + 7, { width: colWidths[1] - 6, align: 'center' });
  doc.text('Amount (RWF)', colX[2] + 6, y + 7, { width: colWidths[2] - 12, align: 'right' });
  y += rowH;

  // Rows
  data.employees.forEach((emp, i) => {
    const rowBg = i % 2 === 1 ? ALT : WHITE;
    doc.rect(LM, y, CW, rowH).fill(rowBg);

    doc.font('Helvetica').fontSize(9).fillColor(NAVY);
    doc.text(emp.name, colX[0] + 6, y + 7, { width: colWidths[0] - 6, ellipsis: true });
    doc.text(String(emp.days_attended), colX[1] + 6, y + 7, { width: colWidths[1] - 6, align: 'center' });
    doc.text(emp.amount > 0 ? fmtNum(emp.amount) : '—', colX[2] + 6, y + 7, { width: colWidths[2] - 12, align: 'right' });

    // Row bottom border
    doc.moveTo(LM, y + rowH).lineTo(RM, y + rowH).strokeColor(BORDER).lineWidth(0.4).stroke();
    y += rowH;
  });

  // Total row
  doc.rect(LM, y, CW, rowH + 2).fill(GREEN);
  doc.font('Helvetica-Bold').fontSize(10).fillColor(WHITE);
  doc.text('TOTAL', colX[0] + 6, y + 7, { width: colWidths[0] + colWidths[1] - 6 });
  doc.text(fmtNum(data.total) + ' RWF', colX[2] + 6, y + 7, { width: colWidths[2] - 12, align: 'right' });
  y += rowH + 2;

  y += 24;

  // ── Payment summary box (right-aligned) ─────────────────────────
  const boxW = 200;
  const boxX = RM - boxW;
  const boxPad = 14;
  let bY = y;

  // Box border
  doc.rect(boxX, bY, boxW, 78).strokeColor(BORDER).lineWidth(0.75).stroke();

  // Box title
  doc.font('Helvetica-Bold').fontSize(10).fillColor(GREEN)
     .text('PAYMENT SUMMARY', boxX + boxPad, bY + 12, { width: boxW - boxPad * 2 });

  doc.moveTo(boxX + boxPad, bY + 26).lineTo(boxX + boxW - boxPad, bY + 26)
     .strokeColor(BORDER).lineWidth(0.5).stroke();

  // Subtotal line
  doc.font('Helvetica').fontSize(9).fillColor(SLATE)
     .text('Subtotal:', boxX + boxPad, bY + 32);
  doc.font('Helvetica').fontSize(9).fillColor(NAVY)
     .text(`${fmtNum(data.total)} RWF`, boxX + boxPad, bY + 32, { width: boxW - boxPad * 2, align: 'right' });

  // Total due
  doc.font('Helvetica-Bold').fontSize(11).fillColor(GREEN)
     .text('Total Due:', boxX + boxPad, bY + 48);
  doc.font('Helvetica-Bold').fontSize(11).fillColor(GREEN)
     .text(`${fmtNum(data.total)} RWF`, boxX + boxPad, bY + 48, { width: boxW - boxPad * 2, align: 'right' });

  // If paid, show badge
  if (data.paymentStatus === 'paid' && data.paidAt) {
    doc.rect(boxX, bY + 64, boxW, 14).fill('#dcfce7');
    doc.font('Helvetica-Bold').fontSize(8).fillColor('#15803d')
       .text(
         `✓ PAID  ${new Date(data.paidAt).toLocaleDateString('en-GB')}${data.paymentRef ? '  Ref: ' + data.paymentRef : ''}`,
         boxX + boxPad, bY + 67,
         { width: boxW - boxPad * 2 },
       );
  }

  // ── Payment instructions (left-aligned) ─────────────────────────
  doc.font('Helvetica-Bold').fontSize(10).fillColor(NAVY)
     .text('Payment Instructions', LM, y);
  y += 16;
  doc.font('Helvetica').fontSize(9).fillColor(SLATE)
     .text('1. Pay via MTN MoMo: dial *182*1*1# and follow the prompts.', LM, y, { width: boxX - LM - 16 });
  y += 14;
  doc.font('Helvetica').fontSize(9).fillColor(SLATE)
     .text('2. Log in to the HR portal to view invoices and pay online:', LM, y, { width: boxX - LM - 16 });
  y += 12;
  if (data.invoiceToken) {
    doc.font('Helvetica').fontSize(9).fillColor(GREEN)
       .text(`   gymmind.rw/hr/${data.invoiceToken}`, LM, y, { width: boxX - LM - 16 });
  } else {
    doc.font('Helvetica').fontSize(9).fillColor(GREEN)
       .text('   gymmind.rw', LM, y, { width: boxX - LM - 16 });
  }
  y += 14;
  doc.font('Helvetica').fontSize(9).fillColor(SLATE)
     .text('3. Questions? Email: billing@gymmind.rw', LM, y, { width: boxX - LM - 16 });

  // ── Footer ───────────────────────────────────────────────────────
  const footerY = H - 36;
  doc.moveTo(LM, footerY - 8).lineTo(RM, footerY - 8).strokeColor(GREEN).lineWidth(1).stroke();

  doc.font('Helvetica').fontSize(8).fillColor(SLATE)
     .text('GymMind — Gym Management for Rwanda  ·  support@gymmind.rw  ·  gymmind.rw',
       LM, footerY, { align: 'center', width: CW });

  doc.on('end', () => resolve(Buffer.concat(chunks)));
  doc.end();

  // Suppress unused-variable warning for hexToRgb usage above
  void gr; void gg; void gb;
  }); // end Promise
}
