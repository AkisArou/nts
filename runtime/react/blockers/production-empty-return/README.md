# Implicit undefined returns in production stubs

## Reproduction

```sh
npm run --prefix runtime/react blockers:probe
```

Production flag folding turns several development-only React helpers into empty
functions whose declared return is `string | void` or `boolean | void`.
TypeScript defines falling through as returning `undefined`. NTS emits a
non-void HIR signature and a `fell through` block, so the prepared program fails
verification even though it reports no refused construct for the fixture.

The lowering should emit the correct undefined/tagged return for an implicit
fallthrough. Source code must not add `return undefined` merely to accommodate
the current compiler; the empty body is valid TypeScript and preserves the
pinned production source shape.
