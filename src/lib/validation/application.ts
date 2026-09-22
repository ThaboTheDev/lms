import { z } from 'zod';
import { emailSchema, isoDateSchema, nameSchema, phoneSchema } from './common';

export const applicationSubmissionSchema = z.object({
  firstName: nameSchema,
  lastName: nameSchema,
  email: emailSchema,
  phone: phoneSchema,
  dateOfBirth: isoDateSchema.optional(),
  nationality: z.string().trim().max(60).optional().or(z.literal('')),
  programmeId: z.string().min(1, 'Choose the programme you are applying for.'),
  academicYearId: z.string().min(1, 'Choose the year you want to start.'),
  intakeTermId: z.string().optional().or(z.literal('')),
  highestQualification: z.string().trim().max(120).optional().or(z.literal('')),
  schoolOrInstitution: z.string().trim().max(120).optional().or(z.literal('')),
  yearCompleted: z.string().trim().max(4).optional().or(z.literal('')),
  popiaConsent: z.literal('on', {
    errorMap: () => ({ message: 'You must agree before the application can be submitted.' }),
  }),
});

export const applicationDecisionSchema = z.object({
  applicationId: z.string().min(1),
  decision: z.enum(['OFFER', 'CONDITIONAL_OFFER', 'REJECTED', 'UNDER_REVIEW', 'DOCUMENTS_OUTSTANDING', 'INTERVIEW', 'WITHDRAWN']),
  notes: z.string().trim().max(2000).optional().or(z.literal('')),
  conditions: z.string().trim().max(2000).optional().or(z.literal('')),
});

export type ApplicationSubmission = z.infer<typeof applicationSubmissionSchema>;
