#!/usr/bin/env python3
"""Which signatures return a Buffer or typed array, and therefore need a boundary
construction that does not exist.

    python3 tooling/conformance/view-returns.py

**No emitted wrapper builds a typed array of any kind.** Across all 24 `addon.c`
in `target/node`, the count of `napi_create_typedarray`,
`napi_create_buffer`, `napi_create_external_arraybuffer` and
`napi_create_dataview` is zero. What the wrappers construct is strings,
functions, errors, doubles, plain arrays and one object. So a `view<u8>` has no
route across the boundary at all.

`Buffer` is also erased before the boundary sees it: `get lastChar(): Buffer`
lowers to `-> managed<view<u8>>`, so even with a construction the Buffer-ness --
`.equals`, which node's `string_decoder` internals expose -- would have to be
rebuilt on the far side.

This counts what is behind that. Measured 2026-09-09: **66 signatures**, across
`buffer` 18, `stream` 20, `fs` 10, `zlib` 9, `url` 3, `dgram` 2,
`string_decoder` 2, `querystring` 1, `util` 1.

**The number moved twice before it was worth quoting**, both times downward in
truth and upward in the raw count:

  99   first pass -- return type taken as everything up to the next `{`, which
       runs past the signature whenever a declaration ends in `;` and swallows
       the following member
 104   cutting at `;` or `{` at depth zero, and dropping construct signatures
       and `#private` members -- higher, because entries previously lost to a
       length filter were now extracted correctly
  66   counting a view in *return position* only. `Promise<Uint8Array>` returns
       a view; `BlobReadableStream<Uint8Array>` returns a stream. Matching the
       whole annotation counts both, and a third of the population was the
       second kind.
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


VIEW = re.compile(r'\b(Buffer|Uint8Array|Uint8ClampedArray|Int8Array|Uint16Array|Int16Array|'
                  r'Uint32Array|Int32Array|Float32Array|Float64Array|BigInt64Array|BigUint64Array|'
                  r'ArrayBufferView|DataView|ArrayBuffer)\b')
SIG = re.compile(r'(?:^|\n)(\s*)(?:export\s+)?(?:default\s+)?'
                 r'(?:public\s+|private\s+|protected\s+|static\s+|async\s+|get\s+|set\s+|readonly\s+)*'
                 r'(?:function\s+)?([A-Za-z_$#][\w$]*)\s*(?:<[^>(]*>)?\s*\(')
rows = []
for path in sorted(set(glob.glob("runtime/node/*/src/**/*.ts", recursive=True))):
    if "node_modules" in path:
        continue
    src = strip_comments(open(path, encoding="utf8").read())
    for m in SIG.finditer(src):
        try:
            oi = src.index("(", m.end() - 1)
        except ValueError:
            continue
        plist, close = params_of(src, oi)
        if plist is None:
            continue
        tail = src[close + 1:close + 200]
        if not tail.lstrip().startswith(":"):
            continue                      # no return annotation, or not a signature
        # Cut the return type at the first `;` or `{` at depth zero. Splitting on
        # `{` alone runs past the signature whenever a declaration ends in `;`
        # -- an interface method, an overload -- and swallows the next member,
        # which is how `read` came back as
        # `Promise<Uint8Array<ArrayBuffer> | undefined>; close(): Pro`.
        rest, depth, out = tail.lstrip()[1:], 0, []
        for ch in rest:
            if ch in "<([{":
                if ch == "{" and depth == 0:
                    break
                depth += 1
            elif ch in ">)]}":
                depth -= 1
            elif ch == ";" and depth == 0:
                break
            elif ch == "\n" and depth == 0 and out and out[-1].strip():
                break
            out.append(ch)
        ret = "".join(out).strip()
        if not ret or len(ret) > 90:
            continue
        # Construct signatures and private members do not cross a wrapper.
        if m.group(2) == "new" or m.group(2).startswith("#"):
            continue
        # A view in *return position*, not one appearing as a type argument.
        # `BlobReadableStream<Uint8Array>` returns a stream; `Promise<Uint8Array>`
        # returns a view. Matching the whole annotation counts both.
        def head_is_view(t):
            t = t.strip()
            while t.startswith("Promise<") and t.endswith(">"):
                t = t[len("Promise<"):-1].strip()
            for arm in split_top(t, "|"):
                arm = arm.strip()
                if not arm:
                    continue
                head = arm.split("<")[0].strip()
                if VIEW.fullmatch(head):
                    return True
            return False

        if head_is_view(ret):
            rows.append({"file": path, "fn": m.group(2), "ret": ret[:60]})

if __name__ == "__main__":
    from collections import Counter
    by = Counter(r["file"].split("/")[2] for r in rows)
    print(f"  {len(rows)} signature(s) returning a Buffer or typed array\n")
    for mod, n in sorted(by.items(), key=lambda kv: -kv[1]):
        print(f"    {mod:<18} {n}")
    print("\n  No emitted wrapper constructs one. See the module docstring.")
