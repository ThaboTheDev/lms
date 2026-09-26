/**
 * Certificate wording. A template is plain text with placeholders, one line
 * per printed line; the PDF sets the name and the award larger. Stored in a
 * column called bodyHtml for historical reasons: any markup in it is removed,
 * never interpreted, because the certificate is drawn, not rendered as HTML.
 */

export const TEMPLATE_PLACEHOLDERS = {
  '{{name}}': 'The holder, in full',
  '{{title}}': 'What was awarded, e.g. the qualification',
  '{{qualification}}': 'The qualification title, if there is one',
  '{{nqf}}': 'NQF level, if known',
  '{{credits}}': 'Credits, if known',
  '{{completed}}': 'Date of completion',
  '{{issued}}': 'Date of issue',
  '{{number}}': 'Certificate number',
  '{{institution}}': 'The institution',
} as const;

export const DEFAULT_TEMPLATE = ['This is to certify that', '{{name}}', 'has been awarded', '{{title}}'].join('\n');

export type TemplateLine = { text: string; emphasis: 'name' | 'award' | 'plain' };

/** The lines a template prints, with placeholders filled and markup removed. */
export function renderTemplate(body: string | null | undefined, values: Partial<Record<keyof typeof TEMPLATE_PLACEHOLDERS, string | null | undefined>>): TemplateLine[] {
  const source = (body && body.trim() ? body : DEFAULT_TEMPLATE)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h\d|li)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');

  return source
    .split('\n')
    .map((raw) => raw.trim())
    .filter(Boolean)
    .slice(0, 8)
    .map((line) => {
      const emphasis: TemplateLine['emphasis'] = line === '{{name}}' ? 'name' : line === '{{title}}' || line === '{{qualification}}' ? 'award' : 'plain';
      const text = line.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) => {
        const placeholder = `{{${key}}}` as keyof typeof TEMPLATE_PLACEHOLDERS;
        // A known placeholder with nothing to say prints nothing; an unknown
        // one stays visible, so a typo shows up on the preview.
        return placeholder in TEMPLATE_PLACEHOLDERS ? (values[placeholder] ?? '') : match;
      });
      return { text: text.replace(/\s{2,}/g, ' ').trim(), emphasis };
    })
    .filter((line) => line.text);
}
