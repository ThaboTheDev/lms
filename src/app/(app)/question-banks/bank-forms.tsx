'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input } from '@/components/ui/primitives';
import { FormMessage, Select, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { newBank, newQuestion } from './actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="sm" disabled={pending}>
      {pending ? 'Saving' : label}
    </Button>
  );
}

export function NewBankForm({ courses }: { courses: { id: string; code: string; title: string }[] }) {
  const [state, action] = useActionState<FormState, FormData>(newBank, {});

  return (
    <form action={action} className="space-y-3">
      <FormMessage status={state.status} message={state.message} />

      <Field label="Name" htmlFor="bank-name" error={state.fieldErrors?.name}>
        <Input id="bank-name" name="name" required placeholder="BUS101 multiple choice" />
      </Field>

      <Field label="Course" htmlFor="bank-course" hint="Optional">
        <Select id="bank-course" name="courseId" defaultValue="">
          <option value="">Any course</option>
          {courses.map((course) => (
            <option key={course.id} value={course.id}>
              {course.code} · {course.title}
            </option>
          ))}
        </Select>
      </Field>

      <Field label="Description" htmlFor="bank-description" hint="Optional">
        <Input id="bank-description" name="description" />
      </Field>

      <Submit label="Create bank" />
    </form>
  );
}

const OPTION_TYPES = ['MULTIPLE_CHOICE', 'MULTIPLE_RESPONSE', 'MATCHING', 'ORDERING', 'FILL_BLANK'];

export function NewQuestionForm({ bankId }: { bankId: string }) {
  const [state, action] = useActionState<FormState, FormData>(newQuestion, {});
  const [type, setType] = useState('MULTIPLE_CHOICE');

  const optionHint = {
    MULTIPLE_CHOICE: 'One option per line. Put an asterisk at the end of the correct one.',
    MULTIPLE_RESPONSE: 'One option per line. Asterisk every correct one.',
    MATCHING: 'One pair per line, as "item = its match".',
    ORDERING: 'One item per line, in the correct order.',
    FILL_BLANK: 'One blank per line, as "answer = blank name".',
  }[type];

  return (
    <form action={action} className="space-y-3">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="bankId" value={bankId} />

      <Field label="Type" htmlFor="question-type">
        <Select id="question-type" name="type" value={type} onChange={(event) => setType(event.target.value)}>
          <option value="MULTIPLE_CHOICE">Multiple choice</option>
          <option value="MULTIPLE_RESPONSE">Multiple response</option>
          <option value="TRUE_FALSE">True or false</option>
          <option value="SHORT_ANSWER">Short answer</option>
          <option value="NUMERICAL">Numerical</option>
          <option value="MATCHING">Matching</option>
          <option value="ORDERING">Ordering</option>
          <option value="FILL_BLANK">Fill in the blank</option>
          <option value="LONG_ANSWER">Long answer</option>
          <option value="ESSAY">Essay</option>
          <option value="FILE_UPLOAD">File upload</option>
        </Select>
      </Field>

      <Field label="Question" htmlFor="prompt" error={state.fieldErrors?.prompt}>
        <Textarea id="prompt" name="prompt" rows={3} required />
      </Field>

      {OPTION_TYPES.includes(type) && (
        <Field label="Options" htmlFor="options" hint={optionHint} error={state.fieldErrors?.options}>
          <Textarea id="options" name="options" rows={5} />
        </Field>
      )}

      {type === 'TRUE_FALSE' && (
        <Field label="Correct answer" htmlFor="trueFalseAnswer">
          <Select id="trueFalseAnswer" name="trueFalseAnswer" defaultValue="true">
            <option value="true">True</option>
            <option value="false">False</option>
          </Select>
        </Field>
      )}

      {type === 'SHORT_ANSWER' && (
        <Field
          label="Accepted answers"
          htmlFor="acceptedAnswers"
          hint="One per line. Case and spacing are ignored."
        >
          <Textarea id="acceptedAnswers" name="acceptedAnswers" rows={3} />
        </Field>
      )}

      {type === 'NUMERICAL' && (
        <>
          <Field label="Correct value" htmlFor="options" hint="Put the number on one line.">
            <Input id="options" name="options" placeholder="3.14*" />
          </Field>
          <Field label="Tolerance" htmlFor="tolerance" hint="How far off is still correct">
            <Input id="tolerance" name="tolerance" type="number" step="any" min={0} defaultValue={0} />
          </Field>
        </>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Marks" htmlFor="defaultMark" error={state.fieldErrors?.defaultMark}>
          <Input id="defaultMark" name="defaultMark" type="number" min={0.5} step="0.5" defaultValue={1} />
        </Field>
        <Field label="Difficulty" htmlFor="difficulty">
          <Select id="difficulty" name="difficulty" defaultValue="MODERATE">
            <option value="EASY">Easy</option>
            <option value="MODERATE">Moderate</option>
            <option value="CHALLENGING">Challenging</option>
          </Select>
        </Field>
        <Field label="Topic" htmlFor="topic" hint="Optional, used by pools">
          <Input id="topic" name="topic" />
        </Field>
        <Field label="Bloom level" htmlFor="bloomLevel" hint="Optional">
          <Select id="bloomLevel" name="bloomLevel" defaultValue="">
            <option value="">Not recorded</option>
            <option value="REMEMBER">Remember</option>
            <option value="UNDERSTAND">Understand</option>
            <option value="APPLY">Apply</option>
            <option value="ANALYSE">Analyse</option>
            <option value="EVALUATE">Evaluate</option>
            <option value="CREATE">Create</option>
          </Select>
        </Field>
      </div>

      <Field label="Explanation" htmlFor="explanation" hint="Shown with the result, optional">
        <Textarea id="explanation" name="explanation" rows={2} />
      </Field>

      <Submit label="Add question" />
    </form>
  );
}
