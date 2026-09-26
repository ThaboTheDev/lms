import Image from 'next/image';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/cn';

/**
 * The institution's logo when it has uploaded one, otherwise the built-in
 * crest (a local file, already the right size, so no remote loader).
 */
export function Crest({
  size = 48,
  className,
  logoUrl,
}: {
  size?: number;
  className?: string;
  logoUrl?: string | null;
}) {
  if (logoUrl) {
    return (
      // Not next/image: the logo is served by this app's own route, already small.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        className={cn('rounded-md bg-white object-contain p-0.5', className)}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <Image
      src="/branding/msri-logo.png"
      alt=""
      width={size}
      height={size}
      className={cn('rounded-md bg-white object-contain p-0.5', className)}
      priority
    />
  );
}

/**
 * Logo plus the name. `onNavy` is the lockup used on the rail and the sign-in
 * panel; `onLight` is for a white header.
 */
export function BrandMark({
  tone = 'onNavy',
  size = 'md',
  showFullName = true,
  brand,
}: {
  tone?: 'onNavy' | 'onLight';
  size?: 'sm' | 'md';
  showFullName?: boolean;
  /** The institution's own logo and names; the built-in brand when absent. */
  brand?: { logoUrl: string | null; shortName: string; name: string };
}) {
  const crest = size === 'sm' ? 40 : 52;
  const shortName = brand?.shortName ?? BRAND.shortName;
  const name = brand?.name ?? BRAND.name;
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Crest size={crest} className="shrink-0" logoUrl={brand?.logoUrl} />
      <span className="min-w-0">
        <span
          className={cn(
            'block text-sm font-bold leading-tight tracking-wide',
            tone === 'onNavy' ? 'text-white' : 'text-navy',
          )}
        >
          {shortName}
        </span>
        {showFullName ? (
          <span
            className={cn(
              'mt-0.5 block text-[0.65rem] font-semibold uppercase leading-snug tracking-[0.12em]',
              tone === 'onNavy' ? 'text-gold-bright' : 'text-gold-ink',
            )}
          >
            {name}
          </span>
        ) : (
          <span
            className={cn(
              'mt-0.5 block text-[0.65rem] font-semibold uppercase tracking-[0.14em]',
              tone === 'onNavy' ? 'text-gold-bright' : 'text-gold-ink',
            )}
          >
            Est. {BRAND.established}
          </span>
        )}
      </span>
    </span>
  );
}
