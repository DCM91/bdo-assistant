import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkBySentences, splitSentences, slugify } from '../src/chunker';

test('splitSentences divide por puntuación', () => {
  const s = splitSentences('Hola mundo. ¿Cómo estás? ¡Bien! Sin punto final');
  assert.deepEqual(s, ['Hola mundo.', '¿Cómo estás?', '¡Bien!', 'Sin punto final']);
});

test('splitSentences con texto vacío', () => {
  assert.deepEqual(splitSentences(''), []);
  assert.deepEqual(splitSentences('   '), []);
});

test('splitSentences normaliza espacios', () => {
  const s = splitSentences('Hola   mundo.\n\nOtra  frase.');
  assert.deepEqual(s, ['Hola mundo.', 'Otra frase.']);
});

test('chunkBySentences agrupa hasta el objetivo de palabras', () => {
  const frases = Array.from({ length: 20 }, (_, i) => `Frase número ${i} con diez palabras en total para probar.`);
  const chunks = chunkBySentences(frases.join(' '), { targetWords: 30, overlapSentences: 0 });
  // 20 frases × 10 palabras = 200 palabras → ~7 chunks de 30 palabras
  assert.ok(chunks.length >= 6 && chunks.length <= 8, `chunks=${chunks.length}`);
  for (const c of chunks) {
    assert.ok(c.split(/\s+/).length <= 40, `chunk demasiado largo: ${c.split(/\s+/).length}`);
  }
});

test('chunkBySentences respeta el solape de frases', () => {
  const frases = Array.from({ length: 10 }, (_, i) => `Frase ${i} de cinco palabras exactas.`);
  const chunks = chunkBySentences(frases.join(' '), { targetWords: 15, overlapSentences: 1 });
  assert.ok(chunks.length >= 2);
  // La última frase de un chunk debe aparecer al principio del siguiente
  for (let i = 1; i < chunks.length; i++) {
    const prevLast = chunks[i - 1].match(/Frase \d+/g)!.pop()!;
    assert.ok(chunks[i].startsWith(prevLast) || chunks[i].includes(prevLast),
      `chunk ${i} no comparte frase con el anterior`);
  }
});

test('chunkBySentences descarta chunks muy cortos', () => {
  const chunks = chunkBySentences('Corto. Otra frase mucho más larga que sí supera el mínimo de caracteres necesarios.', {
    minChunkChars: 50,
    targetWords: 4,
    overlapSentences: 0,
  });
  for (const c of chunks) {
    assert.ok(c.length >= 50);
  }
});

test('chunkBySentences con texto corto devuelve un único chunk', () => {
  const chunks = chunkBySentences('Este es un texto breve con una sola frase.');
  assert.equal(chunks.length, 1);
});

test('slugify genera nombres de archivo seguros', () => {
  assert.equal(slugify('https://garmoth.com/guides/musa-succession'), 'garmoth_com_guides_musa-succession');
  assert.equal(slugify('https://garmoth.com/news?id=123&lang=es'), 'garmoth_com_news_id_123_lang_es');
  assert.ok(slugify('https://garmoth.com/' + 'a'.repeat(200)).length <= 80);
});
