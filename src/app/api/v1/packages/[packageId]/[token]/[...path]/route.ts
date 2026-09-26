import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import { contentTypeFor, isHtml, safeEntryPath } from '@/lib/packages/zip';
import { initialValues, scormShim } from '@/lib/packages/scorm-runtime';
import {
  learnerRuntimeState,
  packageForToken,
  readPackageFile,
  recordScormCommit,
  recordXapi,
  type PlayablePackage,
} from '@/server/services/packages';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Serves SCORM and H5P packages to the lesson page's frame.
 *
 * A package is somebody's JavaScript, so it runs in a sandbox without an
 * origin of its own: it cannot read this site's cookies or storage, or act as
 * the learner on any other page. That is set twice, by the frame's sandbox
 * attribute and by the policy on every response here. The frame therefore
 * sends no cookie either, so the credential is the signed token in the path,
 * which names one learner and one package and expires after a sitting.
 */
const SANDBOX_POLICY = [
  'sandbox allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads',
  "default-src 'self' https: data: blob: 'unsafe-inline' 'unsafe-eval'",
  "frame-ancestors 'self'",
  "base-uri 'self'",
].join('; ');

function headers(contentType: string, cache: 'asset' | 'fresh'): Record<string, string> {
  return {
    'Content-Type': contentType,
    'Content-Security-Policy': SANDBOX_POLICY,
    'X-Content-Type-Options': 'nosniff',
    // The frame's origin is opaque, so its fetches are cross-origin.
    'Access-Control-Allow-Origin': '*',
    // The path carries the token: never hand it to another site.
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': cache === 'asset' ? 'private, max-age=3600' : 'private, no-store',
  };
}

const expired = () =>
  new NextResponse('This link has expired. Reload the lesson page to open the activity again.', {
    status: 403,
    headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' },
  });

const notFound = () =>
  new NextResponse('Not found', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Access-Control-Allow-Origin': '*' } });

const VENDOR_DIR = path.join(process.cwd(), 'node_modules', 'h5p-standalone', 'dist');

function h5pPage(title: string): string {
  const safeTitle = title.replace(/[<>&"]/g, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${safeTitle}</title>
<link rel="stylesheet" href="vendor/styles/h5p.css">
<style>html,body{margin:0;padding:0;background:#fff}#h5p-container{min-height:100vh}</style>
</head>
<body>
<div id="h5p-container"></div>
<script src="vendor/main.bundle.js"></script>
<script src="player.js"></script>
</body>
</html>`;
}

function h5pPlayerScript(base: string): string {
  const embed = (value: string) => JSON.stringify(value).replace(/</g, '\\u003c');
  return `(function () {
  var base = ${embed(base)};
  var el = document.getElementById('h5p-container');
  new H5PStandalone.H5P(el, {
    h5pJsonPath: base,
    frameJs: base + '/__lms/vendor/frame.bundle.js',
    frameCss: base + '/__lms/vendor/styles/h5p.css',
    // Rendered straight into this page: the player's usual child frame would
    // get an origin of its own inside the sandbox, and it could not write to it.
    embedType: 'div',
    frame: false, copyright: false, export: false, embed: false, icon: false, fullScreen: true
  }).then(function () {
    H5P.externalDispatcher.on('xAPI', function (event) {
      var statement = event && event.data && event.data.statement;
      if (!statement) return;
      try {
        fetch(base + '/__lms/xapi', { method: 'POST', body: JSON.stringify(statement), headers: { 'Content-Type': 'text/plain' }, keepalive: true, mode: 'no-cors' });
      } catch (e) {}
      try { parent.postMessage({ type: 'lms:package', event: 'xapi', verb: statement.verb && statement.verb.id }, '*'); } catch (e) {}
    });
  });
})();
`;
}

/** Adds the runtime script to a SCORM page, first thing in its head, so the API exists before the package looks for it. */
function withShim(html: string, shimUrl: string): string {
  const tag = `<script src="${shimUrl}"></script>`;
  const head = html.match(/<head[^>]*>/i);
  if (head) return html.replace(head[0], `${head[0]}${tag}`);
  const htmlTag = html.match(/<html[^>]*>/i);
  if (htmlTag) return html.replace(htmlTag[0], `${htmlTag[0]}<head>${tag}</head>`);
  return `${tag}${html}`;
}

type Params = { params: Promise<{ packageId: string; token: string; path: string[] }> };

async function shimFor(pkg: PlayablePackage, userId: string, base: string): Promise<string> {
  const state = await learnerRuntimeState(pkg, userId);
  return scormShim({
    version: pkg.version,
    values: initialValues({
      version: pkg.version,
      stored: state.stored,
      learnerId: userId,
      learnerName: state.learnerName,
      totalTimeSec: state.totalTimeSec,
    }),
    commitUrl: `${base}/__lms/commit`,
    sessionId: randomUUID(),
  });
}

export async function GET(_request: NextRequest, { params }: Params) {
  const { packageId, token, path: segments } = await params;
  const found = await packageForToken(packageId, token);
  if (!found) return expired();
  const { pkg, userId } = found;
  const base = `/api/v1/packages/${packageId}/${token}`;
  const relative = segments.join('/');

  if (relative === '__lms/scorm-api.js') {
    return new NextResponse(await shimFor(pkg, userId, base), { headers: headers('text/javascript; charset=utf-8', 'fresh') });
  }
  if (relative === '__lms/h5p.html' && pkg.kind === 'H5P') {
    return new NextResponse(h5pPage(pkg.title), { headers: headers('text/html; charset=utf-8', 'fresh') });
  }
  if (relative === '__lms/player.js' && pkg.kind === 'H5P') {
    return new NextResponse(h5pPlayerScript(base), { headers: headers('text/javascript; charset=utf-8', 'fresh') });
  }
  if (relative.startsWith('__lms/vendor/')) {
    const vendorPath = safeEntryPath(relative.slice('__lms/vendor/'.length));
    if (!vendorPath) return notFound();
    const file = await readFile(path.join(VENDOR_DIR, vendorPath)).catch(() => null);
    if (!file) return notFound();
    return new NextResponse(new Uint8Array(file), { headers: headers(contentTypeFor(vendorPath), 'asset') });
  }

  const safe = safeEntryPath(relative);
  if (!safe) return notFound();
  const bytes = await readPackageFile(pkg, safe);
  if (!bytes) return notFound();

  if (pkg.kind === 'SCORM' && isHtml(safe)) {
    const html = withShim(new TextDecoder().decode(bytes), `${base}/__lms/scorm-api.js?at=${Date.now()}`);
    return new NextResponse(html, { headers: headers('text/html; charset=utf-8', 'fresh') });
  }
  return new NextResponse(new Uint8Array(bytes), { headers: headers(contentTypeFor(safe), isHtml(safe) ? 'fresh' : 'asset') });
}

/** Runtime reports: SCORM commits and H5P xAPI statements. Plain text bodies, so the sandboxed frame needs no preflight. */
export async function POST(request: NextRequest, { params }: Params) {
  const { packageId, token, path: segments } = await params;
  const found = await packageForToken(packageId, token);
  if (!found) return expired();
  const relative = segments.join('/');

  const text = await request.text();
  if (text.length > 1_500_000) return new NextResponse('Too large', { status: 413, headers: { 'Access-Control-Allow-Origin': '*' } });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return new NextResponse('Not JSON', { status: 400, headers: { 'Access-Control-Allow-Origin': '*' } });
  }

  if (relative === '__lms/commit') await recordScormCommit(found.pkg, found.userId, body);
  else if (relative === '__lms/xapi') await recordXapi(found.pkg, found.userId, body);
  else return notFound();

  return new NextResponse(null, { status: 204, headers: { 'Access-Control-Allow-Origin': '*' } });
}

export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Max-Age': '86400',
    },
  });
}
