/**
 * src/server/services/documents.ts
 *
 * The documents people are handed: a certificate and a receipt, as PDFs built
 * on the server. Built on request from the stored record, so a correction to
 * the record corrects the document, and a revoked certificate says so on the
 * page. The QR code on a certificate points at the public verification page,
 * which is the part an employer actually relies on.
 */
import 'server-only';
import QRCode from 'qrcode';
import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { prisma } from '@/lib/db';
import { env } from '@/lib/env';
import { AppError, NotFoundError } from '@/lib/errors';
import { formatMoney, toCents } from '@/lib/money';
import { can, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';

const NAVY = rgb(11 / 255, 17 / 255, 59 / 255);
const GOLD = rgb(203 / 255, 166 / 255, 94 / 255);
const MUTED = rgb(0.35, 0.4, 0.45);

/** Standard PDF fonts cover Latin-1; anything else is replaced rather than crashing the render. */
function safe(text: string): string {
  return text.normalize('NFC').replace(/[^\u0020-\u007e\u00a0-\u00ff]/g, '?');
}

function centred(page: PDFPage, text: string, y: number, font: PDFFont, size: number, color = NAVY) {
  const value = safe(text);
  const width = font.widthOfTextAtSize(value, size);
  page.drawText(value, { x: (page.getWidth() - width) / 2, y, size, font, color });
}

function appUrl(path: string) {
  return `${env.APP_URL.replace(/\/$/, '')}${path}`;
}

const day = (value: Date) => value.toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' });

export async function certificatePdf(principal: Principal, certificateId: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const certificate = await prisma.certificate.findUnique({
    where: { id: certificateId },
    select: {
      id: true, institutionId: true, number: true, verificationCode: true, title: true, kind: true,
      completionDate: true, issuedOn: true, status: true, revokedReason: true,
      student: { select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } } },
      institution: { select: { name: true, accreditationNo: true, registrationNo: true } },
      qualification: { select: { title: true, nqfLevel: true, saqaId: true } },
    },
  });
  if (!certificate) throw new NotFoundError('Certificate');
  const own = principal.studentId === certificate.student.id;
  if (!own) {
    requireSameInstitution(principal, certificate.institutionId);
    if (!can(principal, 'certificate.read', { institutionId: certificate.institutionId })) throw new NotFoundError('Certificate');
  }
  if (certificate.status === 'DRAFT') throw new AppError('This certificate has not been issued yet.', 409, 'not_issued');

  const pdf = await PDFDocument.create();
  pdf.setTitle(`${certificate.title} · ${certificate.number}`);
  pdf.setAuthor(certificate.institution.name);
  const page = pdf.addPage([841.89, 595.28]); // A4 landscape
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const { width, height } = page.getSize();

  page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: NAVY, borderWidth: 3 });
  page.drawRectangle({ x: 32, y: 32, width: width - 64, height: height - 64, borderColor: GOLD, borderWidth: 1 });

  centred(page, certificate.institution.name.toUpperCase(), height - 100, sans, 13, NAVY);
  centred(page, 'This is to certify that', height - 170, serif, 16, MUTED);
  centred(page, `${certificate.student.user.firstName} ${certificate.student.user.lastName}`, height - 215, serifBold, 34);
  centred(page, 'has been awarded', height - 255, serif, 16, MUTED);
  centred(page, certificate.title, height - 295, serifBold, 24);
  const detail = [
    certificate.qualification?.nqfLevel ? `NQF level ${certificate.qualification.nqfLevel}` : null,
    certificate.qualification?.saqaId ? `SAQA ID ${certificate.qualification.saqaId}` : null,
    `completed ${day(certificate.completionDate)}`,
  ].filter(Boolean).join(' · ');
  centred(page, detail, height - 325, sans, 11, MUTED);

  page.drawLine({ start: { x: 110, y: 130 }, end: { x: 330, y: 130 }, thickness: 0.8, color: NAVY });
  page.drawText(safe('Registrar'), { x: 110, y: 114, size: 10, font: sans, color: MUTED });
  page.drawText(safe(`Issued ${day(certificate.issuedOn)}`), { x: 110, y: 96, size: 10, font: sans, color: MUTED });
  page.drawText(safe(`Certificate ${certificate.number} · student ${certificate.student.studentNumber}`), { x: 110, y: 78, size: 9, font: sans, color: MUTED });
  if (certificate.institution.accreditationNo) {
    page.drawText(safe(`Accreditation ${certificate.institution.accreditationNo}`), { x: 110, y: 62, size: 9, font: sans, color: MUTED });
  }

  const verifyUrl = appUrl(`/verify/${certificate.verificationCode}`);
  const qr = await QRCode.toBuffer(verifyUrl, { type: 'png', margin: 1, width: 240, errorCorrectionLevel: 'M' });
  const qrImage = await pdf.embedPng(qr);
  page.drawImage(qrImage, { x: width - 190, y: 62, width: 96, height: 96 });
  page.drawText(safe('Verify this certificate'), { x: width - 230, y: 170, size: 9, font: sans, color: MUTED });
  page.drawText(safe(certificate.verificationCode), { x: width - 230, y: 48, size: 10, font: sans, color: NAVY });

  if (certificate.status === 'REVOKED') {
    page.drawText('REVOKED', { x: width / 2 - 170, y: height / 2 - 40, size: 90, font: sans, color: rgb(0.75, 0.1, 0.1), opacity: 0.25, rotate: degrees(20) });
    centred(page, safe(`Revoked${certificate.revokedReason ? `: ${certificate.revokedReason}` : ''}`), 40, sans, 10, rgb(0.75, 0.1, 0.1));
  }

  return { bytes: await pdf.save(), filename: `${certificate.number}.pdf` };
}

export async function receiptPdf(principal: Principal, receiptId: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const receipt = await prisma.receipt.findUnique({
    where: { id: receiptId },
    select: {
      id: true, number: true, issuedOn: true, institutionId: true,
      institution: { select: { name: true, registrationNo: true, addressLine1: true, city: true, contactEmail: true } },
      payment: {
        select: {
          amount: true, currency: true, method: true, reference: true, paidOn: true,
          invoice: { select: { number: true, balance: true } },
          student: { select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } } },
        },
      },
    },
  });
  if (!receipt) throw new NotFoundError('Receipt');
  const own = principal.studentId === receipt.payment.student.id;
  if (!own) {
    requireSameInstitution(principal, receipt.institutionId);
    if (!can(principal, 'finance.read', { institutionId: receipt.institutionId })) throw new NotFoundError('Receipt');
  }

  const pdf = await PDFDocument.create();
  pdf.setTitle(`Receipt ${receipt.number}`);
  const page = pdf.addPage([595.28, 841.89]); // A4 portrait
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const { height } = page.getSize();
  let y = height - 70;
  const line = (label: string, value: string, strong = false) => {
    page.drawText(safe(label), { x: 60, y, size: 11, font: sans, color: MUTED });
    page.drawText(safe(value), { x: 240, y, size: 11, font: strong ? bold : sans, color: NAVY });
    y -= 22;
  };

  page.drawRectangle({ x: 0, y: height - 36, width: page.getWidth(), height: 36, color: NAVY });
  page.drawText(safe(receipt.institution.name), { x: 60, y: height - 24, size: 12, font: bold, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 0, y: height - 39, width: page.getWidth(), height: 3, color: GOLD });
  page.drawText('Receipt', { x: 60, y, size: 24, font: bold, color: NAVY });
  y -= 40;
  line('Receipt number', receipt.number, true);
  line('Issued', day(receipt.issuedOn));
  line('Received from', `${receipt.payment.student.user.firstName} ${receipt.payment.student.user.lastName}`);
  line('Student number', receipt.payment.student.studentNumber);
  line('Amount', formatMoney(toCents(String(receipt.payment.amount))), true);
  line('Method', receipt.payment.method.toLowerCase().replace(/_/g, ' '));
  if (receipt.payment.reference) line('Reference', receipt.payment.reference);
  line('Paid on', day(receipt.payment.paidOn));
  if (receipt.payment.invoice) {
    line('Against invoice', receipt.payment.invoice.number);
    line('Balance on that invoice now', formatMoney(toCents(String(receipt.payment.invoice.balance))));
  }
  y -= 20;
  const footer = [receipt.institution.registrationNo ? `Registration ${receipt.institution.registrationNo}` : null, receipt.institution.addressLine1, receipt.institution.city, receipt.institution.contactEmail]
    .filter(Boolean)
    .join(' · ');
  if (footer) page.drawText(safe(footer), { x: 60, y: 60, size: 9, font: sans, color: MUTED });

  return { bytes: await pdf.save(), filename: `${receipt.number}.pdf` };
}
