# Provenance

The regexp parser and explicit-stack execution design were developed with
[QuickJS-ng libregexp.c at the existing pin](https://github.com/quickjs-ng/quickjs/blob/776150276b3657b90b0719755d5e111fa56a1a6d/libregexp.c)
as a reference. The TypeScript grammar tree and instruction layout are owned by
NTS; they do not implement QuickJS's bytecode ABI or embed its JS interpreter.

Unicode data is derived from the files already vendored at
`runtime/c/quickjs`, revision
`776150276b3657b90b0719755d5e111fa56a1a6d`. The generated file records the hashes
of those inputs. Updating that revision requires reviewing and regenerating the
regexp data together.

`QUICKJS-LICENSE` copies the vendored MIT notice. `UNICODE-LICENSE` copies the
Unicode License V3 notice from `libunicode-table.h`.
