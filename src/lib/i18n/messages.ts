/**
 * Interface text lives here rather than inside components so that another
 * language can be added by supplying a second dictionary. South African
 * institutions commonly need isiZulu, Sesotho and Afrikaans alongside English.
 *
 * English is complete and is the fallback for any key a dictionary leaves
 * out. Afrikaans covers the shell, navigation and sign-in. isiZulu and
 * Sesotho are listed in docs/ROADMAP.md: they need a first-language
 * translator, not a guess.
 *
 * Pure: pages, layouts and the tests all read it.
 */
export const en = {
  'app.name': 'MSRI',
  'language.name': 'English',

  'auth.portal': 'Student portal',
  'auth.signIn': 'Sign in',
  'auth.signingIn': 'Signing in',
  'auth.intro': 'Enter your credentials to access the {name} learning platform.',
  'auth.email': 'Email address',
  'auth.password': 'Password',
  'auth.forgot': 'Forgot your password?',
  'auth.signOut': 'Sign out',
  'auth.invalid': 'That email address and password combination is not recognised.',
  'auth.locked': 'This account is locked. Try again later or contact your administrator.',
  'auth.protected': '{name}. Protected system. Activity is logged.',
  'auth.point.progress': 'Track academic progress',
  'auth.point.courses': 'Courses, assessments and records',
  'auth.point.messages': 'Messages from faculty and the registry',
  'auth.passwordSet': 'Your password has been set. Sign in with it.',
  'auth.applying': 'Applying to study?',
  'auth.startApplication': 'Start an application',

  'shell.skip': 'Skip to main content',
  'shell.openNav': 'Open navigation',
  'shell.closeNav': 'Close navigation',
  'shell.searchLabel': 'Search students, courses and records',
  'shell.searchPlaceholder': 'Search students, courses, records',
  'shell.messages': 'Messages',
  'shell.notices': 'Notices',
  'shell.notifications': 'Notifications',
  'shell.unread': '{label}, {count} unread',
  'shell.security': 'Account and security',

  'nav.group.overview': 'Overview',
  'nav.group.learning': 'Learning',
  'nav.group.communication': 'Communication',
  'nav.group.academic': 'Academic administration',
  'nav.group.operations': 'Operations',
  'nav.group.administration': 'Administration',
  'nav.dashboard': 'Dashboard',
  'nav.search': 'Search',
  'nav.security': 'Account and security',
  'nav.courses': 'My courses',
  'nav.assessments': 'Assessments',
  'nav.questionBanks': 'Question banks',
  'nav.content': 'Content library',
  'nav.calendar': 'Calendar',
  'nav.discussions': 'Discussions',
  'nav.account': 'Your account',
  'nav.messages': 'Messages',
  'nav.announcements': 'Announcements',
  'nav.notifications': 'Notifications',
  'nav.students': 'Students',
  'nav.applications': 'Applications',
  'nav.programmes': 'Programmes',
  'nav.records': 'Academic records',
  'nav.certificates': 'Certificates',
  'nav.certificateTemplates': 'Certificate templates',
  'nav.finance': 'Finance',
  'nav.fees': 'Fees',
  'nav.pop': 'Proof of payment',
  'nav.quality': 'Quality assurance',
  'nav.reports': 'Reports',
  'nav.analytics': 'Analytics',
  'nav.support': 'Support',
  'nav.academicSetup': 'Academic setup',
  'nav.people': 'People and access',
  'nav.roles': 'Roles',
  'nav.audit': 'Audit log',
  'nav.privacy': 'Privacy and retention',
  'nav.settings': 'Settings',
  'nav.emailTemplates': 'Email templates',
  'nav.forums': 'Forums',

  'common.search': 'Search',
  'common.save': 'Save changes',
  'common.cancel': 'Cancel',
  'common.next': 'Next',
  'common.previous': 'Previous',
  'common.noResults': 'Nothing here yet',
  'common.language': 'Language',
  'common.institutionDefault': 'The institution’s language',
} as const;

export type MessageKey = keyof typeof en;

export const af: Partial<Record<MessageKey, string>> = {
  'language.name': 'Afrikaans',

  'auth.portal': 'Studenteportaal',
  'auth.signIn': 'Teken aan',
  'auth.signingIn': 'Besig om aan te teken',
  'auth.intro': 'Voer jou besonderhede in om toegang tot die {name}-leerplatform te kry.',
  'auth.email': 'E-posadres',
  'auth.password': 'Wagwoord',
  'auth.forgot': 'Wagwoord vergeet?',
  'auth.signOut': 'Teken uit',
  'auth.invalid': 'Daardie kombinasie van e-posadres en wagwoord word nie herken nie.',
  'auth.locked': 'Hierdie rekening is gesluit. Probeer later weer of kontak jou administrateur.',
  'auth.protected': '{name}. Beskermde stelsel. Aktiwiteit word aangeteken.',
  'auth.point.progress': 'Volg akademiese vordering',
  'auth.point.courses': 'Kursusse, assesserings en rekords',
  'auth.point.messages': 'Boodskappe van dosente en die registrateur',
  'auth.passwordSet': 'Jou wagwoord is gestel. Teken daarmee aan.',
  'auth.applying': 'Wil jy aansoek doen om te studeer?',
  'auth.startApplication': 'Begin ’n aansoek',

  'shell.skip': 'Slaan oor na die hoofinhoud',
  'shell.openNav': 'Maak die navigasie oop',
  'shell.closeNav': 'Maak die navigasie toe',
  'shell.searchLabel': 'Soek studente, kursusse en rekords',
  'shell.searchPlaceholder': 'Soek studente, kursusse, rekords',
  'shell.messages': 'Boodskappe',
  'shell.notices': 'Kennisgewings',
  'shell.notifications': 'Kennisgewings',
  'shell.unread': '{label}, {count} ongelees',
  'shell.security': 'Rekening en sekuriteit',

  'nav.group.overview': 'Oorsig',
  'nav.group.learning': 'Leer',
  'nav.group.communication': 'Kommunikasie',
  'nav.group.academic': 'Akademiese administrasie',
  'nav.group.operations': 'Bedrywighede',
  'nav.group.administration': 'Administrasie',
  'nav.dashboard': 'Paneelbord',
  'nav.search': 'Soek',
  'nav.security': 'Rekening en sekuriteit',
  'nav.courses': 'My kursusse',
  'nav.assessments': 'Assesserings',
  'nav.questionBanks': 'Vraebanke',
  'nav.content': 'Inhoudbiblioteek',
  'nav.calendar': 'Kalender',
  'nav.discussions': 'Besprekings',
  'nav.account': 'Jou rekening',
  'nav.messages': 'Boodskappe',
  'nav.announcements': 'Aankondigings',
  'nav.notifications': 'Kennisgewings',
  'nav.students': 'Studente',
  'nav.applications': 'Aansoeke',
  'nav.programmes': 'Programme',
  'nav.records': 'Akademiese rekords',
  'nav.certificates': 'Sertifikate',
  'nav.certificateTemplates': 'Sertifikaatsjablone',
  'nav.finance': 'Finansies',
  'nav.fees': 'Gelde',
  'nav.pop': 'Bewys van betaling',
  'nav.quality': 'Gehalteversekering',
  'nav.reports': 'Verslae',
  'nav.analytics': 'Analise',
  'nav.support': 'Ondersteuning',
  'nav.academicSetup': 'Akademiese opstelling',
  'nav.people': 'Mense en toegang',
  'nav.roles': 'Rolle',
  'nav.audit': 'Ouditlog',
  'nav.privacy': 'Privaatheid en bewaring',
  'nav.settings': 'Instellings',
  'nav.emailTemplates': 'E-possjablone',
  'nav.forums': 'Forums',

  'common.search': 'Soek',
  'common.save': 'Stoor veranderinge',
  'common.cancel': 'Kanselleer',
  'common.next': 'Volgende',
  'common.previous': 'Vorige',
  'common.noResults': 'Nog niks hier nie',
  'common.language': 'Taal',
  'common.institutionDefault': 'Die instelling se taal',
};

const dictionaries: Record<string, Partial<Record<MessageKey, string>>> = { en, af };

/** The languages a person can choose, by code. */
export const LOCALES = { en: 'English', af: 'Afrikaans' } as const;
export type Locale = keyof typeof LOCALES;

/**
 * The language to show: the person's own choice, then the institution's,
 * each reduced to its language (af-ZA is af), else English.
 */
export function resolveLocale(...preferences: (string | null | undefined)[]): Locale {
  for (const preference of preferences) {
    const language = preference?.toLowerCase().split(/[-_]/)[0];
    if (language && language in LOCALES) return language as Locale;
  }
  return 'en';
}

export function t(key: MessageKey, locale: string = 'en', values?: Record<string, string | number>): string {
  const template = dictionaries[locale]?.[key] ?? en[key];
  return values ? template.replace(/\{(\w+)\}/g, (match, name: string) => (name in values ? String(values[name]) : match)) : template;
}

/** t bound to one language, for a page or layout that translates many strings. */
export function translator(locale: string) {
  return (key: MessageKey, values?: Record<string, string | number>) => t(key, locale, values);
}
