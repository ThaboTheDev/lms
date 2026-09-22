/**
 * Interface text lives here rather than inside components so that another
 * language can be added by supplying a second dictionary. South African
 * institutions commonly need isiZulu, Sesotho and Afrikaans alongside English.
 */
export const en = {
  'app.name': 'Institutional LMS',
  'auth.signIn': 'Sign in',
  'auth.email': 'Email address',
  'auth.password': 'Password',
  'auth.forgot': 'Forgot your password?',
  'auth.signOut': 'Sign out',
  'auth.invalid': 'That email address and password combination is not recognised.',
  'auth.locked': 'This account is locked. Try again later or contact your administrator.',
  'nav.dashboard': 'Dashboard',
  'nav.students': 'Students',
  'nav.programmes': 'Programmes',
  'nav.courses': 'Courses',
  'nav.assessments': 'Assessments',
  'nav.finance': 'Finance',
  'nav.certificates': 'Certificates',
  'nav.reports': 'Reports',
  'nav.quality': 'Quality assurance',
  'nav.support': 'Support',
  'nav.people': 'People and access',
  'nav.settings': 'Settings',
  'common.search': 'Search',
  'common.save': 'Save changes',
  'common.cancel': 'Cancel',
  'common.next': 'Next',
  'common.previous': 'Previous',
  'common.noResults': 'Nothing here yet',
} as const;

export type MessageKey = keyof typeof en;

const dictionaries: Record<string, Partial<Record<MessageKey, string>>> = { en };

export function t(key: MessageKey, locale = 'en'): string {
  return dictionaries[locale]?.[key] ?? en[key];
}
