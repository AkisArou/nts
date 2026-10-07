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

Reads lib.dom.d.ts from the bundled TypeScript the compiler's frontend uses,
dom-idl.d.ts and report.json; writes report-libdom.json beside this file.

  python3 tooling/chromium/bindgen/libdom.py
"""

import collections
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
LIB_DOM = os.path.join(ROOT, "third_party", "typescript-go", "internal", "bundled", "libs", "lib.dom.d.ts")
DOM_IDL = os.path.join(ROOT, "runtime", "chromium", "dom", "types", "dom-idl.d.ts")
REPORT = os.path.join(HERE, "report.json")
ALLOWLIST = os.path.join(HERE, "allowlist.json")

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


def main():
    lib = interfaces(open(LIB_DOM).read())
    bound = bound_members(open(DOM_IDL).read())
    skipped = collections.defaultdict(dict)
    for item in json.load(open(REPORT))["skipped"]:
        member = item["member"].split()[-1].split("/")[0]
        skipped[item["interface"]].setdefault(member, item["why"])
    allowed = json.load(open(ALLOWLIST))["interfaces"]
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
    out = {"libDom": os.path.relpath(LIB_DOM, ROOT), "totals": dict(totals), "skippedBy": dict(reasons.most_common()),
           "interfaces": rows}
    with open(os.path.join(HERE, "report-libdom.json"), "w") as file:
        file.write(json.dumps(out, indent=2) + "\n")
    print(f"lib.dom members of bound interfaces: {sum(totals.values())}")
    for key, count in sorted(totals.items()):
        print(f"  {key}: {count}")
    for reason, count in reasons.most_common(8):
        print(f"  skipped: {count:4} {reason}")


if __name__ == "__main__":
    main()
