import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { requirePrincipal } from '@/lib/auth/current-user';
import { requirePermission } from '@/lib/rbac/authorize';
import { TEMPLATE_VARIABLES } from '@/server/services/academic-setup-rules';
import { ActionForm } from '@/components/ui/action-form';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { saveTemplate } from '../academic/actions';

export const metadata: Metadata = { title: 'Email templates' };

/** The notices that send email, in the order people ask about them. */
const KINDS: { key: string; name: string }[] = [
  { key: 'grade.released', name: 'A result is released' },
  { key: 'assessment.published', name: 'An assessment is set' },
  { key: 'assessment.due_soon', name: 'An assessment is due soon' },
  { key: 'certificate.issued', name: 'A certificate is issued' },
  { key: 'payment.status', name: 'Something changes on an account' },
  { key: 'admission.decision', name: 'An admission decision is made' },
  { key: 'announcement.published', name: 'An announcement is published' },
  { key: 'ticket.raised', name: 'A support ticket is raised' },
  { key: 'system.notice', name: 'A system notice' },
];

const STARTER_HTML = '<p>Hello {{firstName}},</p>\n<p>{{body}}</p>\n<p><a href="{{link}}">Open it in the platform</a></p>\n<p>{{institution}}</p>';

export default async function EmailTemplatesPage() {
  const principal = await requirePrincipal();
  requirePermission(principal, 'settings.manage');
  const templates = await prisma.emailTemplate.findMany({ where: { institutionId: principal.institutionId ?? '' } });
  const byKey = new Map(templates.map((template) => [template.key, template]));

  return (
    <div className="space-y-6">
      <Breadcrumbs trail={[{ label: 'Settings', href: '/admin/settings' }, { label: 'Email templates' }]} />
      <div>
        <h1 className="font-serif text-2xl font-semibold">Email templates</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          Without a template, each notice uses the built-in wording in the institution&apos;s house style. With one, the email uses yours. Variables:{' '}
          {TEMPLATE_VARIABLES.map((name) => `{{${name}}}`).join(', ')}. Values are escaped, so a name typed into a form cannot inject markup.
        </p>
      </div>
      {KINDS.map((kind) => {
        const template = byKey.get(kind.key);
        return (
          <Panel key={kind.key} title={kind.name} description={template ? (template.isActive ? 'Using your template' : 'Template saved but switched off: the built-in wording is used') : 'Using the built-in wording'}>
            <div className="border-b border-line px-4 py-2 text-sm">
              <Tag tone={template?.isActive ? 'active' : 'neutral'}>{template?.isActive ? 'custom' : 'built in'}</Tag>
            </div>
            <details>
              <summary className="cursor-pointer px-4 py-3 text-sm text-accent">{template ? 'Edit the template' : 'Write a template'}</summary>
              <ActionForm
                bare
                action={saveTemplate}
                submitLabel="Save template"
                columns={1}
                fields={[
                  { name: 'key', label: '', type: 'hidden', defaultValue: kind.key },
                  { name: 'name', label: '', type: 'hidden', defaultValue: kind.name },
                  { name: 'subject', label: 'Subject', required: true, defaultValue: template?.subject ?? '{{title}} · {{institution}}' },
                  { name: 'bodyHtml', label: 'Message (HTML)', type: 'textarea', rows: 7, required: true, defaultValue: template?.bodyHtml ?? STARTER_HTML },
                  { name: 'bodyText', label: 'Plain text version', type: 'textarea', rows: 4, hint: 'Optional; for mail clients that do not show HTML', defaultValue: template?.bodyText ?? '' },
                  { name: 'isActive', label: 'Use this template', type: 'checkbox', defaultValue: template?.isActive ?? true },
                ]}
              />
            </details>
          </Panel>
        );
      })}
    </div>
  );
}
