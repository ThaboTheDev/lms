/**
 * src/lib/storage/scan.ts
 *
 * Malware scanning behind one function.
 *
 * The verdict is recorded on the file, and the distinction between the verdicts
 * is the whole point: a file that no scanner looked at is `SKIPPED`, not
 * `CLEAN`, because an institution asked at an audit what it checked should be
 * able to answer honestly. A file the scanner could not be reached for is
 * `FAILED`, which leaves it pending for the next sweep rather than recording a
 * verdict nobody arrived at.
 *
 * With no `MALWARE_SCANNER_URL` configured nothing is claimed and nothing is
 * blocked: uploads carry on and are marked skipped.
 */
import 'server-only';
import { env } from '@/lib/env';

export type ScanVerdict = 'CLEAN' | 'INFECTED' | 'SKIPPED' | 'FAILED';

export interface ScanResult {
  verdict: ScanVerdict;
  /** What the scanner said, or why it could not say anything. */
  detail: string | null;
}

/**
 * Long enough for a scanner to pull a large recording across, short enough that
 * a hung scanner does not hold a worker indefinitely.
 */
const SCAN_TIMEOUT_MS = 30_000;

/** What the scanner is expected to answer with. */
interface ScannerResponse {
  clean?: unknown;
  infected?: unknown;
  threat?: unknown;
}

/**
 * Asks the configured scanner about a stored object.
 *
 * Every failure becomes a `FAILED` verdict rather than an exception: a scanner
 * that is down or misconfigured is not the uploader's problem, and throwing
 * here would only retry the job until the queue gives up.
 */
export async function scanFile(storageKey: string): Promise<ScanResult> {
  const scannerUrl = env.MALWARE_SCANNER_URL;
  if (!scannerUrl) {
    return { verdict: 'SKIPPED', detail: 'No scanner is configured.' };
  }

  try {
    const response = await fetch(scannerUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(env.MALWARE_SCANNER_TOKEN
          ? { authorization: `Bearer ${env.MALWARE_SCANNER_TOKEN}` }
          : {}),
      },
      body: JSON.stringify({ storageKey }),
      signal: AbortSignal.timeout(SCAN_TIMEOUT_MS),
    });

    if (!response.ok) {
      return { verdict: 'FAILED', detail: `The scanner answered ${response.status}.` };
    }

    const body = (await response.json()) as ScannerResponse;

    if (body.infected === true || body.clean === false) {
      return {
        verdict: 'INFECTED',
        detail: typeof body.threat === 'string' ? body.threat : 'The scanner flagged this file.',
      };
    }

    if (body.clean === true || body.infected === false) {
      return { verdict: 'CLEAN', detail: null };
    }

    return { verdict: 'FAILED', detail: 'The scanner returned a verdict this application cannot read.' };
  } catch (error) {
    return {
      verdict: 'FAILED',
      detail: error instanceof Error ? error.message : 'The scanner could not be reached.',
    };
  }
}
