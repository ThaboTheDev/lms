import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { atRiskLearners, programmeAnalytics } from '@/server/services/analytics';
import { MINIMUM_GROUP_SIZE } from '@/server/services/analytics-rules';
import { EmptyState, Panel, Tag } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Learning analytics' };

const levelTone = { urgent: 'danger', concern: 'caution', watch: 'neutral', none: 'active' } as const;

export default async function AnalyticsPage() {
  const principal = await requirePrincipal();
  const [learners, programmes] = await Promise.all([
    atRiskLearners(principal),
    programmeAnalytics(principal),
  ]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Learning analytics</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Learners whose recorded activity suggests they may need support. Every reason is shown,
          because a list of names with scores is an invitation to guess.
        </p>
      </div>

      <p className="border-l-2 border-line bg-paper px-4 py-3 text-sm text-muted">
        This page draws only on things the institution recorded: assessments, marks, attendance and
        course use. It makes no inference about anyone&apos;s circumstances or ability, and it is a
        prompt to have a conversation rather than a conclusion to act on.
      </p>

      <Panel
        title="Learners who may need support"
        description={`${learners.length} flagged, most pressing first`}
      >
        {learners.length === 0 ? (
          <EmptyState
            title="Nobody is flagged"
            hint="Learners appear here when something measurable changes: a missed assessment, a drop in attendance, a course left unopened."
          />
        ) : (
          <ul className="divide-y divide-line">
            {learners.map((learner) => (
              <li key={learner.studentId} className="px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    {can(principal, 'student.read') ? (<Link
                      href={`/students/${learner.studentId}`}
                      className="text-sm font-medium text-accent underline-offset-2 hover:underline"
                    >
                      {learner.name}
                    </Link>) : (<span className="font-medium">
                      {learner.name}
                    </span>)}
                    <p className="text-xs tabular-nums text-muted">
                      {learner.studentNumber}
                      {learner.programmeCode ? ` · ${learner.programmeCode}` : ''}
                    </p>
                  </div>
                  <Tag tone={levelTone[learner.risk.level]}>
                    {learner.risk.level === 'urgent'
                      ? 'speak to them'
                      : learner.risk.level === 'concern'
                        ? 'worth a check'
                        : 'watching'}
                  </Tag>
                </div>

                <ul className="mt-2 space-y-1">
                  {learner.risk.indicators.map((indicator) => (
                    <li key={indicator.key} className="text-sm">
                      {indicator.statement}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel
        title="By programme"
        description={`Groups smaller than ${MINIMUM_GROUP_SIZE} learners are not reported, because a figure for three people names those three.`}
      >
        <ul className="divide-y divide-line">
          {programmes.programmes.reported.map((entry) => (
            <li key={entry.label} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span>{entry.label}</span>
              <span className="tabular-nums text-muted">
                {entry.value === null ? 'too few to report' : `${entry.value} enrolled`}
              </span>
            </li>
          ))}
        </ul>
        {programmes.programmes.suppressed > 0 && (
          <p className="border-t border-line px-4 py-2.5 text-xs text-muted">
            {programmes.programmes.suppressed} groups were withheld as too small to report on.
          </p>
        )}
      </Panel>

      <Panel title="Course results so far">
        <ul className="divide-y divide-line">
          {programmes.results.map((row) => (
            <li key={row.result} className="flex items-center justify-between px-4 py-2.5 text-sm">
              <span>{row.result.toLowerCase().replace(/_/g, ' ')}</span>
              <span className="tabular-nums text-muted">{row.count}</span>
            </li>
          ))}
        </ul>
      </Panel>
    </div>
  );
}
