import type { Metadata } from 'next';
import Link from 'next/link';
import { requirePrincipal } from '@/lib/auth/current-user';
import { searchEverything } from '@/server/services/search';
import { Button, EmptyState, Input, Panel } from '@/components/ui/primitives';

export const metadata: Metadata = { title: 'Search' };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const principal = await requirePrincipal();
  const { q = '' } = await searchParams;
  const query = q.trim();
  const groups = await searchEverything(principal, query);
  const total = groups.reduce((sum, group) => sum + group.hits.length, 0);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-serif text-2xl font-semibold">Search</h1>
        <p className="mt-1 text-sm text-muted">
          Students, staff, courses, programmes, applications, invoices, certificates and tickets:
          whatever your role lets you open.
        </p>
      </div>

      <form action="/search" role="search" className="flex max-w-xl gap-2">
        <label htmlFor="search-page-q" className="sr-only">Search for</label>
        <Input id="search-page-q" name="q" type="search" defaultValue={query} placeholder="A name, number, code or reference" />
        <Button type="submit">Search</Button>
      </form>

      {query.length < 2 ? (
        <Panel>
          <EmptyState title="Type at least two characters" hint="A student number, a surname, a course code or a reference number all work." />
        </Panel>
      ) : total === 0 ? (
        <Panel>
          <EmptyState title={`Nothing found for "${query}"`} hint="Check the spelling, or try part of the name or number." />
        </Panel>
      ) : (
        groups.map((group) => (
          <Panel key={group.title} title={group.title} description={`${group.hits.length} shown`}>
            <ul className="divide-y divide-line">
              {group.hits.map((hit) => (
                <li key={hit.href} className="px-4 py-2.5 text-sm">
                  <Link href={hit.href} className="font-medium text-accent underline-offset-2 hover:underline">
                    {hit.label}
                  </Link>
                  <span className="block text-xs text-muted">{hit.detail}</span>
                </li>
              ))}
            </ul>
          </Panel>
        ))
      )}
    </div>
  );
}
