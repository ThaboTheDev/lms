import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { buildContentSecurityPolicy, createNonce, storageOrigin } from '../src/lib/security/csp';

const NONCE = 'bm9uY2Utbm9uY2Utbm9uY2U=';

function baseline(mode: 'production' | 'development', https = true) {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${NONCE}' 'strict-dynamic'${mode === 'development' ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    // Only this site's own sandboxed package player unless embed origins are passed.
    "frame-src 'self'",
    mode === 'production' ? "frame-ancestors 'none'" : 'frame-ancestors *',
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    ...(https ? ['upgrade-insecure-requests'] : []),
  ].join('; ');
}

function csp(endpoint: string | undefined, mode: 'production' | 'development', https = true) {
  return buildContentSecurityPolicy({ nonce: NONCE, storageEndpoint: endpoint, production: mode === 'production', https });
}

for (const mode of ['production', 'development'] as const) {
  describe(`content security policy (${mode})`, () => {
    it.each([undefined, '', 'not a URL', '/relative/path', 'ftp://files.example.com'])(
      'adds no storage origin for %s',
      (endpoint) => {
        expect(csp(endpoint, mode)).toBe(baseline(mode));
      },
    );

    it.each([
      ['https://s3.af-south-1.amazonaws.com', 'https://s3.af-south-1.amazonaws.com'],
      ['https://s3.af-south-1.amazonaws.com/path?query=1#fragment', 'https://s3.af-south-1.amazonaws.com'],
      ['http://localhost:9000/bucket', 'http://localhost:9000'],
    ])('allows only the origin of %s in the three storage directives', (endpoint, origin) => {
      const policy = csp(endpoint, mode);
      const directives = policy.split('; ');
      for (const name of ['connect-src', 'img-src', 'media-src']) {
        const directive = directives.find((value) => value.startsWith(`${name} `))!;
        expect(directive.split(' ').filter((value) => value === origin)).toHaveLength(1);
      }
      expect(policy.split(origin)).toHaveLength(4);
      expect(policy.replaceAll(` ${origin}`, '')).toBe(baseline(mode));
    });

    it('never allows inline script without the nonce', () => {
      const scripts = csp(undefined, mode).split('; ').find((value) => value.startsWith('script-src '))!;
      expect(scripts).toContain(`'nonce-${NONCE}'`);
      expect(scripts).not.toContain("'unsafe-inline'");
    });

    it('only asks the browser to upgrade requests on an HTTPS site', () => {
      expect(csp(undefined, mode, false)).toBe(baseline(mode, false));
      expect(csp(undefined, mode, false)).not.toContain('upgrade-insecure-requests');
    });
  });
}

describe('nonces', () => {
  it('are 128 random bits, base64, and different every time', () => {
    const seen = new Set(Array.from({ length: 50 }, () => createNonce()));
    expect(seen.size).toBe(50);
    for (const nonce of seen) expect(Buffer.from(nonce, 'base64')).toHaveLength(16);
  });
});

describe('storageOrigin', () => {
  it('keeps only http(s) origins', () => {
    expect(storageOrigin('https://r2.example.com/bucket/key')).toBe('https://r2.example.com');
    expect(storageOrigin('javascript:alert(1)')).toBeNull();
    expect(storageOrigin(null)).toBeNull();
  });
});

describe('next.config.mjs', () => {
  // A static policy there would be enforced alongside the per-request one and
  // block the scripts the nonce is meant to allow.
  it('does not set a second, static content security policy', () => {
    const keys = execFileSync(process.execPath, ['--input-type=module', '-e', `
      import config from './next.config.mjs';
      const rules = await config.headers();
      process.stdout.write(JSON.stringify(rules.flatMap((rule) => rule.headers.map((h) => h.key))));
    `], { cwd: process.cwd(), env: { ...process.env, NODE_ENV: 'production' }, encoding: 'utf8' });
    const headerKeys = JSON.parse(keys) as string[];
    expect(headerKeys).not.toContain('Content-Security-Policy');
    expect(headerKeys).toContain('Strict-Transport-Security');
    expect(headerKeys).toContain('X-Frame-Options');
  });
});
