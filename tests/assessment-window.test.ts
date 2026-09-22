import { describe, expect, it } from 'vitest';
import {
  attemptDeadline,
  canStartAttempt,
  canSubmitAttempt,
  describeState,
  secondsRemaining,
  type AssessmentTiming,
  type AttemptSummary,
} from '@/server/services/assessment-window';

const NOW = new Date('2026-04-10T10:00:00Z');

function assessment(overrides: Partial<AssessmentTiming> = {}): AssessmentTiming {
  return {
    status: 'PUBLISHED',
    opensAt: new Date('2026-04-01T00:00:00Z'),
    dueAt: new Date('2026-04-15T23:59:00Z'),
    closesAt: new Date('2026-04-20T23:59:00Z'),
    timeLimitMinutes: null,
    maxAttempts: 1,
    allowLate: true,
    ...overrides,
  };
}

const attempt = (overrides: Partial<AttemptSummary> = {}): AttemptSummary => ({
  attemptNumber: 1,
  status: 'SUBMITTED',
  startedAt: new Date('2026-04-09T09:00:00Z'),
  submittedAt: new Date('2026-04-09T10:00:00Z'),
  ...overrides,
});

describe('starting an attempt', () => {
  it('opens an attempt inside the window', () => {
    const gate = canStartAttempt(assessment(), [], NOW);
    expect(gate.can).toBe('start');
  });

  it('refuses an assessment that is still a draft', () => {
    const gate = canStartAttempt(assessment({ status: 'DRAFT' }), [], NOW);
    expect(gate).toMatchObject({ can: 'no' });
  });

  it('refuses before the opening date and says when it opens', () => {
    const gate = canStartAttempt(assessment({ opensAt: new Date('2026-05-01T00:00:00Z') }), [], NOW);
    expect(gate.can).toBe('no');
    if (gate.can === 'no') expect(gate.reason).toContain('opens on');
  });

  it('resumes an attempt already in progress rather than starting another', () => {
    const gate = canStartAttempt(assessment({ maxAttempts: 3 }), [attempt({ status: 'IN_PROGRESS' })], NOW);
    expect(gate.can).toBe('resume');
  });

  it('stops a learner past the attempt limit', () => {
    const gate = canStartAttempt(assessment(), [attempt()], NOW);
    expect(gate.can).toBe('no');
    if (gate.can === 'no') expect(gate.reason).toContain('already submitted');
  });

  it('does not count a voided attempt against the limit', () => {
    const gate = canStartAttempt(assessment(), [attempt({ status: 'VOID' })], NOW);
    expect(gate.can).toBe('start');
  });

  it('warns that a new attempt will be late', () => {
    const gate = canStartAttempt(assessment(), [], new Date('2026-04-17T10:00:00Z'));
    expect(gate).toMatchObject({ can: 'start', lateWarning: true });
  });

  it('refuses a late start where late work is not accepted', () => {
    const gate = canStartAttempt(assessment({ allowLate: false }), [], new Date('2026-04-17T10:00:00Z'));
    expect(gate.can).toBe('no');
  });

  it('refuses once the assessment has closed', () => {
    const gate = canStartAttempt(assessment(), [], new Date('2026-04-25T10:00:00Z'));
    expect(gate.can).toBe('no');
  });
});

describe('deadlines', () => {
  it('takes the earlier of the time limit and the closing date', () => {
    const timed = assessment({ timeLimitMinutes: 60, closesAt: new Date('2026-04-10T10:30:00Z') });
    const deadline = attemptDeadline(timed, new Date('2026-04-10T10:00:00Z'));
    expect(deadline?.toISOString()).toBe('2026-04-10T10:30:00.000Z');
  });

  it('uses the time limit when it lands first', () => {
    const timed = assessment({ timeLimitMinutes: 15 });
    const deadline = attemptDeadline(timed, new Date('2026-04-10T10:00:00Z'));
    expect(deadline?.toISOString()).toBe('2026-04-10T10:15:00.000Z');
  });

  it('has no deadline when neither is set', () => {
    expect(attemptDeadline(assessment({ closesAt: null }), null)).toBeNull();
  });

  it('counts down and floors at zero', () => {
    expect(secondsRemaining(new Date('2026-04-10T10:05:00Z'), NOW)).toBe(300);
    expect(secondsRemaining(new Date('2026-04-10T09:00:00Z'), NOW)).toBe(0);
  });
});

describe('submitting', () => {
  it('accepts an attempt in progress', () => {
    const gate = canSubmitAttempt(assessment(), attempt({ status: 'IN_PROGRESS' }), NOW);
    expect(gate).toMatchObject({ can: true, isLate: false });
  });

  it('refuses to submit twice', () => {
    expect(canSubmitAttempt(assessment(), attempt({ status: 'SUBMITTED' }), NOW).can).toBe(false);
  });

  it('marks a submission after the due date as late', () => {
    const gate = canSubmitAttempt(
      assessment(),
      attempt({ status: 'IN_PROGRESS' }),
      new Date('2026-04-16T09:00:00Z'),
    );
    expect(gate).toMatchObject({ can: true, isLate: true });
  });

  it('allows a short grace past the time limit rather than losing the work', () => {
    const timed = assessment({ timeLimitMinutes: 30, allowLate: false });
    const started = new Date('2026-04-10T09:00:00Z');
    const gate = canSubmitAttempt(
      timed,
      attempt({ status: 'IN_PROGRESS', startedAt: started }),
      new Date('2026-04-10T09:31:00Z'),
    );
    expect(gate.can).toBe(true);
  });

  it('refuses well past the time limit when late work is not accepted', () => {
    const timed = assessment({ timeLimitMinutes: 30, allowLate: false });
    const started = new Date('2026-04-10T09:00:00Z');
    const gate = canSubmitAttempt(
      timed,
      attempt({ status: 'IN_PROGRESS', startedAt: started }),
      new Date('2026-04-10T10:00:00Z'),
    );
    expect(gate.can).toBe(false);
  });
});

describe('what the learner sees', () => {
  it('shows a result only once it is released', () => {
    expect(describeState(assessment(), [attempt()], false, NOW).label).toContain('awaiting marking');
    expect(describeState(assessment(), [attempt()], true, NOW).label).toBe('Result available');
  });

  it('warns as the due date approaches', () => {
    const state = describeState(assessment(), [], false, new Date('2026-04-14T10:00:00Z'));
    expect(state.label).toContain('Due in');
    expect(state.tone).toBe('caution');
  });

  it('calls an unsubmitted assessment overdue, then closed', () => {
    expect(describeState(assessment(), [], false, new Date('2026-04-17T10:00:00Z')).label).toBe('Overdue');
    expect(describeState(assessment(), [], false, new Date('2026-04-25T10:00:00Z')).label).toContain('Closed');
  });
});
