# The Node profile

`node:*` modules, written in TypeScript, compiled by `nts`, with their native
half in C over libuv.

Status lives in [`docs/conformance/nodejs.md`](../../docs/conformance/nodejs.md):
what passes node's own tests, and separately what compiles.

## Layout

```
runtime/node/
  internal/           shared TypeScript and native support
  <module>/
    src/main.ts       the implementation
    tsconfig.json     what `nts emit-c` compiles
    *.c, *.h          that module's libuv/native operations
    bindings.node.mjs the native half, for the node-side run
    shape.mjs         the object node's tests see as `require('<module>')`
    uses              sibling runtime modules that must share state in tests
    test-pattern      a regex, when node does not name the tests `test-<module>-*`
    extra-tests       additional files from Node's parallel suite
    test-suites       dedicated Node suite directories or exact files
    child-fixtures    helper programs allowed to re-enter the test runner
    not-applicable    `file: reason`, for genuine profile/integration exclusions
    test/*.js         focused coverage for mixed or runner-terminating upstream tests
```

## Four rules, and what each is for

**Faithful, not adapted.** Bodies are transcribed from node. Where the compiler
does not support a construct, the code keeps node's version and does not
compile yet. An earlier port rewrote `break` into a flag so it would compile;
that has to be unwound later, and while it is there the refusal list stops
measuring what is actually missing.

**Scaffolding is ours.** Node destructures its primitives from `primordials`
and hangs functions off object literals; ours are ordinary imports and exports.
`primordials` exists so node's library survives a program that reassigns
`String.prototype.slice`, and a compiled program has no such prototype.

**Each native operation is one `declare function`.** Compiled it is an extern
linked against the C files beside the module; on node the declaration erases
and the call becomes a global lookup, which `bindings.node.mjs` supplies. One
TypeScript implementation, two native targets, and
`tooling/conformance/check.sh` applies the same upstream suite to each.

**libuv, not reimplementation.** The C calls the same library node calls, so
node's semantics are inherited rather than reimplemented and then tested for.

## Running the tests

```sh
tooling/conformance/check.sh <module> --ts   # node's tests, TypeScript on node
tooling/conformance/check.sh <module> --ts --sabotage  # empty subject must fail
tooling/conformance/check.sh <module>        # node's tests, compiled .node addon
tsc -p runtime/node/tsconfig.json --noEmit   # types, across the whole profile
```

The addon run is the gate: it tests the artifact that ships. `--ts` is the
interim gate for a module that does not compile yet, and running both tells a
compiler bug from an implementation bug — fails compiled, passes on node, is a
compiler bug.

## Adding a module

1. `src/main.ts`, transcribed from `third_party/node/lib/<module>.js`.
2. `tsconfig.json`, extending the shared Node-profile configuration.
3. A C/header pair for each declared native operation, using libuv or the
   platform facility Node uses.
4. `bindings.node.mjs` for anything the module declares as native. Keep these
   trivial: they are a second implementation of the C, and only `nts check`
   compares them.
5. `shape.mjs` if `require('<module>')` is more than a bag of exports.
6. `test-pattern` if node's files are not named `test-<module>-*.js`.
7. Run `check.sh <module> --ts` and fix what it says.

Anything a test needs that we do not have goes in `not-applicable` **with a
reason**, or stays a failure. A conformance number nobody can audit is not
worth reporting.

`not-applicable` describes the **test**, not an unfinished implementation. Use
it only when the assertion fundamentally depends on a language non-goal from
`docs/conformance/typescript.md` §13, or on instrumentation owned by a Node
module outside the supported profile. A child process is not by itself an
exclusion: same-suite and declared fixture children are routed back through the
runner so that they retain the substituted module. A host-binary subprocess is
excluded only when its program cannot be routed structurally (for example,
`node -e`) or when Node's executable is itself the subject. Prefix the reason
with `language non-goal`, `cross-module integration`, or `host-binary
subprocess` so the distinction is visible. A temporary implementation gap
may be skipped only when its reason names the exact compiler/runtime blocker;
it remains required work and must never be relabeled as a permanent non-goal.
If one file mixes an excluded assertion with supported behavior, its reason
must name the independent test that keeps the supported behavior covered.

Focused files under `test/` are reported as `local/<name>` and must cite the
exact pinned upstream test or library source they preserve. They are a last
resort for a mixed file, for an operation such as `process.exit()` that needs
an outer observer, or for a public operation the upstream suite never invokes;
they are not a replacement for an ordinary upstream failure.
