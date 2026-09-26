import { describe, expect, it } from 'vitest';
import { af, en, LOCALES, resolveLocale, t, translator, type MessageKey } from '@/lib/i18n/messages';
import { NAVIGATION } from '@/components/shell/nav';

describe('resolveLocale', () => {
  it('prefers the person, then the institution, by language', () => {
    expect(resolveLocale('af', 'en-ZA')).toBe('af');
    expect(resolveLocale(null, 'af-ZA')).toBe('af');
    expect(resolveLocale(undefined, 'en-ZA')).toBe('en');
    expect(resolveLocale('zu', 'af_ZA')).toBe('af');
    expect(resolveLocale('xx', 'yy')).toBe('en');
  });
});

describe('t', () => {
  it('translates, fills values, and falls back to English for a missing key', () => {
    expect(t('auth.signIn', 'af')).toBe('Teken aan');
    expect(t('shell.unread', 'en', { label: 'Messages', count: 3 })).toBe('Messages, 3 unread');
    expect(t('auth.signIn', 'zu')).toBe('Sign in');
    expect(translator('af')('auth.protected', { name: 'MSRI' })).toBe('MSRI. Beskermde stelsel. Aktiwiteit word aangeteken.');
  });

  it('leaves a placeholder it was not given in place rather than printing "undefined"', () => {
    expect(t('auth.intro', 'en', {})).toContain('{name}');
  });
});

describe('dictionaries', () => {
  const navKeys = NAVIGATION.flatMap((group) => [group.labelKey, ...group.items.map((item) => item.labelKey)]);

  it('has every navigation label in English and Afrikaans', () => {
    for (const key of navKeys) {
      expect(en[key], key).toBeTruthy();
      expect(af[key], key).toBeTruthy();
    }
  });

  it('keeps the same placeholders in every translation', () => {
    const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort().join(',');
    for (const [key, value] of Object.entries(af) as [MessageKey, string][]) {
      expect(placeholders(value), key).toBe(placeholders(en[key]));
    }
  });

  it('offers only languages it has a dictionary for', () => {
    expect(Object.keys(LOCALES)).toEqual(['en', 'af']);
  });
});
