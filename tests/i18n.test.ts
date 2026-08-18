import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  TRANSLATIONS,
} from '../src/i18n/locales';

test('SUPPORTED_LOCALES contiene es, en, pt', () => {
  assert.deepEqual([...SUPPORTED_LOCALES].sort(), ['en', 'es', 'pt']);
});

test('DEFAULT_LOCALE es español', () => {
  assert.equal(DEFAULT_LOCALE, 'es');
});

test('Todos los locales tienen los mismos pares clave/valor', () => {
  const refKeys = Object.keys(TRANSLATIONS[DEFAULT_LOCALE]).sort();
  for (const locale of SUPPORTED_LOCALES) {
    const keys = Object.keys(TRANSLATIONS[locale]).sort();
    assert.deepEqual(
      keys,
      refKeys,
      `locale "${locale}" tiene claves distintas a ${DEFAULT_LOCALE}`,
    );
  }
});

test('Ningún valor está vacío en ningún locale', () => {
  for (const locale of SUPPORTED_LOCALES) {
    for (const [key, value] of Object.entries(TRANSLATIONS[locale])) {
      assert.ok(value.length > 0, `${locale}.${key} está vacío`);
    }
  }
});

test('Las cadenas de prompt del LLM no están vacías en ningún idioma', () => {
  const requiredKeys = [
    'query.systemPrompt',
    'query.userPromptBefore',
    'query.userPromptQuestion',
    'query.userPromptAfter',
    'query.emptyResult',
    'query.fallbackAnswer',
  ];
  for (const locale of SUPPORTED_LOCALES) {
    for (const key of requiredKeys) {
      assert.ok(typeof TRANSLATIONS[locale][key] === 'string', `${locale}.${key} falta`);
      assert.ok(TRANSLATIONS[locale][key].length > 0, `${locale}.${key} está vacío`);
    }
  }
});

test('El systemPrompt menciona el formato de citas [ref:N] en los 3 idiomas', () => {
  for (const locale of SUPPORTED_LOCALES) {
    const sp = TRANSLATIONS[locale]['query.systemPrompt'];
    assert.ok(sp.includes('[ref:N]'), `${locale}.query.systemPrompt no menciona [ref:N]`);
  }
});
