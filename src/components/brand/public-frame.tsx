import Link from 'next/link';
import { cn } from '@/lib/cn';
import { BrandMark } from './mark';

/**
 * The public pages share the institute's header: navy bar, crest, a gold rule.
 * Authenticated screens have their own shell and do not use this.
 */
export function PublicFrame({
  children,
  width = 'prose',
  center = false,
  showApply = true,
}: {
  children: React.ReactNode;
  width?: 'prose' | 'lg' | 'md';
  center?: boolean;
  /** Off where there is no institution to apply to yet, such as first-run setup. */
  showApply?: boolean;
}) {
  const max = width === 'lg' ? 'max-w-2xl' : width === 'md' ? 'max-w-sm' : 'max-w-prose';

  return (
    <div className="flex min-h-dvh flex-col bg-paper">
      <header className="bg-navy text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <Link href="/login" className="rounded-md">
            <BrandMark size="sm" />
          </Link>
          {showApply && (
            <Link href="/apply" className="text-sm font-semibold text-gold-bright hover:underline">
              Apply
            </Link>
          )}
        </div>
        <div className="h-1 bg-gold" aria-hidden />
      </header>
      <main
        className={cn(
          'public-main mx-auto w-full flex-1 px-6 py-12',
          max,
          center && 'flex flex-col justify-center',
        )}
      >
        {children}
      </main>
    </div>
  );
}
