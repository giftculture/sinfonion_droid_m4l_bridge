const test = require("node:test");
const assert = require("node:assert/strict");
const { scales } = require("../master/scales.json");
const { slotsFor } = require("../master/sinf_decoder.js");

test("108 rows, numbered 0-107, each 12 distinct pitch classes", () => {
  assert.equal(scales.length, 108);
  scales.forEach((row, i) => {
    assert.equal(row.nr, i);
    assert.equal(row.slots.length, 12, `row ${i}`);
    assert.equal(new Set(row.slots).size, 12, `row ${i} has duplicates`);
    row.slots.forEach((pc) => assert.ok(pc >= 0 && pc <= 11, `row ${i}`));
  });
});

// Independent check: scale notes I..VII typed by hand in ~/PycharmProjects/sinfonion_scale_converter/main.py
const C = { C: 0, "C#": 1, D: 2, "D#": 3, E: 4, F: 5, "F#": 6, G: 7, "G#": 8, A: 9, "A#": 10, B: 11 };
const handTyped = {
  0: "C D E F# G A B", 1: "C D E F G A B", 2: "C D E F G A A#", 3: "C D F E G A A#",
  4: "C C# E D# G# F# A#", 5: "C C# E F G G# A#", 6: "C D D# F G A A#", 7: "C D D# F G G# A#",
  8: "C D D# F G G# B", 9: "C C# D# F G G# A#", 10: "C D D# F F# G# A", 11: "C D E F# G# C# A#",
  12: "C D E F# G A A#", 14: "C D E F G G# A#",
};

test("scale notes I-VII match the hand-typed table for mode 1", () => {
  for (const [nr, notes] of Object.entries(handTyped)) {
    assert.deepEqual(scales[nr].slots.slice(0, 7), notes.split(" ").map((n) => C[n]), `row ${nr}`);
  }
});

test("rows the manual repeats under one name have identical slots", () => {
  const byName = {};
  for (const row of scales) (byName[row.name] ??= []).push(row);
  const repeated = Object.values(byName).filter((rows) => rows.length > 1);
  assert.ok(repeated.length >= 10, `only ${repeated.length} repeated names`);
  for (const rows of repeated) {
    for (const row of rows) assert.deepEqual(row.slots, rows[0].slots, `${row.name}: rows ${rows.map((r) => r.nr)}`);
  }
});

test("slotsFor: D Dorian example from the spec", () => {
  assert.deepEqual(slotsFor(scales, 6, 2).slots, [2, 4, 5, 7, 9, 11, 0, 3, 6, 8, 10, 1]);
});

test("slotsFor: out-of-range junk from a reconnecting link is rejected", () => {
  assert.equal(slotsFor(scales, 76 + 40, 2), null);
  assert.equal(slotsFor(scales, 6, 15), null);
});
