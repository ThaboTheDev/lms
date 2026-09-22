'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Button, Field, Input } from '@/components/ui/primitives';
import { Checkbox, Fieldset, FormMessage, Select, Textarea } from '@/components/ui/form';
import type { FormState } from '@/lib/validation/common';
import { newAssessment } from './actions';

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? 'Saving' : label}
    </Button>
  );
}

const QUIZ_TYPES = ['QUIZ', 'TEST', 'EXAMINATION'];

export function NewAssessmentForm({ offeringId }: { offeringId: string }) {
  const [state, action] = useActionState<FormState, FormData>(newAssessment, {});
  const [type, setType] = useState('ASSIGNMENT');
  const [allowLate, setAllowLate] = useState(false);
  const error = (field: string) => state.fieldErrors?.[field];

  return (
    <form action={action} className="space-y-5">
      <FormMessage status={state.status} message={state.message} />
      <input type="hidden" name="offeringId" value={offeringId} />

      <Fieldset legend="What it is">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Title" htmlFor="title" error={error('title')}>
            <Input id="title" name="title" required placeholder="Assignment 1: management functions" />
          </Field>
          <Field label="Type" htmlFor="type">
            <Select id="type" name="type" value={type} onChange={(event) => setType(event.target.value)}>
              <option value="ASSIGNMENT">Assignment</option>
              <option value="QUIZ">Quiz</option>
              <option value="TEST">Test</option>
              <option value="EXAMINATION">Examination</option>
              <option value="PROJECT">Project</option>
              <option value="RESEARCH">Research submission</option>
              <option value="PRACTICAL">Practical</option>
              <option value="ORAL">Oral</option>
              <option value="PORTFOLIO">Portfolio</option>
              <option value="PEER_REVIEW">Peer assessment</option>
            </Select>
          </Field>
          <Field label="Purpose" htmlFor="category">
            <Select id="category" name="category" defaultValue="SUMMATIVE">
              <option value="SUMMATIVE">Summative, counts towards the course mark</option>
              <option value="FORMATIVE">Formative, practice and feedback</option>
              <option value="DIAGNOSTIC">Diagnostic, checks prior knowledge</option>
            </Select>
          </Field>
        </div>
        <Field label="Instructions" htmlFor="instructions" hint="What learners see before they start">
          <Textarea id="instructions" name="instructions" rows={4} />
        </Field>
      </Fieldset>

      <Fieldset legend="Marks">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Out of" htmlFor="maxMark" error={error('maxMark')}>
            <Input id="maxMark" name="maxMark" type="number" min={1} max={1000} defaultValue={100} required />
          </Field>
          <Field label="Pass mark" htmlFor="passMark" error={error('passMark')}>
            <Input id="passMark" name="passMark" type="number" min={0} max={1000} defaultValue={50} required />
          </Field>
          <Field
            label="Weighting"
            htmlFor="weight"
            hint="Share of the course mark"
            error={error('weight')}
          >
            <Input id="weight" name="weight" type="number" min={0} max={100} defaultValue={0} required />
          </Field>
        </div>
      </Fieldset>

      <Fieldset legend="Timing">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Opens" htmlFor="opensAt" hint="Optional">
            <Input id="opensAt" name="opensAt" type="datetime-local" />
          </Field>
          <Field label="Due" htmlFor="dueAt" error={error('dueAt')}>
            <Input id="dueAt" name="dueAt" type="datetime-local" />
          </Field>
          <Field label="Closes" htmlFor="closesAt" hint="Nothing accepted after this">
            <Input id="closesAt" name="closesAt" type="datetime-local" />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Attempts allowed" htmlFor="maxAttempts">
            <Input id="maxAttempts" name="maxAttempts" type="number" min={1} max={10} defaultValue={1} />
          </Field>
          {QUIZ_TYPES.includes(type) && (
            <Field label="Time limit" htmlFor="timeLimitMinutes" hint="Minutes, blank for none">
              <Input id="timeLimitMinutes" name="timeLimitMinutes" type="number" min={0} max={600} />
            </Field>
          )}
          {allowLate && (
            <Field label="Penalty per day late" htmlFor="latePenaltyPct" hint="Percentage of the earned mark">
              <Input id="latePenaltyPct" name="latePenaltyPct" type="number" min={0} max={100} defaultValue={10} />
            </Field>
          )}
        </div>

        <Checkbox
          id="allowLate"
          name="allowLate"
          label="Accept late submissions until the closing date"
          defaultChecked={false}
        />
        <input type="hidden" value={String(allowLate)} />
        <button
          type="button"
          onClick={() => setAllowLate((value) => !value)}
          className="text-sm text-accent underline underline-offset-2"
        >
          {allowLate ? 'Hide the late penalty setting' : 'Set a late penalty'}
        </button>

        {QUIZ_TYPES.includes(type) && (
          <Checkbox
            id="shuffleQuestions"
            name="shuffleQuestions"
            label="Shuffle the question order for each learner"
          />
        )}
      </Fieldset>

      <Submit label="Create assessment" />
    </form>
  );
}
