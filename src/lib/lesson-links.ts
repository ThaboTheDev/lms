/**
 * Some lessons are a doorway to something that lives elsewhere in the course:
 * a live class, an assessment, a discussion, a survey, an interactive package.
 * The lesson records which one in `externalRef` as `<kind>:<id>`, and each
 * lesson type accepts only the kinds that make sense for it.
 */
export type LinkKind = 'live' | 'assessment' | 'forum' | 'thread' | 'survey' | 'package';

export const LINK_KINDS_FOR_TYPE: Record<string, LinkKind[]> = {
  LIVE_SESSION: ['live'],
  ASSESSMENT: ['assessment'],
  DISCUSSION: ['forum', 'thread'],
  SURVEY: ['survey'],
  SCORM: ['package'],
  H5P: ['package'],
};

const KINDS = new Set<LinkKind>(['live', 'assessment', 'forum', 'thread', 'survey', 'package']);

export function isLinkableType(type: string): boolean {
  return type in LINK_KINDS_FOR_TYPE;
}

export function formatLessonRef(kind: LinkKind, id: string): string {
  return `${kind}:${id}`;
}

export function parseLessonRef(ref: string | null | undefined): { kind: LinkKind; id: string } | null {
  if (!ref) return null;
  const separator = ref.indexOf(':');
  if (separator < 1) return null;
  const kind = ref.slice(0, separator) as LinkKind;
  const id = ref.slice(separator + 1).trim();
  if (!KINDS.has(kind) || !/^[\w-]{1,64}$/.test(id)) return null;
  return { kind, id };
}

/** Whether a reference is one this lesson type can hold. */
export function refFitsType(type: string, ref: string): boolean {
  const parsed = parseLessonRef(ref);
  return Boolean(parsed && LINK_KINDS_FOR_TYPE[type]?.includes(parsed.kind));
}
