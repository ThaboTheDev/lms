import type { Metadata, Route } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can, requireAnyPermission } from '@/lib/rbac/authorize';
import { setupProgress } from '@/server/services/academic-setup';
import { SETUP_PERMISSIONS } from '@/server/services/academic-setup-rules';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';

export const metadata: Metadata = { title: 'Academic setup' };

export default async function AcademicSetupPage() {
  const principal = await requirePrincipal();
  requireAnyPermission(principal, [...SETUP_PERMISSIONS]);
  const progress = await setupProgress(principal.institutionId ?? '');

  const steps: { title: string; detail: string; done: boolean; href: Route; count: string }[] = [
    { title: 'Academic year and terms', detail: 'The calendar everything else hangs off. Mark the current year and term.', done: progress.currentYears > 0 && progress.terms > 0, href: '/admin/academic/calendar', count: `${progress.years} years, ${progress.terms} terms` },
    { title: 'Faculties and departments', detail: 'Where programmes and courses belong.', done: progress.departments > 0, href: '/admin/academic/structure', count: `${progress.faculties} faculties, ${progress.departments} departments` },
    { title: 'Qualifications', detail: 'What a programme leads to: type, NQF level, credits.', done: progress.qualifications > 0, href: '/admin/academic/structure', count: `${progress.qualifications} qualifications` },
    { title: 'Grading scheme', detail: 'The bands results are reported in. Set it before any result is released.', done: progress.schemes > 0, href: '/admin/academic/grading', count: progress.schemes > 0 ? 'default set' : 'none yet' },
    { title: 'Programmes', detail: 'Each leads to a qualification and carries its own curriculum.', done: progress.programmes > 0, href: '/programmes', count: `${progress.programmes} programmes` },
    { title: 'Courses', detail: 'The catalogue programmes are built from.', done: progress.courses > 0, href: '/courses', count: `${progress.courses} courses` },
    { title: 'Deliveries and teaching teams', detail: 'Schedule courses into a term and assign who teaches them.', done: progress.offerings > 0 && progress.staffed > 0, href: '/courses', count: `${progress.offerings} scheduled, ${progress.staffed} with a teaching team` },
    { title: 'Cohorts', detail: 'Optional: intake groups within a programme and year.', done: true, href: '/admin/academic/cohorts', count: 'optional' },
  ];
  const remaining = steps.filter((step) => !step.done).length;

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[{ label: 'Academic setup' }]} />
      <div>
        <h1 className="font-serif text-2xl font-semibold">Academic setup</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          {remaining === 0
            ? 'Everything a semester needs is in place. Change anything here as the institution changes.'
            : `${remaining} of these still need doing before learners can be registered on courses. Work down the list: each step uses the ones above it.`}
        </p>
      </div>
      <Panel>
        <ol className="divide-y divide-line">
          {steps.map((step, index) => (
            <li key={step.title} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="max-w-prose">
                <Link href={step.href} className="font-medium text-accent underline-offset-2 hover:underline">
                  {index + 1}. {step.title}
                </Link>
                <p className="text-sm text-muted">{step.detail}</p>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <span className="text-muted">{step.count}</span>
                <Tag tone={step.done ? 'active' : 'caution'}>{step.done ? 'done' : 'to do'}</Tag>
              </div>
            </li>
          ))}
        </ol>
      </Panel>
      {can(principal, 'settings.manage') && <p className="text-sm text-muted">
        Email wording lives under <Link href="/admin/email-templates" className="text-accent underline underline-offset-2">Email templates</Link>; the
        institution&apos;s name, branding and certificate prefix under <Link href="/admin/settings" className="text-accent underline underline-offset-2">Settings</Link>.
      </p>}
    </div>
  );
}
