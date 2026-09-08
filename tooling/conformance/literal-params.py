#!/usr/bin/env python3
"""Which exported parameters are typed as a literal, and which of those are numeric.

    python3 tooling/conformance/literal-params.py

A declared type is a fact about every possible caller and the analysis trusts it.
Inside TypeScript that is sound. Through the napi wrapper it is a promise nothing
enforces: `walk(rounds: 64)` called with 2147483647 enters an integer body whose
accumulator was proven small from `[64, 64]` and wraps -- no error, no refusal, a
wrong number. See `blockers/literal-parameter-trusted-past-the-boundary`.

So the size of the population decides whether enforcing the declared facts at the
wrapper is obviously worth it or needs its own cost measured. Measured
2026-09-09: **5 on the exported surface, of which 1 is numeric**, and 49 anywhere
in the tree, of which the same 1 is numeric.

**Numeric is the column that matters.** A string or boolean literal broken at the
boundary mis-selects a branch. A numeric one silently returns a wrong number,
which is the failure nothing downstream can see.

Two passes, deliberately. The restricted pass takes only declarations a parser
believes are exported; the exhaustive pass takes every signature. They must agree
on the numeric count, and if they ever disagree the restricted pass is the one to
distrust -- it is the one holding a notion of "exported" that a parser can get
wrong.

Both strip comments first. The first version of this did not, and counted
`export function walk(rounds: 64)` out of the *prose* of the fixture that
motivated it -- a parser reporting a population that included the documentation
of the population. It also missed class methods, which is where the only numeric
case lives; that version would have answered "four, none numeric", which is
confidently wrong in the direction that makes the check look unnecessary.
"""
import re, sys, glob, os, json

LIT = re.compile(r'^\s*(?:-?\d+(?:\.\d+)?|"[^"]*"|\'[^\']*\'|`[^`]*`|true|false)\s*$')

def split_top(text, sep):
    """Split on `sep` at nesting depth zero, respecting (), [], {}, <> and strings."""
    out, depth, buf, i, quote = [], 0, [], 0, None
    angle = 0
    while i < len(text):
        c = text[i]
        if quote:
            buf.append(c)
            if c == "\\": 
                if i + 1 < len(text): buf.append(text[i+1]); i += 1
            elif c == quote: quote = None
            i += 1; continue
        if c in "\"'`": quote = c; buf.append(c); i += 1; continue
        if c in "([{": depth += 1
        elif c in ")]}": depth -= 1
        elif c == "<": angle += 1
        elif c == ">" and angle > 0: angle -= 1
        if c == sep and depth == 0 and angle == 0:
            out.append("".join(buf)); buf = []
        else:
            buf.append(c)
        i += 1
    out.append("".join(buf))
    return out

def params_of(src, open_idx):
    depth, i = 0, open_idx
    while i < len(src):
        if src[i] == "(": depth += 1
        elif src[i] == ")":
            depth -= 1
            if depth == 0: return src[open_idx+1:i], i
        i += 1
    return None, None

def classify(param):
    """Return 'literal', 'union-of-literals', or None for one parameter."""
    p = param.strip()
    if not p or p.startswith("//"): return None
    parts = split_top(p, ":")
    if len(parts) < 2: return None
    ann = ":".join(parts[1:])
    # Strip a default value: the `=` at depth zero.
    ann = split_top(ann, "=")[0].strip()
    if not ann: return None
    arms = [a.strip() for a in split_top(ann, "|")]
    arms = [a for a in arms if a]
    if not arms: return None
    lits = [a for a in arms if LIT.match(a)]
    if len(lits) != len(arms): return None
    return "literal" if len(arms) == 1 else "union-of-literals"

def strip_comments(src):
    out, i, n, quote = [], 0, len(src), None
    while i < n:
        c = src[i]
        if quote:
            out.append(c)
            if c == "\\" and i + 1 < n: out.append(src[i+1]); i += 2; continue
            if c == quote: quote = None
            i += 1; continue
        if c in "\"'`": quote = c; out.append(c); i += 1; continue
        if c == "/" and i + 1 < n and src[i+1] == "/":
            while i < n and src[i] != "\n": out.append(" "); i += 1
            continue
        if c == "/" and i + 1 < n and src[i+1] == "*":
            j = src.find("*/", i + 2)
            j = n if j == -1 else j + 2
            out.append("".join(" " if ch != "\n" else "\n" for ch in src[i:j]))
            i = j; continue
        out.append(c); i += 1
    return "".join(out)


ANY = re.compile(r'(?:^|[\n;{}])\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?'
                 r'(?:public\s+|private\s+|protected\s+|static\s+|async\s+|get\s+|set\s+|readonly\s+)*'
                 r'(?:function\s+)?([A-Za-z_$#][\w$]*)\s*(?:<[^>(]*>)?\s*\(')
FN   = re.compile(r'\bexport\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*(?:<[^>(]*>)?\s*\(')
ARROW= re.compile(r'\bexport\s+const\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s*)?(?:function\s*[A-Za-z_$]*\s*)?\(')
CLS  = re.compile(r'\bexport\s+(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)')
METH = re.compile(r'(?:^|\n)\s{2}(?:public\s+|private\s+|protected\s+|static\s+|async\s+|get\s+|set\s+|\*)*([A-Za-z_$#][\w$]*)\s*(?:<[^>(]*>)?\s*\(')
NUMERIC = re.compile(r'^-?\d')

def sources():
    for path in sorted(set(glob.glob("runtime/node/*/src/**/*.ts", recursive=True))):
        if "node_modules" in path:
            continue
        yield path, strip_comments(open(path, encoding="utf8").read())

def hits(text, rx, owner="", require_signature=False):
    """Every literal-typed parameter of every signature `rx` matches in `text`."""
    for m in rx.finditer(text):
        try:
            oi = text.index("(", m.end() - 1)
        except ValueError:
            continue
        plist, close = params_of(text, oi)
        if plist is None:
            continue
        if require_signature:
            # A signature, not a call: after `)` comes a return type or a body.
            after = text[close + 1:close + 4].strip()
            if not after or after[0] not in ":{":
                continue
        for param in split_top(plist, ","):
            kind = classify(param)
            if kind:
                name = (owner + "#" if owner else "") + m.group(1)
                yield {"fn": name, "param": param.strip()[:70], "kind": kind}

def restricted():
    """Only declarations a parser believes are exported: roots."""
    out = []
    for path, src in sources():
        for r in list(hits(src, FN)) + list(hits(src, ARROW)):
            out.append({**r, "file": path})
        for cm in CLS.finditer(src):
            b = src.find("{", cm.end())
            if b == -1:
                continue
            depth, i = 0, b
            while i < len(src):
                if src[i] == "{":
                    depth += 1
                elif src[i] == "}":
                    depth -= 1
                    if depth == 0:
                        break
                i += 1
            for r in hits(src[b:i], METH, owner=cm.group(1)):
                out.append({**r, "file": path})
    return out

def exhaustive():
    """Every signature in the tree, exported or not."""
    out = []
    for path, src in sources():
        for r in hits(src, ANY, require_signature=True):
            out.append({**r, "file": path})
    return out

def numeric(rows):
    return [r for r in rows if NUMERIC.match(r["param"].split(":", 1)[1].strip())]

def report(label, rows):
    n = numeric(rows)
    print(f"  {label:<34} {len(rows):>4} parameter(s), {len(n)} numeric")
    for r in rows:
        mark = "NUMERIC" if r in n else "       "
        print(f"    {mark}  {r['file'].split('runtime/node/')[-1]:<38} {r['fn']:<22} {r['param']}")
    return n

# The disagreement branch was controlled by disabling the class-method regex,
# which is precisely how the first version of this was wrong. It reports
# "0 numeric restricted vs 1 exhaustive" and says which pass to distrust -- and
# 0 is the answer that makes enforcing the boundary look unnecessary, so this is
# the direction that matters.
r_rows = restricted()
a_rows = exhaustive()
print("literal-typed parameters in runtime/node\n")
r_num = report("exported declarations (roots)", r_rows)
print()
a_num = numeric(a_rows)
print(f"  {'every signature, exported or not':<34} {len(a_rows):>4} parameter(s), {len(a_num)} numeric")
for r in a_num:
    print(f"    NUMERIC  {r['file'].split('runtime/node/')[-1]:<38} {r['fn']:<22} {r['param']}")
print()
if len(r_num) != len(a_num):
    print(f"  DISAGREE: {len(r_num)} numeric restricted vs {len(a_num)} exhaustive.")
    print("  Distrust the restricted pass -- it is the one holding a notion of")
    print("  \"exported\" that a parser can get wrong. Reconcile before quoting either.")
    sys.exit(1)
print(f"  Both passes agree: {len(a_num)} numeric literal-typed parameter(s).")
