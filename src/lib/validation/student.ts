import { z } from 'zod';
import { emailSchema, isoDateSchema, nameSchema, phoneSchema } from './common';

/**
 * Identity fields sit in their own schema because they are gated behind
 * `student.read.sensitive` and are never returned by the ordinary list query.
 */
export const studentIdentitySchema = z.object({
  nationalIdRef: z
    .string()
    .trim()
    .regex(/^\d{13}$/, 'A South African identity number is 13 digits.')
    .optional()
    .or(z.literal('')),
  passportNumber: z.string().trim().max(30).optional().or(z.literal('')),
  dateOfBirth: isoDateSchema.optional(),
  nationality: z.string().trim().max(60).optional().or(z.literal('')),
});

export const studentContactSchema = z.object({
  phone: phoneSchema,
  addressLine1: z.string().trim().max(120).optional().or(z.literal('')),
  addressLine2: z.string().trim().max(120).optional().or(z.literal('')),
  city: z.string().trim().max(60).optional().or(z.literal('')),
  province: z.string().trim().max(60).optional().or(z.literal('')),
  postalCode: z.string().trim().max(10).optional().or(z.literal('')),
  country: z.string().trim().length(2).default('ZA'),
  emergencyName: z.string().trim().max(80).optional().or(z.literal('')),
  emergencyPhone: phoneSchema,
  emergencyRelation: z.string().trim().max(40).optional().or(z.literal('')),
});

export const createStudentSchema = z
  .object({
    firstName: nameSchema,
    lastName: nameSchema,
    preferredName: z.string().trim().max(60).optional().or(z.literal('')),
    email: emailSchema,
    homeLanguage: z.string().trim().max(40).optional().or(z.literal('')),
    programmeId: z.string().min(1, 'Choose a programme.'),
    academicYearId: z.string().min(1, 'Choose an academic year.'),
    cohortId: z.string().optional().or(z.literal('')),
  })
  .and(studentContactSchema)
  .and(studentIdentitySchema);

export const updateStudentSchema = studentContactSchema.extend({
  preferredName: z.string().trim().max(60).optional().or(z.literal('')),
  homeLanguage: z.string().trim().max(40).optional().or(z.literal('')),
});

export type CreateStudentInput = z.infer<typeof createStudentSchema>;
