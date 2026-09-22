import { describe, expect, it } from 'vitest';
import {
  ACTIVE_APPLICATION_STATUSES,
  allowedTransitions,
  canTransition,
  findTransition,
  isTerminal,
  APPLICATION_TRANSITIONS,
  type ApplicationStatus,
} from '@/server/services/admissions-workflow';

describe('admissions pipeline', () => {
  it('walks an ordinary application from submission to enrolment', () => {
    const path: ApplicationStatus[] = [
      'DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'OFFER', 'ACCEPTED', 'ENROLLED',
    ];
    for (let i = 0; i < path.length - 1; i += 1) {
      expect(canTransition(path[i]!, path[i + 1]!)).toBe(true);
    }
  });

  it('refuses moves that skip the process', () => {
    expect(canTransition('SUBMITTED', 'ENROLLED')).toBe(false);
    expect(canTransition('DRAFT', 'OFFER')).toBe(false);
    expect(canTransition('UNDER_REVIEW', 'ACCEPTED')).toBe(false);
  });

  it('treats an outcome as final', () => {
    expect(isTerminal('REJECTED')).toBe(true);
    expect(isTerminal('DECLINED')).toBe(true);
    expect(isTerminal('ENROLLED')).toBe(true);
    expect(isTerminal('UNDER_REVIEW')).toBe(false);
    expect(allowedTransitions('REJECTED')).toHaveLength(0);
  });

  it('requires a recorded reason for every decision', () => {
    for (const decision of ['OFFER', 'CONDITIONAL_OFFER', 'REJECTED'] as ApplicationStatus[]) {
      const rule = findTransition('UNDER_REVIEW', decision);
      expect(rule?.requiresDecision).toBe(true);
    }
  });

  it('puts staff moves behind a permission and leaves applicant moves open', () => {
    expect(findTransition('SUBMITTED', 'UNDER_REVIEW')?.permission).toBe('application.manage');
    expect(findTransition('OFFER', 'ACCEPTED')?.actor).toBe('applicant');
    expect(findTransition('OFFER', 'ACCEPTED')?.permission).toBeUndefined();
    expect(findTransition('ACCEPTED', 'ENROLLED')?.permission).toBe('enrolment.manage');
  });

  it('only ever moves to a status the machine knows', () => {
    for (const rules of Object.values(APPLICATION_TRANSITIONS)) {
      for (const rule of rules) {
        expect(APPLICATION_TRANSITIONS[rule.to]).toBeDefined();
      }
    }
  });

  it('counts only live work as an active stage', () => {
    for (const status of ACTIVE_APPLICATION_STATUSES) {
      expect(isTerminal(status)).toBe(false);
    }
  });
});
