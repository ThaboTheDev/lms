/**
 * Development seed. Everything below is fictional: the institution, the people
 * and the records. Never run this against a production database.
 *
 *   npm run db:seed
 */
import { PrismaClient, type Prisma } from '@prisma/client';
import { hash } from '@node-rs/argon2';
import { PERMISSIONS } from '../src/lib/rbac/permissions';
import { SYSTEM_ROLES } from '../src/lib/rbac/roles';
import {
  formatCertificateNumber,
  generateVerificationCode,
} from '../src/server/services/credential-codes';

const prisma = new PrismaClient();
const PASSWORD = 'Seeded-Passphrase-2026';

async function main() {
  const passwordHash = await hash(PASSWORD, { memoryCost: 19456, timeCost: 2, parallelism: 1 });

  // ---------------------------------------------------------- permissions --
  for (const [key, meta] of Object.entries(PERMISSIONS)) {
    await prisma.permission.upsert({
      where: { key },
      create: { key, group: meta.group, description: meta.description },
      update: { group: meta.group, description: meta.description },
    });
  }

  // Rename the fictional Kopano row if a previous seed created it, so the
  // same database becomes MSRI instead of growing a second institution.
  const legacy = await prisma.institution.findUnique({ where: { slug: 'kopano' } });
  if (legacy) {
    const taken = await prisma.institution.findUnique({ where: { slug: 'msri' } });
    if (!taken) {
      await prisma.institution.update({ where: { id: legacy.id }, data: { slug: 'msri' } });
    }
  }

  const institutionProfile = {
    name: 'Mzuvukile Slabbert Radebe Institute',
    shortName: 'MSRI',
    registrationNo: '2015/MSRI/07',
    contactEmail: 'info@msri.online',
    contactPhone: '+27 11 000 0000',
    emailFromName: 'MSRI',
    emailFromAddress: 'info@msri.online',
    addressLine1: 'MSRI Academic Complex',
    city: 'Johannesburg',
    province: 'Gauteng',
    country: 'ZA',
    certificatePrefix: 'MSRI',
    primaryColour: '#0B113B',
    secondaryColour: '#CBA65E',
    footerText: 'Mzuvukile Slabbert Radebe Institute · Est. 2015',
  };

  const institution = await prisma.institution.upsert({
    where: { slug: 'msri' },
    update: institutionProfile,
    create: {
      slug: 'msri',
      ...institutionProfile,
    },
  });

  // ---------------------------------------------------------------- roles --
  const roleIds = new Map<string, string>();
  for (const definition of SYSTEM_ROLES) {
    const role = await prisma.role.upsert({
      where: { institutionId_key: { institutionId: institution.id, key: definition.key } },
      update: { name: definition.name, description: definition.description },
      create: {
        institutionId: institution.id,
        key: definition.key,
        name: definition.name,
        description: definition.description,
        isSystem: true,
      },
    });
    roleIds.set(definition.key, role.id);

    if (definition.permissions !== '*') {
      const permissions = await prisma.permission.findMany({
        where: { key: { in: [...definition.permissions] } },
        select: { id: true },
      });
      await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
      await prisma.rolePermission.createMany({
        data: permissions.map((p) => ({ roleId: role.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }
  }

  // ---------------------------------------------------------------- users --
  async function createUser(
    email: string,
    firstName: string,
    lastName: string,
    roleKey: string,
    extra: Partial<Prisma.UserCreateInput> = {},
  ) {
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        firstName,
        lastName,
        passwordHash,
        status: 'ACTIVE',
        emailVerifiedAt: new Date(),
        institution: { connect: { id: institution.id } },
        ...extra,
      },
    });

    const roleId = roleIds.get(roleKey);
    if (roleId) {
      await prisma.userRole.upsert({
        where: {
          userId_roleId_scopeType_scopeId: {
            userId: user.id,
            roleId,
            scopeType: 'INSTITUTION',
            scopeId: null as never,
          },
        },
        update: {},
        create: { userId: user.id, roleId, scopeType: 'INSTITUTION', institutionId: institution.id },
      });
    }
    return user;
  }

  await createUser('super.admin@kopano.example.ac.za', 'Palesa', 'Ndlovu', 'SUPER_ADMIN');
  await createUser('principal@kopano.example.ac.za', 'Sipho', 'Mahlangu', 'INSTITUTION_ADMIN');
  await createUser('registrar@kopano.example.ac.za', 'Anele', 'Dube', 'REGISTRAR');
  await createUser('academic@kopano.example.ac.za', 'Refilwe', 'Motaung', 'ACADEMIC_ADMIN');
  const lecturer = await createUser('lecturer@kopano.example.ac.za', 'Thabo', 'Khumalo', 'LECTURER');
  await createUser('finance@kopano.example.ac.za', 'Zanele', 'Botha', 'FINANCE_OFFICER');
  await createUser('quality@kopano.example.ac.za', 'Naledi', 'Pillay', 'QA_OFFICER');
  await createUser('support@kopano.example.ac.za', 'Kabelo', 'Jacobs', 'SUPPORT_STAFF');

  await prisma.staffProfile.upsert({
    where: { userId: lecturer.id },
    update: {},
    create: {
      institutionId: institution.id,
      userId: lecturer.id,
      staffNumber: 'STF-0001',
      jobTitle: 'Senior Lecturer',
      employmentType: 'PERMANENT',
    },
  });

  // ---------------------------------------------------- academic structure --
  const faculty = await prisma.faculty.upsert({
    where: { institutionId_code: { institutionId: institution.id, code: 'FBM' } },
    update: {},
    create: { institutionId: institution.id, code: 'FBM', name: 'Faculty of Business and Management' },
  });

  const department = await prisma.department.upsert({
    where: { institutionId_code: { institutionId: institution.id, code: 'DBA' } },
    update: {},
    create: {
      institutionId: institution.id,
      facultyId: faculty.id,
      code: 'DBA',
      name: 'Department of Business Administration',
    },
  });

  const qualification = await prisma.qualification.upsert({
    where: { institutionId_code: { institutionId: institution.id, code: 'HCBM' } },
    update: {},
    create: {
      institutionId: institution.id,
      code: 'HCBM',
      title: 'Higher Certificate in Business Management',
      type: 'HIGHER_CERTIFICATE',
      nqfLevel: 5,
      minimumCredits: 120,
      saqaId: '00000-FICTIONAL',
    },
  });

  const programme = await prisma.programme.upsert({
    where: { institutionId_code: { institutionId: institution.id, code: 'HCBM-FT' } },
    update: {},
    create: {
      institutionId: institution.id,
      departmentId: department.id,
      qualificationId: qualification.id,
      code: 'HCBM-FT',
      title: 'Higher Certificate in Business Management (full time)',
      deliveryModes: ['CONTACT', 'BLENDED'],
      durationMonths: 12,
      entryRequirements: 'National Senior Certificate with a higher certificate endorsement.',
      isActive: true,
    },
  });

  const academicYear = await prisma.academicYear.upsert({
    where: { institutionId_year: { institutionId: institution.id, year: 2026 } },
    update: {},
    create: {
      institutionId: institution.id,
      year: 2026,
      label: '2026 academic year',
      startsOn: new Date('2026-01-19'),
      endsOn: new Date('2026-11-27'),
      isCurrent: true,
    },
  });

  const term = await prisma.academicTerm.upsert({
    where: { academicYearId_code: { academicYearId: academicYear.id, code: 'S1' } },
    update: {},
    create: {
      academicYearId: academicYear.id,
      code: 'S1',
      name: 'Semester 1',
      type: 'SEMESTER',
      startsOn: new Date('2026-01-19'),
      endsOn: new Date('2026-06-19'),
      isCurrent: true,
    },
  });

  const courseDefinitions = [
    { code: 'BUS101', title: 'Introduction to Business Management', credits: 20 },
    { code: 'ACC101', title: 'Financial Accounting Fundamentals', credits: 20 },
    { code: 'COM101', title: 'Business Communication', credits: 15 },
  ];

  for (const [index, definition] of courseDefinitions.entries()) {
    const course = await prisma.course.upsert({
      where: { institutionId_code: { institutionId: institution.id, code: definition.code } },
      update: {},
      create: {
        institutionId: institution.id,
        departmentId: department.id,
        code: definition.code,
        title: definition.title,
        credits: definition.credits,
        nqfLevel: 5,
      },
    });

    await prisma.curriculumItem.upsert({
      where: {
        programmeId_courseId_yearOfStudy_termNumber: {
          programmeId: programme.id,
          courseId: course.id,
          yearOfStudy: 1,
          termNumber: 1,
        },
      },
      update: {},
      create: {
        programmeId: programme.id,
        courseId: course.id,
        yearOfStudy: 1,
        termNumber: 1,
        credits: definition.credits,
        orderIndex: index,
      },
    });

    const offering = await prisma.courseOffering.upsert({
      where: {
        courseId_academicTermId_sectionCode: {
          courseId: course.id,
          academicTermId: term.id,
          sectionCode: 'A',
        },
      },
      update: {},
      create: {
        institutionId: institution.id,
        courseId: course.id,
        academicTermId: term.id,
        sectionCode: 'A',
        deliveryMode: 'BLENDED',
        status: 'ACTIVE',
        coordinatorId: lecturer.id,
      },
    });

    await prisma.offeringStaff.upsert({
      where: {
        offeringId_userId_role: { offeringId: offering.id, userId: lecturer.id, role: 'LECTURER' },
      },
      update: {},
      create: { offeringId: offering.id, userId: lecturer.id, role: 'LECTURER' },
    });
  }

  // ------------------------------------------------------------- grading ---
  const scheme = await prisma.gradingScheme.upsert({
    where: { institutionId_name: { institutionId: institution.id, name: 'Standard percentage' } },
    update: {},
    create: {
      institutionId: institution.id,
      name: 'Standard percentage',
      type: 'PERCENTAGE',
      isDefault: true,
    },
  });

  const bands = [
    { label: 'Distinction', minPercent: 75, maxPercent: 100, isPass: true },
    { label: 'Merit', minPercent: 65, maxPercent: 74.99, isPass: true },
    { label: 'Pass', minPercent: 50, maxPercent: 64.99, isPass: true },
    { label: 'Fail', minPercent: 0, maxPercent: 49.99, isPass: false },
  ];
  if ((await prisma.gradeBand.count({ where: { schemeId: scheme.id } })) === 0) {
    await prisma.gradeBand.createMany({ data: bands.map((b) => ({ ...b, schemeId: scheme.id })) });
  }

  // ------------------------------------------------------------ students ---
  const cohort = await prisma.cohort.upsert({
    where: { institutionId_code: { institutionId: institution.id, code: 'HCBM-2026-A' } },
    update: {},
    create: {
      institutionId: institution.id,
      programmeId: programme.id,
      academicYearId: academicYear.id,
      code: 'HCBM-2026-A',
      name: 'Higher Certificate 2026 intake A',
    },
  });

  const learners = [
    ['lerato.mokoena@student.kopano.example.ac.za', 'Lerato', 'Mokoena'],
    ['sibusiso.nkosi@student.kopano.example.ac.za', 'Sibusiso', 'Nkosi'],
    ['aisha.patel@student.kopano.example.ac.za', 'Aisha', 'Patel'],
    ['johan.vanwyk@student.kopano.example.ac.za', 'Johan', 'van Wyk'],
    ['nomvula.sithole@student.kopano.example.ac.za', 'Nomvula', 'Sithole'],
  ] as const;

  const offerings = await prisma.courseOffering.findMany({ where: { institutionId: institution.id } });

  for (const [index, [email, firstName, lastName]] of learners.entries()) {
    const user = await createUser(email, firstName, lastName, 'STUDENT');
    const student = await prisma.studentProfile.upsert({
      where: { userId: user.id },
      update: {},
      create: {
        institutionId: institution.id,
        userId: user.id,
        studentNumber: `2026${String(index + 1).padStart(5, '0')}`,
        admissionStatus: 'REGISTERED',
        city: 'Vereeniging',
        province: 'Gauteng',
        country: 'ZA',
      },
    });

    await prisma.programmeEnrolment.upsert({
      where: {
        studentId_programmeId_academicYearId: {
          studentId: student.id,
          programmeId: programme.id,
          academicYearId: academicYear.id,
        },
      },
      update: {},
      create: {
        institutionId: institution.id,
        studentId: student.id,
        programmeId: programme.id,
        cohortId: cohort.id,
        academicYearId: academicYear.id,
      },
    });

    for (const offering of offerings) {
      await prisma.courseEnrolment.upsert({
        where: { studentId_offeringId: { studentId: student.id, offeringId: offering.id } },
        update: {},
        create: { institutionId: institution.id, studentId: student.id, offeringId: offering.id },
      });
    }
  }

  // ---------------------------------------------------- course content ----
  const busOffering = await prisma.courseOffering.findFirst({
    where: { institutionId: institution.id, course: { code: 'BUS101' } },
    select: { id: true },
  });

  if (busOffering && (await prisma.courseSection.count({ where: { offeringId: busOffering.id } })) === 0) {
    interface LessonSpec {
      title: string;
      type: 'PAGE' | 'DISCUSSION';
      minutes: number;
      text: string;
      mandatory?: boolean;
    }

    const outline: { title: string; summary: string; lessons: LessonSpec[] }[] = [
      {
        title: 'Week 1: What management actually is',
        summary: 'The work of managing, and why organisations need it.',
        lessons: [
          {
            title: 'Welcome and how this course runs',
            type: 'PAGE',
            minutes: 10,
            text: 'This course runs over twelve weeks, with a mix of contact sessions and work you do in your own time.\n\nEach week has a reading, a short activity and a discussion. The two assessments are a written assignment in week six and an examination at the end of the semester.',
          },
          {
            title: 'Reading: the four functions of management',
            type: 'PAGE',
            minutes: 40,
            text: 'Planning, organising, leading and controlling are the four functions most textbooks use to describe managerial work.\n\nThey are a useful map rather than a description of anyone\'s day. Real managers move between all four within an hour, and the proportions shift with seniority.',
          },
          {
            title: 'Activity: map a week of your own work',
            type: 'PAGE',
            minutes: 30,
            mandatory: false,
            text: 'Keep a simple log for five working days. Against each hour, note which of the four functions best describes what you were doing.\n\nBring the log to the week two contact session.',
          },
        ],
      },
      {
        title: 'Week 2: Organisational structure',
        summary: 'How the shape of an organisation changes what it can do.',
        lessons: [
          {
            title: 'Reading: structure follows strategy',
            type: 'PAGE',
            minutes: 45,
            text: 'Chandler\'s argument was that firms change their structure after they change their strategy, not before.\n\nWe will test that claim against two South African examples in the contact session.',
          },
          {
            title: 'Discussion: flat or hierarchical?',
            type: 'DISCUSSION',
            minutes: 20,
            text: 'Post one organisation you know well and say whether its structure helps or hinders the work. Reply to two classmates.',
          },
        ],
      },
    ];

    for (const [sectionIndex, sectionSpec] of outline.entries()) {
      const section = await prisma.courseSection.create({
        data: {
          offeringId: busOffering.id,
          title: sectionSpec.title,
          summary: sectionSpec.summary,
          orderIndex: sectionIndex,
          isPublished: true,
        },
      });

      for (const [lessonIndex, lessonSpec] of sectionSpec.lessons.entries()) {
        await prisma.lesson.create({
          data: {
            sectionId: section.id,
            title: lessonSpec.title,
            type: lessonSpec.type,
            orderIndex: lessonIndex,
            estimatedMinutes: lessonSpec.minutes,
            isMandatory: lessonSpec.mandatory ?? true,
            isPublished: true,
            blocks: {
              create: {
                kind: 'RICH_TEXT',
                orderIndex: 0,
                richText: {
                  blocks: lessonSpec.text.split('\n\n').map((paragraph) => ({ text: paragraph })),
                },
              },
            },
          },
        });
      }
    }
  }

  // ------------------------------------------------ prerequisite rules ----
  const accounting = await prisma.course.findUnique({
    where: { institutionId_code: { institutionId: institution.id, code: 'ACC101' } },
    select: { id: true },
  });
  const business = await prisma.course.findUnique({
    where: { institutionId_code: { institutionId: institution.id, code: 'BUS101' } },
    select: { id: true },
  });
  const communication = await prisma.course.findUnique({
    where: { institutionId_code: { institutionId: institution.id, code: 'COM101' } },
    select: { id: true },
  });

  if (accounting && business) {
    await prisma.coursePrerequisite.upsert({
      where: {
        courseId_requiredCourseId: { courseId: accounting.id, requiredCourseId: business.id },
      },
      update: {},
      create: { courseId: accounting.id, requiredCourseId: business.id, kind: 'RECOMMENDED' },
    });
  }
  if (communication && business) {
    await prisma.coursePrerequisite.upsert({
      where: {
        courseId_requiredCourseId: { courseId: communication.id, requiredCourseId: business.id },
      },
      update: {},
      create: { courseId: communication.id, requiredCourseId: business.id, kind: 'COREQUISITE' },
    });
  }

  // ----------------------------------------------------- assessments ------
  if (busOffering) {
    const bank = await prisma.questionBank.upsert({
      where: { id: 'seed-bank-bus101' },
      update: {},
      create: {
        id: 'seed-bank-bus101',
        institutionId: institution.id,
        name: 'BUS101 multiple choice',
        description: 'Week 1 and 2 knowledge checks.',
      },
    });

    if ((await prisma.question.count({ where: { bankId: bank.id } })) === 0) {
      const questions = [
        {
          type: 'MULTIPLE_CHOICE' as const,
          text: 'Which of these is NOT one of the four functions of management?',
          options: [
            { content: 'Planning', isCorrect: false },
            { content: 'Organising', isCorrect: false },
            { content: 'Auditing', isCorrect: true },
            { content: 'Controlling', isCorrect: false },
          ],
          topic: 'functions',
        },
        {
          type: 'MULTIPLE_RESPONSE' as const,
          text: 'Which of these are managerial functions? Choose all that apply.',
          options: [
            { content: 'Leading', isCorrect: true },
            { content: 'Planning', isCorrect: true },
            { content: 'Invoicing', isCorrect: false },
            { content: 'Controlling', isCorrect: true },
          ],
          topic: 'functions',
        },
        {
          type: 'TRUE_FALSE' as const,
          text: "Chandler argued that a firm's structure tends to change after its strategy does.",
          options: [
            { content: 'true', isCorrect: true },
            { content: 'false', isCorrect: false },
          ],
          topic: 'structure',
        },
        {
          type: 'SHORT_ANSWER' as const,
          text: 'Name the management function concerned with comparing results against the plan.',
          options: [{ content: 'controlling', isCorrect: true }],
          topic: 'functions',
        },
      ];

      for (const spec of questions) {
        await prisma.question.create({
          data: {
            institutionId: institution.id,
            bankId: bank.id,
            type: spec.type,
            prompt: { text: spec.text, settings: {} },
            defaultMark: 2,
            difficulty: 'MODERATE',
            topic: spec.topic,
            options: {
              create: spec.options.map((option, index) => ({
                content: option.content,
                isCorrect: option.isCorrect,
                orderIndex: index,
              })),
            },
          },
        });
      }
    }

    if ((await prisma.assessment.count({ where: { offeringId: busOffering.id } })) === 0) {
      const rubric = await prisma.rubric.create({
        data: {
          institutionId: institution.id,
          title: 'Written assignment rubric',
          description: 'Used for the week six assignment.',
          totalScore: 25,
          criteria: {
            create: [
              {
                title: 'Argument',
                description: 'A clear position, developed and defended.',
                weight: 3,
                maxScore: 10,
                orderIndex: 0,
                levels: {
                  create: [
                    { label: 'Excellent', score: 10, orderIndex: 0, descriptor: 'Position is clear and well defended throughout.' },
                    { label: 'Competent', score: 7, orderIndex: 1, descriptor: 'Position is clear but thinly defended.' },
                    { label: 'Developing', score: 4, orderIndex: 2, descriptor: 'Position is implied rather than stated.' },
                    { label: 'Not yet', score: 0, orderIndex: 3, descriptor: 'No discernible position.' },
                  ],
                },
              },
              {
                title: 'Use of evidence',
                weight: 2,
                maxScore: 10,
                orderIndex: 1,
                levels: {
                  create: [
                    { label: 'Excellent', score: 10, orderIndex: 0 },
                    { label: 'Competent', score: 7, orderIndex: 1 },
                    { label: 'Developing', score: 4, orderIndex: 2 },
                    { label: 'Not yet', score: 0, orderIndex: 3 },
                  ],
                },
              },
              {
                title: 'Referencing',
                weight: 1,
                maxScore: 5,
                orderIndex: 2,
                levels: {
                  create: [
                    { label: 'Consistent', score: 5, orderIndex: 0 },
                    { label: 'Mostly consistent', score: 3, orderIndex: 1 },
                    { label: 'Inconsistent', score: 0, orderIndex: 2 },
                  ],
                },
              },
            ],
          },
        },
      });

      const quiz = await prisma.assessment.create({
        data: {
          institutionId: institution.id,
          offeringId: busOffering.id,
          title: 'Week 2 knowledge check',
          instructions: 'Four questions on the first two weeks. You have fifteen minutes and one attempt.',
          type: 'QUIZ',
          category: 'FORMATIVE',
          maxMark: 8,
          passMark: 4,
          weight: 20,
          dueAt: new Date('2026-02-06T23:59:00Z'),
          closesAt: new Date('2026-02-08T23:59:00Z'),
          timeLimitMinutes: 15,
          maxAttempts: 1,
          allowLate: true,
          latePenaltyPct: 10,
          shuffleQuestions: true,
          gradingSchemeId: scheme.id,
          status: 'PUBLISHED',
        },
      });

      const bankQuestions = await prisma.question.findMany({
        where: { bankId: bank.id },
        select: { id: true },
      });

      await prisma.assessmentQuestion.createMany({
        data: bankQuestions.map((question, index) => ({
          assessmentId: quiz.id,
          questionId: question.id,
          mark: 2,
          orderIndex: index,
        })),
      });

      await prisma.assessment.create({
        data: {
          institutionId: institution.id,
          offeringId: busOffering.id,
          title: 'Assignment 1: mapping management work',
          instructions:
            'Using the log you kept in week one, write 1 500 words on how your week divided across the four functions of management, and what that says about the level you are working at.',
          type: 'ASSIGNMENT',
          category: 'SUMMATIVE',
          maxMark: 25,
          passMark: 12.5,
          weight: 80,
          dueAt: new Date('2026-03-13T23:59:00Z'),
          closesAt: new Date('2026-03-20T23:59:00Z'),
          maxAttempts: 1,
          allowLate: true,
          latePenaltyPct: 10,
          rubricId: rubric.id,
          gradingSchemeId: scheme.id,
          status: 'PUBLISHED',
        },
      });
    }
  }

  // ---------------------------------------------------- applications ------
  const applicants = [
    ['Karabo', 'Mthembu', 'karabo.mthembu@example.com', 'SUBMITTED'],
    ['Fatima', 'Adams', 'fatima.adams@example.com', 'UNDER_REVIEW'],
    ['Tumelo', 'Radebe', 'tumelo.radebe@example.com', 'DOCUMENTS_OUTSTANDING'],
    ['Chantal', 'du Plessis', 'chantal.duplessis@example.com', 'OFFER'],
    ['Mandla', 'Zwane', 'mandla.zwane@example.com', 'ACCEPTED'],
  ] as const;

  for (const [index, [firstName, lastName, email, status]] of applicants.entries()) {
    const referenceNumber = `APP-2026-${String(index + 1).padStart(5, '0')}`;
    const existing = await prisma.application.findUnique({ where: { referenceNumber } });
    if (existing) continue;

    await prisma.application.create({
      data: {
        institutionId: institution.id,
        referenceNumber,
        firstName,
        lastName,
        email,
        phone: '0820000000',
        nationality: 'South African',
        programmeId: programme.id,
        academicYearId: academicYear.id,
        intakeTermId: term.id,
        status,
        submittedAt: new Date(2025, 9, 1 + index),
        answers: {
          highestQualification: 'National Senior Certificate',
          schoolOrInstitution: 'Fictional Secondary School',
          yearCompleted: '2025',
          popiaConsentAt: new Date(2025, 9, 1 + index).toISOString(),
        },
        events: {
          create: [
            { toStatus: 'SUBMITTED', note: 'Application submitted online.' },
            ...(status === 'SUBMITTED'
              ? []
              : [{ fromStatus: 'SUBMITTED' as const, toStatus: status, note: 'Seeded pipeline position.' }]),
          ],
        },
      },
    });
  }

  // --------------------------------------------------- email templates ----
  const emailTemplates = [
    {
      key: 'grade.released',
      name: 'Result released',
      subject: 'Your result for {{title}} is available',
      bodyHtml:
        '<p>Hello {{firstName}},</p><p>{{body}}</p><p><a href="{{link}}">Open it in the platform</a></p><p>{{institution}}</p>',
    },
    {
      key: 'assessment.published',
      name: 'Assessment set',
      subject: 'New assessment: {{title}}',
      bodyHtml:
        '<p>Hello {{firstName}},</p><p>{{body}}</p><p><a href="{{link}}">See what is required</a></p><p>{{institution}}</p>',
    },
    {
      key: 'admission.decision',
      name: 'Admission decision',
      subject: 'An update on your application',
      bodyHtml:
        '<p>Dear {{firstName}},</p><p>{{body}}</p><p><a href="{{link}}">Sign in to see the detail</a></p><p>{{institution}}</p>',
    },
  ];

  for (const template of emailTemplates) {
    await prisma.emailTemplate.upsert({
      where: { institutionId_key: { institutionId: institution.id, key: template.key } },
      update: {},
      create: {
        institutionId: institution.id,
        key: template.key,
        name: template.name,
        subject: template.subject,
        bodyHtml: template.bodyHtml,
        variables: ['firstName', 'title', 'body', 'link', 'institution'],
      },
    });
  }

  // -------------------------------------- attendance, forum, announcement --
  if (busOffering) {
    if ((await prisma.attendanceSession.count({ where: { offeringId: busOffering.id } })) === 0) {
      const enrolled = await prisma.courseEnrolment.findMany({
        where: { offeringId: busOffering.id },
        select: { studentId: true },
      });

      const sessions = [
        { title: 'Week 1 lecture', day: 20, marks: ['PRESENT', 'PRESENT', 'ABSENT', 'PRESENT', 'LATE'] },
        { title: 'Week 2 lecture', day: 27, marks: ['PRESENT', 'ABSENT', 'ABSENT', 'PRESENT', 'PRESENT'] },
        { title: 'Week 3 lecture', day: 34, marks: ['PRESENT', 'ABSENT', 'EXCUSED', 'PRESENT', 'PRESENT'] },
      ];

      for (const spec of sessions) {
        const start = new Date(2026, 0, spec.day, 9, 0);
        const session = await prisma.attendanceSession.create({
          data: {
            institutionId: institution.id,
            offeringId: busOffering.id,
            title: spec.title,
            mode: 'IN_PERSON',
            scheduledStart: start,
            scheduledEnd: new Date(start.getTime() + 2 * 3600_000),
            venue: 'Lecture room 2',
            selfCheckInEnabled: true,
            checkInCode: 'K7M3Q',
          },
        });

        await prisma.attendanceRecord.createMany({
          data: enrolled.map((enrolment, index) => ({
            sessionId: session.id,
            studentId: enrolment.studentId,
            status: (spec.marks[index] ?? 'PRESENT') as never,
            method: 'MANUAL' as const,
            markedAt: start,
          })),
          skipDuplicates: true,
        });
      }
    }

    if ((await prisma.forum.count({ where: { offeringId: busOffering.id } })) === 0) {
      await prisma.forum.create({
        data: {
          institutionId: institution.id,
          offeringId: busOffering.id,
          title: 'BUS101 discussion',
          description: 'Questions and discussion for everyone taking this course.',
          threads: {
            create: {
              authorId: lecturer.id,
              title: 'Read this before week two',
              isPinned: true,
              posts: {
                create: {
                  authorId: lecturer.id,
                  body: 'Bring your management log to the week two session. If you have not kept one, start now and note what you can remember from the past few days.',
                },
              },
            },
          },
        },
      });
    }
  }

  if ((await prisma.announcement.count({ where: { institutionId: institution.id } })) === 0) {
    await prisma.announcement.create({
      data: {
        institutionId: institution.id,
        title: 'Registration for semester two closes on 10 July',
        body: 'Registration for the second semester closes at 16:00 on 10 July. Speak to the registry if your account is still outstanding, since an unpaid account blocks registration.',
        audience: 'INSTITUTION',
        isPinned: true,
        publishedAt: new Date('2026-06-01'),
        authorId: null,
      },
    });
  }

  // ------------------------------------------------- results and records --
  // Enough resolved results that the gradebook, the progression board and the
  // transcript have something real to work with.
  const seededEnrolments = await prisma.courseEnrolment.findMany({
    where: { institutionId: institution.id },
    orderBy: [{ studentId: 'asc' }, { offeringId: 'asc' }],
    select: {
      id: true,
      studentId: true,
      resultsPublishedAt: true,
      offering: { select: { course: { select: { code: true, credits: true } } } },
    },
  });

  const resultPattern: Record<string, { mark: number; grade: string; result: string }> = {
    BUS101: { mark: 71, grade: 'Merit', result: 'PASS' },
    ACC101: { mark: 44, grade: 'Fail', result: 'FAIL' },
    COM101: { mark: 63, grade: 'Pass', result: 'PASS' },
  };

  const studentsSeen = new Set<string>();
  for (const enrolment of seededEnrolments) {
    if (enrolment.resultsPublishedAt) continue;

    studentsSeen.add(enrolment.studentId);
    // The first three learners get resolved results; the rest stay in progress
    // so the board shows both settled and outstanding cases.
    if (studentsSeen.size > 3) continue;

    const pattern = resultPattern[enrolment.offering.course.code];
    if (!pattern) continue;

    // Learner three passes everything, so the board has one graduation case
    // alongside two learners carrying a failed module.
    const passes = studentsSeen.size === 3 || pattern.result === 'PASS';

    await prisma.courseEnrolment.update({
      where: { id: enrolment.id },
      data: {
        finalMark: passes ? Math.max(pattern.mark, 55) : pattern.mark,
        finalGrade: passes ? 'Pass' : 'Fail',
        result: passes ? 'PASS' : 'FAIL',
        creditsAwarded: passes ? enrolment.offering.course.credits : 0,
        resultsPublishedAt: new Date('2026-06-25'),
        status: 'COMPLETED',
      },
    });
  }

  // ------------------------------------------------------- a certificate --
  const shortCourseHolder = await prisma.studentProfile.findFirst({
    where: { institutionId: institution.id },
    orderBy: { studentNumber: 'asc' },
    select: { id: true, studentNumber: true, user: { select: { firstName: true, lastName: true } } },
  });

  if (shortCourseHolder && (await prisma.certificate.count({ where: { institutionId: institution.id } })) === 0) {
    const verificationCode = generateVerificationCode(
      Uint8Array.from(Array.from({ length: 11 }, (_, index) => (index * 37 + 11) % 251)),
    );

    await prisma.certificate.create({
      data: {
        institutionId: institution.id,
        studentId: shortCourseHolder.id,
        kind: 'SHORT_COURSE',
        number: formatCertificateNumber(institution.certificatePrefix, 2026, 1),
        verificationCode,
        title: 'Short Course in Business Communication',
        completionDate: new Date('2026-05-30'),
        issuedOn: new Date('2026-06-02'),
        status: 'ISSUED',
        metadata: {
          holder: `${shortCourseHolder.user.firstName} ${shortCourseHolder.user.lastName}`,
          studentNumber: shortCourseHolder.studentNumber,
          institution: institution.name,
        },
      },
    });

    console.log(`Seeded certificate verification code: ${verificationCode}`);
  }

  // ------------------------------------------------------------- finance --
  if ((await prisma.feeStructure.count({ where: { institutionId: institution.id } })) === 0) {
    await prisma.feeStructure.createMany({
      data: [
        {
          institutionId: institution.id,
          programmeId: programme.id,
          academicYearId: academicYear.id,
          name: 'Higher Certificate tuition, full year',
          feeType: 'TUITION',
          amount: 24_000,
        },
        {
          institutionId: institution.id,
          academicYearId: academicYear.id,
          name: 'Registration',
          feeType: 'REGISTRATION',
          amount: 1_500,
        },
        {
          institutionId: institution.id,
          name: 'Application',
          feeType: 'APPLICATION',
          amount: 250,
        },
      ],
    });
  }

  if ((await prisma.invoice.count({ where: { institutionId: institution.id } })) === 0) {
    const learners = await prisma.studentProfile.findMany({
      where: { institutionId: institution.id },
      orderBy: { studentNumber: 'asc' },
      select: { id: true, studentNumber: true },
    });

    for (const [index, learner] of learners.entries()) {
      const number = `INV-2026-${String(index + 1).padStart(6, '0')}`;
      const total = 25_500;

      const invoice = await prisma.invoice.create({
        data: {
          institutionId: institution.id,
          studentId: learner.id,
          number,
          academicYearId: academicYear.id,
          status: 'ISSUED',
          issuedOn: new Date('2026-01-20'),
          dueOn: new Date('2026-02-28'),
          subtotal: total,
          discountTotal: 0,
          total,
          balance: total,
          lines: {
            create: [
              {
                description: 'Higher Certificate tuition, full year',
                feeType: 'TUITION',
                quantity: 1,
                unitAmount: 24_000,
                lineTotal: 24_000,
                programmeId: programme.id,
              },
              {
                description: 'Registration',
                feeType: 'REGISTRATION',
                quantity: 1,
                unitAmount: 1_500,
                lineTotal: 1_500,
              },
            ],
          },
        },
        select: { id: true },
      });

      // The first two learners have paid in full; the third has paid part and
      // has a proof of payment waiting in the review queue.
      if (index < 2) {
        const payment = await prisma.payment.create({
          data: {
            institutionId: institution.id,
            studentId: learner.id,
            invoiceId: invoice.id,
            amount: total,
            method: 'EFT',
            reference: learner.studentNumber,
            paidOn: new Date('2026-02-10'),
            status: 'CLEARED',
          },
          select: { id: true },
        });

        await prisma.receipt.create({
          data: {
            institutionId: institution.id,
            paymentId: payment.id,
            number: `REC-2026-${String(index + 1).padStart(6, '0')}`,
            issuedOn: new Date('2026-02-10'),
          },
        });

        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { balance: 0, status: 'PAID' },
        });
      } else if (index === 2) {
        const payment = await prisma.payment.create({
          data: {
            institutionId: institution.id,
            studentId: learner.id,
            invoiceId: invoice.id,
            amount: 10_000,
            method: 'EFT',
            reference: learner.studentNumber,
            paidOn: new Date('2026-02-12'),
            status: 'CLEARED',
          },
          select: { id: true },
        });

        await prisma.receipt.create({
          data: {
            institutionId: institution.id,
            paymentId: payment.id,
            number: `REC-2026-${String(index + 1).padStart(6, '0')}`,
            issuedOn: new Date('2026-02-12'),
          },
        });

        await prisma.invoice.update({
          where: { id: invoice.id },
          data: { balance: total - 10_000, status: 'PARTIALLY_PAID' },
        });
      }
    }

    // Two documents waiting in the queue, one of them a deliberate duplicate so
    // the detection has something to find.
    const waiting = await prisma.studentProfile.findMany({
      where: { institutionId: institution.id },
      orderBy: { studentNumber: 'asc' },
      skip: 3,
      take: 2,
      select: { id: true, studentNumber: true, userId: true },
    });

    for (const [index, learner] of waiting.entries()) {
      const file = await prisma.fileObject.create({
        data: {
          institutionId: institution.id,
          storageKey: `${institution.id}/proof-of-payment/seed-${learner.studentNumber}.pdf`,
          bucket: 'local',
          originalName: `proof-${learner.studentNumber}.pdf`,
          mimeType: 'application/pdf',
          sizeBytes: BigInt(84_213),
          scanStatus: 'SKIPPED',
          uploadedById: learner.userId,
        },
        select: { id: true },
      });

      await prisma.proofOfPayment.create({
        data: {
          institutionId: institution.id,
          studentId: learner.id,
          fileId: file.id,
          declaredAmount: 25_500,
          declaredDate: new Date('2026-02-18'),
          reference: index === 1 ? 'MSRI 202600004' : `MSRI ${learner.studentNumber}`,
          status: 'PENDING',
          submittedAt: new Date('2026-02-19'),
        },
      });
    }

    console.log('Finance seeded: invoices for every learner, two paid, one part paid, two proofs waiting.');
  }

  // -------------------------------------------------- quality assurance ---
  if ((await prisma.qaDocument.count({ where: { institutionId: institution.id } })) === 0) {
    await prisma.qaDocument.createMany({
      data: [
        {
          institutionId: institution.id,
          title: 'Assessment policy 2026',
          category: 'ASSESSMENT_POLICY',
          programmeId: programme.id,
          status: 'APPROVED',
        },
        {
          institutionId: institution.id,
          title: 'Approved curriculum, Higher Certificate in Business Management',
          category: 'CURRICULUM',
          programmeId: programme.id,
          status: 'APPROVED',
        },
      ],
    });

    await prisma.programmeReview.create({
      data: {
        institutionId: institution.id,
        programmeId: programme.id,
        cycle: '2026',
        status: 'PLANNED',
        dueOn: new Date('2026-11-30'),
      },
    });
  }

  const quizAssessment = await prisma.assessment.findFirst({
    where: { institutionId: institution.id, type: 'QUIZ' },
    select: { id: true },
  });

  const qaOfficer = await prisma.user.findUnique({
    where: { email: 'quality@kopano.example.ac.za' },
    select: { id: true },
  });

  if (quizAssessment && qaOfficer &&
      (await prisma.moderationRecord.count({ where: { institutionId: institution.id } })) === 0) {
    await prisma.moderationRecord.create({
      data: {
        institutionId: institution.id,
        assessmentId: quizAssessment.id,
        type: 'PRE_ASSESSMENT',
        moderatorId: qaOfficer.id,
        outcome: 'APPROVED',
        comments: 'Questions check the stated outcomes and the marks add up to the paper total.',
        moderatedAt: new Date('2026-01-28'),
      },
    });
  }

  console.log('Seed complete.');
  console.log(`Institution : ${institution.name}`);
  console.log(`Sign in with: registrar@kopano.example.ac.za / ${PASSWORD}`);
  console.log('Admissions pipeline seeded with 5 fictional applications.');
  console.log('BUS101 seeded with two published weeks of content, a quiz and a rubric-marked assignment.');
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
