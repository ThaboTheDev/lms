'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input, Panel } from '@/components/ui/primitives';
import { Checkbox, FormMessage, Select } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { addCourseToCurriculum, addPrerequisiteRule } from './actions';

interface CourseOption {
  id: string;
  code: string;
  title: string;
  credits?: number;
}

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving' : label}
    </Button>
  );
}

export function CurriculumBuilder({
  programmeId,
  courses,
  curriculumCourses,
}: {
  programmeId: string;
  courses: CourseOption[];
  curriculumCourses: CourseOption[];
}) {
  const [addState, addAction] = useActionState<FormState, FormData>(addCourseToCurriculum, {});
  const [ruleState, ruleAction] = useActionState<FormState, FormData>(addPrerequisiteRule, {});

  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Panel title="Add a course" description="Place a course in a year and term of this programme.">
        <form action={addAction} className="space-y-4 px-4 py-4">
          <FormMessage status={addState.status} message={addState.message} />
          <input type="hidden" name="programmeId" value={programmeId} />

          <Field label="Course" htmlFor="courseId" error={addState.fieldErrors?.courseId}>
            <Select id="courseId" name="courseId" required defaultValue="">
              <option value="" disabled>
                Choose a course
              </option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.code} · {course.title}
                </option>
              ))}
            </Select>
          </Field>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Year of study" htmlFor="yearOfStudy" error={addState.fieldErrors?.yearOfStudy}>
              <Input id="yearOfStudy" name="yearOfStudy" type="number" min={1} max={8} defaultValue={1} />
            </Field>
            <Field label="Term" htmlFor="termNumber" error={addState.fieldErrors?.termNumber}>
              <Input id="termNumber" name="termNumber" type="number" min={1} max={4} defaultValue={1} />
            </Field>
            <Field label="Credits" htmlFor="credits" hint="Leave blank to use the course default">
              <Input id="credits" name="credits" type="number" min={0} max={200} />
            </Field>
          </div>

          <Checkbox id="isCompulsory" name="isCompulsory" defaultChecked label="Compulsory for this programme" />

          <Submit label="Add to curriculum" />
        </form>
      </Panel>

      <Panel
        title="Prerequisite rules"
        description="A rule that would create a loop is refused, so a programme always stays completable."
      >
        <form action={ruleAction} className="space-y-4 px-4 py-4">
          <FormMessage status={ruleState.status} message={ruleState.message} />
          <input type="hidden" name="programmeId" value={programmeId} />

          <Field label="This course" htmlFor="courseId-rule">
            <Select id="courseId-rule" name="courseId" required defaultValue="">
              <option value="" disabled>
                Choose a course
              </option>
              {curriculumCourses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.code} · {course.title}
                </option>
              ))}
            </Select>
          </Field>

          <Field label="Rule" htmlFor="kind">
            <Select id="kind" name="kind" defaultValue="PREREQUISITE">
              <option value="PREREQUISITE">must be preceded by</option>
              <option value="COREQUISITE">must be taken with</option>
              <option value="RECOMMENDED">is best taken after</option>
            </Select>
          </Field>

          <Field
            label="This course"
            htmlFor="requiredCourseId"
            error={ruleState.fieldErrors?.requiredCourseId}
          >
            <Select id="requiredCourseId" name="requiredCourseId" required defaultValue="">
              <option value="" disabled>
                Choose a course
              </option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.code} · {course.title}
                </option>
              ))}
            </Select>
          </Field>

          <Submit label="Add rule" />
        </form>
      </Panel>
    </div>
  );
}
