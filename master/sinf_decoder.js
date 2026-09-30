// Sinfonion bridge master decoder (spec Contracts 1 and 2).
// Runs in Max's js object (ES5) and under Node for tests. Keep this file ASCII-only.
//
// In Max: [midiin] -> inlet 0, [receive sinf.hello] -> inlet 1,
//         outlet 0 -> [send sinf.state], outlet 1 -> status message box.

// ---- pure core ------------------------------------------------------------

var FIELDS = { 19: "version", 20: "root", 21: "scale", 22: "transpose", 23: "hshift", 24: "detune", 25: "link" };
var SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
var PC_OF = { "C": 0, "D": 2, "E": 4, "F": 5, "G": 7, "A": 9, "B": 11 };

// root + scale number -> 12 absolute slots; null for out-of-range input
function slotsFor(scales, scale, root) {
    if (scale < 0 || scale > 107 || root < 0 || root > 11) return null;
    var row = scales[scale], slots = [];
    for (var k = 0; k < 12; k++) slots.push((row.slots[k] + root) % 12);
    return { slots: slots, name: row.name };
}

// Table names are written at root C ("C Lydian", "Slashchord D/C"); move every note name by root.
// A bare note letter counts only when not followed by a lowercase letter, so "Altered" and "Dorian" stay.
function nameAtRoot(name, root) {
    return name.replace(/([A-G])(\u266F|\u266D|#|b(?![a-z]))?(?![a-z])/g, function (m, letter, acc) {
        var pc = PC_OF[letter];
        if (acc === "\u266F" || acc === "#") pc += 1;
        if (acc === "\u266D" || acc === "b") pc -= 1;
        return SHARP_NAMES[(((pc + root) % 12) + 12) % 12];
    });
}

function Decoder(scales) {
    this.scales = scales;
    this.raw = {};        // channel -> field -> last CC value
    this.dirty = {};      // channel -> true
    this.frozen = {};     // channel -> protocol version that froze it
    this.instances = {};  // channel -> published instance
    this.status = null;   // running status byte
    this.data = [];
}

// Feed one MIDI byte from [midiin]. Returns true when a CC this decoder uses was completed.
Decoder.prototype.byte = function (b) {
    if (b >= 0xF8) return false;                       // realtime (clock etc.) never breaks running status
    if (b >= 0x80) { this.status = b >= 0xF0 ? null : b; this.data = []; return false; }
    if (this.status === null) return false;
    this.data.push(b);
    if (this.data.length < ((this.status & 0xE0) === 0xC0 ? 1 : 2)) return false;
    var d = this.data; this.data = [];
    if ((this.status & 0xF0) !== 0xB0) return false;
    return this.cc((this.status & 0x0F) + 1, d[0], d[1]);
};

// One CC on a 1-indexed channel. Returns true if it is a bridge field.
Decoder.prototype.cc = function (channel, num, value) {
    var field = FIELDS[num];
    if (!field) return false;
    if (!this.raw[channel]) this.raw[channel] = {};
    this.raw[channel][field] = value;
    this.dirty[channel] = true;
    return true;
};

// Called after the debounce. Returns true if the published state changed.
Decoder.prototype.derive = function () {
    var changed = false;
    for (var ch in this.dirty) {
        var r = this.raw[ch];
        delete this.dirty[ch];
        if (r.version !== undefined && r.version !== 1) { this.frozen[ch] = r.version; continue; }
        delete this.frozen[ch];
        var prev = this.instances[ch];
        var next;
        if (r.link !== 127) {
            // Link down: DROID sends junk while it reconnects, so keep the last notes and only report the link.
            if (!prev || prev.link === 0) continue;
            next = shallowCopy(prev); next.link = 0;
        } else {
            var hshift = r.hshift - 64;
            var found = slotsFor(this.scales, r.scale, r.root);
            if (!found || r.transpose === undefined || r.detune === undefined || !(hshift >= -7 && hshift <= 7)) continue;
            next = {
                source: ch === "1" ? "sinfonion" : "droid",
                link: 1,
                root: r.root,
                scale: r.scale,
                scaleName: nameAtRoot(found.name, r.root),
                transpose: r.transpose - 64,
                hshift: hshift,
                detune: r.detune - 64,
                slots: found.slots
            };
        }
        if (!prev || JSON.stringify(prev) !== JSON.stringify(next)) { this.instances[ch] = next; changed = true; }
    }
    return changed;
};

Decoder.prototype.json = function () {
    return JSON.stringify({ schema: 1, instances: this.instances });
};

Decoder.prototype.statusLines = function () {
    var lines = [], ch;
    for (ch in this.frozen) lines.push("ch " + ch + ": protocol version " + this.frozen[ch] + ", frozen");
    for (ch in this.instances) {
        var i = this.instances[ch], notes = [];
        for (var k = 0; k < 12; k++) notes.push(SHARP_NAMES[i.slots[k]]);
        lines.push("ch " + ch + ": link " + (i.link ? "up" : "DOWN") + " | " + SHARP_NAMES[i.root] +
                   " | " + i.scale + " " + i.scaleName + " | " + notes.slice(0, 7).join(" ") +
                   " + " + notes.slice(7).join(" ") + " | tr " + i.transpose + " hs " + i.hshift);
    }
    if (!lines.length) lines.push("waiting for DROID CCs 19-25 (MIDI From = MASTER18, Monitor In)");
    return lines;
};

function shallowCopy(o) { var c = {}; for (var k in o) c[k] = o[k]; return c; }

// ---- Max glue ---------------------------------------------------------------

var IN_MAX = typeof outlet === "function" && typeof Task === "function";
if (IN_MAX) { inlets = 2; outlets = 2; autowatch = 1; }

var decoder = null, debounce = null, lastUpdate = "never";

function ensureDecoder() {
    if (decoder) return true;
    var d = new Dict();
    d.import_json("scales.json");
    var table = JSON.parse(d.stringify() || "{}").scales;
    if (!table || table.length !== 108) { post("sinf_decoder: scales.json not found or incomplete\n"); return false; }
    decoder = new Decoder(table);
    debounce = new Task(flush, this);
    showStatus();
    return true;
}

function loadbang() { ensureDecoder(); }

function msg_int(v) {
    if (inlet !== 0 || !ensureDecoder()) return;
    if (decoder.byte(v)) { debounce.cancel(); debounce.schedule(5); }
}

function bang() {
    if (inlet === 1 && ensureDecoder()) broadcast();
}

function flush() {
    if (decoder.derive()) { lastUpdate = new Date().toTimeString().slice(0, 8); broadcast(); }
    showStatus();
}

function broadcast() {
    var d = new Dict("sinf.state");
    d.parse(decoder.json());
    outlet(0, "dictionary", "sinf.state");
}

function showStatus() {
    var text = decoder.statusLines().join(" / ") + " | changed " + lastUpdate;
    outlet(1, ["set"].concat(text.split(" ")));
}

if (typeof module !== "undefined") {
    module.exports = { Decoder: Decoder, slotsFor: slotsFor, nameAtRoot: nameAtRoot, FIELDS: FIELDS };
}
