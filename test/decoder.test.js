const test = require("node:test");
const assert = require("node:assert/strict");
const { scales } = require("../master/scales.json");
const { Decoder, nameAtRoot } = require("../master/sinf_decoder.js");

// One refresh burst as captured from the MASTER18 on Sept 29, 2026 (CC order varies per burst).
const BURST = [[20, 5], [21, 42], [22, 64], [23, 64], [24, 64], [25, 127], [19, 1]];
const bytes = (ch, pairs) => pairs.flatMap(([cc, v], i) => (i === 0 ? [0xB0 + ch - 1, cc, v] : [cc, v])); // running status

function feed(dec, ch, pairs) {
  let any = false;
  for (const b of bytes(ch, pairs)) any = dec.byte(b) || any;
  return any;
}

test("a refresh burst publishes instance 1", () => {
  const dec = new Decoder(scales);
  assert.equal(feed(dec, 1, BURST), true);
  assert.equal(dec.derive(), true);
  const inst = JSON.parse(dec.json()).instances["1"];
  assert.deepEqual(inst, {
    source: "sinfonion", link: 1, root: 5, scale: 42, scaleName: "B Altered",
    transpose: 0, hshift: 0, detune: 0,
    slots: [11, 0, 3, 2, 7, 5, 9, 1, 4, 6, 8, 10],
  });
  assert.deepEqual(JSON.parse(dec.json()).schema, 1);
});

test("an identical burst a second later does not re-broadcast", () => {
  const dec = new Decoder(scales);
  feed(dec, 1, BURST); dec.derive();
  feed(dec, 1, [...BURST].reverse());
  assert.equal(dec.derive(), false);
});

test("a root change re-broadcasts with new slots", () => {
  const dec = new Decoder(scales);
  feed(dec, 1, BURST); dec.derive();
  feed(dec, 1, [[20, 7]]);
  assert.equal(dec.derive(), true);
  assert.equal(JSON.parse(dec.json()).instances["1"].root, 7);
});

test("nothing is published until every field has arrived", () => {
  const dec = new Decoder(scales);
  feed(dec, 1, [[20, 5], [21, 42], [25, 127]]);
  assert.equal(dec.derive(), false);
  assert.deepEqual(JSON.parse(dec.json()).instances, {});
});

test("link down keeps the last notes and reports link 0", () => {
  const dec = new Decoder(scales);
  feed(dec, 1, BURST); dec.derive();
  // Captured while the cable was pulled: harmonic shift jumps to 48 (-16), link to 0
  feed(dec, 1, [[23, 48], [25, 0]]);
  assert.equal(dec.derive(), true);
  const inst = JSON.parse(dec.json()).instances["1"];
  assert.equal(inst.link, 0);
  assert.equal(inst.hshift, 0);
  assert.equal(inst.root, 5);
});

test("reconnect junk before link returns is ignored", () => {
  const dec = new Decoder(scales);
  feed(dec, 1, BURST); dec.derive();
  feed(dec, 1, [[23, 48], [25, 0]]); dec.derive();
  // Captured on reconnect: root 15, scale 76, hshift 111 arrive before link 127
  feed(dec, 1, [[20, 15], [21, 76], [22, 3], [23, 111], [24, 41]]);
  assert.equal(dec.derive(), false);
  assert.equal(JSON.parse(dec.json()).instances["1"].root, 5);
});

test("out-of-range values with link up are rejected", () => {
  const dec = new Decoder(scales);
  feed(dec, 1, BURST); dec.derive();
  feed(dec, 1, [[20, 15]]);
  assert.equal(dec.derive(), false);
});

test("a wrong protocol version freezes the instance", () => {
  const dec = new Decoder(scales);
  feed(dec, 1, BURST); dec.derive();
  feed(dec, 1, [[19, 2], [20, 7]]);
  assert.equal(dec.derive(), false);
  assert.equal(JSON.parse(dec.json()).instances["1"].root, 5);
  assert.match(dec.statusLines()[0], /protocol version 2, frozen/);
});

test("channel 2 becomes instance 2 with source droid", () => {
  const dec = new Decoder(scales);
  feed(dec, 2, BURST); dec.derive();
  assert.equal(JSON.parse(dec.json()).instances["2"].source, "droid");
});

test("MIDI clock bytes inside a message do not break parsing", () => {
  const dec = new Decoder(scales);
  for (const b of [0xB0, 20, 0xF8, 5]) dec.byte(b);
  assert.equal(dec.raw["1"].root, 5);
});

test("notes and other CCs are ignored", () => {
  const dec = new Decoder(scales);
  assert.equal(feed(dec, 1, [[7, 100]]), false);
  for (const b of [0x90, 60, 100]) assert.equal(dec.byte(b), false);
});

test("nameAtRoot moves note names but leaves words alone", () => {
  assert.equal(nameAtRoot("C Lydian", 2), "D Lydian");
  assert.equal(nameAtRoot("F♯ Altered", 5), "B Altered");
  assert.equal(nameAtRoot("Slashchord D/C", 2), "Slashchord E/D");
  assert.equal(nameAtRoot("Slashchord B♭ aug / C", 0), "Slashchord A# aug / C");
  assert.equal(nameAtRoot("C Double harmonic major from VII", 0), "C Double harmonic major from VII");
  assert.equal(nameAtRoot("C Augmented", 1), "C# Augmented");
});

test("status line reads like the panel", () => {
  const dec = new Decoder(scales);
  assert.match(dec.statusLines()[0], /waiting/);
  feed(dec, 1, BURST); dec.derive();
  assert.equal(dec.statusLines()[0], "ch 1: link up | F | 42 B Altered | B C D# D G F A + C# E F# G# A# | tr 0 hs 0");
});
