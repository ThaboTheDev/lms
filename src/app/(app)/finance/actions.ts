'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import { createFee, createInvoice, createPaymentPlan, recordPayment } from '@/server/services/finance';
import { claimNext, reviewProofOfPayment, submitProofOfPayment } from '@/server/services/proof-of-payment';
import type { PopStatus } from '@/server/services/pop-workflow';
import type { FormState } from '@/lib/validation/common';
import { decideRefund, requestRefund } from '@/server/services/refunds';

function fail(error: unknown): FormState {
  if (error instanceof AppError) return { status: 'error', message: error.message };
  throw error;
}

export async function addFee(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const name = String(formData.get('name') ?? '').trim();
  const amount = Number(formData.get('amount') ?? 0);

  if (name.length < 2) return { status: 'error', message: 'Give the fee a name.' };
  if (!(amount > 0)) return { status: 'error', message: 'Enter an amount.' };

  try {
    await createFee(principal, {
      name,
      amount,
      feeType: String(formData.get('feeType') ?? 'TUITION'),
      programmeId: String(formData.get('programmeId') ?? '') || undefined,
      academicYearId: String(formData.get('academicYearId') ?? '') || undefined,
    });
  } catch (error) {
    return fail(error);
  }

  revalidatePath('/finance/fees');
  return { status: 'success', message: 'Fee added.' };
}

export async function raiseInvoice(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const studentId = String(formData.get('studentId') ?? '');
  const description = String(formData.get('description') ?? '').trim();
  const amount = Number(formData.get('amount') ?? 0);
  const dueOn = String(formData.get('dueOn') ?? '');
  const discountPercent = Number(formData.get('discountPercent') ?? 0);

  if (!studentId) return { status: 'error', message: 'Choose a learner.' };
  if (description.length < 2) return { status: 'error', message: 'Describe what is being charged.' };
  if (!(amount > 0)) return { status: 'error', message: 'Enter an amount.' };

  let invoiceId: string;
  try {
    const invoice = await createInvoice(principal, {
      studentId,
      dueOn: dueOn ? new Date(dueOn) : null,
      academicYearId: String(formData.get('academicYearId') ?? '') || undefined,
      notes: String(formData.get('notes') ?? '') || undefined,
      lines: [
        {
          description,
          feeType: String(formData.get('feeType') ?? 'TUITION'),
          quantity: Number(formData.get('quantity') ?? 1),
          unitAmount: amount,
        },
      ],
      discounts: discountPercent > 0
        ? [{ name: 'Discount', type: 'PERCENTAGE', value: discountPercent }]
        : [],
    });
    invoiceId = invoice.id;
  } catch (error) {
    return fail(error);
  }

  revalidatePath('/finance');
  redirect(`/finance/invoices/${invoiceId}`);
}

export async function capturePayment(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const amount = Number(formData.get('amount') ?? 0);
  const paidOn = String(formData.get('paidOn') ?? '');

  if (!(amount > 0)) return { status: 'error', message: 'Enter the amount received.' };

  try {
    const result = await recordPayment(principal, {
      studentId: String(formData.get('studentId') ?? ''),
      invoiceId: String(formData.get('invoiceId') ?? '') || undefined,
      amount,
      method: String(formData.get('method') ?? 'EFT'),
      reference: String(formData.get('reference') ?? '') || undefined,
      paidOn: paidOn ? new Date(paidOn) : new Date(),
    });

    revalidatePath(`/finance/invoices/${String(formData.get('invoiceId') ?? '')}`);
    revalidatePath('/finance');
    return { status: 'success', message: `Recorded. Receipt ${result.receiptNumber} has been issued.` };
  } catch (error) {
    return fail(error);
  }
}

export async function addPaymentPlan(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const startsOn = String(formData.get('startsOn') ?? '');

  try {
    await createPaymentPlan(principal, {
      studentId: String(formData.get('studentId') ?? ''),
      invoiceId: String(formData.get('invoiceId') ?? ''),
      name: String(formData.get('name') ?? 'Payment plan'),
      instalments: Number(formData.get('instalments') ?? 3),
      startsOn: startsOn ? new Date(startsOn) : new Date(),
    });
  } catch (error) {
    return fail(error);
  }

  revalidatePath(`/finance/invoices/${String(formData.get('invoiceId') ?? '')}`);
  return { status: 'success', message: 'Plan created. The instalments are on the invoice.' };
}

export async function reviewPop(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const popId = String(formData.get('popId') ?? '');
  const status = String(formData.get('status') ?? '') as PopStatus;
  const amountRaw = String(formData.get('amount') ?? '');

  try {
    const result = await reviewProofOfPayment(principal, popId, {
      status,
      note: String(formData.get('note') ?? '') || undefined,
      amount: amountRaw ? Number(amountRaw) : undefined,
      paymentMethod: String(formData.get('method') ?? '') || undefined,
    });

    revalidatePath('/finance/proof-of-payment');
    revalidatePath(`/finance/proof-of-payment/${popId}`);

    return {
      status: 'success',
      message: result.receiptNumber
        ? `Approved. Receipt ${result.receiptNumber} has been issued and the learner notified.`
        : 'Recorded. The learner has been told.',
    };
  } catch (error) {
    return fail(error);
  }
}

export async function takeNextPop(): Promise<void> {
  const principal = await requirePrincipal();
  const popId = await claimNext(principal);
  if (popId) redirect(`/finance/proof-of-payment/${popId}`);
  redirect('/finance/proof-of-payment');
}

export async function uploadProof(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const fileId = String(formData.get('fileId') ?? '');
  const amount = Number(formData.get('declaredAmount') ?? 0);
  const declaredDate = String(formData.get('declaredDate') ?? '');

  if (!fileId) return { status: 'error', message: 'Upload the proof first.' };
  if (!(amount > 0)) return { status: 'error', message: 'Enter the amount you paid.' };
  if (!declaredDate) return { status: 'error', message: 'Enter the date you paid.' };

  try {
    await submitProofOfPayment(principal, {
      fileId,
      declaredAmount: amount,
      declaredDate: new Date(declaredDate),
      reference: String(formData.get('reference') ?? '') || undefined,
      invoiceId: String(formData.get('invoiceId') ?? '') || undefined,
    });
  } catch (error) {
    return fail(error);
  }

  revalidatePath('/account');
  return {
    status: 'success',
    message: 'Sent for review. Your account is credited once the finance office has checked it.',
  };
}

export async function requestRefundAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  try {
    await requestRefund(principal, {
      paymentId: String(formData.get('paymentId') ?? ''),
      amount: Number(formData.get('amount') ?? 0),
      reason: String(formData.get('reason') ?? ''),
    });
  } catch (error) {
    return fail(error);
  }
  revalidatePath('/finance');
  revalidatePath(`/finance/invoices/${String(formData.get('invoiceId') ?? '')}`);
  return { status: 'success', message: 'Refund requested. A second finance officer has to approve it.' };
}

export async function decideRefundAction(_prev: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const decision = String(formData.get('decision') ?? '');
  if (!['APPROVED', 'DECLINED', 'PROCESSED'].includes(decision)) return { status: 'error', message: 'Choose a decision.' };
  try {
    await decideRefund(principal, String(formData.get('refundId') ?? ''), decision as 'APPROVED' | 'DECLINED' | 'PROCESSED');
  } catch (error) {
    return fail(error);
  }
  revalidatePath('/finance');
  return { status: 'success', message: decision === 'PROCESSED' ? 'Recorded as paid out.' : decision === 'APPROVED' ? 'Approved.' : 'Declined.' };
}
