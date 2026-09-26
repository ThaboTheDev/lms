import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { commonRoot, contentTypeFor, safeEntryPath } from '@/lib/packages/zip';
import { parseH5pManifest, parseScormManifest } from '@/lib/packages/manifest';
import {
  formatScormTime,
  initialValues,
  parseScormTime,
  scormShim,
  signPackageToken,
  storableValues,
  summariseCmi,
  totalSessionSeconds,
  verifyPackageToken,
} from '@/lib/packages/scorm-runtime';
import { formatLessonRef, parseLessonRef, refFitsType } from '@/lib/lesson-links';

describe('archive entries', () => {
  it('keeps ordinary paths and refuses anything that could escape or is metadata', () => {
    expect(safeEntryPath('index.html')).toBe('index.html');
    expect(safeEntryPath('./res/a b.js')).toBe('res/a b.js');
    expect(safeEntryPath('res\\win.js')).toBe('res/win.js');
    for (const bad of ['../etc/passwd', 'a/../../b', '/abs/path', 'C:/x', 'folder/', '__MACOSX/._index.html', 'x/.DS_Store', '__lms/scorm-api.js']) {
      expect(safeEntryPath(bad)).toBeNull();
    }
  });

  it('drops a single top-level folder only when the manifest is inside it', () => {
    expect(commonRoot(['course/imsmanifest.xml', 'course/index.html'], 'imsmanifest.xml')).toBe('course/');
    expect(commonRoot(['imsmanifest.xml', 'index.html'], 'imsmanifest.xml')).toBe('');
    expect(commonRoot(['a/imsmanifest.xml', 'b/index.html'], 'imsmanifest.xml')).toBe('');
  });

  it('serves the right types', () => {
    expect(contentTypeFor('a/b/index.HTML')).toContain('text/html');
    expect(contentTypeFor('x.woff2')).toBe('font/woff2');
    expect(contentTypeFor('noextension')).toBe('application/octet-stream');
  });
});

const SCORM_12 = `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="m1" version="1.0" xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="org1">
    <organization identifier="org1">
      <title>Workplace safety</title>
      <item identifier="i1" identifierref="r1" isvisible="true"><title>Module 1</title></item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="r1" type="webcontent" adlcp:scormtype="sco" href="shared/launch.html"><file href="shared/launch.html"/></resource>
  </resources>
</manifest>`;

const SCORM_2004 = `<?xml version="1.0"?>
<manifest identifier="m2" xmlns="http://www.imsglobal.org/xsd/imscp_v1p1" xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_v1p3">
  <metadata><schema>ADL SCORM</schema><schemaversion>2004 4th Edition</schemaversion></metadata>
  <organizations default="ORG">
    <organization identifier="ORG">
      <title>Consumer law</title>
      <item identifier="parent"><title>Part A</title>
        <item identifier="child" identifierref="RES" parameters="?chapter=1"><title>Chapter 1</title></item>
      </item>
    </organization>
  </organizations>
  <resources>
    <resource identifier="RES" adlcp:scormType="sco" xml:base="content/" href="index.html"/>
  </resources>
</manifest>`;

describe('manifests', () => {
  it('reads a SCORM 1.2 manifest', () => {
    expect(parseScormManifest(SCORM_12)).toEqual({ version: '1.2', title: 'Workplace safety', launchPath: 'shared/launch.html' });
  });

  it('reads a SCORM 2004 manifest with nested items, a base and parameters', () => {
    expect(parseScormManifest(SCORM_2004)).toEqual({ version: '2004', title: 'Consumer law', launchPath: 'content/index.html?chapter=1' });
  });

  it('explains a manifest it cannot use', () => {
    expect(() => parseScormManifest('<not-xml')).toThrow();
    expect(() => parseScormManifest('<other/>')).toThrow(/manifest/);
    expect(() => parseScormManifest('<manifest><resources/></manifest>')).toThrow(/which page/);
  });

  it('reads h5p.json', () => {
    expect(parseH5pManifest('{"title":"Quiz","mainLibrary":"H5P.MultiChoice"}')).toEqual({ title: 'Quiz', mainLibrary: 'H5P.MultiChoice' });
    expect(() => parseH5pManifest('{"title":"x"}')).toThrow(/main library/);
    expect(() => parseH5pManifest('nope')).toThrow(/JSON/);
  });
});

describe('launch tokens', () => {
  const secret = 'test-secret';
  const now = 1_800_000_000;

  it('verifies for the package and learner it was issued for, until it expires', () => {
    const token = signPackageToken(secret, 'pkg1', 'user1', now + 60);
    expect(verifyPackageToken(secret, 'pkg1', token, now)).toEqual({ userId: 'user1' });
    expect(verifyPackageToken(secret, 'pkg1', token, now + 61)).toBeNull();
    expect(verifyPackageToken(secret, 'pkg2', token, now)).toBeNull();
    expect(verifyPackageToken('other-secret', 'pkg1', token, now)).toBeNull();
  });

  it('refuses a token whose learner or expiry was changed', () => {
    const token = signPackageToken(secret, 'pkg1', 'user1', now + 60);
    const [, expires, signature] = token.split('.');
    expect(verifyPackageToken(secret, 'pkg1', `user2.${expires}.${signature}`, now)).toBeNull();
    expect(verifyPackageToken(secret, 'pkg1', `user1.${Number(expires) + 9999}.${signature}`, now)).toBeNull();
    expect(verifyPackageToken(secret, 'pkg1', 'garbage', now)).toBeNull();
  });

  it('is safe in a URL path', () => {
    expect(signPackageToken(secret, 'p', 'cmabc123', now)).toMatch(/^[\w.-]+$/);
  });
});

describe('runtime values', () => {
  it('reads both SCORM time formats and writes them back', () => {
    expect(parseScormTime('0001:02:03.50')).toBe(3723.5);
    expect(parseScormTime('PT1H2M3.5S')).toBe(3723.5);
    expect(parseScormTime('P1DT1S')).toBe(86401);
    expect(parseScormTime('nonsense')).toBe(0);
    expect(formatScormTime(3723, '1.2')).toBe('0001:02:03.00');
    expect(formatScormTime(3723, '2004')).toBe('PT1H2M3S');
  });

  it('summarises a SCORM 1.2 attempt', () => {
    const summary = summariseCmi('1.2', {
      'cmi.core.lesson_status': 'passed',
      'cmi.core.score.raw': '85',
      'cmi.core.score.max': '100',
      'cmi.core.session_time': '00:10:00',
      'cmi.core.lesson_location': 'page-7',
    });
    expect(summary).toMatchObject({ completion: 'passed', success: 'passed', scoreRaw: 85, scoreMax: 100, sessionTimeSec: 600, location: 'page-7', completed: true });
  });

  it('summarises a SCORM 2004 attempt', () => {
    const summary = summariseCmi('2004', {
      'cmi.completion_status': 'incomplete',
      'cmi.success_status': 'unknown',
      'cmi.score.scaled': '0.4',
      'cmi.session_time': 'PT5M',
    });
    expect(summary).toMatchObject({ completion: 'incomplete', success: 'unknown', scoreScaled: 0.4, sessionTimeSec: 300, completed: false });
  });

  it('stores only what a package may set, never identity or one-session values', () => {
    const stored = storableValues('1.2', {
      'cmi.core.student_id': 'someone-else',
      'cmi.core.total_time': '9999:00:00',
      'cmi.core.session_time': '00:01:00',
      'cmi.core.lesson_status': 'incomplete',
      'cmi.suspend_data': 'abc',
      'not.cmi': 'x',
    });
    expect(stored).toEqual({ 'cmi.core.lesson_status': 'incomplete', 'cmi.suspend_data': 'abc' });
  });

  it('starts a package with who, how long so far, and whether it resumes', () => {
    const fresh = initialValues({ version: '1.2', stored: {}, learnerId: 'u1', learnerName: 'Mokoena, Lerato', totalTimeSec: 0 });
    expect(fresh['cmi.core.entry']).toBe('ab-initio');
    expect(fresh['cmi.core.lesson_status']).toBe('not attempted');
    const resumed = initialValues({ version: '2004', stored: { 'cmi.suspend_data': 'x' }, learnerId: 'u1', learnerName: 'L', totalTimeSec: 90 });
    expect(resumed['cmi.entry']).toBe('resume');
    expect(resumed['cmi.total_time']).toBe('PT0H1M30S');
  });

  it('counts each session once however often it committed', () => {
    expect(totalSessionSeconds({ a: 600, b: 300, c: -5 })).toBe(900);
  });
});

/** Runs the shim in a bare context with a fake browser around it. */
function runShim(version: '1.2' | '2004', values: Record<string, string>) {
  const posts: { url: string; body: unknown }[] = [];
  const messages: unknown[] = [];
  const window: Record<string, unknown> = { addEventListener: () => undefined };
  const context = {
    window,
    navigator: { sendBeacon: (url: string, blob: { text: string }) => { posts.push({ url, body: JSON.parse(blob.text) }); return true; } },
    fetch: (url: string, init: { body: string }) => { posts.push({ url, body: JSON.parse(init.body) }); return Promise.resolve(); },
    Blob: class { text: string; constructor(parts: string[]) { this.text = parts.join(''); } },
    parent: { postMessage: (message: unknown) => messages.push(message) },
    setInterval: () => 0,
  };
  runInNewContext(scormShim({ version, values, commitUrl: '/api/v1/packages/p/t/__lms/commit', sessionId: 's1' }), context);
  return { api12: window.API as Record<string, (...args: string[]) => string>, api2004: window.API_1484_11 as Record<string, (...args: string[]) => string>, posts, messages };
}

describe('the runtime shim', () => {
  it('implements the SCORM 1.2 calls a package makes, and commits what it set', () => {
    const { api12: api, posts, messages } = runShim('1.2', { 'cmi.core.student_name': 'Mokoena, Lerato', 'cmi.core.lesson_status': 'not attempted' });
    expect(api.LMSGetValue!('cmi.core.lesson_status')).toBe('');
    expect(api.LMSGetLastError!()).toBe('301');
    expect(api.LMSInitialize!('')).toBe('true');
    expect(api.LMSGetValue!('cmi.core.student_name')).toBe('Mokoena, Lerato');
    expect(api.LMSSetValue!('cmi.core.student_name', 'Someone Else')).toBe('false');
    expect(api.LMSGetLastError!()).toBe('403');
    expect(api.LMSSetValue!('cmi.core.lesson_status', 'completed')).toBe('true');
    expect(api.LMSSetValue!('cmi.interactions.0.id', 'q1')).toBe('true');
    expect(api.LMSSetValue!('cmi.interactions.1.id', 'q2')).toBe('true');
    expect(api.LMSGetValue!('cmi.interactions._count')).toBe('2');
    expect(api.LMSGetValue!('cmi.core.session_time')).toBe('');
    expect(api.LMSGetLastError!()).toBe('404');
    expect(api.LMSCommit!('')).toBe('true');
    expect(api.LMSFinish!('')).toBe('true');

    expect(posts).toHaveLength(2);
    expect(posts[0]!.url).toBe('/api/v1/packages/p/t/__lms/commit');
    expect(posts[1]!.body).toMatchObject({ session: 's1', final: true, values: { 'cmi.core.lesson_status': 'completed' } });
    expect(messages.at(-1)).toMatchObject({ type: 'lms:package', event: 'finish', status: 'completed' });
  });

  it('implements the SCORM 2004 calls with their error codes', () => {
    const { api2004: api, posts } = runShim('2004', { 'cmi.learner_id': 'u1' });
    expect(api.Terminate!('')).toBe('false');
    expect(api.GetLastError!()).toBe('112');
    expect(api.Initialize!('')).toBe('true');
    expect(api.Initialize!('')).toBe('false');
    expect(api.GetLastError!()).toBe('103');
    expect(api.SetValue!('cmi.learner_id', 'x')).toBe('false');
    expect(api.GetLastError!()).toBe('404');
    expect(api.SetValue!('cmi.completion_status', 'completed')).toBe('true');
    expect(api.SetValue!('cmi.success_status', 'passed')).toBe('true');
    expect(api.Terminate!('')).toBe('true');
    expect(api.GetValue!('cmi.learner_id')).toBe('');
    expect(api.GetLastError!()).toBe('123');
    expect(posts.at(-1)!.body).toMatchObject({ final: true, values: { 'cmi.completion_status': 'completed', 'cmi.success_status': 'passed' } });
  });

  it('cannot be broken out of its script by the values it carries', () => {
    const script = scormShim({ version: '1.2', values: { 'cmi.suspend_data': '</script><script>alert(1)</script>\u2028' }, commitUrl: '/c', sessionId: 's' });
    expect(script).not.toContain('</script>');
    expect(script).not.toContain('\u2028');
  });
});

describe('lesson links', () => {
  it('round-trips references and refuses malformed ones', () => {
    expect(parseLessonRef(formatLessonRef('assessment', 'cm123'))).toEqual({ kind: 'assessment', id: 'cm123' });
    expect(parseLessonRef('nope:cm123')).toBeNull();
    expect(parseLessonRef('assessment:')).toBeNull();
    expect(parseLessonRef('assessment:../../x')).toBeNull();
    expect(parseLessonRef(null)).toBeNull();
  });

  it('lets each lesson type link only to its own kind of thing', () => {
    expect(refFitsType('ASSESSMENT', 'assessment:a1')).toBe(true);
    expect(refFitsType('ASSESSMENT', 'live:a1')).toBe(false);
    expect(refFitsType('DISCUSSION', 'thread:t1')).toBe(true);
    expect(refFitsType('DISCUSSION', 'forum:f1')).toBe(true);
    expect(refFitsType('SCORM', 'package:p1')).toBe(true);
    expect(refFitsType('PAGE', 'assessment:a1')).toBe(false);
  });
});
