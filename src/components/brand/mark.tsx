import Image from 'next/image';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/cn';

/** The institute crest. Local file, already the right size, so no remote loader. */
export function Crest({
  size = 48,
  className,
}: {
  size?: number;
  className?: string;
}) {
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
}: {
  tone?: 'onNavy' | 'onLight';
  size?: 'sm' | 'md';
  showFullName?: boolean;
}) {
  const crest = size === 'sm' ? 40 : 52;
  return (
    <span className="flex min-w-0 items-center gap-3">
      <Crest size={crest} className="shrink-0" />
      <span className="min-w-0">
        <span
          className={cn(
            'block text-sm font-bold leading-tight tracking-wide',
            tone === 'onNavy' ? 'text-white' : 'text-navy',
          )}
        >
          {BRAND.shortName}
        </span>
        {showFullName ? (
          <span
            className={cn(
              'mt-0.5 block text-[0.65rem] font-semibold uppercase leading-snug tracking-[0.12em]',
              tone === 'onNavy' ? 'text-gold-bright' : 'text-gold-ink',
            )}
          >
            {BRAND.name}
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
