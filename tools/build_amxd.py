"""Generate the Max for Live devices.

Usage: python3 tools/build_amxd.py
  master/sinf.master.amxd  loads sinf_decoder.js and scales.json from master/
  slave/sinf.slave.amxd    loads sinf_slave.js from slave/
Each device finds its .js next to it, so keep the .amxd files where they are built.
"""
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FONT = {"fontname": "Arial Bold", "fontsize": 10.0}


def box(id_, maxclass, rect, text=None, inlets=1, outlets=0, outlettype=None, present=None, **extra):
    b = {"id": id_, "maxclass": maxclass, "numinlets": inlets, "numoutlets": outlets,
         "patching_rect": rect, **FONT, **extra}
    if outlets:
        b["outlettype"] = outlettype or [""] * outlets
    if text is not None:
        b["text"] = text
    if present:
        b["presentation"] = 1
        b["presentation_rect"] = present
    return {"box": b}


def line(src, src_out, dst, dst_in):
    return {"patchline": {"source": [src, src_out], "destination": [dst, dst_in]}}


def live_param(longname, shortname, ptype, initial, enum=None, mmin=None, mmax=None):
    v = {"parameter_longname": longname, "parameter_shortname": shortname, "parameter_type": ptype,
         "parameter_initial_enable": 1, "parameter_initial": [initial]}
    if enum is not None:
        v["parameter_enum"] = enum
        v["parameter_mmax"] = len(enum) - 1
    if mmin is not None:
        v["parameter_mmin"] = mmin
    if mmax is not None:
        v["parameter_mmax"] = mmax
    return {"parameter_enable": 1, "varname": longname, "saved_attribute_attributes": {"valueof": v}}


def patcher(boxes, lines, width, description, folder, deps, params=None):
    p = {
        "fileversion": 1,
        "appversion": {"major": 9, "minor": 1, "revision": 5, "architecture": "x64", "modernui": 1},
        "classnamespace": "box",
        "rect": [100.0, 100.0, 800.0, 560.0],
        "openrect": [0.0, 0.0, width, 169.0],
        "bglocked": 0,
        "openinpresentation": 1,
        "default_fontsize": 10.0,
        "default_fontface": 0,
        "default_fontname": "Arial Bold",
        "gridonopen": 1,
        "gridsize": [8.0, 8.0],
        "gridsnaponopen": 1,
        "objectsnaponopen": 1,
        "statusbarvisible": 2,
        "toolbarvisible": 1,
        "boxanimatetime": 500,
        "enablehscroll": 1,
        "enablevscroll": 1,
        "devicewidth": width,
        "description": description,
        "digest": "",
        "tags": "",
        "style": "",
        "subpatcher_template": "",
        "assistshowspatchername": 0,
        "boxes": boxes,
        "lines": lines,
        "dependency_cache": [
            {"name": name, "bootpath": str(folder), "patcherrelativepath": ".", "type": ftype, "implicit": 1}
            for name, ftype in deps
        ],
        "latency": 0,
        "is_mpe": 0,
        "minimum_live_version": "",
        "minimum_max_version": "",
        "platform_compatibility": 0,
        "autosave": 0,
    }
    if params:
        p["parameters"] = {**params, "inherited_shortname": 1}
    return p


def write_amxd(path, p):
    body = json.dumps({"patcher": p}, indent="\t").encode("utf-8") + b"\n\x00"
    header = b"ampf" + struct.pack("<I", 4) + b"mmmm" + b"meta" + struct.pack("<I", 4) + b"\x00" * 4
    path.write_bytes(header + b"ptch" + struct.pack("<I", len(body)) + body)
    print(f"wrote {path} ({path.stat().st_size} bytes)")


def master_device():
    folder = ROOT / "master"
    boxes = [
        box("obj-title", "comment", [300.0, 20.0, 420.0, 18.0],
            "Sinfonion bridge master - MIDI From: DROID MASTER18, ch 1, Monitor In",
            present=[4.0, 2.0, 590.0, 18.0]),
        box("obj-midiin", "newobj", [20.0, 20.0, 40.0, 20.0], "midiin", outlets=1, outlettype=["int"]),
        box("obj-hello", "newobj", [120.0, 20.0, 100.0, 20.0], "receive sinf.hello", outlets=1),
        box("obj-btn", "button", [230.0, 20.0, 20.0, 20.0], outlets=1, outlettype=["bang"],
            present=[4.0, 146.0, 20.0, 20.0]),
        box("obj-btnlabel", "comment", [255.0, 20.0, 60.0, 18.0], "Broadcast",
            present=[26.0, 148.0, 70.0, 18.0]),
        box("obj-js", "newobj", [20.0, 80.0, 120.0, 20.0], "js sinf_decoder.js", inlets=2, outlets=2,
            saved_object_attributes={"filename": "sinf_decoder.js", "parameter_enable": 0}),
        box("obj-send", "newobj", [20.0, 140.0, 100.0, 20.0], "send sinf.state"),
        box("obj-status", "message", [160.0, 140.0, 280.0, 60.0], "waiting", inlets=2, outlets=1,
            linecount=4, presentation_linecount=8, present=[4.0, 22.0, 290.0, 122.0]),
        box("obj-rstate", "newobj", [20.0, 220.0, 100.0, 20.0], "receive sinf.state", outlets=1),
        box("obj-view", "dict.view", [20.0, 250.0, 300.0, 150.0], inlets=1, outlets=0,
            present=[298.0, 22.0, 296.0, 144.0]),
    ]
    lines = [
        line("obj-midiin", 0, "obj-js", 0),
        line("obj-hello", 0, "obj-js", 1),
        line("obj-btn", 0, "obj-js", 1),
        line("obj-js", 0, "obj-send", 0),
        line("obj-js", 1, "obj-status", 0),
        line("obj-rstate", 0, "obj-view", 0),
    ]
    p = patcher(boxes, lines, 600.0,
                "Sinfonion bridge master: decodes DROID CCs 19-25 and broadcasts sinf.state",
                folder, [("sinf_decoder.js", "TEXT"), ("scales.json", "JSON")])
    write_amxd(folder / "sinf.master.amxd", p)


# Buttons in Sinfonion panel order, with the slot each one selects (slot order: I, II..VII, fill1..5)
PANEL_BUTTONS = [("ROOT", 0), ("3RD", 2), ("5TH", 4), ("7TH", 6), ("9TH", 1), ("11TH", 3), ("13TH", 5),
                 ("F1", 7), ("F2", 8), ("F3", 9), ("F4", 10), ("F5", 11)]
DEFAULT_ON = {"ROOT", "3RD", "5TH", "7TH"}


def slave_device():
    folder = ROOT / "slave"
    boxes = [
        box("obj-title", "comment", [400.0, 20.0, 200.0, 18.0], "Sinfonion bridge slave",
            present=[4.0, 2.0, 140.0, 18.0]),
        box("obj-midiin", "newobj", [20.0, 20.0, 40.0, 20.0], "midiin", outlets=1, outlettype=["int"]),
        box("obj-js", "newobj", [20.0, 300.0, 120.0, 20.0], "js sinf_slave.js", inlets=2, outlets=3,
            saved_object_attributes={"filename": "sinf_slave.js", "parameter_enable": 0}),
        box("obj-midiout", "newobj", [20.0, 360.0, 50.0, 20.0], "midiout"),
        box("obj-shello", "newobj", [90.0, 360.0, 100.0, 20.0], "send sinf.hello"),
        box("obj-status", "message", [210.0, 360.0, 300.0, 40.0], "waiting", inlets=2, outlets=1,
            linecount=2, presentation_linecount=3, present=[4.0, 116.0, 452.0, 48.0]),
        box("obj-rstate", "newobj", [160.0, 240.0, 100.0, 20.0], "receive sinf.state", outlets=1),
        box("obj-rpanic", "newobj", [280.0, 240.0, 100.0, 20.0], "receive sinf.panic", outlets=1),
    ]
    lines = [
        line("obj-midiin", 0, "obj-js", 0),
        line("obj-js", 0, "obj-midiout", 0),
        line("obj-js", 1, "obj-shello", 0),
        line("obj-js", 2, "obj-status", 0),
        line("obj-rstate", 0, "obj-js", 1),
        line("obj-rpanic", 0, "obj-js", 1),
    ]
    params = {}

    def control(id_, maxclass, rect, present, prepend, prep_rect, param, outlets, outlettype, **extra):
        boxes.append(box(id_, maxclass, rect, inlets=1, outlets=outlets, outlettype=outlettype,
                         present=present, **param, **extra))
        pid = id_ + "-prep"
        boxes.append(box(pid, "newobj", prep_rect, "prepend " + prepend, inlets=2, outlets=1))
        lines.append(line(id_, 0, pid, 0))
        lines.append(line(pid, 0, "obj-js", 1))
        v = param["saved_attribute_attributes"]["valueof"]
        params[id_] = [v["parameter_longname"], v["parameter_shortname"], 0]

    for i, (name, slot) in enumerate(PANEL_BUTTONS):
        row, col = (0, i) if i < 7 else (1, i - 7)
        control(f"obj-b{slot}", "live.text", [20.0 + i * 60, 80.0, 50.0, 18.0],
                [4.0 + col * 64, 24.0 + row * 22, 60.0, 18.0],
                f"button {slot}", [20.0 + i * 60, 110.0, 60.0, 20.0],
                live_param(f"Select {name}", name, 2, 1 if name in DEFAULT_ON else 0, enum=["off", "on"]),
                outlets=2, outlettype=["", ""], text=name, texton=name, mode=1)

    control("obj-inst", "live.numbox", [20.0, 160.0, 44.0, 15.0], [390.0, 3.0, 44.0, 15.0],
            "instance", [20.0, 190.0, 80.0, 20.0],
            live_param("Instance", "Inst", 1, 1, mmin=1, mmax=16),
            outlets=2, outlettype=["", "float"])
    boxes.append(box("obj-instlabel", "comment", [70.0, 160.0, 60.0, 18.0], "Instance",
                     present=[336.0, 2.0, 54.0, 18.0]))
    control("obj-dir", "live.tab", [140.0, 160.0, 150.0, 18.0], [4.0, 70.0, 180.0, 18.0],
            "direction", [140.0, 190.0, 90.0, 20.0],
            live_param("Direction", "Dir", 2, 1, enum=["nearest", "up", "down"]),
            outlets=3, outlettype=["", "", "float"], num_lines_patching=1, num_lines_presentation=1)
    control("obj-pol", "live.tab", [300.0, 160.0, 120.0, 18.0], [190.0, 70.0, 140.0, 18.0],
            "policy", [300.0, 190.0, 70.0, 20.0],
            live_param("Held notes", "Held", 2, 0, enum=["hold", "retrigger"]),
            outlets=3, outlettype=["", "", "float"], num_lines_patching=1, num_lines_presentation=1)
    control("obj-panic", "live.text", [440.0, 160.0, 50.0, 18.0], [336.0, 70.0, 60.0, 18.0],
            "panic", [440.0, 190.0, 80.0, 20.0],
            live_param("Panic", "Panic", 2, 0, enum=["off", "on"]),
            outlets=2, outlettype=["", ""], text="Panic", texton="Panic", mode=0)

    p = patcher(boxes, lines, 460.0,
                "Sinfonion bridge slave: quantizes this track's notes to the Sinfonion's harmony",
                folder, [("sinf_slave.js", "TEXT")], params)
    write_amxd(folder / "sinf.slave.amxd", p)


if __name__ == "__main__":
    master_device()
    slave_device()
