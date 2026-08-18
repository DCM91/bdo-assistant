import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dedupeChunksByCanonical } from '../src/query';
import type { ScoredChunk } from '../src/types';

function mk(
  id: string,
  url: string,
  canonical: string,
  score: number,
): ScoredChunk {
  return {
    id,
    url,
    canonical_url: canonical,
    title: '',
    text: '',
    scraped_at: '2024-01-01T00:00:00Z',
    indexed_at: '2024-01-01T00:00:00Z',
    source: 'garmoth',
    score,
    pos: 0,
  };
}

test('dedupeChunksByCanonical elimina duplicados por canonical_url', () => {
  const a = mk('1', 'https://garmoth.com/x', 'https://garmoth.com/x', 0.9);
  const b = mk('2', 'https://garmoth.com/x#section', 'https://garmoth.com/x', 0.7);
  const c = mk('3', 'https://garmoth.com/y', 'https://garmoth.com/y', 0.5);

  const out = dedupeChunksByCanonical([a, b, c]);
  // Se queda con el de mayor score (a) por canonical "x", y con c por "y".
  assert.equal(out.length, 2);
  assert.equal(out[0].id, '1');
  assert.equal(out[1].id, '3');
});

test('dedupeChunksByCanonical preserva el orden original', () => {
  const a = mk('1', 'https://garmoth.com/y', 'https://garmoth.com/y', 0.5);
  const b = mk('2', 'https://garmoth.com/x', 'https://garmoth.com/x', 0.9);
  const c = mk('3', 'https://garmoth.com/x#a', 'https://garmoth.com/x', 0.7);

  const out = dedupeChunksByCanonical([a, b, c]);
  assert.equal(out.length, 2);
  // El orden refleja el input: a aparece antes que b.
  // c se descarta porque b tiene mayor score y comparte canonical_url.
  assert.equal(out[0].id, '1');
  assert.equal(out[1].id, '2');
});

test('dedupeChunksByCanonical devuelve el chunk de mayor score por URL', () => {
  const low = mk('L', 'https://garmoth.com/x?utm=1', 'https://garmoth.com/x', 0.3);
  const high = mk('H', 'https://garmoth.com/x', 'https://garmoth.com/x', 0.8);
  const out = dedupeChunksByCanonical([low, high]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, 'H');
});

test('dedupeChunksByCanonical con lista vacía devuelve lista vacía', () => {
  assert.deepEqual(dedupeChunksByCanonical([]), []);
});

test('dedupeChunksByCanonical no agrupa por URL literal sino por canonical_url', () => {
  // Dos URLs con distinto trailing slash deberían tener canonical_url igual
  // (canónico sin trailing slash) y por tanto colisionar en dedupe.
  const a = mk('1', 'https://garmoth.com/x', 'https://garmoth.com/x', 0.5);
  const b = mk('2', 'https://garmoth.com/x/', 'https://garmoth.com/x', 0.4);
  const out = dedupeChunksByCanonical([a, b]);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, '1');
});
