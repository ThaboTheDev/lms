'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Panel, Tag } from '@/components/ui/primitives';
import { FormMessage } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { registerCourses } from './actions';

interface Line {
  offeringId: string;
  courseCode: string;
  courseTitle: string;
  credits: number;
  eligible: boolean;
  alreadyEnrolled: boolean;
  full: boolean;
  blockedBy: { courseId: string; reason: string }[];
}

function Submit() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Registering' : 'Register selected courses'}
    </Button>
  );
}

export function RegistrationForm({
  studentId,
  academicTermId,
  lines,
}: {
  studentId: string;
  academicTermId: string;
  lines: Line[];
}) {
  const [state, formAction] = useActionState<FormState, FormData>(registerCourses, {});
  const selectable = lines.filter((line) => line.eligible && !line.alreadyEnrolled);

  return (
    <form action={formAction} className="space-y-4">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="studentId" value={studentId} />
      <input type="hidden" name="academicTermId" value={academicTermId} />

      <Panel
        title="Courses for this term"
        description="Taken from the curriculum for the learner's programme and year of study."
      >
        {lines.length === 0 ? (
          <p className="px-4 py-6 text-sm text-muted">
            The curriculum has no courses in this term for this year of study.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {lines.map((line) => {
              const inputId = `offering-${line.offeringId || line.courseCode}`;
              return (
                <li key={line.courseCode} className="flex items-start gap-3 px-4 py-3">
                  <input
                    id={inputId}
                    type="checkbox"
                    name="offeringIds"
                    value={line.offeringId}
                    disabled={!line.eligible || line.alreadyEnrolled}
                    defaultChecked={line.eligible && !line.alreadyEnrolled}
                    className="mt-1 h-4 w-4 accent-[rgb(var(--brand))]"
                  />
                  <label htmlFor={inputId} className="flex-1 text-sm">
                    <span className="font-medium">{line.courseCode}</span> {line.courseTitle}
                    <span className="block text-xs text-muted">{line.credits} credits</span>
                    {line.blockedBy.length > 0 && (
                      <span className="mt-1 block text-xs text-caution">
                        Blocked: a required course {line.blockedBy[0]!.reason}.
                      </span>
                    )}
                    {!line.offeringId && (
                      <span className="mt-1 block text-xs text-caution">
                        No delivery of this course is open in this term.
                      </span>
                    )}
                  </label>
                  {line.alreadyEnrolled && <Tag tone="active">registered</Tag>}
                  {line.full && <Tag tone="danger">full</Tag>}
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {selectable.length > 0 && <Submit />}
    </form>
  );
}
