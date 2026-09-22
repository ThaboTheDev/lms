import { z } from 'zod';

const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(2, 'Enter a code of at least two characters.')
  .max(20, 'Keep codes under 20 characters.')
  .regex(/^[A-Z0-9][A-Z0-9\-]*$/, 'Use letters, digits and hyphens only.');

export const qualificationSchema = z.object({
  code: codeSchema,
  title: z.string().trim().min(3).max(160),
  type: z.enum([
    'HIGHER_CERTIFICATE', 'DIPLOMA', 'ADVANCED_DIPLOMA', 'BACHELOR',
    'POSTGRADUATE_DIPLOMA', 'HONOURS', 'MASTERS', 'DOCTORAL',
    'SHORT_COURSE', 'SKILLS_PROGRAMME', 'PROFESSIONAL_DEVELOPMENT',
  ]),
  nqfLevel: z.coerce.number().int().min(1).max(10).optional(),
  minimumCredits: z.coerce.number().int().min(0).max(1000).optional(),
  saqaId: z.string().trim().max(30).optional().or(z.literal('')),
});

export const programmeSchema = z.object({
  code: codeSchema,
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  departmentId: z.string().min(1, 'Choose a department.'),
  qualificationId: z.string().min(1, 'Choose the qualification this programme leads to.'),
  durationMonths: z.coerce.number().int().min(1).max(96).optional(),
  entryRequirements: z.string().trim().max(2000).optional().or(z.literal('')),
  deliveryModes: z
    .array(z.enum(['CONTACT', 'ONLINE', 'BLENDED', 'DISTANCE', 'WORKPLACE']))
    .min(1, 'Choose at least one delivery mode.'),
});

export const courseSchema = z.object({
  code: codeSchema,
  title: z.string().trim().min(3).max(160),
  description: z.string().trim().max(2000).optional().or(z.literal('')),
  departmentId: z.string().optional().or(z.literal('')),
  credits: z.coerce.number().int().min(0).max(200),
  notionalHours: z.coerce.number().int().min(0).max(2000).optional(),
  nqfLevel: z.coerce.number().int().min(1).max(10).optional(),
});

export const curriculumItemSchema = z.object({
  programmeId: z.string().min(1),
  courseId: z.string().min(1, 'Choose a course.'),
  yearOfStudy: z.coerce.number().int().min(1).max(8),
  termNumber: z.coerce.number().int().min(1).max(4),
  isCompulsory: z.coerce.boolean().default(true),
  credits: z.coerce.number().int().min(0).max(200).optional(),
});
