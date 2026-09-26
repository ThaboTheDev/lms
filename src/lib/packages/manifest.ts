/**
 * Reading what a package says about itself: imsmanifest.xml for SCORM,
 * h5p.json for H5P. Pure, so the unpacking job and the tests agree.
 */
import { XMLParser } from 'fast-xml-parser';

export interface ScormManifest {
  version: '1.2' | '2004';
  title: string;
  launchPath: string;
}

export interface H5pManifest {
  title: string;
  mainLibrary: string;
}

type Node = Record<string, unknown>;

const asArray = <T>(value: T | T[] | undefined): T[] => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

/** Element names without their namespace prefix: adlcp:scormtype and scormtype read alike. */
function stripPrefixes(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(stripPrefixes);
  if (node && typeof node === 'object') {
    return Object.fromEntries(
      Object.entries(node as Node).map(([key, value]) => [key.replace(/^(@_)?[\w-]+:/, '$1'), stripPrefixes(value)]),
    );
  }
  return node;
}

function text(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  if (value && typeof value === 'object' && '#text' in (value as Node)) return String((value as Node)['#text']).trim();
  return '';
}

/** The first item in document order that launches something, depth first. */
function firstLaunchableItem(items: Node[], resources: Map<string, Node>): { item: Node; resource: Node } | null {
  for (const item of items) {
    const ref = item['@_identifierref'];
    if (typeof ref === 'string') {
      const resource = resources.get(ref);
      if (resource && typeof resource['@_href'] === 'string') return { item, resource };
    }
    const nested = firstLaunchableItem(asArray(item.item as Node | Node[]), resources);
    if (nested) return nested;
  }
  return null;
}

export function parseScormManifest(xml: string): ScormManifest {
  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', removeNSPrefix: false, processEntities: false });
  let doc: Node;
  try {
    doc = stripPrefixes(parser.parse(xml)) as Node;
  } catch {
    throw new Error('imsmanifest.xml is not valid XML.');
  }
  const manifest = doc.manifest as Node | undefined;
  if (!manifest) throw new Error('imsmanifest.xml has no <manifest> element.');

  const metadata = (manifest.metadata ?? {}) as Node;
  const schemaVersion = text(metadata.schemaversion);
  const version: ScormManifest['version'] = /^1\.2/.test(schemaVersion) ? '1.2' : schemaVersion ? '2004' : '1.2';

  const resourcesNode = (manifest.resources ?? {}) as Node;
  const resources = new Map<string, Node>();
  for (const resource of asArray(resourcesNode.resource as Node | Node[])) {
    if (typeof resource['@_identifier'] === 'string') resources.set(resource['@_identifier'], resource);
  }

  const organizations = (manifest.organizations ?? {}) as Node;
  const orgs = asArray(organizations.organization as Node | Node[]);
  const defaultId = organizations['@_default'];
  const org = orgs.find((candidate) => candidate['@_identifier'] === defaultId) ?? orgs[0];

  let launch = org ? firstLaunchableItem(asArray(org.item as Node | Node[]), resources) : null;
  if (!launch) {
    // No organisation to follow: take the first resource that is a SCO, then any with a page.
    const all = [...resources.values()];
    const sco = all.find((resource) => String(resource['@_scormtype'] ?? resource['@_scormType'] ?? '').toLowerCase() === 'sco' && resource['@_href']);
    const any = sco ?? all.find((resource) => resource['@_href']);
    if (any) launch = { item: {}, resource: any };
  }
  if (!launch) throw new Error('The manifest does not say which page to open.');

  const base = typeof launch.resource['@_base'] === 'string' ? String(launch.resource['@_base']) : '';
  const href = String(launch.resource['@_href']);
  const parameters = typeof launch.item['@_parameters'] === 'string' ? String(launch.item['@_parameters']) : '';
  const launchPath = `${base}${href}${parameters && !href.includes('?') ? (parameters.startsWith('?') ? parameters : `?${parameters}`) : ''}`.replace(/^\.?\//, '');

  const title = text(org?.title) || text(launch.item.title) || 'Untitled package';
  return { version, title, launchPath };
}

export function parseH5pManifest(json: string): H5pManifest {
  let data: Node;
  try {
    data = JSON.parse(json) as Node;
  } catch {
    throw new Error('h5p.json is not valid JSON.');
  }
  const mainLibrary = typeof data.mainLibrary === 'string' ? data.mainLibrary : '';
  if (!mainLibrary) throw new Error('h5p.json does not name its main library.');
  const title = typeof data.title === 'string' && data.title.trim() ? data.title.trim() : 'Untitled activity';
  return { title, mainLibrary };
}
