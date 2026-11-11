# HIR lowering module split

The inventory and slice coordinates refer to baseline `5b9d8b05849d1de3053cd8a9f2893c467e5e23ef`. [Group #670](https://github.com/AkisArou/nts/issues/670), [Design task #671](https://github.com/AkisArou/nts/issues/671), [Baseline lower.rs](https://github.com/AkisArou/nts/blob/5b9d8b05849d1de3053cd8a9f2893c467e5e23ef/compiler/core/src/hir/lower.rs).

## What the source contains

The 90,246-line file has 677 top-level Rust items. There are 430 functions, 26 impls, 68 structs, 52 enums, 22 constants, 6 type aliases, 1 static, 11 imports, 60 external module declarations, and 1 inline test module. The large `impl<'a> FuncBuilder<'a>` at line 23,333 has 1,245 methods over 64,397 lines. Its methods implement separate operations over one shared builder. Moving the impl as a unit would reproduce the current file's main bottleneck.

The inventory uses parsed Rust item spans, including attached attributes and doc comments. Top-level spans cover 89,613 lines. Counting the large impl's methods individually attributes 88,369 lines to owners. The other 1,877 physical lines are 1,865 blanks, 10 standalone comments, and that impl's opening and closing lines. The comments travel with their documented scope, including the file header. Each smaller impl and the inline test module is counted once, with its nested items listed for reference.

The call graph covers direct calls in the library build. I parsed the root and the 67 Rust files already under `lower/`, then matched Rust's unoptimized MIR call terminators to item definitions, keeping the full paths. A nested function or closure contributes its calls to its enclosing named function. This gives 2,495 matched named bodies and 11,136 distinct caller–callee pairs within the lowering subtree. Of those pairs, 8,271 start in `lower.rs`. The appendix records those source-level edges and the complete module projection, including edges from existing modules. Function values, dynamic targets, type and field use, imports, and test-only references require a source check as part of a move. The visibility column treats the resolved cross-module calls as a minimum set.

```sh
RUSTC_BOOTSTRAP=1 cargo rustc --offline --lib -p nts-core --profile nts-dev -- \
  --emit=mir -Zmir-opt-level=0 -Ztrim-diagnostic-paths=no
```

## What stays in lower.rs

Keep `lower` and `lower_with` at their public paths. The driver keeps the sequence in which it validates the snapshot, materializes generic instances, creates the indexed view, collects closures and hierarchy, plans module bindings, lowers bodies, emits adapters, publishes exports, and settles layouts and refusals. `hierarchy_and_naming` and `Shared::whole_program` stay because they assemble several owners' results into the same program context. They keep the hierarchy and slot numbering seen by every builder consistent.

Keep `Lowered`, `Arrivals` and its shared result records, `FuncBuilder`, `Shared`, `ProbeContext`, `Naming`, `PartialBlock`, and the shared `JumpTarget` type. A builder's fields are the private state used by the existing `impl FuncBuilder` blocks throughout the child modules. Its constructors, `finish`, `harvest`, and the common operation, block, type, and call helpers keep that shared state in one place. Specialized records such as `Hierarchy`, `ModuleScope`, `Place`, `Walk`, `Handler`, and `ClosureInfo` travel with their owners. `MODULE_INIT`, the existing `Substitution` re-export, module declarations, and the existing API facades stay here.

The mapped core is 2,048 item lines. `Naming`, `naming`, and `wire_naming` assemble and carry the plans for printers, iterators, parameter entries, initialization, raising, presence, and field order. Their callers use that plan across lowering. Keeping the aggregate in the parent preserves its private fields. New module declarations, imports, and impl wrappers for the split add to that. Most moved bodies belong to files between roughly 500 and 1,700 item lines. The six additions to existing files account for those files' current sizes in the slice table.

## Boundaries from the call graph

- `lower_with` calls `collect_closures`, `hierarchy_and_naming`, `collect_module_scope`, and `mark_refused_initializers` in that order. It passes their facts to the body builders and then calls the closure worklist, entry declarations, dispatch-table finishing, and export publication. These calls establish the boundary between whole-program orchestration and the owners of its inputs and outputs. The initializer probe and actual initializer lowering share the same evaluation owner and preserve their existing positions in the driver.
- `coerce_arm` calls representation queries, absence and storage checks, and `record_arrival`. `record_arrival` has a later consumer in the signature-entry code, which also reads the emitted closure bodies. The type-to-HIR mapping, conversions of values in a body, and program-wide ABI entry assembly are separate work. `fields_of` and `layout_of` share the field geometry with property reads, layout canonicalization, and constructor writes. The field layout owner supplies one answer to those callers.
- `lower_statement` and `lower_expression` dispatch to statement and expression owners. `lower_if`, `lower_for_of`, `lower_try`, and `lower_conditional` call back to body dispatch for their child nodes. This recursion is part of lowering the syntax tree. Both ends use the shared builder and the same SSA state. The small entry methods crossing those boundaries stay reachable within lowering.
- `lower_call` resolves targets and reaches method calls, closures, and builtins. Receiver dispatch calls into the native and closure routes as applicable. Native call construction works from a resolved binding, while ABI argument loans, foreign results, and callbacks each own their conversion rules. Objective-C message dispatch, program class registration, GObject, and COM have distinct consumers and retain their platform state with their owners.
- `raising_reachability` discovers raising edges, `raising_copies` chooses declarations and slots, and the body lowering of a call uses those settled facts. Keep those stages separate. A similar boundary separates capture discovery, allocation and capture cells, body emission, and calls through closure entries. The closure worklist keeps its index ordering.
- `array_from`, `lower_for_of`, destructuring, and iteration callbacks share walk operations. Their consumers own collection of values, binding the loop head, pattern semantics, and callback delivery respectively. The low-level walk owner supplies the step and element operations, with generator dispatch in its own owner. `iterator_calls` and `iterator_close` keep their existing contracts.
- The dominant shared dependencies are queries and emitters. For example, `initialization` has 78 distinct direct pairs to `snapshot_queries`, and `native_memory` has 68 to the retained core. Giving those operations their own owners leaves the separate declaration, ABI, and collection policies where their inputs are decided. The graph in the appendix includes these existing callers as well as the new destinations.

## Visibility and independent module commits

1. A module commit adds or extends the destination and transfers its listed items with their attributes, generic parameters, signatures, comments, and bodies. Methods go into inherent impls for the same type. A trait impl moves whole with its trait and self type. The original statements, collection iteration order, method selection, and diagnostic text are preserved. Qualify paths relative to the new file and keep doc references resolving.
2. A moved helper used only in its destination has private visibility. Give a moved name called by the parent or another direct child `pub(super)` inside the destination. At this depth that reaches the same `hir::lower` subtree the former private item reached. Use a private import in the parent where existing paths need the name. For a deeper child, use the smallest common ancestor allowed by Rust visibility.
3. For a moved struct, expose the type only to its callers. Restrict fields to the same owner unless a current reader, initializer, or pattern outside the destination needs the field. Preserve construction and field visibility for the public records. Check explicit type and function paths, function items passed as arguments, associated constants, struct literals and patterns, and the cfg(test) modules alongside the direct call list. Use scoped imports and existing interfaces, so a move adds no constructors or accessor methods solely to bridge the new path.
4. The existing public facade retains `lower`, `lower_with`, `Lowered`, `Arrivals`, `Arrival`, `UniformSite`, `Conversion`, `MODULE_INIT`, and `Substitution`. Public functions moving behind a `pub use` at their original path are `closure_class`, `closure_method`, `closure_erased_method`, `evaluates_module_scope`, `parse_number`, `erasable`, `describe`, `representation`, and `representation_with`. The destination module itself is private.
5. `settle_printer_checks`, `is_signature_name`, `result_crosses`, `instantiation_suffix`, and `same_slot` keep `hir`-wide visibility through `pub(in crate::hir)` definitions and the original `pub(super)` facade. `REJECT_ERROR` keeps its existing crate-visible path. The move adds zero crate-visible interfaces. Fields and methods used by a child from the retained core continue to use the parent's private access.
6. The sequence below starts with widely used queries and representations, then moves the context builders and body features. A destination can call any remaining private ancestor item. A caller moved later can use the already moved item through its lower-scoped definition. For example, `body_entries` can call the still-parent `lower_if`, and moving `lower_if` later lets it call the already moved statement entry in the same scope. The same rule covers the recursive layout/coercion and call/raising paths. Each module commit builds on its immediate parent, with both sides of every edge present in that tree. Check that build before adding the next module. Land the section's ordered commits together after its final proof.
7. Move the test module with its existing `#[cfg(test)]` declaration and the same `hir::lower::tests` path. Existing helper tests also follow the scope rule. The six files that receive additions already own the operations being moved, so their current APIs are checked along with the imported names.

## Proof on each section

- Pin the section base and tip with `node tooling/conformance/pin.ts <sha>`. Compare `nts hir --prepared` over every `tests/programs` and `benchmarks/cases` project for C, LLVM, JVM, and C with `--rc`. Use the #623 corpus comparison driver with these four arms, the full current corpus, and the stable `hir-compare` admission key. Record both compiler identities, per-arm pair totals, diagnostic and byte differences, and any unmeasured pairs. The proof requires every pair to finish and zero differences. A timeout leaves an unproved pair.
- Run the five test262 records against the section tip pin with the stable `test262-records` key. Use the recorded `test/language`, `test/built-ins`, `test/annexB`, `test/staging`, and `test/harness` invocations and verdict checks in the section tip's `all.sh`. Report the five verdicts and any row changes.
- Run `cargo fmt`, `cargo clippy --workspace --all-targets -- -D warnings`, and `NTS_CHECKERS=1 cargo test --no-fail-fast -p nts-core -p nts-codegen-c -p nts-codegen-llvm -p nts-codegen-jvm`, or the gate's corresponding `inner.ts` run. The Rust build checks both production and test visibility.
- Run the canonical pinned gate's `build compile-time compile-time-rc` steps with the section compiler and retain both tripwire verdicts. The tripwires cover the runtime corpus and the discovered compile-time fixtures. Use the recorded NoGC and RC budgets, including their measured scope. Investigate any red with its matching base before submitting.
- Start heavy proof runs in named units under the machine's admission rules. Report the tip, base, proofs, and ordered module commits to the coordinator for review before dry-run and queue. Fix a behavior or performance regression within the section before submission. The architecture layout task lands after all nine sections.

## Slice sequence

Each numbered row is one module commit. Each of the nine named sections is one landing task and carries the full proof on its tip. The first row names the retained core. If a section needs more than a day, split its landing at a module boundary and give each resulting landing the proof. Item lines count moved source spans before the destination's imports, impl wrappers, and formatting. For the six existing destinations the combined figure includes the destination's current physical lines.

| Slice | Destination | Item lines from lower.rs | Existing plus moved | Responsibility |
| ---: | --- | ---: | ---: | --- |
| kept | `lower.rs` | 2,048 | 2,048 | Public lowering entry, pipeline order, shared state, operation and block construction, and API facades. |
| | **Source facts and diagnostics** | | | |
| 1 | `lower/snapshot_queries.rs` | 762 | 762 | Query snapshot nodes, bindings, source scopes, and source traversal without choosing HIR. |
| 2 | `lower/diagnostics.rs` | 1,526 | 1,526 | Spell types and refusal causes, attribute diagnostics to declarations, and reconcile the final refused set with emitted bodies. |
| 3 | `lower/literals.rs` | 687 | 687 | Decode and emit literal, declared constant, and enum values, including enum reverse lookups. |
| 4 | `lower/property_keys.rs` | 577 | 925 | Resolve declaration and expression keys, private brands, and named or indexed keys before storage or dispatch. |
| 5 | `lower/names.rs` | 697 | 697 | Choose stable emitted declaration and member names, qualified paths, and generic suffixes. |
| | **Representations and layouts** | | | |
| 6 | `lower/absence.rs` | 1,068 | 1,068 | Decide and emit null, undefined, omitted-slot, and erased absence tests from representation facts. |
| 7 | `lower/representations.rs` | 1,165 | 1,165 | Map semantic types and substitutions to HIR representations, including provided types, union alternatives, and erased slots. |
| 8 | `lower/tuples.rs` | 402 | 402 | Choose tuple representations and layouts and read or construct their positions. |
| 9 | `lower/expression_types.rs` | 887 | 887 | Choose contextual and flow-narrowed types for an expression or binding at its use. |
| 10 | `lower/hierarchy.rs` | 1,121 | 1,121 | Collect class ancestry and the inherited dispatch/storage facts consumed by layout and member planning. |
| 11 | `lower/interfaces.rs` | 706 | 1,435 | Collect interfaces and candidate implementations, compare contracts, and publish interface declarations and missing implementations. |
| 12 | `lower/object_layouts.rs` | 1,060 | 1,060 | Name, collect, and canonicalize object layouts, including anonymous-layout eligibility and class identity. |
| 13 | `lower/member_layouts.rs` | 1,167 | 1,167 | Determine which member owns a field slot and its stored type, order, reservation, and inherited offset. |
| 14 | `lower/coercion.rs` | 1,081 | 1,081 | Convert an emitted value to the required HIR representation and check storage-prefix compatibility. |
| 15 | `lower/primitive_conversion.rs` | 603 | 603 | Evaluate JavaScript primitive conversion and conversion to number, including object hooks and erased values. |
| 16 | `lower/returns.rs` | 1,180 | 1,180 | Determine written, contextual, and emitted return representations, obligations, and body exits. |
| 17 | `lower/receiver_binding.rs` | 499 | 499 | Resolve and bind the JavaScript receiver, including lexical capture, explicit this, and unbound derived-constructor use. |
| 18 | `lower/signature_entries.rs` | 1,302 | 1,302 | Publish callable descriptor layouts and erased/typed entry bridges from closure arrivals and signatures. |
| | **Modules, declarations and body planning** | | | |
| 19 | `lower/native_modules.rs` | 275 | 275 | Read link and module metadata and the native facts that accompany the lowered program. |
| 20 | `lower/module_binding_types.rs` | 902 | 902 | Determine the settled stored type of module bindings, including arrays whose initializing writes establish their element type. |
| 21 | `lower/module_bindings.rs` | 906 | 906 | Collect module globals, lexical bindings, destructuring declarations, and static fields before bodies borrow the scope. |
| 22 | `lower/module_binding_bodies.rs` | 546 | 546 | Emit module binding writes and initialized-state checks for the reads and statements that use them. |
| 23 | `lower/module_namespaces.rs` | 840 | 840 | Resolve namespace values and imports, materialize dynamic import jobs, and construct their namespace layouts. |
| 24 | `lower/module_exports.rs` | 693 | 693 | Compute the public surface from the entry roots and publish exports or their refusal. |
| 25 | `lower/module_evaluation.rs` | 1,242 | 1,242 | Plan module evaluation order and state, probe cut initializers, and lower their evaluation bodies. |
| 26 | `lower/generic_copies.rs` | 386 | 386 | Enumerate checker-materialized function and class instantiations and their declaration copies. |
| 27 | `lower/structural_copies.rs` | 879 | 879 | Plan copies of otherwise non-generic bodies from argument storage, including the copy key and retyped symbols. |
| 28 | `lower/raising_reachability.rs` | 1,062 | 1,062 | Collect the body-level graph of throws, handlers, and potential raising callees. |
| 29 | `lower/raising_copies.rs` | 1,442 | 1,442 | Choose which bodies and dispatch slots get a raising copy and record the reason an eligible route is held. |
| 30 | `lower/capture_discovery.rs` | 1,452 | 1,452 | Discover closure identities, captured bindings, and closure variants needed by specialized bodies. |
| 31 | `lower/class_members.rs` | 751 | 751 | Select the methods and constructors a class contributes, lower their copies, and hand platform registration to its owner. |
| | **Body emission and calls** | | | |
| 32 | `lower/parameters.rs` | 1,029 | 1,029 | Determine declared parameter shapes and lower callee binding, defaults, and omitted arguments. |
| 33 | `lower/arguments.rs` | 789 | 789 | Evaluate and arrange arguments for the chosen parameter shape, including tuple/rest/spread gathering. |
| 34 | `lower/places.rs` | 1,388 | 1,388 | Classify assignable storage and emit its reads, writes, and deletion, with the binding and property checks those operations require. |
| 35 | `lower/accessors.rs` | 1,136 | 1,136 | Select and invoke get/set methods, including delegated, static, and super accessors. |
| 36 | `lower/local_bindings.rs` | 962 | 962 | Lower local declarations and identifier reads, including evolved types and declaration/initializer facts. |
| 37 | `lower/destructuring.rs` | 1,543 | 1,543 | Extract, default, and bind or assign values of array and object patterns. |
| 38 | `lower/assignments.rs` | 377 | 377 | Evaluate ordinary, compound, logical, and stepping assignments through their places. |
| 39 | `lower/body_entries.rs` | 999 | 999 | Build plain function and member bodies and dispatch each statement or expression to its owner. |
| 40 | `lower/call_expression.rs` | 881 | 881 | Resolve a CallExpression target, choose its entry route, and finish a typed call result. |
| 41 | `lower/method_calls.rs` | 1,175 | 1,175 | Choose and lower a receiver call, including static, registered, virtual, and builtin methods. |
| 42 | `lower/closure_values.rs` | 988 | 988 | Build closure values and the storage for captures, late-bound cells, and hoisted closure bindings. |
| 43 | `lower/closure_bodies.rs` | 974 | 974 | Emit wanted closure bodies and raising copies, with the generated ABI names and input setup they use. |
| 44 | `lower/closure_calls.rs` | 773 | 773 | Call a closure at its selected entry and implement Function.call/apply argument and receiver semantics. |
| 45 | `lower/bound_functions.rs` | 1,071 | 1,071 | Discover and emit bound-method and Function.bind wrappers with their retained arguments and receiver. |
| 46 | `lower/raising_calls.rs` | 1,260 | 1,260 | Select the raising entry or refuse an uncarryable call, and emit the raised-result test. |
| 47 | `lower/construct_expressions.rs` | 1,253 | 1,253 | Dispatch new and super expressions and emit ordinary class constructor calls and instance field initialization. |
| | **Control flow and suspension** | | | |
| 48 | `lower/branch_values.rs` | 1,100 | 1,100 | Build value-producing joins and short-circuit branches, using static branch facts where proved. |
| 49 | `lower/statement_branches.rs` | 948 | 948 | Lower if and switch statements, including case chains, narrowing, and join decisions. |
| 50 | `lower/loop_flow.rs` | 1,023 | 1,023 | Build loop and labelled control edges, carrying the values assigned across iterations and exits. |
| 51 | `lower/exceptions.rs` | 840 | 840 | Lower try, catch, finally, and throw, including the exceptional control edges and local bindings. |
| 52 | `lower/suspended_bodies.rs` | 688 | 688 | Emit the entry and suspension operations of generators and async bodies, including their frame and promise setup. |
| 53 | `lower/iterable_walks.rs` | 1,669 | 1,669 | Choose an iterator or indexed walk and lower for-in/for-of binding, stepping, and reads across supported representations. |
| 54 | `lower/generator_iteration.rs` | 810 | 810 | Lower generator and iterator-result operations, including async steps, generator dispatch, and value-presence checks. |
| 55 | `lower/iteration_callbacks.rs` | 1,076 | 1,076 | Lower callback-driven collection traversals, including callback binding, result delivery, reduction, and early exit. |
| | **Objects and collections** | | | |
| 56 | `lower/access.rs` | 562 | 975 | Resolve and emit checked property reads, sharing receiver/key planning and the existing access-family checks. |
| 57 | `lower/property_presence.rs` | 1,670 | 1,670 | Lower property existence and presence-bit tests for records, unions, and native class arms. |
| 58 | `lower/optional_chains.rs` | 572 | 572 | Preserve evaluation and short-circuiting across optional member, element, and call chains. |
| 59 | `lower/object_literals.rs` | 533 | 533 | Lower object literal storage, contextual record choice, and spread writes. |
| 60 | `lower/object_builtins.rs` | 1,178 | 1,178 | Lower Object operations and enumerate own keys, values, and entries in their declared order. |
| 61 | `lower/type_tests.rs` | 1,412 | 1,412 | Lower instanceof and descriptor/class tests, then expand and prune their class sets after layout collection. |
| 62 | `lower/typeof_expression.rs` | 664 | 664 | Lower typeof and related builtin classification predicates with their effect and initialization checks. |
| 63 | `lower/array_construction.rs` | 1,080 | 1,726 | Construct arrays from literals, constructor arguments, and spread copies. |
| 64 | `lower/array_from.rs` | 581 | 581 | Collect an iterator into an array, with the length, fill, and mapping operations Array.from needs. |
| 65 | `lower/array_methods.rs` | 1,506 | 1,506 | Read or update array elements and lower array methods, choosing counted-element helpers where ownership requires them. |
| 66 | `lower/array_sort.rs` | 641 | 641 | Lower array sorting and comparator dispatch, including sorting indices and writing the result back. |
| 67 | `lower/table_methods.rs` | 969 | 969 | Construct and operate on Map and Set storage, including insertion, pair walking, and callbacks. |
| 68 | `lower/buffers.rs` | 849 | 849 | Construct ArrayBuffers and DataViews, and guard attachment, resizing, allocation, and byte-window operations. |
| 69 | `lower/typed_arrays.rs` | 1,013 | 1,013 | Choose typed-array shapes and lower their construction, copying, and methods. |
| | **Builtins and promises** | | | |
| 70 | `lower/provided_errors.rs` | 785 | 785 | Build supplied Error values and emit the guards that raise them at builtin use sites. |
| 71 | `lower/operators.rs` | 1,051 | 1,051 | Lower unary, binary, numeric, bitwise, and comparison operators and their width/representation choices. |
| 72 | `lower/bigint.rs` | 194 | 290 | Lower BigInt operations and their range or divisor guards. |
| 73 | `lower/numeric_builtins.rs` | 474 | 474 | Lower Number methods and parsing entry points with the required argument and integer conversion. |
| 74 | `lower/string_builtins.rs` | 901 | 901 | Lower strings, string conversion and printing requests, and template literals and methods. |
| 75 | `lower/printed.rs` | 6 | 640 | Resolve and apply the settled printer decisions after body and descriptor collection. |
| 76 | `lower/date_builtins.rs` | 81 | 81 | Construct and call methods on the supplied Date representation. |
| 77 | `lower/symbol_builtins.rs` | 162 | 162 | Lower Symbol values, registry operations, and their methods. |
| 78 | `lower/host_builtins.rs` | 375 | 375 | Lower console inspection and timers into the supplied runtime operations. |
| 79 | `lower/static_builtins.rs` | 807 | 807 | Select and lower intrinsics and global/static builtin entry routes. |
| 80 | `lower/promise_settlement.rs` | 1,004 | 1,004 | Construct and settle promises and capabilities, including static combinators and the foreign rejection helper. |
| 81 | `lower/thenable_jobs.rs` | 1,052 | 1,052 | Recognize thenables and emit the jobs that assimilate and resolve them. |
| 82 | `lower/promise_reactions.rs` | 637 | 637 | Discover and lower Promise then/catch/finally continuations and their result delivery. |
| | **Foreign ABI** | | | |
| 83 | `lower/native_properties.rs` | 123 | 123 | Resolve native property places and variable reads and bridge their accessors. |
| 84 | `lower/native_construction.rs` | 742 | 742 | Choose and lower foreign constructor routes and assign their construction properties. |
| 85 | `lower/native_calls.rs` | 940 | 940 | Build native direct, table, and message callees from the binding signature and invoke them. |
| 86 | `lower/binding_calls.rs` | 921 | 921 | Choose binding overloads and delegated calls, including dictionary argument matching and spread. |
| 87 | `lower/foreign_arguments.rs` | 1,602 | 1,602 | Lower ABI arguments, including labels, parameter slots, loans, and bounded byte buffers. |
| 88 | `lower/foreign_values.rs` | 1,180 | 1,180 | Marshal native strings, handles, records, and Foundation collection values in both directions. |
| 89 | `lower/foreign_results.rs` | 798 | 798 | Decode foreign failure channels, output slots, and returned references into the caller's result. |
| 90 | `lower/foreign_callbacks.rs` | 832 | 832 | Bridge closures into callbacks and emit the conversions their signatures request. |
| 91 | `lower/objc_dispatch.rs` | 1,405 | 1,405 | Select and emit Objective-C message and property dispatch, including optional selectors and class receivers. |
| 92 | `lower/objc_class.rs` | 1,012 | 1,012 | Register Objective-C classes, lower their methods and constructors, and emit their instance state. |
| 93 | `lower/gobject_class.rs` | 1,384 | 1,384 | Register GObject classes and emit their constructors, vfunc entries, and signal calls. |
| 94 | `lower/gobject_templates.rs` | 621 | 621 | Read GObject template and property declarations and emit their callback/accessor bodies. |
| 95 | `lower/com_class.rs` | 590 | 590 | Register COM classes and lower their constructor, activation, member, and super routes. |
| | **Test module** | | | |
| 96 | `lower/tests.rs` | 794 | 794 | Preserve the existing inline test module as lower/tests.rs under the same module path. |

### Ownership corrections from section 1

| Baseline item | Destination | Caller or shared responsibility |
| --- | --- | --- |
| `the_same_program` at 4,697 | `closure_bodies.rs` | `raising_closure` compares two emitted HIR bodies to choose an entry. |
| `in_a_cycle` at 16,210 | `module_exports.rs` | `record_unpublished` diagnoses an export surface held by the import graph. |
| `shaped_like` and `type_in_a_message` at 48,024 and 48,152 | `diagnostics.rs` | The formatter and its fallback spell the same diagnostic type. |
| `name_of_type` at 48,222 | `snapshot_queries.rs` | The query reads the snapshot's symbol name and serves multiple callers. |
| `AnswerFamily` and `answer_family` at 9,849 and 9,862 | `returns.rs` | `result_of_another_kind` uses the classification to check an emitted result. |
| `message_field` at 17,825 | `exceptions.rs` | The throw route finds the field for the runtime message. |
| `Declares` at 20,734 | `property_presence.rs` | `declares` and the presence tests share the result type. |
| `known_values` at 88,161 | `parameters.rs` | `lower_param_binding` uses the literal facts for a declared parameter. |
| `Naming`, `naming`, and `wire_naming` at 5,406, 8,655, and 14,656 | `lower.rs` | The program context assembles and shares several plans. The fields retain their parent-module privacy. |
| `enclosing` at 43,716 | `loop_flow.rs` | Break and continue look for an active loop or label in the builder. |
| `declared_names` at 76,204 | `native_modules.rs` | Native calls and Objective-C dispatch read and validate names through the native link tags. |

### Ownership corrections from section 2

| Baseline item | Destination | Caller or shared responsibility |
| --- | --- | --- |
| `not_decomposed` at 56,650 | `object_layouts.rs` | `layout_of` reports the undecomposed type when it cannot choose a layout. |
| `parameters_of` at 3,669 | `parameters.rs` | The query supplies declared parameter nodes to calls, interfaces, and parameter binding. |
| `UniformArguments` at 4,548 | `signature_entries.rs` | The argument routing record moves with its impl and the signature entry rules. |
| `lower_assertion` at 38,237 | `coercion.rs` | An explicit assertion lowers its operand and delegates to the existing assertion checks. |

### Ownership corrections from section 3

| Baseline item | Destination | Caller or shared responsibility |
| --- | --- | --- |
| The `closed_calls`, `erased_calls`, and `generic_values` declarations at 11,133–11,135 | `lower.rs` | The parent owns existing module paths and shared facades. Structural copy planning imports their helpers through those paths. |

Existing documentation links follow their targets into the new modules. A target referenced from another lowering module keeps parent-scoped access, preserving its original `hir::lower` boundary. Rendered labels stay the same.

### Ownership corrections from section 4

| Baseline item | Destination | Caller or shared responsibility |
| --- | --- | --- |
| `Step` at 22,496 | `loop_flow.rs` | `end_loop` consumes the latch action for source and synthesized loops. The record stays in the parent until that owner moves in section 5. |
| `method_takes` at 50,021 | `accessors.rs` | Delegated setter resolution and property-place selection share the predicate for a setter's argument. |

### Ownership corrections from section 8

| Baseline item | Destination | Caller or shared responsibility |
| --- | --- | --- |
| `ObjcDispatch` and `ObjcArm` at 12,635 and 12,649 | `objc_dispatch.rs` | `objc_dispatch`, `dispatch_objc_call`, and `objc_arm` build and consume the dispatch descriptors. Existing implementation tests read the dispatch arms through lower-scoped access. |
| `ComEntry` at 12,658 | `com_class.rs` | `lower_com_member` constructs the composable Windows Runtime override descriptor, and the retained builder stores it. |

## Source inventory

The rows use baseline coordinates and count inclusive source lines. An indented row describes a member already counted in its enclosing item. The large impl is counted in the separate method ledger. Its opening and closing lines belong to the span accounting above.

`lower` in the visibility column means a direct cross-module caller requires lower-scoped access. `lower*` marks data with a source path use outside its owner. Review its actual fields and imports when moving it. `private*` means the measured edges and path hints give no reason to expose it. Test-only references, function values, and fields still need the source check described above. Trait methods follow their trait. Facade entries retain the original public path and scope.

<details>
<summary>All 677 top-level items</summary>

```text
   first–last  lines  destination              visibility   item
   10–10        1  lower                    private      use nts_diagnostics :: { Diagnostic , Location }
   11–15        5  lower                    private      use nts_semantic_schema :: { DeclarationModifiers , HeritageKind , ImportPhase , LiteralValue , MemberKind , NodeData , NodeId , NodeKind , Origin , PropertyKey , PropertyRecord , SemanticSnapshot , SymbolFlags , SymbolId , SymbolRecord , TypeId , TypeKind , TypeRecord , syntax , }
   17–17        1  lower                    private      use super :: facts :: Facts
   18–18        1  lower                    private      use super :: member_key :: { Accessor as MethodAccessor , MemberKey }
   19–23        5  lower                    private      use super :: { Absent , ArrayFill , BinOp , Block , BlockId , Callee , Field , FieldArm , Func , GeneratorKind , HirType , Layout , ManagedType , Op , OpKind , Param , ParamShape , Program , Terminator , UnOp , ValueId , ViewClass , }
   24–24        1  lower                    private      use closure_context :: SharedClosures
   25–25        1  lower                    private      use implementations :: LoweringSnapshot
   26–26        1  lower                    private      use layout_collection :: { BuilderLayouts , LayoutCollector }
   27–27        1  lower                    private      use made_instance :: { CollectedConstructor , MadeBy , ThisPaths }
   28–28        1  lower                    private      use numeric_arguments :: Builtin as NumericBuiltin
   30–36        7  iterable_walks           private*     const TABLE_CURSOR
   38–110      73  lower                    private      impl FuncBuilder < '_ >
   55–88       34  lower                    private        method harvest
   90–109      20  lower                    private        method rename_arrivals
  112–145      34  lower                    pub          struct Arrivals
  147–166      20  lower                    pub          struct UniformSite
  168–177      10  lower                    pub          struct Conversion
  179–186       8  lower                    private      enum Converts
  188–262      75  signature_entries        lower        fn disagreeing_arrivals
  264–289      26  lower                    pub          struct Arrival
  291–334      44  lower                    pub          struct Lowered
  336–342       7  lower                    private      impl Lowered
  337–341       5  lower                    pub            method is_complete
  344–349       6  printed                  hir facade   fn settle_printer_checks
  351–356       6  module_bindings          lower*       enum BindingConstant
  358–459     102  module_bindings          lower*       struct ModuleScope
  461–472      12  module_bindings          private*     impl ModuleScope
  462–471      10  module_bindings          private*       method for_snapshot
  474–715     242  hierarchy                lower*       struct Hierarchy
  717–723       7  hierarchy                lower*       enum Written
  725–973     249  hierarchy                private*     impl Hierarchy
  726–730       5  hierarchy                lower          method is_field_face
  731–735       5  hierarchy                lower          method declared_face
  736–741       6  hierarchy                lower          method stores
  743–756      14  hierarchy                lower          method stands_alone
  758–772      15  hierarchy                lower          method declares_a_then
  774–780       7  hierarchy                lower          method ancestors
  782–802      21  hierarchy                private*       method inherited_interfaces
  804–808       5  hierarchy                lower          method descends
  810–815       6  hierarchy                lower          method is_an_error
  817–824       8  hierarchy                lower          method declaring
  826–834       9  hierarchy                private*       method declaring_above
  836–870      35  hierarchy                lower          method root_declaring
  872–877       6  hierarchy                lower          method declares_itself
  879–889      11  hierarchy                lower          method publish_uniform_slots
  891–898       8  hierarchy                lower          method table_size
  900–904       5  hierarchy                lower          method constructor
  906–915      10  hierarchy                lower          method slot_for
  917–927      11  hierarchy                lower          method descends_from
  929–934       6  hierarchy                lower          method interfaces_of
  936–940       5  hierarchy                private*       method implements_transitively
  942–972      31  hierarchy                lower          method overridden
  975–999      25  generic_copies           lower        fn generic_classes
 1001–1008      8  snapshot_queries         lower        fn reads_a_name
 1010–1033     24  snapshot_queries         lower        fn names_only_a_type_parameter
 1035–1051     17  names                    lower        fn implemented_member
 1053–1123     71  object_layouts           lower        fn nominal_or_stand_in
 1125–1148     24  object_layouts           lower        fn instance_type_of
 1150–1152      3  object_layouts           lower        fn declares_a_class
 1154–1178     25  object_layouts           lower        fn is_anonymous_shape
 1180–1219     40  object_layouts           lower*       enum Nameless
 1221–1241     21  object_layouts           private*     impl Nameless
 1222–1228      7  object_layouts           lower          method unprovided
 1230–1240     11  object_layouts           lower          method of_feature
 1243–1257     15  object_layouts           lower        fn feature_of
 1259–1260      2  object_layouts           lower*       const SHARED_BUFFER_REFUSAL
 1262–1346     85  object_layouts           lower        fn collect_anonymous_objects
 1348–1360     13  member_layouts           lower*       struct Supply
 1362–1474    113  member_layouts           lower        fn collect_stored_members
 1476–1524     49  member_layouts           private*     fn declares_a_method_alone
 1526–1541     16  member_layouts           lower        fn declares_or_instantiates
 1543–1565     23  generic_copies           lower        fn is_an_instantiation
 1567–1591     25  hierarchy                lower        fn declared_record_parent
 1593–1629     37  hierarchy                lower        fn record_parents
 1631–1773    143  interfaces               lower        fn collect_interfaces
 1775–1833     59  interfaces               private*     fn collect_cast_faces
 1835–1858     24  hierarchy                private*     fn number_slots
 1860–2017    158  interfaces               lower        fn infer_implements
 2019–2034     16  interfaces               private*     fn structural_candidates
 2036–2126     91  hierarchy                lower        fn collect_carried_protocols
 2128–2158     31  hierarchy                private*     struct Carried
 2160–2184     25  hierarchy                private*     impl Carried
 2161–2183     23  hierarchy                lower          method resolve
 2186–2213     28  hierarchy                private*     fn com_interface_ids
 2215–2242     28  hierarchy                private*     fn note_objc_state
 2244–2251      8  hierarchy                lower        fn declares_stored
 2253–2283     31  hierarchy                lower        fn foreign_class_name
 2285–2308     24  hierarchy                private*     fn objc_state_chain
 2310–2365     56  object_layouts           lower        fn hierarchy_class_name
 2367–2386     20  capture_discovery        lower        fn widest_closure
 2388–2405     18  provided_errors          lower        fn provided_error_identities
 2407–2420     14  signature_entries        lower        fn needs_closure_slots
 2422–2451     30  signature_entries        private*     fn receives_a_function_value
 2453–2486     34  generic_copies           lower        fn template_instances
 2488–2640    153  hierarchy                lower        fn collect_hierarchy
 2642–2813    172  raising_copies           lower        fn raising_member_slots
 2815–2842     28  class_members            lower        fn the_constructor_declared_by
 2844–2861     18  class_members            lower        fn children_in_the_body_of
 2863–2874     12  class_members            lower        fn instance_initializer
 2876–2905     30  interfaces               lower        fn interface_member_of
 2907–2951     45  interfaces               lower        fn members_filling
 2953–2969     17  raising_copies           lower        fn a_declaration_that_can_raise
 2971–2984     14  names                    lower        fn member_dispatch_key
 2986–3045     60  capture_discovery        lower*       struct ClosureInfo
 3049–3064     16  capture_discovery        private*     impl Clone for ClosureInfo
 3051–3063     13  capture_discovery        lower          method clone
 3066–3124     59  capture_discovery        lower*       enum ClosureSource
 3126–3141     16  thenable_jobs            lower*       enum Then
 3143–3164     22  capture_discovery        private*     impl ClosureSource
 3144–3147      4  capture_discovery        lower          method wraps
 3149–3152      4  capture_discovery        lower          method binds_receiver
 3154–3163     10  capture_discovery        lower          method only_the_runtime_calls
 3166–3196     31  thenable_jobs            lower*       enum Thenable
 3198–3204      7  thenable_jobs            private*     const RAISING_THEN
 3206–3214      9  thenable_jobs            lower*       struct Thenables
 3216–3220      5  promise_settlement       lower*       const PAIR
 3222–3234     13  promise_settlement       lower        fn erased_promise
 3236–3254     19  thenable_jobs            private*     fn thenable_job_fields
 3256–3265     10  thenable_jobs            lower        fn module_job_fields
 3267–3285     19  thenable_jobs            private*     fn resolving_function_fields
 3287–3294      8  promise_reactions        private*     const A_REACTION_IN_A_GENERIC
 3296–3346     51  promise_reactions        lower        fn reactions
 3348–3390     43  bound_functions          lower        fn bound_functions
 3392–3394      3  bound_functions          private*     const A_BOUND_FUNCTION_IN_A_GENERIC
 3396–3405     10  module_namespaces        lower        fn module_jobs
 3407–3420     14  promise_reactions        private*     struct ReactionShape
 3422–3437     16  promise_reactions        private*     enum Callbacks
 3439–3448     10  promise_reactions        private*     struct Callback
 3450–3507     58  promise_reactions        private*     impl ReactionShape
 3451–3471     21  promise_reactions        private*       method present
 3473–3479      7  promise_reactions        private*       method field_of
 3481–3506     26  promise_reactions        private*       method fields
 3509–3577     69  thenable_jobs            lower        fn thenables
 3579–3640     62  thenable_jobs            private*     fn binding_thenables
 3642–3661     20  receiver_binding         lower        fn binds_its_own_this
 3663–3667      5  receiver_binding         private*     const UNBOUND_THIS
 3669–3676      8  parameters               lower        fn parameters_of
 3678–3711     34  thenable_jobs            private*     fn class_thenable
 3713–3786     74  thenable_jobs            private*     fn thenable_job
 3788–3809     22  capture_discovery        private*     impl ClosureInfo
 3789–3808     20  capture_discovery        lower          method as_written
 3811–3848     38  capture_discovery        private*     fn collect_method_used_as_value
 3850–3881     32  capture_discovery        private*     fn uses_its_receiver
 3883–3893     11  closure_values           lower*       const THIS_CAPTURE
 3895–3907     13  construct_expressions    lower*       const CONSTRUCTOR_KEY
 3909–3968     60  capture_discovery        lower*       struct Capture
 3970–4071    102  capture_discovery        private*     fn reached_by_name
 4073–4089     17  capture_discovery        lower        fn guarded_symbols
 4091–4106     16  capture_discovery        lower        fn boxed_symbols
 4108–4118     11  capture_discovery        lower        fn default_setter
 4120–4127      8  capture_discovery        lower        fn opaque_handle
 4129–4136      8  closure_values           lower        fn cell_type
 4138–4140      3  closure_values           private*     fn cell_name
 4142–4178     37  closure_bodies           lower        fn closure_type
 4180–4258     79  object_builtins          lower        fn literal_field_names
 4260–4279     20  object_builtins          lower        fn property_order
 4281–4291     11  static_builtins          lower*       enum Builtin
 4293–4296      4  capture_discovery        lower        fn closure_index
 4298–4318     21  iterable_walks           private*     enum Head
 4320–4329     10  destructuring            lower*       enum PatternScope
 4331–4336      6  lower                    pub          const MODULE_INIT
 4338–4386     49  module_evaluation        lower        fn runs_a_static_initializer
 4388–4431     44  module_evaluation        private*     fn is_module_statement
 4433–4447     15  module_evaluation        private*     fn is_module_declaration
 4449–4493     45  module_evaluation        private*     fn runs_an_initializer
 4495–4513     19  module_evaluation        private*     fn carries_code
 4515–4526     12  snapshot_queries         lower        fn collect_kind
 4528–4532      5  closure_bodies           lower        fn closure_names
 4534–4541      8  closure_bodies           lower        fn receiving_call_name
 4543–4546      4  closure_bodies           lower*       struct ClosureEntry
 4548–4555      8  signature_entries        lower*       struct UniformArguments
 4557–4564      8  signature_entries        private*     impl UniformArguments
 4558–4563      6  signature_entries        lower          method new
 4566–4643     78  signature_entries        lower        fn passing_undefined
 4645–4653      9  closure_bodies           lower        fn closure_body_name
 4655–4664     10  closure_bodies           lower        fn receiving_function_name
 4666–4667      2  closure_bodies           private*     const RECEIVING_SUFFIX
 4669–4678     10  closure_bodies           lower        fn names_a_raising_copy
 4680–4683      4  closure_bodies           lower        fn erased_call_name
 4685–4695     11  closure_bodies           private*     fn raising_closure_names
 4697–4726     30  closure_bodies           private*     fn the_same_program
 4728–4735      8  closure_bodies           pub facade   fn closure_class
 4737–4741      5  closure_bodies           pub facade   fn closure_method
 4743–4748      6  closure_bodies           pub facade   fn closure_erased_method
 4750–4769     20  capture_discovery        private*     enum Rebinding
 4771–4791     21  capture_discovery        lower        fn not_a_plain_function
 4793–4797      5  capture_discovery        lower        fn taken_as_a_closure
 4799–4875     77  promise_settlement       lower        fn settler_symbols
 4877–4916     40  capture_discovery        private*     fn assigned_anywhere
 4918–5066    149  capture_discovery        private*     fn captures_of
 5068–5128     61  capture_discovery        private*     fn nested_closures
 5130–5133      4  capture_discovery        private*     const NESTED_CLOSURE_ROUNDS
 5135–5194     60  capture_discovery        lower        fn collect_closures
 5196–5380    185  capture_discovery        private*     fn collect_function_values
 5382–5398     17  capture_discovery        private*     fn function_value
 5400–5404      5  receiver_binding         lower*       const A_GENERIC_DECLARATION_READING_THIS
 5406–5580    175  lower                    private      struct Naming
 5582–5660     79  names                    lower        fn qualified_names
 5662–5725     64  names                    private*     fn distinguishing_tail
 5727–5742     16  suspended_bodies         lower        fn generator_indices
 5744–5757     14  suspended_bodies         private*     fn abstract_generators
 5759–5779     21  suspended_bodies         lower        fn abstract_generator_kind
 5781–5807     27  suspended_bodies         private*     fn abstract_generator_names
 5809–5832     24  property_presence        lower*       struct AddedKeys
 5834–5894     61  property_presence        private*     impl AddedKeys
 5835–5893     59  property_presence        private*       method written_by
 5896–6007    112  property_presence        lower        fn added_keys
 6009–6076     68  property_presence        lower        fn presence_keys
 6078–6153     76  raising_reachability     lower*       struct Throwing
 6155–6193     39  raising_reachability     lower*       enum Reached
 6195–6203      9  raising_reachability     private*     impl Reached
 6196–6202      7  raising_reachability     lower          method body
 6205–6242     38  raising_reachability     lower        fn the_function_of
 6244–6273     30  raising_reachability     lower        fn names_a_body
 6275–6288     14  raising_reachability     lower        fn names_a_class_element
 6290–6305     16  raising_reachability     private*     fn a_parameter_among
 6307–6316     10  raising_reachability     private*     fn a_callee_with_a_body
 6318–6380     63  hierarchy                lower        fn declared_base_class
 6382–6427     46  raising_reachability     private*     fn an_operator_that_can_raise
 6429–6437      9  raising_reachability     private*     fn a_synthesized_throw
 6439–6451     13  raising_reachability     private*     fn an_immutable_store
 6453–6689    237  raising_reachability     private*     fn walk_one_declaration
 6691–6708     18  capture_discovery        lower        fn const_alias_of
 6710–6761     52  expression_types         lower        fn collect_view_classes
 6763–6780     18  expression_types         private*     fn declared_view_class
 6782–6793     12  capture_discovery        lower        fn const_function_aliases
 6795–6817     23  capture_discovery        lower        fn function_behind_const
 6819–6972    154  raising_reachability     lower        fn throwing_symbols
 6974–7039     66  raising_copies           lower        fn copyable_symbols
 7041–7073     33  raising_copies           private*     fn why_it_cannot_be_copied
 7075–7130     56  raising_copies           lower        fn a_copy_can_be_made_of
 7132–7152     21  raising_copies           private*     fn can_be_copied
 7154–7159      6  raising_copies           lower*       const RAISING_SUFFIX
 7161–7176     16  raising_copies           lower        fn without_the_raising_suffix
 7178–7198     21  raising_copies           lower*       const A_FUNCTION_WRITTEN_AS_A_VALUE
 7200–7201      2  raising_copies           lower*       const THROUGH_A_FUNCTION_VALUE
 7203–7303    101  raising_copies           private*     fn a_raising_callee_of
 7305–7337     33  raising_copies           lower        fn raising_callees_of
 7339–7426     88  raising_copies           private*     fn eligible_declarations
 7428–7457     30  raising_copies           private*     struct RaisingCopies
 7459–7607    149  raising_copies           lower        fn raising_copies
 7609–7620     12  raising_reachability     lower        fn raising_body_calls
 7622–7645     24  raising_reachability     lower        fn close_over_callees
 7647–7724     78  raising_copies           private*     fn what_holds_the_gate_off
 7726–7821     96  raising_copies           private*     fn the_cause_below_the_gate
 7823–7868     46  raising_copies           private*     fn the_symbol_cause
 7870–7883     14  raising_copies           private*     fn via
 7885–7957     73  raising_copies           private*     fn describe_gate_holder
 7959–7986     28  raising_copies           private*     fn wrappable_functions
 7988–8005     18  raising_copies           private*     fn a_closure_callee
 8007–8105     99  raising_reachability     lower        fn a_copy_can_contain
 8107–8212    106  raising_reachability     private*     fn a_call_that_can_raise
 8214–8244     31  raising_reachability     lower        fn a_value_held_callee
 8246–8309     64  raising_copies           lower        fn a_value_held_call
 8311–8464    154  capture_discovery        lower        fn functions_used_as_values
 8466–8490     25  raising_reachability     lower        fn closure_bodies_that_can_raise
 8492–8565     74  raising_reachability     lower        fn calls_guarded_by_a_try
 8567–8585     19  names                    lower        fn class_token_indices
 8587–8640     54  member_layouts           lower        fn written_field_orders
 8642–8653     12  member_layouts           lower*       struct WrittenOrders
 8655–8701     47  lower                    private      fn naming
 8703–8718     16  module_binding_types     lower        fn ambient_handle
 8720–8738     19  module_binding_types     lower*       enum Settled
 8740–8810     71  module_binding_types     lower        fn storable
 8812–8829     18  module_binding_types     lower        fn unshared_name
 8831–8907     77  module_binding_types     lower        fn closure_typed_global
 8909–8917      9  module_bindings          lower        fn declared_once
 8919–8927      9  module_bindings          lower        fn initialized_before_use
 8929–8974     46  module_bindings          lower        fn reassigned_anywhere
 8976–9009     34  module_bindings          private*     fn declare_a_closure_global
 9011–9025     15  module_exports           lower        fn declaration_is_exported
 9027–9055     29  module_exports           lower        fn declared_literal
 9057–9075     19  module_exports           lower        fn declared_string_literal
 9077–9113     37  module_exports           lower        fn binding_of
 9115–9140     26  module_binding_types     lower        fn global_object
 9142–9250    109  module_binding_types     lower        fn settle_by_binding
 9252–9281     30  literals                 lower        fn parse_handle_constant
 9283–9289      7  literals                 lower*       const VALUELESS_DECLARED_CONST
 9291–9298      8  literals                 lower        fn is_scalar
 9300–9311     12  module_bindings          private*     fn module_scope_probe
 9313–9663    351  module_bindings          lower        fn collect_module_scope
 9665–9690     26  module_bindings          private*     fn add_initialized_flags
 9692–9717     26  module_bindings          lower        fn binding_element_parts
 9719–9791     73  module_bindings          private*     fn declare_a_destructured_module_binding
 9793–9811     19  module_bindings          private*     fn refuse_the_whole_pattern
 9813–9820      8  diagnostics              lower        fn representation_mismatch
 9822–9847     26  diagnostics              lower        fn representation_word
 9849–9860     12  returns                  private*     enum AnswerFamily
 9862–9888     27  returns                  private*     fn answer_family
 9890–9909     20  diagnostics              private*     fn managed_word
 9911–10032   122  module_binding_types     lower        fn settled_declaration_type
10034–10075    42  module_binding_types     lower        fn settled_global_type
10077–10120    44  module_binding_types     private*     fn initialized_with_an_absence
10122–10135    14  module_binding_types     private*     struct IndexedWrites
10137–10251   115  module_binding_types     private*     fn dense_prefix_writes
10253–10332    80  module_binding_types     private*     fn pushed_element_type
10334–10390    57  module_binding_types     private*     fn growth_can_fill
10392–10427    36  module_binding_types     lower        fn settled
10429–10434     6  module_binding_types     lower        fn uninhabited_array
10436–10443     8  module_binding_types     lower        fn is_an_unsettled_array
10445–10455    11  module_bindings          lower*       enum Pair
10457–10497    41  module_bindings          private*     fn declare_a_module_global
10499–10520    22  snapshot_queries         lower        fn declaration_initializer
10522–10563    42  module_binding_types     lower        fn no_initializer_for_an_erased_slot
10565–10693   129  module_bindings          private*     fn collect_static_fields
10695–10710    16  diagnostics              lower        fn ambiguous_name
10712–10756    45  diagnostics              lower        fn an_uninstantiated_generic
10758–10809    52  diagnostics              lower        fn report_unaccounted
10811–10843    33  diagnostics              lower        fn note_a_refused_function
10845–10914    70  generic_copies           lower        fn uninstantiated
10916–10974    59  structural_copies        lower*       type Retyped
10976–11009    34  structural_copies        lower*       struct Structural
11011–11020    10  structural_copies        private*     impl Structural
11012–11019     8  structural_copies        lower          method lowers_as_declared
11022–11032    11  structural_copies        lower*       struct CallContext
11034–11048    15  structural_copies        private*     impl CallContext < 'a >
11035–11039     5  structural_copies        lower          method structural
11041–11047     7  structural_copies        lower          method suffix
11050–11056     7  structural_copies        private*     impl Structural
11051–11055     5  structural_copies        lower          method wire_calls
11058–11075    18  structural_copies        lower        fn member_symbols
11077–11124    48  structural_copies        lower        fn planned_callee
11126–11131     6  structural_copies        private*     struct PendingCopy
11133–11133     1  lower                    private      mod closed_calls
11134–11134     1  lower                    private      mod erased_calls
11135–11135     1  lower                    private      mod generic_values
11137–11143     7  structural_copies        private*     struct StructuralPlanner
11145–11232    88  structural_copies        lower        fn structural_instantiations
11234–11252    19  structural_copies        private*     fn planned_signature
11254–11274    21  structural_copies        private*     fn has_a_union_without_representation
11276–11351    76  structural_copies        private*     fn reached_beyond_its_calls
11353–11395    43  structural_copies        private*     fn member_retypes
11397–11433    37  structural_copies        private*     fn union_member_retype
11435–11533    99  structural_copies        private*     fn copy_retype
11535–11679   145  structural_copies        private*     impl StructuralPlanner < '_ , '_ >
11542–11555    14  structural_copies        private*       method plan_members
11557–11678   122  structural_copies        private*       method record_call
11681–11728    48  snapshot_queries         lower        fn children_that_run
11730–11746    17  iterable_walks           lower        fn for_each_parts
11748–11754     7  structural_copies        lower        fn calls_in_the_body_of
11756–11765    10  structural_copies        lower        fn calls_in_a_default
11767–11811    45  structural_copies        private*     fn calls_under
11813–11837    25  structural_copies        lower        fn retyped_symbols_of
11839–11887    49  structural_copies        lower        fn with_const_aliases
11889–11936    48  capture_discovery        lower        fn closure_variants
11938–12024    87  names                    lower        fn qualified_name
12026–12085    60  diagnostics              lower        fn note_member
12087–12240   154  diagnostics              lower        fn note_uncompiled
12242–12308    67  generic_copies           lower        fn function_copies
12310–12337    28  generic_copies           lower*       struct Copy
12339–12342     4  generic_copies           lower        fn is_generic_function
12344–12390    47  class_members            lower        fn members_of
12392–12473    82  class_members            lower        fn lower_members_of
12475–12481     7  diagnostics              lower        fn refusal_by_name
12483–12499    17  diagnostics              lower        fn member_name_of
12501–12614   114  body_entries             lower        fn lower_object_literal_members
12616–12625    10  objc_class               lower*       struct ObjcConstruct
12627–12633     7  objc_class               lower*       struct ObjcEntry
12635–12647    13  objc_dispatch            lower*       struct ObjcDispatch
12649–12656     8  objc_dispatch            lower*       struct ObjcArm
12658–12668    11  com_class                lower*       struct ComEntry
12670–12674     5  objc_class               private*     fn objc_selector
12676–12735    60  objc_class               lower        fn register_objc_class
12737–12769    33  class_members            lower        fn member_copy
12771–12775     5  class_members            lower        fn target_suffix
12777–12835    59  class_members            lower        fn constructor_targets
12837–12841     5  class_members            lower*       struct ConstructorTargets
12843–12860    18  class_members            private*     impl ConstructorTargets
12844–12848     5  class_members            private*       method insert
12850–12859    10  class_members            private*       method finish
12862–12917    56  class_members            private*     fn target_constructor_copies
12919–12987    69  class_members            private*     fn constructor_copies
12989–13076    88  raising_copies           lower        fn raising_method
13078–13333   256  class_members            private*     fn lower_class
13335–13437   103  gobject_class            lower        fn register_gobject_class
13439–13475    37  gobject_class            private*     fn vfunc_declaration_signature
13477–13512    36  gobject_class            private*     fn binding_signal_kinds
13514–13547    34  gobject_class            private*     fn gobject_interfaces
13549–13560    12  gobject_class            lower        fn program_superclass
13562–13576    15  gobject_class            lower        fn template_handlers
13578–13594    17  gobject_templates        private*     fn static_field
13596–13608    13  gobject_templates        lower*       enum StaticValue
13610–13637    28  gobject_templates        lower        fn static_value
13639–13660    22  gobject_templates        lower        fn gobject_template
13662–13675    14  gobject_templates        lower        fn known_handlers
13677–13710    34  gobject_templates        lower        fn template_reader
13712–13741    30  gobject_templates        private*     fn template_children
13743–13829    87  gobject_templates        lower        fn property_fields
13831–13838     8  gobject_templates        private*     fn fields_index
13840–13904    65  gobject_class            lower        fn gobject_properties
13906–13976    71  objc_class               lower        fn objc_field_properties
13978–13990    13  gobject_class            private*     fn gobject_signals
13992–14094   103  gobject_class            private*     fn signals_of_type
14096–14120    25  gobject_class            lower        fn with_vfunc_slot
14122–14124     3  class_members            lower*       type LoweredMember
14126–14143    18  class_members            private*     fn keep_foreign_member
14145–14173    29  class_members            private*     fn refuses_an_unregistered_handle
14175–14187    13  class_members            lower        fn via_callee
14189–14243    55  com_class                lower        fn register_com_class
14245–14272    28  objc_class               lower        fn objc_state_function
14274–14294    21  names                    lower        fn is_static_member_symbol
14296–14301     6  names                    lower        fn is_static_member
14303–14333    31  generic_copies           lower        fn copies_of
14335–14402    68  generic_copies           lower        fn class_copies
14404–14417    14  generic_copies           lower*       struct ClassCopy
14419–14470    52  capture_discovery        lower        fn class_closure_variants
14472–14482    11  capture_discovery        private*     impl ClassCopy
14473–14481     9  capture_discovery        private*       method function
14484–14491     8  lower                    private      struct ProbeContext
14493–14520    28  lower                    private      struct Shared
14522–14654   133  lower                    private      impl Shared
14523–14594    72  lower                    private        method whole_program
14596–14653    58  lower                    private        method builder
14656–14683    28  lower                    private      fn wire_naming
14685–14778    94  module_binding_bodies    lower        fn dead_zone_reads
14780–14816    37  module_binding_bodies    private*     fn evaluated_reads
14818–14828    11  snapshot_queries         lower        fn is_declaration_file
14830–14835     6  snapshot_queries         lower        fn is_a_declaration_path
14837–14843     7  module_evaluation        private*     type ModuleStatements
14845–14941    97  module_evaluation        private*     fn module_statements
14943–14992    50  module_evaluation        lower*       struct ModuleRoles
14994–15003    10  module_evaluation        lower*       struct LazyModule
15005–15006     2  module_evaluation        private*     const EVALUATING
15007–15007     1  module_evaluation        private*     const EVALUATED
15008–15008     1  module_evaluation        private*     const FAILED
15010–15073    64  module_evaluation        private*     fn module_roles
15075–15079     5  module_evaluation        lower        fn module_evaluate_name
15081–15092    12  module_evaluation        pub facade   fn evaluates_module_scope
15094–15101     8  module_namespaces        lower        fn is_a_dynamic_import
15103–15109     7  module_namespaces        lower        fn dynamic_import_target
15111–15124    14  module_namespaces        private*     enum ImportOptions
15126–15162    37  module_namespaces        private*     fn import_options_of_type
15164–15196    33  module_namespaces        private*     fn names_a_file_of_the_program
15198–15215    18  module_namespaces        private*     fn join_relative
15217–15222     6  module_namespaces        private*     fn dynamic_import_namespace
15224–15239    16  module_namespaces        lower        fn module_of_namespace
15241–15278    38  module_evaluation        lower        fn add_lazy_modules
15280–15361    82  module_evaluation        lower        fn evaluation_order
15363–15384    22  module_evaluation        lower        fn mark_refused_initializers
15386–15445    60  module_evaluation        private*     fn refused_initializers
15447–15551   105  module_evaluation        lower        fn lower_module_initializer
15553–15589    37  foreign_callbacks        lower        fn lower_conversions
15591–15592     2  promise_settlement       crate facade const REJECT_ERROR
15594–15620    27  promise_settlement       lower        fn lower_reject_error
15622–15654    33  promise_settlement       private*     fn declared_promise_function
15656–15807   152  module_evaluation        private*     fn drop_the_unlowerable
15809–15898    90  module_evaluation        lower        fn initializer_function
15900–16000   101  module_namespaces        lower        fn module_namespace_of
16002–16090    89  module_namespaces        private*     fn shorthand_target
16092–16200   109  module_namespaces        lower        fn namespace_of
16202–16208     7  snapshot_queries         lower        fn probe_kind
16210–16267    58  module_exports           private*     fn in_a_cycle
16269–16294    26  module_exports           private*     fn record_unpublished
16296–16369    74  module_exports           private*     fn opaque_signature
16371–16475   105  module_exports           private*     fn optional_scalars
16477–16641   165  module_exports           private*     fn public_api
16643–16652    10  module_exports           private*     type PublicSurface
16654–16753   100  module_exports           private*     fn record_unstorable_exports
16755–16809    55  module_exports           lower        fn publish_surface
16811–16814     4  lower                    pub          fn lower
16816–17011   196  closure_bodies           lower        fn lower_wanted_closures
17013–17028    16  closure_bodies           private*     fn closure_aliases
17030–17035     6  closure_bodies           private*     struct ClosureOutput
17037–17202   166  closure_bodies           private*     fn raising_closure
17204–17239    36  lower                    private      fn hierarchy_and_naming
17241–17284    44  member_layouts           lower        fn field_aliases
17286–17696   411  lower                    pub          fn lower_with
17698–17717    20  signature_entries        lower        fn finish_dispatch_tables
17719–17785    67  diagnostics              lower        fn attribute_nested_to_their_refused_outer
17787–17823    37  diagnostics              lower        fn drop_refusals_the_program_contradicts
17825–17844    20  exceptions               private*     fn message_field
17846–17859    14  object_layouts           lower        fn generated_name
17861–17886    26  object_layouts           lower        fn signature_name
17888–17895     8  object_layouts           hir facade   fn is_signature_name
17897–17934    38  object_layouts           lower        fn may_merge
17936–17941     6  object_layouts           lower        fn nominal_name
17943–17970    28  object_layouts           private*     fn is_foreign_name
17972–18049    78  type_tests               lower        fn expand_layout_tests
18051–18094    44  type_tests               lower        fn prune_class_tests
18096–18122    27  native_modules           lower        fn collect_declared_facts
18124–18243   120  native_modules           private*     fn collect_native_headers
18245–18263    19  native_modules           private*     fn declared_module_name
18265–18274    10  native_modules           private*     fn is_link_name
18276–18315    40  native_modules           private*     fn collect_native_modules
18317–18360    44  object_layouts           lower        fn collect_class_identities
18362–18393    32  object_layouts           lower        fn collect_plain_records
18395–18414    20  object_layouts           private*     fn class_identity
18416–18439    24  names                    private*     fn declaration_identifier
18441–18479    39  names                    lower        fn named_class_source
18481–18490    10  names                    lower        fn class_symbol
18492–18519    28  member_layouts           lower        fn one_type_two_orders
18521–18526     6  object_layouts           private*     fn collect_layouts
18528–18573    46  object_layouts           private*     fn unshared_layout_name_for
18575–18592    18  signature_entries        lower        fn signature_key
18594–18744   151  interfaces               lower        fn declare_interface_methods
18746–18783    38  interfaces               lower        fn declaration_shell
18785–18850    66  interfaces               private*     fn record_unimplemented_interfaces
18852–18883    32  returns                  lower        fn closure_result_absent
18885–18915    31  returns                  lower        fn absent_of_result
18917–18921     5  returns                  hir facade   fn result_crosses
18923–19172   250  signature_entries        lower        fn erased_call
19174–19243    70  signature_entries        private*     fn uniform_params
19245–19303    59  signature_entries        private*     fn refuses_to_cross
19305–19330    26  signature_entries        private*     fn signature_locations
19332–19375    44  signature_entries        private*     fn signature_origin
19377–19446    70  signature_entries        lower        fn declare_uniform_entries
19448–19573   126  raising_copies           lower        fn fill_raising_member_slots
19575–19731   157  signature_entries        private*     fn declare_erased_entries
19733–19820    88  signature_entries        private*     fn declare_raising_entries
19822–19985   164  signature_entries        lower        fn relate_closures_to_signatures
19987–20019    33  suspended_bodies         lower        fn shared_generator_result
20021–20065    45  signature_entries        lower        fn lay_out_held_signatures
20067–20082    16  signature_entries        lower        fn signature_layout
20084–20111    28  object_layouts           lower        fn objects_in
20113–20187    75  object_layouts           lower        fn canonicalize_objects
20189–20218    30  object_layouts           private*     fn object_representatives
20220–20268    49  literals                 pub facade   fn parse_number
20270–20291    22  literals                 lower        fn parse_bigint
20293–20317    25  absence                  lower*       enum Absence
20319–20368    50  representations          lower        fn named_representation
20370–20380    11  coercion                 lower        fn readable_back
20382–20509   128  representations          pub facade   fn erasable
20511–20536    26  destructuring            lower*       enum Enumerated
20538–20555    18  absence                  lower        fn holds_only_absences
20557–20579    23  parameters               lower        fn a_pattern_that_requires_coercion
20581–20594    14  parameters               lower        fn in_javascript
20596–20622    27  parameters               lower        fn a_parameter_pattern_can_throw
20624–20635    12  absence                  lower        fn absence_of_member
20637–20646    10  absence                  lower        fn admits_absence
20648–20672    25  table_methods            lower        fn table_key_within
20674–20700    27  diagnostics              lower        fn short
20702–20732    31  diagnostics              lower        fn spell
20734–20749    16  property_presence        lower*       enum Declares
20751–20766    16  diagnostics              lower        fn spelling
20768–20789    22  diagnostics              private*     fn named_or
20791–20808    18  representations          lower        fn an_unchosen_collection
20810–20829    20  representations          lower        fn chooses
20831–20973   143  diagnostics              pub facade   fn describe
20975–21006    32  diagnostics              private*     fn contains_a_cycle
21008–21029    22  generic_copies           lower        fn is_a_generic_declaration
21031–21042    12  names                    hir facade   fn instantiation_suffix
21044–21047     4  representations          pub facade   fn representation
21049–21055     7  lower                    pub          use super :: generics :: Substitution
21057–21106    50  generator_iteration      lower        fn iterator_result_element
21108–21128    21  generator_iteration      private*     fn may_be_a_finished_iterator_result
21130–21134     5  snapshot_queries         lower        fn named
21136–21147    12  snapshot_queries         lower        fn provided
21149–21165    17  representations          pub facade   fn representation_with
21167–21172     6  representations          lower*       struct Representation
21174–21179     6  representations          private*     impl std::ops::Deref for Representation < '_ >
21175–21175     1  representations          private*       associated type Target
21176–21178     3  representations          private*       method deref
21181–21211    31  typed_arrays             lower        fn inherited_typed_array
21213–21224    12  typed_arrays             lower        fn declares_storage
21226–21242    17  typed_arrays             lower        fn property_branded
21244–21298    55  representations          lower        fn representation_within
21300–21365    66  representations          lower        fn in_a_slot
21367–21392    26  representations          lower        fn slot_for
21394–21456    63  tuples                   lower        fn tuple_representation
21458–21496    39  suspended_bodies         lower        fn generator_element_type
21498–21750   253  representations          private*     fn provided_representation
21752–21767    16  representations          private*     fn brand_representation
21769–21787    19  representations          lower        fn constant_fits
21789–21796     8  representations          private*     enum Decided
21798–21846    49  representations          private*     fn decided_representation
21848–21966   119  representations          private*     fn union_representation
21968–22272   305  representations          private*     fn representation_of
22274–22282     9  lower                    private      struct PartialBlock
22284–22291     8  typed_arrays             private*     struct ViewShape
22293–22332    40  typed_arrays             lower        fn numeric_array_method
22334–22375    42  absence                  lower        fn absent_argument
22377–22384     8  iteration_callbacks      lower*       enum MethodsOf
22386–22401    16  iteration_callbacks      private*     enum Direction
22403–22414    12  iteration_callbacks      private*     struct StepNames
22416–22427    12  iteration_callbacks      private*     struct ReduceStart
22429–22438    10  iteration_callbacks      private*     struct Walked
22440–22460    21  iteration_callbacks      lower        fn iteration_method
22462–22468     7  native_properties        lower*       enum ConstructedSetter
22470–22481    12  native_properties        lower*       struct SetProperty
22483–22494    12  array_sort               private*     struct Comparator
22496–22528    33  loop_flow                lower*       enum Step
22530–22542    13  suspended_bodies         lower*       struct AsyncResult
22544–22555    12  promise_settlement       lower*       struct Settler
22557–22565     9  promise_settlement       lower*       struct CapabilityBinding
22567–22583    17  iteration_callbacks      lower*       enum Iteration
22585–22603    19  iteration_callbacks      private*     impl Iteration
22586–22602    17  iteration_callbacks      private*       method parameters
22605–22612     8  array_from               private*     enum CollectionAppend
22614–22661    48  iteration_callbacks      lower*       enum CallbackResult
22663–22671     9  iteration_callbacks      lower*       struct CallbackReturn
22673–22707    35  loop_flow                lower*       struct Breakable
22709–22730    22  loop_flow                lower*       struct Loop
22732–22751    20  exceptions               lower*       enum Exit
22753–22766    14  exceptions               private*     struct PendingRejection
22768–22782    15  exceptions               lower*       struct Handler
22784–22795    12  exceptions               lower*       struct Edge
22797–22806    10  parameters               lower*       enum ParameterNames
22808–22820    13  gobject_class            lower*       struct VfuncSlot
22822–23234   413  lower                    private      struct FuncBuilder
23236–23237     2  lower                    private      static NO_FOREIGN
23239–23250    12  primitive_conversion     lower*       enum NumberHint
23252–23257     6  foreign_arguments        lower*       struct ParameterTags
23259–23331    73  foreign_arguments        lower*       enum Lent
23333–87729 64397  method ledger            per method   impl FuncBuilder < 'a >
87731–87749    19  property_presence        lower*       const PRESENCE_INDEX
87751–87757     7  operators                lower        fn strict_operator
87759–87789    31  literals                 lower        fn spelling_of
87791–87802    12  operators                private*     fn bitwise_operator
87804–87821    18  assignments              lower        fn compound_operator
87823–87837    15  assignments              private*     enum Logical
87839–87847     9  assignments              lower        fn logical_assignment
87849–87902    54  diagnostics              lower        fn refused_by_name
87904–87910     7  exceptions               lower        fn has_finally
87912–87918     7  snapshot_queries         lower        fn kind_at
87920–87931    12  snapshot_queries         lower        fn direct_children
87933–87941     9  snapshot_queries         lower        fn contains_kind
87943–87949     7  snapshot_queries         lower        fn walk
87951–87991    41  static_builtins          private*     fn math_member
87993–88002    10  static_builtins          lower*       enum PrimitiveBuiltin
88004–88013    10  static_builtins          private*     fn primitive_builtin
88015–88022     8  static_builtins          private*     fn global_predicate
88024–88035    12  static_builtins          lower        fn named_constant
88037–88058    22  static_builtins          private*     fn number_constant
88060–88079    20  static_builtins          private*     fn math_constant
88081–88092    12  literals                 private*     enum EnumMember
88094–88103    10  assignments              private*     enum Compound
88105–88151    47  operators                private*     fn comparable_without_coercing
88153–88159     7  operators                lower        fn bitwise_operator_of
88161–88182    22  parameters               lower        fn known_values
88184–88200    17  static_builtins          lower*       enum Intrinsic
88202–88208     7  arguments                lower*       struct Argument
88210–88214     5  arguments                private*     impl Argument
88211–88213     3  arguments                lower          method expression
88216–88233    18  parameters               lower*       enum Omitted
88235–88252    18  places                   lower*       enum Unwritable
88254–88402   149  places                   lower*       enum Place
88404–88406     3  lower                    private      type JumpTarget
88408–88415     8  branch_values            lower*       enum Connective
88417–88437    21  iterable_walks           lower*       enum Over
88439–88455    17  iterable_walks           lower*       enum Binds
88457–88459     3  iterable_walks           private*     type NativeMethod
88461–88472    12  iterable_walks           lower*       struct NativeWalk
88474–88491    18  iterable_walks           lower*       enum NativeBy
88493–88499     7  iterable_walks           lower*       struct VectorMethods
88501–88509     9  iterable_walks           private*     struct IteratorMethods
88511–88522    12  table_methods            lower        fn walks_pairs
88524–88543    20  table_methods            lower        fn table_fill
88545–88655   111  iterable_walks           lower*       enum Walk
88657–88672    16  statement_branches       private*     struct CaseChain
88674–88687    14  coercion                 hir facade   fn same_slot
88689–88749    61  coercion                 private*     enum NotAPrefix
88751–88804    54  coercion                 private*     impl NotAPrefix
88752–88803    52  coercion                 lower          method spell
88806–88828    23  native_calls             lower*       enum Native
88830–88955   126  statement_branches       lower*       enum Branch
88957–88965     9  names                    lower        fn is_override_name
88967–88967     1  lower                    private      mod overload_results
88969–88970     2  lower                    private      mod result_overload_tests
88972–88973     2  lower                    private      mod implementation_tests
88975–88976     2  lower                    private      mod import_phase_tests
88978–88979     2  lower                    private      mod collection_tests
88980–88981     2  lower                    private      mod view_class_tests
88983–88984     2  lower                    private      mod carried_reference_tests
88986–88986     1  lower                    private      mod binding_thens
88987–88987     1  lower                    private      mod type_bases
88989–88990     2  lower                    private      mod storage_ancestry_tests
88992–88993     2  lower                    private      mod container_layout_tests
88995–88996     2  lower                    private      mod binding_ancestry_tests
88998–88999     2  lower                    private      mod native_lookup_tests
89001–89002     2  lower                    private      mod collection_view_tests
89004–89797   794  tests                    private      inline mod tests
89006–89006     1  tests                    private        use super :: super :: { Field , Layout , Program }
89007–89007     1  tests                    private        use super :: { MemberKey , TypeId }
89009–89068    60  tests                    private*       fn only_the_typed_receiver_fact_proves_its_class_representation
89070–89092    23  tests                    private*       fn semantic_computed_numbers_use_javascript_property_spelling
89094–89186    93  tests                    private*       fn a_private_template_member_needs_equal_source_arguments_and_storage
89188–89245    58  tests                    private*       fn an_anonymous_field_schema_shares_its_source_supplier_in_either_demand_order
89247–89331    85  tests                    private*       fn anonymous_reservations_survive_layout_demand_order
89333–89351    19  tests                    private*       fn layout
89353–89423    71  tests                    private*       fn one_type_laid_out_two_ways_is_recorded
89425–89449    25  tests                    private*       fn a_disputed_layout_is_reported_by_verify
89451–89558   108  tests                    private*       fn two_roots_of_one_name_declare_one_shell
89560–89599    40  tests                    private*       fn a_second_declaration_of_one_name_is_named_apart_on_merge_too
89601–89625    25  tests                    private*       fn a_foreign_layout_name_is_its_identity
89627–89627     1  tests                    private        use super :: { closure_type , parse_bigint , parse_handle_constant , parse_number }
89629–89660    32  tests                    private*       fn native_pointer_constant_bits_are_lossless_and_bounded
89662–89687    26  tests                    private*       fn bigint_literal_and_guard_spellings_are_exact
89689–89733    45  tests                    private*       fn no_closure_id_lands_in_a_reserved_band
89735–89756    22  tests                    private*       fn the_reserved_bands_are_disjoint
89758–89773    16  tests                    private*       fn a_literal_parses_as_the_double_it_denotes
89775–89796    22  tests                    private*       fn seventeen_significant_digits_survive
89799–89799     1  lower                    private      mod access
89800–89800     1  lower                    private      mod access_families
89801–89801     1  lower                    private      mod access_family_flow
89802–89802     1  lower                    private      mod access_family_functions
89803–89803     1  lower                    private      mod access_family_sites
89804–89804     1  lower                    private      mod array_construction
89805–89805     1  lower                    private      mod assertions
89806–89806     1  lower                    private      mod bigint
89807–89807     1  lower                    private      mod callable_fields
89808–89808     1  lower                    private      mod cast_descriptions
89809–89809     1  lower                    private      mod claimed_reads
89810–89810     1  lower                    private      mod closure_context
89811–89811     1  lower                    private      mod construction
89812–89812     1  lower                    private      mod elision_patterns
89813–89813     1  lower                    private      mod equality
89814–89814     1  lower                    private      mod field_initialization
89815–89815     1  lower                    private      mod function_names
89816–89816     1  lower                    private      mod gobject
89817–89817     1  lower                    private      mod implementations
89818–89818     1  lower                    private      mod initialization
89819–89819     1  lower                    private      mod interfaces
89820–89820     1  lower                    private      mod iterator_calls
89821–89821     1  lower                    private      mod iterator_close
89822–89822     1  lower                    private      mod json
89823–89823     1  lower                    private      mod layout_collection
89824–89824     1  lower                    private      mod literal_methods
89825–89825     1  lower                    private      mod made_instance
89826–89826     1  lower                    private      mod member_origins
89827–89827     1  lower                    private      mod native_memory
89828–89828     1  lower                    private      mod numeric_arguments
89829–89829     1  lower                    private      mod object_assign
89830–89830     1  lower                    private      mod parameter_entries
89831–89831     1  lower                    private      mod printed
89832–89832     1  lower                    private      mod project_semantics
89833–89833     1  lower                    private      mod property_keys
89834–89834     1  lower                    private      mod reference_index
89835–89835     1  lower                    private      mod scopes
89836–89836     1  lower                    private      mod string_positions
89837–89837     1  lower                    private      mod typed_signatures
89838–89838     1  lower                    private      mod uniform_inputs
89839–89839     1  lower                    private      mod virtual_returns
89841–89849     9  array_methods            lower        fn holds_counted
89851–89860    10  array_methods            lower*       enum Counts
89862–89883    22  array_methods            lower        fn counted_helper
89885–89892     8  objc_dispatch            lower*       struct ObjcProperty
89894–89921    28  objc_dispatch            lower        fn accessor_signature
89923–89930     8  native_modules           lower*       struct LinkTag
89932–89955    24  native_modules           private*     impl LinkTag
89933–89938     6  native_modules           private*       associated const FRAMEWORK
89939–89946     8  native_modules           private*       associated const LIBRARY
89947–89954     8  native_modules           private*       associated const PACKAGE
89957–89962     6  objc_dispatch            private*     struct ObjcClassMember
89964–89999    36  native_calls             lower        fn synthesized
90001–90029    29  native_calls             lower        fn bridge_send
90031–90051    21  foreign_results          lower        fn split_hidden_throws
90053–90066    14  foreign_results          lower        fn append_error_slot
90068–90120    53  foreign_callbacks        lower        fn bridge_blocks
90122–90129     8  foreign_values           lower*       enum StringsBridged
90131–90216    86  foreign_values           lower        fn bridge_strings
90218–90226     9  native_calls             private*     fn symbol_tagged
90228–90232     5  array_methods            lower*       enum Pending
90234–90240     7  array_methods            lower*       struct Spread
90242–90243     2  lower                    private      mod immutable_context_tests
90245–90246     2  lower                    private      mod context_scaling
```

</details>

<details>
<summary>All 1,245 methods in the large FuncBuilder impl</summary>

```text
   first–last  lines  destination              visibility   method
23334–23345    12  lower                    private      method probe
23347–23445    99  lower                    private      method new
23447–23463    17  lower                    private      method within
23465–23480    16  lower                    private      method instantiating
23482–23578    97  branch_values            lower        method merged_type
23580–23590    11  lower                    private      method push_block_param
23592–23596     5  lower                    private      method new_block
23598–23600     3  lower                    private      method switch_to
23602–23608     7  lower                    private      method is_terminated
23610–23616     7  lower                    private      method terminate
23618–23651    34  module_namespaces        lower        method imported_from
23653–23655     3  snapshot_queries         lower        method node
23657–23669    13  snapshot_queries         lower        method declared_in_program_source
23671–23673     3  snapshot_queries         lower        method origin
23675–23677     3  snapshot_queries         lower        method location
23679–23716    38  snapshot_queries         lower        method children
23718–23735    18  snapshot_queries         lower        method syntactic_parent
23737–23762    26  snapshot_queries         lower        method binding_parents
23764–23770     7  snapshot_queries         lower        method subtree
23772–23791    20  snapshot_queries         lower        method names_a_member
23793–23798     6  snapshot_queries         lower        method kind_of
23800–23870    71  returns                  lower        method return_type_of
23872–23959    88  optional_chains          lower        method without_chain_absence
23961–23992    32  optional_chains          private*     method chain_links
23994–23997     4  optional_chains          lower        method pending_chain
23999–24010    12  optional_chains          lower        method lower_chain
24012–24042    31  optional_chains          lower        method chain_step
24044–24064    21  optional_chains          lower        method chain_for_effect
24066–24115    50  optional_chains          private*     method chain_effect_step
24117–24173    57  optional_chains          lower        method member_on_present
24175–24204    30  optional_chains          lower        method ends_an_optional_chain
24206–24218    13  snapshot_queries         lower        method mentions
24220–24258    39  returns                  lower        method returned_by
24260–24299    40  returns                  private*     method contextual_return
24301–24383    83  returns                  lower        method contextual_return_type
24385–24451    67  returns                  lower        method declared_return
24453–24510    58  returns                  lower        method materialize
24512–24519     8  call_expression          lower        method is_function_typed
24521–24540    20  call_expression          lower        method spelling_for
24542–24581    40  call_expression          private*     method names_a_declared_function
24583–24592    10  lower                    private      method type_of
24594–24606    13  lower                    private      method represent
24608–24613     6  lower                    private      method push
24615–24619     5  diagnostics              lower        method unrepresentable
24621–24635    15  diagnostics              lower        method describe_node
24637–24651    15  diagnostics              lower        method unrepresentable_member
24653–24679    27  snapshot_queries         lower        method denoted_symbol
24681–24702    22  snapshot_queries         lower        method names_a_namespace
24704–24724    21  snapshot_queries         lower        method declared_in_namespace_of
24726–24907   182  diagnostics              lower        method describe_name
24909–24937    29  snapshot_queries         lower        method library_global
24939–24955    17  snapshot_queries         lower        method provided_global_member
24957–24971    15  snapshot_queries         lower        method is_module_scope
24973–25002    30  capture_discovery        private*     method per_iteration_loop
25004–25058    55  capture_discovery        private*     method rebinding_refusal
25060–25071    12  snapshot_queries         lower        method declaration_kind
25073–25086    14  snapshot_queries         lower        method written_in_the_body_of
25088–25101    14  snapshot_queries         lower        method is_callee
25103–25183    81  type_tests               lower        method reflection_of_a_layout
25185–25233    49  property_keys            lower        method member_access
25235–25246    12  property_keys            lower        method member_access_key
25248–25252     5  property_keys            lower        method member_read_from
25254–25264    11  snapshot_queries         lower        method ancestor
25266–25283    18  snapshot_queries         lower        method is_nested_closure
25285–25287     3  snapshot_queries         lower        method is_within_a_function
25289–25389   101  literals                 lower        method constant_value
25391–25400    10  call_expression          lower        method has_a_body
25402–25414    13  call_expression          lower        method defines
25416–25463    48  call_expression          lower        method emitted_callee_name
25465–25477    13  diagnostics              lower        method unsupported
25479–25501    23  diagnostics              private*     method unprovided
25503–25519    17  diagnostics              lower        method refuse_nameless
25521–25574    54  call_expression          lower        method is_an_overload_signature
25576–25641    66  body_entries             lower        method method_body
25643–25692    50  accessors                lower        method static_accessor_read
25694–25703    10  names                    lower        method qualified_class_name
25705–25751    47  names                    lower        method class_name_for
25753–25782    30  names                    lower        method method_return_type
25784–25891   108  gobject_class            lower        method lower_gobject_member
25893–25907    15  gobject_class            private*     method vfunc_outs
25909–25964    56  gobject_class            private*     method vfunc_entry
25966–25996    31  gobject_class            private*     method vfunc_answer
25998–26143   146  gobject_class            private*     method lower_vfunc_slot
26145–26202    58  tuples                   lower        method tuple_element
26204–26217    14  gobject_templates        lower        method lower_template_callback
26219–26237    19  gobject_templates        lower        method lower_template_callback_with
26239–26283    45  gobject_templates        lower        method template_callback_entry
26285–26321    37  gobject_templates        private*     method lower_template_reader
26323–26375    53  gobject_class            private*     method overridden_vfunc
26377–26438    62  com_class                lower        method lower_com_member
26440–26502    63  com_class                private*     method forwarded
26504–26528    25  com_class                private*     method overridden_slot
26530–26550    21  objc_class               private*     method program_method_selector
26552–26647    96  objc_class               lower        method lower_selector
26649–26731    83  objc_class               lower        method lower_objc_method
26733–26744    12  objc_class               private*     method objc_requires
26746–26767    22  gobject_class            lower        method gobject_super_call
26769–26861    93  gobject_class            private*     method lower_gobject_chain_up
26863–26927    65  gobject_class            private*     method chain_up_answering_a_tuple
26929–27008    80  tuples                   lower        method make_tuple
27010–27022    13  com_class                lower        method opens_with_super
27024–27084    61  com_class                private*     method lower_com_constructor
27086–27108    23  com_class                lower        method com_super
27110–27118     9  com_class                private*     method compose_named
27120–27180    61  gobject_class            private*     method lower_gobject_constructor
27182–27194    13  gobject_class            lower        method gobject_super
27196–27266    71  objc_class               lower        method lower_objc_constructor
27268–27371   104  objc_class               lower        method lower_objc_super_init
27373–27388    16  receiver_binding         lower        method this_instance_type
27390–27397     8  objc_class               lower        method objc_chain
27399–27429    31  objc_class               private*     method lower_objc_state
27431–27478    48  objc_class               private*     method refuse_reaching_initializers
27480–27491    12  objc_class               lower        method is_program_objc_field
27493–27500     8  objc_class               lower        method chain_stores
27502–27582    81  objc_class               lower        method objc_state_layout
27584–27615    32  objc_class               lower        method program_objc_instance_place
27617–27640    24  objc_class               lower        method state_place
27642–27670    29  gobject_templates        lower        method property_notify_thunk
27672–27773   102  gobject_templates        lower        method lower_gobject_property_accessor
27775–27882   108  objc_class               private*     method lower_objc_field_accessor
27884–27907    24  gobject_templates        lower        method property_requirement
27909–27974    66  gobject_templates        lower        method template_child
27976–27986    11  objc_class               lower        method state_by_type
27988–28012    25  objc_class               lower        method state_of_type
28014–28022     9  objc_class               lower        method objc_protocols
28024–28032     9  type_tests               lower        method native_bases
28034–28064    31  objc_class               private*     method overridden_selector
28066–28081    16  objc_class               private*     method protocol_selector
28083–28137    55  names                    lower        method emitted_member_name
28139–28382   244  body_entries             lower        method lower_method_of
28384–28394    11  receiver_binding         lower        method lower_this
28396–28444    49  receiver_binding         lower        method this_is_never_bound
28446–28490    45  receiver_binding         lower        method never_binds_this
28492–28510    19  receiver_binding         private*     method extends_null
28512–28519     8  receiver_binding         lower        method throw_unbound_this
28521–28542    22  receiver_binding         lower        method literal_member_is_storage
28544–28554    11  receiver_binding         lower        method is_within
28556–28569    14  receiver_binding         lower        method is_a_literal_method
28571–28578     8  receiver_binding         lower        method declaration_reads_this
28580–28618    39  receiver_binding         lower        method binds_this
28620–28635    16  receiver_binding         lower        method first_this
28637–28654    18  receiver_binding         private*     method mentions_this
28656–28665    10  receiver_binding         lower        method declares_nothing
28667–28683    17  expression_types         private*     method narrowed_collection_view
28685–28704    20  expression_types         lower        method collection_view
28706–28720    15  expression_types         lower        method tagged_collection_view
28722–28978   257  expression_types         lower        method narrowed
28980–29079   100  diagnostics              lower        method refuse_a_foreign_layout
29081–29160    80  property_keys            lower        method literal_name
29162–29213    52  property_keys            private*     method numeric_member_name
29215–29231    17  property_keys            private*     method constant_number
29233–29251    19  property_keys            lower        method constant_member_name
29253–29279    27  property_keys            lower        method name_node
29281–29284     4  property_keys            lower        method member_name
29286–29291     6  property_keys            lower        method member_key
29293–29307    15  property_keys            lower        method property_key
29309–29319    11  property_keys            private*     method expression_key
29321–29338    18  property_keys            lower        method access_key
29340–29347     8  property_keys            lower        method required_access_key
29349–29358    10  property_keys            private*     method symbol_property_key
29360–29366     7  property_keys            lower        method well_known_property_key
29368–29384    17  names                    lower        method declared_instance_type
29386–29392     7  module_namespaces        lower        method names_a_module_without_effects
29394–29401     8  module_namespaces        lower        method holds_a_namespace
29403–29441    39  module_namespaces        lower        method denotes_a_module
29443–29475    33  property_keys            lower        method called_member_name
29477–29493    17  property_keys            lower        method indexed_member_name
29495–29513    19  property_keys            lower        method names_one_member
29515–29532    18  array_methods            lower        method holds_an_array
29534–29563    30  property_presence        private*     method stands_for_its_own_class
29565–29636    72  property_presence        lower        method names_a_property
29638–29691    54  expression_types         lower        method every_arm_descends_from
29693–29711    19  coercion                 lower        method coerce
29713–29731    19  coercion                 lower        method coerce_from
29733–29824    92  foreign_arguments        lower        method coerce_to_native_pointer
29826–29909    84  foreign_arguments        lower        method crossing_storage
29911–29936    26  returns                  lower        method result_without_an_erased_form
29938–29980    43  returns                  lower        method result_of_another_kind
29982–30024    43  returns                  lower        method result_of_another_layout
30026–30055    30  returns                  private*     method closure_results
30057–30118    62  signature_entries        lower        method record_arrival
30120–30390   271  coercion                 lower        method coerce_arm
30392–30404    13  absence                  lower        method erased_slots_at
30406–30439    34  absence                  lower        method absence_at_excluding
30441–30499    59  absence                  lower        method absence_of_type
30501–30523    23  coercion                 private*     method laid_out_as_a_prefix
30525–30565    41  coercion                 private*     method native_field_view
30567–30595    29  coercion                 private*     method carried_owners_fit
30597–30647    51  coercion                 private*     method unrelated_class_keeps_its_methods
30649–30652     4  coercion                 private*     method extends
30654–30761   108  coercion                 lower        method not_a_prefix
30763–30844    82  coercion                 private*     method one_slot
30846–30883    38  foreign_arguments        lower        method coerce_to_parameter
30885–30907    23  foreign_arguments        private*     method native_slot
30909–30913     5  foreign_arguments        lower        method lends_handles
30915–30925    11  foreign_arguments        lower        method fills_records
30927–31047   121  foreign_arguments        lower        method parameter_representation
31049–31147    99  places                   lower        method lower_delete
31149–31207    59  places                   private*     method the_absence_has_a_slot
31209–31301    93  typeof_expression        lower        method typeof_from_the_checkers_type
31303–31319    17  typeof_expression        lower        method through_parentheses
31321–31349    29  typeof_expression        lower        method through_assertions
31351–31396    46  typeof_expression        private*     method operand_has_no_effects
31398–31426    29  typeof_expression        private*     method literal_method_typeof
31428–31445    18  typeof_expression        lower        method constant_name
31447–31487    41  typeof_expression        lower        method asks_what_is_provided
31489–31501    13  typeof_expression        lower        method intrinsic_typeof
31503–31520    18  typeof_expression        private*     method intrinsic_named_by
31522–31535    14  typeof_expression        lower        method intrinsic_declared_by
31537–31678   142  typeof_expression        lower        method lower_typeof
31680–31712    33  module_binding_bodies    lower        method check_initialized
31714–31743    30  module_binding_bodies    lower        method check_binding_ready
31745–31754    10  module_binding_bodies    lower        method check_initialized_place
31756–31785    30  module_binding_bodies    lower        method check_class_binding
31787–31803    17  module_binding_bodies    lower        method mark_initialized
31805–31931   127  module_binding_bodies    lower        method lower_module_binding
31933–31953    21  module_binding_bodies    lower        method static_named_prototype
31955–31975    21  module_binding_bodies    lower        method member_named_at_run_time
31977–32077   101  module_binding_bodies    lower        method lower_static_fields
32079–32103    25  module_binding_bodies    private*     method lower_destructured_module_binding
32105–32139    35  module_evaluation        private*     method lower_module_statement
32141–32328   188  module_evaluation        private*     method lower_module_evaluate
32330–32411    82  module_namespaces        lower        method lower_dynamic_import
32413–32440    28  module_namespaces        private*     method import_of_nothing
32442–32467    26  module_namespaces        private*     method rejected_import
32469–32533    65  module_namespaces        private*     method import_options
32535–32541     7  body_entries             lower        method lower_for_its_effects
32543–32630    88  module_namespaces        lower        method lower_module_job
32632–32646    15  module_namespaces        lower        method namespace_layout
32648–32677    30  module_evaluation        private*     method fail_module_evaluation
32679–32697    19  module_evaluation        private*     method lower_module_init
32699–32727    29  names                    lower        method emitted_function_name
32729–32877   149  body_entries             lower        method lower_function
32879–32918    40  body_entries             private*     method end_method_body
32920–33040   121  suspended_bodies         lower        method begin_generator
33042–33092    51  suspended_bodies         lower        method begin_async
33094–33155    62  closure_bodies           private*     method closure_parameters
33157–33201    45  suspended_bodies         lower        method promise_before_inputs
33203–33215    13  closure_bodies           lower        method reserved_return_type
33217–33292    76  closure_bodies           private*     method closure_inputs
33294–33527   234  closure_bodies           private*     method lower_closure
33529–33627    99  receiver_binding         lower        method receive_this
33629–33634     6  receiver_binding         lower        method param_value
33636–33669    34  closure_bodies           lower        method why_the_closure_cannot_be_captured
33671–33692    22  closure_bodies           private*     method lower_made_closure
33694–33800   107  thenable_jobs            lower        method lower_thenable_job
33802–33826    25  thenable_jobs            private*     method thenable_type
33828–33848    21  thenable_jobs            private*     method resolving_function
33850–34012   163  thenable_jobs            lower        method lower_resolving_function
34014–34134   121  promise_reactions        private*     method reaction_shape
34136–34152    17  promise_reactions        lower        method promise_reaction
34154–34219    66  promise_reactions        private*     method subscribe_a_reaction
34221–34296    76  bound_functions          private*     method bound_shape
34298–34329    32  bound_functions          private*     method bound_parameters
34331–34364    34  bound_functions          lower        method bound_parameter_types
34366–34444    79  bound_functions          lower        method lower_bound_function
34446–34513    68  bound_functions          private*     method bound_extras_are_ignored
34515–34575    61  bound_functions          lower        method lower_bind
34577–34738   162  promise_reactions        lower        method lower_reaction
34740–34766    27  promise_reactions        private*     method read_fulfilment
34768–34854    87  promise_reactions        private*     method call_a_reaction_handler
34856–34877    22  call_expression          lower        method method_signature
34879–34955    77  bound_functions          lower        method closure_bound_to
34957–35055    99  bound_functions          lower        method lower_wrapper_body
35057–35116    60  bound_functions          lower        method wrapper_callee_that_raises
35118–35174    57  bound_functions          private*     method wrapped_call
35176–35243    68  bound_functions          private*     method method_receiver
35245–35284    40  bound_functions          lower        method bind_receiver
35286–35325    40  closure_values           private*     method captured_as
35327–35400    74  closure_values           lower        method bind_captures
35402–35425    24  promise_settlement       lower        method settler_promise_type
35427–35433     7  closure_values           lower        method cell_of
35435–35455    21  foreign_values           lower        method box_handle
35457–35477    21  closure_values           lower        method boxed
35479–35503    25  foreign_values           lower        method handle_box_layout
35505–35526    22  foreign_values           lower        method declared_result_type
35528–35564    37  foreign_values           lower        method boxed_record_layout
35566–35586    21  foreign_values           lower        method unboxed_argument
35588–35637    50  foreign_values           lower        method unbox_record
35639–35659    21  foreign_values           lower        method box_record
35661–35686    26  foreign_values           lower        method new_boxed_record
35688–35731    44  closure_values           private*     method cell_layout
35733–35738     6  closure_values           lower        method is_guarded
35740–35779    40  closure_values           lower        method open_cell
35781–35790    10  closure_values           lower        method opened_cell
35792–35852    61  closure_values           lower        method constructed_from_a_value
35854–35885    32  closure_values           lower        method open_cell_early
35887–35906    20  closure_values           lower        method open_class_cell
35908–35957    50  closure_values           lower        method read_cell
35959–35966     8  member_layouts           lower        method program_layout_field
35968–35987    20  closure_values           lower        method closure_layout
35989–36054    66  lower                    private      method finish
36056–36065    10  parameters               lower        method default_of
36067–36092    26  parameters               lower        method parameter_symbols
36094–36112    19  arguments                lower        method lower_arguments
36114–36125    12  arguments                lower        method lower_arguments_on
36127–36140    14  arguments                lower        method lower_native_arguments
36142–36155    14  arguments                private*     method lower_arguments_gathering
36157–36339   183  arguments                lower        method lower_argument_values
36341–36351    11  absence                  lower        method undefined_argument
36353–36436    84  parameters               lower        method unless_undefined
36438–36450    13  snapshot_queries         lower        method builtin_binding_at
36452–36454     3  parameters               lower        method is_the_undefined_literal
36456–36485    30  parameters               lower        method admits_undefined
36487–36588   102  parameters               lower        method lower_parameter_default
36590–36704   115  arguments                private*     method gather_rest
36706–36745    40  arguments                private*     method gather_rest_with_spreads
36747–36805    59  arguments                lower        method concat_onto
36807–36836    30  absence                  lower        method absent_argument
36838–36859    22  foreign_arguments        lower        method parameter_tags
36861–36876    16  parameters               lower        method omitted_by_default
36878–36911    34  parameters               lower        method implementation_of
36913–36942    30  parameters               lower        method overriding_signature
36944–36981    38  parameters               lower        method effective_parameters
36983–37000    18  parameters               lower        method fixed_arity_positions
37002–37014    13  parameters               lower        method tuple_shape
37016–37057    42  parameters               private*     method declared_parameters
37059–37079    21  parameters               lower        method parameters_declared_by
37081–37086     6  parameters               private*     method argument_callee
37088–37093     6  parameters               lower        method parameter_shapes
37095–37125    31  parameters               lower        method fixed_arity
37127–37129     3  parameters               lower        method parameter_type_id
37131–37151    21  parameters               lower        method declared_default
37153–37163    11  parameters               lower        method declared_parameter
37165–37258    94  parameters               lower        method omitted_after
37260–37296    37  snapshot_queries         lower        method symbol_declared_by
37298–37364    67  construct_expressions    lower        method store_parameter_properties
37366–37412    47  construct_expressions    private*     method store_objc_parameter_property
37414–37423    10  foreign_arguments        lower        method lower_param_or_labels
37425–37462    38  foreign_arguments        lower        method finish_params
37464–37506    43  foreign_arguments        private*     method lower_label_params
37508–37540    33  foreign_arguments        private*     method make_pending_labels
37542–37554    13  construct_expressions    lower        method declares_instance_fields
37556–37573    18  construct_expressions    lower        method declares_a_field
37575–37623    49  arguments                lower        method rest_element_of_a_tuple_union
37625–37642    18  arguments                lower        method after_substitution
37644–37650     7  arguments                lower        method tuple_union_as_array
37652–37719    68  arguments                private*     method element_of_a_tuple_union
37721–37846   126  arguments                lower        method lower_positional_rest
37848–37900    53  arguments                private*     method gather_a_rest_into_a_struct
37902–37938    37  receiver_binding         lower        method annotates_this
37940–37942     3  parameters               lower        method lower_param
37944–38208   265  parameters               lower        method lower_param_binding
38210–38215     6  returns                  lower        method annotated
38217–38228    12  returns                  lower        method written_kind
38230–38235     6  returns                  lower        method written_scalar
38237–38259    23  coercion                 lower        method lower_assertion
38261–38274    14  returns                  lower        method oblige_local
38276–38287    12  returns                  lower        method written_kind_of_symbol
38289–38306    18  returns                  lower        method oblige
38308–38339    32  returns                  lower        method written_tuple_return
38341–38358    18  returns                  private*     method oblige_tuple_return
38360–38380    21  returns                  lower        method oblige_returned_element
38382–38390     9  returns                  lower        method written_return
38392–38441    50  absence                  lower        method result_absent
38443–38476    34  foreign_values           lower        method lent_hstring_param
38478–38739   262  returns                  lower        method lower_return
38741–38798    58  body_entries             lower        method lower_block
38800–38814    15  snapshot_queries         lower        method is_a_global
38816–38855    40  loop_flow                lower        method carried_locals
38857–38913    57  loop_flow                lower        method stands_on_the_target_side
38915–38964    50  loop_flow                lower        method assigned_symbols
38966–39009    44  loop_flow                lower        method written_target
39011–39077    67  loop_flow                lower        method target_names
39079–39108    30  loop_flow                lower        method declared_symbols
39110–39141    32  loop_flow                lower        method lower_while
39143–39278   136  statement_branches       lower        method lower_switch
39280–39387   108  statement_branches       private*     method lower_case_chain
39389–39430    42  statement_branches       private*     method covers_every_case
39432–39494    63  loop_flow                lower        method lower_do_while
39496–39600   105  loop_flow                lower        method begin_loop
39602–39640    39  loop_flow                private*     method enter_loop
39642–39671    30  loop_flow                lower        method test_loop
39673–39689    17  loop_flow                lower        method exit_of
39691–39760    70  loop_flow                lower        method end_loop
39762–39817    56  returns                  lower        method close_body
39819–39863    45  returns                  private*     method falls_off_to_undefined
39865–39868     4  loop_flow                lower        method carried_now
39870–39886    17  loop_flow                lower        method lower_break
39888–39907    20  loop_flow                lower        method lower_continue
39909–39970    62  suspended_bodies         lower        method lower_yield
39972–40052    81  suspended_bodies         private*     method lower_yield_star
40054–40061     8  snapshot_queries         lower        method is_a_statement
40063–40140    78  suspended_bodies         lower        method lower_await
40142–40276   135  static_builtins          private*     method lower_decided_static
40278–40338    61  array_from               lower        method lower_array_from_mapped
40340–40415    76  array_from               private*     method map_a_walk
40417–40419     3  array_from               lower        method lower_array_from
40421–40447    27  array_from               lower        method collection_append
40449–40475    27  array_from               lower        method append_collection_value
40477–40512    36  array_from               private*     method collection_bound
40514–40656   143  array_from               lower        method collect_a_walk
40658–40694    37  array_from               private*     method fill_from_table
40696–40741    46  array_from               private*     method build_array_from
40743–40762    20  array_from               lower        method collection_walk
40764–40794    31  array_from               private*     method store_and_advance
40796–40818    23  array_from               private*     method collected_element
40820–40862    43  array_from               lower        method walk_element
40864–41016   153  object_builtins          lower        method decide_object_columns
41018–41034    17  object_builtins          private*     method object_entry
41036–41104    69  object_builtins          lower        method pair_of
41106–41198    93  object_builtins          private*     method own_layout
41200–41211    12  object_builtins          lower        method own_names
41213–41257    45  object_builtins          private*     method as_that_literal_writes_them
41259–41297    39  object_builtins          private*     method written_as_a_literal
41299–41445   147  object_builtins          lower        method enumerable_fields
41447–41468    22  object_builtins          lower        method own_accessor
41470–41483    14  object_builtins          lower        method declared_in_an_object_literal
41485–41490     6  object_builtins          lower        method declared_in_a_class
41492–41516    25  object_builtins          private*     method declared_within
41518–41528    11  object_builtins          private*     method optional_property_of
41530–41645   116  table_methods            private*     method lower_table_for_each
41647–41758   112  table_methods            lower        method lower_delegated_for_each
41760–41880   121  object_builtins          lower        method decide_object_is
41882–41966    85  object_builtins          private*     method object_is_numbers
41968–42041    74  object_builtins          lower        method decide_object_keys
42043–42136    94  object_builtins          lower        method decide_object_create
42138–42189    52  object_builtins          lower        method decide_object_assign
42191–42300   110  property_presence        lower        method decide_has_own
42302–42328    27  primitive_conversion     lower        method decide_as_n
42330–42341    12  primitive_conversion     lower        method only_primitives
42343–42374    32  primitive_conversion     private*     method numeric_primitives
42376–42410    35  typeof_expression        lower        method decide_is_view
42412–42434    23  typeof_expression        private*     method ask_the_runtime_is_array
42436–42581   146  typeof_expression        lower        method decide_is_array
42583–42744   162  static_builtins          lower        method lower_special_call
42746–42782    37  promise_settlement       lower        method lower_promise_static
42784–42869    86  promise_settlement       private*     method combinator
42871–42884    14  promise_settlement       lower        method names_a_promise_capability
42886–42922    37  promise_settlement       private*     method is_a_capability_type
42924–42946    23  promise_settlement       private*     method promise_capability
42948–42983    36  promise_settlement       lower        method lower_capability_call
42985–43001    17  promise_settlement       private*     method settle_capability
43003–43040    38  promise_settlement       lower        method capability_settle
43042–43082    41  promise_settlement       private*     method settle_lowered
43084–43107    24  promise_settlement       lower        method settled_around
43109–43144    36  thenable_jobs            lower        method settled_promise
43146–43290   145  thenable_jobs            lower        method settle_through_thenables
43292–43354    63  thenable_jobs            private*     method check_delivery
43356–43380    25  thenable_jobs            lower        method thenable_candidates
43382–43425    44  thenable_jobs            lower        method binding_thenable
43427–43439    13  thenable_jobs            private*     method resolved_node
43441–43480    40  thenable_jobs            private*     method queue_thenable_job
43482–43501    20  thenable_jobs            lower        method settle_and_return
43503–43563    61  promise_settlement       lower        method settle
43565–43688   124  promise_settlement       lower        method fulfil
43690–43714    25  returns                  private*     method return_from_callback
43716–43759    44  loop_flow                private*     method enclosing
43761–43807    47  loop_flow                lower        method lower_for
43809–43902    94  iterable_walks           lower        method walk_condition
43904–43950    47  iterable_walks           lower        method walk_start
43952–43962    11  iterable_walks           lower        method unlend_walked
43964–43974    11  iterable_walks           private*     method cursor_of_presence
43976–44073    98  generator_iteration      private*     method async_generator_step
44075–44161    87  generator_iteration      lower        method protocol_step
44163–44174    12  generator_iteration      lower        method generator_element_of
44176–44301   126  generator_iteration      lower        method generator_walk
44303–44342    40  generator_iteration      private*     method generator_element
44344–44459   116  generator_iteration      lower        method generator_next
44461–44476    16  generator_iteration      private*     method generator_dispatch
44478–44506    29  generator_iteration      lower        method generator_declared
44508–44534    27  generator_iteration      lower        method generator_in_context
44536–44658   123  iterable_walks           private*     method protocol_walk
44660–44682    23  property_presence        lower        method property_is_readonly
44684–44687     4  returns                  lower        method member_returns
44689–44704    16  returns                  lower        method member_return_type
44706–44745    40  symbol_builtins          lower        method lower_symbol_new
44747–44763    17  symbol_builtins          lower        method lower_symbol_for
44765–44789    25  symbol_builtins          lower        method lower_symbol_key_for
44791–44808    18  lower                    private      method call_runtime
44810–44860    51  iterable_walks           lower        method sequence_source
44862–44905    44  iterable_walks           lower        method pair_walk
44907–45037   131  iterable_walks           lower        method walk_of
45039–45056    18  iterable_walks           private*     method native_iteration
45058–45082    25  iterable_walks           private*     method members_of
45084–45143    60  iterable_walks           private*     method native_walk
45145–45160    16  iterable_walks           private*     method element_as_declared
45162–45175    14  iterable_walks           lower        method host_downcast
45177–45201    25  iterable_walks           lower        method walk_method
45203–45217    15  iterable_walks           lower        method delegated_collection
45219–45246    28  iterable_walks           lower        method delegated_walk
45248–45280    33  iterable_walks           lower        method call_native_walk
45282–45354    73  iterable_walks           lower        method advance
45356–45484   129  iterable_walks           lower        method read_element
45486–45511    26  iterable_walks           private*     method for_of_pattern
45513–45566    54  iterable_walks           private*     method head_for_the_sequence
45568–45645    78  iterable_walks           private*     method for_of_head
45647–45662    16  iterable_walks           private*     method pattern_symbols
45664–45698    35  iterable_walks           private*     method carry_what_the_head_assigns
45700–45732    33  iterable_walks           private*     method names_written_by
45734–45782    49  iterable_walks           private*     method bind_head
45784–45970   187  iterable_walks           lower        method lower_for_of
45972–46022    51  exceptions               lower        method record_rejection
46024–46066    43  coercion                 lower        method erased
46068–46074     7  coercion                 lower        method erased_from
46076–46104    29  exceptions               lower        method lower_throw
46106–46262   157  exceptions               lower        method throw_erased
46264–46306    43  type_tests               lower        method is_the_object_type
46308–46358    51  type_tests               lower        method natives_declaring
46360–46412    53  type_tests               lower        method in_on_a_native
46414–46440    27  type_tests               private*     method native_receiver
46442–46500    59  type_tests               lower        method native_test
46502–46546    45  branch_values            lower        method bool_join
46548–46729   182  property_presence        private*     method lower_in_over_every_class
46731–46785    55  property_presence        private*     method in_with_optional_memberships
46787–46834    48  property_presence        private*     method presence_bit_named
46836–46878    43  property_presence        private*     method candidate_layout
46880–46909    30  property_keys            lower        method private_name_key
46911–46926    16  property_keys            lower        method brand_owner
46928–46945    18  property_keys            private*     method enclosing_class_instance
46947–47046   100  property_presence        private*     method in_by_presence
47048–47239   192  property_presence        lower        method lower_in
47241–47269    29  hierarchy                lower        method with_subclasses
47271–47351    81  property_presence        private*     method in_over_a_structural_arm
47353–47390    38  property_presence        private*     method arms_declaring
47392–47437    46  property_presence        private*     method in_over_the_arms
47439–47495    57  property_presence        lower        method defined_at_construction
47497–47529    33  property_presence        lower        method declared_with_a_private_name
47531–47562    32  property_presence        lower        method declares
47564–47580    17  property_presence        private*     method literal_key
47582–47635    54  diagnostics              lower        method has_no_representation
47637–47645     9  type_tests               private*     method instanceof_global
47647–47758   112  type_tests               private*     method instanceof_native
47760–47893   134  type_tests               lower        method lower_instanceof
47895–48011   117  type_tests               private*     method instanceof_builtin
48013–48022    10  snapshot_queries         lower        method type_named
48024–48087    64  diagnostics              private*     method shaped_like
48089–48131    43  snapshot_queries         lower        method is_the_type_of_some_node
48133–48150    18  diagnostics              lower        method called_without_a_function
48152–48220    69  diagnostics              lower        method type_in_a_message
48222–48229     8  snapshot_queries         lower        method name_of_type
48231–48243    13  provided_errors          lower        method provided_errors_under
48245–48258    14  hierarchy                lower        method descends_from
48260–48345    86  loop_flow                private*     method lower_labeled_block
48347–48403    57  loop_flow                lower        method lower_labeled
48405–48521   117  exceptions               lower        method lower_try
48523–48603    81  exceptions               private*     method lower_unguarded
48605–48610     6  exceptions               private*     method finally_of
48612–48683    72  exceptions               private*     method lower_guarded
48685–48718    34  exceptions               lower        method unwind_to
48720–48834   115  exceptions               lower        method open_handler
48836–48852    17  exceptions               private*     method bind_caught
48854–48926    73  exceptions               private*     method join_try
48928–48934     7  lower                    private      method lower_expecting
48936–48940     5  lower                    private      method synthetic_symbol
48942–48979    38  snapshot_queries         lower        method child_slots
48981–48999    19  operators                lower        method lower_postfix_unary
49001–49061    61  assignments              lower        method lower_assignment
49063–49091    29  native_construction      lower        method native_construct
49093–49178    86  native_construction      private*     method lower_native_construct
49180–49227    48  native_construction      private*     method construct_with
49229–49283    55  native_construction      private*     method chosen_constructor
49285–49320    36  native_construction      lower        method constructed_properties
49322–49459   138  native_construction      private*     method passed_properties
49461–49512    52  native_construction      lower        method set_constructed
49514–49548    35  native_construction      private*     method constructed_setter
49550–49564    15  native_construction      private*     method write_constructed
49566–49609    44  gobject_class            lower        method gobject_new
49611–49670    60  gobject_class            private*     method lower_gobject_made
49672–49684    13  native_calls             lower        method call_foreign_named
49686–49711    26  native_calls             lower        method call_foreign_named_absent
49713–49729    17  native_calls             lower        method call_foreign_declaration
49731–49802    72  native_calls             private*     method call_foreign_declaration_absent
49804–49813    10  accessors                private*     method accessor_declarations
49815–49830    16  accessors                lower        method tagged_statement
49832–49867    36  accessors                lower        method accessor_nodes
49869–49903    35  accessors                lower        method accessor_read
49905–49926    22  accessors                lower        method delegated_accessor
49928–49941    14  accessors                lower        method delegated_named
49943–50005    63  accessors                lower        method delegated_typed_setter
50007–50019    13  assignments              lower        method assigned_value
50021–50036    16  accessors                lower        method method_takes
50038–50040     3  accessors                lower        method is_accessor_property
50042–50053    12  accessors                lower        method accessor
50055–50099    45  accessors                lower        method lower_accessor
50101–50186    86  accessors                private*     method lower_static_accessor
50188–50298   111  accessors                lower        method lower_slot_accessor
50300–50312    13  accessors                lower        method lower_accessor_on
50314–50444   131  accessors                lower        method call_bound_method
50446–50493    48  destructuring            private*     method assign_with_a_default
50495–50510    16  destructuring            private*     method assignment_default
50512–50611   100  destructuring            private*     method pattern_element_read
50613–50814   202  destructuring            lower        method assign_pattern
50816–50849    34  places                   private*     method static_field_place
50851–50869    19  places                   private*     method array_length_place
50871–50936    66  places                   private*     method delegated_place
50938–50980    43  places                   private*     method property_place
50982–51124   143  places                   private*     method property_place_on
51126–51211    86  places                   lower        method place_of
51213–51242    30  places                   lower        method immutable_binding
51244–51346   103  places                   lower        method place_for_symbol
51348–51394    47  native_properties        lower        method native_accessor_place
51396–51409    14  native_properties        lower        method read_native_accessor
51411–51458    48  array_methods            lower        method set_array_length
51460–51635   176  places                   lower        method read_place
51637–51703    67  array_construction       lower        method coerce_element
51705–51714    10  string_builtins          private*     method template_cooked
51716–51753    38  string_builtins          private*     method template_parts
51755–51810    56  string_builtins          lower        method lower_tagged_template
51812–51854    43  string_builtins          lower        method lower_template
51856–51877    22  string_builtins          lower        method join
51879–51926    48  absence                  private*     method voids_a_literal
51928–51974    47  absence                  lower        method absence_written_at
51976–51999    24  absence                  lower        method comparison_of_two_absences
52001–52012    12  string_builtins          lower        method implicit_printer_callees
52014–52075    62  string_builtins          lower        method printer_text
52077–52201   125  string_builtins          lower        method as_string
52203–52221    19  string_builtins          private*     method prints_off_its_descriptor
52223–52265    43  string_builtins          lower        method spells_itself
52267–52357    91  member_layouts           lower        method slot_type
52359–52420    62  coercion                 lower        method coerce_to_slot
52422–52448    27  accessors                lower        method void_where_a_setter_wants
52450–52466    17  accessors                private*     method setter_parameter
52468–52506    39  places                   lower        method field_set
52508–52544    37  places                   private*     method field_delete
52546–52568    23  places                   lower        method presence_of_key
52570–52592    23  places                   private*     method property_at
52594–52613    20  places                   private*     method presence_bit_of
52615–52646    32  gobject_templates        lower        method notify_property
52648–52842   195  places                   lower        method write_place
52844–52917    74  operators                lower        method push_bitwise
52919–53051   133  assignments              lower        method step
53053–53086    34  branch_values            lower        method statically_decided
53088–53142    55  branch_values            private*     method decided_value
53144–53211    68  branch_values            private*     method decided_typeof
53213–53226    14  branch_values            private*     method the_checker_decided
53228–53273    46  branch_values            private*     method reads_a_binding_that_can_change
53275–53294    20  branch_values            private*     method binding_can_be_written
53296–53332    37  branch_values            lower        method hoists_out_of
53334–53373    40  statement_branches       private*     method folded_branch
53375–53442    68  statement_branches       private*     method instanceof_proved_by
53444–53470    27  statement_branches       private*     method narrow_binding
53472–53495    24  statement_branches       private*     method narrow_for_the_arm
53497–53526    30  statement_branches       private*     method lower_narrowed_arm
53528–53575    48  statement_branches       private*     method lower_if_test
53577–53622    46  statement_branches       lower        method lower_jumps
53624–53652    29  statement_branches       lower        method connective
53654–53676    23  statement_branches       lower        method assigns
53678–53692    15  statement_branches       lower        method lower_arm
53694–53823   130  statement_branches       lower        method lower_if
53825–53864    40  statement_branches       private*     method narrow_after_the_if
53866–53875    10  body_entries             lower        method is_source_import
53877–54075   199  body_entries             lower        method lower_statement
54077–54188   112  body_entries             lower        method lower_expression
54190–54248    59  array_construction       private*     method holds_a_hole
54250–54280    31  array_construction       private*     method checker_called_it_unsettled
54282–54343    62  array_construction       private*     method a_stand_in_for_nothing
54345–54513   169  array_construction       private*     method array_literal_type
54514–54668   155  array_construction       lower        method lower_array_literal
54670–54698    29  array_construction       lower        method lower_empty_array
54700–54804   105  table_methods            lower        method lower_table_literal
54806–54850    45  table_methods            private*     method table_property
54852–54921    70  object_literals          private*     method contextual_union_member
54923–54949    27  object_literals          private*     method empty_object_literal
54951–55020    70  object_literals          private*     method as_its_own_record
55022–55050    29  object_literals          private*     method literal_object_type
55052–55060     9  object_literals          lower        method literal_member_owner
55062–55086    25  object_literals          private*     method literal_context_type
55088–55098    11  object_literals          private*     method unbuilt_literal
55100–55289   190  object_literals          lower        method lower_object_literal
55291–55392   102  object_literals          private*     method spread_into
55394–55442    49  property_keys            lower        method property_name
55444–55473    30  generator_iteration      lower        method is_iterator_return_arm
55475–55529    55  property_keys            lower        method property_parts
55530–55547    18  iteration_callbacks      lower        method fill_array_arguments
55549–55584    36  iteration_callbacks      lower        method fill_string_arguments
55586–55671    86  provided_errors          lower        method guard_reduce_has_elements
55673–55731    59  provided_errors          lower        method guard_repeat_count
55733–55850   118  string_builtins          lower        method guard_code_point
55852–55871    20  provided_errors          lower        method throw_provided_error
55873–55893    21  provided_errors          lower        method throw_provided_error_text
55895–55912    18  provided_errors          lower        method provided_error
55914–55968    55  provided_errors          lower        method provided_error_named
55970–55976     7  provided_errors          lower        method provided_layout
55978–56023    46  provided_errors          lower        method layout_for_provided_error
56025–56084    60  accessors                lower        method push_an_accessor_call
56086–56188   103  accessors                lower        method accessor_callee
56190–56259    70  accessors                lower        method a_default_inherits_the_handler
56261–56274    14  accessors                lower        method a_default_the_instance_cannot_answer
56276–56301    26  receiver_binding         lower        method reads_this
56303–56317    15  receiver_binding         lower        method declared_type_of
56319–56370    52  provided_errors          lower        method no_aggregate_errors_read
56372–56399    28  bound_functions          lower        method wrapping_closure
56401–56490    90  bound_functions          lower        method member_that_is_not_a_field
56492–56578    87  bound_functions          private*     method through_a_narrowed_class
56580–56648    69  bound_functions          private*     method bound_method
56650–56674    25  object_layouts           private*     method not_decomposed
56676–56723    48  absence                  lower        method absent_member
56725–56767    43  provided_errors          private*     method option_initializers
56769–56857    89  provided_errors          private*     method error_message
56859–57012   154  provided_errors          lower        method initialize_error
57014–57024    11  provided_errors          lower        method provided_error_base
57026–57062    37  provided_errors          lower        method representable_bases
57064–57325   262  member_layouts           lower        method fields_of
57327–57370    44  tuples                   lower        method lower_tuple_literal
57372–57411    40  type_tests               lower        method classes_under
57413–57438    26  object_layouts           lower        method class_behind
57440–57454    15  tuples                   lower        method is_tuple
57456–57524    69  tuples                   lower        method tuple_layout
57526–57578    53  member_layouts           lower        method after_the_base
57580–57623    44  coercion                 private*     method not_the_same_element
57625–57634    10  coercion                 private*     method the_same_element
57636–57677    42  member_layouts           lower        method as_the_program_writes_them
57679–57737    59  suspended_bodies         lower        method abstract_generator_layout
57739–57745     7  object_layouts           lower        method is_a_signature
57747–57771    25  object_layouts           lower        method foreign_owner
57773–57841    69  member_layouts           lower        method overridden_entries
57843–57883    41  member_layouts           private*     method field_reservation
57885–58118   234  object_layouts           lower        method layout_of
58120–58162    43  closure_values           lower        method bind_own_name
58164–58219    56  closure_values           lower        method hoistable
58221–58254    34  closure_values           lower        method bind_nested_function
58256–58323    68  closure_values           private*     method bind_later_siblings
58325–58339    15  closure_values           private*     method later_sibling_function
58341–58370    30  closure_values           private*     method could_stand_at
58372–58571   200  closure_values           lower        method lower_arrow
58573–58655    83  closure_values           private*     method stored_capture
58657–58668    12  closure_values           lower        method arguments_of
58670–58763    94  construct_expressions    private*     method initialize_presence
58765–58782    18  construct_expressions    private*     method construction_chain
58784–58825    42  construct_expressions    private*     method initialize_fields
58827–58970   144  construct_expressions    lower        method initialize_declared_fields
58972–59031    60  expression_types         lower        method widened
59033–59058    26  construct_expressions    private*     method initialisers_this_site_owes
59060–59104    45  array_construction       lower        method allocated_array_type
59106–59139    34  array_construction       lower        method past_the_choices
59141–59260   120  construct_expressions    lower        method lower_new
59262–59281    20  construct_expressions    lower        method lower_new_object
59283–59315    33  construct_expressions    lower        method require_an_implemented_constructor
59317–59342    26  construct_expressions    lower        method an_implemented_class
59344–59499   156  construct_expressions    private*     method run_the_constructor
59501–59524    24  construct_expressions    lower        method lower_new_provided
59526–59557    32  date_builtins            lower        method lower_new_date
59559–59596    38  typed_arrays             private*     method typed_array_shape
59598–59638    41  typed_arrays             lower        method lower_typed_array_from
59640–59696    57  typed_arrays             lower        method lower_typed_array_of
59698–59790    93  typed_arrays             lower        method lower_new_typed_array
59792–59923   132  typed_arrays             private*     method lower_view_over
59925–59971    47  typed_arrays             private*     method guard_aligned_offset
59973–59992    20  typed_arrays             private*     method guard_within
59994–60096   103  typed_arrays             private*     method view_copied_from_array
60098–60133    36  typed_arrays             private*     method view_over_fresh_buffer
60135–60145    11  typed_arrays             private*     method make_view_an_instance
60147–60162    16  typed_arrays             lower        method guard_allocated_view
60164–60254    91  buffers                  lower        method lower_new_buffer
60256–60282    27  buffers                  lower        method guard_allocated
60284–60301    18  buffers                  private*     method literal_option
60303–60373    71  buffers                  lower        method guard_buffer_length
60375–60451    77  promise_settlement       lower        method lower_new_promise
60453–60538    86  promise_settlement       lower        method lower_settler_call
60540–60589    50  promise_settlement       lower        method reject_with
60591–60646    56  array_methods            lower        method lower_element_access
60648–60707    60  literals                 lower        method folded_enum_member
60709–60811   103  literals                 lower        method enum_reverse_member
60813–60860    48  tuples                   lower        method tuple_position_representation
60862–61111   250  array_methods            lower        method element_of
61113–61137    25  tuples                   lower        method reads_a_tuple
61139–61256   118  array_construction       private*     method lower_mixed_literal
61258–61277    20  array_construction       private*     method lower_spread_copy
61279–61309    31  array_construction       private*     method collect_spread
61311–61337    27  array_construction       lower        method lower_array_copy
61339–61364    26  array_construction       lower        method slice_helper
61366–61401    36  string_builtins          lower        method lower_string_index
61403–61432    30  array_methods            lower        method element_access_parts
61434–61451    18  array_methods            lower        method erased_but_proven_an_array
61453–61469    17  array_methods            lower        method not_an_array
61471–61569    99  type_tests               lower        method check_native_brand_read
61571–61601    31  accessors                lower        method super_getter_read
61603–61684    82  accessors                lower        method static_accessor_place
61686–61698    13  accessors                private*     method accessor_parameter_type
61700–61727    28  accessors                lower        method super_setter_place
61729–61756    28  accessors                private*     method super_accessor
61758–61770    13  native_properties        lower        method foreign_property_read
61772–61987   216  access                   lower        method lower_property_access
61989–62024    36  optional_chains          lower        method lower_optional_access
62026–62058    33  optional_chains          lower        method lower_optional_element
62060–62069    10  call_expression          lower        method unresolved_call
62071–62080    10  call_expression          lower        method is_optional_call
62082–62175    94  optional_chains          private*     method optional_method_call
62177–62196    20  objc_dispatch            lower        method objc_optional_selector
62198–62226    29  objc_dispatch            lower        method objc_optional_call
62228–62265    38  objc_dispatch            private*     method responds_to
62267–62315    49  objc_dispatch            lower        method declares_an_optional_method
62317–62337    21  objc_dispatch            private*     method declares_it_optionally
62339–62367    29  optional_chains          lower        method lower_optional_call
62369–62423    55  optional_chains          lower        method present_of
62425–62527   103  access                   lower        method why_not_shared
62529–62568    40  array_methods            lower        method not_a_length
62570–62592    23  array_methods            lower        method proven_array_length
62594–62614    21  array_methods            private*     method receiver_is_an_array
62616–62658    43  table_methods            lower        method table_member
62660–62693    34  access                   private*     method union_holders
62695–62761    67  access                   lower        method shared_field
62763–62817    55  access                   lower        method open_field
62819–62852    34  generator_iteration      lower        method is_a_provided_iterator_result
62854–62906    53  generator_iteration      lower        method provided_iterator_layout
62908–62949    42  generator_iteration      lower        method refuse_unguarded_iterator_value
62951–62979    29  generator_iteration      private*     method receiver_cannot_be_finished
62981–63016    36  member_layouts           lower        method field_named
63018–63030    13  member_layouts           lower        method member_of
63032–63206   175  member_layouts           private*     method member_storage_of
63208–63248    41  absence                  lower        method holds_only_absences
63250–63269    20  branch_values            lower        method lower_branching_value
63271–63309    39  branch_values            lower        method instead_of_an_unchosen_collection
63311–63511   201  branch_values            lower        method lower_branching_value_at
63513–63640   128  branch_values            lower        method evaluate
63642–63691    50  branch_values            lower        method lower_conditional
63693–63712    20  operators                lower        method plus_from_operands
63714–63741    28  operators                lower        method booleans_as_numbers
63743–63810    68  assignments              lower        method lower_compound
63812–63861    50  assignments              lower        method lower_logical_assignment
63863–63899    37  literals                 private*     method enum_member
63901–63932    32  branch_values            lower        method lower_nullish
63934–63995    62  operators                lower        method coercing_comparison
63997–64047    51  absence                  lower        method absences_of
64049–64127    79  absence                  lower        method absence_of
64129–64189    61  branch_values            lower        method lower_logical
64191–64274    84  branch_values            private*     method never_falsy
64276–64290    15  branch_values            lower        method truthy
64292–64305    14  bigint                   lower        method plus_of_a_bigint
64307–64321    15  bigint                   lower        method throw_to_number_of_a_bigint
64323–64395    73  primitive_conversion     lower        method erased_to_number
64397–64416    20  primitive_conversion     private*     method compare_tag
64418–64463    46  primitive_conversion     private*     method branch_on_an_object_tag
64465–64524    60  primitive_conversion     lower        method coerce_to_number
64526–64549    24  primitive_conversion     lower        method coerce_explicit_number
64551–64735   185  raising_calls            lower        method call_within
64737–64768    32  raising_calls            private*     method sorts_with_a_comparator
64770–64813    44  raising_calls            private*     method why_no_raising_copy
64815–64862    48  raising_calls            private*     method calls_a_closure
64864–64934    71  raising_calls            lower        method reason_without_a_leaf
64936–65012    77  raising_calls            private*     method why_not_copyable
65014–65090    77  raising_calls            private*     method the_leaf_that_cannot_be_carried
65092–65129    38  raising_calls            private*     method spelled_callee
65131–65159    29  raising_calls            lower        method raising_suffix_of
65161–65185    25  raising_calls            lower        method dispatches_to_a_raising_entry
65187–65245    59  raising_calls            lower        method a_raising_body_carries_this_call
65247–65257    11  raising_calls            private*     method tested_for_a_raise
65259–65321    63  raising_calls            private*     method has_a_raising_copy
65323–65354    32  raising_calls            lower        method why_the_raising_slot_is_missing
65356–65405    50  raising_calls            lower        method accessors_run_by
65407–65410     4  raising_calls            lower        method reads_an_accessor
65412–65433    22  raising_calls            private*     method an_accessor_that_can_raise
65435–65448    14  raising_calls            private*     method an_objective_c_accessor
65450–65600   151  raising_calls            private*     method calls_compiled_code
65602–65637    36  raising_calls            private*     method an_interface_member_that_can_raise
65639–65757   119  operators                lower        method lower_prefix_unary
65759–65778    20  construct_expressions    lower        method evaluate_a_class_initializer
65780–66022   243  local_bindings           lower        method lower_variable_statement
66024–66049    26  local_bindings           private*     method coerce_declared
66051–66084    34  local_bindings           private*     method binding_a_var_writes
66086–66125    40  local_bindings           private*     method catch_parameter_named
66127–66204    78  local_bindings           lower        method unwritten
66206–66249    44  local_bindings           lower        method evolved_type
66251–66272    22  destructuring            private*     method reference_element_for_pattern
66274–66340    67  destructuring            private*     method exhausted_pattern_element
66342–66531   190  destructuring            private*     method defaulted_array_element
66533–66677   145  destructuring            private*     method read_for_pattern
66679–66749    71  destructuring            private*     method require_object_coercible
66751–66814    64  destructuring            lower        method bind_array_pattern_by_stepping
66816–66840    25  destructuring            private*     method bind_pattern_value
66842–66849     8  destructuring            lower        method bind_pattern
66851–67047   197  destructuring            private*     method bind_pattern_from
67049–67064    16  destructuring            private*     method binding_element_symbol
67066–67114    49  destructuring            private*     method bind_capability_member
67116–67159    44  destructuring            lower        method pattern_names
67161–67166     6  destructuring            lower        method declared_by
67168–67229    62  destructuring            lower        method defaulted_when
67231–67344   114  destructuring            private*     method rest_tail
67346–67358    13  destructuring            private*     method rest_target
67360–67407    48  destructuring            private*     method bind_rest
67409–67431    23  literals                 lower        method lower_string
67433–67531    99  numeric_builtins         private*     method lower_radix_to_string
67533–67602    70  numeric_builtins         lower        method lower_number_method
67604–67687    84  numeric_builtins         private*     method lower_to_integer_or_infinity
67689–67772    84  numeric_builtins         private*     method lower_fixed_to_string
67774–67839    66  method_calls             lower        method lower_method_call
67841–67869    29  method_calls             private*     method lower_optional_method_call
67871–67919    49  property_presence        lower        method own_property_call
67921–67991    71  property_presence        private*     method lower_has_own_property
67993–68049    57  method_calls             private*     method call_on_native
68051–68080    30  method_calls             private*     method program_objc_field_call
68082–68265   184  method_calls             lower        method lower_method_on
68267–68321    55  method_calls             private*     method registered_class_method_call
68323–68360    38  method_calls             private*     method no_method_table
68362–68449    88  buffers                  lower        method lower_new_data_view
68451–68473    23  buffers                  lower        method data_view_property
68475–68610   136  buffers                  lower        method lower_data_view_method
68612–68626    15  buffers                  private*     method endianness
68628–68673    46  array_methods            lower        method join_separator
68675–68706    32  method_calls             lower        method lower_method_arguments
68708–68745    38  typed_arrays             lower        method lower_view_method
68747–68779    33  typed_arrays             private*     method view_number
68781–68902   122  typed_arrays             lower        method lower_view_builtin
68904–68981    78  typed_arrays             private*     method lower_view_move
68983–69023    41  table_methods            lower        method table_size
69025–69066    42  symbol_builtins          lower        method symbol_property
69068–69105    38  symbol_builtins          lower        method symbol_method
69107–69125    19  typed_arrays             lower        method any_view_property
69127–69147    21  typed_arrays             private*     method view_property
69149–69177    29  buffers                  lower        method buffer_property
69179–69307   129  buffers                  lower        method lower_buffer_method
69309–69340    32  provided_errors          lower        method refuse_when
69342–69365    24  provided_errors          lower        method stop_when
69367–69378    12  buffers                  private*     method guard_view_attached
69380–69437    58  buffers                  private*     method guard_view_window
69439–69483    45  buffers                  private*     method guard_view_access
69485–69503    19  buffers                  private*     method guard_view_allocated
69505–69517    13  buffers                  private*     method guard_attached
69519–69540    22  buffers                  private*     method guard_resizable
69542–69594    53  buffers                  private*     method guard_within_maximum
69596–69644    49  date_builtins            lower        method lower_date_method
69646–69729    84  diagnostics              lower        method no_such_callee
69731–69999   269  call_expression          lower        method lower_call
70001–70013    13  call_expression          lower        method finish_call
70015–70170   156  call_expression          lower        method finish_call_typed
70172–70234    63  primitive_conversion     lower        method exact_as_number
70236–70287    52  foreign_results          lower        method throw_on_failure
70289–70412   124  foreign_results          lower        method finish_hresult_call
70414–70446    33  foreign_results          private*     method clear_failed_results
70448–70465    18  foreign_results          private*     method out_field_type
70467–70684   218  foreign_results          lower        method read_written
70686–70761    76  foreign_results          private*     method read_received_references
70763–70791    29  foreign_results          private*     method throw_c_message
70793–70806    14  foreign_callbacks        lower        method record_destination
70808–70829    22  foreign_callbacks        lower        method closure_notify
70831–70848    18  foreign_results          lower        method error_slot
70850–70947    98  foreign_results          lower        method throw_if_reported
70949–70971    23  native_calls             lower        method static_native
70973–70994    22  native_calls             lower        method lower_static_native
70996–71022    27  native_calls             lower        method native_method
71024–71045    22  native_calls             lower        method delegated_method
71047–71080    34  binding_calls            lower        method lower_bound_global_call
71082–71117    36  binding_calls            lower        method window_global
71119–71164    46  binding_calls            lower        method method_of_bound
71166–71216    51  binding_calls            lower        method overload_signature
71218–71267    50  binding_calls            lower        method arguments_fit
71269–71313    45  binding_calls            private*     method lends_as
71315–71367    53  binding_calls            private*     method dictionary_member_names
71369–71483   115  binding_calls            private*     method record_holds
71485–71515    31  binding_calls            private*     method delegated_function
71517–71556    40  binding_calls            lower        method delegated_static
71558–71593    36  binding_calls            lower        method lower_delegated_call
71595–71620    26  binding_calls            private*     method overload_by_arguments
71622–71658    37  binding_calls            lower        method refuse_dropped_arguments
71660–71685    26  binding_calls            private*     method as_written
71687–71808   122  binding_calls            lower        method shortest_fit
71810–71857    48  binding_calls            private*     method call_fits
71859–71892    34  binding_calls            private*     method is_scalar_type
71894–71955    62  binding_calls            private*     method dictionary_spread
71957–71970    14  binding_calls            lower        method spread_for
71972–72046    75  native_construction      lower        method delegated_constructor
72048–72069    22  native_construction      lower        method lower_delegated_construction
72071–72094    24  native_construction      lower        method delegated_type
72096–72099     4  objc_dispatch            lower        method objc_protocol_member
72101–72116    16  objc_dispatch            private*     method declaring_protocol
72118–72136    19  objc_dispatch            lower        method is_native_instance_method
72138–72193    56  call_expression          lower        method called_method
72195–72209    15  objc_dispatch            lower        method program_objc_method
72211–72279    69  objc_dispatch            lower        method lower_program_objc_call
72281–72293    13  objc_dispatch            private*     method own_method
72295–72352    58  objc_dispatch            private*     method objc_dispatch
72354–72447    94  objc_dispatch            private*     method dispatch_objc_call
72449–72468    20  objc_dispatch            private*     method objc_class_value
72470–72522    53  objc_dispatch            private*     method objc_arm
72524–72598    75  method_calls             lower        method lower_called_method
72600–72622    23  method_calls             private*     method is_constant
72624–72645    22  native_calls             lower        method lower_native_method_call
72647–72783   137  native_calls             lower        method lower_native_method_call_as
72785–72799    15  binding_calls            lower        method bound_arguments
72801–72814    14  foreign_callbacks        lower        method sequence_for_array
72816–72899    84  foreign_callbacks        lower        method array_of_sequence
72901–73016   116  gobject_class            lower        method lower_gobject_emit
73018–73118   101  foreign_callbacks        lower        method lower_event_listener
73120–73169    50  foreign_callbacks        lower        method via_receiver
73171–73177     7  foreign_callbacks        lower        method release_via
73179–73196    18  objc_dispatch            lower        method send_bridge
73198–73223    26  foreign_values           private*     method ns_array_of
73225–73250    26  foreign_values           private*     method ns_dictionary_of
73252–73330    79  foreign_values           lower        method read_ns_array
73332–73357    26  foreign_values           lower        method foundation_collection
73359–73381    23  foreign_values           private*     method ns_set_of
73383–73518   136  foreign_values           lower        method read_ns_set
73520–73688   169  foreign_values           lower        method read_ns_dictionary
73690–73731    42  foreign_arguments        private*     method label_argument
73733–73774    42  foreign_arguments        lower        method label_value
73776–73790    15  foreign_values           lower        method ns_string_of
73792–73904   113  foreign_values           lower        method read_native_string
73906–73952    47  foreign_values           lower        method lend_string_argument
73954–73977    24  foreign_values           lower        method lend_string
73979–74097   119  foreign_arguments        lower        method give_back
74099–74143    45  foreign_callbacks        lower        method bridge_closure
74145–74254   110  foreign_callbacks        private*     method with_conversions
74256–74280    25  foreign_callbacks        private*     method request_conversion
74282–74292    11  foreign_callbacks        private*     method sequence_type_of
74294–74344    51  promise_settlement       private*     method lower_reject_error
74346–74370    25  foreign_callbacks        private*     method lower_conversion
74372–74396    25  foreign_callbacks        private*     method lower_sequence_array
74398–74474    77  foreign_callbacks        lower        method lend_block
74476–74491    16  foreign_results          lower        method reference_tags
74493–74518    26  foreign_results          lower        method hresult_shape
74520–74556    37  foreign_results          lower        method hresult_slot
74558–74575    18  foreign_results          lower        method iid_arguments
74577–74607    31  foreign_arguments        private*     method box_argument
74609–74662    54  foreign_arguments        lower        method delegate
74664–74703    40  foreign_arguments        private*     method lend_bytes
74705–74727    23  foreign_arguments        private*     method borrow_bytes
74729–74744    16  foreign_values           private*     method lend_hstrings
74746–74799    54  foreign_values           lower        method lend_array
74801–74814    14  foreign_values           private*     method lend_strings
74816–74876    61  foreign_values           lower        method lend_handles
74878–74953    76  foreign_arguments        private*     method bounded_counts
74955–74985    31  foreign_arguments        private*     method array_count
74987–75028    42  foreign_arguments        lower        method unless_null
75030–75064    35  foreign_arguments        private*     method lower_written_arguments
75066–75099    34  foreign_arguments        lower        method lower_call_arguments
75101–75138    38  foreign_arguments        private*     method lower_dictionary_slots
75140–75165    26  places                   lower        method place_receiver
75167–75199    33  foreign_arguments        private*     method mark_literals
75201–75264    64  foreign_arguments        lower        method lower_labels
75266–75277    12  foreign_arguments        lower        method syntax_children_of
75279–75543   265  foreign_arguments        lower        method native_arguments
75545–75566    22  foreign_arguments        private*     method lend_context
75568–75620    53  foreign_callbacks        lower        method bridged
75622–75647    26  foreign_callbacks        private*     method null_function_pointer
75649–75701    53  foreign_callbacks        lower        method bridge_callback_arguments
75703–75711     9  native_calls             lower        method native_callee
75713–75731    19  native_calls             lower        method native_callee_sending
75733–75946   214  native_calls             lower        method native_callee_with
75948–75983    36  native_calls             private*     method slot_of
75985–76060    76  native_calls             private*     method vtable_of
76062–76092    31  com_class                lower        method factory_of
76094–76126    33  com_class                lower        method lower_query
76128–76142    15  com_class                lower        method activation_call
76144–76183    40  com_class                private*     method lower_activation
76185–76202    18  com_class                lower        method factory_receiver
76204–76230    27  native_modules           lower        method declared_names
76232–76309    78  objc_dispatch            lower        method objc_class_object
76311–76327    17  native_calls             private*     method make_call
76329–76392    64  native_calls             private*     method make_message
76394–76420    27  native_calls             private*     method refuse_unbridged
76422–76500    79  objc_dispatch            lower        method objc_property
76502–76552    51  objc_dispatch            private*     method declared_by_an_interface
76554–76568    15  objc_dispatch            lower        method present_part
76570–76628    59  objc_dispatch            lower        method property_selectors
76630–76663    34  objc_dispatch            private*     method call_program_accessor
76665–76674    10  objc_dispatch            private*     method program_objc_accessor
76676–76694    19  objc_dispatch            private*     method overridden_property
76696–76712    17  objc_dispatch            lower        method lower_objc_property_get
76714–76776    63  objc_dispatch            lower        method read_objc_property
76778–76787    10  objc_dispatch            private*     method optional_requirement
76789–76832    44  objc_dispatch            lower        method send_objc_getter
76834–76863    30  native_properties        lower        method read_native_variable
76865–76935    71  objc_dispatch            lower        method lower_objc_property_set
76937–76953    17  returns                  lower        method void_type
76955–76982    28  objc_dispatch            lower        method objc_class_member
76984–77000    17  objc_dispatch            private*     method merged_objc_class
77002–77065    64  com_class                lower        method lower_com_new
77067–77120    54  com_class                private*     method lower_com_construct
77122–77134    13  com_class                private*     method constructed_class
77136–77262   127  native_construction      lower        method lower_objc_new
77264–77321    58  type_tests               private*     method lower_objc_instanceof
77323–77454   132  type_tests               private*     method lower_gobject_instanceof
77456–77545    90  type_tests               private*     method lower_bound_instanceof
77547–77575    29  type_tests               private*     method bound_instance_test
77577–77621    45  type_tests               private*     method lower_boxed_instanceof
77623–77653    31  type_tests               private*     method boxed_asked
77655–77725    71  type_tests               private*     method lower_com_instanceof
77727–77754    28  gobject_class            lower        method call_gtype
77756–77772    17  gobject_class            lower        method gtype_read
77774–77798    25  objc_dispatch            lower        method in_objc_module
77800–77917   118  objc_dispatch            lower        method objc_send
77919–77946    28  suspended_bodies         lower        method note_generator_call
77948–78032    85  lower                    private      method push_call
78034–78077    44  raising_calls            lower        method test_for_a_raise
78079–78101    23  raising_calls            lower        method a_handler_in_this_function_would_catch
78103–78184    82  raising_calls            lower        method emit_the_raise_test
78186–78253    68  call_expression          lower        method direct_callee
78255–78328    74  local_bindings           lower        method initializer_settles
78330–78349    20  local_bindings           lower        method variable_kind
78351–78394    44  local_bindings           lower        method aliased_to
78396–78421    26  branch_values            lower        method decided_arm
78423–78451    29  names                    lower        method named_function
78453–78470    18  names                    lower        method static_method_name
78472–78474     3  names                    lower        method declared_name
78476–78486    11  names                    lower        method enclosing_class
78488–78526    39  names                    lower        method class_name
78528–78535     8  names                    lower        method declaring_class_name
78537–78621    85  method_calls             lower        method lower_static_call
78623–78638    16  closure_calls            lower        method lower_closure_call
78640–78659    20  branch_values            lower        method cannot_have_effects
78661–78681    21  closure_calls            lower        method function_type_of_receiver
78683–78703    21  closure_calls            lower        method through_call_or_apply
78705–78748    44  closure_calls            lower        method lower_call_with_receiver
78750–78760    11  closure_calls            lower        method lower_this_argument
78762–78775    14  closure_calls            lower        method closure_callee
78777–78806    30  closure_calls            lower        method closure_entry
78808–78813     6  closure_calls            lower        method uniform_defaults_at
78815–78860    46  access                   lower        method known_reference_path
78862–78901    40  closure_calls            lower        method lower_apply_with_receiver
78903–78955    53  closure_calls            private*     method apply_through_closure
78957–79057   101  closure_calls            private*     method apply_positionally
79059–79118    60  closure_calls            lower        method read_a_position
79120–79139    20  closure_calls            lower        method tuple_field_at
79141–79167    27  closure_calls            private*     method read_a_struct_position
79169–79211    43  closure_calls            lower        method call_through_closure
79213–79249    37  closure_calls            private*     method finish_closure_call
79251–79397   147  closure_calls            lower        method call_a_closure_entry
79399–79437    39  closure_calls            lower        method erase_uniform_argument
79439–79457    19  closure_calls            lower        method check_this_is_passed
79459–79473    15  closure_calls            lower        method inlines_as_a_callback
79475–79483     9  closure_calls            private*     method erased_this
79485–79543    59  static_builtins          private*     method intrinsic_of
79545–79578    34  host_builtins            lower        method console_method
79580–79651    72  host_builtins            lower        method lower_console
79653–79721    69  host_builtins            private*     method may_format
79723–79844   122  host_builtins            private*     method inspected
79846–79891    46  numeric_builtins         lower        method lower_parse_int
79893–79911    19  numeric_builtins         lower        method lower_parse_float
79913–79984    72  numeric_builtins         lower        method lower_uri
79986–80044    59  host_builtins            lower        method lower_set_timer
80046–80064    19  host_builtins            lower        method lower_clear_timer
80066–80216   151  static_builtins          lower        method lower_provided_builtin
80218–80260    43  raising_calls            lower        method raised_return
80262–80278    17  lower                    private      method runtime_call
80280–80300    21  lower                    private      method keyed_call
80302–80345    44  bigint                   lower        method exponentiate
80347–80380    34  bigint                   private*     method bigint_range_error_if
80382–80409    28  bigint                   lower        method require_bigint_divisor
80411–80469    59  bigint                   private*     method fold_power
80471–80619   149  static_builtins          private*     method lower_intrinsic
80621–80715    95  string_builtins          private*     method fold_string_call
80717–80886   170  string_builtins          lower        method lower_string_method
80888–81118   231  array_methods            lower        method lower_array_method
81120–81206    87  array_methods            private*     method lower_pushes
81208–81230    23  array_methods            private*     method spread_source
81232–81313    82  array_methods            private*     method append_each
81315–81346    32  iteration_callbacks      lower        method iteration_arguments
81348–81399    52  string_builtins          private*     method code_point_or_undefined
81401–81441    41  access                   lower        method receiver_of_member
81443–81460    18  array_construction       lower        method null_slot
81462–81506    45  array_construction       lower        method null_only_element
81508–81572    65  array_construction       private*     method refuse_holes_that_read_as_null
81574–81592    19  array_construction       private*     method untyped_array
81594–81653    60  array_construction       private*     method hole_context
81655–81708    54  array_sort               lower        method lower_sort
81710–81833   124  array_sort               private*     method lower_sort_with
81835–81890    56  array_sort               private*     method sort_indices
81892–81932    41  array_sort               private*     method sort_element
81934–82016    83  array_sort               private*     method merge_passes
82018–82158   141  array_sort               private*     method merge_pair
82160–82241    82  array_sort               private*     method write_back
82243–82275    33  array_sort               private*     method sorted_may_hold_undefined
82277–82291    15  array_sort               private*     method comparator_signature
82293–82351    59  array_methods            private*     method lower_array_with
82353–82423    71  array_methods            private*     method array_with_index
82425–82507    83  array_methods            private*     method copy_array_with_value
82509–82549    41  array_methods            private*     method lower_to_reversed
82551–82593    43  array_methods            private*     method lower_erased_array_method
82595–82740   146  array_methods            private*     method lower_reference_array_method
82742–82795    54  table_methods            lower        method lower_new_table
82797–82828    32  table_methods            private*     method pair_shape
82830–82889    60  table_methods            private*     method table_insertion_arguments
82891–82920    30  table_methods            private*     method written_halves
82922–83034   113  table_methods            private*     method fill_table_from
83036–83114    79  table_methods            lower        method lower_table_method
83116–83197    82  table_methods            lower        method lower_wide_fill
83199–83286    88  iteration_callbacks      private*     method bind_step
83288–83319    32  iteration_callbacks      private*     method still_walking
83321–83385    65  iteration_callbacks      private*     method reduce_start
83387–83490   104  iteration_callbacks      lower        method lower_iteration
83492–83530    39  iteration_callbacks      lower        method lower_callback_body
83532–83582    51  iteration_callbacks      private*     method iteration_result
83584–83645    62  iteration_callbacks      private*     method iteration_result_array
83647–83660    14  loop_flow                lower        method carried_across
83662–83762   101  iteration_callbacks      lower        method deliver
83764–83789    26  iteration_callbacks      private*     method append_callback_value
83791–83827    37  iteration_callbacks      private*     method iteration_delivery
83829–83891    63  iteration_callbacks      private*     method iteration_answer
83893–83925    33  iteration_callbacks      private*     method keep_element
83927–83976    50  iteration_callbacks      private*     method stop_early
83978–84013    36  iteration_callbacks      lower        method callback_shape
84015–84045    31  iteration_callbacks      lower        method callback_parameters
84047–84064    18  absence                  lower        method admits_absence
84066–84146    81  method_calls             private*     method open_call
84148–84232    85  method_calls             private*     method chain_of_calls
84234–84484   251  method_calls             lower        method lower_object_method
84486–84507    22  call_expression          private*     method signature_behind_any
84509–84530    22  call_expression          lower        method method_arguments
84532–84546    15  call_expression          lower        method member_declaration
84548–84572    25  call_expression          lower        method callee_for
84574–84657    84  method_calls             lower        method method_callee
84659–84691    33  construct_expressions    private*     method lower_static_super
84693–84875   183  construct_expressions    lower        method lower_super
84877–84910    34  construct_expressions    private*     method constructorless_ancestors
84912–84924    13  construct_expressions    lower        method initialize_own_fields
84926–84954    29  construct_expressions    private*     method lower_objc_super
84956–84975    20  construct_expressions    private*     method com_super_call
84977–84997    21  construct_expressions    private*     method overridable_target
84999–85037    39  construct_expressions    private*     method lower_com_super
85039–85050    12  hierarchy                lower        method base_class
85052–85095    44  local_bindings           lower        method lower_identifier
85097–85179    83  local_bindings           lower        method shorthand_value_symbol
85181–85201    21  literals                 lower        method native_constant
85203–85217    15  literals                 lower        method string_constant
85219–85450   232  local_bindings           lower        method lower_named_value
85452–85532    81  literals                 lower        method token_base
85534–85555    22  absence                  lower        method lower_absent
85557–85624    68  absence                  lower        method absent_at
85626–85673    48  member_layouts           lower        method declared_field_type
85675–85684    10  expression_types         lower        method represent_passed
85686–85709    24  expression_types         private*     method what_the_whole_expression_is
85711–85769    59  expression_types         private*     method what_the_declaration_holds
85771–85951   181  expression_types         lower        method contextual_type
85953–85968    16  expression_types         private*     method contextual_array_element
85970–86016    47  snapshot_queries         lower        method enclosing_callable
86018–86068    51  literals                 lower        method lower_bigint
86070–86105    36  literals                 lower        method lower_number
86107–86141    35  operators                lower        method lower_void
86143–86238    96  operators                private*     method numeric_operands
86240–86296    57  operators                private*     method binary_op_for
86298–86317    20  array_methods            lower        method element_says_nothing
86319–86409    91  operators                private*     method erased_equality_operands
86411–86451    41  operators                private*     method relational_operands
86453–86536    84  primitive_conversion     lower        method ordinary_to_primitive
86538–86646   109  primitive_conversion     private*     method conversion_member
86648–86657    10  primitive_conversion     private*     method a_holder_declares_value_of
86659–86689    31  primitive_conversion     private*     method answers_a_primitive
86691–86698     8  operators                private*     method compares_objects
86700–86790    91  property_presence        lower        method cast_member_presence
86792–86868    77  operators                lower        method lower_binary
86870–86982   113  operators                private*     method lower_binary_special
86984–87074    91  operators                private*     method lower_binary_values
87076–87122    47  operators                private*     method agree_on_one_integer_width
87124–87169    46  expression_types         lower        method bound_type
87171–87200    30  absence                  private*     method pointer_absence_test
87202–87268    67  absence                  private*     method absence_the_type_decides
87270–87279    10  expression_types         lower        method only_absences
87281–87328    48  expression_types         lower        method read_type
87330–87340    11  absence                  lower        method narrowed_past_absence
87342–87361    20  absence                  lower        method dereferenced
87363–87467   105  coercion                 lower        method has_the_slot
87469–87548    80  absence                  lower        method presence_operand
87550–87617    68  objc_dispatch            lower        method optional_method_presence
87619–87728   110  absence                  lower        method erased_absence_test
```

</details>

## Call graph

Module edge weights count distinct caller–callee pairs. Self-edges count pairs inside one destination. Names with a slash denote current nested modules under `lower/`.

<details>
<summary>Module adjacency, including existing modules</summary>

```text
absence -> absence (16), access_families (2), array_construction (1), body_entries (3), claimed_reads (1), diagnostics (5), expression_types (7), foreign_arguments (1), foreign_values (1), implementations (9), lower (8), object_layouts (2), operators (1), parameters (5), property_keys (1), provided_errors (1), receiver_binding (1), snapshot_queries (23)
access -> absence (3), access (15), access_families (1), accessors (3), body_entries (3), bound_functions (1), capture_discovery (1), closure_context (1), coercion (3), diagnostics (2), expression_types (3), generic_values (1), implementations (8), literals (1), local_bindings (1), lower (24), member_layouts (1), module_binding_bodies (1), module_namespaces (2), names (2), native_properties (1), object_layouts (4), optional_chains (3), parameters (1), promise_settlement (1), property_keys (5), provided_errors (3), raising_calls (1), snapshot_queries (20), static_builtins (1), type_tests (1), uniform_inputs (1)
access_families -> access_families (71), access_family_flow (6), access_family_sites (1), accessors (4), branch_values (1), callable_fields (4), claimed_reads (1), coercion (1), diagnostics (2), expression_types (3), field_initialization (2), hierarchy (6), implementations (18), interfaces (3), lower (27), object_layouts (1), object_literals (1), parameters (2), property_keys (6), representations (1), returns (2), signature_entries (1), snapshot_queries (29), type_tests (2)
access_family_flow -> access_family_flow (40), closure_calls (2), closure_values (1), hierarchy (1), implementations (15), module_evaluation (1), property_keys (4), snapshot_queries (23), type_tests (1), typeof_expression (1)
access_family_functions -> access_families (7), access_family_functions (37), implementations (5), lower (15), returns (4)
access_family_sites -> access_family_sites (2), hierarchy (2), implementations (3), property_keys (3), snapshot_queries (5)
accessors -> access_families (2), access_family_functions (1), accessors (23), binding_calls (1), body_entries (2), call_expression (4), class_members (1), coercion (3), com_class (1), diagnostics (12), foreign_arguments (3), foreign_callbacks (4), hierarchy (4), implementations (13), lower (10), names (5), native_calls (3), native_construction (3), object_layouts (3), property_keys (8), raising_calls (4), receiver_binding (2), returns (3), snapshot_queries (28), structural_copies (1)
arguments -> absence (2), access (1), arguments (13), array_methods (2), body_entries (3), closure_calls (2), closure_values (2), coercion (4), diagnostics (6), expression_types (1), foreign_arguments (4), implementations (3), lower (13), parameters (8), places (1), representations (1), returns (2), snapshot_queries (11)
array_construction -> absence (1), array_construction (37), array_from (2), array_methods (4), body_entries (5), branch_values (1), closure_calls (1), closure_values (4), coercion (7), construction (2), diagnostics (17), expression_types (4), implementations (7), iterable_walks (2), lower (37), module_binding_bodies (1), module_binding_types (4), object_layouts (1), parameters (1), provided_errors (1), representations (1), returns (3), snapshot_queries (33), tuples (2)
array_from -> array_construction (1), array_from (12), array_methods (1), body_entries (2), closure_calls (1), coercion (1), diagnostics (7), generator_iteration (2), iterable_walks (13), iteration_callbacks (2), iterator_close (1), loop_flow (9), lower (17), object_builtins (1), snapshot_queries (3), table_methods (2)
array_methods -> absence (2), access (6), array_construction (4), array_methods (28), array_sort (2), body_entries (4), branch_values (2), claimed_reads (2), coercion (3), diagnostics (12), expression_types (2), implementations (4), iteration_callbacks (5), literals (2), loop_flow (3), lower (28), method_calls (2), native_memory (1), numeric_arguments (2), optional_chains (3), property_keys (4), property_presence (1), provided_errors (1), snapshot_queries (25), string_builtins (1), table_methods (1), tuples (2), type_tests (1), typed_arrays (1)
array_sort -> access (2), array_construction (1), array_methods (1), array_sort (9), body_entries (1), closure_calls (2), coercion (1), diagnostics (2), expression_types (1), implementations (3), loop_flow (12), lower (24), signature_entries (1), snapshot_queries (4)
assertions -> absence (9), access (2), assertions (19), assertions/literals (2), claimed_reads (1), coercion (2), diagnostics (2), expression_types (2), hierarchy (1), implementations (3), lower (12), provided_errors (1), raising_calls (1), representations (1), returns (1), snapshot_queries (13), type_tests (1)
assertions/literals -> assertions (2), assertions/literals (2), coercion (1), diagnostics (1), literals (1), lower (2), snapshot_queries (3)
assignments -> absence (1), accessors (3), bigint (2), body_entries (2), branch_values (2), destructuring (1), diagnostics (3), expression_types (1), foreign_arguments (1), lower (5), member_layouts (1), objc_dispatch (1), operators (4), places (10), primitive_conversion (4), snapshot_queries (6), string_builtins (1)
bigint -> absence (1), bigint (4), foreign_arguments (1), lower (18), provided_errors (2), snapshot_queries (9)
binding_calls -> binding_calls (22), branch_values (1), call_expression (1), diagnostics (2), foreign_arguments (2), implementations (15), lower (4), native_calls (3), objc_dispatch (1), property_keys (6), snapshot_queries (20)
binding_thens -> binding_thens (2)
body_entries -> absence (3), access (1), array_construction (1), array_methods (1), assertions (1), body_entries (10), branch_values (1), call_expression (1), class_members (1), closure_bodies (1), closure_values (5), coercion (1), com_class (1), construct_expressions (4), diagnostics (9), exceptions (2), foreign_arguments (2), hierarchy (1), implementations (2), initialization (1), iterable_walks (1), layout_collection (2), literals (3), local_bindings (2), loop_flow (6), lower (19), made_instance (2), module_binding_bodies (3), names (5), native_construction (2), object_layouts (1), object_literals (2), operators (4), optional_chains (2), parameter_entries (4), parameters (1), places (2), property_keys (1), raising_copies (1), receiver_binding (6), returns (10), snapshot_queries (23), statement_branches (2), string_builtins (2), suspended_bodies (6), thenable_jobs (2), typeof_expression (2)
bound_functions -> absence (1), accessors (2), body_entries (1), bound_functions (10), capture_discovery (5), closure_bodies (10), closure_calls (3), closure_context (5), closure_values (6), coercion (1), diagnostics (12), expression_types (1), function_names (1), implementations (8), layout_collection (4), literal_methods (1), lower (23), member_layouts (1), method_calls (1), names (4), object_layouts (2), parameters (5), places (2), property_keys (4), raising_calls (1), raising_reachability (1), receiver_binding (2), returns (1), signature_entries (1), snapshot_queries (24), typeof_expression (1), uniform_inputs (1)
branch_values -> absence (2), array_construction (1), array_methods (1), body_entries (4), branch_values (22), call_expression (1), callable_fields (2), closure_calls (1), closure_values (1), coercion (1), diagnostics (3), expression_types (3), implementations (6), initialization (1), loop_flow (1), lower (15), method_calls (1), objc_dispatch (1), object_layouts (1), optional_chains (2), parameters (1), places (1), property_keys (1), representations (2), returns (1), snapshot_queries (25), typeof_expression (1)
buffers -> body_entries (5), buffers (15), closure_values (2), coercion (5), diagnostics (6), lower (27), native_memory (1), property_keys (3), provided_errors (11), snapshot_queries (17)
call_expression -> arguments (1), binding_calls (1), call_expression (15), class_members (1), closure_calls (1), closure_values (1), com_class (2), construct_expressions (1), diagnostics (8), foreign_arguments (2), foreign_results (2), foreign_values (6), implementations (9), literals (1), local_bindings (1), lower (5), method_calls (4), module_binding_bodies (1), module_namespaces (2), names (3), native_calls (1), objc_dispatch (1), optional_chains (1), parameters (3), primitive_conversion (1), promise_settlement (1), property_keys (4), property_presence (1), raising_calls (3), signature_entries (1), snapshot_queries (20), static_builtins (2), structural_copies (1)
callable_fields -> absence (2), branch_values (3), call_expression (1), callable_fields (1), closure_calls (1), closure_values (1), diagnostics (3), lower (8), method_calls (1), object_layouts (2), optional_chains (1), snapshot_queries (4)
capture_discovery -> capture_discovery (21), generic_copies (1), implementations (4), initialization (3), loop_flow (1), lower (1), names (1), parameter_entries (1), parameters (2), promise_settlement (1), property_keys (2), raising_reachability (2), receiver_binding (7), signature_entries (1), snapshot_queries (39), structural_copies (1), typeof_expression (1)
cast_descriptions -> diagnostics (1), snapshot_queries (3)
claimed_reads -> absence (1), access_families (1), assertions (3), claimed_reads (22), coercion (1), diagnostics (2), expression_types (1), implementations (2), lower (17), parameters (1), returns (1), snapshot_queries (18)
class_members -> body_entries (4), call_expression (1), class_members (12), com_class (2), diagnostics (6), generic_copies (1), gobject_class (4), gobject_templates (1), implementations (6), layout_collection (6), lower (12), made_instance (5), names (3), objc_class (5), object_layouts (4), parameters (2), raising_copies (1), snapshot_queries (14), structural_copies (3)
closed_calls -> closed_calls (3), closure_values (1), implementations (5), loop_flow (1), parameters (3), property_keys (2), snapshot_queries (9)
closure_bodies -> absence (1), body_entries (2), bound_functions (3), capture_discovery (7), closure_bodies (23), closure_values (3), diagnostics (1), foreign_callbacks (1), generic_values (2), implementations (3), json (1), layout_collection (4), lower (10), module_namespaces (1), parameter_entries (3), parameters (2), promise_reactions (1), promise_settlement (1), raising_copies (1), receiver_binding (3), returns (10), signature_entries (3), snapshot_queries (8), structural_copies (1), suspended_bodies (3), thenable_jobs (3), uniform_inputs (1)
closure_calls -> access (1), arguments (3), body_entries (2), closure_bodies (2), closure_calls (20), closure_context (2), coercion (3), diagnostics (9), expression_types (1), foreign_arguments (2), implementations (5), lower (11), object_layouts (1), parameters (4), property_keys (1), raising_calls (2), receiver_binding (1), returns (4), signature_entries (1), snapshot_queries (12), typeof_expression (1)
closure_context -> capture_discovery (4), closure_context (2), parameter_entries (1)
closure_values -> bound_functions (2), capture_discovery (3), closure_bodies (5), closure_context (5), closure_values (36), coercion (2), diagnostics (8), expression_types (1), foreign_values (1), hierarchy (2), implementations (3), initialization (6), layout_collection (5), lower (9), member_layouts (1), places (3), promise_settlement (1), property_keys (1), returns (1), snapshot_queries (20)
coercion -> absence (4), access_families (4), accessors (1), array_construction (1), assertions (1), body_entries (2), callable_fields (2), coercion (21), diagnostics (11), expression_types (3), foreign_arguments (2), foreign_callbacks (1), generator_iteration (1), generic_copies (1), hierarchy (3), implementations (4), layout_collection (1), literal_methods (1), lower (5), member_layouts (1), names (2), native_memory (1), object_layouts (3), property_keys (1), property_presence (1), representations (2), returns (4), signature_entries (1), snapshot_queries (5)
com_class -> body_entries (3), call_expression (2), closure_values (2), com_class (11), construct_expressions (1), diagnostics (11), foreign_arguments (2), foreign_results (3), hierarchy (2), implementations (8), lower (16), names (1), native_calls (1), object_layouts (1), parameters (1), property_keys (2), receiver_binding (1), snapshot_queries (27)
construct_expressions -> absence (1), arguments (4), buffers (2), closure_values (3), coercion (3), construct_expressions (20), construction (3), date_builtins (1), diagnostics (12), expression_types (1), foreign_results (1), gobject_class (1), hierarchy (5), implementations (11), lower (12), made_instance (3), module_binding_bodies (1), names (4), native_calls (2), native_construction (2), objc_class (1), objc_dispatch (1), object_layouts (5), places (3), promise_settlement (1), property_keys (4), property_presence (1), provided_errors (5), raising_calls (4), returns (1), snapshot_queries (32), table_methods (1), typed_arrays (1)
construction -> array_construction (2), bound_functions (1), branch_values (1), call_expression (2), capture_discovery (2), class_members (1), closure_calls (1), closure_context (1), closure_values (1), construct_expressions (5), construction (39), diagnostics (7), expression_types (3), foreign_arguments (1), hierarchy (2), implementations (17), layout_collection (2), lower (7), made_instance (4), module_binding_bodies (2), module_bindings (1), names (6), object_layouts (7), parameters (2), property_keys (2), provided_errors (3), raising_calls (1), receiver_binding (2), snapshot_queries (29), structural_copies (1), typed_arrays (1), typeof_expression (2)
date_builtins -> body_entries (1), closure_values (1), coercion (1), diagnostics (2), lower (2), property_keys (1), snapshot_queries (2)
destructuring -> absence (5), access_families (4), accessors (2), array_construction (3), array_from (2), body_entries (1), branch_values (4), closure_values (1), destructuring (32), diagnostics (12), elision_patterns (2), generator_iteration (3), implementations (3), iterable_walks (1), local_bindings (1), lower (14), module_binding_bodies (1), module_bindings (1), object_layouts (2), parameters (2), places (6), promise_settlement (1), property_keys (4), provided_errors (1), receiver_binding (1), snapshot_queries (32), suspended_bodies (1)
diagnostics -> coercion (1), construction (1), diagnostics (27), exceptions (1), generic_copies (1), implementations (9), lower (11), module_namespaces (1), names (6), object_layouts (7), property_keys (1), snapshot_queries (17), type_tests (1)
elision_patterns -> branch_values (1), destructuring (1), elision_patterns (7), generator_iteration (1), implementations (1), literal_methods (1), lower (10), parameters (1), property_keys (1), provided_errors (2), returns (1), snapshot_queries (6), suspended_bodies (1), type_tests (1)
equality -> absence (2), assertions (1), coercion (1), diagnostics (1), equality (7), expression_types (1), implementations (1), lower (3), operators (1), snapshot_queries (2)
erased_calls -> absence (1), assertions (1), closed_calls (5), closure_values (1), erased_calls (8), generic_copies (1), implementations (6), literal_methods (1), lower (7), parameters (1), property_keys (3), raising_calls (1), snapshot_queries (19), structural_copies (3)
exceptions -> body_entries (5), branch_values (1), closure_values (1), coercion (1), diagnostics (4), exceptions (11), iterator_close (1), layout_collection (1), lower (18), raising_calls (2), snapshot_queries (13)
expression_types -> absence (2), access_families (3), accessors (2), array_methods (1), branch_values (2), coercion (1), diagnostics (2), expression_types (15), foreign_results (1), hierarchy (2), implementations (8), local_bindings (1), lower (12), member_layouts (1), names (2), objc_dispatch (1), object_layouts (1), parameters (1), property_keys (1), receiver_binding (1), returns (2), snapshot_queries (20)
field_initialization -> class_members (1), field_initialization (16), implementations (4), names (2), object_layouts (3), parameters (3), property_keys (4), snapshot_queries (23)
foreign_arguments -> absence (2), arguments (4), body_entries (1), call_expression (1), closure_calls (1), closure_values (2), coercion (5), diagnostics (11), elision_patterns (1), expression_types (1), foreign_arguments (26), foreign_callbacks (7), foreign_results (4), foreign_values (10), implementations (5), local_bindings (2), lower (32), native_calls (1), native_memory (4), object_layouts (2), parameter_entries (1), parameters (6), places (2), property_keys (1), provided_errors (1), representations (1), returns (1), snapshot_queries (21), structural_copies (1)
foreign_callbacks -> arguments (1), capture_discovery (2), closure_context (1), coercion (1), diagnostics (7), foreign_arguments (1), foreign_callbacks (10), foreign_results (3), implementations (3), iterable_walks (8), layout_collection (2), loop_flow (3), lower (32), primitive_conversion (1), snapshot_queries (10)
foreign_results -> coercion (3), diagnostics (8), foreign_arguments (2), foreign_results (7), lower (27), native_memory (3), object_layouts (2), places (1), provided_errors (1), snapshot_queries (4)
foreign_values -> closure_values (1), coercion (4), diagnostics (13), foreign_arguments (2), foreign_results (1), foreign_values (11), hierarchy (2), implementations (1), layout_collection (4), lower (43), native_calls (5), native_memory (4), objc_dispatch (3), snapshot_queries (11)
function_names -> capture_discovery (2), closure_context (1), coercion (1), diagnostics (1), function_names (15), implementations (4), lower (3), names (2), snapshot_queries (14)
generator_iteration -> coercion (1), diagnostics (8), exceptions (1), generator_iteration (18), hierarchy (1), implementations (8), iterator_calls (1), layout_collection (1), lower (6), object_layouts (2), places (1), raising_calls (2), raising_copies (1), returns (2), snapshot_queries (7), suspended_bodies (2)
generic_copies -> diagnostics (1), generic_copies (3), implementations (3), lower (2), member_layouts (1), names (1), object_layouts (1), snapshot_queries (4), structural_copies (1)
generic_values -> absence (1), bound_functions (2), branch_values (1), closure_bodies (2), closure_values (2), diagnostics (2), generic_copies (1), generic_values (15), implementations (5), layout_collection (1), literals (2), lower (12), names (2), object_layouts (1), property_keys (2), raising_calls (2), representations (1), snapshot_queries (14), type_tests (1), typeof_expression (1)
gobject -> body_entries (1), call_expression (1), coercion (1), diagnostics (3), gobject (4), implementations (2), lower (2), names (2), object_layouts (1), snapshot_queries (4)
gobject_class -> body_entries (4), call_expression (4), closure_values (1), coercion (1), com_class (1), construct_expressions (1), diagnostics (15), foreign_arguments (4), gobject_class (20), gobject_templates (10), hierarchy (5), implementations (14), layout_collection (4), lower (19), names (1), native_calls (4), native_construction (2), native_memory (2), objc_dispatch (1), object_layouts (6), parameters (1), property_keys (4), receiver_binding (1), returns (2), snapshot_queries (20), tuples (2)
gobject_templates -> body_entries (1), coercion (1), diagnostics (5), gobject_class (2), gobject_templates (13), hierarchy (3), implementations (8), lower (13), names (1), native_calls (2), objc_class (3), objc_dispatch (1), object_layouts (5), places (1), property_keys (1), snapshot_queries (17)
hierarchy -> access_families (3), capture_discovery (1), construct_expressions (1), generic_copies (1), hierarchy (31), implementations (2), interfaces (2), literal_methods (2), lower (1), member_layouts (1), names (3), object_layouts (7), provided_errors (1), signature_entries (1), snapshot_queries (7), suspended_bodies (1)
host_builtins -> absence (1), body_entries (3), branch_values (1), diagnostics (5), host_builtins (4), implementations (2), lower (8), property_keys (1), snapshot_queries (10), string_builtins (4)
implementations -> implementations (5), scopes (1)
initialization -> access (1), assertions (2), bigint (1), branch_values (1), call_expression (2), capture_discovery (1), class_members (3), closure_context (1), closure_values (7), destructuring (1), diagnostics (1), gobject (1), hierarchy (1), implementations (12), initialization (60), iterable_walks (1), local_bindings (2), loop_flow (1), lower (12), module_binding_bodies (2), module_bindings (2), module_evaluation (1), names (6), object_layouts (1), parameter_entries (1), parameters (1), property_keys (1), raising_calls (2), raising_copies (2), raising_reachability (9), receiver_binding (1), snapshot_queries (78), type_tests (1), typeof_expression (2)
interfaces -> access_families (3), call_expression (1), cast_descriptions (2), hierarchy (8), implementations (8), interfaces (37), layout_collection (5), literal_methods (5), lower (4), names (3), object_layouts (6), parameters (9), property_keys (4), raising_reachability (1), representations (2), returns (3), snapshot_queries (25)
iterable_walks -> array_from (1), body_entries (2), call_expression (2), closure_values (1), coercion (3), destructuring (2), diagnostics (9), foreign_arguments (1), generator_iteration (3), implementations (6), iterable_walks (37), iterator_calls (2), iterator_close (1), loop_flow (6), lower (17), native_calls (1), native_construction (1), object_builtins (1), object_layouts (1), places (2), property_keys (3), returns (1), snapshot_queries (19), suspended_bodies (2)
iteration_callbacks -> absence (2), array_from (2), array_methods (3), body_entries (2), branch_values (1), closure_calls (1), coercion (1), diagnostics (12), iteration_callbacks (15), loop_flow (6), lower (25), provided_errors (1), snapshot_queries (10)
iterator_calls -> call_expression (2), closure_values (1), diagnostics (1), exceptions (1), hierarchy (3), implementations (2), interfaces (1), iterable_walks (2), iterator_calls (14), iterator_close (5), literal_methods (2), lower (7), method_calls (1), parameters (1), printed/edges (1), property_keys (2), returns (1), snapshot_queries (10), statement_branches (1), suspended_bodies (1)
iterator_close -> arguments (2), call_expression (1), closure_calls (2), closure_values (1), coercion (2), diagnostics (7), exceptions (3), hierarchy (2), implementations (5), iterable_walks (1), iterator_calls (6), iterator_close (17), literal_methods (3), lower (35), object_layouts (2), parameters (3), property_keys (1), provided_errors (3), raising_calls (1), raising_reachability (1), returns (4), signature_entries (1), snapshot_queries (19), statement_branches (5)
json -> absence (3), access_families (1), body_entries (1), diagnostics (2), implementations (7), json (70), layout_collection (2), lower (43), object_builtins (3), object_layouts (2), property_keys (1), property_presence (1), returns (1), snapshot_queries (5)
layout_collection -> layout_collection (34), member_layouts (1), object_layouts (3)
literal_methods -> closed_calls (2), hierarchy (4), implementations (10), interfaces (5), literal_methods (25), literal_methods/absence (2), literal_methods/adapters (1), literal_methods/values (1), lower (2), names (4), object_layouts (2), parameters (1), property_keys (5), raising_reachability (1), receiver_binding (3), snapshot_queries (23), typeof_expression (5)
literal_methods/absence -> closed_calls (1), closure_values (1), hierarchy (1), implementations (4), literal_methods (3), literal_methods/absence (5), loop_flow (1), parameters (2), property_keys (1), snapshot_queries (7), typeof_expression (2)
literal_methods/adapters -> closure_calls (1), hierarchy (1), implementations (2), interfaces (3), layout_collection (6), literal_methods (4), literal_methods/adapters (10), lower (14), raising_calls (1), returns (3), snapshot_queries (4), type_tests (1)
literal_methods/values -> closed_calls (4), closure_values (1), implementations (6), literal_methods (2), literal_methods/values (7), loop_flow (2), lower (1), parameters (1), property_keys (4), snapshot_queries (8), typeof_expression (2)
literals -> diagnostics (4), implementations (6), layout_collection (1), literals (5), lower (7), object_layouts (1), representations (1), returns (1), snapshot_queries (19)
local_bindings -> absence (1), accessors (1), array_construction (1), binding_calls (1), body_entries (1), branch_values (1), capture_discovery (2), closure_bodies (1), closure_context (2), closure_values (4), coercion (1), construct_expressions (1), destructuring (1), diagnostics (9), expression_types (2), implementations (4), initialization (1), layout_collection (1), literals (1), local_bindings (9), lower (9), module_binding_bodies (3), module_binding_types (2), module_bindings (1), names (1), native_calls (1), objc_dispatch (1), places (2), property_keys (1), raising_reachability (1), representations (1), returns (1), snapshot_queries (22), typeof_expression (1)
loop_flow -> assignments (4), body_entries (9), branch_values (2), destructuring (1), diagnostics (7), exceptions (2), implementations (1), iterable_walks (1), local_bindings (1), loop_flow (41), lower (23), snapshot_queries (28), statement_branches (3)
lower -> access_families (3), access_family_functions (1), body_entries (2), bound_functions (1), call_expression (1), capture_discovery (4), class_members (2), closure_bodies (1), closure_context (6), diagnostics (11), erased_calls (1), expression_types (1), function_names (1), generic_copies (3), generic_values (1), hierarchy (3), implementations (8), initialization (2), interfaces (1), iterator_calls (1), layout_collection (5), literal_methods/adapters (1), lower (21), member_layouts (2), member_origins (1), module_bindings (1), module_evaluation (2), module_exports (1), module_namespaces (1), names (4), native_modules (1), object_layouts (1), overload_results (2), parameter_entries (1), printed (3), printed/edges (1), project_semantics (1), promise_reactions (1), property_presence (2), raising_calls (1), raising_copies (2), raising_reachability (1), receiver_binding (1), representations (1), signature_entries (6), snapshot_queries (1), structural_copies (4), suspended_bodies (3), thenable_jobs (1), type_tests (2), typed_signatures (1)
made_instance -> call_expression (1), class_members (5), closure_values (2), com_class (1), construct_expressions (2), construction (6), diagnostics (6), foreign_arguments (1), gobject_class (1), hierarchy (1), implementations (4), lower (3), made_instance (20), names (1), objc_class (1), object_layouts (3), parameters (1), raising_calls (1), receiver_binding (1), reference_index (3), snapshot_queries (12), structural_copies (3), typeof_expression (3)
member_layouts -> absence (2), access (2), access_families (4), access_family_functions (1), array_methods (2), bound_functions (1), buffers (2), closure_values (1), diagnostics (3), expression_types (4), generator_iteration (1), generic_copies (1), gobject_templates (1), hierarchy (4), implementations (4), layout_collection (2), literal_methods (3), lower (4), member_layouts (6), names (2), native_memory (3), objc_class (1), object_builtins (2), object_layouts (8), object_literals (1), places (1), property_keys (5), property_presence (1), provided_errors (2), returns (3), snapshot_queries (9), symbol_builtins (1), table_methods (2), tuples (2), typed_arrays (1)
member_origins -> closure_bodies (1), member_origins (22), names (4), object_layouts (1)
method_calls -> absence (2), access (3), accessors (1), arguments (2), array_methods (1), binding_calls (3), body_entries (1), bound_functions (1), branch_values (1), buffers (2), call_expression (8), callable_fields (2), closure_calls (7), coercion (1), date_builtins (1), diagnostics (10), foreign_arguments (2), generator_iteration (2), hierarchy (5), implementations (6), iterable_walks (1), lower (15), member_layouts (2), method_calls (14), names (3), native_calls (5), numeric_arguments (2), numeric_builtins (1), objc_class (1), objc_dispatch (3), object_layouts (5), optional_chains (3), parameters (1), promise_reactions (1), promise_settlement (1), property_keys (12), property_presence (1), raising_calls (3), representations (1), returns (2), snapshot_queries (19), string_builtins (2), suspended_bodies (1), symbol_builtins (1), table_methods (2), type_tests (1), typed_arrays (1)
module_binding_bodies -> body_entries (3), coercion (2), construct_expressions (1), destructuring (1), diagnostics (2), implementations (4), initialization (6), loop_flow (1), lower (8), module_binding_bodies (9), places (2), property_keys (3), provided_errors (2), raising_reachability (2), snapshot_queries (32), typeof_expression (1)
module_binding_types -> absence (2), accessors (1), assignments (2), branch_values (1), call_expression (1), closure_bodies (1), diagnostics (1), implementations (4), literals (3), local_bindings (1), lower (3), module_binding_types (9), module_bindings (3), module_exports (3), parameters (1), property_keys (1), returns (1), snapshot_queries (15)
module_bindings -> destructuring (3), diagnostics (1), implementations (5), initialization (2), layout_collection (1), literals (2), local_bindings (1), loop_flow (1), lower (4), module_binding_types (13), module_bindings (9), module_evaluation (1), module_exports (4), names (1), object_layouts (2), property_keys (1), returns (2), snapshot_queries (27), typeof_expression (1)
module_evaluation -> body_entries (4), destructuring (1), diagnostics (3), exceptions (1), implementations (5), initialization (1), layout_collection (2), loop_flow (1), lower (19), module_binding_bodies (8), module_evaluation (22), module_namespaces (2), raising_calls (1), snapshot_queries (24)
module_exports -> accessors (1), implementations (7), lower (2), module_evaluation (1), module_exports (6), module_namespaces (2), parameters (1), representations (2), snapshot_queries (8)
module_namespaces -> body_entries (1), capture_discovery (1), closure_bodies (3), closure_context (1), closure_values (3), diagnostics (5), implementations (9), layout_collection (3), lower (12), module_evaluation (2), module_namespaces (14), places (1), promise_settlement (2), property_keys (2), provided_errors (1), returns (3), snapshot_queries (20), thenable_jobs (2), typeof_expression (1)
names -> call_expression (1), diagnostics (2), generic_copies (1), implementations (7), local_bindings (1), lower (3), names (18), object_layouts (5), parameter_entries (2), property_keys (2), returns (2), snapshot_queries (18)
native_calls -> binding_calls (3), call_expression (4), class_members (1), com_class (3), diagnostics (8), expression_types (1), foreign_arguments (4), foreign_callbacks (6), foreign_results (4), foreign_values (2), gobject_class (1), implementations (11), lower (3), names (2), native_calls (16), native_construction (1), native_memory (1), native_modules (1), objc_dispatch (7), object_layouts (1), optional_chains (1), parameters (1), property_keys (1), snapshot_queries (13)
native_construction -> accessors (1), arguments (1), binding_calls (4), body_entries (1), call_expression (2), closure_values (3), diagnostics (7), expression_types (1), foreign_arguments (2), foreign_values (1), gobject_class (1), gobject_templates (1), implementations (8), lower (8), native_calls (5), native_construction (9), objc_class (2), objc_dispatch (1), object_layouts (1), places (1), property_keys (3), snapshot_queries (14)
native_memory -> absence (2), body_entries (9), branch_values (1), coercion (11), diagnostics (26), expression_types (2), foreign_arguments (2), foreign_results (3), foreign_values (1), gobject (1), implementations (9), literals (1), local_bindings (2), lower (68), native_memory (45), object_layouts (2), places (5), property_keys (1), provided_errors (1), returns (1), snapshot_queries (34), typed_arrays (1)
native_modules -> native_modules (4), object_layouts (2), snapshot_queries (2)
native_properties -> accessors (2), body_entries (1), call_expression (1), diagnostics (3), gobject_class (1), implementations (1), native_calls (1), objc_dispatch (2), snapshot_queries (1)
numeric_arguments -> absence (2), body_entries (1), coercion (1), lower (24), numeric_arguments (23), parameters (1), provided_errors (1), snapshot_queries (9), typeof_expression (1)
numeric_builtins -> body_entries (3), coercion (4), diagnostics (4), lower (26), numeric_arguments (3), numeric_builtins (3), provided_errors (3), snapshot_queries (5), string_builtins (1)
objc_class -> body_entries (3), call_expression (2), capture_discovery (3), closure_values (1), com_class (1), construct_expressions (4), diagnostics (11), foreign_arguments (1), gobject (1), gobject_templates (2), hierarchy (6), implementations (15), layout_collection (6), lower (19), member_layouts (1), names (3), native_calls (1), objc_class (26), objc_dispatch (6), object_layouts (4), parameters (1), places (1), property_keys (6), receiver_binding (1), returns (2), snapshot_queries (33), type_tests (1)
objc_dispatch -> absence (3), body_entries (4), branch_values (2), call_expression (2), callable_fields (1), capture_discovery (1), coercion (2), diagnostics (14), foreign_arguments (3), implementations (19), lower (25), names (10), native_calls (4), native_modules (1), native_properties (1), objc_dispatch (39), object_layouts (5), optional_chains (1), property_keys (6), returns (1), snapshot_queries (49), type_tests (1)
object_assign -> absence (1), access_families (2), assertions (2), coercion (1), diagnostics (3), implementations (1), lower (12), object_assign (4), object_layouts (1), places (1), property_keys (2), receiver_binding (1), representations (1), snapshot_queries (3)
object_builtins -> access_families (3), accessors (2), body_entries (4), branch_values (1), call_expression (1), coercion (3), diagnostics (7), expression_types (1), implementations (5), lower (16), object_assign (1), object_builtins (18), object_layouts (3), places (1), property_keys (1), property_presence (1), receiver_binding (1), snapshot_queries (19)
object_layouts -> diagnostics (3), foreign_values (1), generator_iteration (1), generic_copies (1), hierarchy (2), implementations (5), layout_collection (5), member_layouts (4), module_namespaces (2), names (4), object_layouts (17), provided_errors (3), signature_entries (2), snapshot_queries (7), suspended_bodies (1), tuples (1)
object_literals -> access_families (3), accessors (2), body_entries (1), closure_values (1), coercion (2), diagnostics (4), expression_types (2), foreign_arguments (1), generator_iteration (1), implementations (4), layout_collection (2), lower (5), names (1), native_memory (3), object_layouts (4), object_literals (10), places (2), property_keys (4), receiver_binding (2), snapshot_queries (8), table_methods (1)
operators -> absence (2), assignments (7), bigint (5), body_entries (4), branch_values (3), coercion (3), diagnostics (10), equality (1), expression_types (1), implementations (1), lower (11), objc_dispatch (1), operators (15), parameters (1), primitive_conversion (6), property_presence (2), snapshot_queries (16), string_builtins (1), type_tests (1), typeof_expression (1)
optional_chains -> absence (6), accessors (4), array_methods (1), body_entries (6), branch_values (5), callable_fields (2), closure_calls (2), closure_values (1), coercion (1), diagnostics (6), implementations (4), lower (8), member_layouts (2), objc_dispatch (6), optional_chains (21), property_keys (3), snapshot_queries (13)
overload_results -> call_expression (1), implementations (5), lower (1), overload_results (7), receiver_binding (1), representations (1), returns (3), snapshot_queries (6)
parameter_entries -> branch_values (1), closure_context (3), closure_values (4), coercion (1), destructuring (4), diagnostics (1), implementations (4), lower (4), names (1), parameter_entries (21), parameters (7), receiver_binding (2), snapshot_queries (29)
parameters -> absence (5), accessors (2), arguments (3), body_entries (1), branch_values (1), closure_calls (2), closure_values (1), destructuring (2), diagnostics (3), elision_patterns (2), expression_types (1), foreign_arguments (3), foreign_values (1), implementations (13), lower (5), parameter_entries (5), parameters (32), receiver_binding (1), representations (1), returns (2), snapshot_queries (22)
places -> absence (1), access (7), access_families (3), accessors (14), array_methods (4), assignments (1), body_entries (2), claimed_reads (1), closure_values (3), coercion (7), diagnostics (12), expression_types (1), generator_iteration (1), gobject_templates (1), implementations (4), initialization (3), layout_collection (2), local_bindings (2), lower (13), module_binding_bodies (5), module_namespaces (2), names (1), native_memory (5), native_properties (2), objc_class (1), object_layouts (2), places (20), property_keys (11), property_presence (3), provided_errors (2), receiver_binding (1), returns (1), snapshot_queries (14), tuples (1)
primitive_conversion -> body_entries (1), buffers (1), coercion (1), diagnostics (4), hierarchy (1), implementations (2), iterator_calls (6), lower (21), member_layouts (1), numeric_arguments (1), object_layouts (1), primitive_conversion (13), property_keys (1), provided_errors (2), returns (2), snapshot_queries (6), string_builtins (2), type_tests (1)
printed -> capture_discovery (1), hierarchy (2), printed (20), printed/edges (2)
printed/edges -> call_expression (1), closure_values (1), hierarchy (3), implementations (3), lower (1), names (1), object_layouts (1), parameters (1), printed/edges (8), property_keys (2), provided_errors (1), snapshot_queries (3)
project_semantics -> project_semantics (2)
promise_reactions -> body_entries (1), capture_discovery (1), closure_bodies (3), closure_calls (1), closure_context (2), closure_values (3), coercion (1), diagnostics (5), exceptions (1), implementations (2), layout_collection (2), lower (16), places (1), promise_reactions (11), promise_settlement (2), property_keys (2), raising_calls (1), returns (2), signature_entries (1), snapshot_queries (7), thenable_jobs (1)
promise_settlement -> body_entries (6), closure_values (3), coercion (1), diagnostics (11), foreign_values (1), implementations (3), iteration_callbacks (1), layout_collection (2), lower (24), promise_settlement (16), provided_errors (1), representations (1), snapshot_queries (27), thenable_jobs (2)
property_keys -> access (1), body_entries (1), coercion (2), diagnostics (5), implementations (8), local_bindings (2), lower (19), names (1), property_keys (41), snapshot_queries (35)
property_presence -> access (2), access_families (2), array_methods (1), assignments (2), body_entries (6), branch_values (2), coercion (2), diagnostics (8), expression_types (1), hierarchy (3), implementations (12), lower (21), module_namespaces (1), names (1), native_memory (1), object_builtins (4), object_layouts (5), parameters (2), places (3), property_keys (16), property_presence (23), snapshot_queries (24), type_tests (4), typeof_expression (2)
provided_errors -> absence (1), body_entries (1), branch_values (1), coercion (1), diagnostics (5), exceptions (1), hierarchy (2), implementations (4), layout_collection (2), lower (27), object_layouts (1), places (2), property_keys (1), provided_errors (13), returns (1), snapshot_queries (17), string_builtins (1), type_bases (2), typeof_expression (1)
raising_calls -> access_families (4), closure_calls (1), closure_values (1), diagnostics (1), erased_calls (3), generic_copies (1), hierarchy (1), implementations (10), interfaces (3), iterator_calls (2), literal_methods (1), lower (10), names (1), objc_dispatch (1), printed/edges (2), property_keys (1), raising_calls (32), raising_copies (5), snapshot_queries (22), structural_copies (3)
raising_copies -> access_families (2), body_entries (1), capture_discovery (3), class_members (4), closure_calls (1), generic_copies (2), hierarchy (4), implementations (4), interfaces (2), iterator_calls (4), literal_methods (1), lower (4), names (4), object_layouts (1), parameters (3), printed/edges (1), raising_calls (3), raising_copies (16), raising_reachability (14), snapshot_queries (19), string_builtins (1), structural_copies (3), typeof_expression (2)
raising_reachability -> access_families (2), array_construction (3), capture_discovery (2), class_members (2), closure_calls (2), closure_context (1), hierarchy (1), initialization (1), iterator_calls (9), iterator_close (1), loop_flow (2), lower (1), module_binding_bodies (1), object_layouts (1), parameter_entries (1), parameters (2), places (1), printed/edges (2), raising_calls (4), raising_copies (5), raising_reachability (15), receiver_binding (1), snapshot_queries (22), string_builtins (1), structural_copies (3), typeof_expression (1)
receiver_binding -> class_members (1), diagnostics (4), hierarchy (1), implementations (6), lower (7), object_layouts (2), provided_errors (1), receiver_binding (12), snapshot_queries (27), type_tests (1)
reference_index -> construction (3)
representations -> absence (2), generator_iteration (1), representations (16), snapshot_queries (3), suspended_bodies (2), table_methods (1), tuples (1), typed_arrays (3)
returns -> absence (3), access_families (1), body_entries (1), capture_discovery (2), closure_context (2), coercion (3), diagnostics (5), exceptions (1), foreign_values (2), generic_values (1), implementations (15), iteration_callbacks (1), loop_flow (1), lower (14), object_layouts (1), property_keys (1), receiver_binding (2), representations (1), returns (21), signature_entries (2), snapshot_queries (15), thenable_jobs (1), tuples (1), typeof_expression (1)
signature_entries -> closure_bodies (1), hierarchy (4), implementations (2), interfaces (1), layout_collection (3), lower (1), member_origins (1), object_layouts (3), raising_copies (1), representations (2), returns (1), signature_entries (12), snapshot_queries (2), suspended_bodies (1), uniform_inputs (1), virtual_returns (1)
snapshot_queries -> branch_values (1), implementations (11), loop_flow (1), object_layouts (4), property_keys (1), scopes (2), snapshot_queries (53)
statement_branches -> assignments (2), body_entries (7), branch_values (5), closure_values (1), coercion (1), diagnostics (3), implementations (1), loop_flow (7), lower (21), made_instance (3), snapshot_queries (18), statement_branches (18)
static_builtins -> array_construction (2), array_from (2), body_entries (1), branch_values (1), call_expression (1), diagnostics (3), gobject (2), host_builtins (4), implementations (1), json (2), lower (5), names (1), native_calls (2), native_memory (6), numeric_arguments (1), numeric_builtins (5), objc_class (1), objc_dispatch (1), object_builtins (5), primitive_conversion (2), promise_settlement (2), property_keys (1), property_presence (1), snapshot_queries (10), static_builtins (9), string_builtins (2), symbol_builtins (3), typed_arrays (2), typeof_expression (2)
string_builtins -> absence (2), access (3), arguments (1), body_entries (2), branch_values (1), call_expression (4), claimed_reads (1), coercion (1), diagnostics (7), exceptions (1), expression_types (1), implementations (3), iteration_callbacks (1), lower (27), method_calls (1), numeric_arguments (1), printed/edges (3), property_keys (1), provided_errors (2), raising_calls (2), snapshot_queries (18), statement_branches (1), string_builtins (8), string_positions (1), structural_copies (1)
string_positions -> absence (1), assertions (1), diagnostics (1), lower (2), numeric_arguments (2), snapshot_queries (1), typeof_expression (2)
structural_copies -> absence (1), access_families (1), call_expression (2), class_members (1), closure_values (1), construction (2), erased_calls (3), generic_copies (1), implementations (10), iterator_calls (2), literal_methods (2), local_bindings (1), lower (6), object_layouts (1), parameters (3), property_keys (1), raising_calls (1), snapshot_queries (19), string_builtins (1), structural_copies (17), tuples (1)
suspended_bodies -> array_from (1), body_entries (3), closure_bodies (1), coercion (2), diagnostics (5), exceptions (1), generator_iteration (2), hierarchy (1), implementations (2), iterable_walks (5), loop_flow (3), lower (8), object_layouts (1), promise_settlement (1), representations (1), returns (1), snapshot_queries (12), suspended_bodies (7), thenable_jobs (2)
symbol_builtins -> body_entries (3), diagnostics (5), lower (6), property_keys (1), snapshot_queries (5)
table_methods -> absence (2), array_methods (2), body_entries (8), branch_values (1), claimed_reads (1), closure_calls (1), closure_values (1), coercion (7), diagnostics (9), expression_types (1), implementations (2), iterable_walks (9), iteration_callbacks (2), loop_flow (8), lower (23), object_layouts (1), property_keys (3), representations (1), snapshot_queries (16), table_methods (6)
thenable_jobs -> binding_thens (1), body_entries (1), call_expression (3), capture_discovery (1), closure_bodies (6), closure_context (2), closure_values (5), coercion (6), diagnostics (11), generic_copies (1), hierarchy (4), implementations (3), layout_collection (4), lower (25), names (3), object_layouts (1), parameters (4), places (2), promise_settlement (11), property_keys (1), returns (3), signature_entries (3), snapshot_queries (9), thenable_jobs (18), type_tests (1)
tuples -> coercion (2), diagnostics (5), implementations (3), layout_collection (1), lower (7), module_binding_types (1), object_layouts (4), places (2), representations (2), returns (2), snapshot_queries (6)
type_tests -> accessors (3), body_entries (9), branch_values (1), coercion (3), construction (2), diagnostics (10), foreign_results (1), foreign_values (1), gobject_class (1), hierarchy (1), implementations (10), lower (23), native_calls (4), native_memory (2), objc_class (3), objc_dispatch (1), property_keys (2), provided_errors (1), snapshot_queries (19), type_tests (15), typeof_expression (1)
typed_arrays -> array_methods (1), body_entries (6), buffers (3), closure_values (1), coercion (6), diagnostics (9), hierarchy (1), implementations (1), lower (23), method_calls (1), numeric_arguments (1), object_layouts (1), places (1), property_keys (2), provided_errors (3), snapshot_queries (15), type_bases (1), typed_arrays (20)
typed_signatures -> capture_discovery (1), closure_bodies (3), object_layouts (1), representations (1), signature_entries (1), typed_signatures (12)
typeof_expression -> absence (2), body_entries (5), branch_values (1), call_expression (3), claimed_reads (1), closure_values (2), diagnostics (2), expression_types (1), implementations (4), initialization (2), literal_methods (1), literals (2), lower (9), member_layouts (1), names (1), parameters (1), property_keys (1), snapshot_queries (19), typeof_expression (11)
uniform_inputs -> absence (1), bound_functions (2), capture_discovery (1), closure_values (4), implementations (2), lower (27), parameter_entries (3), parameters (4), receiver_binding (2), returns (2), snapshot_queries (10), uniform_inputs (28)
virtual_returns -> implementations (2), interfaces (5), lower (1), raising_copies (1), representations (1), returns (2), virtual_returns (22)
```

</details>

The following adjacency lists all 8,271 resolved direct pairs starting in the original `lower.rs`. A bare number is a target's baseline source line in the inventory. A path and line identifies a target under the existing `lower/` directory. A callable with no measured outgoing pair has no row.

<details>
<summary>Direct call adjacency for lower.rs</summary>

```text
344 settle_printer_checks -> printed:54
804 Hierarchy::descends -> 774
810 Hierarchy::is_an_error -> 774
817 Hierarchy::declaring -> 774, 826, 872
826 Hierarchy::declaring_above -> 782, 872
836 Hierarchy::root_declaring -> 774, 826, 836, 872
900 Hierarchy::constructor -> 774
906 Hierarchy::slot_for -> 836
917 Hierarchy::descends_from -> 774, 936
929 Hierarchy::interfaces_of -> 782
936 Hierarchy::implements_transitively -> 782
942 Hierarchy::overridden -> 817, 836, 917, access_families:926, literal_methods:37
975 generic_classes -> 1150, 23334, 23653, 23679, 23793, implementations:114
1001 reads_a_name -> 23772, 23793
1010 names_only_a_type_parameter -> 23793
1035 implemented_member -> 23793
1053 nominal_or_stand_in -> 1154, 21130
1262 collect_anonymous_objects -> 1035, 1053, 1154, 21130
1362 collect_stored_members -> 743, 1476, 1543, 23679, 23793, 29253, 29293, 55052, implementations:114, literal_methods:29
1476 declares_a_method_alone -> 1154, 1526, 21130, 23718, 23793, 41470
1543 is_an_instantiation -> 1526, 23793
1593 record_parents -> 1567
1631 collect_interfaces -> 1125, 1150, 1775, 2036, 2161, 2971, 21031, 23653, 23679, 23793
1775 collect_cast_faces -> 1053, 1154, 21130, 23679, 24594, cast_descriptions:17, cast_descriptions:25
1835 number_slots -> 836, 942
1860 infer_implements -> 817, 917, 2019, interfaces:167, interfaces:432, literal_methods:41, literal_methods:143, literal_methods:147, literal_methods:240
2019 structural_candidates -> literal_methods:37
2036 collect_carried_protocols -> 21031
2215 note_objc_state -> 1125, 2253, 2285, 37542
2310 hierarchy_class_name -> 1053, 23653, 23679, 23793
2367 widest_closure -> 18575
2388 provided_error_identities -> 21136
2407 needs_closure_slots -> 758, 2422
2422 receives_a_function_value -> 14830
2488 collect_hierarchy -> 891, 1125, 1150, 1262, 1362, 1631, 1835, 1860, 2186, 2215, 2310, 2367, 2388, 2407, 2453, 2971, 5727, 21031, 23347, 23653, 23679, 23793, access_families:955, access_families:969, implementations:114, literal_methods:85
2642 raising_member_slots -> 836, 891, 942, 1125, 2876, 2907, 2953, 2971, 23334, 78476, access_families:101, access_families:892, implementations:114, iterator_calls:84, iterator_calls:270
2815 the_constructor_declared_by -> 23679, 23793, 36878
2844 children_in_the_body_of -> 2863, 11681, 23679, 23793, 36878
2863 instance_initializer -> 10499, 14296, 23679, 23793, implementations:114
2876 interface_member_of -> 23679, 29321
2907 members_filling -> 917, 1125, 1150, 2971, 6205, 23679, 36878, access_families:109, access_families:946
2971 member_dispatch_key -> 23793, 29253, 29293
3236 thenable_job_fields -> 3222
3267 resolving_function_fields -> 3222
3296 reactions -> 3789, 23653, 23679, 23793, 24583, 25185, implementations:114
3348 bound_functions -> 3789, 23653, 23679, 23793, 25185, implementations:114
3396 module_jobs -> 3789
3473 ReactionShape::field_of -> 3451
3481 ReactionShape::fields -> 3451
3509 thenables -> 872, 3579, 3678
3579 binding_thenables -> 3669, 3713, 23653, 23793, 25391, 29281, 78472
3669 parameters_of -> 23679, 23793
3678 class_thenable -> 1154, 3669, 3713, 21031, 21130
3713 thenable_job -> 3789, 12339, 18575
3811 collect_method_used_as_value -> 14296, 23653, 23793, implementations:114
3850 uses_its_receiver -> 23653, 23764, 23793, 28620
3970 reached_by_name -> 23793, 24653, 24957
4120 opaque_handle -> 4120
4180 literal_field_names -> 23653, 23679, 23793, 29081
4338 runs_a_static_initializer -> 23653, 23679, 23793, 31933, 31955, 48942
4449 runs_an_initializer -> 4449, 23679, 23793
4495 carries_code -> 4388, 4433, 4449, 4495, 23679, 23793
4515 collect_kind -> 4515
4645 closure_body_name -> 4528, 4534
4655 receiving_function_name -> 7161
4728 closure_class -> 4293, 4528
4737 closure_method -> 4293, 4528
4743 closure_erased_method -> 4293, 4680
4771 not_a_plain_function -> 4793
4799 settler_symbols -> 23653, 23679, 23793, 58657
4877 assigned_anywhere -> 23653, 23679, 23793, 38915
4918 captures_of -> 1001, 1010, 3789, 3970, 23653, 23764, 23793, 24957, 25004, 25254, 28620, initialization:464, initialization:497, initialization:550, parameter_entries:891
5068 nested_closures -> 4918, 25266
5135 collect_closures -> 4799, 4877, 4918, 5068, 5196, 23334, 25266, 28556, 28580, implementations:114
5196 collect_function_values -> 3789, 3811, 3850, 4793, 5382, 23679, 23772, 23793, 25088
5382 function_value -> 3789, 12339, 28571, 36878
5582 qualified_names -> 1150, 5662, 23334, 23653, 25391, 78472, implementations:114
5744 abstract_generators -> 5759
5759 abstract_generator_kind -> 21136
5835 AddedKeys::written_by -> 5835, 23679, 23793, 25185, 31303, 47564, implementations:114
5896 added_keys -> 5835, 23653, 23679, 23793, 25185, 87804, 87839, implementations:114
6009 presence_keys -> 23679, 23793, 29081, 46880, 47564
6205 the_function_of -> 23679, 23793
6307 a_callee_with_a_body -> 6205, 6244, 23793
6318 declared_base_class -> 23653, 23679, 23793, 24653
6382 an_operator_that_can_raise -> 23653, 23679, 23793, 24583, 31303
6429 a_synthesized_throw -> 6382, 6439, 23793, 31933, array_construction:31, initialization:262, iterator_calls:262
6439 an_immutable_store -> 38966, 39011, 51213
6453 walk_one_declaration -> 1150, 2815, 2844, 3669, 6244, 6290, 6307, 6429, 11681, 20596, 23653, 23679, 23793, 24653, 28446, 65407, 78683, access_families:892, iterator_calls:411
6691 const_alias_of -> 10499, 23653, 23679, 23793, 24653, 25060, 29253, 31321
6710 collect_view_classes -> 6763, 18441, 24594, 78488, implementations:114
6763 declared_view_class -> 23793, 24594, implementations:114
6782 const_function_aliases -> 6691, 23653, 29253, implementations:114
6795 function_behind_const -> 6244, 6691, 23793, implementations:114
6819 throwing_symbols -> 6205, 6244, 6318, 6453, 6782, 6974, 23653, 23793, parameter_entries:93
6974 copyable_symbols -> 6196, 7132, 8214
7041 why_it_cannot_be_copied -> 6205, 12339, 23653
7075 a_copy_can_be_made_of -> 12339, 23653, 23793
7132 can_be_copied -> 2815, 6205, 7075
7203 a_raising_callee_of -> 2815, 6318, 6795, 23653, 23679, 23793, 24653, 36878, 78476
7305 raising_callees_of -> 7203, 52001, 65356, iterator_calls:270, iterator_calls:420, printed/edges:179
7339 eligible_declarations -> 2815, 6205, 7075, 8007, 11748, 36878
7459 raising_copies -> 7305, 7339, 7609, 7622, 7647, 7726, 7885, 8311, 8466, 8492, 11748
7609 raising_body_calls -> 11748
7622 close_over_callees -> 7305, 11748
7647 what_holds_the_gate_off -> 7959, 7988, 8007, 8311, 11748
7726 the_cause_below_the_gate -> 6205, 7823, 7870, 23653, 23679, 23793, 36878, 64864, implementations:114
7823 the_symbol_cause -> 7041, 7870, implementations:114
7885 describe_gate_holder -> 6244, 23653, 23679, 23793, 31321
7959 wrappable_functions -> 23793
7988 a_closure_callee -> 23793
8007 a_copy_can_contain -> 7305, 8107, 8246, 64864, array_construction:31, iterator_calls:258, iterator_calls:266, printed/edges:179
8107 a_call_that_can_raise -> 6307, 8214, 23653, 23679, 23793, 24653, 65407, 78683, access_families:892, array_construction:31, iterator_calls:262, iterator_calls:420, printed/edges:179
8214 a_value_held_callee -> 4793, 23793, closure_context:76
8246 a_value_held_call -> 8214, 23653, 23679, 23793, 24653, 31321, 65407, 78683, literal_methods:433
8311 functions_used_as_values -> 6205, 23679, 23793, 24653, 36878
8466 closure_bodies_that_can_raise -> 8107, 11748
8492 calls_guarded_by_a_try -> 7305, 11681, 23679, 23793, 52001, 65407, iterator_calls:258, iterator_calls:262, iterator_calls:420, iterator_close:309
8587 written_field_orders -> 4180
8655 naming -> 5582, 5727, 5896, 6009, 6819, 7459, 8567, 8587, 23334, closure_context:35, closure_context:56, implementations:114, initialization:1203, iterator_calls:113, printed/edges:72
8740 storable -> 9822, 24453, 24512
8831 closure_typed_global -> 4142, 8909, 8919, 8929, 23793, 78396
8909 declared_once -> 23653, implementations:114
8919 initialized_before_use -> 23653, initialization:286
8929 reassigned_anywhere -> 23653, 38857, implementations:68, implementations:114
8976 declare_a_closure_global -> 8812, 23653, 23671
9011 declaration_is_exported -> 23653, 25254
9027 declared_literal -> implementations:114
9057 declared_string_literal -> implementations:114
9077 binding_of -> 23653, 49815, implementations:114
9115 global_object -> 9077, 23653, 23679, 25285, implementations:114
9142 settle_by_binding -> 9077, 9252, 9291, 20270, 23653, 23679, 49815, 63997
9300 module_scope_probe -> 23347
9313 collect_module_scope -> 462, 8703, 8740, 8831, 8976, 9011, 9027, 9057, 9115, 9142, 9300, 9665, 9719, 10034, 10457, 10499, 10522, 10565, 15241, 23653, 23679, 23793, 24583, 24621, 24957, 25254, 25289, 31447, implementations:114, layout_collection:401
9665 add_initialized_flags -> 8812, 23671, implementations:114, initialization:292
9692 binding_element_parts -> 23679, 23793, 67161
9719 declare_a_destructured_module_binding -> 8740, 9793, 10457, 10499, 23653, 23793, 24583, 66206, 67116
9793 refuse_the_whole_pattern -> 23653, 67116
9813 representation_mismatch -> 9822
9822 representation_word -> 9890
9911 settled_declaration_type -> 10077, 10137, 10253, 10334, 10436, 24583, 66206
10034 settled_global_type -> 9911, 20538, implementations:114
10077 initialized_with_an_absence -> 23653, 23679, 23793, 36452
10137 dense_prefix_writes -> 9027, 23653, 23679, 23793, 24583, 87804, 87839, implementations:114
10253 pushed_element_type -> 23653, 23679, 23793, 24583, 29081, implementations:114
10392 settled -> 10392, 10429
10436 is_an_unsettled_array -> 10436
10457 declare_a_module_global -> 8812, 23653, 23671, 23718, 25254, 38217
10565 collect_static_fields -> 1053, 1125, 8740, 8812, 9027, 23653, 23671, 23679, 23793, 24583, 25289, 29081, 38217, 48942, 78476
10695 ambiguous_name -> 23334, 25465, 78472
10712 an_uninstantiated_generic -> 10811, 10845
10811 note_a_refused_function -> 12087, 14596, 32699
10845 uninstantiated -> 12339, 23334, 25465, implementations:114
11041 CallContext::suffix -> 11035
11058 member_symbols -> 11813
11077 planned_callee -> 23653, 23679, 23793, 78255, construction:308, construction:331, implementations:114
11145 structural_instantiations -> 11077, 11276, 11557, 11748, 11813, 23334, 23653, 23793, erased_calls:45, erased_calls:424, implementations:114
11234 planned_signature -> 23793, implementations:114
11254 has_a_union_without_representation -> 24594, 25391, 37059, implementations:114
11276 reached_beyond_its_calls -> 23653, 23679, 23793, 24653, 29253, implementations:114
11353 member_retypes -> 11397, 23793, 24594, 25391, 37059, implementations:114
11397 union_member_retype -> 20637, 24594, implementations:114
11435 copy_retype -> 24594, 57739, access_families:877, implementations:114, literal_methods:139, literal_methods:459
11542 StructuralPlanner::plan_members -> 11254, 11353
11557 StructuralPlanner::record_call -> 11234, 11435, 11542, 12339, 23793, 24594, 57440, 58657, erased_calls:137, implementations:49, implementations:114
11681 children_that_run -> 23679, 23793, 53053
11730 for_each_parts -> 23679, 23793
11748 calls_in_the_body_of -> 2844, 11767
11756 calls_in_a_default -> 11767
11767 calls_under -> 11681, 11767, 23793, 52001, 65407, iterator_calls:262, iterator_calls:420
11813 retyped_symbols_of -> 11839, 36067
11839 with_const_aliases -> 23653, 23679, 23764, 23793, 25060
11889 closure_variants -> 3051, 11813, 28544
11938 qualified_name -> 1150, 2971, 14296, 23334, 78488, implementations:114
12026 note_member -> 12087, 28083
12087 note_uncompiled -> 11938, 23334, 78472
12242 function_copies -> 11012, 12339
12344 members_of -> 23334, 23675, 23679, 23793, implementations:114
12392 lower_members_of -> 1150, 12501, 13078, implementations:114
12475 refusal_by_name -> 23334, 25465
12501 lower_object_literal_members -> 55, 12026, 12344, 12483, 12989, 14596, 25465, 28139, 28521, 29286, 55052, implementations:114, layout_collection:231, layout_collection:401
12676 register_objc_class -> 23334, 23653, 23679, 23793, 28014, implementations:114
12737 member_copy -> 21031
12777 constructor_targets -> 1125, 1150, 2815, 12844, 12850, 23679, 23793, implementations:114, made_instance:68, made_instance:77, made_instance:83, made_instance:93
12862 target_constructor_copies -> 55, 90, 12026, 12771, 14596, 28139, layout_collection:231, layout_collection:401
12919 constructor_copies -> 55, 90, 11058, 11813, 12026, 14596, 23334, 28139, layout_collection:231, layout_collection:401, made_instance:300
12989 raising_method -> 55, 90, 12737, 14596, 28083, 28139, implementations:114
13078 lower_class -> 55, 11012, 12026, 12344, 12676, 12737, 12862, 12919, 12989, 13335, 13677, 13840, 13906, 14096, 14126, 14145, 14189, 14245, 14296, 14303, 14596, 23793, 25521, 25784, 26377, 26649, 27196, 28139, implementations:114, layout_collection:231, layout_collection:401
13335 register_gobject_class -> 2253, 12087, 13514, 13610, 13639, 13662, 13978, 23334, 25465, implementations:114
13514 gobject_interfaces -> 1125
13549 program_superclass -> 23334, 23653, 23679, 23793, implementations:114
13578 static_field -> 14296, 23334, 23653, 23679, 23793, implementations:114
13610 static_value -> 13578, 23334, 23653, 23679, 23793, implementations:114
13639 gobject_template -> 2253, 13610, 13712, implementations:114
13662 known_handlers -> 13562
13677 template_reader -> 12087, 13578, 13639, 14596, 26285
13712 template_children -> 1125
13743 property_fields -> 1125, 20831
13831 fields_index -> 13743
13840 gobject_properties -> 2253, 12087, 13743, 14596, 23334, 25465, 27672, implementations:114, layout_collection:231, layout_collection:401
13906 objc_field_properties -> 2253, 12087, 14296, 14596, 23334, 23653, 23679, 23793, 27775, 27884, 29281, 76570, implementations:114, layout_collection:231, layout_collection:401
13978 gobject_signals -> 1125, 13992
13992 signals_of_type -> 20831
14096 with_vfunc_slot -> 14596, 25998, layout_collection:231, layout_collection:401
14126 keep_foreign_member -> 12087
14145 refuses_an_unregistered_handle -> 1125, 12087, 23334, 24594, 25465, implementations:114
14189 register_com_class -> 12087, 23334, 23653, 23679, 23793, 25465, 26440
14245 objc_state_function -> 2253, 12087, 14596, 27399, implementations:114, layout_collection:231, layout_collection:401
14274 is_static_member_symbol -> 14296
14335 class_copies -> 975, 21031, implementations:114
14419 class_closure_variants -> 3051, 28544
14523 Shared::whole_program -> 3296, 3348, 3396, 3509, 11145, 11889, 12777, 14335, 14419, 23334, closure_context:41, erased_calls:556, generic_values:19, implementations:114, overload_results:212
14596 Shared::builder -> 11051, 14656, 23465, implementations:49, overload_results:26
14685 dead_zone_reads -> 14780, 23334, 23653, 23675, 23679, 23793, 24653, 39079, implementations:114
14780 evaluated_reads -> 14780, 23653, 23793
14818 is_declaration_file -> 14830
14845 module_statements -> 4338, 4388, 4433, 4495, 14685, 14818, 15280, 20702, 23334, 23679, 23793, 25465, 53866, implementations:114, initialization:299
15010 module_roles -> 15094, 15103, 23334, implementations:114
15094 is_a_dynamic_import -> 23679, 23793
15103 dynamic_import_target -> 15217, 15224
15164 names_a_file_of_the_program -> 15198, 23653
15241 add_lazy_modules -> 15010, 23334, 23671, implementations:114
15280 evaluation_order -> 15280
15363 mark_refused_initializers -> 15386
15386 refused_initializers -> 14596, 48928, 54077
15447 lower_module_initializer -> 55, 14596, 14845, 15075, 15656, 32141, 32679, layout_collection:231, layout_collection:401
15553 lower_conversions -> 55, 14596, 74346, layout_collection:231, layout_collection:401
15594 lower_reject_error -> 55, 14596, 15622, 74294, implementations:114, layout_collection:231, layout_collection:401
15622 declared_promise_function -> 21044
15656 drop_the_unlowerable -> 14596, 23653, 23671, 23679, 23793, 31805, 31977, 38915, 53877, 67116
15809 initializer_function -> 23334, 23653, 23679, 23793, implementations:114
15900 module_namespace_of -> 15809, 16202, implementations:114
16002 shorthand_target -> 23653, 23793
16092 namespace_of -> 16002, 23334, 23653, 23679, 23793, implementations:114
16269 record_unpublished -> 16210
16296 opaque_signature -> 21044, 23334, 23679, 23793, implementations:114
16371 optional_scalars -> 21044, 23334, 23679, 23793, 36878, implementations:114
16477 public_api -> 15809, 15900, 16092, 16202, 16269, 16296, 16371, implementations:114
16755 publish_surface -> 16477, 16654, implementations:114
16811 lower -> 17286
16816 lower_wanted_closures -> 55, 4528, 4566, 4680, 14596, 15553, 15594, 17013, 17037, 18852, 18923, 33294, 33671, generic_values:322, implementations:114, json:198, layout_collection:231, layout_collection:401, uniform_inputs:89
17013 closure_aliases -> 11839, 23334
17037 raising_closure -> 55, 3154, 4534, 4685, 4697, 14596, 17013, 18852, 18923, 33294, 33671, generic_values:322, implementations:114, layout_collection:401
17204 hierarchy_and_naming -> 2488, 2642, 5582, 8655, 17241
17241 field_aliases -> 14656, 18481, 23347, 57885, implementations:114, layout_collection:401
17286 lower_with -> 55, 188, 344, 879, 975, 1593, 4566, 4771, 5135, 5759, 6710, 9313, 10695, 10712, 10758, 10811, 11058, 11813, 12087, 12242, 12392, 12475, 14523, 14596, 15363, 15447, 16755, 16816, 17204, 17698, 17719, 17787, 17972, 18051, 18096, 18594, 19377, 19822, 20021, 20113, 23334, 25391, 28571, 32699, 32729, 87849, access_family_functions:40, closure_context:76, function_names:283, implementations:37, implementations:114, initialization:534, layout_collection:94, layout_collection:98, layout_collection:231, layout_collection:401, literal_methods/adapters:23, member_origins:544, parameter_entries:560, printed:94, printed:425, project_semantics:8, typed_signatures:54
17698 finish_dispatch_tables -> 19448, implementations:114, member_origins:155, virtual_returns:61
17719 attribute_nested_to_their_refused_outer -> 14596, 32699, 87912, 87943, implementations:114
17861 signature_name -> 18575
17897 may_merge -> 17936
17936 nominal_name -> 17888, 17943
18096 collect_declared_facts -> 18124, 18317, 18362
18124 collect_native_headers -> 18245, 18276
18276 collect_native_modules -> 18276
18317 collect_class_identities -> 1150, 2388, 18395, 18441, 18481
18395 class_identity -> 1053
18441 named_class_source -> 18416
18594 declare_interface_methods -> 18746, 18785, access_families:946, interfaces:628, layout_collection:90, layout_collection:98, layout_collection:231, layout_collection:394, layout_collection:408
18785 record_unimplemented_interfaces -> 836
18852 closure_result_absent -> 18885
18885 absent_of_result -> 20624
18917 result_crosses -> 20382
18923 erased_call -> 18917, 19174, 19245, 20382, uniform_inputs:244
19377 declare_uniform_entries -> 19575, 19733
19575 declare_erased_entries -> 891, 19174, 19305, 19332, 21044
19733 declare_raising_entries -> 891
19822 relate_closures_to_signatures -> 891, 4528, 18575, 18746, 19987
19987 shared_generator_result -> 5759
20021 lay_out_held_signatures -> 18575, 20067, 20084, layout_collection:90, layout_collection:231
20067 signature_layout -> 17861
20084 objects_in -> 20084
20113 canonicalize_objects -> 20189
20370 readable_back -> 20382
20538 holds_only_absences -> 20624
20557 a_pattern_that_requires_coercion -> 20581, 23718, 23793
20581 in_javascript -> 23653, implementations:114
20596 a_parameter_pattern_can_throw -> 20557, 23679, 23793, elision_patterns:34
20637 admits_absence -> 20624
20648 table_key_within -> 20637, 21244
20674 short -> 20831
20751 spelling -> 20702
20810 chooses -> 20791
20831 describe -> 20674, 20768, 20831, 20975, 21130, 21136
20975 contains_a_cycle -> 20975
21031 instantiation_suffix -> 21008
21044 representation -> 21149
21057 iterator_result_element -> 21057, 21136
21108 may_be_a_finished_iterator_result -> 21057
21149 representation_with -> 21244
21181 inherited_typed_array -> 21136, type_bases:12
21244 representation_within -> 21968
21367 slot_for -> 20538, 21244, 21300
21394 tuple_representation -> 10429, 21244, 21300
21458 generator_element_type -> 21244
21498 provided_representation -> 5759, 20648, 21136, 21244, 21458
21798 decided_representation -> 21057, 21752
21848 union_representation -> 20624, 21244
21968 representation_of -> 21130, 21136, 21149, 21176, 21181, 21213, 21226, 21244, 21367, 21394, 21498, 21798, 21848
23334 FuncBuilder::probe -> 23347
23347 FuncBuilder::new -> implementations:33, layout_collection:341
23447 FuncBuilder::within -> 23347, closure_context:64, closure_context:68
23465 FuncBuilder::instantiating -> 23447
23482 FuncBuilder::merged_type -> 24594, 57885, implementations:114
23618 FuncBuilder::imported_from -> 23653, implementations:114
23653 FuncBuilder::node -> implementations:114
23657 FuncBuilder::declared_in_program_source -> 14830, implementations:114
23671 FuncBuilder::origin -> 23653
23675 FuncBuilder::location -> 23653
23679 FuncBuilder::children -> 23653
23718 FuncBuilder::syntactic_parent -> 23653
23737 FuncBuilder::binding_parents -> 23653, 23793
23764 FuncBuilder::subtree -> 23679, 23764
23772 FuncBuilder::names_a_member -> 23653, 23679, 23793
23793 FuncBuilder::kind_of -> 23653
23800 FuncBuilder::return_type_of -> 20831, 23793, 24206, 24385, 25465, implementations:114
23872 FuncBuilder::without_chain_absence -> 24175, implementations:114
23961 FuncBuilder::chain_links -> 23679, 23793
23994 FuncBuilder::pending_chain -> 23961
23999 FuncBuilder::lower_chain -> 23961, 24012
24012 FuncBuilder::chain_step -> 23679, 23793, 24012, 25465, 54077, 62369, 63250, 64049
24044 FuncBuilder::chain_for_effect -> 23592, 23598, 23961, 24066, 25465
24066 FuncBuilder::chain_effect_step -> 23592, 23598, 23602, 23610, 23671, 23679, 23793, 24066, 24608, 25465, 54077, 62369, 64049
24117 FuncBuilder::member_on_present -> 25465, 29081, 50038, 50042, 50188, 50300, 63018, 76422, 76554, 76714, implementations:114
24175 FuncBuilder::ends_an_optional_chain -> 23679, 23793, 24175
24206 FuncBuilder::mentions -> 23679, 23793, 24206
24220 FuncBuilder::returned_by -> 4293, 18575, 24594, closure_context:76, generic_values:318, implementations:114
24260 FuncBuilder::contextual_return -> 24301, 24594
24301 FuncBuilder::contextual_return_type -> 23679, 23718, 23793, implementations:114
24385 FuncBuilder::declared_return -> 23679, 23793, 24260, 24583, 24594, 29253, implementations:114
24453 FuncBuilder::materialize -> 57885
24512 FuncBuilder::is_function_typed -> implementations:114
24521 FuncBuilder::spelling_for -> 87759, implementations:114
24542 FuncBuilder::names_a_declared_function -> 23653, 23793, 24653, implementations:114
24583 FuncBuilder::type_of -> 24594, access_families:147, access_families:719, access_families:756, implementations:114
24594 FuncBuilder::represent -> 21244, implementations:114
24615 FuncBuilder::unrepresentable -> 24621, 25465
24621 FuncBuilder::describe_node -> 20831, implementations:114
24637 FuncBuilder::unrepresentable_member -> 20831, 25465, implementations:114
24653 FuncBuilder::denoted_symbol -> implementations:114
24681 FuncBuilder::names_a_namespace -> 23653, 24653, implementations:114
24704 FuncBuilder::declared_in_namespace_of -> 23653, 24653, 25254, implementations:114
24726 FuncBuilder::describe_name -> 1222, 1230, 1243, 23653, 24909, 24939, 25103, 25248, implementations:114
24909 FuncBuilder::library_global -> 1222, 1230, 1243, 24939, 25248
24939 FuncBuilder::provided_global_member -> 1222, 23653, 25088
24957 FuncBuilder::is_module_scope -> scopes:98
24973 FuncBuilder::per_iteration_loop -> 23737, 23793
25004 FuncBuilder::rebinding_refusal -> 24973, 25060, 25073
25060 FuncBuilder::declaration_kind -> 23653, 25254
25073 FuncBuilder::written_in_the_body_of -> 23679, 38915
25088 FuncBuilder::is_callee -> 23653, 23679, 23793
25185 FuncBuilder::member_access -> 23653, 23679, 23793, 29081
25235 FuncBuilder::member_access_key -> 23679, 23793, 29293, 29309
25248 FuncBuilder::member_read_from -> 23653, 25185
25254 FuncBuilder::ancestor -> 23653, 23793
25266 FuncBuilder::is_nested_closure -> 25285
25285 FuncBuilder::is_within_a_function -> scopes:104
25289 FuncBuilder::constant_value -> 21769, 23653, 23679, 23793, 25289, 38230, implementations:114
25391 FuncBuilder::has_a_body -> 23679, 23793
25402 FuncBuilder::defines -> 25391, 36878
25416 FuncBuilder::emitted_callee_name -> 23653, 25465, 36878, 78472
25465 FuncBuilder::unsupported -> 23675
25479 FuncBuilder::unprovided -> 23675
25503 FuncBuilder::refuse_nameless -> 23675, 25465, 25479
25521 FuncBuilder::is_an_overload_signature -> 12344, 23653, 25391, 29286
25576 FuncBuilder::method_body -> 23679, 23793, 25465
25643 FuncBuilder::static_accessor_read -> 23653, 23671, 23793, 24583, 24608, 24615, 25694, 29293, 78528, implementations:114
25694 FuncBuilder::qualified_class_name -> 23653, 23793, implementations:114
25705 FuncBuilder::class_name_for -> 25465, 57885, 78488
25753 FuncBuilder::method_return_type -> 23793, 23800, 24453
25784 FuncBuilder::lower_gobject_member -> 1125, 13439, 13514, 13639, 13662, 23793, 25465, 25893, 25909, 26204, 26219, 26239, 26323, 27120, 28139, 29281, 36838, 88957, implementations:114, native_memory:1495
25893 FuncBuilder::vfunc_outs -> 23653
25909 FuncBuilder::vfunc_entry -> 25465, 25966, 76937, implementations:114
25966 FuncBuilder::vfunc_answer -> 25465, implementations:114
25998 FuncBuilder::lower_vfunc_slot -> 23592, 23598, 23610, 23671, 24608, 25465, 26145, 29693, 35989
26145 FuncBuilder::tuple_element -> 23671, 24608, 25465, 57885
26204 FuncBuilder::lower_template_callback -> 26219, 26239
26219 FuncBuilder::lower_template_callback_with -> 28139
26239 FuncBuilder::template_callback_entry -> 1125, 25465, implementations:114
26285 FuncBuilder::lower_template_reader -> 23610, 23653, 23671, 23679, 23793, 24608, 25465, 35989
26323 FuncBuilder::overridden_vfunc -> 29281, implementations:114
26377 FuncBuilder::lower_com_member -> 23793, 25465, 26504, 27024, 28139, 29281, implementations:114
26440 FuncBuilder::forwarded -> 23653, 23679, implementations:114
26504 FuncBuilder::overridden_slot -> 23653, 23679, 29281, implementations:114
26530 FuncBuilder::program_method_selector -> 12670, 23653, 28034, 28066
26552 FuncBuilder::lower_selector -> 12670, 23653, 23671, 23679, 23793, 24583, 24608, 24615, 25465, 26530, 26733, 29081, 29281, implementations:114
26649 FuncBuilder::lower_objc_method -> 1125, 4108, 23679, 23793, 25465, 26530, 26733, 28139, 29281, 76570, 76937, 89894, implementations:114
26733 FuncBuilder::objc_requires -> 23653, 28034, 28066
26746 FuncBuilder::gobject_super_call -> 23653, 26769, implementations:114
26769 FuncBuilder::lower_gobject_chain_up -> 2253, 23653, 23793, 25465, 25893, 25966, 26863, 70001, 75066, 75703, 76937, implementations:114
26863 FuncBuilder::chain_up_answering_a_tuple -> 23671, 24608, 25465, 26929, 70015, implementations:114, native_memory:126
26929 FuncBuilder::make_tuple -> 23671, 24594, 24608, 24615, 25465, 29693, 52468, 57885
27010 FuncBuilder::opens_with_super -> 23679, 23793
27024 FuncBuilder::lower_com_constructor -> 1125, 2253, 23602, 23610, 23671, 23679, 23793, 24594, 25465, 25576, 27010, 35989, 37556, 37940, 38741, implementations:114
27086 FuncBuilder::com_super -> 23671, 24594, 25465, 27110, 27373
27110 FuncBuilder::compose_named -> 24608, 80262
27120 FuncBuilder::lower_gobject_constructor -> 1125, 2253, 23602, 23610, 23671, 23679, 23793, 24594, 25465, 25576, 27010, 35989, 37556, 37940, 38741, implementations:114
27182 FuncBuilder::gobject_super -> 27373, 49611
27196 FuncBuilder::lower_objc_constructor -> 1125, 23602, 23610, 23671, 23679, 23793, 24594, 25465, 25576, 27010, 35989, 37542, 37556, 37940, 38741, 85039, implementations:114
27268 FuncBuilder::lower_objc_super_init -> 23653, 23671, 25465, 27373, 37298, 62060, 70015, 75066, 75733, 76955, 80262, implementations:114
27373 FuncBuilder::this_instance_type -> 1125, 23653, 23793, 25465, implementations:114
27399 FuncBuilder::lower_objc_state -> 23610, 23671, 24608, 27390, 27431, 27502, 35989, 58827
27431 FuncBuilder::refuse_reaching_initializers -> 14296, 23679, 23793, 25465, 48942, 58657, gobject:57, implementations:114
27480 FuncBuilder::is_program_objc_field -> 4120, 27493
27493 FuncBuilder::chain_stores -> 2244, 27390, implementations:114
27502 FuncBuilder::objc_state_layout -> 891, 25465, 27390, 27502, 57064, implementations:114, layout_collection:349, layout_collection:372
27584 FuncBuilder::program_objc_instance_place -> 4120, 27617, 27976
27617 FuncBuilder::state_place -> 23671, 27502, 27642, 80262
27642 FuncBuilder::property_notify_thunk -> 2253, 13743, 23793, 27390, implementations:114
27672 FuncBuilder::lower_gobject_property_accessor -> 1125, 13831, 23610, 23671, 24594, 24608, 25465, 27502, 35989, 52648, 80262, implementations:114
27775 FuncBuilder::lower_objc_field_accessor -> 1125, 23610, 23671, 24608, 24615, 25465, 27502, 35989, 52648, 76937, 80262, 89894, implementations:114
27884 FuncBuilder::property_requirement -> 23679, 23793, 28014, 29281, 77774, implementations:114
27909 FuncBuilder::template_child -> 2253, 13549, 13639, 13712, 23671, 23679, 23793, 24608, 57413, 89964, implementations:114
27976 FuncBuilder::state_by_type -> 23679, 27988, implementations:114
27988 FuncBuilder::state_of_type -> 2253, 23793, 57413, implementations:114
28014 FuncBuilder::objc_protocols -> 77774, implementations:114
28024 FuncBuilder::native_bases -> implementations:114
28034 FuncBuilder::overridden_selector -> 14296, 23653, 23679, 23793, 28024, 29281, implementations:114
28066 FuncBuilder::protocol_selector -> 23653, 23679, 23793, 28014, 29281
28083 FuncBuilder::emitted_member_name -> 2971, 14296, 23793, 25465, 25705, implementations:114, parameter_entries:46, parameter_entries:93
28139 FuncBuilder::lower_method_of -> 1125, 14296, 23602, 23610, 23653, 23671, 23679, 23793, 24453, 24594, 24608, 25465, 25576, 25705, 25753, 28083, 28396, 28512, 32879, 32920, 33042, 35989, 37298, 37414, 37425, 37556, 38308, 38382, 38392, 38741, 84912, 85039, implementations:114, made_instance:250, made_instance:284, parameter_entries:235
28384 FuncBuilder::lower_this -> 25465, 28396, 28512
28396 FuncBuilder::this_is_never_bound -> 3642, 23653, 23793, 28446
28446 FuncBuilder::never_binds_this -> 2815, 23653, 23679, 23764, 23793, 28492
28492 FuncBuilder::extends_null -> 23679, 23793
28512 FuncBuilder::throw_unbound_this -> 23671, 24608, 69309
28521 FuncBuilder::literal_member_is_storage -> 736, implementations:114
28544 FuncBuilder::is_within -> 23653
28556 FuncBuilder::is_a_literal_method -> 23653, 23718, 23793
28571 FuncBuilder::declaration_reads_this -> 23793, 28580
28580 FuncBuilder::binds_this -> 23653, 28637
28620 FuncBuilder::first_this -> 3642, 23653, 23793, 28620
28637 FuncBuilder::mentions_this -> 3642, 23653, 23793, 28637
28656 FuncBuilder::declares_nothing -> implementations:114
28667 FuncBuilder::narrowed_collection_view -> 24583, 28685, 28706, 63271
28685 FuncBuilder::collection_view -> 23671, 24608, 28706
28722 FuncBuilder::narrowed -> 20370, 21130, 23671, 23793, 24453, 24583, 24608, 25465, 28656, 28667, 28980, 74558, 80262, 86298, access_families:180, implementations:114
28980 FuncBuilder::refuse_a_foreign_layout -> 20831, 23592, 23598, 23610, 23679, 23793, 24608, 30654, 57885, 80262, implementations:114
29081 FuncBuilder::literal_name -> 23653, 23679, 23793, 29081, 29162, 29233, implementations:114
29162 FuncBuilder::numeric_member_name -> 23653, 29215
29215 FuncBuilder::constant_number -> implementations:114
29233 FuncBuilder::constant_member_name -> implementations:114
29253 FuncBuilder::name_node -> 23679, 23793
29281 FuncBuilder::member_name -> 29081, 29253
29286 FuncBuilder::member_key -> 23793, 29253, 29293
29293 FuncBuilder::property_key -> 23653, 23679, 23793, 29081, 29309
29309 FuncBuilder::expression_key -> 29233, implementations:114
29321 FuncBuilder::access_key -> 23679, 23793, 29293, 29309
29340 FuncBuilder::required_access_key -> 25465, 29321
29349 FuncBuilder::symbol_property_key -> implementations:114
29360 FuncBuilder::well_known_property_key -> 29349, implementations:114
29368 FuncBuilder::declared_instance_type -> 24583
29386 FuncBuilder::names_a_module_without_effects -> 23793, 29394, 29403
29394 FuncBuilder::holds_a_namespace -> 15224, implementations:114
29403 FuncBuilder::denotes_a_module -> 23653, 23793, 24653, implementations:114
29443 FuncBuilder::called_member_name -> 23653, 29081, 29477
29477 FuncBuilder::indexed_member_name -> 23793, implementations:114
29495 FuncBuilder::names_one_member -> implementations:114
29515 FuncBuilder::holds_an_array -> 23653, 23793
29534 FuncBuilder::stands_for_its_own_class -> implementations:114
29565 FuncBuilder::names_a_property -> 23679, 23793, 24583, 29081, 29386, 29495, 29515, 29534, 87281, native_memory:65
29638 FuncBuilder::every_arm_descends_from -> 23679, 23793, 48245, implementations:114
29693 FuncBuilder::coerce -> 29713
29713 FuncBuilder::coerce_from -> 30120
29733 FuncBuilder::coerce_to_native_pointer -> 23671, 23793, 24608, 25465, 35588, 74558, 75266, 80262, native_memory:1192
29826 FuncBuilder::crossing_storage -> 48222, implementations:114
29911 FuncBuilder::result_without_an_erased_form -> 18917, 30026
29938 FuncBuilder::result_of_another_kind -> 9822, 9862, 30026
29982 FuncBuilder::result_of_another_layout -> 30026, 30654, 48152, 88752, access_families:922
30026 FuncBuilder::closure_results -> 4293, 18575, 24594, closure_context:76, implementations:114
30057 FuncBuilder::record_arrival -> 17888, 18575, 23671, 24594, implementations:114, layout_collection:349
30120 FuncBuilder::coerce_arm -> 917, 9813, 20382, 23671, 24608, 25465, 28685, 28706, 29638, 29733, 29826, 29911, 29938, 29982, 30057, 30392, 30406, 30525, 57580, 57625, literal_methods:459
30392 FuncBuilder::erased_slots_at -> 81462, 87281
30406 FuncBuilder::absence_at_excluding -> 30441, implementations:114
30441 FuncBuilder::absence_of_type -> 20624, implementations:114
30501 FuncBuilder::laid_out_as_a_prefix -> 30654
30525 FuncBuilder::native_field_view -> 25465, 30567, 30597, 30654, 48152, 88752, access_families:922
30567 FuncBuilder::carried_owners_fit -> 25465, 30654, 48152, 88752, access_families:877, access_families:922, access_families:934
30597 FuncBuilder::unrelated_class_keeps_its_methods -> 774, 18481, 25465, 30649, 48152, 57413, implementations:114
30649 FuncBuilder::extends -> 804
30654 FuncBuilder::not_a_prefix -> 30763, 44478, 57739, 57885
30763 FuncBuilder::one_slot -> 18481, 21008, 88674, implementations:114, layout_collection:349
30846 FuncBuilder::coerce_to_parameter -> 29693, 30909, 30915, 30927, 79399
30909 FuncBuilder::lends_handles -> 37127, implementations:114
30915 FuncBuilder::fills_records -> 37127, implementations:114
30927 FuncBuilder::parameter_representation -> 11035, 23653, 23793, 24594, 25402, 30885, 37127, 37131, 37153, 70996, elision_patterns:47, implementations:114, parameter_entries:146
31049 FuncBuilder::lower_delete -> 23671, 23679, 23793, 24583, 24608, 25465, 31149, 50314, 51126, 52359, 52508, property_keys:64, property_keys:333
31149 FuncBuilder::the_absence_has_a_slot -> 25465, 48152, 52546, 52570
31209 FuncBuilder::typeof_from_the_checkers_type -> 23653, 24521, 35427, 35781, 35959, 87281, implementations:114
31303 FuncBuilder::through_parentheses -> 23679, 23793
31321 FuncBuilder::through_assertions -> 23679, 23793
31351 FuncBuilder::operand_has_no_effects -> 23793, 31303, initialization:262
31398 FuncBuilder::literal_method_typeof -> 23671, 24608, 25235, 31303, 54077, implementations:114, literal_methods:367
31428 FuncBuilder::constant_name -> 54077, 85181, 85203
31447 FuncBuilder::asks_what_is_provided -> 23679, 23793, 31303, 31503
31489 FuncBuilder::intrinsic_typeof -> 23671, 23679, 24608, 31503
31503 FuncBuilder::intrinsic_named_by -> 23653, 23793, 31303, 31522, implementations:114
31522 FuncBuilder::intrinsic_declared_by -> 23653, 25391, 36878, 78472
31537 FuncBuilder::lower_typeof -> 23671, 23679, 24521, 24608, 25465, 31209, 31351, 31398, 54077, 63250, 63997, 64049, 80262, claimed_reads:199, initialization:73
31680 FuncBuilder::check_initialized -> 23671, 24608, 31714, initialization:63, initialization:183, initialization:258, initialization:278
31714 FuncBuilder::check_binding_ready -> 23671, 24608, 69309, implementations:114
31745 FuncBuilder::check_initialized_place -> 31680, initialization:258
31756 FuncBuilder::check_class_binding -> 23653, 23679, 23793, 24653, 31321, 31680, implementations:114
31787 FuncBuilder::mark_initialized -> 23602, 23671, 24608
31805 FuncBuilder::lower_module_binding -> 4515, 10499, 23653, 23679, 23793, 25254, 25465, 29693, 31787, 32079, 48928, 52648, 54077, 65759, implementations:114, initialization:262
31933 FuncBuilder::static_named_prototype -> 6275, 23653, 23679, 23793, 29281
31955 FuncBuilder::member_named_at_run_time -> 6275, 23679, 23793, 29253, 29495
31977 FuncBuilder::lower_static_fields -> 23602, 23653, 23679, 23793, 25465, 29693, 31933, 31955, 48928, 48942, 52648, 53877, 55852
32079 FuncBuilder::lower_destructured_module_binding -> 10499, 23679, 23793, 54077, 66842
32105 FuncBuilder::lower_module_statement -> 23653, 23679, 23793, 31787, 31805, 31977, 53877
32141 FuncBuilder::lower_module_evaluate -> 15075, 23592, 23598, 23602, 23610, 23671, 24608, 25465, 32105, 32648, 35989, 48720, 64551, implementations:114
32330 FuncBuilder::lower_dynamic_import -> 3256, 4142, 15103, 23671, 23793, 24453, 24608, 25465, 32413, 32442, 32469, 35968, 52468, 58657, 80262, closure_context:76, implementations:114, layout_collection:372
32413 FuncBuilder::import_of_nothing -> 15164, 25465, 29081, 32442, implementations:114
32442 FuncBuilder::rejected_import -> 23671, 24453, 24583, 24608, 24615, 55895, 60540, 80262
32469 FuncBuilder::import_options -> 15126, 23679, 23793, 25465, 29081, 31303, 32535, implementations:114
32535 FuncBuilder::lower_for_its_effects -> 48928
32543 FuncBuilder::lower_module_job -> 3256, 4142, 4528, 15075, 23592, 23598, 23610, 23671, 24453, 24608, 25465, 35968, 35989, 43565, 80262, implementations:114, layout_collection:372
32632 FuncBuilder::namespace_layout -> layout_collection:372
32648 FuncBuilder::fail_module_evaluation -> 23610, 24608
32679 FuncBuilder::lower_module_init -> 23610, 23671, 32105, 35989
32699 FuncBuilder::emitted_function_name -> 23653, 23679, 23793
32729 FuncBuilder::lower_function -> 4655, 23602, 23610, 23653, 23671, 23679, 23793, 23800, 24453, 24608, 25465, 28571, 32699, 32920, 33042, 33529, 35989, 37940, 38308, 38382, 38392, 38741, 39762, 43482, parameter_entries:46, parameter_entries:93, parameter_entries:235
32879 FuncBuilder::end_method_body -> 23602, 39762, 43482
32920 FuncBuilder::begin_generator -> 23653, 24594, 24615, 25465, 44508, 57885, implementations:114
33042 FuncBuilder::begin_async -> 23653, 23671, 24615, 38382, 80262
33094 FuncBuilder::closure_parameters -> 23679, 23793, 33629, 37944
33157 FuncBuilder::promise_before_inputs -> 23653, 33042, 33203
33203 FuncBuilder::reserved_return_type -> 23800, 24453, 32920
33217 FuncBuilder::closure_inputs -> 3144, 3149, 33094, 33203, 33529, 35245, 35327, 35968, 36878, 38308, layout_collection:372, parameter_entries:46, parameter_entries:93
33294 FuncBuilder::lower_closure -> 3144, 4142, 4645, 23602, 23610, 23671, 23679, 23793, 23800, 24453, 24608, 25465, 33042, 33157, 33203, 33217, 33529, 34957, 35989, 38308, 38382, 38392, 38741, 39762, 43482, 48928, 54077, 58120, parameter_entries:235
33529 FuncBuilder::receive_this -> 20831, 23592, 23598, 23610, 23653, 23671, 24594, 24608, 25465, 28620, 57372, 57885, 80262, implementations:114
33636 FuncBuilder::why_the_closure_cannot_be_captured -> 23679, 23793, 25060, implementations:114
33671 FuncBuilder::lower_made_closure -> 32543, 33694, 33850, 34366, 34577
33694 FuncBuilder::lower_thenable_job -> 3222, 3236, 3669, 4142, 4528, 23610, 23671, 23800, 24453, 24583, 24608, 24615, 25465, 29693, 33802, 33828, 34856, 35968, 35989, 78472, 80262, 84548, layout_collection:372
33802 FuncBuilder::thenable_type -> 3669, 24583, 25465, closure_context:76
33828 FuncBuilder::resolving_function -> 3267, 4142, 24608, 35968, 52468, layout_collection:372
33850 FuncBuilder::lower_resolving_function -> 3222, 3267, 4142, 4528, 18575, 23592, 23598, 23610, 23671, 24453, 24594, 24608, 24615, 25465, 35968, 35989, 43356, 43503, 46024, 60540, 80262, implementations:114, layout_collection:372
34014 FuncBuilder::reaction_shape -> 18575, 23679, 24583, 24594, 24615, 25185, 25465, 43356, 58657, implementations:114
34136 FuncBuilder::promise_reaction -> 34154, closure_context:76
34154 FuncBuilder::subscribe_a_reaction -> 3451, 3481, 4142, 23671, 24453, 24608, 25465, 29693, 34014, 35968, 52468, 54077, 80262, closure_context:76, layout_collection:372
34221 FuncBuilder::bound_shape -> 23679, 24583, 24594, 24615, 25185, 25465, 34298, 58657, implementations:114
34298 FuncBuilder::bound_parameters -> 23671, 24594, 24615, 34331
34331 FuncBuilder::bound_parameter_types -> 25465, implementations:114
34366 FuncBuilder::lower_bound_function -> 4142, 4528, 4558, 23610, 23671, 23679, 24453, 24608, 25465, 34221, 35968, 35989, 58657, 78777, 79251, 87281, layout_collection:372, uniform_inputs:177
34446 FuncBuilder::bound_extras_are_ignored -> 3669, 4293, 6205, 23679, 23793, 36438, 36878, 37902, closure_context:76
34515 FuncBuilder::lower_bind -> 4142, 23671, 24608, 25465, 29693, 32535, 34221, 34446, 35968, 48928, 52468, 78750, closure_context:76, layout_collection:372
34577 FuncBuilder::lower_reaction -> 3481, 4142, 4528, 23592, 23598, 23610, 23671, 24453, 24608, 25465, 34014, 34740, 34768, 35968, 35989, 43503, 80262, layout_collection:372
34740 FuncBuilder::read_fulfilment -> 24608, 80262
34768 FuncBuilder::call_a_reaction_handler -> 3473, 23598, 23610, 23671, 24608, 25465, 48720, 60540, 78103, 79251
34856 FuncBuilder::method_signature -> 18575, 24594, 24615, implementations:114
34879 FuncBuilder::closure_bound_to -> 4142, 4793, 23679, 23793, 25060, closure_context:76, implementations:114
34957 FuncBuilder::lower_wrapper_body -> 4645, 4669, 23610, 23671, 24608, 25465, 35057, 35118, 35989, 78103
35057 FuncBuilder::wrapper_callee_that_raises -> 4669, 25465, 36878, implementations:114
35118 FuncBuilder::wrapped_call -> 2971, 3149, 4655, 25465, 31522, 35176, 36878, 78453, 78472, 84574
35176 FuncBuilder::method_receiver -> 23592, 23598, 23610, 23671, 24608, 33529, 80262
35245 FuncBuilder::bind_receiver -> 1125, 24608, 25465, 78476, implementations:114
35286 FuncBuilder::captured_as -> 24583, 24615, 34879, 35402
35327 FuncBuilder::bind_captures -> 4129, 24608, 24615, 25465, 33636, 35286, 35427, 35688, layout_collection:372
35402 FuncBuilder::settler_promise_type -> 23653, 23793, 24583
35435 FuncBuilder::box_handle -> 23671, 25465, 35457
35457 FuncBuilder::boxed -> 24608, 35479, 52468
35479 FuncBuilder::handle_box_layout -> 891, layout_collection:349, layout_collection:372
35505 FuncBuilder::declared_result_type -> 23679, implementations:114
35528 FuncBuilder::boxed_record_layout -> 891, layout_collection:349, layout_collection:372
35566 FuncBuilder::unboxed_argument -> 35588
35588 FuncBuilder::unbox_record -> 23580, 23592, 23598, 23610, 24608, 35528
35639 FuncBuilder::box_record -> 23671, 35528, 49672, 80262
35661 FuncBuilder::new_boxed_record -> 23671, 24608, 25465, 35528, 49672, 80262
35688 FuncBuilder::cell_layout -> 891, 4129, 4138, 35733, 38276, initialization:282
35733 FuncBuilder::is_guarded -> initialization:274
35740 FuncBuilder::open_cell -> 4129, 23671, 24608, 35427, 35688, 35733, 35781, 52468, layout_collection:372
35781 FuncBuilder::opened_cell -> 4129
35792 FuncBuilder::constructed_from_a_value -> 23653, 25465
35854 FuncBuilder::open_cell_early -> 4129, 23671, 24583, 34879, 35427, 35688, layout_collection:372
35887 FuncBuilder::open_class_cell -> 4129, 23671, 25465, 35427, 35688, layout_collection:372
35908 FuncBuilder::read_cell -> 23653, 23671, 24583, 24608, 35427, 35733, 35959, initialization:35, initialization:119, initialization:266, initialization:270
35959 FuncBuilder::program_layout_field -> 4129, layout_collection:349
35968 FuncBuilder::closure_layout -> 891, 4142, 4528, 4680
36056 FuncBuilder::default_of -> implementations:114
36067 FuncBuilder::parameter_symbols -> 23653, 23679, 23793
36094 FuncBuilder::lower_arguments -> 36142
36114 FuncBuilder::lower_arguments_on -> 36142
36127 FuncBuilder::lower_native_arguments -> 36142
36142 FuncBuilder::lower_arguments_gathering -> 36157
36157 FuncBuilder::lower_argument_values -> 23671, 23679, 23793, 24594, 24608, 24615, 29693, 30846, 30909, 30915, 30927, 32535, 36341, 36353, 36487, 36590, 36807, 36983, 37088, 37095, 37131, 37165, 48928, 54077, 78815, 79059, 87281, implementations:114
36341 FuncBuilder::undefined_argument -> 23679, 23793, 36452
36353 FuncBuilder::unless_undefined -> 20624, 25465, 36341, 36452, 36456, 36487, 37131, 63311, 64049, 67168, 78808, implementations:114, parameter_entries:146
36438 FuncBuilder::builtin_binding_at -> 23653, 23793, implementations:114
36452 FuncBuilder::is_the_undefined_literal -> 36438
36456 FuncBuilder::admits_undefined -> implementations:114
36487 FuncBuilder::lower_parameter_default -> 23671, 24608, 30846, 30927, 36067, 48928, 54077, 56190, 56261, 78808, 87281, parameter_entries:146, parameter_entries:152
36590 FuncBuilder::gather_rest -> 23671, 23793, 24594, 24608, 25465, 29693, 36706, 37127, 37644, 48928
36706 FuncBuilder::gather_rest_with_spreads -> 23679, 25465, 36747
36747 FuncBuilder::concat_onto -> 23671, 24608, 25465, 54077, 89841, 89862
36807 FuncBuilder::absent_argument -> 23671, 24608, 25465, 30927, 36861
36838 FuncBuilder::parameter_tags -> 23653, 25465
36861 FuncBuilder::omitted_by_default -> 24608
36878 FuncBuilder::implementation_of -> implementations:49
36913 FuncBuilder::overriding_signature -> implementations:114
36944 FuncBuilder::effective_parameters -> 36983, 37016
36983 FuncBuilder::fixed_arity_positions -> 37002
37002 FuncBuilder::tuple_shape -> 37625, implementations:114
37016 FuncBuilder::declared_parameters -> 36878, 36913, 37059, implementations:114
37059 FuncBuilder::parameters_declared_by -> 23679, 23793, 36056, implementations:114
37081 FuncBuilder::argument_callee -> implementations:114
37088 FuncBuilder::parameter_shapes -> 36944
37095 FuncBuilder::fixed_arity -> 36913, 37016, 37088, implementations:114
37127 FuncBuilder::parameter_type_id -> 36944
37131 FuncBuilder::declared_default -> 36056, 37153
37153 FuncBuilder::declared_parameter -> 23679, 23793, 36878, 37081
37165 FuncBuilder::omitted_after -> 23679, 23793, 30927, 36878, 37081, 37088, 37131, implementations:114
37260 FuncBuilder::symbol_declared_by -> implementations:114
37298 FuncBuilder::store_parameter_properties -> 23653, 23671, 25465, 29081, 29253, 29693, 37260, 37366, 52468, 56676, 57885
37366 FuncBuilder::store_objc_parameter_property -> 23653, 23671, 25465, 27584, 29253, 29693, 37260, 52468, 57885
37414 FuncBuilder::lower_param_or_labels -> 29253, 37464, 37940
37425 FuncBuilder::finish_params -> 24608, 35740, 37508, 80262
37464 FuncBuilder::lower_label_params -> 23671, 24594, 24608, 24615, implementations:114
37508 FuncBuilder::make_pending_labels -> 23653, 23671, 24453, 24583, 24608, 24615, 25465, 29693, 35740, 52468, 56676, 57885
37542 FuncBuilder::declares_instance_fields -> 14296, 23679, 23793, 37556, implementations:114
37556 FuncBuilder::declares_a_field -> 23653
37575 FuncBuilder::rest_element_of_a_tuple_union -> 37625, 37652, implementations:114
37625 FuncBuilder::after_substitution -> 24594
37644 FuncBuilder::tuple_union_as_array -> 37625, 37652
37652 FuncBuilder::element_of_a_tuple_union -> 24594, implementations:114
37721 FuncBuilder::lower_positional_rest -> 21300, 23653, 23671, 24453, 24583, 24594, 24608, 24615, 29693, 35740, 37848
37848 FuncBuilder::gather_a_rest_into_a_struct -> 23653, 23671, 24453, 24608, 25465, 29693, 35740, 52468, 79120
37902 FuncBuilder::annotates_this -> 23653, 23793
37940 FuncBuilder::lower_param -> 37944
37944 FuncBuilder::lower_param_binding -> 21300, 23653, 23671, 23679, 23793, 24453, 24583, 24608, 24615, 25465, 30392, 30406, 35740, 36056, 36983, 37575, 37721, 37902, 38217, 38443, 66842, 88161, elision_patterns:47, implementations:114, parameter_entries:117, parameter_entries:207
38210 FuncBuilder::annotated -> implementations:114
38217 FuncBuilder::written_kind -> 23718, implementations:114
38230 FuncBuilder::written_scalar -> implementations:114
38237 FuncBuilder::lower_assertion -> 23679, 23793, 24583, 25465, 38289, 48928, 54077, assertions:156, implementations:114
38261 FuncBuilder::oblige_local -> 38276, 38289, implementations:114
38276 FuncBuilder::written_kind_of_symbol -> 23653, 23679, 38217, implementations:114
38289 FuncBuilder::oblige -> 23675
38308 FuncBuilder::written_tuple_return -> 35505, 38210, 38230, implementations:114
38341 FuncBuilder::oblige_tuple_return -> 26145, 38289
38360 FuncBuilder::oblige_returned_element -> 38289
38382 FuncBuilder::written_return -> 35505, implementations:114
38392 FuncBuilder::result_absent -> 20624, 23653, 35505, implementations:114
38443 FuncBuilder::lent_hstring_param -> 23653, 23671, 24608
38478 FuncBuilder::lower_return -> 23602, 23610, 23671, 23679, 23793, 24583, 24608, 25465, 28396, 28512, 29693, 31303, 38289, 38341, 43482, 43690, 48685, 48928, 54077, 85557
38741 FuncBuilder::lower_block -> 23602, 23679, 23793, 53877, 58164, 58221
38816 FuncBuilder::carried_locals -> 25465, 38800
38857 FuncBuilder::stands_on_the_target_side -> 23653, 23679, 23793, 87804, 87839
38915 FuncBuilder::assigned_symbols -> 23653, 38915, 38966, 39011
38966 FuncBuilder::written_target -> 23653, 23679, 23793, 87804, 87839
39011 FuncBuilder::target_names -> 23653, 23679, 23793, 39011, implementations:114
39079 FuncBuilder::declared_symbols -> 23653, 23679, 23793, 39079, 67116
39110 FuncBuilder::lower_while -> 23671, 23679, 25465, 38915, 39079, 39496, 39602, 39691, 53877
39143 FuncBuilder::lower_switch -> 23580, 23592, 23598, 23602, 23610, 23671, 23679, 23793, 25465, 38816, 38915, 39079, 39280, 39389, 39673, 39865, 53877, 54077
39280 FuncBuilder::lower_case_chain -> 23592, 23598, 23610, 23679, 23793, 24608, 25465, 39673, 39865, 54077
39389 FuncBuilder::covers_every_case -> 23679, implementations:114
39432 FuncBuilder::lower_do_while -> 23598, 23602, 23610, 23671, 23679, 25465, 38915, 39079, 39496, 39602, 39673, 39865, 53877, 54077, 64276
39496 FuncBuilder::begin_loop -> 23580, 23592, 23598, 23610, 25465, 38816
39602 FuncBuilder::enter_loop -> 23598, 23610, 39642, 39673, 39865, 53577, 53624, 53654, 54077, 64276
39642 FuncBuilder::test_loop -> 23610, 39673, 39865
39673 FuncBuilder::exit_of -> 23580, 23592
39691 FuncBuilder::end_loop -> 23598, 23602, 23610, 24608, 39865, 45282, 54077
39762 FuncBuilder::close_body -> 23602, 23610, 39819, 85557
39819 FuncBuilder::falls_off_to_undefined -> implementations:114
39870 FuncBuilder::lower_break -> 23602, 23610, 39673, 39865, 43716, 48685
39888 FuncBuilder::lower_continue -> 23602, 23610, 39865, 43716, 48685
39909 FuncBuilder::lower_yield -> 23671, 23679, 23793, 24608, 25465, 29693, 39972, 40054, 54077
39972 FuncBuilder::lower_yield_star -> 23598, 23671, 24608, 29693, 39496, 39642, 39691, 40820, 43809, 43904, 43952, 44075, 44810, 44907, 54077
40054 FuncBuilder::is_a_statement -> 23793, implementations:114
40063 FuncBuilder::lower_await -> 23671, 23679, 24583, 24608, 25465, 43084, 43356, 43382, 45972, 54077
40142 FuncBuilder::lower_decided_static -> 23653, 23679, 23793, 40278, 40417, 40864, 41760, 41968, 42043, 42138, 42191, 42302, 42376, 42436, 44747, 44765
40278 FuncBuilder::lower_array_from_mapped -> 25465, 40340, 44810, 44907, 54077, 79459, 83978
40340 FuncBuilder::map_a_walk -> 23598, 23671, 24583, 24608, 24615, 25465, 39496, 39642, 39691, 40820, 43809, 43904, 43952, 44075, 83492, 83647, iterator_close:329
40417 FuncBuilder::lower_array_from -> 40696
40421 FuncBuilder::collection_append -> 25465, 89841
40449 FuncBuilder::append_collection_value -> 24608, 80262
40477 FuncBuilder::collection_bound -> 23592, 23598, 23610, 24608, 39673, 39865
40514 FuncBuilder::collect_a_walk -> 23598, 23671, 24608, 25465, 39496, 39642, 39691, 40421, 40449, 40477, 40658, 40764, 40796, 43809, 43904, 43952, 44075, 48936
40658 FuncBuilder::fill_from_table -> 24608, 44791, 88524
40696 FuncBuilder::build_array_from -> 23671, 24583, 24615, 40514, 40743, 44810, 54077, 61311
40743 FuncBuilder::collection_walk -> 44862, 44907
40764 FuncBuilder::store_and_advance -> 24608
40796 FuncBuilder::collected_element -> 25465, 29693, 40820, 41036, 45356, 88511
40820 FuncBuilder::walk_element -> 24608, 45356
40864 FuncBuilder::decide_object_columns -> 4260, 23671, 24583, 24594, 24608, 24615, 25465, 29693, 41018, 41106, 41299, 54077, 56025, 56086, 56303
41018 FuncBuilder::object_entry -> 23671, 24608, 41036
41036 FuncBuilder::pair_of -> 23671, 24608, 25465, 29693, 52468, 57885
41106 FuncBuilder::own_layout -> 23653, 24512, 24594, 24615, 25465, 41518, 57413, 57885, access_families:401, access_families:877, access_families:889, implementations:114
41200 FuncBuilder::own_names -> 4260, 41106, 41213, 41299
41213 FuncBuilder::as_that_literal_writes_them -> 4180, 41259
41259 FuncBuilder::written_as_a_literal -> 23653, 23679, 23793, 25060, implementations:114
41299 FuncBuilder::enumerable_fields -> 41470, 47497, implementations:114
41447 FuncBuilder::own_accessor -> 41470, implementations:114
41470 FuncBuilder::declared_in_an_object_literal -> 41492
41485 FuncBuilder::declared_in_a_class -> 41492
41492 FuncBuilder::declared_within -> 23653, 23793
41518 FuncBuilder::optional_property_of -> implementations:114
41530 FuncBuilder::lower_table_for_each -> 23598, 23671, 23679, 23793, 24608, 25465, 39496, 39642, 39691, 43809, 43904, 45356, 53877, 54077, 83647, 84015
41647 FuncBuilder::lower_delegated_for_each -> 23598, 23671, 23679, 23793, 24594, 24608, 25465, 29693, 39496, 39642, 39691, 43809, 43904, 45162, 45219, 45248, 45356, 46502, 53877, 54077, 83647, 84015, implementations:114
41760 FuncBuilder::decide_object_is -> 23580, 23592, 23598, 23610, 23671, 24608, 29693, 41882, 54077
41882 FuncBuilder::object_is_numbers -> 23671, 24608, 63250
41968 FuncBuilder::decide_object_keys -> 23671, 24608, 41200, 54077
42043 FuncBuilder::decide_object_create -> 23671, 23793, 24583, 24608, 25465, 85771
42138 FuncBuilder::decide_object_assign -> 23671, 25465, 44791, 54077, object_assign:14
42191 FuncBuilder::decide_has_own -> 23671, 24608, 25465, 29081, 41200, 41447, 44791, 47531, 48928, 52546, 54077, 57885, property_keys:70, property_keys:92
42302 FuncBuilder::decide_as_n -> 23671, 25465, 29693, 44791, 54077, 60303, numeric_arguments:168
42330 FuncBuilder::only_primitives -> 42343
42343 FuncBuilder::numeric_primitives -> implementations:114
42376 FuncBuilder::decide_is_view -> 23671, 24608, 44791, 54077
42412 FuncBuilder::ask_the_runtime_is_array -> 23671, 24608, 44791
42436 FuncBuilder::decide_is_array -> 23671, 24608, 25465, 42412, 54077, implementations:114
42583 FuncBuilder::lower_special_call -> 23653, 23679, 23793, 25391, 26552, 40142, 42746, 42948, 59598, 59640, 70949, 70973, 77774, 78472, 79485, 79545, 79580, 79846, 79893, 80471, array_construction:15, array_construction:57, gobject:57, gobject:72, implementations:114, json:277, json:294, native_memory:1559, native_memory:1640, native_memory:1706, native_memory:1733, native_memory:1788, native_memory:1815
42746 FuncBuilder::lower_promise_static -> 23653, 23679, 23793, 42784, 42924, 43109
42784 FuncBuilder::combinator -> 23671, 24583, 24608, 24615, 25465, 54077, 80262
42871 FuncBuilder::names_a_promise_capability -> 42886, implementations:114
42886 FuncBuilder::is_a_capability_type -> 21136, implementations:114
42924 FuncBuilder::promise_capability -> 23671, 24583, 24615, 25465, 80262
42948 FuncBuilder::lower_capability_call -> 23653, 23679, 23793, 42871, 42985
42985 FuncBuilder::settle_capability -> 24583, 24615, 43042, 54077
43003 FuncBuilder::capability_settle -> 23653, 42871, 43042
43042 FuncBuilder::settle_lowered -> 25465, 43503, 54077, 60540
43084 FuncBuilder::settled_around -> 23671, 43503, 80262
43109 FuncBuilder::settled_promise -> 23671, 24583, 24615, 25465, 43503, 54077, 60540, 80262
43146 FuncBuilder::settle_through_thenables -> 917, 3222, 23592, 23598, 23610, 23671, 24608, 25465, 43292, 43356, 43382, 43441, 46024, 46068, 57372, 80262
43292 FuncBuilder::check_delivery -> 18575, 24594, 25465, 43356, closure_context:76, implementations:114
43356 FuncBuilder::thenable_candidates -> 774, 917
43382 FuncBuilder::binding_thenable -> 25465, 43427, binding_thens:33, implementations:114
43427 FuncBuilder::resolved_node -> 23679, 23793, 58657
43441 FuncBuilder::queue_thenable_job -> 3222, 3236, 4142, 24608, 25465, 29693, 33802, 35968, 46024, 52468, 80262, layout_collection:372
43482 FuncBuilder::settle_and_return -> 23610, 43503
43503 FuncBuilder::settle -> 23671, 25465, 43146, 43565, 80262
43565 FuncBuilder::fulfil -> 23671, 24608, 24615, 29693, 35435, 80262
43690 FuncBuilder::return_from_callback -> 23610, 39865, 83662
43716 FuncBuilder::enclosing -> 23653, 23679, 23793, 25465
43761 FuncBuilder::lower_for -> 23671, 23793, 25465, 38915, 39079, 39496, 39602, 39691, 48942, 53877, 54077, 65780
43809 FuncBuilder::walk_condition -> 24608, 29693, 45248
43904 FuncBuilder::walk_start -> 24608, 43964, 44791, 45248, 48936
43952 FuncBuilder::unlend_walked -> 80262
43964 FuncBuilder::cursor_of_presence -> 24608, 29693
43976 FuncBuilder::async_generator_step -> 24608, 25465, 45972
44075 FuncBuilder::protocol_step -> 24608, 25465, 43976, 78103, iterator_calls:458
44163 FuncBuilder::generator_element_of -> 44303
44176 FuncBuilder::generator_walk -> 5759, 7161, 25465, 44303, 44461, 44478, 78079, implementations:114
44303 FuncBuilder::generator_element -> 24594, 44478, implementations:114
44344 FuncBuilder::generator_next -> 23671, 24583, 24608, 24615, 25465, 29693, 44176, 52468, 57885, 62819
44461 FuncBuilder::generator_dispatch -> 25465, 57885
44478 FuncBuilder::generator_declared -> 44508, implementations:114
44508 FuncBuilder::generator_in_context -> 5759, 24301, implementations:114
44536 FuncBuilder::protocol_walk -> 23671, 24608, 25465, 29360, 44176, 44684, 57885, 77919, 84532, iterator_calls:424, iterator_calls:458
44660 FuncBuilder::property_is_readonly -> implementations:114
44684 FuncBuilder::member_returns -> 24594, 44689
44689 FuncBuilder::member_return_type -> implementations:114
44706 FuncBuilder::lower_symbol_new -> 23671, 24608, 25465, 44791, 54077
44747 FuncBuilder::lower_symbol_for -> 23671, 25465, 44791, 54077
44765 FuncBuilder::lower_symbol_key_for -> 23671, 25465, 44791, 54077
44791 FuncBuilder::call_runtime -> 24608
44810 FuncBuilder::sequence_source -> 23679, 23793, 24583, 29081, 58657
44907 FuncBuilder::walk_of -> 5759, 20831, 25465, 29360, 44176, 44536, 44862, 45039, 45084, 45203, 45219, implementations:114
45039 FuncBuilder::native_iteration -> 23653, 45058, implementations:114
45058 FuncBuilder::members_of -> implementations:114
45084 FuncBuilder::native_walk -> 24594, 25465, 45039, 45177, implementations:114
45145 FuncBuilder::element_as_declared -> 24583, 45162
45177 FuncBuilder::walk_method -> 45058, implementations:114
45203 FuncBuilder::delegated_collection -> 45177, 72071, implementations:114
45219 FuncBuilder::delegated_walk -> 24594, 25465, 45203
45248 FuncBuilder::call_native_walk -> 24594, 25465, 29693, 70015, 75279, 75703
45282 FuncBuilder::advance -> 24608, 43964, 44791, 45248
45356 FuncBuilder::read_element -> 24608, 44791, 45162, 45248
45486 FuncBuilder::for_of_pattern -> 23679, 23793
45513 FuncBuilder::head_for_the_sequence -> 45486
45568 FuncBuilder::for_of_head -> 23679, 23793, 25465
45647 FuncBuilder::pattern_symbols -> 23653, 23679, 23793, 45647
45664 FuncBuilder::carry_what_the_head_assigns -> 38915, 45700
45700 FuncBuilder::names_written_by -> 23653, 23679, 23793, 45700
45734 FuncBuilder::bind_head -> 23793, 25465, 50613, 51126, 52648, 66842
45784 FuncBuilder::lower_for_of -> 11730, 23598, 23653, 23671, 25465, 38915, 39079, 39496, 39642, 39691, 40820, 41968, 43809, 43904, 43952, 44075, 44810, 44907, 45145, 45356, 45513, 45568, 45647, 45664, 45734, 53877, 54077, iterator_close:329
45972 FuncBuilder::record_rejection -> 23592
46024 FuncBuilder::erased -> 24608
46068 FuncBuilder::erased_from -> 30406, 46024
46076 FuncBuilder::lower_throw -> 23679, 25465, 29693, 46106, 54077
46106 FuncBuilder::throw_erased -> 17825, 23592, 23602, 23610, 23671, 24608, 48685, 80218, 80262, layout_collection:349
46264 FuncBuilder::is_the_object_type -> implementations:114
46360 FuncBuilder::in_on_a_native -> 23671, 24608, 25465, 46308, 46414, 54077
46414 FuncBuilder::native_receiver -> 24594
46442 FuncBuilder::native_test -> 24608, 44791, 46502
46502 FuncBuilder::bool_join -> 23580, 23592, 23598, 23610, 24608
46548 FuncBuilder::lower_in_over_every_class -> 23598, 23610, 23671, 24608, 25465, 44791, 46024, 46308, 46442, 46502, 46731, 46911, 47531, 48089, 48245, 54077, access_families:205, access_families:259, implementations:114
46731 FuncBuilder::in_with_optional_memberships -> 23671, 24608, 44791, 46502, 46787
46787 FuncBuilder::presence_bit_named -> 25465, 46836, 48152, 52546
46836 FuncBuilder::candidate_layout -> 57885, implementations:114
46880 FuncBuilder::private_name_key -> 23653, 23793
46911 FuncBuilder::brand_owner -> 25465, 46928
46928 FuncBuilder::enclosing_class_instance -> 23653, 23793, 29368
46947 FuncBuilder::in_by_presence -> 23671, 24608, 25465, 44791, 52546, 54077, 57885
47048 FuncBuilder::lower_in -> 23671, 24583, 24594, 24608, 25465, 46264, 46360, 46548, 46880, 46947, 47241, 47271, 47353, 47392, 47564, 48928, 54077, access:139, access:193, implementations:114, property_keys:64, property_keys:70, property_keys:92
47241 FuncBuilder::with_subclasses -> 48245
47271 FuncBuilder::in_over_a_structural_arm -> 18481, 23671, 24594, 24608, 46548, 47531, 54077, 57739, implementations:114
47353 FuncBuilder::arms_declaring -> 25465, 47531
47392 FuncBuilder::in_over_the_arms -> 24608, 46024, 54077, 57885
47439 FuncBuilder::defined_at_construction -> 23653, 23793
47497 FuncBuilder::declared_with_a_private_name -> 23679, 23793
47531 FuncBuilder::declares -> implementations:114
47564 FuncBuilder::literal_key -> implementations:114
47582 FuncBuilder::has_no_representation -> 24594, construction:708
47637 FuncBuilder::instanceof_global -> construction:72
47647 FuncBuilder::instanceof_native -> 23671, 24608, 44791, 46068, 47582, 47637, 54077
47760 FuncBuilder::lower_instanceof -> 23653, 23671, 24608, 24653, 25465, 46068, 47637, 47647, 47895, 54077, 57372, 77264, 77323, 77456, 77577, 77655, construction:684, implementations:114
47895 FuncBuilder::instanceof_builtin -> 23671, 24608, 42436, 47582, 47637, 54077, implementations:114
48013 FuncBuilder::type_named -> 48222, implementations:114
48024 FuncBuilder::shaped_like -> 20831, implementations:114
48089 FuncBuilder::is_the_type_of_some_node -> implementations:114
48133 FuncBuilder::called_without_a_function -> 20674, 48152, implementations:114
48152 FuncBuilder::type_in_a_message -> 1154, 21130, 48024, implementations:114
48222 FuncBuilder::name_of_type -> implementations:114
48231 FuncBuilder::provided_errors_under -> 48245
48245 FuncBuilder::descends_from -> 917
48260 FuncBuilder::lower_labeled_block -> 23598, 23602, 23610, 23671, 38816, 38915, 39079, 39673, 39865, 53877
48347 FuncBuilder::lower_labeled -> 23653, 23679, 23793, 25465, 48260, 53877
48405 FuncBuilder::lower_try -> 23602, 23679, 23793, 25465, 48612, 53877, 64551
48523 FuncBuilder::lower_unguarded -> 23598, 23602, 23610, 23671, 46106, 48605, 48720, 53877
48605 FuncBuilder::finally_of -> 23679, 23793
48612 FuncBuilder::lower_guarded -> 23598, 23602, 23671, 23679, 25465, 48523, 48720, 48836, 48854, 53877
48685 FuncBuilder::unwind_to -> 23602, 53877, iterator_close:383
48720 FuncBuilder::open_handler -> 23580
48836 FuncBuilder::bind_caught -> 23653, 23679, 25465, 35740
48854 FuncBuilder::join_try -> 23482, 23580, 23592, 23598, 23610
48928 FuncBuilder::lower_expecting -> 54077
48942 FuncBuilder::child_slots -> 23653, 23679, 23793
48981 FuncBuilder::lower_postfix_unary -> 23653, 23679, 25465, 52919
49001 FuncBuilder::lower_assignment -> 23679, 23793, 25465, 48928, 50038, 50042, 50055, 50613, 51126, 52267, 52648, 54077, 76865
49063 FuncBuilder::native_construct -> 23653, 23793, 35661, 49093, 49566, implementations:114
49093 FuncBuilder::lower_native_construct -> 25465, 49180, 49229, 49285, 49461, 49672, 49686, implementations:114
49180 FuncBuilder::construct_with -> 25465, 49461, 49672
49229 FuncBuilder::chosen_constructor -> 23679, 23793, 29281, 58657
49285 FuncBuilder::constructed_properties -> 23679, 23793, 25465, 49322, 55475, 58657
49322 FuncBuilder::passed_properties -> 23671, 24608, 25465, 54077, 57885, 85675, implementations:114
49461 FuncBuilder::set_constructed -> 23592, 23598, 23602, 23610, 23671, 24608, 49514, 49550
49514 FuncBuilder::constructed_setter -> 23653, 25465, 27617, 27642, 27988, implementations:114
49550 FuncBuilder::write_constructed -> 50300, 52648
49566 FuncBuilder::gobject_new -> 1125, 2253, 23653, 23679, 23793, 24594, 25465, 49611, 58657, 70001, 75066, implementations:114
49611 FuncBuilder::lower_gobject_made -> 23671, 24594, 24608, 25465, 49285, 49461
49672 FuncBuilder::call_foreign_named -> 49686
49686 FuncBuilder::call_foreign_named_absent -> 23793, 25391, 25465, 49731, implementations:114
49713 FuncBuilder::call_foreign_declaration -> 49731
49731 FuncBuilder::call_foreign_declaration_absent -> 23671, 23679, 24608, 25465, 36861, 70015, 75279, 75703, 85675, implementations:114
49804 FuncBuilder::accessor_declarations -> 23653, 49832
49815 FuncBuilder::tagged_statement -> 23653, 23793
49832 FuncBuilder::accessor_nodes -> 23653, 23793, 49815, implementations:114
49869 FuncBuilder::accessor_read -> 23671, 24608, 25465, 49905, 49928, 50038, 50042, 50055, 50300, 50314, 54077
49905 FuncBuilder::delegated_accessor -> 23653, 29081, 72071, implementations:114
49928 FuncBuilder::delegated_named -> 29081, 72071, implementations:114
49943 FuncBuilder::delegated_typed_setter -> 29081, 50021, 72071, implementations:114
50007 FuncBuilder::assigned_value -> 23653, 23793, 75266
50021 FuncBuilder::method_takes -> 71218, implementations:114
50038 FuncBuilder::is_accessor_property -> 49804
50042 FuncBuilder::accessor -> 49804
50055 FuncBuilder::lower_accessor -> 23793, 25465, 49832, 50101, 50188, 50300, 54077, implementations:114
50101 FuncBuilder::lower_static_accessor -> 23653, 25465, 29693, 49832, 70015, 75279, 75703, 76185, 76937, implementations:114
50188 FuncBuilder::lower_slot_accessor -> 14175, 23653, 23679, 23793, 25465, 29253, 29693, 49832, 57413, 70001, 73120, 73171, 75279, 75703, 76937, implementations:114
50300 FuncBuilder::lower_accessor_on -> 50314
50314 FuncBuilder::call_bound_method -> 24583, 24615, 25465, 29693, 57413, 70001, 70015, 72801, 72816, 75279, 75703, implementations:114
50446 FuncBuilder::assign_with_a_default -> 25465, 50495, 51126, 52648, 66342
50495 FuncBuilder::assignment_default -> 23679, 23793
50512 FuncBuilder::pattern_element_read -> 23671, 24608, 25465, 29293, 56676, 57885, 66274, access_families:389, access_families:421
50613 FuncBuilder::assign_pattern -> 23653, 23679, 23793, 25465, 50446, 50512, 50613, 51126, 51244, 52648, 63250, 67168, 67231, 85097
50816 FuncBuilder::static_field_place -> 14274, 23653, 25465, 31756, implementations:114
50851 FuncBuilder::array_length_place -> 29081
50871 FuncBuilder::delegated_place -> 23671, 24608, 49905, 49928, 49943, 50007, 50021, 54077, implementations:114
50938 FuncBuilder::property_place -> 23679, 25465, 29081, 29477, 50038, 50816, 50871, 50982, 51348, 61603, 61700, access:37, access:139, access:182
50982 FuncBuilder::property_place_on -> 23671, 24594, 24608, 25465, 27584, 29081, 29293, 29340, 44660, 46024, 50851, 56086, 56303, 56676, 57440, 57885, 62819, access_families:377, access_families:656, native_memory:1477
51126 FuncBuilder::place_of -> 23653, 23679, 23793, 25465, 29394, 29403, 29565, 50938, 51126, 51244, 61403, 61434, access:30, access:182, native_memory:1460, property_keys:70
51213 FuncBuilder::immutable_binding -> 23793, 78330, implementations:114
51244 FuncBuilder::place_for_symbol -> 23793, 24583, 25465, 51213, implementations:114, initialization:183
51348 FuncBuilder::native_accessor_place -> 25465, 50042, 54077, implementations:114
51396 FuncBuilder::read_native_accessor -> 25465, 50300
51411 FuncBuilder::set_array_length -> 23679, 23793, 25465, 80262, 81462, 87281, 89841, 89862
51460 FuncBuilder::read_place -> 23671, 24583, 24608, 24615, 25465, 28722, 29693, 31680, 31745, 35908, 50314, 51396, 51460, 54077, 56025, 57885, 61453, 66127, access:247, access_families:707, claimed_reads:61, native_memory:126, native_memory:1505, property_keys:92
51637 FuncBuilder::coerce_element -> 23671, 24608, 29693
51705 FuncBuilder::template_cooked -> 23653, 25465
51716 FuncBuilder::template_parts -> 23679, 23793, 25465, 51705
51755 FuncBuilder::lower_tagged_template -> 11041, 23653, 23671, 23679, 23793, 24608, 25402, 25416, 25465, 36157, 51716, 62060, 65131, 65187, 77948, 78186, implementations:114
51812 FuncBuilder::lower_template -> 23653, 23671, 23679, 23793, 24608, 25465, 51856, 52077, 54077
51856 FuncBuilder::join -> 23671, 24608
51879 FuncBuilder::voids_a_literal -> 23679, 23793
51928 FuncBuilder::absence_written_at -> 23679, 23793, 36452, 51879, 51928
51976 FuncBuilder::comparison_of_two_absences -> 23793, 51928
52001 FuncBuilder::implicit_printer_callees -> printed/edges:179
52014 FuncBuilder::printer_text -> 23592, 23598, 23610, 23671, 24608, 46106, 53678, 80262, printed/edges:45, printed/edges:203
52077 FuncBuilder::as_string -> 23671, 24608, 24621, 25465, 29693, 52014, 52203, 63250, 63997, 64049, 87270
52203 FuncBuilder::prints_off_its_descriptor -> implementations:114
52223 FuncBuilder::spells_itself -> implementations:114
52267 FuncBuilder::slot_type -> 52267, 57885, native_memory:80, native_memory:1505
52359 FuncBuilder::coerce_to_slot -> 25465, 29693, 51637, 52267, 52359, 52422, 75568, native_memory:80
52422 FuncBuilder::void_where_a_setter_wants -> 20674, 23679, 38210, 48152, 52450, implementations:114
52450 FuncBuilder::setter_parameter -> 23653, 23679, 23793, implementations:114
52468 FuncBuilder::field_set -> 24608, 44791, 52594
52508 FuncBuilder::field_delete -> 24608, 44791, 52594
52546 FuncBuilder::presence_of_key -> 47531, layout_collection:349
52570 FuncBuilder::property_at -> layout_collection:349
52594 FuncBuilder::presence_bit_of -> 52546, 52570
52615 FuncBuilder::notify_property -> 24608, 29693, 89964
52648 FuncBuilder::write_place -> 23671, 24608, 25465, 29693, 31680, 31745, 35427, 35733, 38261, 46068, 50300, 50314, 51411, 52359, 52468, 52615, 52648, 56025, 69309, 69342, access:247, initialization:35, initialization:270, native_memory:1505, property_keys:92
52844 FuncBuilder::push_bitwise -> 24608, 29693
52919 FuncBuilder::step -> 23671, 24583, 24608, 24615, 42330, 51126, 51460, 52648, 64323, 64465
53053 FuncBuilder::statically_decided -> 53088
53088 FuncBuilder::decided_value -> 23679, 23793, 53088, 53144, 53213
53144 FuncBuilder::decided_typeof -> 23653, 23679, 23793, 24521, 31303, 38915, implementations:114
53213 FuncBuilder::the_checker_decided -> 53228, implementations:114, initialization:262
53228 FuncBuilder::reads_a_binding_that_can_change -> 23653, 23679, 23793, 53228, 53275, implementations:114
53275 FuncBuilder::binding_can_be_written -> 23653, 23793, 25254
53296 FuncBuilder::hoists_out_of -> 23653, 23679, 23793, 53296
53334 FuncBuilder::folded_branch -> 53053, 53296, 53877
53375 FuncBuilder::instanceof_proved_by -> 23653, 23679, 23793
53444 FuncBuilder::narrow_binding -> 23671, 24608, 35427, 46068
53472 FuncBuilder::narrow_for_the_arm -> 53375, 53444
53497 FuncBuilder::lower_narrowed_arm -> 53472, 53877
53528 FuncBuilder::lower_if_test -> 23592, 23610, 53577, 53624, 53654, 54077, 64276
53577 FuncBuilder::lower_jumps -> 23592, 23598, 23602, 23610, 53577, 53624, 54077, 64276
53624 FuncBuilder::connective -> 23653, 23679, 23793
53654 FuncBuilder::assigns -> 23653, 23679, 23793, 53654, 87804, 87839
53678 FuncBuilder::lower_arm -> 23602
53694 FuncBuilder::lower_if -> 23482, 23580, 23592, 23598, 23610, 23671, 23679, 25465, 53334, 53497, 53528, 53678, 53825, made_instance:166, made_instance:173, made_instance:182
53825 FuncBuilder::narrow_after_the_if -> 53375, 53444
53866 FuncBuilder::is_source_import -> 23653, 23679, 23793
53877 FuncBuilder::lower_statement -> 23602, 23610, 23653, 23671, 23679, 23793, 24044, 24175, 24583, 24608, 25465, 31787, 31977, 35887, 38478, 38741, 39110, 39143, 39432, 39870, 39888, 43761, 45784, 46076, 48347, 48405, 52468, 53694, 53866, 54077, 58221, 65780, initialization:282
54077 FuncBuilder::lower_expression -> 20702, 23653, 23671, 23679, 23793, 24608, 25465, 28384, 31049, 31489, 31537, 31756, 38237, 39909, 40063, 48981, 49063, 51755, 51812, 54077, 54514, 55100, 58372, 59141, 60591, 61772, 63642, 65639, 67409, 69731, 77002, 77136, 85052, 85534, 86018, 86070, 86107, 86792, assertions:386
54190 FuncBuilder::holds_a_hole -> 23679, 23793, 25465
54250 FuncBuilder::checker_called_it_unsettled -> implementations:114
54282 FuncBuilder::a_stand_in_for_nothing -> 10392, 10429, 10436, 23679, 23793, implementations:114
54345 FuncBuilder::array_literal_type -> 10436, 24583, 24615, 25465, 54250, 54282, 57440, 85771
54514 FuncBuilder::lower_array_literal -> 23671, 23679, 23793, 24608, 25465, 29693, 38360, 48928, 54077, 54190, 54345, 57327, 57885, 61139, 61258, implementations:114
54670 FuncBuilder::lower_empty_array -> 23671, 24453, 24608, 25465
54700 FuncBuilder::lower_table_literal -> 23671, 23679, 23793, 24608, 25465, 54077, 54806, 80280
54806 FuncBuilder::table_property -> 23679, 23793, 24608, 25465, 46024, 46068, 54077, 55475
54852 FuncBuilder::contextual_union_member -> 23679, 23718, 23793, 29081, implementations:114
54923 FuncBuilder::empty_object_literal -> 23679, implementations:114
54951 FuncBuilder::as_its_own_record -> 18481, 57413, 57885, implementations:114, layout_collection:349, layout_collection:358
55022 FuncBuilder::literal_object_type -> 25465, 54852, 54923, implementations:114
55052 FuncBuilder::literal_member_owner -> 55022, 55062
55062 FuncBuilder::literal_context_type -> 24583, 54852, 85771
55088 FuncBuilder::unbuilt_literal -> 75201, native_memory:270
55100 FuncBuilder::lower_object_literal -> 23671, 23679, 23793, 24583, 24608, 24615, 25465, 28580, 29293, 29693, 52468, 54700, 54951, 55022, 55062, 55088, 55291, 55394, 55444, 55475, 57885, 58372, 85771, native_memory:240, native_memory:247
55291 FuncBuilder::spread_into -> 23679, 24594, 24608, 25465, 29693, 52468, 54077, 56025, 56086, 56303, 57885, access_families:401, access_families:877, access_families:889
55394 FuncBuilder::property_name -> 23653, 23679, 23793, 25465, 29293
55444 FuncBuilder::is_iterator_return_arm -> 23653, 23679, 23793, 62819
55475 FuncBuilder::property_parts -> 23679, 23793, 25465, 48928, 54077, 55394, 85097, 85219
55530 FuncBuilder::fill_array_arguments -> 22334, 24608, 25465
55549 FuncBuilder::fill_string_arguments -> 22334, 24608, 25465
55586 FuncBuilder::guard_reduce_has_elements -> 23592, 23598, 23602, 23610, 24608, 55852
55673 FuncBuilder::guard_repeat_count -> 23592, 23598, 23602, 23610, 23671, 24608, 55852
55733 FuncBuilder::guard_code_point -> 23592, 23598, 23602, 23610, 23671, 24608, 55873, 80262
55852 FuncBuilder::throw_provided_error -> 23671, 24608, 55873
55873 FuncBuilder::throw_provided_error_text -> 23671, 24608, 46106, 55895
55895 FuncBuilder::provided_error -> 23671, 24608, 55914
55914 FuncBuilder::provided_error_named -> 23671, 24453, 24608, 25465, 48013, 52468, 55970, 55978
55970 FuncBuilder::provided_layout -> 21136, 55978, implementations:114
55978 FuncBuilder::layout_for_provided_error -> 891, 48013, 55970, layout_collection:349, layout_collection:372
56025 FuncBuilder::push_an_accessor_call -> 24608, 78034
56086 FuncBuilder::accessor_callee -> 817, 906, 942, 25465, 57885, 65131, 65323, access_families:101, access_families:1123, access_family_functions:417
56190 FuncBuilder::a_default_inherits_the_handler -> 11756
56261 FuncBuilder::a_default_the_instance_cannot_answer -> 23793, 25465, 56276
56276 FuncBuilder::reads_this -> 23679, 23793, implementations:114
56303 FuncBuilder::declared_type_of -> implementations:114
56319 FuncBuilder::no_aggregate_errors_read -> 21136, 25465, 57014, implementations:114
56372 FuncBuilder::wrapping_closure -> 4142, 23671, 24608, 35968, closure_context:76, implementations:114, layout_collection:372
56401 FuncBuilder::member_that_is_not_a_field -> 23671, 23675, 24583, 24608, 24615, 29340, 36983, 56025, 56086, 56492, 56580, 56676, function_names:367, literal_methods:367
56492 FuncBuilder::through_a_narrowed_class -> 23671, 23679, 24583, 24608, 29340, 57885, 63018
56580 FuncBuilder::bound_method -> 3051, 4142, 23653, 23671, 23679, 24608, 25465, 35968, 52468, closure_context:76, implementations:114, layout_collection:372
56650 FuncBuilder::not_decomposed -> 20831, 25465, implementations:114
56676 FuncBuilder::absent_member -> 20831, 21130, 21136, 25465, 29321, 56303, 57014, implementations:114
56725 FuncBuilder::option_initializers -> 23653, 23679, 23793, 29081
56769 FuncBuilder::error_message -> 23671, 24608, 25465, 31321, 52014, 63311, 63997
56859 FuncBuilder::initialize_error -> 23671, 24608, 25465, 46024, 48928, 52468, 54077, 56725, 56769, 57885
57014 FuncBuilder::provided_error_base -> 21136, implementations:114, type_bases:12
57026 FuncBuilder::representable_bases -> 24594, 24637, implementations:114, type_bases:12
57064 FuncBuilder::fields_of -> 736, 23793, 24637, 25465, 38210, 38230, 47497, 57014, 57440, 57739, 57885, 63208, 85675
57327 FuncBuilder::lower_tuple_literal -> 23671, 23679, 24608, 25465, 29693, 38360, 48928, 52468, 57885
57372 FuncBuilder::classes_under -> 48231, 48245
57413 FuncBuilder::class_behind -> implementations:114
57440 FuncBuilder::is_tuple -> implementations:114
57456 FuncBuilder::tuple_layout -> 24594, 24615, 38230, 57885, layout_collection:372
57526 FuncBuilder::after_the_base -> 57885
57580 FuncBuilder::not_the_same_element -> 30654, 48152, 88752
57625 FuncBuilder::the_same_element -> 30501
57679 FuncBuilder::abstract_generator_layout -> 891, 5744, 5759, 5781, 24594, implementations:114
57739 FuncBuilder::is_a_signature -> implementations:114
57747 FuncBuilder::foreign_owner -> 23675, 23679, implementations:114
57773 FuncBuilder::overridden_entries -> 891, 917, 17897, 57843, access_families:946, access_family_functions:442, literal_methods:489, literal_methods:513
57843 FuncBuilder::field_reservation -> 18481, 18885, access_families:1280, implementations:114
57885 FuncBuilder::layout_of -> 929, 1053, 1567, 15224, 20067, 21008, 21031, 25465, 32632, 35528, 55970, 56650, 57026, 57064, 57413, 57456, 57526, 57636, 57679, 57747, 57773, 57885, 62854, implementations:114, layout_collection:349, layout_collection:358, layout_collection:365, layout_collection:372, layout_collection:379
58120 FuncBuilder::bind_own_name -> 23653, 23679, 23793
58164 FuncBuilder::hoistable -> 23653, closure_context:76, implementations:114
58221 FuncBuilder::bind_nested_function -> 4793, 23653, 23679, 35740, 58256, 58372, closure_context:76
58256 FuncBuilder::bind_later_siblings -> 4793, 23653, 25465, 29253, 35740, 58256, 58325, 58341, 58372, closure_context:76
58325 FuncBuilder::later_sibling_function -> 23653, 23793, implementations:114
58341 FuncBuilder::could_stand_at -> 23653, 58325, closure_context:76, implementations:114
58372 FuncBuilder::lower_arrow -> 3051, 4142, 23671, 24583, 24608, 25465, 29693, 35854, 35887, 35968, 52468, 58573, closure_context:76, layout_collection:372
58573 FuncBuilder::stored_capture -> 25465, 28722, 29693, 35286, 35427, 48222
58657 FuncBuilder::arguments_of -> 23679, 23793
58670 FuncBuilder::initialize_presence -> 23671, 24608, 44791, 47439, implementations:114
58765 FuncBuilder::construction_chain -> implementations:114
58784 FuncBuilder::initialize_fields -> 57885, 58827
58827 FuncBuilder::initialize_declared_fields -> 23671, 23679, 23793, 24453, 25465, 29293, 29693, 48928, 48942, 52468, 58670, implementations:114
58972 FuncBuilder::widened -> 917, 85771
59033 FuncBuilder::initialisers_this_site_owes -> 900, 58765
59060 FuncBuilder::allocated_array_type -> 20791, 24583, 24615, 63271, 85771
59106 FuncBuilder::past_the_choices -> 23679, 23718, 23793
59141 FuncBuilder::lower_new -> 23653, 23671, 23675, 23679, 24583, 24608, 24615, 25465, 35792, 36094, 57747, 58657, 58972, 59283, 71972, 72048, construction:194, construction:623, construction:650, implementations:114
59262 FuncBuilder::lower_new_object -> 23671, 24608, 57885, 59033, 59344
59283 FuncBuilder::require_an_implemented_constructor -> 18481, 21136, 25465, 57014, 59317, implementations:114
59317 FuncBuilder::an_implemented_class -> 23653, 23793, implementations:114
59344 FuncBuilder::run_the_constructor -> 900, 21136, 23671, 23675, 24608, 25465, 25694, 36114, 56859, 57014, 58657, 58784, 65131, 78034, implementations:114, made_instance:469
59501 FuncBuilder::lower_new_provided -> 59526, 60164, 60375, 68362, 82742
59526 FuncBuilder::lower_new_date -> 23671, 25465, 29693, 44791, 54077, 58657
59559 FuncBuilder::typed_array_shape -> 25465
59598 FuncBuilder::lower_typed_array_from -> 23793, 25465, 48928, 54077, 59559, 59994
59640 FuncBuilder::lower_typed_array_of -> 23671, 24608, 25465, 29693, 59559, 59994, numeric_arguments:150
59698 FuncBuilder::lower_new_typed_array -> 23671, 23793, 24608, 25465, 29693, 48928, 54077, 58657, 59559, 59792, 59994, 60098, 60303
59792 FuncBuilder::lower_view_over -> 23671, 24608, 29693, 44791, 54077, 59925, 59973, 60135, 60147, 60303
59925 FuncBuilder::guard_aligned_offset -> 23671, 24608, 69309
59973 FuncBuilder::guard_within -> 23671, 24608, 69309
59994 FuncBuilder::view_copied_from_array -> 23580, 23592, 23598, 23610, 23671, 24608, 25465, 52648, 60098
60098 FuncBuilder::view_over_fresh_buffer -> 23671, 24608, 44791, 60135, 60147, 60256
60135 FuncBuilder::make_view_an_instance -> 24608
60147 FuncBuilder::guard_allocated_view -> 23671, 24608, 69309
60164 FuncBuilder::lower_new_buffer -> 23671, 24608, 25465, 29693, 44791, 54077, 58657, 60256, 60284, 60303, 69309
60256 FuncBuilder::guard_allocated -> 23671, 24608, 69309
60284 FuncBuilder::literal_option -> 23679, 23793, 29081
60303 FuncBuilder::guard_buffer_length -> 23592, 23598, 23602, 23610, 23671, 24608, 55852
60375 FuncBuilder::lower_new_promise -> 23671, 23679, 23793, 25465, 53877, 54077, 58657, 80262, 84015
60453 FuncBuilder::lower_settler_call -> 23592, 23598, 23610, 23653, 23671, 23679, 23793, 24608, 25465, 43503, 54077, 58657, 60540, 80262
60540 FuncBuilder::reject_with -> 23671, 25465, 80262
60591 FuncBuilder::lower_element_access -> 23679, 23793, 23994, 23999, 29565, 60648, 60709, 60862, 61366, 61403, 61471, 61772, 62026, access:30, access:247
60648 FuncBuilder::folded_enum_member -> 23671, 24608, 63863
60709 FuncBuilder::enum_reverse_member -> 23653, 23671, 23679, 23793, 24608, 24653, 25289, 25465, implementations:114
60813 FuncBuilder::tuple_position_representation -> 23679, 24594, implementations:114
60862 FuncBuilder::element_of -> 23653, 23671, 23679, 23793, 24583, 24608, 60813, 61113, 61434, 61453, 80262, 81443, claimed_reads:61, implementations:114, native_memory:126, property_keys:70, property_keys:92
61113 FuncBuilder::reads_a_tuple -> 23679, implementations:114
61139 FuncBuilder::lower_mixed_literal -> 23679, 23793, 24608, 24615, 25465, 29693, 48928, 54077, 61279, 80262, 89841, 89862
61258 FuncBuilder::lower_spread_copy -> 23679, 25465, 61279, 61311
61279 FuncBuilder::collect_spread -> 24583, 40514, 40743, 44810, 54077
61311 FuncBuilder::lower_array_copy -> 24608, 25465, 54077, 61339, 80262
61339 FuncBuilder::slice_helper -> 25465, 89841, 89862
61366 FuncBuilder::lower_string_index -> 23671, 23679, 24583, 54077, 80262, access:30, access:139, access:247
61403 FuncBuilder::element_access_parts -> 23679, 25465, 48928, 54077, 61434, 61453, access:139, property_keys:60
61434 FuncBuilder::erased_but_proven_an_array -> 62594
61453 FuncBuilder::not_an_array -> 20831, 23679, 25465, implementations:114
61471 FuncBuilder::check_native_brand_read -> 23679, 23793, 24583, 25465, 27480, 27493, 27976, 29081, 49905, 49928, 50038, 76422, implementations:114, native_memory:65
61571 FuncBuilder::super_getter_read -> 23671, 23793, 24583, 24608, 24615, 29293, 61729
61603 FuncBuilder::static_accessor_place -> 14274, 23653, 23793, 24583, 25694, 29293, 61686, 65131, 78528, implementations:114
61686 FuncBuilder::accessor_parameter_type -> 23679, 23793, 24583
61700 FuncBuilder::super_setter_place -> 23653, 23793, 24594, 29293, 56303, 61729
61729 FuncBuilder::super_accessor -> 817
61758 FuncBuilder::foreign_property_read -> 23679, 76696, 77756
61772 FuncBuilder::lower_property_access -> 14274, 23653, 23671, 23679, 23793, 23994, 23999, 24608, 25465, 25643, 28722, 29081, 29394, 29403, 29477, 31756, 42871, 49869, 54077, 56372, 60648, 61471, 61571, 61758, 61989, 63018, 85052, 88024, access:37, access:139, access:247, implementations:114
61989 FuncBuilder::lower_optional_access -> 23994, 23999, 24117, 25465, 29081, 54077, 62369, 63018, 63250, 64049
62026 FuncBuilder::lower_optional_element -> 23994, 23999, 54077, 60862, 62369, 63250, 64049
62060 FuncBuilder::unresolved_call -> 23675
62071 FuncBuilder::is_optional_call -> 23679, 23793
62082 FuncBuilder::optional_method_call -> 23679, 23793, 29293, 54077, 62177, 62198, 62267, 62369, 63250, 87363, callable_fields:76, callable_fields:89, implementations:114
62177 FuncBuilder::objc_optional_selector -> 23653, 72096, implementations:114
62198 FuncBuilder::objc_optional_call -> 23671, 25465, 54077, 62228, 63250
62228 FuncBuilder::responds_to -> 24608, 89964
62267 FuncBuilder::declares_an_optional_method -> 20624, 62317, implementations:114
62317 FuncBuilder::declares_it_optionally -> callable_fields:76, implementations:114
62339 FuncBuilder::lower_optional_call -> 23679, 23793, 25465, 54077, 58657, 62082, 62369, 63250, 64049, 79169, 79439
62369 FuncBuilder::present_of -> 20624, 24594, implementations:114
62425 FuncBuilder::why_not_shared -> 23679, 29321, 57885, 88674, implementations:114
62529 FuncBuilder::not_a_length -> 25465, 62425
62570 FuncBuilder::proven_array_length -> 62594
62594 FuncBuilder::receiver_is_an_array -> 23679, implementations:114
62616 FuncBuilder::table_member -> 23671, 24608, 46024, claimed_reads:61, property_keys:92
62660 FuncBuilder::union_holders -> 18481, 57739, access_families:899, implementations:114
62695 FuncBuilder::shared_field -> 23679, 29321, 57885, 62660, 88674, implementations:114
62763 FuncBuilder::open_field -> 23679, 29321, 57885, 62660, implementations:114
62819 FuncBuilder::is_a_provided_iterator_result -> 21057, implementations:114
62854 FuncBuilder::provided_iterator_layout -> 891, 21057, 24453, 24594, 24615, implementations:114, layout_collection:372
62908 FuncBuilder::refuse_unguarded_iterator_value -> 21108, 25465, 62951, implementations:114
62951 FuncBuilder::receiver_cannot_be_finished -> 21057, 21108, 23679, 23793, implementations:114
62981 FuncBuilder::field_named -> 57440
63018 FuncBuilder::member_of -> 29340, 63032, access_families:389
63032 FuncBuilder::member_storage_of -> 23671, 24608, 25465, 27584, 27909, 28722, 29340, 51460, 56319, 56401, 57885, 62529, 62570, 62616, 62695, 62763, 62908, 62981, 68451, 68983, 69025, 69107, 69149, access_families:421, native_memory:1477
63208 FuncBuilder::holds_only_absences -> 20538, implementations:114
63250 FuncBuilder::lower_branching_value -> 24583, 24615, 63208, 63271, 63311, implementations:114
63271 FuncBuilder::instead_of_an_unchosen_collection -> 20791, 20810, 59106, 85771
63311 FuncBuilder::lower_branching_value_at -> 23482, 23580, 23592, 23598, 23610, 23671, 24453, 24608, 30120, 63513
63513 FuncBuilder::evaluate -> 23671, 23679, 24012, 24117, 24583, 24608, 24615, 28722, 36487, 52648, 54077, 58657, 60862, 68082, 76789, 79169, callable_fields:138, callable_fields:195
63642 FuncBuilder::lower_conditional -> 25465, 48942, 53053, 54077, 63250, 64276
63714 FuncBuilder::booleans_as_numbers -> 23671, 24608
63743 FuncBuilder::lower_compound -> 23671, 24583, 24608, 24615, 51126, 51460, 52077, 52648, 52844, 54077, 63693, 63714, 80302, 80382, 86453, 88153
63812 FuncBuilder::lower_logical_assignment -> 28722, 51126, 51460, 63250, 64049, 64276
63863 FuncBuilder::enum_member -> 23653, 23679, 24653, implementations:114
63901 FuncBuilder::lower_nullish -> 28722, 54077, 63250, 64049
63934 FuncBuilder::coercing_comparison -> 23793, 24583, 36452, 88105
63997 FuncBuilder::absences_of -> 20624, 87281, access_families:159, access_families:719, implementations:114
64049 FuncBuilder::absence_of -> 23671, 24608
64129 FuncBuilder::lower_logical -> 53053, 54077, 63250, 64191, 64276
64191 FuncBuilder::never_falsy -> 23653, 23679, 23793, 29081, 64191, implementations:114
64276 FuncBuilder::truthy -> 23671, 24608
64292 FuncBuilder::plus_of_a_bigint -> 23653, 23679, 23793, 24583
64307 FuncBuilder::throw_to_number_of_a_bigint -> 23592, 23598, 23602, 23610, 23671, 24608, 55852
64323 FuncBuilder::erased_to_number -> 23580, 23592, 23598, 23610, 23671, 24608, 44791, 52014, 64397, 64418, 69342, iterator_calls:252
64397 FuncBuilder::compare_tag -> 24608
64418 FuncBuilder::branch_on_an_object_tag -> 23592, 23598, 23610, 64397
64465 FuncBuilder::coerce_to_number -> 23671, 24608, 25465, 42330, 44791, 64323
64526 FuncBuilder::coerce_explicit_number -> 23671, 24608, 42343, 44791, 64323, 64465
64551 FuncBuilder::call_within -> 11681, 23793, 64551, 64737, 64770, 64815, 65259, 65407, 65412, 65450, iterator_calls:420, printed/edges:179
64737 FuncBuilder::sorts_with_a_comparator -> 23679, 23793, 29081, 58657, implementations:114
64770 FuncBuilder::why_no_raising_copy -> 64864, 65014, implementations:114
64815 FuncBuilder::calls_a_closure -> 23793, 64864, erased_calls:530
64864 FuncBuilder::reason_without_a_leaf -> 8246, 23793, implementations:114
64936 FuncBuilder::why_not_copyable -> 7075, 12339, 23653, 23793, implementations:114
65014 FuncBuilder::the_leaf_that_cannot_be_carried -> 11748, 64737, 64864, 64936, 65014, 65092, 65259, 65407, 65450, 78472, implementations:114
65092 FuncBuilder::spelled_callee -> 23653, 23679
65131 FuncBuilder::raising_suffix_of -> 65259
65161 FuncBuilder::dispatches_to_a_raising_entry -> 64815
65187 FuncBuilder::a_raising_body_carries_this_call -> 8246, 25465, 64770, 65247, 65450, erased_calls:530, implementations:114
65247 FuncBuilder::tested_for_a_raise -> 65131, 65161
65259 FuncBuilder::has_a_raising_copy -> 906, 2876, 7305, 11035, 11077, access_families:101, access_families:892, implementations:114, iterator_calls:270, printed/edges:179
65356 FuncBuilder::accessors_run_by -> 23653, 23679, 23793, 65435, access_families:892, implementations:114
65407 FuncBuilder::reads_an_accessor -> 65356
65412 FuncBuilder::an_accessor_that_can_raise -> 23653, 23679, access_families:892
65435 FuncBuilder::an_objective_c_accessor -> 23679, 23793, 77774
65450 FuncBuilder::calls_compiled_code -> 23653, 23675, 23679, 23793, 65602, 78683, erased_calls:530, implementations:114
65602 FuncBuilder::an_interface_member_that_can_raise -> 2876, 2907, 2953, implementations:114, literal_methods:367
65639 FuncBuilder::lower_prefix_unary -> 23653, 23671, 23679, 24583, 24608, 24615, 25465, 42330, 52844, 52919, 54077, 64276, 64292, 64307, 64323, 64465
65759 FuncBuilder::evaluate_a_class_initializer -> 23793, 31977
65780 FuncBuilder::lower_variable_statement -> 9911, 23602, 23653, 23679, 23793, 24583, 24615, 25254, 25465, 31787, 35740, 38261, 48928, 48942, 52648, 54077, 54670, 65759, 66024, 66051, 66127, 66842
66024 FuncBuilder::coerce_declared -> 29713
66051 FuncBuilder::binding_a_var_writes -> 23653, 51244, 66086
66086 FuncBuilder::catch_parameter_named -> 6244, 23653, 23679, 23793
66127 FuncBuilder::unwritten -> 9822, 21300, 23671, 24583, 24608, 25465, 66206
66206 FuncBuilder::evolved_type -> 10436, 23653, 24583, implementations:53
66251 FuncBuilder::reference_element_for_pattern -> 20581, 23793
66274 FuncBuilder::exhausted_pattern_element -> 23671, 23718, 23793, 24608, 48942, 50495, 54077
66342 FuncBuilder::defaulted_array_element -> 23671, 24608, 63250, 63311, 66251, 66274, 67168, 80262, 81443
66533 FuncBuilder::read_for_pattern -> 23671, 24594, 24608, 25465, 29081, 29293, 56025, 56086, 56303, 56676, 57885, 62908, access_families:389, access_families:421
66679 FuncBuilder::require_object_coercible -> 20557, 23592, 23598, 23602, 23610, 23793, 55852, 64049
66751 FuncBuilder::bind_array_pattern_by_stepping -> 23671, 23679, 23793, 25465, 44075, 44907, 67360
66816 FuncBuilder::bind_pattern_value -> 31787, 35740, 52648
66842 FuncBuilder::bind_pattern -> 66851
66851 FuncBuilder::bind_pattern_from -> 5759, 9692, 23671, 23679, 23793, 24608, 25465, 42871, 44478, 63250, 66251, 66342, 66533, 66679, 66751, 66816, 66851, 67049, 67066, 67168, 67360, elision_patterns:17, elision_patterns:76, implementations:114
67049 FuncBuilder::binding_element_symbol -> 23653, 23793, 25465
67066 FuncBuilder::bind_capability_member -> 23653, 24615, 25465, 29081
67116 FuncBuilder::pattern_names -> 23679, 23793, 67116, 67161
67161 FuncBuilder::declared_by -> 23653, implementations:114
67168 FuncBuilder::defaulted_when -> 23671, 24608, 25465, 63997, 64049
67231 FuncBuilder::rest_tail -> 23671, 24583, 24608, 25465, 40514, 40743, 54670, 61339, 67346, implementations:114
67346 FuncBuilder::rest_target -> 23679, 23793
67360 FuncBuilder::bind_rest -> 23653, 23793, 25465, 66816, 66842, 67231, 67346
67409 FuncBuilder::lower_string -> 23671, 24608, 25465, implementations:114
67433 FuncBuilder::lower_radix_to_string -> 23592, 23598, 23602, 23610, 24608, 55873, 80262
67533 FuncBuilder::lower_number_method -> 23653, 23671, 25465, 29693, 52077, 54077, 67433, 67689, numeric_arguments:168
67604 FuncBuilder::lower_to_integer_or_infinity -> 23580, 23592, 23598, 23610, 24608
67689 FuncBuilder::lower_fixed_to_string -> 23592, 23598, 23602, 23610, 24608, 55873, 67604, 80262
67774 FuncBuilder::lower_method_call -> 23653, 23679, 23994, 23999, 25465, 29081, 29477, 67841, 68082, 71517, 71558, access:37, access:139, access:247
67841 FuncBuilder::lower_optional_method_call -> 54077, 62369, 63250, 64049, 68082
67871 FuncBuilder::own_property_call -> 29081, 67921
67921 FuncBuilder::lower_has_own_property -> 736, 23671, 24608, 25465, 41470, 41485, 47497, 47564, implementations:114
67993 FuncBuilder::call_on_native -> 29081, 41647, 45203, 68051, 70996, 71024, 71957, 72138, 72195, 72211, 72524, 72624, 72647, 79459
68051 FuncBuilder::program_objc_field_call -> 23671, 23679, 24583, 24608, 24615, 27584, 29081, 79169, 79439
68082 FuncBuilder::lower_method_on -> 817, 23653, 29293, 34136, 43003, 52077, 57413, 67533, 67871, 67993, 68267, 68323, 68475, 68708, 69068, 69179, 69596, 80717, 80888, 83036, 84066, 84234, implementations:114
68267 FuncBuilder::registered_class_method_call -> 14296, 23653, 23679, 23793, 29281, 70001, 75066, implementations:114
68323 FuncBuilder::no_method_table -> 20319, 23653, 25465
68362 FuncBuilder::lower_new_data_view -> 23671, 24608, 25465, 29693, 44791, 54077, 58657, 60303, 69367, 69380, 69485
68451 FuncBuilder::data_view_property -> 23671, 25465, 44791
68475 FuncBuilder::lower_data_view_method -> 23671, 25465, 29081, 29693, 44791, 54077, 60303, 68612, 69439
68612 FuncBuilder::endianness -> 24608, 29693, 54077
68628 FuncBuilder::join_separator -> 23671, 24608, 25465, 54077, 63311, 63997, 64049
68675 FuncBuilder::lower_method_arguments -> numeric_arguments:105, numeric_arguments:168
68708 FuncBuilder::lower_view_method -> 817, 29081, 29293, 57413, 68781, 84234, implementations:114
68747 FuncBuilder::view_number -> 23671, 29693, 44791, 54077
68781 FuncBuilder::lower_view_builtin -> 23671, 24608, 25465, 29693, 44791, 54077, 60147, 68628, 68747, 68904
68904 FuncBuilder::lower_view_move -> 23671, 24608, 25465, 29693, 44791, 54077
68983 FuncBuilder::table_size -> 23671, 24608, 25465
69025 FuncBuilder::symbol_property -> 23671, 24608, 25465
69068 FuncBuilder::symbol_method -> 23671, 24608, 25465, 29081
69107 FuncBuilder::any_view_property -> 25465, 69127
69127 FuncBuilder::view_property -> 23671, 25465, 44791
69149 FuncBuilder::buffer_property -> 23671, 25465, 44791
69179 FuncBuilder::lower_buffer_method -> 23671, 24608, 25465, 29081, 29693, 44791, 54077, 60256, 60303, 69309, 69505, 69519, 69542, native_memory:11
69309 FuncBuilder::refuse_when -> 23592, 23598, 23602, 23610, 55852
69342 FuncBuilder::stop_when -> 23592, 23598, 23610, 23671, 24608, 80262
69367 FuncBuilder::guard_view_attached -> 23671, 44791, 69309
69380 FuncBuilder::guard_view_window -> 23671, 24608, 44791, 69309
69439 FuncBuilder::guard_view_access -> 23671, 24608, 44791, 69309
69485 FuncBuilder::guard_view_allocated -> 23671, 24608, 69309
69505 FuncBuilder::guard_attached -> 23671, 44791, 69309
69519 FuncBuilder::guard_resizable -> 23671, 24608, 44791, 69309
69542 FuncBuilder::guard_within_maximum -> 23671, 24608, 44791, 69309
69596 FuncBuilder::lower_date_method -> 23671, 25465, 29081, 44791
69646 FuncBuilder::no_such_callee -> 1222, 1230, 23618, 23653, 24621, implementations:114
69731 FuncBuilder::lower_call -> 11041, 15094, 23653, 23679, 23793, 24512, 24542, 24681, 24704, 25402, 25416, 25465, 25503, 29081, 29565, 31756, 32330, 42583, 48133, 58657, 60453, 62060, 62071, 62339, 65131, 65187, 67774, 69646, 70001, 71047, 72138, 72524, 75066, 75703, 76128, 76185, 78186, 78528, 78537, 78623, 80066, 84693, implementations:114
70001 FuncBuilder::finish_call -> 70015
70015 FuncBuilder::finish_call_typed -> 23671, 24583, 24608, 24615, 35505, 35639, 70172, 70289, 70850, 73252, 73383, 73520, 73792, 73979, 77948, implementations:114
70172 FuncBuilder::exact_as_number -> 23592, 23598, 23602, 23610, 23671, 24608, 55852
70236 FuncBuilder::throw_on_failure -> 23592, 23598, 23610, 24608, 70763, 73979, 80262
70289 FuncBuilder::finish_hresult_call -> 23671, 24583, 24608, 25465, 29693, 52468, 57885, 70236, 70414, 70448, 70467, 77948, 80262
70414 FuncBuilder::clear_failed_results -> 24608, 25465, 29693, 80262
70448 FuncBuilder::out_field_type -> 24583, 57885
70467 FuncBuilder::read_written -> 24583, 24608, 24615, 25465, 70686, 80262, native_memory:624, native_memory:713, native_memory:960
70686 FuncBuilder::read_received_references -> 24583, 24608, 25465, 29693, 80262
70763 FuncBuilder::throw_c_message -> 24608, 55873, 80262
70793 FuncBuilder::record_destination -> 24608
70808 FuncBuilder::closure_notify -> 24608, 80262
70831 FuncBuilder::error_slot -> 24608
70850 FuncBuilder::throw_if_reported -> 23592, 23598, 23610, 23671, 24608, 25465, 70763, 73979
70949 FuncBuilder::static_native -> 23653, 23793, implementations:114
70973 FuncBuilder::lower_static_native -> 23653, 70001, 75066, 75703, implementations:114
70996 FuncBuilder::native_method -> 23653, 23793, 72096, 72118, 76955, implementations:114
71024 FuncBuilder::delegated_method -> 29081, 71119, 72071, implementations:114
71047 FuncBuilder::lower_bound_global_call -> 23653, 49713, 71082, 71119, 71485, 71558, 72647
71082 FuncBuilder::window_global -> 23653, 24653, implementations:114
71119 FuncBuilder::method_of_bound -> 23653, 29253, 71166, 71687, 72118, implementations:114
71166 FuncBuilder::overload_signature -> 23653, 23679, 23793, 29253, implementations:114
71218 FuncBuilder::arguments_fit -> 24594, 71269, 71369, implementations:114
71269 FuncBuilder::lends_as -> 24594, implementations:114
71315 FuncBuilder::dictionary_member_names -> 71315, implementations:76, implementations:114
71369 FuncBuilder::record_holds -> 23679, 23793, 24594, 29081, 71315, 71369, implementations:114
71485 FuncBuilder::delegated_function -> 23653, 23793, 24653, implementations:114
71517 FuncBuilder::delegated_static -> 23653, 23793, 24653, 29081, implementations:114
71558 FuncBuilder::lower_delegated_call -> 25465, 70001, 71595, 71957, 75066, 75703, implementations:114
71595 FuncBuilder::overload_by_arguments -> 23653, 29253, 71166, 71687, implementations:114
71622 FuncBuilder::refuse_dropped_arguments -> 25465, implementations:114
71660 FuncBuilder::as_written -> 23653
71687 FuncBuilder::shortest_fit -> 24594, 71660, 71810, 71894, implementations:114
71810 FuncBuilder::call_fits -> 23793, 71218, 71859, 71894
71859 FuncBuilder::is_scalar_type -> implementations:114
71894 FuncBuilder::dictionary_spread -> 23679, 23793, 29081, 78640
71957 FuncBuilder::spread_for -> 71894
71972 FuncBuilder::delegated_constructor -> 23653, 23793, 29253, 71166, 71687, implementations:114
72048 FuncBuilder::lower_delegated_construction -> 70001, 71622, 71957, 75066, 75703, implementations:114
72071 FuncBuilder::delegated_type -> implementations:114
72096 FuncBuilder::objc_protocol_member -> 23793, 72101
72101 FuncBuilder::declaring_protocol -> 23653, 23793
72118 FuncBuilder::is_native_instance_method -> 23653, 23793
72138 FuncBuilder::called_method -> 23653, 23793, 25391, 25465, 76955, 78472, implementations:114
72195 FuncBuilder::program_objc_method -> 14296, 23793, 78476, implementations:114
72211 FuncBuilder::lower_program_objc_call -> 1125, 23679, 23793, 24583, 24594, 24615, 25465, 25705, 29281, 29693, 48928, 54077, 72295, 72354, 73733, 77948, 78476, implementations:114
72281 FuncBuilder::own_method -> 14296, 23679, 23793, 29281, implementations:114
72295 FuncBuilder::objc_dispatch -> 72281, implementations:114
72354 FuncBuilder::dispatch_objc_call -> 23592, 23598, 23671, 24608, 25465, 72449, 72470, 89964
72449 FuncBuilder::objc_class_value -> 23671, 24608, 25465, implementations:114
72470 FuncBuilder::objc_arm -> 1125, 23580, 23592, 23598, 23610, 23671, 24594, 24608, 24615, 25705, 77948, implementations:114
72524 FuncBuilder::lower_called_method -> 23679, 23793, 24583, 25465, 29693, 36056, 48928, 72600, 77948, 78472
72600 FuncBuilder::is_constant -> 23679, 23793, 72600
72624 FuncBuilder::lower_native_method_call -> 72647, implementations:114
72647 FuncBuilder::lower_native_method_call_as -> 14175, 23653, 23872, 24583, 24594, 24615, 25465, 57413, 70015, 71622, 72785, 72801, 72816, 72901, 73018, 73120, 73171, 75066, 75703, 76094, 76554, 76955, implementations:114
72785 FuncBuilder::bound_arguments -> 75066
72801 FuncBuilder::sequence_for_array -> 24583, 24594, 45177
72816 FuncBuilder::array_of_sequence -> 23598, 23671, 24594, 24608, 25465, 29693, 39496, 39642, 39691, 43809, 43904, 45162, 45177, 45248, 45356
72901 FuncBuilder::lower_gobject_emit -> 13477, 13992, 25465, 29233, 54077, 57413, 70001, 75279, 75703, 76554, implementations:114
73018 FuncBuilder::lower_event_listener -> 23671, 24608, 25465, 36094, 70236, 74558, 74609, 80262, implementations:114
73120 FuncBuilder::via_receiver -> 4120, 23653, 23671, 25465, 74558, 80262
73171 FuncBuilder::release_via -> 23671, 80262
73179 FuncBuilder::send_bridge -> 24608
73198 FuncBuilder::ns_array_of -> 25465, 80262
73225 FuncBuilder::ns_dictionary_of -> 25465, 80262
73252 FuncBuilder::read_ns_array -> 23580, 23592, 23598, 23610, 23671, 24608, 25465, 29693, 73179, 80262, 90001
73332 FuncBuilder::foundation_collection -> 25465, 73198, 73225, 73359
73359 FuncBuilder::ns_set_of -> 25465, 80262
73383 FuncBuilder::read_ns_set -> 23580, 23592, 23598, 23610, 23671, 24608, 25465, 46024, 73179, 73252, 80262, 80280, 90001
73520 FuncBuilder::read_ns_dictionary -> 23580, 23592, 23598, 23610, 23671, 24608, 25465, 29693, 46024, 73179, 80262, 80280, 90001
73690 FuncBuilder::label_argument -> 23671, 25465, 29693, 73332, 73776, 73954, 74398
73733 FuncBuilder::label_value -> 23671, 24608, 25465, 57885
73776 FuncBuilder::ns_string_of -> 80262
73792 FuncBuilder::read_native_string -> 23671, 24583, 24608, 24615, 80262
73906 FuncBuilder::lend_string_argument -> 25465, 73954
73954 FuncBuilder::lend_string -> 24608, 80262
73979 FuncBuilder::give_back -> 23671, 24608, 80262, native_memory:557
74099 FuncBuilder::bridge_closure -> 24608, 25465, 74145
74145 FuncBuilder::with_conversions -> 4293, 24594, 74256, 74282, closure_context:76, implementations:114
74282 FuncBuilder::sequence_type_of -> 45177, implementations:114
74294 FuncBuilder::lower_reject_error -> 23610, 23671, 24608, 35989, 55914, 80262
74346 FuncBuilder::lower_conversion -> 23610, 23671, 24608, 35989, 70172, 74372
74372 FuncBuilder::lower_sequence_array -> 23610, 23671, 24594, 24608, 24615, 35989, 72816
74398 FuncBuilder::lend_block -> 23580, 23592, 23598, 23610, 24608, 74099, 80262
74476 FuncBuilder::reference_tags -> 23653, 25465
74493 FuncBuilder::hresult_shape -> 23653, 25465
74520 FuncBuilder::hresult_slot -> 24608
74558 FuncBuilder::iid_arguments -> 24608
74577 FuncBuilder::box_argument -> 29693, 80262
74609 FuncBuilder::delegate -> 24608, 25465, 74099, 74558, 80262
74664 FuncBuilder::lend_bytes -> 20319, 23671, 25465, 74705
74705 FuncBuilder::borrow_bytes -> 24608, 74987, 80262
74729 FuncBuilder::lend_hstrings -> 24608, 74987, 80262
74746 FuncBuilder::lend_array -> 23671, 25465, 74729, 74801, native_memory:359, native_memory:445, native_memory:499, native_memory:518
74801 FuncBuilder::lend_strings -> 80262
74816 FuncBuilder::lend_handles -> 24608, 25465, 74558, 74987, 80262
74878 FuncBuilder::bounded_counts -> 23592, 23598, 23602, 23610, 23671, 24608, 55852, 74955
74955 FuncBuilder::array_count -> 24608, 74987, 80262
74987 FuncBuilder::unless_null -> 23580, 23592, 23598, 23610, 24608
75030 FuncBuilder::lower_written_arguments -> 36094, 36127
75066 FuncBuilder::lower_call_arguments -> 75030, 75101, 75167, 75279
75101 FuncBuilder::lower_dictionary_slots -> 36157, 36807, 75167, 75279, 88211
75140 FuncBuilder::place_receiver -> 25465, 29693
75167 FuncBuilder::mark_literals -> 23793
75201 FuncBuilder::lower_labels -> 23653, 23671, 23793, 24583, 24608, 24615, 25465, 54077, 75266, 85097, 85219, 85771
75266 FuncBuilder::syntax_children_of -> 23679, 23793, 75266
75279 FuncBuilder::native_arguments -> 23671, 29693, 35566, 70793, 70808, 70831, 73332, 73690, 73733, 73776, 73906, 74099, 74398, 74520, 74577, 74609, 74664, 74746, 74816, 74878, 75140, 75545, 75649, native_memory:287, native_memory:838
75545 FuncBuilder::lend_context -> 80262
75568 FuncBuilder::bridged -> 23671, 24608, 25465, 75622
75622 FuncBuilder::null_function_pointer -> 23671, 24608
75649 FuncBuilder::bridge_callback_arguments -> 23671, 24608, 25465, 74145, 75622
75703 FuncBuilder::native_callee -> 75733
75713 FuncBuilder::native_callee_sending -> 75733
75733 FuncBuilder::native_callee_with -> 23653, 25465, 36838, 74476, 74493, 75948, 76204, 76311, 76394, 78472, 90031, 90053, 90218, implementations:114, native_memory:1495
75948 FuncBuilder::slot_of -> 75985, 76062
75985 FuncBuilder::vtable_of -> 23653, 23793, 25465, 72118, 76062, 78472
76062 FuncBuilder::factory_of -> 23653, 25465
76094 FuncBuilder::lower_query -> 23671, 24594, 24615, 25465, 74558, 80262
76128 FuncBuilder::activation_call -> 23653, 76144, implementations:114
76144 FuncBuilder::lower_activation -> 23671, 24594, 24608, 24615, 25465, 74558, 80262
76185 FuncBuilder::factory_receiver -> 23671, 24608, 74558, 80262
76204 FuncBuilder::declared_names -> 23653, 23675
76232 FuncBuilder::objc_class_object -> 23653, 23671, 23793, 24608, 25465, 76204, 77774, implementations:114
76311 FuncBuilder::make_call -> 76329, 90131, implementations:114
76329 FuncBuilder::make_message -> 25465, 77800, 90068, 90131, implementations:114
76394 FuncBuilder::refuse_unbridged -> 25465
76422 FuncBuilder::objc_property -> 23653, 23793, 57413, 76502, 76554, 76570, 76665, 76955, 77774, implementations:114
76502 FuncBuilder::declared_by_an_interface -> 23653, 23793
76554 FuncBuilder::present_part -> 20624, implementations:114
76570 FuncBuilder::property_selectors -> 4108, 23653, 23679, 23793, 29281, 76570, 76665, 76676
76630 FuncBuilder::call_program_accessor -> 23671, 24583, 24608, 24615, 25465, 25705, 29281, 78476
76665 FuncBuilder::program_objc_accessor -> 23793, 78476, implementations:114
76676 FuncBuilder::overridden_property -> 23679, 23793, 28024, 29281, 76955, 78476
76696 FuncBuilder::lower_objc_property_get -> 54077, 76422, 76714
76714 FuncBuilder::read_objc_property -> 23653, 23671, 25465, 62228, 63250, 76630, 76665, 76778, 76789, 76834, implementations:114
76778 FuncBuilder::optional_requirement -> 23679, 23793, 72101
76789 FuncBuilder::send_objc_getter -> 23679, 23872, 24594, 24615, 57413, 70015, 75066, 75713, 76554, 76778, 89894, implementations:114
76834 FuncBuilder::read_native_variable -> 25465, 70015, 75703, 89894
76865 FuncBuilder::lower_objc_property_set -> 23671, 23679, 23793, 24583, 24608, 24615, 25465, 48928, 54077, 57413, 70001, 75066, 75713, 76422, 76630, 76665, 76937, 89894, implementations:114
76937 FuncBuilder::void_type -> 23671, implementations:114
76955 FuncBuilder::objc_class_member -> 23653, 23793, 76984, 77774
76984 FuncBuilder::merged_objc_class -> 23653, 23679, 23793, implementations:114
77002 FuncBuilder::lower_com_new -> 2253, 23671, 23679, 23793, 24583, 25465, 27110, 58657, 70001, 75066, 77067, 77122, 78476, implementations:114
77067 FuncBuilder::lower_com_construct -> 23653, 58657, 70001, 75066, 75703, 76144, 76185, implementations:114
77122 FuncBuilder::constructed_class -> 23653, 23679, 23793, 24653, implementations:114
77136 FuncBuilder::lower_objc_new -> 23653, 23671, 23793, 24583, 24608, 24615, 25465, 36094, 58657, 70001, 75066, 75733, 76955, implementations:114
77264 FuncBuilder::lower_objc_instanceof -> 23671, 23793, 24608, 25465, 54077, 89964, implementations:114
77323 FuncBuilder::lower_gobject_instanceof -> 23580, 23592, 23598, 23610, 23671, 24608, 25465, 49672, 54077, 77727, implementations:114
77456 FuncBuilder::lower_bound_instanceof -> 23580, 23592, 23598, 23610, 23671, 24608, 25465, 54077, 77547, 89964
77547 FuncBuilder::bound_instance_test -> 23653, implementations:114, native_memory:1495
77577 FuncBuilder::lower_boxed_instanceof -> 23671, 24608, 25465, 35528, 49672, 54077, 77623, 80262
77623 FuncBuilder::boxed_asked -> 23679, 23793, implementations:114
77655 FuncBuilder::lower_com_instanceof -> 23653, 23671, 23793, 25465, 29253, 29693, 54077, 74558, 80262, implementations:114
77727 FuncBuilder::call_gtype -> 23671, 24608, 49672, 89964
77756 FuncBuilder::gtype_read -> 23653, 24653, 29081, 77727, implementations:114
77774 FuncBuilder::in_objc_module -> 23653, 23793, implementations:114
77800 FuncBuilder::objc_send -> 23653, 23793, 25465, 76955
77948 FuncBuilder::push_call -> 23671, 24583, 24608, 24615, 25465, 77919, 78034
78034 FuncBuilder::test_for_a_raise -> 23592, 23598, 23610, 23671, 24583, 65247, 78103
78103 FuncBuilder::emit_the_raise_test -> 23592, 23598, 23610, 24608, 80218, 80262
78186 FuncBuilder::direct_callee -> 23653, 23793, 78255
78255 FuncBuilder::initializer_settles -> 8929, 23679, 23793, 78330, 78351, 78396, 78423
78330 FuncBuilder::variable_kind -> 23653, 23737, 23793
78351 FuncBuilder::aliased_to -> implementations:114
78396 FuncBuilder::decided_arm -> 23793, 48942, 53053
78423 FuncBuilder::named_function -> 23653, 23793, 78351
78453 FuncBuilder::static_method_name -> 2971, 14296, 23793, 78476, 78488, implementations:114
78472 FuncBuilder::declared_name -> 18416, implementations:114
78476 FuncBuilder::enclosing_class -> 23653, 23793
78488 FuncBuilder::class_name -> 1053, 1125, 23653, 23679, 23793, implementations:114
78528 FuncBuilder::declaring_class_name -> 78476, 78488
78537 FuncBuilder::lower_static_call -> 2971, 23675, 24453, 24583, 24615, 25465, 29281, 36094, 65131, 70001, 72138, 72524, 75066, 75703, 76955, 77948, implementations:114
78623 FuncBuilder::lower_closure_call -> 54077, 79169
78640 FuncBuilder::cannot_have_effects -> 23793
78661 FuncBuilder::function_type_of_receiver -> 18575, 23653, 23679, implementations:114
78683 FuncBuilder::through_call_or_apply -> 23679, 25185, 31321, 78661, implementations:114
78705 FuncBuilder::lower_call_with_receiver -> 78750, 79169
78750 FuncBuilder::lower_this_argument -> 29693, 48928
78762 FuncBuilder::closure_callee -> 65161, 78777
78777 FuncBuilder::closure_entry -> 25465
78815 FuncBuilder::known_reference_path -> 4293, 24594, 36944, 65161, closure_context:76, generic_values:318, implementations:114, uniform_inputs:65
78862 FuncBuilder::lower_apply_with_receiver -> 25465, 78750, 78903
78903 FuncBuilder::apply_through_closure -> 23671, 24594, 24608, 25465, 36747, 37088, 37127, 37644, 78762, 78957, 79213
78957 FuncBuilder::apply_positionally -> 23679, 23793, 24594, 24615, 25465, 30846, 30927, 36983, 48928, 54077, 78762, 78815, 79059, 79213, 87281, implementations:114
79059 FuncBuilder::read_a_position -> 23671, 24608, 25465, 79141
79120 FuncBuilder::tuple_field_at -> 57885
79141 FuncBuilder::read_a_struct_position -> 23671, 24608, 25465, 79120
79169 FuncBuilder::call_through_closure -> 36114, 36944, 38289, 78762, 79213, implementations:114
79213 FuncBuilder::finish_closure_call -> 24220, 24453, 24583, 24615, 79251
79251 FuncBuilder::call_a_closure_entry -> 4528, 4534, 23671, 24608, 78034, 79399, 79475, closure_context:76
79399 FuncBuilder::erase_uniform_argument -> 18885, 23671, 24608, 29713, implementations:114
79439 FuncBuilder::check_this_is_passed -> 25465, closure_context:76
79459 FuncBuilder::inlines_as_a_callback -> 23793, 28580
79475 FuncBuilder::erased_this -> 23671, 24608, 29693
79485 FuncBuilder::intrinsic_of -> 23653, 23793, 25185, 87951
79545 FuncBuilder::console_method -> 23653, 23793, 25185, implementations:114
79580 FuncBuilder::lower_console -> 23671, 23793, 24608, 25465, 51856, 51928, 54077, 79653, 79723, 80262
79653 FuncBuilder::may_format -> 23653, 23679, 23793, 79653, implementations:114
79723 FuncBuilder::inspected -> 23671, 24608, 24621, 25465, 51856, 52077, 52223, 63311, 79723, 80262
79846 FuncBuilder::lower_parse_int -> 23671, 24608, 25465, 29693, 80262, numeric_arguments:105, numeric_arguments:168
79893 FuncBuilder::lower_parse_float -> 23671, 25465, 29693, 54077, 80262
79913 FuncBuilder::lower_uri -> 23592, 23598, 23602, 23610, 23671, 24608, 25465, 29693, 54077, 55852, 80262
79986 FuncBuilder::lower_set_timer -> 23671, 24583, 24608, 25465, 54077, 80262
80046 FuncBuilder::lower_clear_timer -> 23671, 25465, 54077, 80262
80066 FuncBuilder::lower_provided_builtin -> 23671, 24608, 25465, 44706, 52077, 54077, 64276, 64526, 79846, 79893, 79913, 79986, 80046, 80262, 80471, 88004, 88015
80218 FuncBuilder::raised_return -> 24608
80262 FuncBuilder::runtime_call -> 24608
80280 FuncBuilder::keyed_call -> 24608, 80262
80302 FuncBuilder::exponentiate -> 23671, 24608, 80262, 80347, 80411
80347 FuncBuilder::bigint_range_error_if -> 23592, 23598, 23602, 23610, 23671, 24608, 55873
80382 FuncBuilder::require_bigint_divisor -> 23671, 24608, 80347
80411 FuncBuilder::fold_power -> 24608
80471 FuncBuilder::lower_intrinsic -> 23671, 24583, 24608, 24615, 25465, 55733, 80262, numeric_arguments:150
80621 FuncBuilder::fold_string_call -> 24608, 80262
80717 FuncBuilder::lower_string_method -> 23671, 24583, 24608, 25465, 29443, 55549, 55673, 68675, 80621, 81348, claimed_reads:214, numeric_arguments:78, string_positions:12
80888 FuncBuilder::lower_array_method -> 22293, 22440, 23671, 23793, 24583, 24608, 25465, 29443, 44791, 54077, 55530, 68628, 68675, 81120, 81315, 81655, 82293, 82509, 82551, 82595, 83116, 83387, 89841, claimed_reads:214
81120 FuncBuilder::lower_pushes -> 23671, 23793, 24608, 25465, 29693, 48928, 81208, 81232
81208 FuncBuilder::spread_source -> 23671, 23679, 24608, 25465, 54077
81232 FuncBuilder::append_each -> 23580, 23592, 23598, 23610, 23671, 24608, 29693
81315 FuncBuilder::iteration_arguments -> 25465
81348 FuncBuilder::code_point_or_undefined -> 23580, 23592, 23598, 23610, 24608
81401 FuncBuilder::receiver_of_member -> 23679, 23718
81443 FuncBuilder::null_slot -> 24608, 81462, 87281
81462 FuncBuilder::null_only_element -> 20624, 81462, implementations:114
81508 FuncBuilder::refuse_holes_that_read_as_null -> 23653, 23679, 23718, 23793, 25465, 58657, 59106, 81462, 81574, 81594, implementations:114
81574 FuncBuilder::untyped_array -> implementations:114
81594 FuncBuilder::hole_context -> 23679, 23718, 23793, 58657, implementations:114
81655 FuncBuilder::lower_sort -> 23671, 24608, 25465, 44791, 81401, 81443, 81710
81710 FuncBuilder::lower_sort_with -> 23671, 24608, 25465, 44791, 54077, 78762, 81401, 81835, 81934, 82160, 82243, 82277, 87281, 89862, implementations:114
81835 FuncBuilder::sort_indices -> 23598, 24608, 39496, 39642, 39691, 48936
81892 FuncBuilder::sort_element -> 24608
81934 FuncBuilder::merge_passes -> 23598, 24608, 39496, 39642, 39691, 48936, 82018
82018 FuncBuilder::merge_pair -> 4558, 23580, 23592, 23598, 23610, 24608, 29693, 39496, 39642, 39691, 48936, 79251, 81892
82160 FuncBuilder::write_back -> 23592, 23598, 23610, 24608, 39496, 39642, 39691, 44791, 48936, 81892
82243 FuncBuilder::sorted_may_hold_undefined -> 23653, 23679, implementations:114
82277 FuncBuilder::comparator_signature -> 24594, implementations:114
82293 FuncBuilder::lower_array_with -> 23671, 24608, 25465, 29693, 82353, 82425, 89841, numeric_arguments:105, numeric_arguments:168
82353 FuncBuilder::array_with_index -> 23671, 24608, 63311, 69309
82425 FuncBuilder::copy_array_with_value -> 23580, 23592, 23598, 23610, 24608, 39496, 39642, 39691, 48936
82509 FuncBuilder::lower_to_reversed -> 23671, 24608, 44791, 89862
82551 FuncBuilder::lower_erased_array_method -> 25465, 81120
82595 FuncBuilder::lower_reference_array_method -> 23671, 24608, 25465, 55530, 68628, 68675, 81120, 81401, 81443, 81462, 81655, 82509, 87281, 89862
82742 FuncBuilder::lower_new_table -> 23671, 24608, 58657, 82922
82797 FuncBuilder::pair_shape -> 25465, 57885
82830 FuncBuilder::table_insertion_arguments -> 24608, 30441, 46024
82891 FuncBuilder::written_halves -> implementations:114
82922 FuncBuilder::fill_table_from -> 23580, 23592, 23598, 23610, 24608, 25465, 48928, 54077, 80280, 82797, 82830, 82891
83036 FuncBuilder::lower_table_method -> 23671, 25465, 28722, 29081, 41530, 46068, 54077, 79459, 80262, 80280
83116 FuncBuilder::lower_wide_fill -> 23671, 24608, 25465, 29693, 48928, 89841, 89862
83199 FuncBuilder::bind_step -> 24608
83288 FuncBuilder::still_walking -> 24608
83321 FuncBuilder::reduce_start -> 23671, 24608, 55586
83387 FuncBuilder::lower_iteration -> 23598, 23671, 24608, 25465, 39496, 39642, 39691, 48936, 79459, 83199, 83288, 83321, 83492, 83532, 83584, 83647, 83791, 83829, 83978
83492 FuncBuilder::lower_callback_body -> 23602, 23793, 25465, 53877, 54077, 83662
83532 FuncBuilder::iteration_result -> 24583, 24608, 24615, 80262, 89841, 89862
83584 FuncBuilder::iteration_result_array -> 24583, 24608, 24615, 80262
83647 FuncBuilder::carried_across -> 38915, 39079
83662 FuncBuilder::deliver -> 23671, 24608, 25465, 64276, 83764, 83893, 83927
83764 FuncBuilder::append_callback_value -> 23671, 25465, 29693, 40421, 40449
83791 FuncBuilder::iteration_delivery -> 89841
83829 FuncBuilder::iteration_answer -> 24608, 25465, 48936
83893 FuncBuilder::keep_element -> 23592, 23598, 23610, 23671, 80262
83927 FuncBuilder::stop_early -> 23592, 23598, 23610, 39673, 39865
83978 FuncBuilder::callback_shape -> 22586, 23679, 25465, 84015
84015 FuncBuilder::callback_parameters -> 23653, 23679, 23793, 25465
84047 FuncBuilder::admits_absence -> 20624, implementations:114
84066 FuncBuilder::open_call -> 817, 29321, 29443, 57413, 57885, 84148, 84548, implementations:114
84148 FuncBuilder::chain_of_calls -> 23580, 23592, 23598, 23610, 23671, 24583, 24608, 24615, 36114, 57372
84234 FuncBuilder::lower_object_method -> 23653, 23671, 23679, 24453, 24583, 24608, 24615, 25465, 29293, 29340, 29443, 34515, 44163, 44344, 56086, 57885, 62981, 63018, 77919, 78034, 78661, 78705, 78862, 79169, 84047, 84509, 84532, 84548, callable_fields:76, callable_fields:89, implementations:114
84486 FuncBuilder::signature_behind_any -> 29321, 84532, implementations:114
84509 FuncBuilder::method_arguments -> 24594, 36114, 36913, 84486
84532 FuncBuilder::member_declaration -> implementations:114
84548 FuncBuilder::callee_for -> 29340, 65131, 84574
84574 FuncBuilder::method_callee -> 817, 906, 942, 23675, 25465, 57885, 65323, implementations:114
84659 FuncBuilder::lower_static_super -> 23671, 24583, 24608, 24615, 36094
84693 FuncBuilder::lower_super -> 817, 900, 23671, 24583, 24608, 25465, 26746, 36114, 56859, 57014, 58784, 65131, 68781, 76955, 78034, 84659, 84877, 84912, 84926, 84956, implementations:114, made_instance:213, made_instance:469
84877 FuncBuilder::constructorless_ancestors -> 774
84912 FuncBuilder::initialize_own_fields -> 37298, 58784
84926 FuncBuilder::lower_objc_super -> 23679, 25465, 72624, 78476, implementations:114
84956 FuncBuilder::com_super_call -> 25465, 84977, 84999
84977 FuncBuilder::overridable_target -> 23653, implementations:114
84999 FuncBuilder::lower_com_super -> 23671, 23679, 25465, 72624, 74558, 80262
85039 FuncBuilder::base_class -> 1053, 1125, implementations:114
85052 FuncBuilder::lower_identifier -> 23653, 23671, 24608, 25465, 28722, 31680, 35908, 36438, 66127, 85219, 85534, initialization:183
85097 FuncBuilder::shorthand_value_symbol -> 3144, 25465, closure_context:76, implementations:114
85181 FuncBuilder::native_constant -> 23671, 24608
85203 FuncBuilder::string_constant -> 23671, 24608
85219 FuncBuilder::lower_named_value -> 3144, 4142, 23653, 23671, 24583, 24608, 24653, 24726, 25248, 25465, 25503, 28722, 31428, 31680, 35908, 35968, 49713, 50300, 71082, 76232, 85452, closure_context:76, implementations:114, layout_collection:372
85452 FuncBuilder::token_base -> 57739, implementations:114, layout_collection:349
85534 FuncBuilder::lower_absent -> 23793, 85557, 85771
85557 FuncBuilder::absent_at -> 23671, 24608, 25465, 57739, 57885
85626 FuncBuilder::declared_field_type -> 23679, 23718, 24583, 29081, 63208, 85675, 85771, implementations:114
85675 FuncBuilder::represent_passed -> 24594, implementations:114
85686 FuncBuilder::what_the_whole_expression_is -> 24583, 63208, 63271, 85771, implementations:114
85711 FuncBuilder::what_the_declaration_holds -> 23679, 23793, 24583, 66206
85771 FuncBuilder::contextual_type -> 23679, 23718, 23793, 24385, 24583, 85626, 85675, 85686, 85711, 85771, 85953, 85970, implementations:114
85953 FuncBuilder::contextual_array_element -> 23679, 24583, 36983, 85675, 85771
85970 FuncBuilder::enclosing_callable -> 23653, 23793
86018 FuncBuilder::lower_bigint -> 20270, 23653, 23671, 24608, 25465
86070 FuncBuilder::lower_number -> 20220, 23653, 23671, 24608, 25465, implementations:114
86107 FuncBuilder::lower_void -> 23671, 23679, 24608, 25465, 54077, 85771
86143 FuncBuilder::numeric_operands -> 29693, 64465
86240 FuncBuilder::binary_op_for -> 20751, 25465, 63934
86298 FuncBuilder::element_says_nothing -> implementations:114
86319 FuncBuilder::erased_equality_operands -> 24594, 29693, 31209, implementations:114
86411 FuncBuilder::relational_operands -> 25465, 86453, 86691, 87076
86453 FuncBuilder::ordinary_to_primitive -> 23671, 24608, 25465, 29360, 52077, 86538, iterator_calls:424, iterator_calls:458
86538 FuncBuilder::conversion_member -> 25465, 44684, 44689, 57885, 62981, 86648, 86659, iterator_calls:30, iterator_calls:270
86648 FuncBuilder::a_holder_declares_value_of -> 804, iterator_calls:247
86659 FuncBuilder::answers_a_primitive -> 46264, 86659, implementations:114
86700 FuncBuilder::cast_member_presence -> 23671, 23679, 23793, 24608, 29081, 31303, 36452, 36456, 47392, implementations:114
86792 FuncBuilder::lower_binary -> 23679, 23793, 25465, 54077, 86870, 86984
86870 FuncBuilder::lower_binary_special -> 23671, 23793, 24608, 47048, 47760, 49001, 51976, 54077, 63743, 63812, 63901, 64129, 86700, 87550, 87619, 87804, 87839
86984 FuncBuilder::lower_binary_values -> 23671, 23793, 24583, 24608, 24615, 25465, 52077, 52844, 63693, 63714, 80302, 80382, 86143, 86240, 86319, 86411, 86453, 87791, bigint:6, equality:27
87076 FuncBuilder::agree_on_one_integer_width -> 23671, 24608
87124 FuncBuilder::bound_type -> 23653, 23793, 24653
87171 FuncBuilder::pointer_absence_test -> 23671, 24608, 54077
87202 FuncBuilder::absence_the_type_decides -> 23671, 24583, 24608, 25465, 54077, 63997, 87124, 87171, 87270, 87751
87270 FuncBuilder::only_absences -> 63208, 87281
87281 FuncBuilder::read_type -> 23653, 23679, 23793, 29293, 49832, 50038, 57413, 76554, access_families:153, access_families:719, implementations:114
87330 FuncBuilder::narrowed_past_absence -> 84047, 87281, implementations:114
87342 FuncBuilder::dereferenced -> 23653, 23679, 23793
87363 FuncBuilder::has_the_slot -> 23671, 23679, 24608, 25235, 30406, 47531, 54077, callable_fields:76, callable_fields:89, implementations:114
87469 FuncBuilder::presence_operand -> 23679, 23793, 36452, implementations:114
87550 FuncBuilder::optional_method_presence -> 23671, 23679, 23793, 24608, 29293, 62267, 87363, 87469, implementations:114
87619 FuncBuilder::erased_absence_test -> 23671, 23793, 24583, 24608, 36452, 54077, 87124, 87202, claimed_reads:199
87849 refused_by_name -> 87904, 87912, 87933, 87943
87904 has_finally -> 87912, 87920
87933 contains_kind -> 87912, 87943
87943 walk -> 87920, 87943
88024 named_constant -> 88037, 88060
88161 known_values -> 88161
90001 bridge_send -> 89964
90218 symbol_tagged -> 23653
```

</details>
