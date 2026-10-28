# The checker's facts: what it answers, what nts captures, what lowering trusts

2026-10-28, by tsrs with the compiler's lowering column, for the user's
direction of 2026-10-27: "we should leverage the typescript compiler and static
analysis as much and as sane we can". The rule it applies is the foundations'
"the checker first, proofs where TypeScript is unsound"
([foundations](../../foundations/README.md)). Read-only: no capture, build or
measurement was changed for it.

**Its conclusion:** most of what the checker knows is already captured. The
reach is in licensing those facts with proofs over every supplier and writer,
not in asking the checker more. Two capture gaps are concrete: tuple metadata
(optional, rest, readonly, fixed length) and the effective strictness options.

Native/capture column: source 7ec668c8eea1 (the inspected files are byte-identical to my tree). Lowering column: compiler's 976eaf0d0465 on base c7b4660a8f80, with its R-2-only readers qualified; that private source is not claimed landed. Detailed lowering note: ~/.cache/nts-scratch/compiler/checker-facts/lowering-readers.md.

| Native checker can answer | Snapshot captures | Lowering reads / trust boundary |
|---|---|---|
| Reference-site typeof, instanceof, discriminant and truthiness narrowing: Node::ty -> get_type_at_location; Symbol::ty_at; native flow.rs. | node_types at use sites, TypeKind graphs and selected signatures. No dominance/effect certificate. | type_of/narrowed/read_type, claimed_reads and access_families use it. An actual guard constrains the value tested; repeated getters, captured writes, aliases and foreign inputs still need stability/supplier proof or a runtime check/refusal. A narrowed annotation alone cannot license an unchecked payload read. |
| Literal values and literal-union domains, enum constants. | TypeKind::Literal/Union/UniqueSymbol; constants for the enum/property forms Node::constant supports. | Scalar/erased representation, bounds and constant folding read these. A literal in source is a fact about that value; an asserted or external literal type is a claim. Tag compression or range specialization needs every incoming value/writer covered. |
| Discriminated unions and narrowed member types. | Union alternatives, object properties/literal types, optional flags and use-site node_types; no sealed-union certificate. | Union/storage and supplier selection use the components. Mutable tags or wider aliases can invalidate a declared relation; there is no general proof that the checker has enumerated all runtime writers. |
| Tuple type arguments plus native optional/rest/variadic flags, fixed length and readonly. | Only TypeKind::Tuple(Vec<TypeId>): ordered element types. Optional/rest/readonly tuple metadata is not projected by tuple_elements. | Tuple/position representation and constant-index reads use the vector. A declared tuple is not an invariant runtime length through mutation/casts. This is a concrete metadata gap, relevant to rest/destructuring and native out-parameter contracts. |
| never at a reference and control-flow diagnostics. | TypeKind::Never and AST syntax; no exhaustive or unreachable CFG certificate. | Never/Evolving handling, HIR branches and explicit literal-case coverage. A never type reached through an unsound assertion is not proof that execution cannot arrive there; lowering/verification must establish that. |
| Flow assignment reasoning and definite-assignment diagnostics; internal is_symbol_assigned_definitely is not an exported per-read proof. | Initializers, declarations and syntax; no initialized-before-this-use proof field. | initialization/TDZ analyses and field Ready analysis establish limited source facts independently. A definite-assignment assertion supplies no write. Ready's R-2 consumers are qualified by the compiler note; it is not a claim that all L4 uninitialized reads are repaired. |
| const declarations, literal inference and assignment information. | Variable-kind flags, declaration modifiers and separate constant values; no general assigned-once certificate. | Actual declaration/initializer and reassignment scans choose bindings, closure cells and module readiness. const fixes a binding, not its object's contents; const, single assignment and initialization-before-use are distinct facts. |
| #private names/brands and TS private visibility. | PropertyKey::Private distinct from ordinary names, private-identifier syntax and declaration identity; PRIVATE modifier separately. | Private member identity/layout/brand paths use these. #private has runtime identity; TS private is visibility metadata on an ordinary JS property. Neither alone proves uniqueness, non-escape or absence of internal writers. |
| Semantic readonly, including mapped types, and readonly index signatures. | PropertyRecord.readonly, IndexSignature.readonly and written modifier. | Writability/supplier checks use the actual semantic type, not the first shared layout. Wider mutable aliases, any and foreign code remain possible; readonly is not a runtime immutability or count-elision certificate. R-2 calls-only transport adds no writable storage. |
| Effective strictness options, including strictNullChecks, noUncheckedIndexedAccess and exactOptionalPropertyTypes. | Their effects arrive in node_types/unions and optional properties. ProjectSemantics carries only six emit-semantics booleans, not these settings. | Absence-aware claimed reads, optional storage and container access consume the resulting types. The options sharpen checking; they do not prove that a hole, missing key or unwritten field exists. Explicit effective strictness metadata would support validation of the documented strictness contract; it would not authorize unchecked reads. |
| User-defined type predicates and asserts signatures. | SignatureRecord.type_predicate keeps narrowed_to/asserts; instantiation substitutes the type. | Use-site node_types is the main route; no independent predicate-body proof is replayed. A user assertion can lie, so carrying it is not a new ownership, range or runtime-value proof. |

Reach ranking (source-based priorities, not measured gains):
1. Broadest: make existing use-site/domain facts usable under proved suppliers, actual writers and entry checks. Targets: optional/interface/union refusals, absences, instanceof, event-state and closure/module-closure rows. Most of the requested type information is already captured.
2. Broad correctness reach: expose effective strictness for validation and keep presence distinct from value type. Targets: sparse arrays, record misses, nullable collections and L4; map/array and absences families. Extra option queries do not replace initialization or writer analysis.
3. Concrete bounded metadata addition: tuple element flags/fixed/rest shape. Targets: variadic tuples, destructuring, iterator entries and native multi-return; the recorded variadic-tuple outcome is an existing witness.
4. Targeted specialization: literal-union tags/exhaustive branches, constant binding and readonly/#private writer restrictions. Investigate growth-fixed/growth-grown, array-copying-methods and closure rows only after proving the relevant writers. No population or speed movement is claimed here.

Cost of further queries:
- Existing node_types, literals, modifiers, union components and predicates need no new checker query for a lowering consumer.
- Project option scalars and already-materialized tuple flags have no IPC cost. Projecting them adds schema/storage/validation work; no time estimate was measured.
- First-time flow/type/property/signature queries can trigger lazy checking, generic instantiation and member-graph expansion. Repeating a cached handle lookup is different work from demanding a new graph.
- Capture currently charges native graph services against max(4096,16*seed_count), with three breadth levels for fresh generic declarations. New structural demands must keep the visited set and allowance, and report a partial graph rather than grow it silently.
- The next performance evidence should separate native query misses from graph/projection work using the existing per-case phase telemetry. In-process access removes transport overhead; it does not make first-time checker work free.

Sources inspected: frontend-tsrs/{semantic.rs,semantic_graph.rs,program.rs}; frontend-ts/capture/{types.rs,signatures.rs,queries.rs,graph.rs}; semantic-schema/src/schema.rs; native checker flow.rs/types.rs/options; the compiler's reader note. Current soundness policy is docs/foundations/README.md and docs/language/types.md. No implementation proposed as already validated.
