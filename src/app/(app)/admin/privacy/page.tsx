import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { requirePermission } from '@/lib/rbac/authorize';
import { retentionReport } from '@/server/services/privacy';
import { DataTable, Panel, Tag } from '@/components/ui/primitives';
import { ErasureForms, SweepButton } from './privacy-forms';

export const metadata: Metadata = { title: 'Privacy and retention' };

const actionTone = { RETAIN: 'neutral', DELETE: 'caution', ANONYMISE: 'caution' } as const;

export default async function PrivacyPage() {
  const principal = await requirePrincipal();
  requirePermission(principal, 'settings.manage');

  const [rules, people] = await Promise.all([
    retentionReport(principal),
    prisma.user.findMany({
      where: { institutionId: principal.institutionId ?? undefined, deletedAt: null },
      orderBy: { lastName: 'asc' },
      take: 500,
      select: { id: true, firstName: true, lastName: true, email: true },
    }),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Privacy and retention</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          What the institution keeps, for how long, and what happens when somebody asks to be
          removed. Every rule carries the reason it exists, so the policy can be argued with rather
          than merely obeyed.
        </p>
      </div>

      <Panel title="Retention policy">
        <DataTable caption="Retention rules" head={['Records', 'What happens', 'Past its date', 'On file', 'Why']}>
          {rules.map((rule) => (
            <tr key={rule.category} className="border-b border-line last:border-0">
              <td className="px-4 py-2.5">{rule.label}</td>
              <td className="px-4 py-2.5">
                <Tag tone={actionTone[rule.action as keyof typeof actionTone] ?? 'neutral'}>
                  {rule.action.toLowerCase()}
                </Tag>
              </td>
              <td className="px-4 py-2.5 tabular-nums">
                {rule.action === 'RETAIN' && rule.due === 0 ? (
                  <span className="text-muted">kept</span>
                ) : (
                  <>
                    {rule.due}
                    {rule.due > 0 && (
                      <span className="ml-2">
                        <SweepButton category={rule.category} />
                      </span>
                    )}
                  </>
                )}
              </td>
              <td className="px-4 py-2.5 tabular-nums text-muted">{rule.total || '-'}</td>
              <td className="px-4 py-2.5 text-xs text-muted">{rule.basis}</td>
            </tr>
          ))}
        </DataTable>
      </Panel>

      <ErasureForms
        people={people.map((person) => ({
          id: person.id,
          label: `${person.lastName}, ${person.firstName} · ${person.email}`,
        }))}
      />
    </div>
  );
}
