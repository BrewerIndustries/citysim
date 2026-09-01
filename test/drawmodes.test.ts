import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rectCells, lineCells, modesFor, DRAW_MODES, TOOLS } from '../src/app/tools.ts';

test('a rectangle fills its box exactly', () => {
  const cells = rectCells(4, 10, 9, 13, 64, 64);
  assert.equal(cells.length, 6 * 4);
  assert.equal(new Set(cells).size, cells.length, 'no cell should be listed twice');
  for (const i of cells) {
    const x = i % 64;
    const y = (i / 64) | 0;
    assert.ok(x >= 4 && x <= 9 && y >= 10 && y <= 13, `cell ${x},${y} is outside the box`);
  }
});

test('a rectangle is the same whichever corner you start from', () => {
  const a = rectCells(20, 30, 5, 8, 64, 64).sort((x, y) => x - y);
  const b = rectCells(5, 8, 20, 30, 64, 64).sort((x, y) => x - y);
  assert.deepEqual(a, b);
});

test('a rectangle is clipped to the map', () => {
  const cells = rectCells(-10, -10, 3, 3, 64, 64);
  for (const i of cells) {
    assert.ok(i >= 0 && i < 64 * 64);
    assert.ok(i % 64 <= 3 && (i / 64 | 0) <= 3);
  }
  assert.equal(cells.length, 16);
});

test('a line stays axis-aligned', () => {
  // Roads step as an L so a diagonal drag never leaves a staircase of stubs.
  const cells = lineCells(10, 10, 20, 16, 64);
  for (const i of cells) {
    const x = i % 64;
    const y = (i / 64) | 0;
    assert.ok(y === 10 || x === 20, `cell ${x},${y} is off both legs of the L`);
  }
  assert.ok(cells.length >= 17);
});

test('each tool offers the modes that suit it, and starts on the right one', () => {
  assert.equal(modesFor('road').preferred, 'line');
  assert.equal(modesFor('zone').preferred, 'rectangle');
  assert.equal(modesFor('bulldoze').preferred, 'rectangle');
  // Tools where a drag makes no sense offer nothing.
  assert.deepEqual(modesFor('civic').modes, []);
  assert.deepEqual(modesFor('inspect').modes, []);
});

test('every offered mode is a real one', () => {
  const known = new Set(DRAW_MODES.map((m) => m.mode));
  for (const t of TOOLS) {
    const { modes, preferred } = modesFor(t.kind);
    for (const m of modes) assert.ok(known.has(m), `${t.label} offers unknown mode "${m}"`);
    if (modes.length) assert.ok(modes.includes(preferred), `${t.label} prefers a mode it doesn't offer`);
  }
});
