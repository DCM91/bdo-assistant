import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseScores } from '../src/ollama';

test('parseScores extrae array válido del JSON', () => {
  const scores = parseScores('Pensando... {"scores": [3, 7, 10]} ...fin', 3);
  assert.deepEqual(scores, [3, 7, 10]);
});

test('parseScores acepta JSON en bloque markdown', () => {
  const scores = parseScores('```json\n{"scores":[1,2,3]}\n```', 3);
  assert.deepEqual(scores, [1, 2, 3]);
});

test('parseScores devuelve null si la longitud no coincide', () => {
  assert.equal(parseScores('{"scores":[1,2]}', 3), null);
});

test('parseScores devuelve null si no hay objeto JSON', () => {
  assert.equal(parseScores('No hay JSON aquí', 3), null);
  assert.equal(parseScores('{"foo":1}', 3), null);
});

test('parseScores clampa valores fuera de rango a [0,10]', () => {
  const scores = parseScores('{"scores":[-5, 15, 7]}', 3);
  assert.deepEqual(scores, [0, 10, 7]);
});

test('parseScores convierte strings numéricos', () => {
  const scores = parseScores('{"scores":["3","7","10"]}', 3);
  assert.deepEqual(scores, [3, 7, 10]);
});

test('parseScores convierte entradas inválidas a 0', () => {
  const scores = parseScores('{"scores":["foo", null, 5]}', 3);
  assert.deepEqual(scores, [0, 0, 5]);
});

test('parseScores ignora JSON corrupto y devuelve null', () => {
  assert.equal(parseScores('{scores: [1,2,3}', 3), null);
});

test('parseScores maneja scores anidados (toma el primer bloque scores)', () => {
  // Coincide con el primer bloque que contenga "scores"
  const scores = parseScores('{"scores": [8]} y {"scores":[1]} extra', 1);
  assert.deepEqual(scores, [8]);
});

test('parseScores rechaza objecto sin campo scores', () => {
  assert.equal(parseScores('{"foo":[1,2,3]}', 3), null);
});

test('parseScores soporta line breaks dentro del JSON', () => {
  const scores = parseScores('{\n  "scores": [\n    4,\n    5,\n    6\n  ]\n}', 3);
  assert.deepEqual(scores, [4, 5, 6]);
});
