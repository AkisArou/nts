# Static native library namespaces (#978)

The native product's Rust config did not deserialize `prefix`. SourceSymbols
chose unprefixed public names, and a static link could put a TypeScript
`error` in the host executable's namespace, preempting libc throughout the
process. The prefix is now resolved before emission and frozen once in the
source symbol plan shared by C and LLVM. Header declarations, publication
lists, definitions, references and the library constructor consume that plan.

An explicit prefix is validated with its value in the refusal. The default
normalizes product-name punctuation to `_` and escapes an empty/invalid initial
or reserved namespace with `product_`. Both routes validate an ASCII identifier
fragment, which is always followed by `_` and a name: `main` and `int` are valid,
and a product named `int` gives `int_error`. `probe-llvm` and `probe_llvm` both give `probe_llvm`; explicit
prefixes distinguish this deliberate default collision. The resulting public name is
`<prefix>_<existing C spelling>`. Raw emissions and other product kinds keep
their names; shared-library prefix support is tracked by #1005.

## Consumer inventory

There are 23 static-product configs under `tests/interop`: 22 have C consumers,
and `chromium-surface` checks building and archive membership without calling
source exports. The workspace fixture contributes one more static product.
Every migrated C consumer includes the generated `program.h`; none keeps a
hand-written declaration of a generated export. Native library declarations
such as `pollfd_size` are unrelated and retain their native names.

| Fixture | Static ABI prefix | Consumer change |
|---|---|---|
| c-from-ts | default `lib` | generated function names |
| chromium-surface | defaults `app`, `appLlvm` | build-only; no caller to rename |
| library-module-state | default `lib` | generated function name |
| native-bigint-constants | explicit `lib`, both backends | generated function names |
| native-buffer | default `lib` | generated function name |
| native-callback | default `lib` | generated function names |
| native-closure | default `lib` | generated function names |
| native-copy | default `lib` | generated function names |
| native-epoll | default `lib` | generated functions and initializer |
| native-fd | default `lib` | generated function calls and pointers |
| native-inet | default `lib` | generated functions and initializer |
| native-open | default `lib` | generated functions and initializer |
| native-pointer-bits | explicit `lib`, both backends | generated function names |
| native-pointer-constants | explicit `lib`, both backends | generated function names |
| native-poll | default `lib` | generated function names |
| native-private-names | explicit `lib`, both backends | generated function name; original caller retained separately for raw NoGC emission |
| native-rusage | default `lib` | generated function names |
| native-stat | default `lib` | generated function names |
| native-string | default `lib` | generated function names |
| native-uname | default `uname` | generated function names |
| native-void-pointer | explicit `lib`, both backends | generated function names |
| ts-from-c | default `lib` | generated function names; header-local helpers and type aliases retain their names |
| windows-resource-atoms/overloads | explicit `lib`, both backends | generated function names |
| tests/workspace/apps/linux-brownfield | default `sdkStatic` | static config uses its default; shared config unchanged |

The paused Chromium runtime has separate consumers outside this inventory.
`runtime/chromium/embedder/probe.c` spells generated calls directly,
`embedder/program/check.ts` checks their old spellings, and
`tooling/chromium/app.ts` recognizes the old initializer spelling in its
module-state guard. The coordinator deferred their migration to #1006 under
the paused Chromium group #581. The owed rule names their standalone `verify.ts` workflow;
the full-check executable step list contains no Chromium execution step.
