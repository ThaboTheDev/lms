/**
 * SCORM's runtime, the pure half. A package talks to the LMS through a
 * JavaScript object (`API` for SCORM 1.2, `API_1484_11` for 2004) that it
 * finds on its own window or a parent's. The player serves packages from this
 * origin inside a sandbox with no origin of its own, so the package cannot
 * reach the lesson page's window: the object is defined inside the frame by
 * the shim below, which keeps the values locally (the calls are synchronous)
 * and posts them to a URL carrying a signed token for this learner and package.
 *
 * Everything here is pure and tested; the route handler only moves the bytes.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

export type ScormVersion = '1.2' | '2004';
export type CmiValues = Record<string, string>;

/* ------------------------------------------------------------ tokens --- */

function tokenSignature(secret: string, packageId: string, userId: string, expires: number): string {
  return createHmac('sha256', secret).update(`package:${packageId}:${userId}:${expires}`).digest('base64url');
}

/** `<userId>.<expires>.<signature>`: safe in a URL path, and relative links inside the package keep it. */
export function signPackageToken(secret: string, packageId: string, userId: string, expiresAtSec: number): string {
  return `${userId}.${expiresAtSec}.${tokenSignature(secret, packageId, userId, expiresAtSec)}`;
}

export function verifyPackageToken(
  secret: string,
  packageId: string,
  token: string,
  nowSec = Math.floor(Date.now() / 1000),
): { userId: string } | null {
  const [userId, expiresRaw, signature] = token.split('.');
  if (!userId || !expiresRaw || !signature || !/^\d+$/.test(expiresRaw)) return null;
  const expires = Number(expiresRaw);
  if (expires < nowSec) return null;
  const expected = Buffer.from(tokenSignature(secret, packageId, userId, expires));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  return { userId };
}

/* -------------------------------------------------------------- time --- */

/** SCORM 1.2 CMITimespan (HHHH:MM:SS.SS) or 2004 ISO 8601 duration (PT1H2M3.5S), in seconds. */
export function parseScormTime(value: string | undefined | null): number {
  if (!value) return 0;
  const trimmed = value.trim();
  const colon = trimmed.match(/^(\d{1,4}):(\d{1,2}):(\d{1,2}(?:\.\d{1,2})?)$/);
  if (colon) return Number(colon[1]) * 3600 + Number(colon[2]) * 60 + Number(colon[3]);
  const iso = trimmed.match(/^P(?:(\d+(?:\.\d+)?)Y)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/);
  if (iso && trimmed !== 'P' && trimmed !== 'PT') {
    const [, y, mo, d, h, mi, s] = iso.map((part) => Number(part ?? 0));
    return (y! * 365 + mo! * 30 + d!) * 86400 + h! * 3600 + mi! * 60 + s!;
  }
  return 0;
}

export function formatScormTime(seconds: number, version: ScormVersion): string {
  const whole = Math.max(0, Math.round(seconds));
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  if (version === '1.2') return `${String(h).padStart(4, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.00`;
  return `PT${h}H${m}M${s}S`;
}

/* ----------------------------------------------------------- summary --- */

export interface CmiSummary {
  completion: string | null;
  success: string | null;
  scoreRaw: number | null;
  scoreMax: number | null;
  scoreScaled: number | null;
  location: string | null;
  suspendData: string | null;
  sessionTimeSec: number;
  completed: boolean;
}

const number = (value: string | undefined): number | null => {
  if (value === undefined || value.trim() === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

/** What a set of runtime values says about the attempt, in the same terms for both versions. */
export function summariseCmi(version: ScormVersion, values: CmiValues): CmiSummary {
  if (version === '1.2') {
    const status = values['cmi.core.lesson_status']?.trim() || null;
    const success = status === 'passed' || status === 'failed' ? status : null;
    return {
      completion: status,
      success,
      scoreRaw: number(values['cmi.core.score.raw']),
      scoreMax: number(values['cmi.core.score.max']),
      scoreScaled: null,
      location: values['cmi.core.lesson_location'] ?? null,
      suspendData: values['cmi.suspend_data'] ?? null,
      sessionTimeSec: parseScormTime(values['cmi.core.session_time']),
      completed: status === 'completed' || status === 'passed',
    };
  }
  const completion = values['cmi.completion_status']?.trim() || null;
  const success = values['cmi.success_status']?.trim() || null;
  return {
    completion,
    success,
    scoreRaw: number(values['cmi.score.raw']),
    scoreMax: number(values['cmi.score.max']),
    scoreScaled: number(values['cmi.score.scaled']),
    location: values['cmi.location'] ?? null,
    suspendData: values['cmi.suspend_data'] ?? null,
    sessionTimeSec: parseScormTime(values['cmi.session_time']),
    completed: completion === 'completed' || success === 'passed',
  };
}

/** Values the package may not set: identity, credit, mode, and the time the LMS adds up. */
const READ_ONLY_12 = /^cmi\.(core\.(student_id|student_name|credit|entry|total_time|lesson_mode)|launch_data|student_data\.)|\._(count|children)$/;
const READ_ONLY_2004 = /^cmi\.(learner_id|learner_name|credit|entry|total_time|mode|launch_data|completion_threshold|scaled_passing_score|max_time_allowed|time_limit_action)$|\._(count|children|version)$/;

/** Stored values the package sent, keeping only what it may set and not the one-session ones. */
export function storableValues(version: ScormVersion, values: unknown): CmiValues {
  if (!values || typeof values !== 'object') return {};
  const readOnly = version === '1.2' ? READ_ONLY_12 : READ_ONLY_2004;
  const sessionOnly = version === '1.2' ? /^cmi\.core\.(session_time|exit)$/ : /^cmi\.(session_time|exit)$|^adl\.nav\./;
  const out: CmiValues = {};
  let size = 0;
  for (const [key, raw] of Object.entries(values as Record<string, unknown>)) {
    if (typeof key !== 'string' || !/^(cmi|adl)\.[\w.]+$/.test(key) || key.length > 255) continue;
    if (readOnly.test(key) || sessionOnly.test(key)) continue;
    const value = String(raw ?? '').slice(0, 65_536);
    size += key.length + value.length;
    if (size > 1_000_000) break;
    out[key] = value;
  }
  return out;
}

/** What the package sees when it starts: what it stored last time, plus who, how long so far, and whether this is a resume. */
export function initialValues({
  version,
  stored,
  learnerId,
  learnerName,
  totalTimeSec,
}: {
  version: ScormVersion;
  stored: CmiValues;
  learnerId: string;
  learnerName: string;
  totalTimeSec: number;
}): CmiValues {
  const resuming = Boolean(stored['cmi.suspend_data'] || stored['cmi.core.lesson_location'] || stored['cmi.location']);
  if (version === '1.2') {
    return {
      'cmi.core.lesson_status': 'not attempted',
      ...stored,
      'cmi.core.student_id': learnerId,
      'cmi.core.student_name': learnerName,
      'cmi.core.credit': 'credit',
      'cmi.core.lesson_mode': 'normal',
      'cmi.core.entry': resuming ? 'resume' : 'ab-initio',
      'cmi.core.total_time': formatScormTime(totalTimeSec, '1.2'),
    };
  }
  return {
    'cmi.completion_status': 'unknown',
    'cmi.success_status': 'unknown',
    ...stored,
    'cmi.learner_id': learnerId,
    'cmi.learner_name': learnerName,
    'cmi.credit': 'credit',
    'cmi.mode': 'normal',
    'cmi.entry': resuming ? 'resume' : 'ab-initio',
    'cmi.total_time': formatScormTime(totalTimeSec, '2004'),
  };
}

/** Seconds spent across sessions, each counted once however often it committed. */
export function totalSessionSeconds(sessions: Record<string, number>): number {
  return Object.values(sessions).reduce((sum, seconds) => sum + (Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, 86_400) : 0), 0);
}

/* -------------------------------------------------------------- shim --- */

/**
 * The runtime objects, as a script for the package's own frame. It defines
 * both APIs whatever the manifest claims, because packages are not always
 * honest about their version.
 */
export function scormShim({
  version,
  values,
  commitUrl,
  sessionId,
}: {
  version: ScormVersion;
  values: CmiValues;
  commitUrl: string;
  sessionId: string;
}): string {
  // JSON inside a script: </script> and U+2028 must not end or break it.
  const embed = (data: unknown) =>
    JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');

  return `(function () {
  'use strict';
  var VERSION = ${embed(version)};
  var COMMIT_URL = ${embed(commitUrl)};
  var SESSION = ${embed(sessionId)};
  var values = ${embed(values)};
  var RO12 = ${READ_ONLY_12.toString()};
  var RO2004 = ${READ_ONLY_2004.toString()};
  var WO12 = /^cmi\\.core\\.(session_time|exit)$|^cmi\\.interactions\\.\\d+\\.(id|time|type|correct_responses|weighting|student_response|result|latency)/;
  var WO2004 = /^cmi\\.(session_time|exit)$/;
  var state = { v12: 'new', v2004: 'new' };
  var lastError = '0';
  var dirty = false;

  function send(final) {
    var body = JSON.stringify({ session: SESSION, version: VERSION, values: values, final: !!final });
    try {
      if (final && navigator.sendBeacon) {
        navigator.sendBeacon(COMMIT_URL, new Blob([body], { type: 'text/plain' }));
      } else {
        fetch(COMMIT_URL, { method: 'POST', body: body, headers: { 'Content-Type': 'text/plain' }, keepalive: true, mode: 'no-cors' });
      }
    } catch (e) {}
    dirty = false;
    try {
      var status = values['cmi.core.lesson_status'] || values['cmi.completion_status'] || '';
      var success = values['cmi.success_status'] || '';
      parent.postMessage({ type: 'lms:package', event: final ? 'finish' : 'commit', status: status, success: success }, '*');
    } catch (e) {}
  }

  function count(key) {
    var prefix = key.replace(/_count$/, '');
    var max = -1;
    for (var k in values) {
      if (k.indexOf(prefix) === 0) {
        var index = parseInt(k.slice(prefix.length), 10);
        if (!isNaN(index) && index > max) max = index;
      }
    }
    return String(max + 1);
  }

  function get(key, writeOnly, notInit, which) {
    if (state[which] !== 'running') { lastError = notInit; return ''; }
    if (writeOnly.test(key)) { lastError = which === 'v12' ? '404' : '405'; return ''; }
    lastError = '0';
    if (/\\._count$/.test(key)) return count(key);
    if (/\\._children$/.test(key)) return '';
    return Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : '';
  }

  function set(key, value, readOnly, notInit, which) {
    if (state[which] !== 'running') { lastError = notInit; return 'false'; }
    if (readOnly.test(key)) { lastError = which === 'v12' ? '403' : '404'; return 'false'; }
    values[key] = String(value);
    dirty = true;
    lastError = '0';
    return 'true';
  }

  var ERRORS = {
    '0': 'No error', '101': 'General exception', '103': 'Already initialized', '104': 'Content instance terminated',
    '112': 'Termination before initialization', '113': 'Termination after termination', '122': 'Retrieve data before initialization',
    '123': 'Retrieve data after termination', '132': 'Store data before initialization', '133': 'Store data after termination',
    '142': 'Commit before initialization', '143': 'Commit after termination', '301': 'Not initialized',
    '401': 'Not implemented', '403': 'Element is read only', '404': 'Element is write only', '405': 'Element is write only'
  };

  window.API = {
    LMSInitialize: function () { if (state.v12 === 'running') { lastError = '101'; return 'false'; } state.v12 = 'running'; lastError = '0'; return 'true'; },
    LMSFinish: function () { if (state.v12 !== 'running') { lastError = '301'; return 'false'; } send(true); state.v12 = 'done'; lastError = '0'; return 'true'; },
    LMSGetValue: function (key) { return get(String(key), WO12, '301', 'v12'); },
    LMSSetValue: function (key, value) { return set(String(key), value, RO12, '301', 'v12'); },
    LMSCommit: function () { if (state.v12 !== 'running') { lastError = '301'; return 'false'; } send(false); lastError = '0'; return 'true'; },
    LMSGetLastError: function () { return lastError; },
    LMSGetErrorString: function (code) { return ERRORS[String(code)] || ''; },
    LMSGetDiagnostic: function (code) { return ERRORS[String(code || lastError)] || ''; }
  };

  window.API_1484_11 = {
    Initialize: function () { if (state.v2004 === 'running') { lastError = '103'; return 'false'; } if (state.v2004 === 'done') { lastError = '104'; return 'false'; } state.v2004 = 'running'; lastError = '0'; return 'true'; },
    Terminate: function () { if (state.v2004 === 'new') { lastError = '112'; return 'false'; } if (state.v2004 === 'done') { lastError = '113'; return 'false'; } send(true); state.v2004 = 'done'; lastError = '0'; return 'true'; },
    GetValue: function (key) { return get(String(key), WO2004, state.v2004 === 'done' ? '123' : '122', 'v2004'); },
    SetValue: function (key, value) { return set(String(key), value, RO2004, state.v2004 === 'done' ? '133' : '132', 'v2004'); },
    Commit: function () { if (state.v2004 !== 'running') { lastError = state.v2004 === 'done' ? '143' : '142'; return 'false'; } send(false); lastError = '0'; return 'true'; },
    GetLastError: function () { return lastError; },
    GetErrorString: function (code) { return ERRORS[String(code)] || ''; },
    GetDiagnostic: function (code) { return ERRORS[String(code || lastError)] || ''; }
  };

  // Packages that never commit still get their progress kept.
  setInterval(function () { if (dirty) send(false); }, 30000);
  window.addEventListener('pagehide', function () { if (dirty) send(true); });
})();
`;
}
