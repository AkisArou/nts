# The Node profile

`node:*` modules, written in TypeScript, compiled by `nts`, with their native
half in C over libuv.

Status lives in [`docs/conformance/nodejs.md`](../../docs/conformance/nodejs.md):
what passes node's own tests, and separately what compiles.

## Layout

```
runtime/node/
  internal/           shared across modules: errors, validators, utf8, uv
  c/                  the native layer — one file per module, plus shared.c
  <module>/
    src/main.ts       the implementation
    tsconfig.json     what `nts emit-c` compiles
    bindings.node.mjs the native half, for the node-side run
    shape.mjs         the object node's tests see as `require('<module>')`
    test-pattern      a regex, when node does not name the tests `test-<module>-*`
    not-applicable    `file: reason`, for tests that assert on node's binary
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

**The native half is one `declare function`.** Compiled it is an extern linked
against `c/`; on node the declaration erases and the call becomes a global
lookup, which `bindings.node.mjs` supplies. One source, two targets, and
`nts check` is what compares them.

**libuv, not reimplementation.** The C calls the same library node calls, so
node's semantics are inherited rather than reimplemented and then tested for.

## Running the tests

```sh
tooling/conformance/check.sh <module> --ts   # node's tests, TypeScript on node
tooling/conformance/check.sh <module>        # node's tests, compiled .node addon
tsc -p runtime/node/tsconfig.json            # types, across the whole profile
```

The addon run is the gate: it tests the artifact that ships. `--ts` is the
interim gate for a module that does not compile yet, and running both tells a
compiler bug from an implementation bug — fails compiled, passes on node, is a
compiler bug.

## Adding a module

1. `src/main.ts`, transcribed from `third_party/node/lib/<module>.js`.
2. `tsconfig.json`, copied from a neighbour.
3. `bindings.node.mjs` for anything the module declares as native. Keep these
   trivial: they are a second implementation of the C, and only `nts check`
   compares them.
4. `shape.mjs` if `require('<module>')` is more than a bag of exports.
5. `test-pattern` if node's files are not named `test-<module>-*.js`.
6. Run `check.sh <module> --ts` and fix what it says.

Anything a test needs that we do not have goes in `not-applicable` **with a
reason**, or stays a failure. A conformance number nobody can audit is not
worth reporting.
