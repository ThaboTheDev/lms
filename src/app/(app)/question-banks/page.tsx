import type { Metadata } from 'next';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { listBanks } from '@/server/services/question-bank';
import { DataTable, EmptyState, Panel } from '@/components/ui/primitives';
import { NewBankForm } from './bank-forms';

export const metadata: Metadata = { title: 'Question banks' };

export default async function QuestionBanksPage() {
  const principal = await requirePrincipal();
  const banks = await listBanks(principal);

  const courses = can(principal, 'question_bank.manage')
    ? await prisma.course.findMany({
        where: { institutionId: principal.institutionId ?? undefined, isActive: true },
        select: { id: true, code: true, title: true },
        orderBy: { code: 'asc' },
      })
    : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Question banks</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Questions live in banks and are reused across assessments. An assessment can take fixed
          questions, or draw a pool so that no two learners sit the same paper.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Panel title="Banks">
          {banks.length === 0 ? (
            <EmptyState title="No banks yet" hint="Start one per course or per topic." />
          ) : (
            <DataTable caption="Question banks" head={['Bank', 'Course', 'Questions']}>
              {banks.map((bank) => (
                <tr key={bank.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    <Link href={`/question-banks/${bank.id}`} className="font-medium text-accent underline-offset-2 hover:underline">
                      {bank.name}
                    </Link>
                    {bank.description && <span className="block text-xs text-muted">{bank.description}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-muted">{bank.course?.code ?? 'Any course'}</td>
                  <td className="px-4 py-2.5 tabular-nums">{bank._count.questions}</td>
                </tr>
              ))}
            </DataTable>
          )}
        </Panel>

        {can(principal, 'question_bank.manage') && (
          <Panel title="New bank">
            <div className="px-4 py-4">
              <NewBankForm courses={courses} />
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
