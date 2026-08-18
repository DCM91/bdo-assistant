import { test } from 'node:test';
import assert from 'node:assert/strict';
import { queryEmbeddingCache } from '../src/store';

test('queryEmbeddingCache normaliza whitespace y case en la clave', () => {
  queryEmbeddingCache.set('  Hola   Mundo  ', [0.1, 0.2]);
  const v1 = queryEmbeddingCache.get('hola mundo');
  assert.deepEqual(v1, [0.1, 0.2]);
});

test('queryEmbeddingCache distingue preguntas distintas', () => {
  queryEmbeddingCache.set('cache-distinct-A', [0.1]);
  queryEmbeddingCache.set('cache-distinct-B', [0.2]);
  assert.deepEqual(queryEmbeddingCache.get('cache-distinct-A'), [0.1]);
  assert.deepEqual(queryEmbeddingCache.get('cache-distinct-B'), [0.2]);
});

test('queryEmbeddingCache.set sobrescribe entrada existente (LRU bump)', () => {
  queryEmbeddingCache.set('cache-lru-test', [0.1]);
  queryEmbeddingCache.set('cache-lru-test', [0.99]);
  assert.deepEqual(queryEmbeddingCache.get('cache-lru-test'), [0.99]);
});
