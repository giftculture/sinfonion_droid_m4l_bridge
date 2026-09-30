const test = require("node:test");
const assert = require("node:assert/strict");
const { quantize } = require("../slave/sinf_slave.js");
const { allowedSet } = require("../slave/sinf_slave.js");

const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];

// Cases from the spec's Slave device build notes
test("61, C major, nearest -> 60 (tie resolves down)", () => assert.equal(quantize(61, C_MAJOR, "nearest"), 60));
test("61, C major, up -> 62", () => assert.equal(quantize(61, C_MAJOR, "up"), 62));
test("63, C triad, nearest -> 64", () => assert.equal(quantize(63, [0, 4, 7], "nearest"), 64));
test("60, empty set -> 60 (passes through)", () => assert.equal(quantize(60, [], "nearest"), 60));
test("127, {0}, up -> 120 (no overflow)", () => assert.equal(quantize(127, [0], "up"), 120));
test("0, {11}, down -> 11 (no underflow)", () => assert.equal(quantize(0, [11], "down"), 11));

test("default direction is up", () => assert.equal(quantize(61, C_MAJOR), 62));
test("allowed note is unchanged in every direction", () => {
  for (const d of ["up", "down", "nearest"]) assert.equal(quantize(64, C_MAJOR, d), 64);
});
test("every output is in range and in the set", () => {
  for (let n = 0; n <= 127; n++) {
    for (const d of ["up", "down", "nearest"]) {
      const q = quantize(n, [1, 6], d);
      assert.ok(q >= 0 && q <= 127 && [1, 6].includes(q % 12), `${n} ${d} -> ${q}`);
    }
  }
});

// Select stage cases (D Dorian slots)
const D_DORIAN = [2, 4, 5, 7, 9, 11, 0, 3, 6, 8, 10, 1];
const buttons = (...on) => Array.from({ length: 12 }, (_, k) => on.includes(k));
test("ROOT+3RD+5TH+7TH -> D minor 7", () => assert.deepEqual(allowedSet(D_DORIAN, buttons(0, 2, 4, 6)), [0, 2, 5, 9]));
test("ROOT+3RD+5TH -> D minor triad", () => assert.deepEqual(allowedSet(D_DORIAN, buttons(0, 2, 4)), [2, 5, 9]));
test("all off -> seven scale notes", () => assert.deepEqual(allowedSet(D_DORIAN, buttons()), [0, 2, 4, 5, 7, 9, 11]));
test("FILL1 only -> D#", () => assert.deepEqual(allowedSet(D_DORIAN, buttons(7)), [3]));
