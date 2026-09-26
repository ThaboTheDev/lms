import type { Metadata } from 'next';
import { prisma } from '@/lib/db';
import { ActionButton, ActionForm } from '@/components/ui/action-form';
import { resendStudentInvitation, saveStudentContact } from './actions';
import Link from 'next/link';
import { getStudent } from '@/server/services/students';
import { requirePrincipal } from '@/lib/auth/current-user';
import { can } from '@/lib/rbac/authorize';
import { Panel, Tag } from '@/components/ui/primitives';
import { Breadcrumbs, DescriptionList, TabLinks } from '@/components/ui/navigation';
import { maskIdentityNumber } from '@/server/services/student-view';

export const metadata: Metadata = { title: 'Student record' };

const resultTone: Record<string, 'active' | 'caution' | 'danger' | 'neutral'> = {
  PASS: 'active',
  PASS_WITH_DISTINCTION: 'active',
  COMPETENT: 'active',
  PENDING: 'neutral',
  INCOMPLETE: 'caution',
  NOT_YET_COMPETENT: 'caution',
  FAIL: 'danger',
  WITHDRAWN: 'neutral',
};

type Enrolment = {
  id: string;
  status: string;
  yearOfStudy: number;
  enrolledOn: Date;
  programme: { code: string; title: string };
  academicYear: { year: number; label: string };
  cohort: { code: string } | null;
};

type CourseEnrolment = {
  id: string;
  status: string;
  result: string;
  finalMark: unknown;
  finalGrade: string | null;
  offering: {
    sectionCode: string;
    course: { code: string; title: string; credits: number };
    academicTerm: { name: string; academicYear: { year: number } };
  };
};

export default async function StudentRecordPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const principal = await requirePrincipal();
  const { id } = await params;
  const { tab = 'overview' } = await searchParams;

  const { student, programmeEnrolments, courseEnrolments } = await getStudent(principal, id);
  const account = await prisma.studentProfile.findUnique({ where: { id }, select: { userId: true, user: { select: { status: true } } } });
  const accountStatus = account?.user.status;
  const accountUserId = account?.userId;
  const enrolments = programmeEnrolments as Enrolment[];
  const courses = courseEnrolments as CourseEnrolment[];
  const current = enrolments[0];

  const tabs = [
    { key: 'overview', label: 'Overview', href: `/students/${id}?tab=overview` },
    { key: 'enrolment', label: 'Enrolment', href: `/students/${id}?tab=enrolment` },
    { key: 'results', label: 'Courses and results', href: `/students/${id}?tab=results` },
  ];

  return (
    <div className="space-y-6">
      <Breadcrumbs
        trail={[
          // Course staff can open their own learners but not the whole register.
          can(principal, 'student.read', { institutionId: principal.institutionId ?? '' })
            ? { label: 'Students', href: '/students' }
            : { label: 'Students' },
          { label: student.studentNumber },
        ]}
      />

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-serif text-2xl font-semibold">{student.fullName}</h1>
          <p className="mt-1 text-sm text-muted">
            {student.studentNumber}
            {current ? ` · ${current.programme.code}, year ${current.yearOfStudy}` : ' · not enrolled'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Tag tone={student.admissionStatus === 'REGISTERED' ? 'active' : 'caution'}>
            {student.admissionStatus.toLowerCase().replace(/_/g, ' ')}
          </Tag>
          {can(principal, 'enrolment.manage') && (
            <Link
              href={`/students/${id}/register`}
              className="rounded border border-line px-3 py-1.5 text-sm hover:border-ink/40"
            >
              Register for courses
            </Link>
          )}
        </div>
      </div>

      <TabLinks tabs={tabs} current={tab} />

      {tab === 'overview' && (
        <div className="space-y-6">
          <Panel title="Contact">
            <DescriptionList
              items={[
                { term: 'Email address', value: student.email },
                { term: 'Phone', value: student.phone ?? 'Not supplied' },
                { term: 'Preferred name', value: student.preferredName ?? '-' },
                { term: 'Home language', value: student.homeLanguage ?? 'Not supplied' },
                { term: 'City', value: student.city ?? '-' },
                { term: 'Province', value: student.province ?? '-' },
              ]}
            />
          </Panel>

          {student.identity ? (
            <Panel
              title="Identity and next of kin"
              description="Restricted fields. Access to this panel is recorded in the audit log."
            >
              <DescriptionList
                items={[
                  { term: 'Identity number', value: maskIdentityNumber(student.identity.nationalIdRef) ?? 'Not supplied' },
                  { term: 'Passport number', value: student.identity.passportNumber ?? 'Not supplied' },
                  {
                    term: 'Date of birth',
                    value: student.identity.dateOfBirth
                      ? student.identity.dateOfBirth.toLocaleDateString('en-ZA', { dateStyle: 'long' })
                      : 'Not supplied',
                  },
                  { term: 'Nationality', value: student.identity.nationality ?? 'Not supplied' },
                  { term: 'Street address', value: student.contact?.addressLine1 ?? 'Not supplied' },
                  { term: 'Postal code', value: student.contact?.postalCode ?? '-' },
                  { term: 'Emergency contact', value: student.contact?.emergencyName ?? 'Not supplied' },
                  { term: 'Emergency phone', value: student.contact?.emergencyPhone ?? '-' },
                ]}
              />
            </Panel>
          ) : (
            <Panel title="Identity and next of kin">
              <p className="px-4 py-6 text-sm text-muted">
                These fields are restricted. Ask the registrar if you need them for your work.
              </p>
            </Panel>
          )}
        </div>
      )}

      {tab === 'enrolment' && (
        <Panel title="Programme enrolment">
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Programme enrolment history</caption>
            <thead>
              <tr className="border-b border-line text-left">
                {['Programme', 'Academic year', 'Cohort', 'Year of study', 'Status'].map((column) => (
                  <th key={column} scope="col" className="px-4 py-2.5 font-medium text-muted">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {enrolments.map((enrolment) => (
                <tr key={enrolment.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    {enrolment.programme.code}
                    <span className="block text-xs text-muted">{enrolment.programme.title}</span>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{enrolment.academicYear.year}</td>
                  <td className="px-4 py-2.5 text-muted">{enrolment.cohort?.code ?? '-'}</td>
                  <td className="px-4 py-2.5 tabular-nums">{enrolment.yearOfStudy}</td>
                  <td className="px-4 py-2.5">
                    <Tag tone={enrolment.status === 'ACTIVE' ? 'active' : 'neutral'}>
                      {enrolment.status.toLowerCase()}
                    </Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}

      {tab === 'results' && (
        <Panel
          title="Courses and results"
          description="Marks appear once the course has released its results."
        >
          <table className="w-full border-collapse text-sm">
            <caption className="sr-only">Course enrolments and results</caption>
            <thead>
              <tr className="border-b border-line text-left">
                {['Course', 'Term', 'Credits', 'Mark', 'Result'].map((column) => (
                  <th key={column} scope="col" className="px-4 py-2.5 font-medium text-muted">
                    {column}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {courses.map((enrolment) => (
                <tr key={enrolment.id} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">
                    {enrolment.offering.course.code}
                    <span className="block text-xs text-muted">{enrolment.offering.course.title}</span>
                  </td>
                  <td className="px-4 py-2.5 text-muted">
                    {enrolment.offering.academicTerm.name} {enrolment.offering.academicTerm.academicYear.year}
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{enrolment.offering.course.credits}</td>
                  <td className="px-4 py-2.5 tabular-nums">
                    {enrolment.finalMark !== null && enrolment.finalMark !== undefined
                      ? String(enrolment.finalMark)
                      : 'Not released'}
                  </td>
                  <td className="px-4 py-2.5">
                    <Tag tone={resultTone[enrolment.result] ?? 'neutral'}>
                      {enrolment.result.toLowerCase().replace(/_/g, ' ')}
                    </Tag>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
      {can(principal, 'student.manage', { institutionId: principal.institutionId ?? '' }) && (
        <div className="grid gap-6 lg:grid-cols-2">
          <ActionForm
            title="Contact details"
            action={saveStudentContact}
            submitLabel="Save contact details"
            fields={[
              { name: 'studentId', label: '', type: 'hidden', defaultValue: student.id },
              { name: 'addressLine1', label: 'Address', defaultValue: (student as { addressLine1?: string | null }).addressLine1 ?? '' },
              { name: 'addressLine2', label: 'Address line 2', defaultValue: (student as { addressLine2?: string | null }).addressLine2 ?? '' },
              { name: 'city', label: 'City or town', defaultValue: (student as { city?: string | null }).city ?? '' },
              { name: 'province', label: 'Province', defaultValue: (student as { province?: string | null }).province ?? '' },
              { name: 'postalCode', label: 'Postal code', defaultValue: (student as { postalCode?: string | null }).postalCode ?? '' },
              { name: 'homeLanguage', label: 'Home language', defaultValue: (student as { homeLanguage?: string | null }).homeLanguage ?? '' },
              { name: 'emergencyName', label: 'Emergency contact', defaultValue: (student as { emergencyName?: string | null }).emergencyName ?? '' },
              { name: 'emergencyPhone', label: 'Their phone', defaultValue: (student as { emergencyPhone?: string | null }).emergencyPhone ?? '' },
              { name: 'emergencyRelation', label: 'Relationship', defaultValue: (student as { emergencyRelation?: string | null }).emergencyRelation ?? '' },
            ]}
          />
          {accountStatus === 'INVITED' && (
            <Panel title="Account not set up yet">
              <div className="space-y-3 px-4 py-4 text-sm">
                <p className="text-muted">This learner has not chosen a password yet, so they cannot sign in. The link in the invitation lasts seven days.</p>
                <ActionButton action={resendStudentInvitation} hidden={{ userId: accountUserId ?? '' }} label="Send a new invitation" />
              </div>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
