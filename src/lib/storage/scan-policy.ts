/**
 * Whether a stored file may be handed to somebody, given what the malware scan
 * said about it.
 *
 * - An infected file is never served, to anybody.
 * - With no scanner configured nothing is checked, so nothing can be held
 *   back for want of a check: files are served and marked SKIPPED.
 * - With a scanner configured, only a file it cleared is served to other
 *   people. A file still waiting (or uploaded before the scanner existed, and
 *   queued for it since) is held for the minute or so that takes.
 * - The person who uploaded a file can always fetch it back: they already have
 *   it, and it is how they check what they sent.
 */
export type ScanStatus = 'PENDING' | 'CLEAN' | 'INFECTED' | 'SKIPPED';

export type DownloadDecision = 'serve' | 'withheld' | 'scanning';

export function downloadDecision({
  scanStatus,
  scannerConfigured,
  isUploader,
}: {
  scanStatus: ScanStatus | string;
  scannerConfigured: boolean;
  isUploader: boolean;
}): DownloadDecision {
  if (scanStatus === 'INFECTED') return 'withheld';
  if (isUploader || !scannerConfigured) return 'serve';
  return scanStatus === 'CLEAN' ? 'serve' : 'scanning';
}
