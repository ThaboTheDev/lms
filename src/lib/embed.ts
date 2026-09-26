/**
 * Which pasted web addresses can play inside a lesson, and as what.
 *
 * A page can only be framed if two things agree: the other site allows it,
 * and this site's content security policy lists it under frame-src. So the
 * list is explicit: well-known players and document viewers are converted to
 * their embeddable form, and an institution can allow more origins with
 * EMBED_ALLOWED_ORIGINS. Anything else stays a link that opens in a new tab,
 * which always works.
 *
 * Pure, so the policy (./security/csp.ts), the lesson page and the tests read
 * the same list.
 */

/** Origins that are framed as they are, once converted to their embed form. */
export const DEFAULT_EMBED_ORIGINS = [
  'https://www.youtube-nocookie.com',
  'https://player.vimeo.com',
  'https://docs.google.com',
  'https://drive.google.com',
  'https://view.officeapps.live.com',
  'https://forms.office.com',
  'https://www.loom.com',
];

export interface Embed {
  /** What the iframe loads. */
  src: string;
  origin: string;
  /** Who provides it, for the iframe's accessible title. */
  provider: string;
}

/** EMBED_ALLOWED_ORIGINS: comma or space separated https origins. Anything else is ignored. */
export function parseEmbedOrigins(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean)
    .flatMap((entry) => {
      try {
        const url = new URL(entry);
        return url.protocol === 'https:' ? [url.origin] : [];
      } catch {
        return [];
      }
    });
}

/** Every origin the policy must allow in frame-src. */
export function embedOrigins(extra: string[] = []): string[] {
  return [...new Set([...DEFAULT_EMBED_ORIGINS, ...extra])];
}

function youtubeStart(url: URL): number | null {
  const raw = url.searchParams.get('t') ?? url.searchParams.get('start');
  if (!raw) return null;
  const match = raw.match(/^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s?)?$/);
  if (!match) return null;
  const seconds = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return seconds > 0 ? seconds : null;
}

/**
 * The embeddable form of a pasted address, or null when it should stay a link.
 * Only https is ever framed.
 */
export function toEmbed(raw: string | null | undefined, extraOrigins: string[] = []): Embed | null {
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const host = url.hostname.replace(/^www\./, '').replace(/^m\./, '');
  const path = url.pathname;

  // YouTube, in its privacy-enhanced form.
  let videoId: string | null = null;
  if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    videoId =
      url.searchParams.get('v') ??
      path.match(/^\/(?:embed|shorts|live)\/([\w-]{6,})/)?.[1] ??
      null;
  } else if (host === 'youtu.be') {
    videoId = path.match(/^\/([\w-]{6,})/)?.[1] ?? null;
  }
  if (videoId && /^[\w-]{6,20}$/.test(videoId)) {
    const start = youtubeStart(url);
    return {
      src: `https://www.youtube-nocookie.com/embed/${videoId}${start ? `?start=${start}` : ''}`,
      origin: 'https://www.youtube-nocookie.com',
      provider: 'YouTube',
    };
  }

  // Vimeo: vimeo.com/123456789 or an already-embeddable player address.
  const vimeo = host === 'vimeo.com' ? path.match(/^\/(?:video\/)?(\d{5,})(?:\/(\w+))?/) : null;
  if (vimeo || host === 'player.vimeo.com') {
    const id = vimeo?.[1] ?? path.match(/^\/video\/(\d{5,})/)?.[1];
    if (id) {
      const hash = vimeo?.[2] ?? url.searchParams.get('h');
      return {
        src: `https://player.vimeo.com/video/${id}${hash ? `?h=${hash}` : ''}`,
        origin: 'https://player.vimeo.com',
        provider: 'Vimeo',
      };
    }
  }

  // Google documents, presentations, sheets and forms, and Drive files.
  if (host === 'docs.google.com') {
    const doc = path.match(/^\/(document|spreadsheets|presentation)\/d\/([\w-]+)/);
    if (doc) {
      const mode = doc[1] === 'presentation' ? 'embed' : 'preview';
      return { src: `https://docs.google.com/${doc[1]}/d/${doc[2]}/${mode}`, origin: 'https://docs.google.com', provider: 'Google' };
    }
    const form = path.match(/^\/forms\/d\/e\/([\w-]+)/);
    if (form) {
      return {
        src: `https://docs.google.com/forms/d/e/${form[1]}/viewform?embedded=true`,
        origin: 'https://docs.google.com',
        provider: 'Google Forms',
      };
    }
  }
  if (host === 'drive.google.com') {
    const file = path.match(/^\/file\/d\/([\w-]+)/);
    if (file) return { src: `https://drive.google.com/file/d/${file[1]}/preview`, origin: 'https://drive.google.com', provider: 'Google Drive' };
  }

  // Loom recordings.
  if (host === 'loom.com') {
    const share = path.match(/^\/(?:share|embed)\/([\w-]+)/);
    if (share) return { src: `https://www.loom.com/embed/${share[1]}`, origin: 'https://www.loom.com', provider: 'Loom' };
  }

  // Microsoft's public viewers are embeddable as pasted, as is anything the
  // institution added to EMBED_ALLOWED_ORIGINS.
  const allowedAsIs = ['https://view.officeapps.live.com', 'https://forms.office.com', ...extraOrigins];
  if (allowedAsIs.includes(url.origin)) {
    const provider =
      url.origin === 'https://view.officeapps.live.com' ? 'Microsoft Office' : url.origin === 'https://forms.office.com' ? 'Microsoft Forms' : url.hostname;
    return { src: url.toString(), origin: url.origin, provider };
  }

  return null;
}
