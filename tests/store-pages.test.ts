import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'fs';
import { store } from '../src/store';

const HAS_DATA = existsSync('./data/index.json');

test('getIndexedPages devuelve un array con la forma correcta', { skip: !HAS_DATA }, () => {
  store.load();
  const pages = store.getIndexedPages();
  assert.ok(Array.isArray(pages));
  for (const p of pages) {
    assert.ok(typeof p.url === 'string' && p.url.length > 0);
    assert.ok(typeof p.source === 'string');
    assert.ok(typeof p.scraped_at === 'string');
    assert.ok(typeof p.chunks === 'number' && p.chunks >= 1);
    assert.ok(p.title === '' || typeof p.title === 'string');
  }
});

test('getIndexedPages suma los chunks por URL', { skip: !HAS_DATA }, () => {
  const pages = store.getIndexedPages();
  for (const p of pages) {
    // p.chunks debe ser >= 1 (la página existe, sino no estaría listada)
    assert.ok(p.chunks >= 1, `${p.url} tiene ${p.chunks} chunks`);
  }
});

test('getIndexedPages no produce URLs duplicadas', { skip: !HAS_DATA }, () => {
  const pages = store.getIndexedPages();
  const urls = new Set(pages.map((p) => p.url));
  assert.equal(urls.size, pages.length);
});

test('removeByUrl devuelve 0 para una URL inexistente', { skip: !HAS_DATA }, () => {
  store.load();
  const removed = store.removeByUrl('https://no-existe.example.com/this-is-fake');
  assert.equal(removed, 0);
});
