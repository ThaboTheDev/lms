import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/current-user';
import { listCertificateTemplates } from '@/server/services/certificate-templates';
import { DEFAULT_TEMPLATE, TEMPLATE_PLACEHOLDERS } from '@/lib/certificates/template';
import { EmptyState, Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs } from '@/components/ui/navigation';
import { ActionButton } from '@/components/ui/action-form';
import { TemplateForm } from './template-form';
import { removeTemplate } from './actions';

export const metadata: Metadata = { title: 'Certificate templates' };

export default async function CertificateTemplatesPage() {
  const principal = await requirePrincipal();
  const templates = await listCertificateTemplates(principal);
  const placeholders = Object.entries(TEMPLATE_PLACEHOLDERS) as [string, string][];

  return (
    <div className="max-w-4xl space-y-6">
      <Breadcrumbs trail={[{ label: 'Certificates', href: '/certificates' }, { label: 'Templates' }]} />
      <div>
        <h1 className="font-serif text-2xl font-semibold">Certificate templates</h1>
        <p className="mt-1 max-w-prose text-sm text-muted">
          The wording, signatory and images on the certificates this institution issues. The logo comes from Settings, and
          every certificate keeps its verification code and QR code whatever the template says.
        </p>
      </div>

      <Panel title="New template">
        <div className="px-4 py-4">
          <TemplateForm defaultBody={DEFAULT_TEMPLATE} placeholders={placeholders} />
        </div>
      </Panel>

      {templates.length === 0 ? (
        <EmptyState title="No templates yet" hint="Certificates use the built-in wording until you add one." />
      ) : (
        templates.map((template) => (
          <Panel
            key={template.id}
            title={template.name}
            description={`${template.kind.toLowerCase().replace(/_/g, ' ')} · used by ${template._count.certificates} certificates`}
          >
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-2 text-sm">
              {template.isDefault && <Tag tone="active">default</Tag>}
              <a href={`/api/v1/certificate-templates/${template.id}/preview`} target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2">
                Preview as PDF
              </a>
              <span className="flex-1" />
              <ActionButton action={removeTemplate} hidden={{ templateId: template.id }} label="Remove" variant="ghost" />
            </div>
            <details className="px-4 py-3">
              <summary className="cursor-pointer text-sm text-accent">Edit</summary>
              <div className="pt-3">
                <TemplateForm template={template} defaultBody={DEFAULT_TEMPLATE} placeholders={placeholders} />
              </div>
            </details>
          </Panel>
        ))
      )}
    </div>
  );
}
