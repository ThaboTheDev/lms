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
import { can, requirePermission, requireSameInstitution, type Principal } from '@/lib/rbac/authorize';
import { storage } from '@/lib/storage';
import { renderTemplate } from '@/lib/certificates/template';

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

interface CertificateTemplateParts {
  bodyHtml: string | null;
  signatoryName: string | null;
  signatoryTitle: string | null;
  signatureFileId: string | null;
  backgroundFileId: string | null;
}

interface CertificateDrawing {
  institutionId: string;
  institutionName: string;
  accreditationNo: string | null;
  logoFileId: string | null;
  holder: string;
  studentNumber: string;
  title: string;
  qualification: { title: string; nqfLevel: number | null; saqaId: string | null; minimumCredits?: number | null } | null;
  completionDate: Date;
  issuedOn: Date;
  number: string;
  verificationCode: string;
  status: string;
  revokedReason: string | null;
  template: CertificateTemplateParts | null;
  watermark?: string;
}

/** A PNG or JPEG the institution stored (logo, signature, background), if it is one and the scan did not withhold it. */
async function storedImage(pdf: PDFDocument, institutionId: string, fileId: string | null) {
  if (!fileId) return null;
  const file = await prisma.fileObject.findUnique({
    where: { id: fileId },
    select: { institutionId: true, storageKey: true, mimeType: true, scanStatus: true },
  });
  if (!file || file.institutionId !== institutionId || file.scanStatus === 'INFECTED') return null;
  const bytes = await storage.get(file.storageKey).catch(() => null);
  if (!bytes) return null;
  try {
    if (file.mimeType === 'image/png') return await pdf.embedPng(bytes);
    if (file.mimeType === 'image/jpeg') return await pdf.embedJpg(bytes);
  } catch {
    // A file that claims to be an image but is not one is left off, not fatal.
  }
  return null;
}

async function drawCertificate(d: CertificateDrawing): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${d.title} · ${d.number}`);
  pdf.setAuthor(d.institutionName);
  const page = pdf.addPage([841.89, 595.28]); // A4 landscape
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const serifBold = await pdf.embedFont(StandardFonts.TimesRomanBold);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const { width, height } = page.getSize();

  const background = await storedImage(pdf, d.institutionId, d.template?.backgroundFileId ?? null);
  if (background) {
    page.drawImage(background, { x: 0, y: 0, width, height });
  } else {
    page.drawRectangle({ x: 24, y: 24, width: width - 48, height: height - 48, borderColor: NAVY, borderWidth: 3 });
    page.drawRectangle({ x: 32, y: 32, width: width - 64, height: height - 64, borderColor: GOLD, borderWidth: 1 });
  }

  const logo = await storedImage(pdf, d.institutionId, d.logoFileId);
  if (logo) {
    const scale = Math.min(64 / logo.width, 64 / logo.height);
    page.drawImage(logo, { x: (width - logo.width * scale) / 2, y: height - 100, width: logo.width * scale, height: logo.height * scale });
  }
  centred(page, d.institutionName.toUpperCase(), height - (logo ? 122 : 100), sans, 13, NAVY);

  const lines = renderTemplate(d.template?.bodyHtml, {
    '{{name}}': d.holder,
    '{{title}}': d.title,
    '{{qualification}}': d.qualification?.title ?? d.title,
    '{{nqf}}': d.qualification?.nqfLevel ? String(d.qualification.nqfLevel) : null,
    '{{credits}}': d.qualification?.minimumCredits ? String(d.qualification.minimumCredits) : null,
    '{{completed}}': day(d.completionDate),
    '{{issued}}': day(d.issuedOn),
    '{{number}}': d.number,
    '{{institution}}': d.institutionName,
  });
  let y = height - 170;
  for (const line of lines) {
    if (line.emphasis === 'name') {
      centred(page, line.text, y - 20, serifBold, 34);
      y -= 60;
    } else if (line.emphasis === 'award') {
      centred(page, line.text, y - 10, serifBold, 24);
      y -= 42;
    } else {
      centred(page, line.text, y, serif, 16, MUTED);
      y -= 34;
    }
  }
  const detail = [
    d.qualification?.nqfLevel ? `NQF level ${d.qualification.nqfLevel}` : null,
    d.qualification?.saqaId ? `SAQA ID ${d.qualification.saqaId}` : null,
    `completed ${day(d.completionDate)}`,
  ].filter(Boolean).join(' · ');
  centred(page, detail, Math.min(y + 4, height - 325), sans, 11, MUTED);

  const signature = await storedImage(pdf, d.institutionId, d.template?.signatureFileId ?? null);
  if (signature) {
    const scale = Math.min(200 / signature.width, 48 / signature.height);
    page.drawImage(signature, { x: 115, y: 134, width: signature.width * scale, height: signature.height * scale });
  }
  page.drawLine({ start: { x: 110, y: 130 }, end: { x: 330, y: 130 }, thickness: 0.8, color: NAVY });
  const signatory = [d.template?.signatoryName, d.template?.signatoryTitle].filter(Boolean).join(', ') || 'Registrar';
  page.drawText(safe(signatory), { x: 110, y: 114, size: 10, font: sans, color: MUTED });
  page.drawText(safe(`Issued ${day(d.issuedOn)}`), { x: 110, y: 96, size: 10, font: sans, color: MUTED });
  page.drawText(safe(`Certificate ${d.number} · student ${d.studentNumber}`), { x: 110, y: 78, size: 9, font: sans, color: MUTED });
  if (d.accreditationNo) {
    page.drawText(safe(`Accreditation ${d.accreditationNo}`), { x: 110, y: 62, size: 9, font: sans, color: MUTED });
  }

  const verifyUrl = appUrl(`/verify/${d.verificationCode}`);
  const qr = await QRCode.toBuffer(verifyUrl, { type: 'png', margin: 1, width: 240, errorCorrectionLevel: 'M' });
  const qrImage = await pdf.embedPng(qr);
  page.drawImage(qrImage, { x: width - 190, y: 62, width: 96, height: 96 });
  page.drawText(safe('Verify this certificate'), { x: width - 230, y: 170, size: 9, font: sans, color: MUTED });
  page.drawText(safe(d.verificationCode), { x: width - 230, y: 48, size: 10, font: sans, color: NAVY });

  if (d.status === 'REVOKED') {
    page.drawText('REVOKED', { x: width / 2 - 170, y: height / 2 - 40, size: 90, font: sans, color: rgb(0.75, 0.1, 0.1), opacity: 0.25, rotate: degrees(20) });
    centred(page, safe(`Revoked${d.revokedReason ? `: ${d.revokedReason}` : ''}`), 40, sans, 10, rgb(0.75, 0.1, 0.1));
  }
  if (d.watermark) {
    page.drawText(d.watermark, { x: width / 2 - 170, y: height / 2 - 40, size: 90, font: sans, color: GOLD, opacity: 0.3, rotate: degrees(20) });
  }

  return pdf.save();
}

const templateSelect = { bodyHtml: true, signatoryName: true, signatoryTitle: true, signatureFileId: true, backgroundFileId: true } as const;

export async function certificatePdf(principal: Principal, certificateId: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const certificate = await prisma.certificate.findUnique({
    where: { id: certificateId },
    select: {
      id: true, institutionId: true, number: true, verificationCode: true, title: true, kind: true,
      completionDate: true, issuedOn: true, status: true, revokedReason: true,
      student: { select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } } },
      institution: { select: { name: true, accreditationNo: true, registrationNo: true, logoFileId: true } },
      qualification: { select: { title: true, nqfLevel: true, saqaId: true, minimumCredits: true } },
      template: { select: templateSelect },
    },
  });
  if (!certificate) throw new NotFoundError('Certificate');
  const own = principal.studentId === certificate.student.id;
  if (!own) {
    requireSameInstitution(principal, certificate.institutionId);
    if (!can(principal, 'certificate.read', { institutionId: certificate.institutionId })) throw new NotFoundError('Certificate');
  }
  if (certificate.status === 'DRAFT') throw new AppError('This certificate has not been issued yet.', 409, 'not_issued');

  // No template chosen when it was issued: the institution's default for this kind.
  const template =
    certificate.template ??
    (await prisma.certificateTemplate.findFirst({
      where: { institutionId: certificate.institutionId, kind: certificate.kind, isDefault: true },
      select: templateSelect,
    }));

  const bytes = await drawCertificate({
    institutionId: certificate.institutionId,
    institutionName: certificate.institution.name,
    accreditationNo: certificate.institution.accreditationNo,
    logoFileId: certificate.institution.logoFileId,
    holder: `${certificate.student.user.firstName} ${certificate.student.user.lastName}`,
    studentNumber: certificate.student.studentNumber,
    title: certificate.title,
    qualification: certificate.qualification,
    completionDate: certificate.completionDate,
    issuedOn: certificate.issuedOn,
    number: certificate.number,
    verificationCode: certificate.verificationCode,
    status: certificate.status,
    revokedReason: certificate.revokedReason,
    template,
  });
  return { bytes, filename: `${certificate.number}.pdf` };
}

/** A template drawn with sample details and a PREVIEW watermark, to check the wording and images before issuing with it. */
export async function certificateTemplatePreviewPdf(principal: Principal, templateId: string): Promise<{ bytes: Uint8Array; filename: string }> {
  const template = await prisma.certificateTemplate.findUnique({
    where: { id: templateId },
    select: { ...templateSelect, institutionId: true, name: true, institution: { select: { name: true, accreditationNo: true, logoFileId: true } } },
  });
  if (!template) throw new NotFoundError('Template');
  requireSameInstitution(principal, template.institutionId);
  requirePermission(principal, 'certificate.issue', { institutionId: template.institutionId });

  const bytes = await drawCertificate({
    institutionId: template.institutionId,
    institutionName: template.institution.name,
    accreditationNo: template.institution.accreditationNo,
    logoFileId: template.institution.logoFileId,
    holder: 'Sample Learner',
    studentNumber: '000000',
    title: 'Higher Certificate in Sample Studies',
    qualification: { title: 'Higher Certificate in Sample Studies', nqfLevel: 5, saqaId: null, minimumCredits: 120 },
    completionDate: new Date(),
    issuedOn: new Date(),
    number: 'PREVIEW',
    verificationCode: 'PREVIEW',
    status: 'ISSUED',
    revokedReason: null,
    template,
    watermark: 'PREVIEW',
  });
  return { bytes, filename: `${template.name.replace(/[^\w-]+/g, '-')}-preview.pdf` };
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
