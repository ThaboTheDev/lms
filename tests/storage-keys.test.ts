import { describe, expect, it } from 'vitest';
import {
  buildStorageKey,
  checkUpload,
  humanFileSize,
  isPreviewable,
  keyBelongsToInstitution,
  sanitiseFilename,
} from '@/lib/storage/keys';

const policy = { maxBytes: 50 * 1024 * 1024 };

describe('upload policy', () => {
  it('accepts the kinds of file coursework is made of', () => {
    expect(checkUpload('application/pdf', 1024, policy).ok).toBe(true);
    expect(checkUpload('video/mp4', 1024, policy).ok).toBe(true);
  });

  it('refuses anything outside the allowlist', () => {
    const result = checkUpload('application/x-msdownload', 1024, policy);
    expect(result.ok).toBe(false);
    expect(result.problem).toContain('not accepted');
  });

  it('refuses an empty file', () => {
    expect(checkUpload('application/pdf', 0, policy).ok).toBe(false);
  });

  it('refuses a file over the limit and says what the limit is', () => {
    const result = checkUpload('video/mp4', 60 * 1024 * 1024, policy);
    expect(result.ok).toBe(false);
    expect(result.problem).toContain('50 MB');
  });

  it('accepts an extra type only where a context allows it', () => {
    expect(checkUpload('application/octet-stream', 10, policy).ok).toBe(false);
    expect(
      checkUpload('application/octet-stream', 10, { ...policy, extraMimeTypes: ['application/octet-stream'] }).ok,
    ).toBe(true);
  });
});

describe('storage keys', () => {
  it('strips a path out of an uploaded filename', () => {
    expect(sanitiseFilename('../../etc/passwd')).toBe('passwd');
    expect(sanitiseFilename('Week 1 notes (final).pdf')).toBe('Week_1_notes_final_.pdf');
  });

  it('prefixes every object with the institution', () => {
    const key = buildStorageKey('inst_1', 'course-content', 'notes.pdf', new Date(1_700_000_000_000));
    expect(key).toBe('inst_1/course-content/1700000000000-notes.pdf');
  });

  it('refuses a folder that tries to climb out of the prefix', () => {
    const key = buildStorageKey('inst_1', '../other', 'notes.pdf', new Date(1_700_000_000_000));
    expect(key.startsWith('inst_1/')).toBe(true);
    expect(key).not.toContain('..');
  });

  it('only recognises keys inside the caller institution', () => {
    expect(keyBelongsToInstitution('inst_1/library/a.pdf', 'inst_1')).toBe(true);
    expect(keyBelongsToInstitution('inst_2/library/a.pdf', 'inst_1')).toBe(false);
    expect(keyBelongsToInstitution('inst_1/../inst_2/a.pdf', 'inst_1')).toBe(false);
    expect(keyBelongsToInstitution('/inst_1/a.pdf', 'inst_1')).toBe(false);
  });
});

describe('presentation helpers', () => {
  it('knows what a browser can show inline', () => {
    expect(isPreviewable('application/pdf')).toBe(true);
    expect(isPreviewable('image/png')).toBe(true);
    expect(isPreviewable('application/zip')).toBe(false);
  });

  it('reports sizes the way a person reads them', () => {
    expect(humanFileSize(900)).toBe('900 B');
    expect(humanFileSize(2048)).toBe('2 KB');
    expect(humanFileSize(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(humanFileSize(BigInt(3 * 1024 * 1024 * 1024))).toBe('3.00 GB');
  });
});
