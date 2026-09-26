'use server';

import type { Route } from 'next';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { requirePrincipal } from '@/lib/auth/current-user';
import { AppError } from '@/lib/errors';
import type { Principal } from '@/lib/rbac/authorize';
import { toFieldErrors, type FormState } from '@/lib/validation/common';
import {
  academicYearSchema,
  cohortSchema,
  courseSchema,
  departmentSchema,
  emailTemplateSchema,
  facultySchema,
  gradingSchemeSchema,
  offeringSchema,
  OFFERING_STATUSES,
  parseBandLines,
  bandProblems,
  programmeSchema,
  qualificationSchema,
  staffAssignmentSchema,
  termSchema,
} from '@/server/services/academic-setup-rules';
import {
  assignOfferingStaff,
  createAcademicYear,
  createCohort,
  createCourse,
  createDepartment,
  createFaculty,
  createGradingScheme,
  createOffering,
  createProgramme,
  createQualification,
  createTerm,
  removeOfferingStaff,
  saveEmailTemplate,
  setCurrentAcademicYear,
  setCurrentTerm,
  setDefaultGradingScheme,
  setOfferingStatus,
  updateCourse,
  updateGradingBands,
  updateProgramme,
} from '@/server/services/academic-setup';

const BOOLEAN_FIELDS = ['isCurrent', 'isActive', 'isDefault'];
const ARRAY_FIELDS = ['deliveryModes'];

/** FormData to a plain object: checkbox groups become arrays, switches become booleans. */
function read(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(formData.keys())) {
    if (key.startsWith('$')) continue;
    if (ARRAY_FIELDS.includes(key)) out[key] = formData.getAll(key).map(String);
    else out[key] = String(formData.get(key) ?? '');
  }
  for (const key of BOOLEAN_FIELDS) out[key] = formData.get(key) === 'on' || formData.get(key) === 'true';
  for (const key of ARRAY_FIELDS) out[key] ??= [];
  return out;
}

function failure(error: unknown): FormState {
  if (error instanceof z.ZodError) return { status: 'error', message: 'Check the highlighted fields.', fieldErrors: toFieldErrors(error) };
  if (error instanceof AppError) {
    const details = error.details && typeof error.details === 'object' ? (error.details as Record<string, string>) : undefined;
    return { status: 'error', message: error.message, fieldErrors: details };
  }
  throw error;
}

async function run<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  formData: FormData,
  work: (principal: Principal, input: T) => Promise<unknown>,
  done: { message: string; revalidate: string[]; redirectTo?: (result: unknown) => string },
): Promise<FormState> {
  const principal = await requirePrincipal();
  let result: unknown;
  try {
    const input = schema.parse(read(formData));
    result = await work(principal, input);
  } catch (error) {
    return failure(error);
  }
  for (const path of done.revalidate) revalidatePath(path);
  if (done.redirectTo) redirect(done.redirectTo(result) as Route);
  return { status: 'success', message: done.message };
}

async function simple(formData: FormData, field: string, work: (principal: Principal, id: string) => Promise<unknown>, message: string, paths: string[]): Promise<FormState> {
  const principal = await requirePrincipal();
  const id = String(formData.get(field) ?? '');
  if (!id) return { status: 'error', message: 'Nothing was chosen.' };
  try {
    await work(principal, id);
  } catch (error) {
    return failure(error);
  }
  for (const path of paths) revalidatePath(path);
  return { status: 'success', message };
}

const CAL = ['/admin/academic', '/admin/academic/calendar'];
const STRUCT = ['/admin/academic', '/admin/academic/structure'];

export async function addAcademicYear(_: FormState, formData: FormData) {
  return run(academicYearSchema, formData, createAcademicYear, { message: 'Academic year added.', revalidate: CAL });
}
export async function makeYearCurrent(_: FormState, formData: FormData) {
  return simple(formData, 'academicYearId', setCurrentAcademicYear, 'That is now the current year.', CAL);
}
export async function addTerm(_: FormState, formData: FormData) {
  return run(termSchema, formData, createTerm, { message: 'Term added.', revalidate: CAL });
}
export async function makeTermCurrent(_: FormState, formData: FormData) {
  return simple(formData, 'termId', setCurrentTerm, 'That is now the current term.', CAL);
}
export async function addFaculty(_: FormState, formData: FormData) {
  return run(facultySchema, formData, createFaculty, { message: 'Faculty added.', revalidate: STRUCT });
}
export async function addDepartment(_: FormState, formData: FormData) {
  return run(departmentSchema, formData, createDepartment, { message: 'Department added.', revalidate: STRUCT });
}
export async function addQualification(_: FormState, formData: FormData) {
  return run(qualificationSchema, formData, createQualification, { message: 'Qualification added.', revalidate: STRUCT });
}
export async function addCohort(_: FormState, formData: FormData) {
  return run(cohortSchema, formData, createCohort, { message: 'Cohort added.', revalidate: ['/admin/academic', '/admin/academic/cohorts'] });
}
export async function addGradingScheme(_: FormState, formData: FormData) {
  return run(gradingSchemeSchema, formData, createGradingScheme, { message: 'Grading scheme added.', revalidate: ['/admin/academic', '/admin/academic/grading'] });
}
export async function saveGradingBands(_: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const schemeId = String(formData.get('schemeId') ?? '');
  const { bands, problems } = parseBandLines(String(formData.get('bands') ?? ''));
  const all = [...problems, ...(problems.length === 0 ? bandProblems(bands) : [])];
  if (all.length > 0) return { status: 'error', message: 'Those bands do not form a scale yet.', fieldErrors: { bands: all.join(' ') } };
  try {
    await updateGradingBands(principal, schemeId, bands);
  } catch (error) {
    return failure(error);
  }
  revalidatePath('/admin/academic/grading');
  return { status: 'success', message: 'Bands saved. Results finalised from now on use them.' };
}
export async function makeSchemeDefault(_: FormState, formData: FormData) {
  return simple(formData, 'schemeId', setDefaultGradingScheme, 'That is now the default scheme.', ['/admin/academic/grading']);
}

export async function addProgramme(_: FormState, formData: FormData) {
  return run(programmeSchema, formData, createProgramme, {
    message: 'Programme added.',
    revalidate: ['/programmes', '/admin/academic'],
    redirectTo: (programme) => `/programmes/${(programme as { id: string }).id}`,
  });
}
export async function saveProgramme(_: FormState, formData: FormData) {
  const programmeId = String(formData.get('programmeId') ?? '');
  return run(programmeSchema, formData, (principal, input) => updateProgramme(principal, programmeId, input), {
    message: 'Programme saved.',
    revalidate: ['/programmes', `/programmes/${programmeId}`],
  });
}

export async function addCourse(_: FormState, formData: FormData) {
  return run(courseSchema, formData, createCourse, {
    message: 'Course added.',
    revalidate: ['/courses', '/admin/academic'],
    redirectTo: (course) => `/courses/catalogue/${(course as { id: string }).id}`,
  });
}
export async function saveCourse(_: FormState, formData: FormData) {
  const courseId = String(formData.get('courseId') ?? '');
  return run(courseSchema, formData, (principal, input) => updateCourse(principal, courseId, input), {
    message: 'Course saved.',
    revalidate: ['/courses', `/courses/catalogue/${courseId}`],
  });
}
export async function addOffering(_: FormState, formData: FormData) {
  const courseId = String(formData.get('courseId') ?? '');
  return run(offeringSchema, formData, createOffering, {
    message: 'Scheduled. Add the teaching team next.',
    revalidate: ['/courses', `/courses/catalogue/${courseId}`, '/admin/academic'],
  });
}
export async function changeOfferingStatus(_: FormState, formData: FormData): Promise<FormState> {
  const principal = await requirePrincipal();
  const offeringId = String(formData.get('offeringId') ?? '');
  const status = z.enum(OFFERING_STATUSES).safeParse(formData.get('status'));
  if (!status.success) return { status: 'error', message: 'Choose a status.' };
  try {
    await setOfferingStatus(principal, offeringId, status.data);
  } catch (error) {
    return failure(error);
  }
  revalidatePath(`/courses/${offeringId}`);
  revalidatePath('/courses');
  return { status: 'success', message: `Now ${status.data.toLowerCase()}.` };
}
export async function addOfferingStaff(_: FormState, formData: FormData) {
  const offeringId = String(formData.get('offeringId') ?? '');
  return run(staffAssignmentSchema, formData, assignOfferingStaff, {
    message: 'Added to the teaching team.',
    revalidate: [`/courses/${offeringId}`, '/admin/academic'],
  });
}
export async function dropOfferingStaff(_: FormState, formData: FormData) {
  const offeringId = String(formData.get('offeringId') ?? '');
  return simple(formData, 'offeringStaffId', removeOfferingStaff, 'Removed from the teaching team.', [`/courses/${offeringId}`]);
}

export async function saveTemplate(_: FormState, formData: FormData) {
  const name = String(formData.get('name') ?? '');
  return run(emailTemplateSchema, formData, (principal, input) => saveEmailTemplate(principal, { ...input, name }), {
    message: 'Template saved. The next email of this kind uses it.',
    revalidate: ['/admin/email-templates'],
  });
}
