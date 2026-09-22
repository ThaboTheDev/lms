'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import { BrandMark } from '@/components/brand/mark';
import { SignOutForm } from './sign-out-form';
import type { NavGroup } from './nav';

export function Sidebar({ groups }: { groups: NavGroup[] }) {
  const pathname = usePathname();

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-white/10 px-4 py-4">
        <Link href="/dashboard" className="block rounded-md">
          <BrandMark size="sm" showFullName={false} />
        </Link>
      </div>

      <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 py-4">
        <ul className="space-y-5">
          {groups.map((group) => (
            <li key={group.label}>
              <p className="px-2 pb-1 text-2xs font-semibold uppercase tracking-[0.14em] text-rail-muted">
                {group.label}
              </p>
              <ul className="space-y-0.5">
                {group.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  return (
                    <li key={item.href}>
                      <Link
                        href={item.href}
                        aria-current={active ? 'page' : undefined}
                        className={cn(
                          'block rounded-md px-2 py-1.5 text-sm text-rail-ink/80 hover:bg-white/10 hover:text-gold-bright',
                          active &&
                            'bg-gold-bright/15 font-semibold text-white shadow-[inset_3px_0_0_0_rgb(var(--rail-accent))]',
                        )}
                      >
                        {item.label}
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-white/10 p-3">
        <SignOutForm
          buttonClassName="flex min-h-11 w-full items-center justify-center rounded-md border border-gold-bright/70 px-3 text-sm font-semibold text-gold-bright hover:bg-white/10"
        />
      </div>
    </div>
  );
}
