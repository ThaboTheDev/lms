import type { Metadata } from 'next';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { loadCalendar } from '@/server/services/calendar';
import { findConflicts, type CalendarItem } from '@/server/services/calendar-rules';
import { Panel, Tag } from '@/components/ui/primitives';
import { Button } from '@/components/ui/primitives';
import { Select } from '@/components/ui/form';
import { NewEventForm } from './event-form';

export const metadata: Metadata = { title: 'Calendar' };

const typeTone: Record<string, 'active' | 'caution' | 'danger' | 'neutral'> = {
  EXAMINATION: 'danger',
  ASSESSMENT_DUE: 'caution',
  DEADLINE: 'caution',
  LECTURE: 'active',
  TUTORIAL: 'active',
  HOLIDAY: 'neutral',
};

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; weeks?: string; type?: string }>;
}) {
  const principal = await requirePrincipal();
  const params = await searchParams;

  const from = params.from ? new Date(params.from) : new Date();
  from.setHours(0, 0, 0, 0);
  const weeks = Math.min(6, Math.max(1, Number(params.weeks ?? 2)));
  const to = new Date(from.getTime() + weeks * 7 * 86_400_000);

  const { days, items } = await loadCalendar(principal, { from, to }, { type: params.type });
  const conflicts = findConflicts(items as never as CalendarItem[]);

  const shiftHref = (offsetWeeks: number) => {
    const shifted = new Date(from.getTime() + offsetWeeks * 7 * 86_400_000);
    const next = new URLSearchParams();
    next.set('from', shifted.toISOString().slice(0, 10));
    next.set('weeks', String(weeks));
    if (params.type) next.set('type', params.type);
    return `/calendar?${next.toString()}`;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">Calendar</h1>
          <p className="mt-1 text-sm text-muted">
            Classes, deadlines and examinations for the courses and programmes you belong to.
          </p>
        </div>
        <form className="flex items-end gap-2">
          <input type="hidden" name="from" value={from.toISOString().slice(0, 10)} />
          <div>
            <label htmlFor="weeks" className="block text-sm font-medium">Showing</label>
            <Select id="weeks" name="weeks" defaultValue={String(weeks)} className="mt-1 h-9 w-32">
              <option value="1">One week</option>
              <option value="2">Two weeks</option>
              <option value="4">Four weeks</option>
              <option value="6">Six weeks</option>
            </Select>
          </div>
          <div>
            <label htmlFor="type" className="block text-sm font-medium">Type</label>
            <Select id="type" name="type" defaultValue={params.type ?? ''} className="mt-1 h-9 w-44">
              <option value="">Everything</option>
              <option value="LECTURE">Classes</option>
              <option value="ASSESSMENT_DUE">Assessment due</option>
              <option value="EXAMINATION">Examinations</option>
              <option value="MEETING">Meetings</option>
              <option value="HOLIDAY">Holidays</option>
            </Select>
          </div>
          <Button type="submit" variant="secondary" size="sm">Apply</Button>
        </form>
      </div>

      <div className="flex items-center justify-between text-sm">
        <a href={shiftHref(-weeks)} className="text-accent underline underline-offset-2">Earlier</a>
        <span className="text-muted">
          {from.toLocaleDateString('en-ZA', { dateStyle: 'long' })} to{' '}
          {to.toLocaleDateString('en-ZA', { dateStyle: 'long' })}
        </span>
        <a href={shiftHref(weeks)} className="text-accent underline underline-offset-2">Later</a>
      </div>

      {conflicts.length > 0 && (
        <Panel title="Clashes" description="Two commitments overlap in this range.">
          <ul className="divide-y divide-line">
            {conflicts.map((conflict, index) => (
              <li key={index} className="px-4 py-3 text-sm">
                {conflict.first.title} and {conflict.second.title} overlap by {conflict.overlapMinutes} minutes
                on {conflict.second.startsAt.toLocaleDateString('en-ZA', { dateStyle: 'medium' })}.
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <Panel>
        <ol className="divide-y divide-line">
          {days.map((day) => (
            <li key={day.date.toISOString()} className="grid gap-2 px-4 py-3 sm:grid-cols-[9rem_1fr]">
              <p className={`text-sm ${day.items.length === 0 ? 'text-muted' : 'font-medium'}`}>
                {day.date.toLocaleDateString('en-ZA', { weekday: 'short', day: 'numeric', month: 'short' })}
              </p>
              {day.items.length === 0 ? (
                <p className="text-sm text-muted">Nothing scheduled</p>
              ) : (
                <ul className="space-y-1.5">
                  {day.items.map((item) => (
                    <li key={`${item.id}-${day.date.toISOString()}`} className="flex flex-wrap items-baseline gap-2 text-sm">
                      <span className="tabular-nums text-muted">
                        {item.allDay
                          ? 'All day'
                          : item.startsAt.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span>{item.title}</span>
                      {item.location && <span className="text-xs text-muted">{item.location}</span>}
                      <Tag tone={typeTone[item.type] ?? 'neutral'}>
                        {item.type.toLowerCase().replace(/_/g, ' ')}
                      </Tag>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      </Panel>

      {can(principal, 'calendar.manage') && <NewEventForm />}
    </div>
  );
}
