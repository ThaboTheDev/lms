import { describe, expect, it } from 'vitest';
import {
  checkPrerequisites,
  findPrerequisiteCycle,
  validateCurriculum,
  type CurriculumEntry,
  type PrerequisiteEdge,
} from '@/server/services/curriculum-rules';

const edge = (
  courseId: string,
  requiredCourseId: string,
  kind: PrerequisiteEdge['kind'] = 'PREREQUISITE',
): PrerequisiteEdge => ({ courseId, requiredCourseId, kind });

describe('prerequisite graph', () => {
  it('accepts a chain', () => {
    expect(findPrerequisiteCycle([edge('B', 'A'), edge('C', 'B')])).toBeNull();
  });

  it('catches a direct loop', () => {
    const cycle = findPrerequisiteCycle([edge('A', 'B'), edge('B', 'A')]);
    expect(cycle).not.toBeNull();
    expect(cycle).toContain('A');
    expect(cycle).toContain('B');
  });

  it('catches a loop three courses long', () => {
    expect(findPrerequisiteCycle([edge('A', 'B'), edge('B', 'C'), edge('C', 'A')])).not.toBeNull();
  });

  it('ignores recommendations, which are advice rather than a rule', () => {
    expect(findPrerequisiteCycle([edge('A', 'B'), edge('B', 'A', 'RECOMMENDED')])).toBeNull();
  });
});

describe('curriculum validation', () => {
  const entry = (overrides: Partial<CurriculumEntry> = {}): CurriculumEntry => ({
    courseId: 'c1',
    courseCode: 'BUS101',
    yearOfStudy: 1,
    termNumber: 1,
    isCompulsory: true,
    credits: 20,
    ...overrides,
  });

  it('warns when nothing has been added yet', () => {
    const problems = validateCurriculum([], {});
    expect(problems).toHaveLength(1);
    expect(problems[0]!.severity).toBe('warning');
  });

  it('blocks the same course placed twice in one term', () => {
    const problems = validateCurriculum([entry(), entry()], {});
    expect(problems.some((p) => p.severity === 'error' && p.message.includes('BUS101'))).toBe(true);
  });

  it('allows the same course in a different term', () => {
    const problems = validateCurriculum([entry(), entry({ termNumber: 2 })], {});
    expect(problems.filter((p) => p.severity === 'error')).toHaveLength(0);
  });

  it('warns when the compulsory credits fall short of the qualification', () => {
    const problems = validateCurriculum([entry({ credits: 60 })], { minimumCredits: 120 });
    expect(problems.some((p) => p.message.includes('60 short'))).toBe(true);
  });

  it('counts only compulsory courses towards the credit total', () => {
    const problems = validateCurriculum(
      [entry({ credits: 120 }), entry({ courseId: 'c2', courseCode: 'ELE101', credits: 40, isCompulsory: false })],
      { minimumCredits: 120 },
    );
    expect(problems.some((p) => p.message.includes('short'))).toBe(false);
  });

  it('blocks a year beyond the recorded duration', () => {
    const problems = validateCurriculum([entry({ yearOfStudy: 3 })], { durationMonths: 12 });
    expect(problems.some((p) => p.severity === 'error' && p.message.includes('Year 3'))).toBe(true);
  });
});

describe('registration eligibility', () => {
  const edges = [edge('ACC201', 'ACC101'), edge('BUS201', 'BUS101', 'COREQUISITE')];

  it('lets a learner register once the prerequisite is passed', () => {
    const result = checkPrerequisites('ACC201', edges, [{ courseId: 'ACC101', passed: true }]);
    expect(result.eligible).toBe(true);
  });

  it('blocks a learner who failed the prerequisite', () => {
    const result = checkPrerequisites('ACC201', edges, [{ courseId: 'ACC101', passed: false }]);
    expect(result.eligible).toBe(false);
    expect(result.blockedBy[0]).toMatchObject({ courseId: 'ACC101' });
  });

  it('blocks a learner who never took the prerequisite', () => {
    expect(checkPrerequisites('ACC201', edges, []).eligible).toBe(false);
  });

  it('satisfies a corequisite by registering for both in the same term', () => {
    expect(checkPrerequisites('BUS201', edges, [], ['BUS101']).eligible).toBe(true);
    expect(checkPrerequisites('BUS201', edges, [], []).eligible).toBe(false);
  });

  it('leaves a course with no rules open', () => {
    expect(checkPrerequisites('COM101', edges, []).eligible).toBe(true);
  });
});
