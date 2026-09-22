import Link from 'next/link';
import type { Route } from 'next';

/**
 * The hrefs these three components take are built at runtime - a record id out
 * of a query, a page number, a tab key - so there is nothing for `typedRoutes`
 * to check at this end. They are asserted once, where the string reaches
 * `Link`, rather than at every call site. Links written as literals elsewhere
 * are still checked, which is the point of having the feature on.
 */

export function Breadcrumbs({ trail }: { trail: { label: string; href?: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-4">
      <ol className="flex flex-wrap items-center gap-1.5 text-sm text-muted">
        {trail.map((crumb, index) => (
          <li key={`${crumb.label}-${index}`} className="flex items-center gap-1.5">
            {crumb.href ? (
              <Link href={crumb.href as Route} className="underline-offset-2 hover:underline">
                {crumb.label}
              </Link>
            ) : (
              <span aria-current="page" className="text-ink">
                {crumb.label}
              </span>
            )}
            {index < trail.length - 1 && <span aria-hidden>/</span>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function Pagination({
  page,
  totalPages,
  buildHref,
}: {
  page: number;
  totalPages: number;
  buildHref: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between border-t border-line px-4 py-3 text-sm">
      <span className="text-muted">
        Page {page} of {totalPages}
      </span>
      <div className="flex gap-2">
        {page > 1 && (
          <Link href={buildHref(page - 1) as Route} className="rounded border border-line px-3 py-1.5">
            Previous
          </Link>
        )}
        {page < totalPages && (
          <Link href={buildHref(page + 1) as Route} className="rounded border border-line px-3 py-1.5">
            Next
          </Link>
        )}
      </div>
    </nav>
  );
}

/** Tab strip built from links, so tabs survive a reload and are shareable. */
export function TabLinks({
  tabs,
  current,
}: {
  tabs: { label: string; href: string; key: string }[];
  current: string;
}) {
  return (
    <div className="border-b border-line">
      <ul className="flex gap-1 overflow-x-auto">
        {tabs.map((tab) => {
          const active = tab.key === current;
          return (
            <li key={tab.key}>
              <Link
                href={tab.href as Route}
                aria-current={active ? 'page' : undefined}
                className={
                  active
                    ? 'inline-block border-b-2 border-gold-ink px-3 py-2 text-sm font-semibold text-ink'
                    : 'inline-block border-b-2 border-transparent px-3 py-2 text-sm text-muted hover:text-ink'
                }
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export function DescriptionList({ items }: { items: { term: string; value: React.ReactNode }[] }) {
  return (
    <dl className="grid gap-x-6 gap-y-3 px-4 py-4 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.term}>
          <dt className="text-sm text-muted">{item.term}</dt>
          <dd className="text-sm text-ink">{item.value ?? '-'}</dd>
        </div>
      ))}
    </dl>
  );
}
