import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { loadBank } from '@/server/services/question-bank';
import { needsManualMarking } from '@/server/services/quiz-engine';
import { EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { NewQuestionForm } from '../bank-forms';

export const metadata: Metadata = { title: 'Question bank' };

export default async function BankPage({ params }: { params: Promise<{ bankId: string }> }) {
  const principal = await requirePrincipal();
  const { bankId } = await params;
  const bank = await loadBank(principal, bankId);

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[{ label: 'Question banks', href: '/question-banks' }, { label: bank.name }]} />

      <div>
        <h1 className="font-serif text-2xl font-semibold">{bank.name}</h1>
        <p className="mt-1 text-sm text-muted">
          {bank.questions.length} questions
          {bank.course ? ` · ${bank.course.code}` : ''}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
        <Panel title="Questions">
          {bank.questions.length === 0 ? (
            <EmptyState title="This bank is empty" hint="Add your first question on the right." />
          ) : (
            <ol className="divide-y divide-line">
              {bank.questions.map((question) => {
                const prompt = (question.prompt ?? {}) as { text?: string };
                return (
                  <li key={question.id} className="space-y-1 px-4 py-3 text-sm">
                    <p>{prompt.text}</p>
                    <p className="flex flex-wrap items-center gap-2 text-xs text-muted">
                      <span>{question.type.toLowerCase().replace(/_/g, ' ')}</span>
                      <span>· {Number(question.defaultMark)} marks</span>
                      <span>· {question.difficulty.toLowerCase()}</span>
                      {question.topic && <span>· {question.topic}</span>}
                      {question.bloomLevel && <span>· {question.bloomLevel.toLowerCase()}</span>}
                      {question._count.usedIn > 0 && <span>· used in {question._count.usedIn} papers</span>}
                      {needsManualMarking(question.type as never) && <Tag tone="caution">marked by hand</Tag>}
                    </p>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>

        {can(principal, 'question_bank.manage') && (
          <Panel title="Add a question">
            <div className="px-4 py-4">
              <NewQuestionForm bankId={bankId} />
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
