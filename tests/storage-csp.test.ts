import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const baseline = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  'upgrade-insecure-requests',
].join('; ');

// A fresh Node process exercises the actual config, without cached environment
// values or a TypeScript declaration solely for importing Next's .mjs config.
function csp(endpoint: string | undefined, mode: 'production' | 'development'): string {
  const env: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: mode };
  delete env.S3_ENDPOINT;
  if (endpoint !== undefined) env.S3_ENDPOINT = endpoint;
  return execFileSync(process.execPath, ['--input-type=module', '-e', `
    import config from './next.config.mjs';
    const rules = await config.headers();
    process.stdout.write(rules[0].headers.find(h => h.key === 'Content-Security-Policy').value);
  `], { cwd: process.cwd(), env, encoding: 'utf8' });
}

for (const mode of ['production', 'development'] as const) {
  describe(`storage CSP (${mode})`, () => {
    const expected = mode === 'production'
      ? baseline
      : baseline.replace("frame-ancestors 'none'", 'frame-ancestors *');

    it.each([undefined, '', 'not a URL', '/relative/path'])('preserves the original policy for %s', (endpoint) => {
      expect(csp(endpoint, mode)).toBe(expected);
    });

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
      expect(policy.replaceAll(` ${origin}`, '')).toBe(expected);
    });
  });
}
