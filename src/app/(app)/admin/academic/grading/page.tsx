import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { canAny, requireAnyPermission } from '@/lib/rbac/authorize';
import { DEFAULT_BANDS, GRADE_SCHEME_TYPES, SETUP_PERMISSIONS, bandsToLines } from '@/server/services/academic-setup-rules';
import { ActionButton, ActionForm } from '@/components/ui/action-form';
import { DataTable, EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { addGradingScheme, makeSchemeDefault, saveGradingBands } from '../actions';

export const metadata: Metadata = { title: 'Grading schemes' };

const FORMAT_HINT = 'One band per line: Label, minimum %, maximum %, grade point (or leave empty), pass or fail. Every mark from 0 to 100 has to land in exactly one band.';

export default async function GradingPage() {
  const principal = await requirePrincipal();
  requireAnyPermission(principal, [...SETUP_PERMISSIONS, 'academic_record.manage']);
  const edits = canAny(principal, ['settings.manage', 'academic_record.manage', 'programme.manage']);

  const schemes = await prisma.gradingScheme.findMany({
    where: { institutionId: principal.institutionId ?? '' },
    orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    include: { bands: { orderBy: { minPercent: 'desc' } } },
  });

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[{ label: 'Academic setup', href: '/admin/academic' }, { label: 'Grading' }]} />
      <div>
        <h1 className="font-serif text-2xl font-semibold">Grading schemes</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          The default scheme turns course marks into the grades and grade points on results and transcripts. A change applies to results finalised from then on; results already finalised keep the grade they were given.
        </p>
      </div>

      {schemes.length === 0 && (
        <Panel><EmptyState title="No grading scheme yet" hint="Until there is one, results carry marks but no grade or grade point average." /></Panel>
      )}

      {schemes.map((scheme) => (
        <Panel key={scheme.id} title={scheme.name} description={scheme.type.toLowerCase().replace(/_/g, ' ')}>
          <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3 text-sm">
            {scheme.isDefault ? <Tag tone="active">default</Tag> : edits && <ActionButton action={makeSchemeDefault} hidden={{ schemeId: scheme.id }} label="Make this the default" />}
          </div>
          <DataTable caption={`Bands in ${scheme.name}`} head={['Band', 'From', 'To', 'Grade point', 'Outcome']}>
            {scheme.bands.map((band) => (
              <tr key={band.id} className="border-b border-line last:border-0">
                <td className="px-4 py-2.5 font-medium">{band.label}</td>
                <td className="px-4 py-2.5 tabular-nums">{Number(band.minPercent)}%</td>
                <td className="px-4 py-2.5 tabular-nums">{Number(band.maxPercent)}%</td>
                <td className="px-4 py-2.5 tabular-nums">{band.gradePoint === null ? '-' : Number(band.gradePoint)}</td>
                <td className="px-4 py-2.5"><Tag tone={band.isPass ? 'active' : 'danger'}>{band.isPass ? 'pass' : 'fail'}</Tag></td>
              </tr>
            ))}
          </DataTable>
          {edits && (
            <details className="border-t border-line">
              <summary className="cursor-pointer px-4 py-3 text-sm text-accent">Edit the bands</summary>
              <ActionForm
                bare
                action={saveGradingBands}
                submitLabel="Save bands"
                columns={1}
                fields={[
                  { name: 'schemeId', label: '', type: 'hidden', defaultValue: scheme.id },
                  {
                    name: 'bands',
                    label: 'Bands',
                    type: 'textarea',
                    rows: Math.max(4, scheme.bands.length + 1),
                    hint: FORMAT_HINT,
                    defaultValue: bandsToLines(scheme.bands.map((band) => ({ label: band.label, minPercent: Number(band.minPercent), maxPercent: Number(band.maxPercent), gradePoint: band.gradePoint === null ? null : Number(band.gradePoint), isPass: band.isPass }))),
                  },
                ]}
              />
            </details>
          )}
        </Panel>
      ))}

      {edits && (
        <ActionForm
          title="Add a grading scheme"
          description="Starts from a common South African scale; change it to match your assessment policy."
          action={addGradingScheme}
          submitLabel="Add scheme"
          fields={[
            { name: 'name', label: 'Name', required: true, defaultValue: schemes.length === 0 ? 'Institutional scale' : '' },
            { name: 'type', label: 'Type', type: 'select', defaultValue: 'PERCENTAGE', options: GRADE_SCHEME_TYPES.map((value) => ({ value, label: value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, ' ') })) },
            { name: 'bands', label: 'Bands', type: 'textarea', rows: 6, hint: FORMAT_HINT, defaultValue: bandsToLines(DEFAULT_BANDS) },
            { name: 'isDefault', label: 'Make this the default scheme', type: 'checkbox', defaultValue: schemes.length === 0 },
          ]}
        />
      )}
    </div>
  );
}
