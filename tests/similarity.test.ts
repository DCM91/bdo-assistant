import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cosineSimilarity, cosineSimilarityRow, l2Norm } from '../src/similarity';

test('coseno de vectores idénticos es 1', () => {
  const a = [1, 2, 3];
  assert.ok(Math.abs(cosineSimilarity(a, a) - 1) < 1e-9);
});

test('coseno de vectores ortogonales es 0', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
});

test('coseno de vectores opuestos es -1', () => {
  assert.ok(Math.abs(cosineSimilarity([1, 2], [-1, -2]) + 1) < 1e-9);
});

test('coseno con vector cero devuelve 0', () => {
  assert.equal(cosineSimilarity([0, 0], [1, 2]), 0);
  assert.equal(cosineSimilarity([1, 2], [0, 0]), 0);
});

test('coseno con dimensiones distintas devuelve 0', () => {
  assert.equal(cosineSimilarity([1, 2], [1, 2, 3]), 0);
});

test('cosineSimilarityRow equivale a cosineSimilarity sobre la fila', () => {
  const dims = 3;
  const matrix = new Float32Array([1, 0, 0, 0, 1, 0, 1, 1, 0]);
  const query = [1, 1, 0];
  assert.ok(Math.abs(cosineSimilarityRow(query, matrix, 2, dims) - cosineSimilarity(query, [1, 1, 0])) < 1e-6);
  assert.ok(Math.abs(cosineSimilarityRow(query, matrix, 0, dims) - cosineSimilarity(query, [1, 0, 0])) < 1e-6);
});

test('cosineSimilarityRow fuera de rango devuelve 0', () => {
  const matrix = new Float32Array([1, 2, 3]);
  assert.equal(cosineSimilarityRow([1, 2, 3], matrix, 5, 3), 0);
});

test('l2Norm', () => {
  assert.ok(Math.abs(l2Norm([3, 4]) - 5) < 1e-9);
  assert.equal(l2Norm([0, 0]), 0);
});
