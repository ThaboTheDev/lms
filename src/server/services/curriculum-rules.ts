/**
 * Pure curriculum rules. Kept free of database calls so they can be tested
 * directly and reused by the curriculum builder, the enrolment service and the
 * progression engine in Phase 5.
 */

export interface CurriculumEntry {
  courseId: string;
  courseCode: string;
  yearOfStudy: number;
  termNumber: number;
  isCompulsory: boolean;
  credits: number;
}

export interface PrerequisiteEdge {
  courseId: string;
  requiredCourseId: string;
  kind: 'PREREQUISITE' | 'COREQUISITE' | 'RECOMMENDED';
}

export interface CurriculumProblem {
  severity: 'error' | 'warning';
  message: string;
}

/**
 * Depth-first search for a cycle in the prerequisite graph. A cycle would make
 * a programme impossible to complete, so it is rejected at the point the rule
 * is added rather than discovered by a learner at registration.
 */
export function findPrerequisiteCycle(edges: PrerequisiteEdge[]): string[] | null {
  const graph = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind === 'RECOMMENDED') continue;
    const list = graph.get(edge.courseId) ?? [];
    list.push(edge.requiredCourseId);
    graph.set(edge.courseId, list);
  }

  const state = new Map<string, 'visiting' | 'done'>();
  const stack: string[] = [];

  function visit(node: string): string[] | null {
    const current = state.get(node);
    if (current === 'done') return null;
    if (current === 'visiting') return [...stack.slice(stack.indexOf(node)), node];

    state.set(node, 'visiting');
    stack.push(node);
    for (const next of graph.get(node) ?? []) {
      const cycle = visit(next);
      if (cycle) return cycle;
    }
    stack.pop();
    state.set(node, 'done');
    return null;
  }

  for (const node of graph.keys()) {
    const cycle = visit(node);
    if (cycle) return cycle;
  }
  return null;
}

/**
 * Checks a proposed curriculum against the qualification it leads to. Warnings
 * do not block saving: a programme is often built up over several sittings, and
 * the registrar needs to see the gaps rather than be stopped by them.
 */
export function validateCurriculum(
  entries: CurriculumEntry[],
  options: { minimumCredits?: number | null; durationMonths?: number | null },
): CurriculumProblem[] {
  const problems: CurriculumProblem[] = [];

  if (entries.length === 0) {
    problems.push({ severity: 'warning', message: 'No courses have been added to this curriculum yet.' });
    return problems;
  }

  const seen = new Set<string>();
  for (const entry of entries) {
    const key = `${entry.courseId}:${entry.yearOfStudy}:${entry.termNumber}`;
    if (seen.has(key)) {
      problems.push({
        severity: 'error',
        message: `${entry.courseCode} appears more than once in year ${entry.yearOfStudy}, term ${entry.termNumber}.`,
      });
    }
    seen.add(key);
  }

  const compulsoryCredits = entries
    .filter((entry) => entry.isCompulsory)
    .reduce((total, entry) => total + entry.credits, 0);

  if (options.minimumCredits && compulsoryCredits < options.minimumCredits) {
    problems.push({
      severity: 'warning',
      message: `Compulsory courses carry ${compulsoryCredits} credits, ${options.minimumCredits - compulsoryCredits} short of the ${options.minimumCredits} the qualification requires.`,
    });
  }

  if (options.durationMonths) {
    const expectedYears = Math.ceil(options.durationMonths / 12);
    const maxYear = Math.max(...entries.map((entry) => entry.yearOfStudy));
    if (maxYear > expectedYears) {
      problems.push({
        severity: 'error',
        message: `Year ${maxYear} is beyond the ${expectedYears}-year duration recorded for this programme.`,
      });
    }
  }

  return problems;
}

export interface CompletedCourse {
  courseId: string;
  passed: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  blockedBy: { courseId: string; reason: string }[];
}

/**
 * Whether a learner may register for a course. Corequisites are satisfied by
 * concurrent registration, which is why they are checked against the current
 * term's registrations as well as the completed record.
 */
export function checkPrerequisites(
  courseId: string,
  edges: PrerequisiteEdge[],
  completed: CompletedCourse[],
  concurrentCourseIds: string[] = [],
): EligibilityResult {
  const passed = new Set(completed.filter((c) => c.passed).map((c) => c.courseId));
  const concurrent = new Set(concurrentCourseIds);
  const blockedBy: { courseId: string; reason: string }[] = [];

  for (const edge of edges.filter((e) => e.courseId === courseId)) {
    if (edge.kind === 'RECOMMENDED') continue;
    if (passed.has(edge.requiredCourseId)) continue;
    if (edge.kind === 'COREQUISITE' && concurrent.has(edge.requiredCourseId)) continue;

    blockedBy.push({
      courseId: edge.requiredCourseId,
      reason:
        edge.kind === 'COREQUISITE'
          ? 'must be taken in the same term or already passed'
          : 'must be passed first',
    });
  }

  return { eligible: blockedBy.length === 0, blockedBy };
}
