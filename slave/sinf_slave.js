// Sinfonion bridge slave quantizer (spec Contract 3). One per track, before the instrument.
// Runs in Max's js object (ES5) and under Node for tests. Keep this file ASCII-only.
//
// In Max: [midiin] -> inlet 0; [receive sinf.state], [receive sinf.panic] and UI messages -> inlet 1.
//         outlet 0 -> [midiout], outlet 1 -> [send sinf.hello], outlet 2 -> status message box.

// ---- quantize core: pure, no state -------------------------------------------
// note 0-127; allowedSet pitch classes 0-11; direction "up" (default), "down", "nearest" (ties down).
// Returns the input unchanged if allowedSet is empty.
function quantize(note, allowedSet, direction) {
    if (!allowedSet || allowedSet.length === 0) return note;
    var allowed = [];
    for (var i = 0; i < 12; i++) allowed[i] = false;
    for (var j = 0; j < allowedSet.length; j++) allowed[((allowedSet[j] % 12) + 12) % 12] = true;

    var up = null, down = null, n;
    for (n = note; n <= 127; n++) if (allowed[n % 12]) { up = n; break; }
    for (n = note; n >= 0; n--) if (allowed[n % 12]) { down = n; break; }

    var dir = direction || "up";
    if (dir === "up") return up !== null ? up : down;
    if (dir === "down") return down !== null ? down : up;
    if (up === null) return down;
    if (down === null) return up;
    return (up - note) < (note - down) ? up : down;
}

// ---- select stage --------------------------------------------------------------
// slots: 12 absolute pitch classes, order I..VII, fill1..fill5
// buttons: 12 booleans in slot order (ROOT, 9TH, 3RD, 11TH, 5TH, 13TH, 7TH, FILL1..FILL5)
// All buttons off = the seven scale notes (DROID minifonion rule).
function allowedSet(slots, buttons) {
    var any = false, k;
    for (k = 0; k < 12; k++) if (buttons[k]) { any = true; break; }
    var seen = [], out = [];
    for (k = 0; k < 12; k++) {
        var on = any ? buttons[k] : k < 7;
        if (on && !seen[slots[k]]) { seen[slots[k]] = true; out.push(slots[k]); }
    }
    return out.sort(function (a, b) { return a - b; });
}

// ---- transform stage: transpose after the core, as the Sinfonion's TRANS does -----
// Results outside 0-127 fold back by octaves so the pitch class survives.
function transposeNote(note, semitones) {
    var out = note + (semitones || 0);
    while (out > 127) out -= 12;
    while (out < 0) out += 12;
    return out;
}

// ---- voice manager: the only stateful stage ------------------------------------
// send(bytes) is called with [status, data1, data2] for every outgoing note event.
function Voices(send) {
    this.send = send;
    this.map = {};     // (channel << 7 | inputNote) -> {ch, out, vel}
    this.count = {};   // (channel << 7 | outputNote) -> number of inputs holding it
    this.policy = "hold";
}

Voices.prototype.noteOn = function (ch, note, vel, allowed, direction, transpose) {
    var key = (ch << 7) | note;
    if (this.map[key]) this.noteOff(ch, note);            // same input again without a note-off
    var out = transposeNote(quantize(note, allowed, direction), transpose);
    this.map[key] = { ch: ch, out: out, vel: vel };
    this._hold(ch, out, vel);
};

Voices.prototype.noteOff = function (ch, note, vel) {
    var key = (ch << 7) | note, m = this.map[key];
    if (!m) { this.send([0x80 | ch, note, vel || 0]); return; }   // started before the device loaded
    delete this.map[key];
    this._release(ch, m.out);
};

// Harmony or transpose changed: hold keeps sounding pitches; retrigger moves notes whose target changed.
Voices.prototype.harmonyChanged = function (allowed, direction, transpose) {
    if (this.policy !== "retrigger") return;
    for (var key in this.map) {
        var m = this.map[key], note = key & 0x7F;
        var out = transposeNote(quantize(note, allowed, direction), transpose);
        if (out === m.out) continue;
        this._release(m.ch, m.out);
        m.out = out;
        this._hold(m.ch, out, m.vel);
    }
};

Voices.prototype.panic = function () {
    for (var key in this.count) {
        var ch = key >> 7, out = key & 0x7F;
        this.send([0x80 | ch, out, 0]);
    }
    this.map = {};
    this.count = {};
};

Voices.prototype._hold = function (ch, out, vel) {
    var key = (ch << 7) | out;
    this.count[key] = (this.count[key] || 0) + 1;
    if (this.count[key] === 1) this.send([0x90 | ch, out, vel]);
};

Voices.prototype._release = function (ch, out) {
    var key = (ch << 7) | out;
    if (--this.count[key] > 0) return;
    delete this.count[key];
    this.send([0x80 | ch, out, 0]);
};

// ---- the slave: MIDI parsing + harmony state --------------------------------------
var SLOT_NAMES = ["ROOT", "9TH", "3RD", "11TH", "5TH", "13TH", "7TH", "F1", "F2", "F3", "F4", "F5"];
var SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
var DIRECTIONS = ["nearest", "up", "down"];
var POLICIES = ["hold", "retrigger"];

function Slave(send) {
    this.send = send;
    this.voices = new Voices(send);
    this.instance = 1;
    this.buttons = [true, false, true, false, true, false, true, false, false, false, false, false];
    this.direction = "up";
    this.state = null;      // parsed sinf.state
    this.allowed = [];      // empty = pass through until the master has published
    this.followTranspose = true;
    this.transpose = 0;     // semitones applied after quantizing
    this.status = null;
    this.data = [];
    this.sysex = false;
}

Slave.prototype.setState = function (state) { this.state = state; this._recompute(); };
Slave.prototype.setInstance = function (n) { this.instance = n; this._recompute(); };
Slave.prototype.setButton = function (slot, on) { this.buttons[slot] = !!on; this._recompute(); };
Slave.prototype.setDirection = function (i) { this.direction = DIRECTIONS[i] || "up"; };
Slave.prototype.setPolicy = function (i) { this.voices.policy = POLICIES[i] || "hold"; };
Slave.prototype.setFollowTranspose = function (on) { this.followTranspose = !!on; this._recompute(); };

Slave.prototype.inst = function () {
    return this.state && this.state.instances ? this.state.instances[String(this.instance)] : null;
};

Slave.prototype._recompute = function () {
    var inst = this.inst();
    var next = inst ? allowedSet(inst.slots, this.buttons) : [];
    var nextT = inst && this.followTranspose ? (inst.transpose || 0) : 0;
    if (next.join() === this.allowed.join() && nextT === this.transpose) return;
    this.allowed = next;
    this.transpose = nextT;
    this.voices.harmonyChanged(this.allowed, this.direction, this.transpose);
};

// Feed one byte from [midiin]. Notes are quantized; everything else passes through unchanged.
Slave.prototype.byte = function (b) {
    if (b >= 0xF8) { this.send([b]); return; }                      // realtime
    if (b === 0xF0) { this.sysex = true; this.send([b]); return; }
    if (this.sysex) { this.send([b]); if (b === 0xF7) this.sysex = false; return; }
    if (b >= 0x80) { this.status = b >= 0xF0 ? null : b; this.data = []; if (b >= 0xF0) this.send([b]); return; }
    if (this.status === null) { this.send([b]); return; }
    this.data.push(b);
    var type = this.status & 0xF0;
    if (this.data.length < ((type === 0xC0 || type === 0xD0) ? 1 : 2)) return;
    var d = this.data; this.data = [];
    var ch = this.status & 0x0F;
    if (type === 0x90 && d[1] > 0) this.voices.noteOn(ch, d[0], d[1], this.allowed, this.direction, this.transpose);
    else if (type === 0x80 || type === 0x90) this.voices.noteOff(ch, d[0], d[1]);
    else this.send([this.status].concat(d));
};

Slave.prototype.statusText = function () {
    var inst = this.inst();
    if (!this.state) return "waiting for the master (sinf.state)";
    if (!inst) return "instance " + this.instance + " not published by the master";
    var names = [];
    for (var i = 0; i < this.allowed.length; i++) names.push(SHARP_NAMES[this.allowed[i]]);
    return "inst " + this.instance + (inst.link ? "" : " (LINK DOWN)") + " | " + SHARP_NAMES[inst.root] + " | " +
           inst.scaleName + " | allowed " + names.join(" ") + " | " + this.direction + ", " + this.voices.policy +
           " | tr " + (this.followTranspose ? (this.transpose > 0 ? "+" : "") + this.transpose : "off");
};

// ---- Max glue ------------------------------------------------------------------
var IN_MAX = typeof outlet === "function" && typeof Dict === "function";
if (IN_MAX) { inlets = 2; outlets = 3; autowatch = 1; }

var slave = null;

function ensureSlave() {
    if (!slave) slave = new Slave(function (bytes) { outlet(0, bytes); });
    return slave;
}

function showStatus() { outlet(2, ["set"].concat(ensureSlave().statusText().split(" "))); }

function loadbang() { ensureSlave(); showStatus(); outlet(1, "bang"); }

function msg_int(v) {
    if (inlet === 0) ensureSlave().byte(v);
}

function dictionary(name) {
    var d = new Dict(name);
    ensureSlave().setState(JSON.parse(d.stringify() || "{}"));
    showStatus();
}

function button(slot, on) { ensureSlave().setButton(slot, on); showStatus(); }
function instance(n) { ensureSlave().setInstance(n); showStatus(); }
function direction(i) { ensureSlave().setDirection(i); showStatus(); }
function policy(i) { ensureSlave().setPolicy(i); showStatus(); }
function followtranspose(v) { ensureSlave().setFollowTranspose(v); showStatus(); }
function panic(v) { if (v === undefined || v) ensureSlave().voices.panic(); }
function bang() { if (inlet === 1) panic(); }
function hello() { outlet(1, "bang"); }

if (typeof module !== "undefined") {
    module.exports = { quantize: quantize, allowedSet: allowedSet, transposeNote: transposeNote, Voices: Voices, Slave: Slave, SLOT_NAMES: SLOT_NAMES };
}
