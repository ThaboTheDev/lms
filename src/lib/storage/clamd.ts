/**
 * src/lib/storage/clamd.ts
 *
 * A ClamAV daemon speaks a small TCP protocol. `INSTREAM` takes the file as
 * length-prefixed chunks and answers with one line: `stream: OK` or
 * `stream: <signature> FOUND`. Nothing here needs an account with anybody:
 * point MALWARE_SCANNER_URL at clamd://host:3310 and run the clamav/clamav
 * image (the production compose file has it behind the `scanner` profile).
 *
 * The parsing is pure and tested; the socket code only moves bytes.
 */
import { connect } from 'node:net';

export interface ClamdVerdict {
  verdict: 'CLEAN' | 'INFECTED' | 'FAILED';
  detail: string | null;
}

/** clamd's reply to a z-prefixed command, which ends in a NUL. */
export function parseClamdReply(reply: string): ClamdVerdict {
  const text = reply.replace(/\0/g, '').trim();
  if (/^(?:stream|[^:]+): OK$/.test(text)) return { verdict: 'CLEAN', detail: null };
  const found = text.match(/^(?:stream|[^:]+): (.+) FOUND$/);
  if (found) return { verdict: 'INFECTED', detail: found[1]!.trim() };
  return { verdict: 'FAILED', detail: text ? `clamd said: ${text}` : 'clamd closed the connection without an answer.' };
}

/** The INSTREAM framing: each chunk prefixed with its length, then a zero length to end. */
export function frameInstream(bytes: Uint8Array, chunkSize = 64 * 1024): Buffer[] {
  const frames: Buffer[] = [Buffer.from('zINSTREAM\0')];
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(chunk.length, 0);
    frames.push(length, Buffer.from(chunk));
  }
  frames.push(Buffer.alloc(4));
  return frames;
}

/** Where a clamd:// or tcp:// URL points. */
export function clamdAddress(url: string): { host: string; port: number } | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'clamd:' && parsed.protocol !== 'tcp:') return null;
    return { host: parsed.hostname, port: parsed.port ? Number(parsed.port) : 3310 };
  } catch {
    return null;
  }
}

/** Sends the bytes to clamd and reads its verdict. Never throws: a failure is a FAILED verdict. */
export function clamdScan(host: string, port: number, bytes: Uint8Array, timeoutMs: number): Promise<ClamdVerdict> {
  return new Promise((resolve) => {
    let reply = '';
    let settled = false;
    const finish = (verdict: ClamdVerdict) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(verdict);
    };

    const socket = connect({ host, port }, () => {
      for (const frame of frameInstream(bytes)) socket.write(frame);
    });
    socket.setTimeout(timeoutMs, () => finish({ verdict: 'FAILED', detail: `clamd did not answer within ${timeoutMs / 1000} seconds.` }));
    socket.on('data', (data) => {
      reply += data.toString('utf8');
      if (reply.includes('\0')) finish(parseClamdReply(reply));
    });
    socket.on('end', () => finish(parseClamdReply(reply)));
    socket.on('error', (error) => finish({ verdict: 'FAILED', detail: `clamd could not be reached: ${error.message}` }));
  });
}
