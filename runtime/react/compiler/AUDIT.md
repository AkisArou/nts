# Audit: the upstream Rust React Compiler as the React lane's memoizer

Audited: `/home/akisarou/.cache/nts-react/upstream` at 1d34f91d (2026-09-09),
crates `compiler/crates/react_compiler_*` (12 crates, 77,695 lines of Rust).
Paths below are relative to `compiler/crates/` unless they start with
`compiler/` or `/`. "Verified" means I ran it. "Read" means I only read the code.
Scratch work is in `/home/akisarou/.cache/nts-react/rc-audit/`.

## Verdict

> **Update:** TYPED-OUTPUT.md measures a simpler design for step 5. It restores
> types on upstream's own output by span, with no pass-list copy and no codegen
> of our own. It keeps this document's frontend and runtime steps.

The preferred design is feasible: run the upstream analysis up to the
`ReactiveFunction`, then do our own typed codegen. It works with today's crates
and needs no upstream patch. Verified: a 150-line driver
(`rc-audit/driver/src/main.rs`) links the crates and calls the passes one at a
time. It gets the `ReactiveFunction` with every scope, dependency, declaration
and temporary still carrying a source span. It then hands the function to
upstream's own `codegen_function`, and the output is byte-identical to
`compile_program` on two components. The only difference is the
`useMemoCache` → `_c` rename that `compile_program` does afterwards.

Hook points:

- **Stop before codegen.** Every pass is a `pub fn` in its crate, and the
  pipeline is a flat list of calls (`react_compiler/src/entrypoint/pipeline.rs:37-1175`).
  Codegen is one separate call, `react_compiler_reactive_scopes::codegen_function`
  (`pipeline.rs:1052`), whose input is `(&ReactiveFunction, &mut Environment)`.
  All HIR, scope and type tables are `pub` fields on `Environment`
  (`react_compiler_hir/src/environment.rs:41-101`).
- **Types from tsgo reach our codegen through source spans, not through the
  compiler.** Each `Identifier` has a `loc` (`react_compiler_hir/src/lib.rs:990-998`):
  - a temporary's `loc` is the span of the expression it holds;
  - a named variable's `loc` is its declaration site;
  - a promoted temporary (`t1`) is the scope output's own expression;
  - a dependency and each step of its path carry the span of the access (`sel?.name`).

  Our codegen looks each span up in tsgo's typed AST.
- **Per-function fallback exists upstream.** Verified: a component that breaks
  the Rules of Hooks is left verbatim, with its TypeScript types, while its
  neighbour compiles. The same `Result` boundary applies in our driver:
  any `Err` from a pass means "leave this function uncompiled".

Risks, in order:

1. **No frontend fits us as-is.** The only input format in this checkout is
   Babel-shaped JSON plus a `ScopeInfo` that a JS helper (`scope.ts`) builds
   from Babel's scope tracker. The OXC and SWC frontends that `TODO.md`
   describes were deleted upstream on 2026-06-11 (commit d3da2008, "Remove OXC
   and SWC plugins in favor of them being handled by those projects"). So
   `TODO.md`'s "OXC 1704/1795" row describes code that is no longer in the
   repository. We either run Babel in node at build time (verified working) or
   write a tsgo → `react_compiler_ast` converter plus a `ScopeInfo` builder in
   Rust. The deleted OXC crate did the same job in about 3,400 lines, which gives
   the size of that work.
2. **We would own a copy of the pass list.** Function discovery (component/hook
   detection, `'use no memo'`, suppressions, gating) is private in
   `program.rs` (`find_functions_to_compile` :2026, `get_react_function_type`
   :1044). The single-function entry `compile_fn` is `pub`, but it runs codegen
   internally. Stopping before codegen means copying roughly 60 pass calls, and
   any pass that upstream adds, removes or reorders silently diverges in our
   copy. Mitigation: a parity test that runs our staged pass list plus
   upstream `codegen_function` against `compile_program` over the upstream
   fixture corpus.
3. **Lowering erases some TypeScript facts we need.**
   - Explicit call type arguments are dropped (`useState<Item | null>(null)` →
     `useState(null)`, verified).
   - `x!` and `f<T>` lower to the same place as `x` and `f`
     (`react_compiler_lowering/src/build_hir.rs:2233`, `:2249`), so a span
     lookup for the temporary returns the pre-narrowing type.
   - Type annotations on locals keep only the node-kind name, e.g.
     `"TSStringKeyword"` (`build_hir.rs:261-268`).
   - Our codegen must take all of this from tsgo, never from the HIR.
4. **The runtime owes us a typed memo cache.** Today the lane has
   `useMemoCache(size): unknown[]`
   (`runtime/react/packages/react/src/ReactHooks.ts:148`). A typed cache class
   needs a hook that stores one object per fiber.

## 1. Public entry points

- **`react_compiler::entrypoint`**
  (`react_compiler/src/entrypoint/mod.rs`) re-exports three modules:
  `compile_result::*`, `plugin_options::*` and `program::*`.
- **`compile_program`** is the whole-program entry point:
  `pub fn compile_program(file: File, scope: ScopeInfo, options: PluginOptions) -> CompileResult`
  (`program.rs:3754`).
  - Input 1: `react_compiler_ast::File`. This is a Rust model of **Babel's** AST
    (`react_compiler_ast/src/lib.rs:19`), deserialized from Babel JSON by the
    napi binding (`compiler/packages/babel-plugin-react-compiler-rust/native/src/lib.rs:26`,
    `compile(ast_json, scope_json, options_json)`).
  - Input 2: a `ScopeInfo` (`react_compiler_ast/src/scope.rs:105`) holding
    scopes, bindings, and `refNodeIdToBinding` / `nodeIdToScope` maps keyed by
    a `_nodeId` that the JS side stamps on every Identifier
    (`react_compiler_ast/src/common.rs:179`).
  - Input 3: `PluginOptions` (`plugin_options.rs:37`), which is serde-deserializable
    and embeds `EnvironmentConfig`.
  - Output: `CompileResult::{Success{ast: Option<File>, events, renames, ..}, Error{..}}`
    (`compile_result.rs:87`). The output is a Babel AST, not text. **There is no
    Rust printer**, so upstream prints on the JS side.
- **SWC and OXC** have no entry point. Their crates are gone (see Verdict risk 1).
- **Single function:** `pipeline::compile_fn(func: &FunctionNode, fn_name, &ScopeInfo, ReactFunctionType, CompilerOutputMode, &EnvironmentConfig, &mut ProgramContext) -> Result<CodegenFunction, CompilerError>`
  (`pipeline.rs:37`). It is `pub`, and `ProgramContext::new` is `pub`
  (`imports.rs:81`). It still runs codegen internally.
- **Stage by stage: yes.** Each pass is exported:
  - `react_compiler_lowering::lower` (`build_hir.rs:4271`)
  - `react_compiler_ssa::{enter_ssa, ..}`
  - `react_compiler_typeinference::infer_types`
  - `react_compiler_inference::*` (14 fns)
  - `react_compiler_optimization::*`
  - `react_compiler_reactive_scopes::{build_reactive_function, prune_*, rename_variables, codegen_function, ..}`
    (`react_compiler_reactive_scopes/src/lib.rs`)

  Our driver copies the list from `run_pipeline_passes` (`pipeline.rs:1644-1795`,
  which upstream uses for outlined functions). The main path, `compile_fn`, runs
  a few more validations and `outline_jsx`. A production copy should follow
  `compile_fn`. Verified: our driver obtains the `ReactiveFunction`, then
  `codegen_function` reproduces `compile_program` output (section 7).
- **The `ReactiveFunction`** (`react_compiler_hir/src/reactive.rs`) is a tree:
  - It contains `Instruction`, `Terminal`, `Scope(ReactiveScopeBlock{scope, instructions})`
    and `PrunedScope` nodes.
  - Scope data lives in `env.scopes[scope]`
    (`ReactiveScope{dependencies, declarations, reassignments, early_return_value, loc}`,
    `react_compiler_hir/src/lib.rs:1326-1372`).
  - Nested function expressions stay as HIR in `env.functions`, and codegen
    builds their reactive form on demand
    (`codegen_reactive_function.rs:2760`). A typed codegen has to do the same.
- **Codegen is a separable pass.** `codegen_function(&ReactiveFunction, &mut Environment, unique_identifiers, fbt_operands) -> Result<CodegenFunction, _>`
  (`codegen_reactive_function.rs:194`). It is the last call. Nothing after it
  except import insertion and function replacement, which happen in
  `program.rs`.
- **Debug output:** `debug_reactive_function(&rf, &env)` gives the upstream
  text dump (`print_reactive_function.rs:609`). `PluginOptions.__debug=true`
  collects a per-pass dump in `ordered_log`.

## 2. Source locations

- **Types:**
  - `react_compiler_diagnostics::SourceLocation{start, end: Position{line, column, index: Option<u32>}}`
    (`react_compiler_diagnostics/src/lib.rs:100-112`).
  - `index` is a **UTF-16 code-unit offset**, the same as Babel's
    (`react_compiler_validation/src/source_offsets.rs:1-10`).
  - Lowering copies `line`, `column` and `index` straight from the AST
    (`build_hir.rs:30-50`).
  - The AST's `BaseNode` also has `start`, `end` and `_nodeId`
    (`common.rs:141-180`), but the HIR keeps only the `SourceLocation`.
  - No node id survives into the HIR.
- **Carriers:**
  - `Instruction.loc` (`lib.rs:520`)
  - `Place.loc` (`:982`)
  - `Identifier.loc` (`:990`)
  - `ReactiveScope.loc` (`:1326`)
  - `ReactiveScopeDependency.loc` (`:1351`)
  - `DependencyPathEntry.loc` (`:971`)
  - `ReactiveScopeEarlyReturn.loc`
  - every `InstructionValue` variant has its own `loc`
- **Verified on two components** (`rc-audit/run2.txt`, `run3o.txt`): every
  lvalue, dependency, declaration and parameter printed a span whose source
  slice is the expected text. Examples:
  - a temporary `useState<number>(0)` at 174..193;
  - the promoted scope output `t1` spans `() => setCount(count + step)`;
  - dependency `sel` with optional path `.name` spans `sel?.name`;
  - the destructured props parameter `t0` spans `{ label, step }: CounterProps`.
    This Babel span includes the annotation.
  - the outlined `_temp`'s parameter spans `it: Item` (pre-codegen `HirFunction`
    in `env.get_outlined_functions()`).
- **Destructured params:** the compiler creates a promoted temporary with the
  pattern's span (`build_hir.rs:6158-6171`). tsgo's parameter node splits the
  name from the type, so we should map parameters **by index**, not by span.
- **Compiler-created temporaries:**
  - Normally created through `make_temporary(loc)` (`hir_builder.rs:721`) with
    the span of the source expression.
  - `extract_scope_declarations_from_destructuring` copies the original's type
    and span (`extract_scope_declarations_from_destructuring.rs:120-139`).
  - The early-return machinery creates temporaries and instructions with
    `loc: None` (`propagate_early_returns.rs:209-341`). Their types are fixed by
    construction: a sentinel symbol, or the function's return type.
  - `outline_jsx` builds `loc: None` nodes, but it is off by default
    (`environment_config.rs:217`).
- **Outlined functions:**
  - Before codegen, the outlined `HirFunction` keeps original spans (verified).
  - `compile_program` re-lowers the printed outline from a synthetic AST with
    fake positions (`pipeline.rs:1177-1231`, `build_outlined_scope_info`). After
    that the spans are gone, which matters only for the fallback design.
  - Outlining can be turned off with `EnvironmentConfig.enable_function_outlining=false`
    (default `true`, `environment_config.rs:216`). Verified: the callbacks are
    then memoized in place instead of becoming `_temp`.
- **One gap:** the index is only as good as the input. The Babel 7.14 parser
  installed at the upstream repo root omits `loc.start.index`, and every
  `index` came out `None` (`run1.txt`). My converter fills it from
  `node.start`/`node.end` (`rc-audit/to-json.mjs`). A modern Babel emits it
  itself. Our own frontend must fill it, in UTF-16 units.

## 3. Types

- **HIR keeps almost no TypeScript type information** (read, then confirmed by
  output):
  - `DeclareLocal` / `StoreLocal.type_annotation: Option<String>`
    (`lib.rs:572-587`) holds only the annotation's node kind, e.g.
    `"TSStringKeyword"` (`build_hir.rs:261`). Codegen emits declarations
    without annotations. Verified: `const title: string` became `const title`.
  - `TypeCastExpression` keeps the full annotation JSON
    (`lib.rs:632-641`, `build_hir.rs:2206-2265`). Verified: `title as string`
    survived codegen.
  - `HirFunction.return_type_annotation` is always `None` (`build_hir.rs:6264`).
  - Call and `new` type arguments are not modeled at all
    (`InstructionValue::CallExpression{callee, args, loc}`, `lib.rs:613`).
  - Parameter annotations of nested functions and generic type parameters are
    dropped by codegen. Verified: `(it: Item) =>` became `_temp(it)`, and
    `(e: MouseEvent) =>` became `e =>`.
  - Non-null `x!` and instantiation expressions `f<T>` are erased in lowering
    (`build_hir.rs:2233`, `:2249`).
  - Type annotations in the AST are opaque `RawNode` JSON (`common.rs:17`).
- **`react_compiler_typeinference::infer_types`** (`infer_types.rs:33`) does
  unification over the compiler's own small lattice:
  - `Type::{Primitive, Function{shape_id, return_type}, Object{shape_id}, TypeVar, Poly, Phi, Property, ObjectMethod}`
    (`lib.rs:1290`).
  - Shapes are things like `BuiltInProps`, `BuiltInUseState`, `BuiltInSetState`,
    `BuiltInJsx`, `BuiltInArray`, and generated ids.
  - It exists to drive hook detection, effect and aliasing inference, and
    pruning. It is not a TS type system. In our run, `label` (a `string` prop)
    stayed an unresolved `TypeVar`, while `count` resolved to `Primitive`
    through `useState`'s shape.
  - `lower_type_annotation` (`build_hir.rs:6751`) maps only primitive keywords
    and `Array` to lattice types.
- **`ModuleTypeProvider`:**
  - `EnvironmentConfig.module_type_provider: Option<IndexMap<String, TypeConfig>>`
    (`environment_config.rs:89`) is a pre-resolved map from module specifier to
    a `TypeConfig` tree (`type_config.rs`: `Object{properties}`,
    `Function{positional_params, rest_param, callee_effect, return_type, return_value_kind, aliasing, ..}`,
    `Hook{..}`, `TypeReference`).
  - `get_global_declaration` consults it for every non-React import
    (`environment.rs:468-600`).
  - `default_module_type_provider.rs:20` hard-codes three incompatible
    libraries.
  - `custom_hooks: FxHashMap<String, HookConfig>` (`:84`) configures hooks by
    name.
- **Feeding it from tsgo is possible for imports.** For each imported binding
  we could derive "is a hook", "returns frozen or mutable", "is a function whose
  result is primitive", and so on, and pass them in as `TypeConfig`. This would
  improve memoization precision, for example primitive-returning helpers.
- **No hook supplies per-identifier types for local values.** The
  `Environment.types` and `identifiers` vectors are `pub`, so seeding between
  `lower` and `infer_types` is mechanically possible. Read, not tested:
  `resolve_identifier` (`infer_types.rs:992`) keeps a non-`TypeVar` slot. But
  seeded slots do not take part in unification, so they would not propagate.
  None of this is needed for our design: the lattice decides *what* to memoize,
  and tsgo decides *how the output is typed*.

## 4. The memo cache

- **Emission** is all in `react_compiler_reactive_scopes/src/codegen_reactive_function.rs`.
- **Preface:** `const $ = useMemoCache(N)` is built in `codegen_function` at
  `:218-240`, when `memo_slots_used != 0`. An optional Fast Refresh block
  (`:242-400`) takes slot 0 for a source hash when
  `enable_reset_cache_on_source_file_changes`. `program.rs:2716` renames
  `useMemoCache` to the `_c` import from `react/compiler-runtime`.
- **Slots** come from a per-function counter, `alloc_cache_index` (`:712`), in
  codegen order. Within each scope (`codegen_reactive_scope`, `:917`):
  1. Dependencies, sorted by `compare_scope_dependency` (`:4081`), one slot each
     (`:938`). Each is compared with `$[i] !== dep` and stored after recompute.
  2. Declarations, sorted (`:988`).
  3. Reassignments (`:1020`).
  4. A scope with no dependencies instead tests its first output slot:
     `$[first] === Symbol.for("react.memo_cache_sentinel")` (`:1030-1047`).
  5. The `else` branch reloads the outputs.
  6. Early returns go through a second sentinel,
     `react.early_return_sentinel` (`:1128-1160`).
  Nested function bodies get their own `Context`, so slot numbering is per
  compiled function.
- **What a typed cache class needs** (read, inferred): nothing in the passes
  before codegen changes, because slot assignment happens *inside* codegen.
  Our codegen allocates slots itself and knows, for every slot, what it holds:
  - a dependency: an identifier plus a property path, with a span → the tsgo
    type of the dependency expression;
  - a declaration or reassignment: an identifier → the tsgo type at its
    declaration.

  The rest:
  - Emit a class per component with one typed field per slot, plus a
    filled-bitset that replaces the "no deps" sentinel test.
  - Replace the early-return sentinel with an `Option`-style local or a flag.
  - Add a runtime hook that returns one instance per fiber, occupying the same
    hook slot `_c` did (first hook call).
  - Keep `!==` semantics. Upstream compares with `!==`, so a `NaN` dependency
    always recomputes. Switching to `Object.is` would be a behavior change,
    probably harmless, but it should be a deliberate choice.
- **Our codegen also has to do what `codegen_function` does besides the cache:**
  - temporary inlining (the `Temporaries` table);
  - the `let` declarations for scope outputs;
  - labels, `for-in` / `for-of`, JSX and fbt;
  - hook guards and instrumentation (both off by default).

  That is about 4,400 lines upstream, but most of it is plain AST emission. We
  would emit TSX text or our own IR from the same tree.

## 5. Frontends

- **Babel JSON plus `scope.ts`** is the only frontend in the tree
  (`compiler/packages/babel-plugin-react-compiler-rust/src/{BabelPlugin,bridge,scope}.ts`).
  Verified working from Rust: `rc-audit/to-json.mjs` parses TSX with
  `@babel/parser` (`typescript` and `jsx` plugins), runs upstream's
  `extractScopeInfo` (node 24 strips types from `scope.ts`), and writes the two
  JSON files the Rust side deserializes.
  - Cost: a node process and a Babel parse per file at build time.
  - Babel's TypeScript parser accepts all TypeScript syntax. Lowering handles
    `as`, `satisfies`, `<T>x`, `!`, instantiation expressions, and type-only
    declarations.
- **OXC and SWC:** the in-repo crates were deleted in d3da2008 (2026-06-11).
  - The deleted OXC crate had `convert_ast.rs` at 2,896 lines, `convert_scope.rs`
    at 535 lines, and `convert_ast_reverse.rs` at 1,942 lines. It can be read at
    the parent commit, b49e0415.
  - `TODO.md`'s SWC/OXC rows and file references predate that removal and are
    stale in this checkout.
  - Whether oxc or swc now ship their own integration is an open question; I
    did not check their repositories.
- **tsgo → `react_compiler_ast` in Rust** is the recommended long-term frontend.
  - Build the Rust structs directly, with no JSON.
  - Set `BaseNode.start/end/loc(index)` in UTF-16 units and `_nodeId` = the
    tsgo node id.
  - Build `ScopeInfo` from tsgo's symbol resolution.
  - Emit type annotations as minimal `RawNode` JSON; the compiler reads only
    the node kinds (`program.rs:928` `is_valid_props_annotation`, `build_hir.rs:6751`).
  - Benefit: the span a HIR identifier carries is a span in the very AST whose
    types we already have, so there is no second parser and no drift between
    parsers.
  - Size: the OXC converter is the reference, about 3.4k lines forward.
    Reverse conversion is not needed for the preferred design.
- **Parsing with OXC ourselves** would still need the same converter (to Babel
  shape) and a second parse that disagrees with tsgo on nothing but costs time.
  It has no advantage over converting from tsgo.

## 6. Cost of tracking upstream

- **Public surface** is large and low-level, and nothing is sealed. Counted from
  `pub fn` / `pub struct|enum` / `pub field` lines:

  | Crate | `pub fn` | Types | `pub` fields |
  | --- | ---: | ---: | ---: |
  | `hir` | 173 | 119 | 258 |
  | `ast` | 39 | 212 | 512 |
  | `lowering` | 63 | — | — |
  | `reactive_scopes` | 26 | — | — |
  | `react_compiler` | 42 | — | — |
  | the pass crates (together) | about 50 | — | — |

  Every internal representation change is a breaking change for us.
- **Churn:** 32 commits touched `compiler/crates` between the port landing
  (03e77555, 2026-06-09) and 2026-09-22. That is roughly 9 a month (GitHub API;
  the local clone is shallow).
  - The largest were structural: raw-JSON `RawNode` (b49e0415), AST returned by
    value (ae6fe8a3), OXC/SWC removal, "move compiled function bodies into AST
    instead of cloning" (d04798f2), and a WTF-16 `JsString` (0038f63c).
  - The rest are semantic fixes, ported in lockstep with the JS compiler.
  - 7 crate commits landed after our pin (2026-09-11 to 2026-09-22).
- **Published:** `react_compiler` and its sibling crates are on crates.io at
  0.1.0 (2026-09-03), plus 0.0.1-oidc.* pre-releases. The workspace at our pin
  still says 0.0.1-oidc.0. Pre-1.0, so no stability promise.
- **Tests:** `cargo test --workspace --exclude react_compiler_napi --no-fail-fast`
  passed 49 unit tests with 0 failures (verified, `rc-audit/cargo-test.log`).
  The parity corpus (1,802 fixtures) runs through the JS harness
  `compiler/scripts/test-e2e.ts`, which I did not run.
- **Estimate:** per upstream bump, re-sync our copied pass list against
  `compile_fn`, fix compile errors in our codegen from HIR shape changes, and
  rerun a parity test. Pin a commit and bump deliberately.

## 7. Practical check (verified)

Build: `cd compiler && CARGO_TARGET_DIR=/home/akisarou/.cache/nts-react/rc-target cargo build -p react_compiler`
succeeded (`Finished dev in 10.89s`; dependencies were already cached).

Driver: `rc-audit/driver/` is a standalone crate with path dependencies on the
upstream crates.

1. Lower the exported component.
2. Run the `run_pipeline_passes` list up to `rename_variables` /
   `prune_hoisted_contexts`.
3. Print `debug_reactive_function`, then a table of params, scopes,
   dependencies, declarations and lvalues with spans and source slices.
4. Run upstream `codegen_function`.
5. Separately run `compile_program` on the same input.

Output ASTs are printed with `@babel/generator` (`rc-audit/print.mjs`).

Commands:

```
cd /home/akisarou/.cache/nts-react/rc-audit
node to-json.mjs Counter.tsx counter          # Babel JSON + ScopeInfo
../rc-target/debug/rc_driver counter Counter.tsx > run2.txt
node print.mjs staged.fn.json                 # (b1) staged pipeline + upstream codegen
node print.mjs program.out.json               # (b2) compile_program
```

Input `Counter.tsx`: typed props `{label: string; step: number}`,
`useState<number>(0)`, an `onClick` arrow, `const title: string`,
`title as string`, and JSX.

Excerpt of (a), from `run2.txt`:

```
param t0$34 type=Object{BuiltInProps} idx=113..142 `{ label, step }: CounterProps`
instr #5 lvalue <temp>$40 type=Object{BuiltInUseState} idx=174..193 `useState<number>(0)`
scope @1 range=[8,11) idx=213..241 `() => setCount(count + step)`
  dep  count$41 type=Primitive decl-site idx=155..160, use idx=228..233
  dep  step$36  type=Primitive decl-site idx=122..126, use idx=236..240
  decl t1$44 type=Function{BuiltInFunction} idx=213..241
scope @2 range=[22,25) idx=304..390 `<button onClick={onClick} title={title as string}>...`
  dep onClick$50, t2$59 (`title as string`), label$35 (TypeVar unresolved), count$41
  decl t3$63 type=Object{BuiltInJsx}
```

(b), the generated code. The staged output and `compile_program` are identical
except that `useMemoCache(8)` becomes `_c(8)`:

```js
export function Counter(t0) {
  const $ = _c(8);
  const { label, step } = t0;
  const [count, setCount] = useState(0);
  let t1;
  if ($[0] !== count || $[1] !== step) {
    t1 = () => setCount(count + step);
    $[0] = count; $[1] = step; $[2] = t1;
  } else { t1 = $[2]; }
  const onClick = t1;
  const title = `${label}: ${count}`;
  const t2 = title as string;
  let t3;
  if ($[3] !== count || $[4] !== label || $[5] !== onClick || $[6] !== t2) {
    t3 = <button onClick={onClick} title={t2}>{label} {count}</button>;
    $[3] = count; $[4] = label; $[5] = onClick; $[6] = t2; $[7] = t3;
  } else { t3 = $[7]; }
  return t3;
}
```

The output shows the type loss the lane has to repair. `: CounterProps`,
`<number>` and `: string` are gone, and `as string` stays.

`List.tsx` has `useState<Item | null>(null)`, `items.map((it: Item) => ...)`,
`(e: MouseEvent) =>`, `sel?.name`, and default outlining. Its output is in
`run3o.txt`, `program-list.js` and `staged-list.js`:
- the staged function equals `compile_program`'s, again modulo `_c`;
- `_temp(it)` is emitted untyped;
- the dependency path `sel?.name` carries its own span;
- the pre-codegen outlined function's parameter keeps the span `it: Item`.

With `enable_function_outlining=false` there is no `_temp`, and the callback is
memoized in place (`run3.txt`).

`Mixed.tsx`, with `panicThreshold: "none"`: `Bad` calls a hook conditionally,
emits a `CompileError` event with `fnLoc`, and is left verbatim with its types.
`Good` compiles.

Caveats of the check:
- The installed root Babel is 7.14.3, which omits `loc.*.index`, so
  `to-json.mjs` fills it from `start`/`end`.
- The driver slices source by byte, which is correct only for ASCII input.
- The driver's pass list is `run_pipeline_passes`, not the fuller `compile_fn`
  list.

## Recommended integration plan

1. **Dependencies.** Depend on `react_compiler_ast`, `_hir`, `_diagnostics`,
   `_lowering`, `_ssa`, `_typeinference`, `_inference`, `_optimization`,
   `_validation` and `_reactive_scopes`, pinned to one upstream commit (git
   dependency or vendored). Use the umbrella `react_compiler` crate only for
   `compile_program` in the parity test and possibly for function discovery
   (below). It all builds on our toolchain (cargo 1.98.1, edition 2024).
2. **Frontend: a tsgo → `react_compiler_ast` converter** in a new crate beside
   the React lane.
   - Input: the tsgo snapshot we already receive.
   - Output: a `File` whose nodes carry UTF-16 `loc.index`, `start` and `end`,
     and `_nodeId` = tsgo node id.
   - Also output a `ScopeInfo` built from tsgo symbol resolution.
   - Annotations become minimal `RawNode`s. The deleted `react_compiler_oxc`
     (`convert_ast.rs`, `convert_scope.rs` at b49e0415) is the template.
   - Until the converter exists, run Babel plus `scope.ts` in node (verified
     path) and map spans to tsgo nodes by offset.
3. **Function selection.** Either:
   - call `compile_program` once in lint mode (`noEmit`) to learn which
     functions upstream would compile (`CompileSuccess.fnLoc`), and treat
     anything else as uncompiled; or
   - port `find_functions_to_compile` and `get_react_function_type` (private,
     about 600 lines) and propose upstream make them `pub`.

   The first option needs no fork.
4. **Analysis.** Per selected function, run a copy of `compile_fn`'s pass list
   (`pipeline.rs:37-1050`) with `enable_function_outlining=false` and
   `enable_jsx_outlining=false`. This means no `_temp` functions to type. Stop
   after `prune_hoisted_contexts` and
   `validate_preserved_manual_memoization`. Any `Err`, or
   `env.has_errors()`, means leave the function exactly as written.
5. **Typed codegen.** A new pass over `(&ReactiveFunction, &Environment)`.
   - Build a span → tsgo node index for the function once.
   - Type each place as follows:

     | What | Typed from |
     | --- | --- |
     | named identifier | its declaration's tsgo symbol (`declaration_id` → first `Identifier.loc`) |
     | temporary | the tsgo type of the expression at `Identifier.loc` |
     | dependency | the tsgo type of the access expression at `dependency.loc` or the last path entry's `loc` |
     | parameter | by index from the tsgo signature |
     | early-return temporary | the function's return type |

   - Re-apply the facts lowering erased, from tsgo: explicit type arguments at
     call spans, non-null narrowing (take the type of the `x!` node, not `x`),
     and nested functions' parameter annotations and type parameters.
   - Emit TSX text with explicit annotations, a per-component cache class (one
     typed field per slot plus a filled bitset), and the runtime hook call. Feed
     that text back through tsgo and nts.
   - This keeps the checker as the judge. If any type is unnameable (for
     example an inaccessible local type) or tsgo rejects the regenerated
     function, drop back to the original source for that function.
6. **Runtime.** Add a dispatcher entry next to
   `useMemoCache(size): unknown[]`
   (`runtime/react/packages/react/src/ReactHooks.ts:148`) that returns a
   per-fiber object created once, e.g. `useMemoCacheObject<T>(create: () => T): T`.
7. **Parity test.** Run the staged pass list plus upstream `codegen_function`
   against `compile_program` over the upstream fixture corpus. Byte equality
   means our copy of the pass list is in sync with the pin. Run it on every
   upstream bump.

## Open questions

- Do oxc or swc now host a maintained React Compiler integration that consumes
  these crates? If so, it could supply a Rust scope builder we could imitate.
  Not checked.
- Does upstream accept a small patch making the function-discovery helpers in
  `program.rs` public, or splitting `compile_fn` at the codegen boundary? That
  would remove risk 2.
- How should `index` spans map to tsgo positions? The compiler expects UTF-16
  offsets; tsgo's `pos`/`end` are UTF-8 byte offsets as far as I know (not
  verified here). A converter we write can emit whatever unit we then use for
  lookup, but `source_offsets.rs` slices `env.code` assuming UTF-16, so the
  converter should keep UTF-16 in `index`.
- Are spans unique enough as keys? In the samples each temporary's span was
  distinct from its neighbours'. But erased wrappers (`x!`, `f<T>`, `(x)`)
  share spans with their operands by design. Keying on (span, AST kind), or
  carrying tsgo node ids in a side table keyed by `Identifier.loc`, needs a
  decision once the converter exists.
- Should the typed cache keep upstream's `!==` dependency comparison (a `NaN`
  dependency always recomputes) or use `Object.is`?
- Is seeding `Environment.types` from tsgo worth it for better memoization
  precision? It is not tested, and the benefit is unmeasured.
