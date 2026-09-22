'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';
import type { NavGroup } from './nav';

export function Sidebar({
  groups,
  institutionName,
}: {
  groups: NavGroup[];
  institutionName: string;
}) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="h-full overflow-y-auto px-3 py-4">
      <p className="px-2 pb-4 font-serif text-sm font-semibold leading-tight text-white/90">
        {institutionName}
      </p>
      <ul className="space-y-5">
        {groups.map((group) => (
          <li key={group.label}>
            <p className="px-2 pb-1 text-2xs font-medium tracking-wide text-white/45">
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
                        'block rounded px-2 py-1.5 text-sm text-white/75 hover:bg-white/10 hover:text-white',
                        active && 'bg-white/12 font-medium text-white shadow-[inset_2px_0_0_0_rgb(var(--brand))]',
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
  );
}
