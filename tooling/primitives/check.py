#!/usr/bin/env python3
"""Check `docs/primitives.md` against the tree and against a benchmark run.

    tooling/primitives/check.py [bench.log]

The table is nine claims about what is measured and what it costs, and until
this existed nothing checked any of them. Both halves have failed in practice:
0053 was found because a primitive had two ratchets and had never been timed,
and the `strings` node ratio was stale by a whole benchmark run when this was
written.

Without a log it checks only that every example, memory case, benchmark row and
record the table names is actually there. With one -- the output of
`cargo run --release -p nts-bench` -- it also checks that the speed column says
what the board says, within the noise the board itself carries.
"""

import os
import re
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
# Node's own timings move by more than this between runs on a busy machine, and
# a check that fails on that is a check nobody keeps.
TOLERANCE = 0.03


def rows():
    with open(os.path.join(ROOT, "docs/primitives.md")) as table:
        for line in table:
            if line.startswith("| **"):
                cells = [c.strip() for c in line.strip().strip("|").split("|")]
                yield cells[0].replace("**", ""), cells[1], cells[2], cells[3], cells[4]


def named(cell):
    return re.findall(r"`([a-z0-9-]+)`", cell)


def board(path):
    found = {}
    with open(path) as log:
        for line in log:
            line = re.sub(r"\x1b\[[0-9;]*m", "", line).rstrip()
            shape = r"^([a-z0-9-]+)(?: \(rc\))?\s+.*?([\d.]+x|--)\s+([\d.]+x|--)\s+([\d.]+x|--)\s*$"
            hit = re.match(shape, line)
            if hit:
                found[hit.group(1)] = (hit.group(2), hit.group(3))
    return found


def main():
    measured = board(sys.argv[1]) if len(sys.argv) > 1 else None
    problems = []

    for primitive, correctness, memory, speed, records in rows():
        for name in named(correctness):
            if not os.path.isdir(os.path.join(ROOT, "examples", name)):
                problems.append(f"{primitive}: no example `{name}`")
        for name in named(memory):
            if not os.path.isdir(os.path.join(ROOT, "tooling/memory/cases", name)):
                problems.append(f"{primitive}: no memory case `{name}`")
        for name in named(speed):
            if not os.path.isdir(os.path.join(ROOT, "benches/cases", name)):
                problems.append(f"{primitive}: no benchmark `{name}`")
        for number in re.findall(r"\d{4}", records):
            if not any(f.startswith(number + "-") for f in os.listdir(os.path.join(ROOT, "docs/records"))):
                problems.append(f"{primitive}: no record {number}")

        if measured is None:
            continue
        for entry in speed.split("<br>"):
            hit = re.match(r"`([a-z0-9-]+)`\s+([\d.]+|—|--)\s*/\s*\*?\*?([\d.]+)", entry.strip())
            if not hit:
                continue
            name, cpp, node = hit.group(1), hit.group(2), hit.group(3)
            if name not in measured:
                problems.append(f"{primitive}: `{name}` is not on the board")
                continue
            ran_cpp, ran_node = measured[name][0].rstrip("x"), measured[name][1].rstrip("x")
            absent = cpp in ("—", "--")
            if absent != (measured[name][0] == "--") or (
                not absent and abs(float(cpp) - float(ran_cpp)) > TOLERANCE
            ):
                problems.append(f"{primitive}: `{name}` says {cpp} against C++, the board says {ran_cpp}")
            if abs(float(node) - float(ran_node)) > TOLERANCE:
                problems.append(f"{primitive}: `{name}` says {node} against node, the board says {ran_node}")

    for problem in problems:
        print(f"  {problem}")
    if problems:
        print(f"\nprimitives.md: {len(problems)} claim(s) the tree does not support")
        return 1
    scope = "and its numbers match the board" if measured else "(numbers unchecked: pass a bench log)"
    print(f"primitives.md: every ratchet it names is there {scope}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
