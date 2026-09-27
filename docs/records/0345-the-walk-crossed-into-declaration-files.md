# 0345 — The walk crossed into declaration files, and a batch did not help

Status: measured; the boundary landed, the batch was built and discarded
Recorded: 2026-09-27

A program naming the macOS platform package (`@nts/platform-macos`: Foundation,
Core Graphics and AppKit, declared whole; `docs/nts-config.md` 3a, built in the
Apple lane and landing after this) took **6–7 s** in the frontend, where
the same program over a 13-class binding took under one. This is what that cost
was, and the batch endpoint that did not remove it.

## The batch, first: round trips were not the cost

[0002](0002-type-decomposition-is-per-type.md) found that decomposition costs a
round trip per question per type, and that the pipe itself is nearly free. At
409,620 round trips the question was worth asking again, so I built the batch:
an additive `ntsBatch` method in the vendored tsgo that routes each item through
the ordinary `HandleRequest` with its own error, and a prefetch that recorded
the exact requests the unchanged decomposer would make, three exchanges per
frontier of 512 types.

It did what it was built to do, and it did not matter:

| `macos-window`, platform packages | round trips | user | wall |
| --- | ---: | ---: | ---: |
| one request per question | 543,923 | 9.4 s | 10.4 s |
| batched | 32,614 | 9.0 s | 8.0 s |

The snapshot digest was identical both ways. Seventeen times fewer round trips
saved system time and almost nothing else. The profile said where the time
was: tsgo's collector over a heap holding every framework type, JSON on both
sides, and **13% in recovered panics**. Carrying a patch on the checker for
that was not worth it, and it was removed.

## The panics: a type argument asked of a non-reference

`getTypeArguments` reads its type as a `TypeReference` and dereferences nil on
anything else. The decomposer guarded with `Target()`, which is also non-nil
for an instantiated *anonymous* type -- a mapped type, an object literal's --
and swallowed the resulting failure, correctly, since such a type has no
arguments. Each one was a recovered panic with its stack formatted.

The type's response already carries `objectFlags`, and `Reference` is exactly
the condition under which the call answers. `types::Interned` keeps it when the
type is first seen, so knowing costs no request. Snapshot digests were
identical on both programs.

## The cost: a walk that did not stop at a declaration file

Two walks crossed into the platform packages and followed them to the end.

**Reachability** rooted at every module's exports and statements, a
declaration file's included, and descended into every declaration it reached.
A platform package is one `declare module "objc:AppKit"` statement holding the
framework, and `NSWindow`'s declaration names `NSScreen` and `NSToolbar`, whose
declarations name more. From a program using a few dozen names, 117,459 nodes
were reachable.

**Decomposition** followed every member's type, so `NSWindow` decomposed its
members' classes and theirs.

What changed:

- A declaration file's modules are not roots: it evaluates nothing and
  publishes nothing.
- A class, interface, enum or module a declaration file declares does not
  reach its members; each member is reached by a reference to it.
- Except a class or interface the program extends or implements, walked
  whole through the import that names it: an override is matched against
  the base's members by name, and a Windows Runtime override reads the
  base member's signature. The first version without this failed eight of
  `com_classes`' tests with "an override whose binding declares no
  signature" -- the gate's tests caught it, where the example sweep below
  could not, since no example writes over a composable class.
- Every function a declaration file declares is a root. Lowering calls a
  foreign function **by name** -- `@ntsConstruct gtk_label_new`, a class's
  `_get_type`, `g_type_check_instance_is_a` -- and takes any bodiless function
  declaration of that name, so that lookup's whole domain is reachable. The
  first version without this refused `gtk-cycles` 245 times: no reference
  leads to a function only a tag names.
- A class or protocol a foreign runtime declares (`@ntsClass`,
  `@ntsProtocol`), or the namespace of a module only declaration files
  declare, has its members recorded and their types left for the program to
  reach.

## Result

Same machine state, three runs each, `nts frontend --decompose --calls
--constants`, snapshot cache off:

| `macos-window` | decomposed | round trips | user | wall |
| --- | ---: | ---: | ---: | ---: |
| 13-class binding, before | 6,026 | 54,637 | 0.91–0.97 s | 0.83–0.91 s |
| 13-class binding, after | 1,695 | 14,000 | 0.63–0.68 s | 0.51–0.56 s |
| platform packages, before | 40,665 | 409,620 | 6.0–6.6 s | 6.1–6.9 s |
| platform packages, after | 3,687 | 34,694 | 2.4–2.7 s | 1.9–2.3 s |

**Control.** `emit-c` over all 404 examples with both binaries: 403 identical
in C and in refusals. The one difference, `macos-bench`, is two forward
declarations (`struct NSFileManager;`, `struct NSProcessInfo;`) nothing in
either output uses.

## What is left

The platform program is still four times the class list's. Most of it is
before decomposition: decoding and typing every node of the framework
declarations -- the frontend with no deep passes is 1.35 s on the platform
packages. Typing only the declarations the program reaches needs reachability
before types, which today runs after them.
