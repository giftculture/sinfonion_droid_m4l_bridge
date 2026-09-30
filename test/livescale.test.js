const test = require("node:test");
const assert = require("node:assert/strict");
const { scales } = require("../master/scales.json");
const live = require("../master/live_scales.json").scales;
const { slotsFor, matchLiveScale } = require("../master/sinf_decoder.js");

const match = (scale, root) => matchLiveScale(live, slotsFor(scales, scale, root).slots);

test("D Dorian (scale 6, root D) -> D Dorian, exact", () => {
  assert.deepEqual(match(6, 2), { root: 2, name: "Dorian", exact: true });
});

test("mode 4 row 38 at root C uses the Sinfonion's tonic: D Dorian, not a C scale", () => {
  assert.deepEqual(match(38, 0), { root: 2, name: "Dorian", exact: true });
});

test("Mixolydian sus4 has the Mixolydian pitch set", () => {
  assert.deepEqual(match(3, 0), { root: 0, name: "Mixolydian", exact: true });
});

test("Altered -> Super Locrian; Spanish -> Phrygian Dominant", () => {
  assert.deepEqual(match(4, 0), { root: 0, name: "Super Locrian", exact: true });
  assert.deepEqual(match(5, 0), { root: 0, name: "Phrygian Dominant", exact: true });
});

test("the captured state (root F, scale 42) -> B Super Locrian", () => {
  assert.deepEqual(match(42, 5), { root: 11, name: "Super Locrian", exact: true });
});

test("seven-note Diminished has no exact Live scale -> nearest Whole-half Dim.", () => {
  assert.deepEqual(match(10, 0), { root: 0, name: "Whole-half Dim.", exact: false });
});

test("every Sinfonion scale gets a Live scale; report how many are exact", () => {
  let exact = 0; const nearest = [];
  for (let s = 0; s < 108; s++) {
    const m = match(s, 0);
    assert.ok(m, `scale ${s} ${scales[s].name} has no match`);
    if (m.exact) exact++; else nearest.push(`${s} ${scales[s].name} -> ${m.name}`);
  }
  console.log(`exact ${exact}/108; nearest:\n  ` + nearest.join("\n  "));
  assert.ok(exact >= 90, `only ${exact} exact`);
});

test("transposing the Sinfonion root transposes the Live root", () => {
  for (let r = 0; r < 12; r++) assert.equal(match(1, r).root, r);
});
