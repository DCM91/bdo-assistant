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

test('splitSentences parte por saltos de línea / párrafos', () => {
  const s = splitSentences('Párrafo uno. Párrafo uno sigue.\n\nPárrafo dos.\nTercera línea del dos.');
  assert.ok(s.includes('Párrafo uno.'), `faltó primera: ${JSON.stringify(s)}`);
  assert.ok(s.includes('Párrafo uno sigue.'));
  assert.ok(s.includes('Párrafo dos.'));
  assert.ok(s.includes('Tercera línea del dos.'));
  assert.equal(s.length, 4);
});

test('splitSentences acepta CRLF', () => {
  const s = splitSentences('Línea uno.\r\n\r\nLínea dos.\r\n');
  assert.ok(s.includes('Línea uno.'));
  assert.ok(s.includes('Línea dos.'));
});

test('splitSentences no produce un único "sentence" gigante sin puntuación', () => {
  // Sin ningún ". ! ?" la nueva implementación parte por newlines y devuelve
  // cada párrafo como una frase independiente (en lugar del bug anterior
  // donde `\s+` colapsaba todo en una sola frase de N caracteres).
  const paragraphs = [
    'List item alpha con varias palabras',
    'List item beta con más texto',
    'List item gamma con aún más',
  ].join('\n');
  const s = splitSentences(paragraphs);
  assert.equal(s.length, 3);
});

test('chunkBySentences hard-split cuando una sola frase excede maxChunkChars', () => {
  const long = 'palabra '.repeat(800).trim(); // ~6400 chars, sin puntuación
  const chunks = chunkBySentences(long, {
    targetWords: 100_000,
    overlapSentences: 0,
    minChunkChars: 0,
    maxChunkChars: 2000,
  });
  assert.ok(chunks.length >= 3, `esperaba >=3 hard-chunks, obtuve ${chunks.length}`);
  for (const c of chunks) {
    assert.ok(c.length <= 2000, `chunk ${c.length} caracteres excede el límite`);
  }
});

test('chunkBySentences acepta CRLF en el input', () => {
  const chunks = chunkBySentences('Uno.\r\n\r\nDos.\r\nTres.', {
    targetWords: 4,
    overlapSentences: 0,
    minChunkChars: 0,
  });
  for (const c of chunks) assert.ok(c.length > 0);
});

test('chunkBySentences con texto vacío devuelve []', () => {
  assert.deepEqual(chunkBySentences('', {}), []);
  assert.deepEqual(chunkBySentences('   \n\n  ', {}), []);
});
