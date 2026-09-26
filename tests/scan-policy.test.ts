import { createServer, type AddressInfo } from 'node:net';
import { describe, expect, it } from 'vitest';
import { clamdAddress, clamdScan, frameInstream, parseClamdReply } from '@/lib/storage/clamd';
import { downloadDecision } from '@/lib/storage/scan-policy';

describe('downloadDecision', () => {
  const base = { scannerConfigured: true, isUploader: false };

  it('never serves an infected file, not even to its uploader', () => {
    expect(downloadDecision({ ...base, scanStatus: 'INFECTED' })).toBe('withheld');
    expect(downloadDecision({ ...base, scanStatus: 'INFECTED', isUploader: true })).toBe('withheld');
    expect(downloadDecision({ ...base, scanStatus: 'INFECTED', scannerConfigured: false })).toBe('withheld');
  });

  it('with a scanner, serves other people only what it cleared', () => {
    expect(downloadDecision({ ...base, scanStatus: 'CLEAN' })).toBe('serve');
    expect(downloadDecision({ ...base, scanStatus: 'PENDING' })).toBe('scanning');
    expect(downloadDecision({ ...base, scanStatus: 'SKIPPED' })).toBe('scanning');
  });

  it('lets the uploader fetch their own file back while it waits', () => {
    expect(downloadDecision({ ...base, scanStatus: 'PENDING', isUploader: true })).toBe('serve');
  });

  it('without a scanner, holds nothing back for want of a check', () => {
    expect(downloadDecision({ scanStatus: 'SKIPPED', scannerConfigured: false, isUploader: false })).toBe('serve');
    expect(downloadDecision({ scanStatus: 'PENDING', scannerConfigured: false, isUploader: false })).toBe('serve');
  });
});

describe('clamd protocol', () => {
  it('reads the three kinds of answer', () => {
    expect(parseClamdReply('stream: OK\0')).toEqual({ verdict: 'CLEAN', detail: null });
    expect(parseClamdReply('stream: Win.Test.EICAR_HDB-1 FOUND\0')).toEqual({ verdict: 'INFECTED', detail: 'Win.Test.EICAR_HDB-1' });
    expect(parseClamdReply('INSTREAM size limit exceeded. ERROR\0').verdict).toBe('FAILED');
    expect(parseClamdReply('').verdict).toBe('FAILED');
  });

  it('frames the stream as length-prefixed chunks ending in a zero length', () => {
    const frames = frameInstream(new Uint8Array([1, 2, 3, 4, 5]), 2);
    expect(frames[0]!.toString()).toBe('zINSTREAM\0');
    const lengths = frames.slice(1).filter((_, index) => index % 2 === 0).map((frame) => frame.readUInt32BE(0));
    expect(lengths).toEqual([2, 2, 1, 0]);
  });

  it('understands clamd:// and tcp:// addresses and nothing else', () => {
    expect(clamdAddress('clamd://clamav:3310')).toEqual({ host: 'clamav', port: 3310 });
    expect(clamdAddress('tcp://10.0.0.5')).toEqual({ host: '10.0.0.5', port: 3310 });
    expect(clamdAddress('https://scanner.example.com/scan')).toBeNull();
    expect(clamdAddress('not a url')).toBeNull();
  });

  /** A stand-in daemon that speaks INSTREAM and flags a marker string. */
  function fakeClamd(): Promise<{ port: number; close: () => void; received: Buffer[] }> {
    const received: Buffer[] = [];
    const server = createServer((socket) => {
      let buffer = Buffer.alloc(0);
      socket.on('data', (data) => {
        buffer = Buffer.concat([buffer, data]);
        if (!buffer.subarray(0, 10).equals(Buffer.from('zINSTREAM\0'))) return;
        let offset = 10;
        const chunks: Buffer[] = [];
        while (offset + 4 <= buffer.length) {
          const length = buffer.readUInt32BE(offset);
          if (length === 0) {
            const body = Buffer.concat(chunks);
            received.push(body);
            socket.end(body.includes('MALWARE-TEST-MARKER') ? 'stream: Test.Marker FOUND\0' : 'stream: OK\0');
            return;
          }
          if (offset + 4 + length > buffer.length) return;
          chunks.push(buffer.subarray(offset + 4, offset + 4 + length));
          offset += 4 + length;
        }
      });
    });
    return new Promise((resolve) =>
      server.listen(0, '127.0.0.1', () =>
        resolve({ port: (server.address() as AddressInfo).port, close: () => server.close(), received }),
      ),
    );
  }

  it('streams a file to the daemon and returns its verdict', async () => {
    const clamd = await fakeClamd();
    try {
      const big = new Uint8Array(200_000).fill(65);
      expect(await clamdScan('127.0.0.1', clamd.port, big, 5000)).toEqual({ verdict: 'CLEAN', detail: null });
      expect(clamd.received[0]!.length).toBe(200_000);

      const flagged = new TextEncoder().encode('hello MALWARE-TEST-MARKER world');
      expect(await clamdScan('127.0.0.1', clamd.port, flagged, 5000)).toEqual({ verdict: 'INFECTED', detail: 'Test.Marker' });
    } finally {
      clamd.close();
    }
  });

  it('reports an unreachable daemon as FAILED rather than throwing', async () => {
    const result = await clamdScan('127.0.0.1', 1, new Uint8Array([1]), 2000);
    expect(result.verdict).toBe('FAILED');
  });
});
