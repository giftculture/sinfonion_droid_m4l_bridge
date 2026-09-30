const test = require("node:test");
const assert = require("node:assert/strict");
const { scales } = require("../master/scales.json");
const { Decoder } = require("../master/sinf_decoder.js");
const { Voices, Slave } = require("../slave/sinf_slave.js");

const C_MAJOR = [0, 2, 4, 5, 7, 9, 11];
const recorder = () => { const sent = []; return { sent, send: (b) => sent.push(b) }; };
const ON = (n, v = 100) => [0x90, n, v];
const OFF = (n) => [0x80, n, 0];

// ---- voice manager cases from the spec's Slave device build notes ----

test("note-on 61 mapped to 60, then note-off 61 -> note-off 60, never 61", () => {
  const r = recorder(); const v = new Voices(r.send);
  v.noteOn(0, 61, 100, C_MAJOR, "nearest");
  v.noteOff(0, 61);
  assert.deepEqual(r.sent, [ON(60), OFF(60)]);
});

test("60 and 61 both -> 60: output stays until the second note-off", () => {
  const r = recorder(); const v = new Voices(r.send);
  v.noteOn(0, 60, 100, C_MAJOR, "nearest");
  v.noteOn(0, 61, 100, C_MAJOR, "nearest");
  v.noteOff(0, 60);
  assert.deepEqual(r.sent, [ON(60)]);
  v.noteOff(0, 61);
  assert.deepEqual(r.sent, [ON(60), OFF(60)]);
});

test("harmonic change while 60 is held, policy hold -> nothing sent", () => {
  const r = recorder(); const v = new Voices(r.send);
  v.noteOn(0, 60, 100, C_MAJOR, "up");
  v.harmonyChanged([2, 6, 9], "up");
  assert.deepEqual(r.sent, [ON(60)]);
  v.noteOff(0, 60);
  assert.deepEqual(r.sent, [ON(60), OFF(60)]);
});

test("same, policy retrigger -> note-off 60, note-on at the new pitch, map updated", () => {
  const r = recorder(); const v = new Voices(r.send); v.policy = "retrigger";
  v.noteOn(0, 60, 100, C_MAJOR, "up");
  v.harmonyChanged([2, 6, 9], "up");
  assert.deepEqual(r.sent, [ON(60), OFF(60), ON(62)]);
  v.noteOff(0, 60);
  assert.deepEqual(r.sent.at(-1), OFF(62));
});

test("retrigger leaves notes that are still allowed alone", () => {
  const r = recorder(); const v = new Voices(r.send); v.policy = "retrigger";
  v.noteOn(0, 62, 100, C_MAJOR, "up");
  v.harmonyChanged([2, 6, 9], "up");
  assert.deepEqual(r.sent, [ON(62)]);
});

test("panic -> note-off for every mapped output, map cleared", () => {
  const r = recorder(); const v = new Voices(r.send);
  v.noteOn(0, 60, 100, C_MAJOR, "up");
  v.noteOn(1, 64, 100, C_MAJOR, "up");
  v.panic();
  assert.deepEqual(r.sent.slice(2).sort(), [OFF(60), [0x81, 64, 0]].sort());
  r.sent.length = 0;
  v.noteOff(0, 60);                       // stray off after panic passes straight through
  assert.deepEqual(r.sent, [OFF(60)]);
});

// ---- whole slave: bytes in, bytes out, fed by a real master broadcast ----

function masterState(root, scale) {
  const dec = new Decoder(scales);
  for (const [cc, v] of [[19, 1], [20, root], [21, scale], [22, 64], [23, 64], [24, 64], [25, 127]]) dec.cc(1, cc, v);
  dec.derive();
  return JSON.parse(dec.json());
}

test("default buttons ROOT 3RD 5TH 7TH quantize to the chord of the broadcast state", () => {
  const r = recorder(); const s = new Slave(r.send);
  s.setState(masterState(2, 6));                  // D Dorian -> D F A C
  assert.deepEqual(s.allowed, [0, 2, 5, 9]);
  for (const b of [0x90, 64, 90, 0x80, 64, 0]) s.byte(b);   // E4 up -> F4
  assert.deepEqual(r.sent, [[0x90, 65, 90], [0x80, 65, 0]]);
});

test("note-on with velocity 0 counts as note-off; running status works", () => {
  const r = recorder(); const s = new Slave(r.send);
  s.setState(masterState(2, 6));
  for (const b of [0x90, 64, 90, 64, 0]) s.byte(b);
  assert.deepEqual(r.sent, [[0x90, 65, 90], [0x80, 65, 0]]);
});

test("before any state arrives notes pass through unchanged", () => {
  const r = recorder(); const s = new Slave(r.send);
  for (const b of [0x90, 61, 100, 0x80, 61, 0]) s.byte(b);
  assert.deepEqual(r.sent, [ON(61), OFF(61)]);
  assert.match(s.statusText(), /waiting/);
});

test("CCs, pitch bend, program change and clock pass through", () => {
  const r = recorder(); const s = new Slave(r.send);
  s.setState(masterState(2, 6));
  for (const b of [0xB0, 1, 64, 0xE0, 0, 64, 0xC0, 5, 0xF8]) s.byte(b);
  assert.deepEqual(r.sent, [[0xB0, 1, 64], [0xE0, 0, 64], [0xC0, 5], [0xF8]]);
});

test("changing buttons changes the allowed set; all off = seven scale notes", () => {
  const s = new Slave(() => {});
  s.setState(masterState(2, 6));
  for (let k = 0; k < 12; k++) s.setButton(k, false);
  assert.deepEqual(s.allowed, [0, 2, 4, 5, 7, 9, 11]);
});

test("an instance the master has not published passes notes through", () => {
  const r = recorder(); const s = new Slave(r.send);
  s.setState(masterState(2, 6));
  s.setInstance(2);
  assert.deepEqual(s.allowed, []);
  assert.match(s.statusText(), /instance 2 not published/);
});

test("status line", () => {
  const s = new Slave(() => {});
  s.setState(masterState(2, 6));
  assert.equal(s.statusText(), "inst 1 | D | D Dorian | allowed C D F A | up, hold");
});
