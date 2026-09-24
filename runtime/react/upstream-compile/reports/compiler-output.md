# React Compiler output

The experiment builds `babel-plugin-react-compiler` directly from the same
pinned React checkout as the runtime. The source checkout is read-only; tsup
resolves pinned build dependencies from this directory and writes a disposable
CommonJS bundle under `generated/react-compiler`.

For `experiments/compiler-output/Counter.tsx`, upstream React Compiler emits
one `_c(6)` call. It also replaces the destructured `Props` parameter with an
unannotated identifier. With a checked `_c` returning `unknown[]`, raw output
has two strict TypeScript errors: the parameter is implicit `any`, and a cache
read of `unknown` cannot be used as the button callback.

The prototype recovery pass is fully mechanical for this fixture:

1. It matches the exported component to the original typed AST and restores
   `Props` on the synthesized parameter.
2. It uses a preliminary checker program to inspect values assigned to literal
   cache indices.
3. It rewrites `_c(6)` to
   `_c<[number, () => void, string, () => void, number, JSX.Element]>(6)`.
4. It runs a final strict check where `_c<T>` returns `T` and its declaration
   contains no `any`.

The recovered output has zero diagnostics. This validates an integration
direction, not a general implementation: aliases, unions, outlined functions,
multiple caches and slots with incompatible writes still need corpus testing.

Three checked-in goldens cover branching, effects and mapped lists. React
Compiler strips the exported component parameter annotation in all three. In
the list fixture it also outlines the map callback as `_temp(item)`, losing the
contextual `Item` annotation. The transformed AST preserves original byte
ranges: matching those ranges against the pre-transform TypeScript checker
recovers `Props` for all three component parameters and `Item` for the outlined
callback. Generated names are not used as identity.

React Compiler also emits unannotated evolving locals. Their declarations have
type `any` even under strict TypeScript, while their reaching assignments and
every use are concrete. The recovery pass now annotates the Counter's two such
locals as `() => void` and `JSX.Element`; it never inserts a sentinel value.

The recovered Counter runs as part of the exact-source upstream oracle. It
mounts, hits its `_c(6)` cache on unchanged props and invalidates the relevant
slots after a prop change. Feeding the identical checked TSX file to `nts hir`
lowers the captured callback and cache control flow, then reaches the expected
JSX refusal. This proves React Compiler output is entering NTS rather than only
passing a standalone TypeScript check.

The native runtime contract should treat `_c<const N>(N)` as a trusted React
Compiler intrinsic. It allocates or retrieves a stable component cache whose
size is constant. Build-time analysis assigns a representation to each literal
index. Sentinel initialization is an internal runtime state: generated code
only reads an output slot after its dependency guard proves that render wrote
it. The final application program sees typed slots and never observes the
sentinel as an unchecked dynamic value.

This preserves React Compiler's optimization. NTS consumes its ordinary
control flow and adds representation information that Babel does not need in a
JavaScript engine.
