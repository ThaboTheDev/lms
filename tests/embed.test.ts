import { describe, expect, it } from 'vitest';
import { DEFAULT_EMBED_ORIGINS, embedOrigins, parseEmbedOrigins, toEmbed } from '@/lib/embed';
import { buildContentSecurityPolicy } from '@/lib/security/csp';

describe('toEmbed', () => {
  it('turns YouTube addresses into the privacy-enhanced player, keeping the start time', () => {
    for (const url of [
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://youtu.be/dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ&feature=share',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
    ]) {
      expect(toEmbed(url)?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ');
    }
    expect(toEmbed('https://youtu.be/dQw4w9WgXcQ?t=1m30s')?.src).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?start=90');
    expect(toEmbed('https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=42')?.src).toContain('?start=42');
  });

  it('handles Vimeo, including unlisted videos with their hash', () => {
    expect(toEmbed('https://vimeo.com/76979871')?.src).toBe('https://player.vimeo.com/video/76979871');
    expect(toEmbed('https://vimeo.com/76979871/abc123def')?.src).toBe('https://player.vimeo.com/video/76979871?h=abc123def');
    expect(toEmbed('https://player.vimeo.com/video/76979871?h=zz')?.src).toBe('https://player.vimeo.com/video/76979871?h=zz');
  });

  it('uses the preview and embed forms of Google documents, forms and Drive files', () => {
    expect(toEmbed('https://docs.google.com/document/d/1AbC_def-9/edit?usp=sharing')?.src).toBe('https://docs.google.com/document/d/1AbC_def-9/preview');
    expect(toEmbed('https://docs.google.com/presentation/d/1XyZ/edit#slide=id.p')?.src).toBe('https://docs.google.com/presentation/d/1XyZ/embed');
    expect(toEmbed('https://docs.google.com/spreadsheets/d/1Sheet/edit')?.src).toBe('https://docs.google.com/spreadsheets/d/1Sheet/preview');
    expect(toEmbed('https://docs.google.com/forms/d/e/1FAIpQL/viewform')?.src).toBe('https://docs.google.com/forms/d/e/1FAIpQL/viewform?embedded=true');
    expect(toEmbed('https://drive.google.com/file/d/1File/view?usp=drive_link')?.src).toBe('https://drive.google.com/file/d/1File/preview');
  });

  it('converts Loom shares and keeps Microsoft viewers as pasted', () => {
    expect(toEmbed('https://www.loom.com/share/0123abcd')?.src).toBe('https://www.loom.com/embed/0123abcd');
    const office = 'https://view.officeapps.live.com/op/embed.aspx?src=https%3A%2F%2Fexample.com%2Fa.pptx';
    expect(toEmbed(office)?.src).toBe(office);
  });

  it('leaves everything else as a link, and never frames plain http', () => {
    expect(toEmbed('https://example.com/some/page')).toBeNull();
    expect(toEmbed('http://www.youtube.com/watch?v=dQw4w9WgXcQ')).toBeNull();
    expect(toEmbed('javascript:alert(1)')).toBeNull();
    expect(toEmbed('not a url')).toBeNull();
    expect(toEmbed(null)).toBeNull();
    expect(toEmbed('https://docs.google.com/unknown/thing')).toBeNull();
  });

  it('frames origins the institution allowed, as pasted', () => {
    const extra = parseEmbedOrigins('https://kopano.h5p.com, https://phet.colorado.edu');
    expect(toEmbed('https://kopano.h5p.com/content/123/embed', extra)?.origin).toBe('https://kopano.h5p.com');
    expect(toEmbed('https://kopano.h5p.com/content/123/embed')).toBeNull();
  });
});

describe('EMBED_ALLOWED_ORIGINS and the policy', () => {
  it('keeps only https origins, reduced to their origin', () => {
    expect(parseEmbedOrigins('https://a.example/path?x=1 http://b.example,  https://c.example:8443 junk')).toEqual([
      'https://a.example',
      'https://c.example:8443',
    ]);
    expect(parseEmbedOrigins(undefined)).toEqual([]);
  });

  it('lists every embeddable origin under frame-src, and nothing else can be framed', () => {
    const policy = buildContentSecurityPolicy({
      nonce: 'abc',
      production: true,
      https: true,
      frameOrigins: embedOrigins(['https://kopano.h5p.com']),
    });
    const frameSrc = policy.split('; ').find((directive) => directive.startsWith('frame-src'))!;
    for (const origin of DEFAULT_EMBED_ORIGINS) expect(frameSrc).toContain(origin);
    expect(frameSrc).toContain("'self'");
    expect(frameSrc).toContain('https://kopano.h5p.com');
    expect(frameSrc).not.toContain('*');
  });

  it("still frames only this site when nothing is configured", () => {
    const policy = buildContentSecurityPolicy({ nonce: 'abc', production: true, https: true });
    expect(policy).toContain("frame-src 'self'");
  });
});
