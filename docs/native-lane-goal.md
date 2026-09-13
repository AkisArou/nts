# The native lane's goal

For the session working on `docs/native-interop.md`. Written 2026-09-13 after the
first two items landed (`0ce94f28`, `ac446f7d`).

## The goal

**A C program can use compiled TypeScript as a library, and TypeScript can call
a C library through scalars and opaque handles.**

Not "implement `native-interop.md`". That document is a roadmap and this is a
milestone inside it — one that ends somewhere you can demonstrate.

## Scope, in order

Each step has a file that already exists to validate against, so "done" is
observable rather than argued.

1. **Finish the outbound direction.** `examples/interop/ts-from-c` runs today.

   **Corrected 2026-09-14, before this step began, by the session it was written
   for.** The original text said "C can receive a managed value and cannot
   construct one". That was **false**, and the error is instructive: the author
   searched for `nts_str_from_utf8`, guessing from the `nts_str_*` family that
   does exist, got zero hits, and read absence. The real name is
   `nts_string_from_utf8`, public at `nts_runtime.h:1537`, with an LLVM
   signature already. Demonstrated on an unmodified runtime — `α😀` round-trips
   through `greet` with a matching control arm (`α`→`β` fails, equal=0), so the
   test can fail.

   **A grep for a guessed name returning zero cannot distinguish "it does not
   exist" from "my pattern is wrong."** That is a standing discipline in this
   repository, violated by the person writing the goal, and it propagated into
   four documents before the preflight caught it.

   **Measured 2026-09-14, and the author was wrong three times in one message.**
   The list below is what the probes actually showed; every line that says
   "demonstrated" has two arms, one of which fails.

   - **Strings: demonstrated.** `nts_string_from_utf8` round-trips `α😀`
     through `greet`; changing `α` to `β` in the same binary fails. No helper
     needed.
   - **Numeric arrays: demonstrated.** `nts_array_of_numbers(3)` with
     `NTS_ITEMS` writes `[1.25, 2.5, 3.75]`, the exported sum answers `7.50`;
     changing the last element to `4.75` gives `8.50` against an expected
     `7.50` and fails. No helper needed. The **first** attempt segfaulted, and
     the cause was the runtime header's own comment recommending
     `NTS_ELEMENTS` — string-inline storage, which overwrites the array's
     `capacity` and `elements`. Comment fixed and the caller checked in as a
     test (`54f3018a`).
   - **Objects: NOT constructible from C, and this corrects the author twice.**
     `nts_object_new` is public, but the emitted descriptors are
     `static const NtsDescriptor` — file-local, so a header consumer gets an
     undeclared identifier and an `extern` declaration fails at link.
     **Descriptors are not a public construction surface.** Factories like
     `makePoint` are callable and are the supported route.
   - **A generator `next` shim** and **a promise wait**, which stand and are
     the real remainder of this step.

   Three lessons the author earned here, in one hour: absence inferred from a
   mistyped search is not absence; **presence in a header is not a capability**
   (the array constructor was declared, documented, and crashed); and a public
   comment can be an instruction that corrupts the object it describes.

   If this step collapses to less than a step, say so and move to step 2 rather
   than manufacturing work to match this file. A goal that is wrong about the
   world should lose.
2. **The scalar types, branded.** `c_int` and friends as
   `number & { readonly __c_int: unique symbol }`. **This step includes making a
   decision the document records as open** — whether foreign *parameters* are
   branded (casts at every call site, TypeScript catches `3.7` where an `int`
   goes) or plain `number` with the ABI in the binding table (no casts, faithful
   to C, which truncates without warning). Decide it, record it in the document
   with the reasoning, and say what would make you revisit.
3. **`libc.d.ts`, shipped and curated.** Hand-written, and its own header must
   say so. `java.d.ts` is the cautionary case: hand-written under a header
   claiming it was generated, which is why nobody noticed it was the
   second-largest blocker in its module.
4. **Opaque handles.** The `NTS2006 an object type with no layout` refusal,
   raised where a handle is *produced*. The smallest change with the largest
   reach: every C API is a handle API.
5. **LLVM `declare` lines for foreign functions.** The existing 311-row table is
   generated from clang's report of the runtime header and stays; this is a
   second source for the user's own declarations, whose types come from the
   TypeScript signature. Step 2 is its prerequisite.

## Explicitly out of scope

- **`Owned`/`Ref` and `ResourceFlow`.** Deferred *together*, and that pairing is
  deliberate: shipping the ownership vocabulary without the checker is worse
  than shipping neither, because a signature saying `Owned<Counter>` that
  nothing enforces invites trust it has not earned.
- **`CFn`**, structs by value, `Ptr`/`addrOf`, and the `nts bind --header`
  generator. GTK needs `CFn` and is therefore not reachable at the end of this
  goal. That is expected — the next goal writes itself.

## Definition of done

`examples/interop/c-from-ts` compiles and runs its scalar and handle arms, and
`examples/interop/ts-from-c` exercises a constructor and a generator. Both files
are checked in, so this is a thing to observe rather than a claim to make.

## Disciplines

These are not ceremony. Every one of them caught a real error on 2026-09-13.

- **Measure, do not reason.** Three of that day's findings came from someone
  *using* the compiler rather than reading it, and none were on anyone's list.
- **Both arms, and the arm that must fail.** A positive result alone cannot
  distinguish "it works" from "the mechanism was never reached". A header that
  is included and ignored passes every test that a header being used passes.
- **One variable per arm.** Four diagnoses were produced that day for one
  defect, each true about arms differing in something uncontrolled.
- **State a number's unit before comparing it.** "28,688 bytes per op" was read
  as per call; an op was 1,024 calls.
- **A gate verdict has three states**: `green`, `skipped` (`with-lock.sh` exits
  **75** — not a result), and `incomplete` (the log ends mid-run). Absence of
  `FAILED` distinguishes none of them. Use `with-lock.sh --wait` to queue.
- **Commit explicit paths** — `git commit -- <paths>`. Three sessions share the
  index, and `git add -A` swept another session's files into an unrelated commit
  three times that day.
- **A comment stating a precondition is a claim with an expiry date.**
  `fields.rs` said "there is no FFI that writes through a pointer here" and the
  interop work is what falsified it.

## Checkpoints: tell the Claude session

Do not wait to be asked, and do not batch. The point is that a wrong turn is
cheap to correct early and expensive later.

**Before starting each numbered step**, say what you are about to do and **what
would falsify it** — the arm you expect to fail if the approach is wrong. That
sentence is usually where a bad plan becomes visible.

**After each step**, send the measurement, both arms, and the commit sha.

**Immediately, mid-step, without finishing first:**

- a refusal turns into a *wrong answer* rather than a different refusal
- a precondition written in a comment turns out to be stale
- the behaviour depends on a **whole-program** fact — those lie to probes in
  both directions, and a defect can vanish when you minimise *or* when you add
  something unrelated
- an existing test or floor has to change to accommodate your work
- a measurement contradicts something in `native-interop.md`, which has been
  wrong before and is expected to be wrong again

## What to ask about, rather than decide alone

- **Any new runtime helper.** It lands in three tables — `hir::runtime`, the
  LLVM signatures, and the JVM's — and `bench-agree` has no allowance list, so
  a helper present in two of three **red-gates the third**. Sequence it so the
  inert half goes first.
- **Any representation change**, and anything touching `hir/` that a backend
  reads. Two representation changes were reverted that day after being green.
- **Shared tooling** — `tooling/gate/`, `tooling/conformance/`.
- **Anything the document records as open.** Two remain: what a throwing C
  callback does, and the step-2 casting decision above.

## The Claude session's role

Adversarial checking, not direction. It holds the measurements and the list of
things already tried and reverted, and its job is to refuse a conclusion whose
arms differ in more than one thing and to ask for the control. It has been wrong
repeatedly and corrected by measurement — treat its answers as claims to check,
exactly as it treats yours.

Send it claims, not questions. A question invites an opinion; a claim with arms
invites a check, and the check is the part that has value.

## 2026-09-14: `runtime/node` is open to this lane, by the user

The original scope said nothing about `runtime/node`, and the Claude session
read that silence as *not* permission and declined to grant it — correctly, as
it was never that session's to give. Asked directly, the user granted it:
**this lane may edit `runtime/node`.**

The request came from a real blocker rather than convenience. The host bridges
split three ways:

| | |
|---|---|
| prototype in `runtime/node`'s headers | 277 |
| prototype in `runtime/c`'s headers | 1 |
| defined in a `.c` file, prototype nowhere | **63** |
| in no `.c` file — genuinely JS-only shims | 13 |

and the 63 are C functions whose only defect is a missing declaration.
`fs.c:1891` defines `void nts_fs_access_async(NtsString *, double,
NtsHeader *)`; nothing declares it; `emit-c` guesses the prototype from call
operands and nothing compares the guess to the definition in the same link.

**Recommended sequencing, which is advice and not a boundary.** Add those 63
declarations to `fs.h` and its siblings first. It puts them in the same
mechanism as the other 277, invents no representation, and leaves 13 names to
classify instead of 76 — and 13 shims may not need an architecture at all.
Decide the manifest-versus-annotation question against the 13, not the 76.

**What permission does not change.** A third session owns that tree and works
in it. So:

- commit with **explicit paths** (`git commit -- <paths>`) — three sessions
  share one index and a path-scoped commit is the only kind that cannot sweep
  in someone else's work;
- pin before measuring across an edit — `tooling/gate/pinned.sh <sha>`, with
  `NTS_GATE_TREE`/`NTS_GATE_TARGET` to stay off the default tree;
- expect the addon sweep to have an opinion. It builds and **loads** all 22
  modules under `RTLD_NOW`, and `fs` is the module those 63 prototypes touch —
  that step is where a declaration disagreeing with its definition surfaces;
- write the commit message so the node lane can read the diff as a *repair*:
  the definitions already existed, only the declarations were missing, and
  `fs.c:1891` is the citation that says so.

**One control survives the grant and matters more because of it.** A bridge
whose authored ABI facts disagree with its C definition must fail loudly. With
both sides now editable, nothing stops the two being reconciled by changing
whichever is convenient; the arm that proves the mechanism works is the one
where they deliberately disagree and something notices.

Also open for that tree, found while measuring the above and belonging to
whoever owns it: `runtime/node/net/net.h` and `nts_net.h` **both define
`NTS_NODE_NET_H`**, so whenever both are included the second is skipped in
silence and 28 declarations vanish.
