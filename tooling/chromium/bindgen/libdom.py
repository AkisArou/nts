#!/usr/bin/env python3
"""How much of TypeScript's lib.dom.d.ts the generated bindings cover.

The direction: a program written against the stock lib.dom.d.ts, compiled
through the bindings generate.py emits. This measures the distance. For every
interface the allowlist binds, each member lib.dom.d.ts declares on it -- its
own, and its mixins' (`interface Element extends ..., ChildNode, ParentNode`)
-- is one of:

  bound     generated (types/dom-idl.d.ts has it)
  skipped   in Blink's IDL, not bound yet; report.json says why
  absent    not an IDL attribute or operation of it in Blink at this pin,
            by kind: a constant, an iterable's or a stringifier's member, a
            CSS property (Blink's named-property interceptor), or other

Reads lib.dom.d.ts from the bundled TypeScript the compiler's frontend uses.
generate.py writes the result, report-libdom.json beside this file, with
every generation, from the declarations and skips it has just made, so
`generate.py --check` holds it current. This prints its summary:

  python3 tooling/chromium/bindgen/libdom.py
"""

import collections
import json
import os
import re

from checkout import TYPESCRIPT_GO

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
# typescript-go is a submodule: the shared checkout's copy (checkout.py).
LIB_DOM = os.path.join(TYPESCRIPT_GO, "internal", "bundled", "libs", "lib.dom.d.ts")
REPORT = os.path.join(HERE, "report-libdom.json")

MEMBER = re.compile(r"^\s{4}(?:readonly\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\??\s*[(<:]", re.M)


def interfaces(text):
    """lib.dom.d.ts's `interface X extends A, B { ... }` blocks, merged: the
    file declares some interfaces more than once."""
    found = collections.defaultdict(lambda: {"extends": [], "members": set()})
    for match in re.finditer(r"^interface (\w+)(?:<[^>]*>)?(?: extends ([^{]+))? \{\n(.*?)^\}", text, re.M | re.S):
        name, extends, body = match.group(1), match.group(2), match.group(3)
        entry = found[name]
        if extends:
            entry["extends"] += [part.strip().split("<")[0] for part in extends.split(",")]
        entry["members"] |= set(MEMBER.findall(body))
    return found


def void_methods(text):
    """Per interface, the methods every lib.dom.d.ts overload of which
    returns `void`."""
    returns = collections.defaultdict(lambda: collections.defaultdict(set))
    for match in re.finditer(r"^interface (\w+)(?:<[^>]*>)?(?: extends [^{]+)? \{\n(.*?)^\}", text, re.M | re.S):
        for method in re.finditer(r"^\s{4}([A-Za-z_$][\w$]*)\??(?:<[^>]*>)?\((.*)\): ([^;]+);$", match.group(2), re.M):
            returns[match.group(1)][method.group(1)].add(method.group(3).strip())
    return {name: {method for method, types in methods.items() if types == {"void"}}
            for name, methods in returns.items()}


def bound_members(text):
    """What dom-idl.d.ts binds, per interface: methods and properties of each
    `XOwnMethods`, not the `_get_`/`_set_` methods behind properties."""
    out = {}
    for match in re.finditer(r"export interface (\w+)OwnMethods \{\n(.*?)^  \}", text, re.M | re.S):
        names = set(re.findall(r"^\s{4}(?:readonly\s+)?(?:get\s+|set\s+)?([A-Za-z_$][\w$]*)\(?", match.group(2), re.M))
        out[match.group(1)] = {name for name in names if not name.startswith(("_get_", "_set_"))}
    return out


def absence(interface, member):
    if re.fullmatch(r"[A-Z][A-Z0-9_]*", member):
        return "constant"
    if member in ("entries", "forEach", "keys", "values"):
        return "iterable"
    if member == "toString":
        return "stringifier"
    if interface == "CSSStyleDeclaration":
        return "css property"
    return "other"


def coverage(declarations, skips, allowlist):
    """report-libdom.json: each lib.dom.d.ts member of each allowlisted
    interface, bound by `declarations` (dom-idl.d.ts's text), skipped with
    the generator's `skips` (report.json's), or absent."""
    lib = interfaces(open(LIB_DOM).read())
    bound = bound_members(declarations)
    skipped = collections.defaultdict(dict)
    for item in skips:
        member = item["member"].split()[-1].split("/")[0]
        skipped[item["interface"]].setdefault(member, item["why"])
    allowed = allowlist["interfaces"]
    rows = {}
    totals = collections.Counter()
    for name in allowed:
        if name not in lib:
            continue
        # Its own members and its mixins'; an ancestor that is itself an
        # interface we bind is counted there, not here.
        members = set(lib[name]["members"])
        pending = list(lib[name]["extends"])
        while pending:
            parent = pending.pop()
            if parent in allowed or parent not in lib:
                continue
            members |= lib[parent]["members"]
            pending += lib[parent]["extends"]
        members.discard("addEventListener")
        members.discard("removeEventListener")
        # An inherited member lib.dom.d.ts redeclares narrower
        # (Element.ownerDocument is a Document) is bound on the ancestor.
        chain = [name]
        pending = list(lib[name]["extends"])
        while pending:
            parent = pending.pop()
            if parent in allowed:
                chain.append(parent)
            pending += lib.get(parent, {"extends": []})["extends"]
        row = {"bound": [], "skipped": {}, "absent": collections.defaultdict(list)}
        for member in sorted(members):
            if any(member in bound.get(owner, set()) for owner in chain):
                row["bound"].append(member)
            elif member in skipped[name]:
                row["skipped"][member] = skipped[name][member]
            else:
                row["absent"][absence(name, member)].append(member)
        rows[name] = row
        totals.update(bound=len(row["bound"]), skipped=len(row["skipped"]))
        for kind, names in row["absent"].items():
            totals["absent: " + kind] += len(names)
    reasons = collections.Counter(" ".join(why.split()[:2]) for row in rows.values() for why in row["skipped"].values())
    return {"libDom": os.path.relpath(LIB_DOM, ROOT), "totals": dict(totals), "skippedBy": dict(reasons.most_common()),
            "interfaces": rows}


def main():
    report = json.load(open(REPORT))
    totals = report["totals"]
    print(f"lib.dom members of bound interfaces: {sum(totals.values())}")
    for key, count in sorted(totals.items()):
        print(f"  {key}: {count}")
    for reason, count in list(report["skippedBy"].items())[:8]:
        print(f"  skipped: {count:4} {reason}")


if __name__ == "__main__":
    main()
