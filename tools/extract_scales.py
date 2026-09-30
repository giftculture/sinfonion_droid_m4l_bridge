"""Extract the Sinfonion scale table (DROID manual blue-7, pp. 119-121) into master/scales.json.

Usage: python3 tools/extract_scales.py /path/to/droid-manual-blue-7.pdf
Needs pdftotext (poppler) on PATH.
"""
import json
import re
import subprocess
import sys
from pathlib import Path

PC = {"C": 0, "C♯": 1, "D": 2, "D♯": 3, "E": 4, "F": 5, "F♯": 6,
      "G": 7, "G♯": 8, "A": 9, "A♯": 10, "B": 11}
NOTE = r"[A-G]♯?"
ROW = re.compile(r"(?<![\d♯])(\d{1,3})\s+(.+?)\s+((?:" + NOTE + r"\s+){11}" + NOTE + r")(?=\s{2,}\d|\s*$)")


def main(pdf):
    text = subprocess.run(["pdftotext", "-f", "119", "-l", "121", "-layout", pdf, "-"],
                          capture_output=True, text=True, check=True).stdout
    rows = {}
    for line in text.splitlines():
        for m in ROW.finditer(line):
            nr = int(m.group(1))
            if 0 <= nr <= 107 and nr not in rows:
                rows[nr] = {"nr": nr,
                            "name": re.sub(r"\s+", " ", m.group(2)).strip(),
                            "slots": [PC[n] for n in m.group(3).split()]}
    missing = sorted(set(range(108)) - set(rows))
    if missing:
        sys.exit(f"missing rows: {missing}")
    out = Path(__file__).resolve().parent.parent / "master" / "scales.json"
    doc = {"source": "DROID manual blue-7, pp. 119-121",
           "note": "slots are pitch classes (0 = C) at root C, in Sinfonion order I..VII, fill1..fill5",
           "scales": [rows[i] for i in range(108)]}
    lines = [json.dumps(r, ensure_ascii=False) for r in doc["scales"]]
    body = ",\n  ".join(lines)
    out.write_text(
        "{\n"
        f' "source": {json.dumps(doc["source"])},\n'
        f' "note": {json.dumps(doc["note"])},\n'
        f' "scales": [\n  {body}\n ]\n'
        "}\n",
        encoding="utf-8")
    print(f"wrote {out}")


if __name__ == "__main__":
    main(sys.argv[1])
