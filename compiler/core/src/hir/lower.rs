//! Lowering a semantic snapshot into HIR.
//!
//! # Scope
//!
//! Anything this lowering does not handle is refused rather than approximated.
//! Unsupported *reachable* behavior has to produce a precise diagnostic, and a
//! lowering that silently emits nothing for a statement it did not understand
//! produces a program that runs and is wrong.

use self::absence::{
    Absence, absence_of_member, absent_argument, admits_absence, holds_only_absences,
};
use self::arguments::Argument;
use self::array_methods::{Counts, counted_helper, holds_counted};
use self::assignments::{compound_operator, logical_assignment};
use self::body_entries::lower_object_literal_members;
use self::bound_functions::bound_functions;
use self::branch_values::Connective;
use self::capture_discovery::{
    Capture, ClosureInfo, ClosureSource, boxed_symbols, class_closure_variants, closure_index,
    closure_variants, collect_closures, const_alias_of, const_function_aliases, default_setter,
    function_behind_const, functions_used_as_values, guarded_symbols, not_a_plain_function,
    opaque_handle, taken_as_a_closure, widest_closure,
};
#[cfg(test)]
use self::class_members::ConstructorTargets;
use self::class_members::{
    LoweredMember, children_in_the_body_of, constructor_targets, instance_initializer,
    lower_members_of, member_copy, members_of, target_suffix, the_constructor_declared_by,
    via_callee,
};
use self::closure_bodies::{
    ClosureEntry, closure_body_name, closure_names, closure_type, erased_call_name,
    lower_wanted_closures, names_a_raising_copy, receiving_call_name, receiving_function_name,
};
pub use self::closure_bodies::{closure_class, closure_erased_method, closure_method};
use self::closure_values::{THIS_CAPTURE, cell_type};
use self::coercion::readable_back;
pub(super) use self::coercion::same_slot;
use self::construct_expressions::CONSTRUCTOR_KEY;
use self::destructuring::{Enumerated, PatternScope};
pub use self::diagnostics::describe;
use self::diagnostics::{
    ambiguous_name, an_uninstantiated_generic, attribute_nested_to_their_refused_outer,
    drop_refusals_the_program_contradicts, member_name_of, note_a_refused_function, note_member,
    note_uncompiled, refusal_by_name, refused_by_name, report_unaccounted, representation_mismatch,
    representation_word, short, spell, spelling,
};
use self::exceptions::{Edge, Exit, Handler, has_finally};
use self::expression_types::collect_view_classes;
use self::foreign_arguments::{Lent, ParameterTags};
use self::foreign_values::{StringsBridged, bridge_strings};
use self::generator_iteration::iterator_result_element;
use self::generic_copies::{
    ClassCopy, Copy, class_copies, copies_of, function_copies, generic_classes,
    is_a_generic_declaration, is_an_instantiation, is_generic_function, template_instances,
    uninstantiated,
};
use self::hierarchy::{
    Hierarchy, Written, collect_carried_protocols, collect_hierarchy, declared_base_class,
    declared_record_parent, declares_stored, foreign_class_name, record_parents,
};
use self::interfaces::{
    collect_interfaces, declaration_shell, declare_interface_methods, infer_implements,
    interface_member_of, members_filling,
};
use self::iterable_walks::{
    Binds, NativeBy, NativeWalk, Over, VectorMethods, Walk, for_each_parts,
};
use self::iteration_callbacks::{
    CallbackResult, CallbackReturn, Iteration, MethodsOf, iteration_method,
};
pub use self::literals::parse_number;
use self::literals::{
    VALUELESS_DECLARED_CONST, is_scalar, parse_bigint, parse_handle_constant, spelling_of,
};
use self::loop_flow::{Breakable, Loop, Step};
use self::member_layouts::{
    WrittenOrders, collect_stored_members, declares_or_instantiates, field_aliases,
    one_type_two_orders, written_field_orders,
};
use self::module_binding_bodies::dead_zone_reads;
use self::module_binding_types::{
    Settled, ambient_handle, closure_typed_global, global_object, is_an_unsettled_array,
    no_initializer_for_an_erased_slot, settle_by_binding, settled, settled_declaration_type,
    settled_global_type, storable, uninhabited_array, unshared_name,
};
use self::module_bindings::{
    BindingConstant, ModuleScope, Pair, binding_element_parts, collect_module_scope, declared_once,
    initialized_before_use, reassigned_anywhere,
};
pub use self::module_evaluation::evaluates_module_scope;
#[cfg(test)]
use self::module_evaluation::module_statements;
use self::module_evaluation::{
    LazyModule, ModuleRoles, add_lazy_modules, evaluation_order, initializer_function,
    is_module_statement, lower_module_initializer, mark_refused_initializers, module_evaluate_name,
    runs_a_static_initializer,
};
use self::module_exports::{
    binding_of, declaration_is_exported, declared_literal, declared_string_literal, publish_surface,
};
use self::module_namespaces::{
    dynamic_import_target, is_a_dynamic_import, module_jobs, module_namespace_of,
    module_of_namespace, namespace_of,
};
pub(super) use self::names::instantiation_suffix;
use self::names::{
    class_symbol, class_token_indices, implemented_member, is_override_name, is_static_member,
    is_static_member_symbol, member_dispatch_key, named_class_source, qualified_name,
    qualified_names,
};
use self::native_calls::{Native, bridge_send, synthesized};
use self::native_modules::{LinkTag, collect_declared_facts};
use self::native_properties::{ConstructedSetter, SetProperty};
use self::object_builtins::{literal_field_names, property_order};
pub(super) use self::object_layouts::is_signature_name;
use self::object_layouts::{
    Nameless, SHARED_BUFFER_REFUSAL, canonicalize_objects, collect_anonymous_objects,
    collect_class_identities, collect_plain_records, declares_a_class, feature_of, generated_name,
    hierarchy_class_name, instance_type_of, is_anonymous_shape, may_merge, nominal_name,
    nominal_or_stand_in, objects_in, signature_name,
};
#[cfg(test)]
use self::object_layouts::{collect_layouts, is_foreign_name, unshared_layout_name_for};
use self::operators::{bitwise_operator_of, strict_operator};
use self::parameters::{
    Omitted, ParameterNames, a_parameter_pattern_can_throw, a_pattern_that_requires_coercion,
    in_javascript, known_values, parameters_of,
};
use self::places::Place;
use self::primitive_conversion::NumberHint;
pub(super) use self::printed::settle_printer_checks;
use self::promise_reactions::reactions;
pub(crate) use self::promise_settlement::REJECT_ERROR;
use self::promise_settlement::{
    CapabilityBinding, PAIR, Settler, erased_promise, lower_reject_error, settler_symbols,
};
use self::property_presence::{AddedKeys, Declares, PRESENCE_INDEX, added_keys, presence_keys};
use self::provided_errors::provided_error_identities;
use self::raising_copies::{
    A_FUNCTION_WRITTEN_AS_A_VALUE, RAISING_SUFFIX, THROUGH_A_FUNCTION_VALUE, a_copy_can_be_made_of,
    a_declaration_that_can_raise, a_value_held_call, copyable_symbols, fill_raising_member_slots,
    raising_callees_of, raising_copies, raising_member_slots, raising_method,
    without_the_raising_suffix,
};
use self::raising_reachability::{
    Reached, Throwing, a_copy_can_contain, a_value_held_callee, calls_guarded_by_a_try,
    close_over_callees, closure_bodies_that_can_raise, names_a_body, names_a_class_element,
    raising_body_calls, the_function_of, throwing_symbols,
};
use self::receiver_binding::{A_GENERIC_DECLARATION_READING_THIS, binds_its_own_this};
use self::representations::{
    Representation, an_unchosen_collection, chooses, constant_fits, in_a_slot,
    named_representation, representation_within, slot_for,
};
pub use self::representations::{erasable, representation, representation_with};
pub(super) use self::returns::result_crosses;
use self::returns::{absent_of_result, closure_result_absent};
use self::signature_entries::{
    UniformArguments, declare_uniform_entries, disagreeing_arrivals, erased_call,
    finish_dispatch_tables, lay_out_held_signatures, needs_closure_slots, passing_undefined,
    relate_closures_to_signatures, signature_key, signature_layout,
};
use self::snapshot_queries::{
    children_that_run, collect_kind, contains_kind, declaration_initializer, direct_children,
    is_a_declaration_path, is_declaration_file, kind_at, named, names_only_a_type_parameter,
    probe_kind, provided, reads_a_name, walk,
};
use self::statement_branches::Branch;
use self::static_builtins::{Builtin, PrimitiveBuiltin, named_constant, primitive_builtin};
use self::structural_copies::{
    CallContext, Retyped, Structural, calls_in_a_default, calls_in_the_body_of, member_symbols,
    planned_callee, retyped_symbols_of, structural_instantiations, with_const_aliases,
};
use self::suspended_bodies::{
    AsyncResult, abstract_generator_kind, generator_element_type, generator_indices,
    shared_generator_result,
};
use self::table_methods::{table_fill, table_key_within, walks_pairs};
#[cfg(test)]
use self::thenable_jobs::Thenable;
use self::thenable_jobs::{Then, Thenables, module_job_fields, thenables};
use self::tuples::tuple_representation;
use self::type_tests::{expand_layout_tests, prune_class_tests};
use self::typed_arrays::{
    declares_storage, inherited_typed_array, numeric_array_method, property_branded,
};
use nts_diagnostics::{Diagnostic, Location};
use nts_semantic_schema::{
    DeclarationModifiers, HeritageKind, ImportPhase, LiteralValue, MemberKind, NodeData, NodeId,
    NodeKind, Origin, PropertyKey, PropertyRecord, SemanticSnapshot, SymbolFlags, SymbolId,
    SymbolRecord, TypeId, TypeKind, TypeRecord, syntax,
};

use super::facts::Facts;
use super::member_key::{Accessor as MethodAccessor, MemberKey};
use super::{
    Absent, ArrayFill, BinOp, Block, BlockId, Callee, Field, FieldArm, Func, GeneratorKind,
    HirType, Layout, ManagedType, Op, OpKind, Param, ParamShape, Program, Terminator, UnOp,
    ValueId, ViewClass,
};
use closure_context::SharedClosures;
use implementations::LoweringSnapshot;
use layout_collection::{BuilderLayouts, LayoutCollector};
use made_instance::{CollectedConstructor, MadeBy, ThisPaths};
use numeric_arguments::Builtin as NumericBuiltin;

/// Closures crossing the type they were written at, recorded where that is known.
///
/// **Recorded rather than checked, because the two halves of the question are
/// knowable at different times.** At a coercion the *target's* parameter and
/// return representations are in hand (`signature_key` plus `represent`) and the
/// closure's own are not: its `#call` is not lowered until
/// `lower_wanted_closures`, which runs later. So the pair is kept and compared
/// afterwards, rather than a flow analysis being built to recover a pair that was
/// thrown away.
///
/// The alternative was a points-to analysis, and `elements.rs` records why that is
/// not the answer: *"deciding which array values can reach which reads ... is a
/// points-to analysis and a much larger thing than the win here."* That judged a
/// speed win; this is a correctness one, which would justify the larger thing --
/// except that the repair is **total** where the question is not, so membership
/// answers what flow would have.
impl FuncBuilder<'_> {
    /// Drain what this body produced into the program's collections.
    ///
    /// **One method rather than an `extend` per site.** Nine places consume a
    /// finished builder and each extended `wanted` from `used_closures` alone; a
    /// second collection beside it would have been a tenth parallel `extend`, and
    /// two collections of one fact where only some sites write both is the drift
    /// this file has repaired four times in one day -- a member recorded by name
    /// and not by node, a call named from the resolved declaration and not the
    /// implementation, a class member's return declared in one list and converted
    /// from another. Adding a fifth on the way to fixing one would be a poor
    /// trade.
    fn harvest(&mut self, wanted: &mut impl Extend<usize>, arrivals: &mut Arrivals) {
        wanted.extend(self.used_closures.iter().copied());
        arrivals
            .at_signature
            .append(&mut self.arrivals.at_signature);
        arrivals.conversions.append(&mut self.conversions);
        arrivals.json_writers.append(&mut self.json_writers);
        arrivals
            .uniform_sites
            .append(&mut self.arrivals.uniform_sites);
        arrivals
            .printer_checks
            .append(&mut self.arrivals.printer_checks);
        arrivals
            .signature_flows
            .append(&mut self.arrivals.signature_flows);
        arrivals
            .opaque_arrivals
            .append(&mut self.arrivals.opaque_arrivals);
        arrivals
            .parameter_entries
            .append(&mut self.arrivals.parameter_entries);
    }

    /// The records this builder keeps by its function's name, moved to `to`:
    /// for a body renamed after it was finished, which is how a method's
    /// raising copy gets its suffix ([`raising_method`]).
    fn rename_arrivals(&mut self, from: &str, to: &str) {
        for site in &mut self.arrivals.uniform_sites {
            if site.function == from {
                to.clone_into(&mut site.function);
            }
        }
        for check in &mut self.arrivals.printer_checks {
            if check.function == from {
                to.clone_into(&mut check.function);
            }
        }
        for split in &mut self.arrivals.parameter_entries {
            if split.name == from {
                to.clone_into(&mut split.name);
            }
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct Arrivals {
    /// Parameter prefixes to hand to one body after all source bodies exist.
    parameter_entries: Vec<parameter_entries::Split>,
    /// Every closure admitted into a signature slot. See [`Arrival`].
    ///
    /// `coerce_arm`'s object-to-object arm is the only place this is visible: two
    /// signature layouts have no fields, so `not_a_prefix` finds nothing to
    /// disagree about and the pointer passes -- and the one thing that differs is
    /// the `#call` descriptor, which that predicate does not look at.
    pub at_signature: Vec<Arrival>,
    /// Functions bridges call to convert an argument C passes. See
    /// [`Conversion`].
    pub conversions: Vec<Conversion>,
    /// The writers `JSON.stringify` calls, one per type. See [`json::Writer`].
    json_writers: Vec<json::Writer>,
    /// Calls through a signature's erased entry, each named by its function
    /// once that function is finished. See [`UniformSite`].
    pub uniform_sites: Vec<UniformSite>,
    /// The same, while the function they are in is still being lowered.
    pending_sites: Vec<UniformSite>,
    /// Possible printer polls, resolved from the settled descriptor callbacks.
    printer_checks: Vec<printed::Check>,
    pending_printer_checks: Vec<printed::Check>,
    /// A value of one signature type coerced into another, `(from, to)`: every
    /// closure that can reach `from` can reach `to` this way, though no
    /// [`Arrival`] records it.
    pub signature_flows: Vec<(TypeId, TypeId)>,
    /// A signature type an object that is neither a closure nor a signature was
    /// coerced into -- a class token, a bound function: it fills no `#call` of
    /// the signature's shape, so the signature cannot be typed
    /// (`typed_signatures`).
    pub opaque_arrivals: Vec<TypeId>,
}

/// A call through a signature that took the erased entry, recorded with what a
/// typed call there would pass and read, so [`type_signature_calls`] can make
/// it one where every closure that can arrive agrees.
#[derive(Debug, Clone)]
pub struct UniformSite {
    /// The function the call is in; empty until [`FuncBuilder::finish`].
    function: String,
    /// The signature the receiver is typed as.
    signature: TypeId,
    /// The erased call.
    answered: ValueId,
    /// What the site reads: the unerase of `answered`, or `answered` itself
    /// where the site reads the erased answer or nothing.
    value: ValueId,
    /// The closure, then the arguments as the signature spells them -- the
    /// written ABI, before anything was erased or padded.
    args: Vec<ValueId>,
    /// What the site reads the answer as.
    ty: HirType,
}

/// A function a bridge calls to convert an argument C passes
/// (`Bridging::converted`): requested where the bridge is made, and made once
/// per name after every body is lowered (`lower_conversions`).
#[derive(Debug, Clone)]
pub struct Conversion {
    pub name: String,
    converts: Converts,
    /// The closure whose bridge asked, for what the function reports against.
    site: NodeId,
}

#[derive(Debug, Clone)]
enum Converts {
    /// A sequence (`length` and `item`) made the array of its items.
    SequenceArray { sequence: TypeId, array: HirType },
    /// A 64-bit integer read as a number (`AsNumber`), exactly
    /// ([`FuncBuilder::exact_as_number`]).
    ExactNumber { integer: HirType },
}

/// One closure admitted into one signature slot.
#[derive(Debug, Clone)]
pub struct Arrival {
    /// The closure's own class, which names its `#call` through its layout.
    pub closure: TypeId,
    /// The signature it was admitted into.
    pub signature: TypeId,
    /// Where it was admitted, for the diagnostic.
    pub origin: Origin,
    /// What that slot expects, **resolved at the coercion** rather than kept as a
    /// type id.
    ///
    /// The distinction is not cosmetic: a signature type inside a generic copy
    /// resolves under that copy's substitution, so the same `TypeId` is a
    /// different representation inside the copy than outside it. Recording the id
    /// and resolving later would compare the closure against a representation the
    /// slot never had -- and `representation_of` consulting `subst.instance_of`
    /// in its first lines is exactly why.
    pub parameters: Vec<Option<HirType>>,
    /// As `parameters`, for the result.
    pub returns: Option<HirType>,
    /// The scalar kind each of the slot's parameters is written as, which a
    /// call through the slot is obliged to fit -- and so all a closure in it
    /// may rely on (docs/records/notebooks/scalar-numbers.md, Q1).
    pub kinds: Vec<Option<super::native::Scalar>>,
}

/// What a lowering produced, and what it could not.
#[derive(Debug, Clone, Default)]
pub struct Lowered {
    pub program: Program,
    /// Whole-program semantic contradictions. Preparation rejects these before
    /// a backend can emit a partial program under incompatible project options.
    pub rejected: Vec<Diagnostic>,
    /// Constructs the lowering did not understand.
    ///
    /// Collected rather than returned as an error so one run reports every
    /// unsupported construct instead of the first.
    pub diagnostics: Vec<Diagnostic>,
    /// The declarations a refusal was **recorded** for, by node.
    ///
    /// `Program::uncompiled` holds the same refusals keyed by the name a caller
    /// writes, which is what a cascade needs and what the conservation law
    /// cannot ask with: [`super::unaccounted`] works in `NodeId`s. So the two
    /// were one fact in two collections, and only the top-level function loop
    /// kept the second -- a refused *member* was written into `uncompiled` and
    /// never into the set, so the law reported it as never walked.
    ///
    /// It has a second escape, and the case that gets past both is the one this
    /// exists for: `unaccounted` also accepts a declaration some diagnostic's
    /// span *covers*, which saves every member whose offending construct is in
    /// its own body. `Performance#constructor` refuses for a `WeakRef` property
    /// declared in **another file** -- `web-platform`'s listener record -- so no
    /// span covered it, and one run said both `an anonymous declaration outside
    /// every walk` at `performance.ts:123` and, forty lines down, `this
    /// module-scope statement was dropped because it calls
    /// `Performance#constructor`, which was refused above`. Two messages about
    /// one function, and one of them false. It cost the node lane hours on a
    /// mechanism that did not exist, because the message said the function had
    /// no cause.
    pub refused_at: rustc_hash::FxHashSet<NodeId>,
    /// See [`Arrivals`].
    pub arrivals: Arrivals,
    /// Globals a module statement that evaluation skips would have assigned
    /// (`NTS1005`): whatever they hold when read is not what the program
    /// computes, so [`super::drop_readers_of_unwritten_globals`] refuses their
    /// readers. A static initializer does not save one -- `export let actual =
    /// 0` reassigned by a cut `try { actual = early(3) } catch { actual = 7 }`
    /// answered 0 where node answers 3.
    pub stale_globals: rustc_hash::FxHashSet<u32>,
}

impl Lowered {
    /// Whether anything was refused.
    #[must_use]
    pub fn is_complete(&self) -> bool {
        self.diagnostics.is_empty()
    }
}

// Observe actual element clones, so the guard also detects a clone introduced
// at a different builder call site. Production keeps the derived implementation.
/// The name of the `n`th closure's class, and of its one method.
/// The function holding a module's top-level statements.
///
/// `#` cannot appear in a TypeScript identifier, which is why the qualified
/// names use it: no program can declare something that collides with this.
pub const MODULE_INIT: &str = "module#init";

/// Why this method cannot be used as a value, if it cannot.
#[derive(Default)]
struct Naming {
    printers: std::rc::Rc<printed::Plan>,
    iterators: std::rc::Rc<iterator_calls::Plan>,
    parameter_entries: std::rc::Rc<rustc_hash::FxHashSet<NodeId>>,
    initialization: std::rc::Rc<initialization::Analysis>,
    /// Which declarations a [raising copy](FuncBuilder::raises) is emitted for.
    /// See [`raising_copies`](fn@raising_copies).
    raising: rustc_hash::FxHashSet<NodeId>,
    /// Which declarations a raising copy *could* be made of: [`raising_copies`](fn@raising_copies)'
    /// `eligible`, the greatest fixpoint of "a copy of this can be built and every
    /// callee of it that can raise has one too".
    ///
    /// Published rather than kept local, because [`raising_member_slots`] has to ask
    /// it of an **overrider** -- which `raising_copies` never sees, since the callee a
    /// virtual call resolves to is always the declaration the receiver's static type
    /// names -- and that function needs the hierarchy, which `raising_copies` has
    /// none of. Re-deriving the fixpoint there would be a second answer to the one
    /// question whose wrong answer is a copy that compiles and drops a `throw`.
    copyable: rustc_hash::FxHashSet<NodeId>,
    /// Symbols whose functions can raise a `throw`, directly or through a call.
    ///
    /// What a `try` needs to know about a call it contains: a `throw` reaches
    /// only a handler in its *own* function, so a call that can raise one is a
    /// call whose exception this handler will not catch. A call that cannot is
    /// no worse inside a `try` than outside it.
    ///
    /// Seeded from the declarations whose own body writes `throw` -- not
    /// entering nested functions, because an arrow written inside one is called
    /// somewhere else -- and closed over direct calls. An **indirect** call is
    /// in the set: `fns[0]()` reaches what cannot be known here, and the
    /// alternative is to assume the very thing this exists because the compiler
    /// cannot establish.
    throwing: rustc_hash::FxHashSet<u32>,
    /// [`Throwing::bodily`] -- which `then` the thenable census calls raising. A
    /// separate field rather than `throwing` filtered at the reader, because which
    /// question a set answers is a property of the set.
    raising_then: rustc_hash::FxHashSet<u32>,
    /// Every call node a `try` in this program guards.
    ///
    /// Published because [`raising_member_slots`] needs it and has the hierarchy, which
    /// [`raising_copies`](fn@raising_copies) does not: a call on an interface-typed receiver resolves to a
    /// body-less `MethodSignature`, so the declarations that would carry its `throw` are
    /// the **implementors**, and only the hierarchy can name those. Collected by the walk
    /// that already visits every guarded node rather than by a second one, because "which
    /// calls does a `try` guard" is a question this file must answer once.
    guarded_calls: rustc_hash::FxHashSet<NodeId>,
    /// Calls in the named and closure bodies whose raising entries are offered.
    /// Collected from the same roots as `raising_copies`, after its gate decision.
    /// Interface-family numbering needs these transitive calls as well as calls
    /// directly guarded by a try.
    raising_body_calls: rustc_hash::FxHashSet<NodeId>,
    /// Whether a call inside a `try` may dispatch at `Hierarchy::raising_call_slot`:
    /// every raising body this program would build can carry what it calls. See
    /// [`what_holds_the_gate_off`](raising_copies::what_holds_the_gate_off), which is also where the measurement that
    /// makes it program-global lives.
    closures_carry: bool,
    /// Where `closures_carry` is off, a sentence naming the first closure that
    /// cannot carry what it calls, and that call -- so the refusal it causes at
    /// every call through a function value inside a `try` names its cause
    /// rather than "some closure in this program". See [`describe_gate_holder`](raising_copies::describe_gate_holder).
    gate_holder: Option<String>,
    /// The emitted name, for a declaration whose plain name is taken.
    qualified: rustc_hash::FxHashMap<NodeId, String>,
    /// Declarations that cannot be told apart by anything this compiler has.
    ambiguous: rustc_hash::FxHashSet<NodeId>,
    /// The order a program *writes* an object type's fields, where every
    /// literal of that type agrees.
    ///
    /// A compiled object has no insertion order — `Object.keys` walks the
    /// layout's field order — and JavaScript orders own string keys by
    /// insertion. One layout is one order, so the two can only agree when the
    /// layout **is** the order the program writes.
    ///
    /// It is not information that has to be recovered: the field sets at an
    /// allocation site are already emitted in source order, which the JVM lane
    /// found by reading its own bytecode. This is the same fact, taken before
    /// lowering so the layout can be built from it.
    ///
    /// Only where every literal agrees. A program that writes one type two ways
    /// — `{ a, b, c }` here and `{ c, a, b }` there — has no ordering answer,
    /// and those types are absent rather than guessed at; the layout then keeps
    /// the checker's order, which is what it always had.
    ///
    /// Here rather than computed as the lowering goes, for the reason
    /// [`Self::generators`] gives: a builder is made fresh per function and one
    /// cannot see another's.
    ///
    /// **Keyed by the field-name set, not by the type id.** An object literal
    /// gets a type of its own — `{ a: n, b: 1, c: 2 }` written as an `Extended`
    /// is not `Extended`'s id — and the two are merged into one layout later,
    /// structurally, by the same rule this key uses. Keying by the literal's id
    /// finds nothing when the layout is built for the declared type, which is
    /// what happened first: the collector was right and the lookup missed.
    written_order: WrittenOrders,
    /// The keys a write may add to an object after it was made: see
    /// [`added_keys`].
    added_keys: std::rc::Rc<AddedKeys>,

    /// Which generator each `function*` is, in source order.
    ///
    /// Here rather than counted as the lowering goes, because a builder is made
    /// fresh per function and a counter on one cannot be seen by the next. It
    /// decides an *identity* that has to be the same in two places -- the frame
    /// the generator fills and the frame the `for...of` walks -- which is what
    /// the rest of this struct is for.
    generators: rustc_hash::FxHashMap<NodeId, usize>,

    /// Every property name some `in` in this program asks about.
    ///
    /// A presence bit is only worth maintaining where something reads it. The
    /// first version maintained one for every optional property and cost
    /// `benches`' `callback-field` **one counted operation against a floor of
    /// zero** -- a store into a header word nobody would ever look at.
    ///
    /// Keyed by *name* rather than by (type, key). The receiver's type set is
    /// decided during lowering and a name is decided by the source, so a name
    /// is the fact available before any function is walked; over-approximating
    /// costs a store on a same-named property of an unrelated type, and being
    /// wrong the other way would be a bit that is read and never written.
    ///
    /// The bit *index* is unaffected: it stays a position among **all** the
    /// layout's optional fields, so tracking a subset cannot renumber anything
    /// and a key that starts being asked about needs no other agreement.
    ///
    /// **`Object.keys`, `Object.hasOwn` and `for...in` will not fit this.**
    /// `in` names its key in the source and they do not: `Object.keys(o)` asks
    /// about *every* optional property of `o`'s type at once. Whoever lands
    /// them has to add the receiver's whole optional set here, not a key — and
    /// a reader added without a matching producer is a bit that is read and
    /// never written, which answers `false` for a property that is there and
    /// says nothing while doing it.
    presence_keys: rustc_hash::FxHashSet<String>,

    /// The token index of each class this program declares.
    ///
    /// A class used as a *value* needs one immortal object, the same one
    /// wherever the name is written, so its type id has to be the same in every
    /// function that mentions it -- and a builder is made fresh per function,
    /// which is the reason everything else in this struct is here.
    ///
    /// **Keyed by the declaring symbol, not by the type.** A class has a type
    /// for its instances and the value is not one of them; two classes can also
    /// share an instance layout by being structurally identical, and their
    /// tokens must still be two. The symbol is what the source wrote.
    ///
    /// Every class gets an index whether or not it is used as a value, because
    /// an unused one costs nothing: no layout is pushed until a read reaches
    /// the arm that pushes it. Assigning only to the used ones would mean
    /// finding them first, which is the same walk with a way to be wrong.
    class_tokens: rustc_hash::FxHashMap<u32, usize>,

    /// For a `(root, member)` family whose raising slot [`raising_member_slots`] did
    /// **not** number: the member that withheld it, as the name a reader can look up.
    ///
    /// The slot is withheld where one implementation can raise and no copy of it can be
    /// made -- all of the family or none, which is a soundness condition rather than a
    /// tidiness one. The *refusal* for that lands much later, in
    /// [`FuncBuilder::callee_for`] and [`FuncBuilder::accessor_callee`], which know only
    /// that `slot_for` answered `None`. So the sentence said *"an override of it can
    /// raise and no copy of that override can be made"* without saying **which** -- and
    /// `_read`'s said "which a subclass overrides" without naming `DuplexSide`.
    ///
    /// The JVM lane asked for this and their argument is the one that settles it: a
    /// withheld slot cannot be declined by a backend, because lowering never emits the
    /// index, so there is nothing for the backend to report. Only lowering can name the
    /// withholder, and a census of the sentence then ranks by it -- which is the number
    /// to act on, rather than a count of sites that share one cause.
    ///
    /// Published rather than re-derived at the site for the reason `copyable` is: the
    /// site has no `members_filling` and no fixpoint, and a second answer to "which
    /// member withheld this" would be a sentence that names the wrong one.
    withheld: rustc_hash::FxHashMap<(TypeId, MemberKey), Vec<String>>,
}

fn naming(
    snapshot: &LoweringSnapshot<'_>,
    closures: &[ClosureInfo],
    readers: &initialization::PrivateReaders,
    hierarchy: &Hierarchy,
) -> Naming {
    let mut probe = FuncBuilder::probe(snapshot);
    probe.hierarchy = hierarchy;
    // Captured function declarations are closure values too. The same table
    // must classify their calls during raising analysis and during lowering.
    probe.closures = SharedClosures::new(snapshot, closures.to_vec());
    probe.initialization =
        std::rc::Rc::new(initialization::analyze(snapshot, &probe, closures, readers));
    probe.printers = std::rc::Rc::new(printed::Plan::new(&probe));
    let generators = generator_indices(snapshot);
    probe.iterators = std::rc::Rc::new(iterator_calls::Plan::new(&probe, &generators));
    let class_tokens = class_token_indices(snapshot);
    let written_order = written_field_orders(snapshot, &probe);

    let (qualified, ambiguous) = qualified_names(snapshot);
    let mut naming = Naming {
        printers: probe.printers.clone(),
        iterators: probe.iterators.clone(),
        parameter_entries: probe.closures.parameter_entries(),
        initialization: probe.initialization.clone(),
        qualified,
        ambiguous,
        class_tokens,
        ..Naming::default()
    };
    let throwing = throwing_symbols(snapshot, &probe);
    probe.throwing = &throwing.any;
    let raising = raising_copies(snapshot, &probe, &throwing);
    naming.raising = raising.copies;
    naming.copyable = raising.eligible;
    naming.guarded_calls = raising.guarded_calls;
    naming.raising_body_calls = raising.body_calls;
    naming.closures_carry = raising.closures_carry;
    naming.gate_holder = raising.gate_holder;
    naming.raising_then = throwing.bodily;
    naming.presence_keys = presence_keys(snapshot, &probe);
    naming.added_keys = std::rc::Rc::new(added_keys(snapshot, &probe));
    naming.throwing = throwing.any;
    naming.generators = generators;
    naming.written_order = written_order;
    naming
}

mod closed_calls;
mod erased_calls;
mod generic_values;

/// The constructor being lowered of a class the program writes over an
/// Objective-C class: the class its `super(...)` makes an instance of,
/// whether it has fields to make with it, and the parameters that are fields
/// too, stored once there is an instance to store them in.
#[derive(Clone)]
struct ObjcConstruct {
    handle: super::native::Handle,
    fields: bool,
    parameter_properties: Vec<(NodeId, u32)>,
}

/// A method the Objective-C runtime calls, through an entry point that
/// passes each label as an argument of its own, and -- where the method
/// returns a record by value -- the address to write it to.
#[derive(Clone, Copy)]
struct ObjcEntry {
    returns_record: bool,
}

/// How a call to a method of a class the program writes over an
/// Objective-C class dispatches, where a subclass overrides it
/// (`FuncBuilder::objc_dispatch`).
struct ObjcDispatch {
    /// Each of the program's classes from the method's class down, compared
    /// with the receiver's own class.
    exact: Vec<ObjcArm>,
    /// Each class that overrides the method, deepest first, asked
    /// `isKindOfClass:` for a class the runtime made below it.
    overriders: Vec<ObjcArm>,
    /// The method itself, where nothing else answered.
    base: ObjcArm,
}

/// One arm of an [`ObjcDispatch`]: where the receiver is a `tested`, the
/// method `method` that `owner` implements answers.
#[derive(Clone, Copy)]
struct ObjcArm {
    tested: NodeId,
    owner: NodeId,
    method: NodeId,
}

/// An override of a composable Windows Runtime class, called through its
/// adapter -- which, where the method answers a record by value, passes the
/// slot's result pointer last to write it through (`record_out`).
#[derive(Clone, Copy)]
struct ComEntry {
    returns_record: bool,
    /// The parameters, by index (`this` is 0), that are an `HSTRING` the
    /// Windows Runtime lends: each arrives as its handle and is bound to a
    /// string holding its text.
    hstrings: u64,
}

/// Swift's `@objc` selector for a method of `count` parameters: its name,
/// with a colon for each (`pressed(sender)` is `pressed:`).
fn objc_selector(name: &str, count: usize) -> String {
    format!("{name}{}", ":".repeat(count))
}

/// A class the program writes over an Objective-C class, recorded as the
/// runtime will register it (`Program::foreign_classes`). Its fields live in a
/// state object the runtime keeps in the instance's `nts_state` ivar
/// (`nts_objc_state`).
fn register_objc_class(
    snapshot: &LoweringSnapshot<'_>,
    class: NodeId,
    methods: Vec<super::ForeignMethod>,
    state: Option<String>,
    lowered: &mut Lowered,
) {
    let probe = FuncBuilder::probe(snapshot);
    let (Some(name), Some(superclass)) = (
        super::native::objc_name(snapshot, class),
        super::native::superclass(snapshot, class)
            .and_then(|base| super::native::objc_name(snapshot, base)),
    ) else {
        return;
    };
    // By the runtime's name: the one `@ntsProtocol` gives, else the
    // interface's own.
    let protocols = probe
        .objc_protocols(class)
        .into_iter()
        .filter_map(|protocol| {
            probe
                .node(protocol)
                .native
                .as_ref()
                .and_then(|native| native.protocol.clone())
                .or_else(|| {
                    probe.children(protocol).into_iter().find_map(|child| {
                        (probe.kind_of(child) == Some(syntax::IDENTIFIER))
                            .then(|| {
                                probe
                                    .node(child)
                                    .text
                                    .as_ref()
                                    .and_then(|text| text.as_utf8())
                                    .map(str::to_owned)
                            })
                            .flatten()
                    })
                })
        })
        .collect();
    lowered.program.foreign_classes.push(super::ForeignClass {
        family: super::native::Family::Objc,
        name,
        type_name: None,
        superclass: superclass.into(),
        methods,
        protocols,
        state,
        composition: None,
        signals: Vec::new(),
        properties: Vec::new(),
        template: None,
    });
}

/// A class the program writes over a `GObject` class, recorded as the backend
/// will register it (`Program::foreign_classes`): its own name, the function
/// answering its parent's `GType`, the class struct slot each override fills,
/// and the maker of the object holding its fields (`{Class}#state`), which
/// the support file's `instance_init` calls and `finalize` releases.
fn register_gobject_class(
    snapshot: &LoweringSnapshot<'_>,
    class: NodeId,
    parent: super::native::GType,
    (methods, properties): (Vec<super::ForeignMethod>, Vec<super::ForeignProperty>),
    state: Option<String>,
    lowered: &mut Lowered,
) {
    let Some(name) = foreign_class_name(snapshot, class) else {
        return;
    };
    let refuse = |lowered: &mut Lowered, why: &str| {
        let diagnostic = FuncBuilder::probe(snapshot).unsupported(class, why);
        note_uncompiled(snapshot, &mut lowered.program, class, None, &diagnostic);
        lowered.diagnostics.push(diagnostic);
    };
    for field in ["GTypeName", "template"] {
        if matches!(
            static_value(snapshot, class, field),
            Some(StaticValue::Unrepresentable)
        ) {
            return refuse(
                lowered,
                &format!(
                    "a `static {field}` containing unpaired UTF-16 code units, which GTK's UTF-8 boundary cannot represent"
                ),
            );
        }
    }
    let type_name = match static_value(snapshot, class, "GTypeName") {
        None => format!("Nts_{name}"),
        Some(StaticValue::Literal(type_name)) => type_name,
        Some(StaticValue::Computed) => {
            return refuse(
                lowered,
                "a `static GTypeName` that is not a string literal: a class's type name is known when it compiles",
            );
        }
        Some(StaticValue::Unrepresentable) => {
            unreachable!("the GTK text boundary was checked above")
        }
    };
    // A template's handlers are reached through the template, not a slot.
    let (callbacks, methods): (Vec<super::ForeignMethod>, Vec<super::ForeignMethod>) = methods
        .into_iter()
        .partition(|method| method.selector().starts_with("callback "));
    let mut template = gobject_template(snapshot, class);
    if let Some(template) = &mut template {
        template.callbacks = callbacks;
        let missing = known_handlers(template)
            .unwrap_or_default()
            .into_iter()
            .find(|handler| {
                !template
                    .callbacks
                    .iter()
                    .any(|callback| callback.selector() == format!("callback {handler}"))
            });
        if let Some(handler) = missing {
            let diagnostic = FuncBuilder::probe(snapshot).unsupported(
                class,
                &format!("a template whose handler `{handler}` is no method of the class"),
            );
            note_uncompiled(snapshot, &mut lowered.program, class, None, &diagnostic);
            lowered.diagnostics.push(diagnostic);
            return;
        }
    }
    // Signals are declared on the class over a binding's (`extends
    // GtkButton<{ ... }>`); one over a class the program wrote inherits its
    // parent's, which `emit` finds by name on the instance's type.
    let signals = if parent.program_class().is_some() {
        Vec::new()
    } else {
        match gobject_signals(snapshot, class) {
            Ok(signals) => signals,
            Err(why) => {
                let diagnostic = FuncBuilder::probe(snapshot).unsupported(class, &why);
                note_uncompiled(snapshot, &mut lowered.program, class, None, &diagnostic);
                lowered.diagnostics.push(diagnostic);
                return;
            }
        }
    };
    lowered.program.foreign_classes.push(super::ForeignClass {
        family: super::native::Family::GObject,
        name,
        type_name: Some(type_name),
        superclass: super::native::ForeignParent::GObject(parent),
        methods,
        protocols: gobject_interfaces(snapshot, class),
        state,
        composition: None,
        signals,
        properties,
        template,
    });
}

/// The signature a binding declares a virtual function with: a class's is a
/// method, an interface's an optional one (`vfunc_get_item?(...)`, as C leaves
/// a slot it does not fill to the default), typed with `undefined` beside it.
fn vfunc_declaration_signature(
    snapshot: &SemanticSnapshot,
    declaration: NodeId,
) -> Option<&nts_semantic_schema::SignatureRecord> {
    if let Some(signature) = super::generics::declared_signature(snapshot, declaration) {
        return Some(signature);
    }
    let kind = |ty: nts_semantic_schema::TypeId| {
        snapshot.types.get(ty.0 as usize).map(|record| &record.kind)
    };
    let Some(TypeKind::Union(parts)) = snapshot
        .node_types
        .get(&declaration)
        .and_then(|ty| kind(*ty))
    else {
        return None;
    };
    let mut functions = parts.iter().filter_map(|part| match kind(*part) {
        Some(TypeKind::Function(signature)) => Some(*signature),
        _ => None,
    });
    let signature = functions.next()?;
    if functions.next().is_some()
        || !parts.iter().all(|part| {
            matches!(
                kind(*part),
                Some(TypeKind::Function(_) | TypeKind::Undefined)
            )
        })
    {
        return None;
    }
    snapshot.signatures.get(signature.0 as usize)
}

/// What names the `emit` thunk of a binding's own signal: `g`, then each
/// parameter's C type -- `p` a pointer, `B` a `bool`, a scalar by its name
/// (`Int32`) -- where a program's signal is named by its kinds (`d`, `b`, `s`,
/// `o`); then, for a signal that answers, `R` and its result's the same way
/// (`gUInt...RInt`). A record passed by value has no place in
/// `g_signal_emit`'s varargs.
fn binding_signal_kinds(
    parameters: &[super::native::Type],
    result: &super::native::Type,
) -> Result<String, String> {
    use std::fmt::Write as _;
    let code = |kinds: &mut String, ty: &super::native::Type| -> Result<(), String> {
        match ty {
            super::native::Type::Pointer(_) => kinds.push('p'),
            super::native::Type::Bool => kinds.push('B'),
            super::native::Type::Scalar(scalar) => {
                let _ = write!(kinds, "{scalar:?}");
            }
            other => {
                return Err(format!(
                    "`emit` of a signal with a value of C type {other:?}"
                ));
            }
        }
        Ok(())
    };
    let mut kinds = String::from("g");
    for parameter in parameters {
        code(&mut kinds, parameter)?;
    }
    if !matches!(result, super::native::Type::Void) {
        kinds.push('R');
        code(&mut kinds, result)?;
    }
    Ok(kinds)
}

/// The interfaces a class implements (`extends GObject<{}, GListModelImplementation>`),
/// read off its instance type's `__c_ifaces` (see `Signalled` in `c:types`):
/// each as its interface struct and `GType` function, `GListModelInterface
/// g_list_model_get_type`, sorted. A subclass carries its parent's, and adds
/// them again, which `GLib` answers with a copy of the parent's table for it
/// to override in.
fn gobject_interfaces(snapshot: &SemanticSnapshot, class: NodeId) -> Vec<String> {
    let kind = |ty: nts_semantic_schema::TypeId| {
        snapshot.types.get(ty.0 as usize).map(|record| &record.kind)
    };
    let Some(instance) = instance_type_of(snapshot, class) else {
        return Vec::new();
    };
    let Some(declared) = super::native::schema::property(snapshot, instance, "__c_ifaces") else {
        return Vec::new();
    };
    // Optional, so `"A" | "B" | undefined`.
    let parts = match kind(declared.ty) {
        Some(TypeKind::Union(parts)) => parts.clone(),
        _ => vec![declared.ty],
    };
    let mut interfaces: Vec<String> = parts
        .into_iter()
        .filter_map(|part| match kind(part) {
            Some(TypeKind::Literal(LiteralValue::String(text))) => {
                text.as_utf8().map(str::to_owned)
            }
            _ => None,
        })
        .collect();
    interfaces.sort();
    interfaces.dedup();
    interfaces
}

/// The class the program wrote that `class` extends (`class Wide extends
/// Panel`): `None` over a binding's class, or none.
fn program_superclass(snapshot: &LoweringSnapshot<'_>, class: NodeId) -> Option<NodeId> {
    let probe = FuncBuilder::probe(snapshot);
    let base = probe
        .children(class)
        .into_iter()
        .filter(|child| probe.kind_of(*child) == Some(syntax::HERITAGE_CLAUSE))
        .flat_map(|clause| probe.children(clause))
        .find_map(|expression| probe.children(expression).first().copied())?;
    super::native::schema::class_declaration(snapshot, probe.node(base).symbol?)
}

/// The names a template's `<signal>` elements give as their handlers, in the
/// order they appear.
fn template_handlers(xml: &str) -> Vec<String> {
    let mut handlers = Vec::new();
    for (at, _) in xml.match_indices("handler=\"") {
        let rest = &xml[at + "handler=\"".len()..];
        if let Some(end) = rest.find('"') {
            let handler = rest[..end].to_owned();
            if !handlers.contains(&handler) {
                handlers.push(handler);
            }
        }
    }
    handlers
}

/// A class's own `static` field `name`: `None` when it has none.
fn static_field(snapshot: &LoweringSnapshot<'_>, class: NodeId, name: &str) -> Option<NodeId> {
    let probe = FuncBuilder::probe(snapshot);
    probe.children(class).into_iter().find(|&member| {
        probe.kind_of(member) == Some(syntax::PROPERTY_DECLARATION)
            && is_static_member(snapshot, member)
            && probe.children(member).into_iter().any(|child| {
                probe.kind_of(child) == Some(syntax::IDENTIFIER)
                    && probe
                        .node(child)
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                        == Some(name)
            })
    })
}

/// What a class's `static` field holds, as GJS's registration reads
/// `GTypeName` and `Template`.
enum StaticValue {
    /// A string literal: the field's type, which the checker keeps for a
    /// `readonly` one, or its initialiser -- written `template: string`, as a
    /// class over one with a template has to, since its literal type would
    /// not extend the parent's.
    Literal(String),
    /// Anything else, known only once the module has run.
    Computed,
    /// GTK requires Unicode UTF-8, unlike JavaScript's UTF-16 strings.
    Unrepresentable,
}

/// What a class's own `static` field `name` holds: `None` when it has none.
fn static_value(snapshot: &LoweringSnapshot<'_>, class: NodeId, name: &str) -> Option<StaticValue> {
    let member = static_field(snapshot, class, name)?;
    if let Some(TypeKind::Literal(LiteralValue::String(text))) = snapshot
        .node_types
        .get(&member)
        .and_then(|ty| snapshot.types.get(ty.0 as usize))
        .map(|record| &record.kind)
    {
        return Some(text.as_utf8().map_or(StaticValue::Unrepresentable, |text| {
            StaticValue::Literal(text.to_owned())
        }));
    }
    let probe = FuncBuilder::probe(snapshot);
    let literal = probe.children(member).into_iter().find_map(|child| {
        matches!(
            probe.kind_of(child),
            Some(syntax::NO_SUBSTITUTION_TEMPLATE_LITERAL | syntax::STRING_LITERAL)
        )
        .then(|| probe.node(child).text.clone())
        .flatten()
    });
    Some(literal.map_or(StaticValue::Computed, |text| {
        text.as_utf8().map_or(StaticValue::Unrepresentable, |text| {
            StaticValue::Literal(text.to_owned())
        })
    }))
}

/// The template a class is built from, `static readonly template`, and the
/// children it names: each `declare`d field of a `GObject` handle type, by
/// its name as the child's id. Its text is the literal, or -- a value known
/// only at run time, GJS's `Template: workbench.template` -- what the class's
/// reader answers (`template_reader`). `None` for a class with no template.
fn gobject_template(snapshot: &LoweringSnapshot<'_>, class: NodeId) -> Option<super::Template> {
    let text = match static_value(snapshot, class, "template")? {
        StaticValue::Literal(text) => super::TemplateText::Literal(text),
        StaticValue::Computed => {
            super::TemplateText::Read(format!("{}#template", foreign_class_name(snapshot, class)?))
        }
        StaticValue::Unrepresentable => return None, // refused by register_gobject_class
    };
    Some(super::Template {
        text,
        children: template_children(snapshot, class)
            .into_iter()
            .map(|(name, _)| name)
            .collect(),
        callbacks: Vec::new(),
    })
}

/// The handlers a template names, where the compiler can read them: from XML
/// written as a literal. `None` for a template known only at run time, or
/// one loaded from a URI, whose names GTK resolves when it builds an
/// instance, as it does for GJS.
fn known_handlers(template: &super::Template) -> Option<Vec<String>> {
    match &template.text {
        super::TemplateText::Literal(text)
            if !text.starts_with("resource:///") && !text.starts_with("file:///") =>
        {
            Some(template_handlers(text))
        }
        _ => None,
    }
}

/// For a class whose template is known only at run time, the function
/// answering it (`{Class}#template`), lowered into the program: `false` when
/// it is refused, and reported, so the class is not registered with a
/// template it cannot read. `true` for every other class.
fn template_reader(
    snapshot: &LoweringSnapshot<'_>,
    foreign: &super::runtime::ForeignTable,
    class: NodeId,
    shared: &Shared,
    lowered: &mut Lowered,
) -> bool {
    let Some(super::Template {
        text: super::TemplateText::Read(reader),
        ..
    }) = gobject_template(snapshot, class)
    else {
        return true;
    };
    let Some(member) = static_field(snapshot, class, "template") else {
        return true;
    };
    let mut builder = shared.builder(snapshot, foreign, Copy::default());
    match builder.lower_template_reader(member, &reader) {
        Ok(func) => {
            lowered.program.funcs.push(func);
            true
        }
        Err(diagnostic) => {
            note_uncompiled(snapshot, &mut lowered.program, class, None, &diagnostic);
            lowered.diagnostics.push(diagnostic);
            false
        }
    }
}

/// The children a class's template names: its own `declare`d fields of a
/// `GObject` handle type, with each one's type.
fn template_children(
    snapshot: &SemanticSnapshot,
    class: NodeId,
) -> Vec<(String, nts_semantic_schema::TypeId)> {
    let Some(instance) = instance_type_of(snapshot, class) else {
        return Vec::new();
    };
    let Some(TypeKind::Object { properties }) = snapshot
        .types
        .get(instance.0 as usize)
        .map(|record| &record.kind)
    else {
        return Vec::new();
    };
    properties
        .iter()
        .filter(|field| field.own && field.kind == MemberKind::Field)
        .filter(|field| {
            field.declaration.and_then(|node| snapshot.nodes.get(node.0 as usize)).is_some_and(|node| {
                node.modifiers.contains(nts_semantic_schema::DeclarationModifiers::DECLARE)
            })
        })
        .filter(|field| {
            matches!(super::native::pointer(snapshot, field.ty), Some(super::native::Pointee::Opaque(ref handle)) if handle.family == super::native::Family::GObject)
        })
        .filter_map(|field| field.name.public_name().map(|name| (name.to_owned(), field.ty)))
        .collect()
}

/// The fields a class declares as `GObject` properties (`Property<T>` in
/// `c:types`), in the order it writes them, each with its kind: a `number`
/// (`d`), a `boolean` (`b`), a `string` (`s`) or a `GObject` handle (`o`).
/// Anything else marked is refused by name.
fn property_fields(
    snapshot: &SemanticSnapshot,
    class: NodeId,
) -> Result<Vec<(String, char)>, String> {
    let Some(instance) = instance_type_of(snapshot, class) else {
        return Ok(Vec::new());
    };
    let kind = |ty: nts_semantic_schema::TypeId| {
        snapshot.types.get(ty.0 as usize).map(|record| &record.kind)
    };
    let marked = |ty: nts_semantic_schema::TypeId| {
        super::native::schema::property(snapshot, ty, "__c_property").is_some()
    };
    let Some(TypeKind::Object { properties }) = kind(instance) else {
        return Ok(Vec::new());
    };
    let mut fields = Vec::new();
    for field in properties
        .iter()
        .filter(|p| p.own && p.kind == MemberKind::Field)
    {
        // `Property<boolean>` distributes: `(true & P) | (false & P)`.
        let parts: Vec<nts_semantic_schema::TypeId> = match kind(field.ty) {
            Some(TypeKind::Union(parts)) => parts.clone(),
            #[expect(
                clippy::match_same_arms,
                reason = "keep audited semantic type variants explicit"
            )]
            Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => vec![field.ty],
            _ => vec![field.ty],
        };
        if !parts.iter().all(|part| marked(*part)) {
            continue;
        }
        let under = |part: nts_semantic_schema::TypeId| -> Vec<nts_semantic_schema::TypeId> {
            match kind(part) {
                Some(TypeKind::Intersection(pieces)) => pieces.clone(),
                #[expect(
                    clippy::match_same_arms,
                    reason = "keep audited semantic type variants explicit"
                )]
                Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => vec![part],
                _ => vec![part],
            }
        };
        let pieces: Vec<nts_semantic_schema::TypeId> =
            parts.iter().flat_map(|part| under(*part)).collect();
        let has =
            |want: fn(&TypeKind) -> bool| pieces.iter().any(|piece| kind(*piece).is_some_and(want));
        let property_kind = if has(|k| matches!(k, TypeKind::Number)) {
            'd'
        } else if has(|k| matches!(k, TypeKind::String)) {
            's'
        } else if has(|k| {
            matches!(
                k,
                TypeKind::Boolean | TypeKind::Literal(LiteralValue::Boolean(_))
            )
        }) {
            'b'
        } else if matches!(
            super::native::pointer(snapshot, field.ty),
            Some(super::native::Pointee::Opaque(ref handle)) if handle.family == super::native::Family::GObject
        ) {
            'o'
        } else {
            return Err(format!(
                "a property `{}` of type {}, where a property is a `number`, a `boolean`, a `string` or a GObject",
                field.name,
                describe(snapshot, field.ty)
            ));
        };
        fields.push((
            field
                .name
                .public_name()
                .ok_or_else(|| format!("a native property `{}` without a string key", field.name))?
                .to_owned(),
            property_kind,
        ));
    }
    Ok(fields)
}

/// Where `property` stands among the properties `class` declares: its id,
/// less one.
fn fields_index(snapshot: &SemanticSnapshot, class: NodeId, property: &str) -> usize {
    property_fields(snapshot, class)
        .ok()
        .and_then(|fields| fields.iter().position(|(name, _)| name == property))
        .unwrap_or(0)
}

/// Each property a class declares, with the compiled functions reading and
/// writing its field (`{Class}#get_{name}`, `{Class}#set_{name}`), which the
/// backend's registration hands `get_property` and `set_property`. Empty for a
/// class with none; a refusal is reported, and the class registers without.
fn gobject_properties(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    foreign: &super::runtime::ForeignTable,
    class: NodeId,
    shared: &Shared,
    lowered: &mut Lowered,
) -> Vec<super::ForeignProperty> {
    let refuse = |lowered: &mut Lowered, diagnostic: Diagnostic| {
        note_uncompiled(snapshot, &mut lowered.program, class, None, &diagnostic);
        lowered.diagnostics.push(diagnostic);
    };
    let fields = match property_fields(snapshot, class) {
        Ok(fields) => fields,
        Err(why) => {
            refuse(
                lowered,
                FuncBuilder::probe(snapshot).unsupported(class, &why),
            );
            return Vec::new();
        }
    };
    let Some(name) = foreign_class_name(snapshot, class) else {
        return Vec::new();
    };
    let Some(&(index, class_ty)) = shared.hierarchy.objc_states.get(&name) else {
        return Vec::new();
    };
    let mut properties = Vec::new();
    for (field, kind) in fields {
        let mut accessors = Vec::new();
        for setter in [false, true] {
            let mut builder = shared.builder(snapshot, foreign, Copy::default());
            match builder.lower_gobject_property_accessor(
                class,
                &name,
                (index, class_ty),
                &field,
                setter,
            ) {
                Ok(func) => {
                    accessors.push(func.name.clone());
                    lowered.program.funcs.push(func);
                    layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
                }
                Err(diagnostic) => {
                    refuse(lowered, diagnostic);
                    return Vec::new();
                }
            }
        }
        let [getter, setter] = <[String; 2]>::try_from(accessors).unwrap_or_default();
        properties.push(super::ForeignProperty {
            name: field,
            kind,
            getter,
            setter,
        });
    }
    properties
}

/// The fields of a class the program writes over an Objective-C class that
/// meet a property requirement of a protocol it adopts: Swift's
/// `var window: UIWindow?` in an application delegate, which `UIKit` reads
/// with `window` and writes with `setWindow:`. Each is a getter and, unless
/// the field is `readonly`, a setter the runtime calls, which read and write
/// the field of the instance's state as the program's own `this.window` does.
/// A field no protocol asks for is the program's alone, as Swift's
/// non-`@objc` one is.
fn objc_field_properties(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    foreign: &super::runtime::ForeignTable,
    class: NodeId,
    shared: &Shared,
    lowered: &mut Lowered,
) -> Vec<super::ForeignMethod> {
    let probe = FuncBuilder::probe(snapshot);
    let Some(name) = foreign_class_name(snapshot, class) else {
        return Vec::new();
    };
    let Some(&(index, class_ty)) = shared.hierarchy.objc_states.get(&name) else {
        return Vec::new();
    };
    let mut methods = Vec::new();
    for field in probe.children(class) {
        if probe.kind_of(field) != Some(syntax::PROPERTY_DECLARATION)
            || is_static_member(snapshot, field)
        {
            continue;
        }
        let Some(property) = probe.member_name(field) else {
            continue;
        };
        let Some(requirement) = probe.property_requirement(class, &property) else {
            continue;
        };
        let (getter, setter) = probe.property_selectors(requirement, &property);
        let readonly = probe
            .node(field)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::READONLY);
        for (selector, writes) in [(Some(getter), false), (setter.filter(|_| !readonly), true)] {
            let Some(selector) = selector else { continue };
            let mut builder = shared.builder(snapshot, foreign, Copy::default());
            match builder.lower_objc_field_accessor(
                class,
                &name,
                (index, class_ty),
                (field, &property),
                writes,
            ) {
                Ok((func, imp)) => {
                    methods.push(super::ForeignMethod {
                        dispatch: super::Dispatch::Selector(selector),
                        function: func.name.clone(),
                        signature: std::sync::Arc::new(imp),
                        declared_at: None,
                    });
                    lowered.program.funcs.push(func);
                    layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
                }
                Err(diagnostic) => {
                    note_uncompiled(snapshot, &mut lowered.program, field, None, &diagnostic);
                    lowered.diagnostics.push(diagnostic);
                    break;
                }
            }
        }
    }
    methods
}

/// The signals a class declares, read off its instance type's
/// `__c_signals` (see `WithSignals` in `c:types`), in the order it writes
/// them. A parameter is a `number` (`d`), a `boolean` (`b`), a `string`
/// (`s`) or a `GObject` handle (`o`); anything else is refused by name.
fn gobject_signals(
    snapshot: &SemanticSnapshot,
    class: NodeId,
) -> Result<Vec<super::ForeignSignal>, String> {
    let Some(instance) = instance_type_of(snapshot, class) else {
        return Ok(Vec::new());
    };
    signals_of_type(snapshot, instance)
}

/// The signals an instance type carries -- its own and its ancestors', since
/// `__c_signals` is inherited -- with each parameter's kind. One reading for
/// the registration and for `emit`, so the two cannot spell a signal apart.
/// A type parameter (the polymorphic `this` of a method) is read through its
/// constraint.
fn signals_of_type(
    snapshot: &SemanticSnapshot,
    instance: nts_semantic_schema::TypeId,
) -> Result<Vec<super::ForeignSignal>, String> {
    let kind = |ty: nts_semantic_schema::TypeId| {
        snapshot.types.get(ty.0 as usize).map(|record| &record.kind)
    };
    let mut instance = instance;
    let mut seen = rustc_hash::FxHashSet::default();
    loop {
        if !seen.insert(instance) {
            return Err(
                "a cyclic type-parameter constraint while discovering C signals".to_owned(),
            );
        }
        match kind(instance) {
            Some(TypeKind::TypeParameter {
                constraint: Some(constraint),
                ..
            }) => {
                instance = *constraint;
            }
            _ => break,
        }
    }
    let Some(declared) = super::native::schema::property(snapshot, instance, "__c_signals") else {
        return Ok(Vec::new());
    };
    // Optional, so `Sig | undefined`.
    let map = match kind(declared.ty) {
        Some(TypeKind::Union(parts)) => parts
            .iter()
            .copied()
            .find(|part| !matches!(kind(*part), Some(TypeKind::Undefined))),
        #[expect(
            clippy::match_same_arms,
            reason = "keep audited semantic type variants explicit"
        )]
        Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => Some(declared.ty),
        _ => Some(declared.ty),
    };
    let Some(TypeKind::Object { properties, .. }) = map.and_then(kind) else {
        return Ok(Vec::new());
    };
    let mut signals = Vec::new();
    for signal in properties {
        let Some(TypeKind::Tuple(elements)) = kind(signal.ty) else {
            return Err(format!(
                "a signal `{}` whose parameters are not written as a tuple",
                signal.name
            ));
        };
        let elements = &elements.elements;
        let mut kinds = String::new();
        for element in elements {
            let is_boolean = match kind(*element) {
                Some(TypeKind::Boolean) => true,
                Some(TypeKind::Union(parts)) => parts.iter().all(|part| {
                    matches!(
                        kind(*part),
                        Some(TypeKind::Literal(LiteralValue::Boolean(_)))
                    )
                }),
                #[expect(
                    clippy::match_same_arms,
                    reason = "keep audited semantic type variants explicit"
                )]
                Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => false,
                _ => false,
            };
            kinds.push(match kind(*element) {
                Some(TypeKind::Number) => 'd',
                Some(TypeKind::String) => 's',
                _ if is_boolean => 'b',
                _ if matches!(
                    super::native::pointer(snapshot, *element),
                    Some(super::native::Pointee::Opaque(ref handle)) if handle.family == super::native::Family::GObject
                ) => 'o',
                _ => {
                    return Err(format!(
                        "a signal `{}` with a parameter of type {}, where a signal takes a `number`, a `boolean`, a `string` or a GObject",
                        signal.name,
                        describe(snapshot, *element)
                    ));
                }
            });
        }
        signals.push(super::ForeignSignal {
            name: signal
                .name
                .public_name()
                .ok_or_else(|| format!("a native signal `{}` without a string key", signal.name))?
                .to_owned(),
            kinds,
        });
    }
    Ok(signals)
}

/// A member of a class over a foreign one, lowered by its family's own
/// method: its function joins the program and its record the family's list,
/// or its refusal is noted and reported.
/// A member of a class over a `GObject` class, with the wrapper of its
/// slot's C shape where it is an override answering its outs as a tuple
/// (`VfuncSlot`), which is lowered here and kept beside it -- or refuses the
/// member where the wrapper cannot be made.
fn with_vfunc_slot(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    foreign: &super::runtime::ForeignTable,
    shared: &Shared,
    (lowered_member, slot): (LoweredMember, Option<VfuncSlot>),
    lowered: &mut Lowered,
) -> LoweredMember {
    let Some(slot) = slot else {
        return lowered_member;
    };
    let (func, method) = lowered_member?;
    let mut wrapper = shared.builder(snapshot, foreign, Copy::default());
    let built = wrapper.lower_vfunc_slot(&slot, &func);
    layout_collector.collect(&mut lowered.program, wrapper.layouts.into_layouts());
    lowered.program.funcs.push(built?);
    Ok((func, method))
}

/// A class the program writes over a composable Windows Runtime class,
/// recorded as the runtime will compose it (`Program::foreign_classes`): its
/// overrides, by interface and slot, and the factory of the class it extends.
fn register_com_class(
    snapshot: &LoweringSnapshot<'_>,
    class: NodeId,
    mut composition: super::native::Composable,
    methods: Vec<super::ForeignMethod>,
    state: Option<String>,
    lowered: &mut Lowered,
) {
    let probe = FuncBuilder::probe(snapshot);
    // An interface answered by the class's own table answers all of its
    // methods there: each one the class does not override is forwarded to the
    // base's own, and one that cannot be is refused by name, not left a gap.
    match probe.forwarded(class, &methods) {
        Ok(forwarded) => composition.forwarded = forwarded,
        Err((missing, why)) => {
            let diagnostic = probe.unsupported(
                class,
                &format!("a class written over a composable Windows Runtime class that overrides some of an interface's methods and not `{missing}`, whose base's is forwarded to and cannot be: {why}"),
            );
            note_uncompiled(snapshot, &mut lowered.program, class, None, &diagnostic);
            lowered.diagnostics.push(diagnostic);
            return;
        }
    }
    let Some(name) = probe.children(class).into_iter().find_map(|child| {
        (probe.kind_of(child) == Some(syntax::IDENTIFIER))
            .then(|| {
                probe
                    .node(child)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map(str::to_owned)
            })
            .flatten()
    }) else {
        return;
    };
    lowered.program.foreign_classes.push(super::ForeignClass {
        family: super::native::Family::Com,
        name,
        type_name: None,
        superclass: composition.class.clone().into(),
        methods,
        protocols: Vec::new(),
        state,
        composition: Some(composition),
        signals: Vec::new(),
        properties: Vec::new(),
        template: None,
    });
}

/// For a class the program writes over an Objective-C class and gives
/// fields, the function making the object that holds them; `None` for one
/// without fields, or whose function is refused (and reported).
fn objc_state_function(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    foreign: &super::runtime::ForeignTable,
    class: NodeId,
    shared: &Shared,
    lowered: &mut Lowered,
) -> Option<String> {
    let name = foreign_class_name(snapshot, class)?;
    let &(index, class_ty) = shared.hierarchy.objc_states.get(&name)?;
    let mut builder = shared.builder(snapshot, foreign, Copy::default());
    match builder.lower_objc_state(class, &name, index, class_ty) {
        Ok(func) => {
            let made = func.name.clone();
            lowered.program.funcs.push(func);
            layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
            Some(made)
        }
        Err(diagnostic) => {
            note_uncompiled(snapshot, &mut lowered.program, class, None, &diagnostic);
            lowered.diagnostics.push(diagnostic);
            None
        }
    }
}

/// Empty facts for probes that run before program planning. Owned by the one
/// lowering snapshot, so making a question-only builder allocates no context.
#[derive(Default)]
struct ProbeContext {
    module: ModuleScope,
    hierarchy: Hierarchy,
    naming: Naming,
}

/// Program facts built once and borrowed by every body. Initializer refusal
/// analysis completes the module's refusal facts before bodies borrow them.
struct Shared {
    module: ModuleScope,
    hierarchy: Hierarchy,
    closures: SharedClosures,
    naming: Naming,
    generics: super::generics::GenericFunctions,
    overload_results: overload_results::Results,
    /// Copies of ordinary functions specialised to a concrete argument type.
    /// See [`structural_instantiations`].
    structural: Structural,
    /// What each generic class instantiation binds, by the instance's type.
    /// A `new` of one runs the class's field initialisers at the `new` site,
    /// in the caller's builder, and those are written in terms of `T`.
    ///
    /// Shared rather than cloned into each builder: a builder is made per
    /// function, per copy, per literal member and per closure, and cloning a
    /// map of substitutions -- two hash maps each -- into every one of them
    /// took `stream` from 15 to 66 seconds. Measured, then shared.
    class_instances: std::rc::Rc<rustc_hash::FxHashMap<TypeId, Substitution>>,
    /// Which classes are thenables. Shared for the reason `class_instances`
    /// is: it is read by every builder and written by none.
    thenables: std::rc::Rc<Thenables>,
    /// Each constructor whose base makes the instance, and the classes it is
    /// run for besides its own ([`constructor_targets`]).
    target_copies: rustc_hash::FxHashMap<NodeId, Vec<TypeId>>,
}

impl Shared {
    /// What every function's lowering needs and none of them computes: the
    /// module scope, the class hierarchy, the closures, the qualified names,
    /// and which generic functions were instantiated at what.
    /// `naming` is passed rather than computed, because **a slot it decides has to be
    /// in the hierarchy every reader sees**. `closures_carry` was a bool and patching a
    /// local clone here was enough; `number_raising_member_slots` adds an *index*, and a
    /// clone that has it while `lower`'s own hierarchy does not gives two tables of
    /// different lengths -- the layouts a builder fills are one longer than the one
    /// `declare_uniform_entries` reads, so the entry is written and then never found.
    /// That cost an afternoon: the call was `call.virtual[1] Base#raise@raises`, the
    /// copy was in `funcs`, and `reachable::prune` dropped it because the *layout* it
    /// was supposed to be in belonged to the other hierarchy.
    fn whole_program(
        snapshot: &LoweringSnapshot<'_>,
        module: ModuleScope,
        hierarchy: Hierarchy,
        closures: &[ClosureInfo],
        naming: Naming,
    ) -> Self {
        #[cfg(test)]
        context_scaling::context();
        let mut structural = structural_instantiations(snapshot, &hierarchy);
        erased_calls::raising_copies(snapshot, &hierarchy, &naming, &mut structural);
        let probe = FuncBuilder::probe(snapshot);
        let mut closures = closures.to_vec();
        let variants = closure_variants(&probe, &closures, &structural);
        closures.extend(variants);
        let mut generics = super::generics::function_instantiations(snapshot);
        generic_values::register(snapshot, &closures, &mut generics);
        let overload_results = overload_results::associate(snapshot, &mut generics);
        let class_copies = class_copies(snapshot, &generics);
        closures.extend(class_closure_variants(&probe, &closures, &class_copies));
        let class_instances = std::rc::Rc::new(
            super::generics::instantiations(snapshot)
                .into_values()
                .flatten()
                .map(|instance| (instance.ty, instance.substitution))
                .collect(),
        );
        // **The hierarchy this program's bodies see is the caller's**, which already
        // carries what `collect_hierarchy` could not know -- `closures_carry` and the
        // raising member slots, both of which come from `raising_copies` -- because
        // `hierarchy_and_naming` patched it there, with the same `naming` this is given.
        // It used to be cloned here so `closures_carry` could be set on the copy; that
        // clone is gone, because one hierarchy is the whole point and a second one is
        // how a layout's table and the slot a site names came to be different lengths.
        // After every variant, so that none is made of these: a job and its
        // resolving functions capture nothing a copy could re-type.
        let thenables = std::rc::Rc::new(thenables(
            snapshot,
            &probe,
            &hierarchy,
            &naming.raising_then,
            &mut closures,
        ));
        // And for the same reason: a reaction captures nothing a copy could re-type.
        reactions(&probe, &mut closures);
        bound_functions(&probe, &mut closures);
        module_jobs(snapshot, &module.roles, &mut closures);
        Self {
            module,
            hierarchy,
            closures: SharedClosures::with_entries(closures, naming.parameter_entries.clone()),
            naming,
            generics,
            overload_results,
            structural,
            class_instances,
            thenables,
            target_copies: constructor_targets(&probe),
        }
    }

    /// A builder for one copy, wired to the program-wide naming.
    fn builder<'a>(
        &'a self,
        snapshot: &'a LoweringSnapshot<'a>,
        foreign: &'a super::runtime::ForeignTable,
        copy: Copy,
    ) -> FuncBuilder<'a> {
        let selected_result = copy.declaration.and_then(|body| {
            self.overload_results
                .get(body, &copy.suffix)
                .map(|contract| (body, contract))
        });
        let mut builder = FuncBuilder::instantiating(
            snapshot,
            foreign,
            &self.module,
            &self.hierarchy,
            self.closures.clone(),
            copy.substitution,
            copy.suffix.clone(),
        );
        builder.sources = copy.sources;
        if let Some((body, contract)) = selected_result {
            debug_assert_eq!(snapshot.implementation_of(contract.selected), body);
        }
        builder.selected_result = selected_result;
        builder.raises = copy.raises;
        builder.retyped = copy.retyped;
        builder.construct_target = copy.constructs;
        builder.class_instances = std::rc::Rc::clone(&self.class_instances);
        builder.thenables = std::rc::Rc::clone(&self.thenables);
        builder.calls.generic = Some(&self.generics.at_call);
        // A structural call names its copy the same way a generic one does, so
        // the naming site needs no second question -- one map, two sources.
        //
        // The original's answers first and this copy's on top: a call whose
        // argument is a parameter this copy re-typed names a different callee
        // copy than it does in the original, and every other call names the
        // same one. See `Structural::at_call`.
        // Which copy of a generic function this is, if it is one -- read below,
        // and taken before `copy.suffix` is moved into the contexts.
        let within = copy.declaration.map(|of| (of, copy.suffix.clone()));
        self.structural.wire_calls(&mut builder, &copy.suffix);
        // And the calls this copy of a *generic class* makes, which name their
        // callee's copy over whatever the class's parameters are bound to
        // here. On top of the program-wide answers for the same reason the
        // structural ones are: a call with nothing deferred names the same
        // copy everywhere, and one that deferred names this copy's.
        builder.calls.class = copy
            .instance
            .and_then(|at| self.generics.at_call_in.get(&at));
        // A generic function's own instance is the final override.
        builder.calls.function = within.and_then(|at| self.generics.at_call_in_copy.get(&at));
        wire_naming(&mut builder, &self.naming);
        #[cfg(test)]
        context_scaling::binding(self, &builder);
        builder
    }
}

/// Give a builder the whole of the program-wide naming.
///
/// **All of it, in one place, because taking part of it is silent.** Every
/// field of [`Naming`] exists for one reason -- a builder is made fresh per
/// function and cannot see another's -- so a site that copies two of the four
/// has that same problem for the other two, and says nothing about it.
///
/// The closure-body site was doing exactly that. Without `class_tokens` a class
/// named inside a closure fell through to "a class used as a value" while the
/// same name in the enclosing function lowered; without `written_order` an
/// object literal written inside a closure took the checker's field order
/// instead of the program's, so `Object.keys` on it disagreed with node --
/// silently, because the layout is otherwise correct and no diagnostic is
/// involved.
fn wire_naming<'a>(builder: &mut FuncBuilder<'a>, naming: &'a Naming) {
    builder.printers = naming.printers.clone();
    builder.iterators = naming.iterators.clone();
    builder.initialization = naming.initialization.clone();
    builder.qualified = &naming.qualified;
    builder.generators = &naming.generators;
    builder.throwing = &naming.throwing;
    builder.raising = &naming.raising;
    builder.withheld = &naming.withheld;
    builder.presence_keys = &naming.presence_keys;
    builder.written_order = &naming.written_order;
    builder.added_keys = naming.added_keys.clone();
    builder.class_tokens = &naming.class_tokens;
}

/// The functions bridges call to convert an argument C passes
/// ([`Conversion`]), one per name. One that does not lower is uncompiled, and
/// `bridges::check` refuses each bridge that would call it.
fn lower_conversions(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    shared: &Shared,
    lowered: &mut Lowered,
    wanted: &mut std::collections::BTreeSet<usize>,
) {
    let mut made = rustc_hash::FxHashSet::default();
    for request in std::mem::take(&mut lowered.arrivals.conversions) {
        if !made.insert(request.name.clone()) {
            continue;
        }
        let mut builder = shared.builder(
            snapshot,
            NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default),
            Copy::default(),
        );
        match builder.lower_conversion(&request) {
            Ok(func) => lowered.program.funcs.push(func),
            Err(diagnostic) => {
                lowered
                    .program
                    .uncompiled
                    .push(crate::hir::Uncompiled::refused(
                        request.name.clone(),
                        diagnostic.message.clone(),
                    ));
                lowered.diagnostics.push(diagnostic);
            }
        }
        builder.harvest(wanted, &mut lowered.arrivals);
        layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
    }
}

#[must_use]
pub fn lower(snapshot: &SemanticSnapshot) -> Lowered {
    lower_with(snapshot, &[], &rustc_hash::FxHashMap::default())
}

/// The hierarchy and the naming, each knowing what the other decided.
///
/// They are built together because two of the hierarchy's fields are **not** facts
/// `collect_hierarchy` can reach: both come from `raising_copies`, which needs no
/// hierarchy and runs inside [`naming`] -- whether a closure's raising entry may be
/// dispatched at ([`Hierarchy::closures_carry`]), and a dispatch slot for the raising
/// copy of each overridden member that has one ([`number_raising_member_slots`]). And
/// [`copy_every_override`] then needs the hierarchy to answer which members override
/// one of those, so the naming is not finished until the hierarchy exists either.
///
/// **Patched here, before anything reads either, so that one hierarchy is the only
/// one.** A slot is a table *length*: `whole_program` clones the hierarchy to patch
/// `closures_carry`, which a bool survives and an index does not -- layouts came out one
/// entry longer than the table `declare_uniform_entries` read, and `Base#raise@raises`
/// went into `funcs` where `reachable::prune` removed it.
///
/// The qualifying map before the hierarchy, because the hierarchy is what names an
/// instance method and two classes of one name must not name one. `qualified_names`
/// reads only the snapshot, so it can come first.
fn hierarchy_and_naming(
    snapshot: &LoweringSnapshot<'_>,
    foreign: &super::runtime::ForeignTable,
    closures: &[ClosureInfo],
    readers: &initialization::PrivateReaders,
) -> (Hierarchy, Naming) {
    let mut hierarchy =
        collect_hierarchy(snapshot, foreign, closures, &qualified_names(snapshot).0);
    let mut naming = naming(snapshot, closures, readers, &hierarchy);
    hierarchy.closures_carry = naming.closures_carry;
    hierarchy.gate_holder = naming.gate_holder.as_deref().map(std::sync::Arc::from);
    raising_member_slots(snapshot, &mut hierarchy, &mut naming);
    hierarchy.field_aliases = std::sync::Arc::new(field_aliases(
        snapshot, foreign, closures, &hierarchy, &naming,
    ));
    (hierarchy, naming)
}

/// As [`lower`], told which source files the project named as its roots.
///
/// `entry` is `SourceFile::uri` values -- `nts-workspace:///src/main.ts` -- and
/// an empty slice means the project named none, which is what every tsconfig
/// using only `include` does. See [`public_api`](module_exports::public_api) for what it decides and why
/// there is no way to decide it without being told.
#[must_use]
#[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
pub fn lower_with(
    snapshot: &SemanticSnapshot,
    entry: &[String],
    foreign: &super::runtime::ForeignTable,
) -> Lowered {
    let rejected = project_semantics::rejections(snapshot);
    if !rejected.is_empty() {
        return Lowered {
            rejected,
            ..Lowered::default()
        };
    }
    // NTS_TRACE_LOWERING is a test instrument counting actual raw lowerings.
    // It appends one line per invocation so sharing guards measure work done.
    // Unset by default; ordinary compilation opens no trace file.
    if let Some(path) = std::env::var_os("NTS_TRACE_LOWERING") {
        use std::io::Write as _;
        let recorded = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)
            .and_then(|mut file| writeln!(file, "lower_with"));
        if let Err(error) = recorded {
            eprintln!("could not record raw lowering: {error}");
        }
    }
    // The instantiations generic bodies make of other generics, written into
    // the snapshot first, so every pass below meets them as the checker's
    // own. See `instantiate`. A clone only where there is something to add.
    // Types at or after this index in the materialised snapshot were made
    // here, not read from the checker: they never proved their ancestry.
    let original_types = snapshot.types.len();
    let materialised = super::instantiate::materialise(snapshot);
    let indexed = LoweringSnapshot::new(materialised.as_ref().unwrap_or(snapshot));
    let snapshot = &indexed;
    let mut lowered = Lowered::default();
    let mut layout_collector = LayoutCollector::default();
    // Closures first, because a module-scope `const f = () => ...` is typed by
    // the *closure* the arrow becomes rather than by its function type, and the
    // closure's layout is decided here. `collect_closures` reads only the
    // snapshot, so the order is free.
    let readers = initialization::PrivateReaders::new(&FuncBuilder::probe(snapshot));
    let closures = collect_closures(snapshot, &readers);
    // The hierarchy and the naming before the module scope, because the module scope's
    // probe lays out classes and a layout built without the hierarchy is a different
    // layout. See `hierarchy_and_naming` for why the two are built together.
    let (hierarchy, naming) = hierarchy_and_naming(snapshot, foreign, &closures, &readers);
    let module = collect_module_scope(snapshot, foreign, &closures, &hierarchy, &naming);
    lowered.diagnostics.extend(module.refusals.iter().cloned());
    lowered.program.globals.clone_from(&module.globals);
    hierarchy.publish_uniform_slots(&mut lowered.program);
    layout_collector.collect(&mut lowered.program, module.layouts.clone());
    let mut wanted: std::collections::BTreeSet<usize> = std::collections::BTreeSet::new();

    let generic = generic_classes(snapshot);
    let mut shared = Shared::whole_program(snapshot, module, hierarchy, &closures, naming);
    let refused = mark_refused_initializers(snapshot, &mut shared, &mut lowered);
    let hierarchy = &shared.hierarchy;
    #[cfg(test)]
    result_overload_tests::observe(
        "shared-after-value-registration",
        snapshot,
        &shared.generics,
    );
    // With the variants `Shared` added: every walk below that asks which
    // closures exist, and the loop that lowers them, sees the same list the
    // builders do.
    let closures = shared.closures.clone();
    // Which declarations the walk refused, by node. See the note where they are
    // inserted: a refusal's *location* is the offending construct and routinely
    // sits outside the declaration it refused, so a span test cannot answer
    // this and only the walk knows.
    let mut refused_functions: rustc_hash::FxHashSet<NodeId> = rustc_hash::FxHashSet::default();

    for (index, node) in snapshot.nodes.iter().enumerate() {
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));

        // A class contributes one function per method and constructor, each
        // taking the instance as its first parameter. There is no dispatch to
        // arrange: the checker resolved every call site, so a method call is a
        // static call and `this` is an ordinary argument.
        if lower_members_of(
            &mut layout_collector,
            snapshot,
            foreign,
            id,
            &generic,
            &shared,
            &mut lowered,
            &mut wanted,
        ) {
            continue;
        }

        if not_a_plain_function(node.kind, &closures, id) {
            continue;
        }
        // An `async` function is refused rather than lowered, and the reason it
        // needs saying is that it was neither before. `Promise<number>` has no
        // representation, so the return type resolved to `void`, the returned
        // value was converted away, and the verifier accepted the result -- a
        // function that computes the right number and discards it, with no
        // diagnostic. `await` and `new Promise` were both properly refused; it
        // was bare `async` that was accepted and wrong.
        //
        // Refusing it is not the feature. A promise is a value with a
        // representation and a suspension is a transformation of the function,
        // and neither exists yet; until they do, saying so is the whole of what
        // this compiler can honestly do.
        // The shapes that are refused *by name*, ahead of the blanket refusal
        // below.
        //
        // Ordered this way on purpose. While `async` is refused wholesale these
        // three are refused with it, so a specific diagnostic added afterwards
        // would be a rule with no case reaching it -- and the day the blanket
        // comes off, each of these would silently start compiling as though the
        // hard part were not there. Checking them first means they are live and
        // testable now, and stay so.
        if let Some(what) = refused_by_name(snapshot, id) {
            refused_functions.insert(id);
            let diagnostic = refusal_by_name(snapshot, id, what);
            note_a_refused_function(snapshot, &shared, foreign, &mut lowered, id, diagnostic);
            continue;
        }

        // `declare function f(): number` has no body because it is *external*,
        // not because this lowering failed to understand it. Refusing it says
        // the opposite, and -- since a caller of a refused function is refused
        // too -- took every function that reaches the platform with it. An
        // overload signature has the same shape and the same answer: the
        // implementation that follows is the one to lower.
        if !FuncBuilder::probe(snapshot).has_a_body(id) {
            continue;
        }
        // Two functions cannot share a name: the emitted C would define one
        // twice. Where they come from different modules `naming` qualifies
        // them; where they come from the same one there is nothing to qualify
        // with, and both are refused rather than the second -- emitting the
        // first and dropping the second is a program that compiles and calls
        // the wrong one.
        if shared.naming.ambiguous.contains(&id) {
            lowered.diagnostics.push(ambiguous_name(snapshot, id));
            continue;
        }
        let copies = function_copies(
            snapshot,
            &shared.generics,
            &shared.structural,
            &shared.naming.raising,
            id,
        );
        // **An empty answer is two different things, and only one of them is
        // silence worth keeping.** A generic nothing calls is dead, and
        // reporting it would refuse a program nobody wrote. A generic a call
        // *reached* and could not pin down is a function this compiler cannot
        // emit, and it used to produce no diagnostic at all -- so the cascade
        // said "calls X, which was refused above" with no refusal above, and
        // `asRequest` sat at the head of the node profile for a day while being
        // invisible to every census, because a census reads diagnostics.
        //
        // `generics.unpinned` is what tells them apart: it is written only
        // where a call matched the declaration and left a type parameter
        // unbound.
        if copies.is_empty()
            && an_uninstantiated_generic(snapshot, &shared, foreign, &mut lowered, id)
        {
            refused_functions.insert(id);
            continue;
        }
        for copy in copies {
            let probe = FuncBuilder::probe(snapshot);
            let retyped_symbols = retyped_symbols_of(&probe, id, &copy.retyped);
            let member_retyped = member_symbols(&probe, &shared.structural, id, &copy.suffix);
            let mut builder = shared.builder(snapshot, foreign, copy);
            builder.retyped_symbols = retyped_symbols;
            builder.member_retyped = member_retyped;
            match builder.lower_function(id) {
                Ok(mut func) => {
                    // A body that takes the call's `this`, and the entry by its
                    // emitted name for every caller with none to give: a plain
                    // call, an importer, the export surface.
                    if builder.declaration_reads_this(id)
                        && let Some(written) = builder.emitted_function_name(id)
                    {
                        let mut entry = passing_undefined(written, &func, 0);
                        entry.exported = std::mem::take(&mut func.exported);
                        lowered.program.funcs.push(entry);
                    }
                    lowered.program.funcs.push(func);
                }
                Err(diagnostic) => {
                    // **Recorded by declaration, not by span.** The refusal's
                    // location is the offending construct, which is routinely
                    // outside the function that was being lowered: `http`'s
                    // `createServer` at `server.ts:932` fails on a `Set` where a
                    // `Float` is wanted at `server.ts:154`, seven hundred lines
                    // above, inside the class it constructs.
                    //
                    // `super::unaccounted` asks whether any diagnostic's span
                    // *covers* the declaration, so it saw none and reported
                    // `createServer, a declaration outside every walk` -- a
                    // second message, contradicting the first, saying the
                    // function vanished when it had been refused with a cause.
                    // The Node lane ranked that message as the single largest
                    // item on the compiled axis at 274 test files, and it is a
                    // text rather than a cause: 38 sites carry it over at least
                    // three unlike shapes.
                    refused_functions.insert(id);
                    let emitted = builder.emitted_function_name(id);
                    note_uncompiled(
                        snapshot,
                        &mut lowered.program,
                        id,
                        emitted.as_deref(),
                        &diagnostic,
                    );
                    lowered.diagnostics.push(diagnostic);
                }
            }
            builder.harvest(&mut wanted, &mut lowered.arrivals);
            layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
        }
    }

    lower_module_initializer(
        &mut layout_collector,
        snapshot,
        &shared,
        &mut lowered,
        &mut wanted,
        &refused,
    );

    // Each closure something allocated, and each as a function of its own.
    // Nothing about it depends on the function that allocates it -- that is the
    // point of putting the captures in an object rather than on a chain of
    // frames.
    //
    // A worklist rather than a pass, because a closure body can allocate
    // another one. Taken in index order, so one compiler on one input emits its
    // functions in one order.
    lower_wanted_closures(
        &mut layout_collector,
        snapshot,
        foreign,
        &shared,
        &closures,
        &mut lowered,
        &mut wanted,
    );

    literal_methods::declare(
        snapshot,
        foreign,
        &shared,
        &mut lowered,
        &mut layout_collector,
    );
    (layout_collector, ()) = layout_collector.with_program(&mut lowered.program, |program| {
        access_family_functions::declare(snapshot, hierarchy, &shared.naming, program);
    });
    declare_interface_methods(
        &mut layout_collector,
        hierarchy,
        &mut shared.builder(snapshot, foreign, Copy::default()),
        &mut lowered.program,
    );
    lay_out_held_signatures(&mut layout_collector, snapshot, &mut lowered.program);
    lowered.program.layouts = layout_collector.into_layouts();
    lowered.program.view_classes = collect_view_classes(
        &shared.builder(snapshot, foreign, Copy::default()),
        &lowered.program,
    );
    relate_closures_to_signatures(snapshot, &closures, hierarchy, &mut lowered.program);
    declare_uniform_entries(snapshot, hierarchy, &mut lowered.program, &shared);

    // Stage 0: count what a fix would have to convert, before anything converts.
    // `NTS_ARRIVALS` only -- this pass changes nothing yet, and a measurement that
    // alters the program it measures is not one.
    if std::env::var_os("NTS_ARRIVALS").is_some() {
        let disagreeing = disagreeing_arrivals(&lowered.program, &lowered.arrivals);
        eprintln!(
            "ARRIVALS {} admitted, {} disagree",
            lowered.arrivals.at_signature.len(),
            disagreeing.len()
        );
        for (call, why) in &disagreeing {
            eprintln!("  ARRIVAL {call}: {why}");
        }
    }
    finish_dispatch_tables(snapshot, hierarchy, &mut lowered.program);

    publish_surface(
        &mut lowered,
        snapshot,
        &shared.naming,
        &shared.module,
        entry,
    );
    let parameter_entries = std::mem::take(&mut lowered.arrivals.parameter_entries);
    lowered.diagnostics.extend(parameter_entries::split(
        &mut lowered.program,
        &mut lowered.arrivals,
        parameter_entries,
    ));

    lowered
        .diagnostics
        .extend(collect_declared_facts(&mut lowered.program, snapshot));
    super::interface_identities::collect(
        snapshot,
        &hierarchy.faces,
        original_types,
        &mut lowered.program,
    );
    lowered
        .program
        .cast_faces
        .extend(hierarchy.cast_faces.iter().copied());
    canonicalize_objects(&mut lowered.program);
    expand_layout_tests(&mut lowered.program);
    printed::decide(
        snapshot,
        hierarchy,
        &closures,
        &shared.naming,
        &mut lowered.program,
    );
    settle_printer_checks(&mut lowered);
    printed::devirtualize(snapshot, hierarchy, &mut lowered.program);
    function_names::decide(snapshot, &closures, &mut lowered.program);
    // After every step that makes a function or publishes one: the interface
    // adapters and bridges `finish_dispatch_tables` writes move values across
    // signatures too, and `publish_surface` says which parameters a host fills.
    typed_signatures::type_signature_calls(
        snapshot,
        &closures,
        hierarchy,
        &lowered.arrivals,
        &mut lowered.program,
    );
    prune_class_tests(&mut lowered.program);
    report_unaccounted(
        snapshot,
        &mut lowered,
        &shared.generics,
        &mut refused_functions,
    );

    // Before the sweep, which then drops any attribution for a nested function
    // that turned out to be emitted after all.
    attribute_nested_to_their_refused_outer(
        snapshot,
        &shared,
        foreign,
        &mut lowered,
        &refused_functions,
    );
    // Last, because it asks what the program contains and every function that
    // will be emitted is now in it.
    drop_refusals_the_program_contradicts(&mut lowered);
    // **After the layouts are final, and after canonicalisation.** A consumer
    // resolves a class from a *layout*, so an entry whose ends do not both have
    // one is a name pointing at nothing -- and measuring it is what showed that:
    // `http` produced `TypeId(1891) <- TypeId(1890)` for two types no layout
    // answers for, and six modules produced `ReadableByteStreamHost <-
    // ReadableByteStreamHost`, two distinct ids that `Layout::types` merges into
    // one representation. That second one is a **self-edge**, which is not merely
    // useless: an ancestry walk over it does not terminate, and a JVM class
    // extending itself is a `ClassCircularityError`.
    //
    // Both are the same rule -- resolve through the layouts and keep the pair only
    // where they are two -- and it can only be applied here, because `layout_of`
    // creates layouts as lowering proceeds and `canonicalize_objects` rewrites ids
    // afterwards. Filled earlier it was the checker's answer to a question the
    // program had not finished answering.
    lowered.program.record_parents = record_parents(snapshot, hierarchy, &lowered.program);
    member_origins::sources(
        snapshot,
        &shared.closures,
        &shared.module.roles.namespace,
        &shared.naming,
        &mut lowered.program,
    );
    // Which protocol each abstract generator speaks, from the derivation its
    // layout was built from, so `suspend` need not read it back out of the
    // layout's name. Here for the same reason as the line above: every id a
    // layout answers for, after canonicalisation.
    lowered.program.abstract_generators = lowered
        .program
        .layouts
        .iter()
        .flat_map(|layout| &layout.types)
        .filter_map(|ty| Some((*ty, abstract_generator_kind(snapshot, *ty)?)))
        .collect();
    // A pure read made once per dominating read -- an erased value read as its
    // representation, a string's code unit or length -- so a guard and the use
    // it guards read one value (`hir::cse`).
    for func in &mut lowered.program.funcs {
        super::cse::reads_once(func);
    }
    lowered
}

/// What a type parameter stands for, while lowering one instantiation.
///
/// Keyed by the *type parameter's* own [`TypeId`], which is what a body's nodes
/// resolve to: the AST inside a generic method is shared by every
/// instantiation, so the checker leaves `T` there and this is what turns it
/// into the machine type for the copy being lowered.
pub use super::generics::Substitution;

/// A block under construction.
#[derive(Default)]
struct PartialBlock {
    params: Vec<ValueId>,
    ops: Vec<ValueId>,
    /// `None` until the block is terminated. A block that reaches its end without
    /// one is still open and will be given a jump or a return.
    terminator: Option<Terminator>,
}

/// An override answering its out parameters as GJS does, as a tuple
/// (`vfunc_measure(o, s): [min, nat, …]`), reached through a wrapper of its
/// slot's C shape: `name`, taking the override's parameters and then a
/// pointer per out, and answering the slot's result (`lower_vfunc_slot`).
struct VfuncSlot {
    name: String,
    entry: super::native::FnPointer,
    /// Per out, in the slot's order: whether GTK may pass NULL for it.
    outs: Vec<bool>,
    /// Whether the tuple's first element is the slot's own C result.
    has_result: bool,
    member: NodeId,
}

struct FuncBuilder<'a> {
    snapshot: &'a LoweringSnapshot<'a>,
    /// Bound foreign members, keyed by `(source, span end)` of the declaration.
    /// Empty for a probe builder; see [`FuncBuilder::probe`].
    foreign: &'a super::runtime::ForeignTable,
    /// Every value the function defines.
    values: Vec<Op>,
    blocks: Vec<PartialBlock>,
    current: BlockId,
    /// Where a value must fit a written scalar kind, in this function (see
    /// [`super::obligations`]); moved onto the function by `finish`.
    obligations: Vec<super::obligations::Obligation>,
    /// The kind of each position of the tuple the function being lowered was
    /// written to return, for each `return` to be obliged to; empty unless it
    /// returns one.
    return_elements: Vec<Option<super::native::Scalar>>,
    /// The tuple literal a `return` of such a function is lowering, whose
    /// elements are obliged as each is lowered rather than read back.
    returned_literal: Option<NodeId>,
    /// Symbol index → the value holding it.
    ///
    /// This is what makes two identifiers with one symbol become one value
    /// rather than two loads.
    bindings: rustc_hash::FxHashMap<u32, ValueId>,
    /// Readiness storage for statically resolved classes, separate from values
    /// so a captured class still names its constructor rather than holding one.
    class_cells: rustc_hash::FxHashMap<u32, ValueId>,
    /// What an `instanceof` tested, keyed by the expression's own node.
    ///
    /// `lower_instanceof` answers a `Bool` and, until this, threw away *which
    /// binding* the question was about -- so nothing after the test could act on
    /// it, and every use inside the arm re-derived the narrowing from the
    /// checker's per-node type instead. Keyed by node rather than by symbol
    /// because a function may test the same binding twice, and because
    /// [`Self::lower_if`] has the condition's node and wants the answer for that
    /// condition alone; `chain_present` keys a scoped override the same way.
    ///
    /// Only the managed-class path records here. The four representation paths
    /// convert already.
    tested_by_instanceof: rustc_hash::FxHashMap<NodeId, (u32, TypeId)>,
    /// Rebinds an `if` left behind for the statements after it, to be undone at
    /// the end of the list those statements are in.
    ///
    /// [`FuncBuilder::narrow_after_the_if`] re-types a binding for everything
    /// following an `if` whose surviving arm proved it, and that has to **end with
    /// the enclosing list**. A first version left it standing and produced invalid
    /// HIR: a guard with `continue` inside a loop narrowed a value declared outside
    /// it, and the read after the loop was `NotDominated { value, used_in }` by the
    /// unerase, which sits in the loop body. So the scope is the list, restored in
    /// reverse so two guards over one name undo in the order they were made, and
    /// only where the binding is still the value the narrowing put there -- an
    /// assignment since then is the assignment's to keep.
    narrowed_past_an_if: Vec<(u32, ValueId, ValueId)>,
    /// A label just read, waiting for the loop or `switch` it is written on.
    ///
    /// Read by the next construct that pushes a [`Breakable`], which is the
    /// one immediately inside the label -- [`Self::lower_labeled`] refuses a
    /// label on anything else, so there is nothing else it could reach.
    pending_label: Option<String>,
    /// `resolve` and `reject`, while a `new Promise` executor is being lowered.
    ///
    /// By symbol, so a name that shadows one outside the executor is unaffected
    /// and a nested `new Promise` shadows correctly -- the inner binding
    /// replaces the outer for its own symbol and nothing else.
    settlers: rustc_hash::FxHashMap<u32, Settler>,
    /// The `try` blocks this statement is inside, innermost last.
    ///
    /// On the builder and not passed down, because a `throw` can be at any
    /// depth of statement nesting below the `try` and every level between would
    /// otherwise have to carry it. Per-function by construction: a builder is
    /// one function, so a `throw` inside a closure written inside a `try` finds
    /// an empty stack -- which is correct, since the closure runs when it is
    /// called and not where it is written.
    exits: Vec<Exit>,
    /// Layouts discovered while lowering this function.
    layouts: BuilderLayouts,
    /// Whose signature a particular call's arguments answer to, where the call
    /// node's own resolved target names something else.
    ///
    /// `f.call(receiver, ...rest)` resolves to `Function.prototype.call`, whose
    /// own second parameter is a rest -- so the rest position and the rest's
    /// element type both came back describing `call` rather than `f`, and
    /// `...args` reached the ordinary argument path as ``a spread element``.
    /// The arguments belong to `f`, and this is where that is said.
    ///
    /// **Keyed by the call node, which is what makes it safe.** An argument may
    /// contain a call of its own, and that call asks these same two functions
    /// with its *own* node; the key does not match, so it gets its own
    /// signature. A bare `Option<TypeId>` would have been inherited by every
    /// nested call in the argument list.
    callee_signature: Option<(NodeId, TypeId)>,
    /// An implicit call's concrete implementation, keyed by its source site.
    /// Its syntax supplies arity and defaults when there is no call target.
    argument_declaration: Option<(NodeId, NodeId)>,
    /// A delegated call's own signature (`delegated_method`): one overload of
    /// a bound member, which no type in the snapshot carries -- a function
    /// type records its first signature only -- so it is built from the
    /// overload's parameters and held here, keyed by its call as
    /// `callee_signature` is, and asked first.
    delegated_signature: Option<(NodeId, nts_semantic_schema::SignatureRecord)>,
    /// A call whose last argument, a dictionary literal, the binding takes as
    /// its members (`dictionary_spread`): the call, the literal, and each
    /// argument as the binding's parameters take them.
    dictionary_slots: Option<(NodeId, NodeId, Vec<Option<NodeId>>)>,
    /// The receiver, in a method.
    this: Option<ValueId>,
    /// Field initializers being expanded at their allocation sites. A `new`
    /// inside an initializer can reach that same initializer directly or
    /// through another class; only repetition on the active path is recursive.
    initializing_fields: Vec<NodeId>,
    /// The type this function's `return` statements must produce.
    ///
    /// Kept on the builder because a `return` needs it while the body is being
    /// lowered, and until now it was only known at `close_body`. A returned
    /// value is coerced to it -- `function f(): unknown { return n }` returns
    /// an erased value -- and without that the mismatch lowered with nothing
    /// refused and failed in C, because the verifier checks call arguments and
    /// not returns.
    returns: HirType,
    /// The selected overload result of THIS implementation copy. Written
    /// parameters/defaults stay implementation-owned; this is no annotation rewrite.
    selected_result: Option<(NodeId, overload_results::Contract)>,
    /// This copy's specialization context, shared with its raising form.
    suffix: String,
    /// What each function declaration is emitted as, where its plain name is
    /// taken by another module's.
    qualified: &'a rustc_hash::FxHashMap<NodeId, String>,
    /// The program's call plans, with this copy's overrides. Both the suffix
    /// and retyped parameters are read from the same selected structural row.
    calls: CallContext<'a>,
    /// In a copy over union members, the parameters (and their `const`
    /// aliases) re-typed to one, which decide `typeof` tests on them.
    member_retyped: rustc_hash::FxHashSet<u32>,
    /// What each generic class instantiation binds, by the instance's type.
    /// See `Shared::class_instances`.
    class_instances: std::rc::Rc<rustc_hash::FxHashMap<TypeId, Substitution>>,
    /// Which classes are thenables, and how a promise is resolved with one.
    /// See [`Thenable`](thenable_jobs::Thenable).
    thenables: std::rc::Rc<Thenables>,
    /// Which of *this* copy's own parameters are re-typed, by position. Empty
    /// for every function that is not a structural specialisation.
    retyped: Retyped,
    /// The symbols this copy re-types, at the copy's types: the re-typed
    /// parameters and every `const` alias of them -- `retyped_symbols_of` --
    /// or, for a closure variant, its re-typed captures and their aliases. A
    /// binding of one of these takes the copy's type rather than the
    /// declaration's, which is how `const stream = source;` in a copy over
    /// `Writable` holds a `Writable` and not a cast to the interface.
    retyped_symbols: std::collections::BTreeMap<u32, HirType>,
    /// Whether this function is a constructor.
    ///
    /// The one place a `readonly` field may be written: TypeScript permits it
    /// and this compiler was refusing it, which is a refusal of valid code
    /// rather than a construct it does not understand.
    in_constructor: bool,
    /// In a constructor whose base makes the instance: what its `super(...)`
    /// makes `this` with ([`MadeBy`]).
    made_by: Option<MadeBy>,
    /// The class a typed-array construction makes its view an instance of
    /// ([`OpKind::ViewOfClass`]): set where a class extending a typed array is
    /// built, and taken by the construction before it lowers its arguments, so
    /// a typed array built among them is not given it.
    view_made_as: Option<TypeId>,
    /// The class this constructor copy constructs, where it is run for a class
    /// that inherits it: `new Octets(4)` runs `Counted`'s constructor keyed on
    /// `Octets`, and its `super(...)` makes the view an `Octets`. `None` in a
    /// constructor run for its own class. The key `new.target` would read.
    construct_target: Option<TypeId>,
    /// An override just lowered that answers its out parameters as a tuple:
    /// the slot wrapper the member loop builds for it (`lower_vfunc_slot`).
    vfunc_slot: Option<VfuncSlot>,
    /// The chain-up (`super.vfunc_clicked()`) whose callee is being built
    /// from the overridden declaration, which is a virtual function a direct
    /// call of is otherwise refused.
    chaining_up: Option<NodeId>,
    /// Lowering a method the runtime calls through an entry point of its own:
    /// see [`ObjcEntry`].
    objc_entry: Option<ObjcEntry>,
    /// Where such a method writes the record it returns by value: the
    /// address its entry point passes, as the method's last parameter. A
    /// `return` copies the record there.
    record_out: Option<ValueId>,
    /// While an override of a composable Windows Runtime class is lowered,
    /// what its adapter passes it: see [`ComEntry`].
    com_entry: Option<ComEntry>,
    /// An override's lent `HSTRING` parameters, bound to the strings their
    /// text is copied into once the parameter list is complete: the symbol,
    /// the handle, its name's node and the string's type.
    pending_hstrings: Vec<(u32, ValueId, NodeId, HirType)>,
    /// Labels parameters taken as arguments, whose objects are made once
    /// every parameter is: a backend names parameters by position, so none
    /// may come after another value.
    pending_labels: Vec<(NodeId, Vec<(String, ValueId)>)>,
    /// What the module declares outside any function.
    module: &'a ModuleScope,
    initialization: std::rc::Rc<initialization::Analysis>,
    /// What every class in the program declares, and what it extends.
    hierarchy: &'a Hierarchy,
    /// The class this method's own class extends, if it extends one.
    ///
    /// `super(...)` and `super.m()` name it, and nothing else can: the checker
    /// resolves a `super` call to the base's declaration, but the *name* of the
    /// function to emit is this compiler's own construction.
    base: Option<String>,
    /// Every arrow function in the program, so that one written here can be
    /// matched to the class that was collected for it.
    closures: SharedClosures,
    /// The symbols whose cell needs a `ready` flag, sorted.
    ///
    /// A subset of `boxed`: only a name declared below the closure that reads
    /// it has a window in which the cell exists and holds nothing.
    guarded: std::rc::Rc<[u32]>,
    /// Whether the body being lowered is a closure's.
    ///
    /// The guard above is needed there and nowhere else: a direct read before a
    /// declaration in the same scope is rejected by the typechecker, so a
    /// closure body is the only way into that window.
    in_closure: bool,
    /// Every symbol some closure captures by reference, sorted.
    ///
    /// Derived from `closures` rather than passed alongside it, so the two
    /// cannot disagree. A symbol's position here is its cell's identity, and
    /// every function that mentions the variable resolves to the same one.
    boxed: std::rc::Rc<[u32]>,
    /// What each type parameter stands for, while lowering one instantiation of
    /// a generic class. Empty everywhere else, which is every function that is
    /// not one of those copies.
    substitution: Substitution,
    /// The *source* types behind `substitution`, for the one question a
    /// representation cannot answer: how many positions a tuple has. See
    /// [`super::generics::Sources`].
    sources: super::generics::Sources,
    /// The foreign function whose arguments are being lowered, and how many
    /// leading C arguments the program did not write (a method's receiver):
    /// what an omitted argument reads its `@ntsDefault` from. Set around the
    /// arguments only, and restored after, so a foreign call inside one of
    /// them does not leave its own behind. And the call node it is for: a call
    /// to a program function inside an argument -- `createElement(tags[pick(1)])`
    /// -- lowers its own arguments without replacing this, so a question about
    /// *its* parameters must not be answered from the foreign function's.
    omitting_for: Option<(std::sync::Arc<super::native::Function>, usize, NodeId)>,
    /// The arguments' own source types until a closure call erases them.
    /// A call's result type cannot say what a null argument pointer means.
    /// Tuple spreads record each position's type, rather than the tuple's.
    argument_sources: rustc_hash::FxHashMap<NodeId, UniformArguments>,
    /// Object literals a native call passes as its labels, marked before its
    /// arguments are lowered: each is lowered a property at a time and never
    /// built (`Role::Label`).
    labels_pending: rustc_hash::FxHashSet<NodeId>,
    /// Object literals a native call passes where it takes a `Copied<T>`,
    /// marked with the struct's storage type before its arguments are
    /// lowered: each is written straight into the struct and never built
    /// (`Role::Copied`).
    copied_pending: rustc_hash::FxHashMap<NodeId, HirType>,
    /// What each such literal's storage was lent -- an `HSTRING` per string
    /// field -- until the call passing it takes it into its own `Lent`s.
    copied_lent: rustc_hash::FxHashMap<ValueId, Vec<Lent>>,
    /// A `GObject` class's state field that is a property (`Property<T>`),
    /// as a place resolved it -- the state object and the field -- with the
    /// instance and the thunk a write of it calls to notify.
    notifying: rustc_hash::FxHashMap<(ValueId, u32), (ValueId, super::native::GObjectThunk)>,
    /// Each boxed record's pointer `coerce` read out of a box for a C
    /// argument, and the box: the call that passes the pointer lends the box
    /// (`Lent::Boxed`), so it lives until C is done with it.
    unboxed: rustc_hash::FxHashMap<ValueId, ValueId>,
    /// What each labels literal lowered to, by the placeholder that stood for
    /// it among the arguments: each property's value, by key.
    labels_lowered: rustc_hash::FxHashMap<ValueId, Vec<(String, ValueId)>>,
    /// The `?.` links of the optional chain being lowered whose receiver has
    /// been tested and found present, each with that receiver
    /// ([`Self::lower_chain`]): lowered as the plain link it is in that arm.
    chain_present: rustc_hash::FxHashMap<NodeId, ValueId>,
    /// A receiver whose assertion presence check belongs to the access.
    access_receiver: Option<access::Pending>,
    parameter_entry: Option<NodeId>,
    parameter_types: std::collections::BTreeMap<u32, parameter_entries::PublicInput>,
    parameter_cut: Option<parameter_entries::Cut>,
    /// Body function bindings which parameter expressions separate from the
    /// parameter of the same name, even when the checker merges their symbol.
    parameter_body_functions: std::collections::BTreeMap<u32, NodeId>,
    /// The parameter properties of the constructor being lowered, waiting for
    /// its class's own fields: [`FuncBuilder::initialize_own_fields`] stores
    /// them right after those fields are made, which is where JavaScript puts
    /// them -- after `super()` in a derived class, and after the field
    /// initialisers in every class.
    pending_parameter_properties: Vec<(NodeId, u32)>,
    /// The object each member read was made on, by the read's node
    /// ([`Self::member_of`]): the `this` a call of what it read passes, which
    /// `o.f?.()` needs after lowering `o.f` as a value.
    read_from: rustc_hash::FxHashMap<NodeId, ValueId>,
    /// While a `super.m()` to an Objective-C superclass is lowered, the
    /// program's class it is written in: the message it builds goes to the
    /// superclass's implementation (`native::Send::super_of`).
    super_send: Option<String>,
    /// While a call through a Windows Runtime slot no `@ntsVtable` names is
    /// lowered, that slot and its method's name: `super.m()` in a class over a
    /// composable class (`m` in its overridable interface, on the base's
    /// implementation), or a property's getter or setter (`@ntsGet 6
    /// get_Content`).
    forced_slot: Option<(u32, String)>,
    /// The type a bare `null` should take, where the caller knows it.
    ///
    /// `contextual_type` recovers this from the tree for the shapes the tree
    /// describes. What it cannot reach is a call whose signature the checker
    /// resolved into `lib.d.ts` -- `piles.fill(null)` is an array method, and
    /// the parameter type is the element type this compiler decided rather
    /// than one any node carries.
    expecting: Option<HirType>,
    /// How many names this lowering has invented.
    ///
    /// A `for...of` needs an index the source does not name, and the loop
    /// machinery is keyed by symbol. Numbering down from the top keeps a
    /// synthetic name from colliding with one the checker assigned.
    synthetic: u32,
    /// What encloses the statement being lowered, innermost last.
    ///
    /// `break` and `continue` name no target in the source, so the target is
    /// wherever they are — which is a stack rather than a value.
    breakables: Vec<Breakable>,
    /// Where a `return` goes when the body being lowered is an *inlined*
    /// callback, innermost last.
    ///
    /// An array method compiled as a loop puts the callback's body inside the
    /// caller, and a `return` there means "this element is done", not "this
    /// function is done". Lowering it as an ordinary return emitted `return;`
    /// in the middle of a function with a result -- C that clang rejects, from
    /// a lowering that reported nothing refused.
    ///
    /// Empty everywhere else, so `return` keeps its ordinary meaning outside
    /// one of these bodies.
    callback_returns: Vec<CallbackReturn>,
    /// The promise an `async` function settles, and what it settles with.
    ///
    /// Set for the whole of an `async` body and `None` everywhere else, so
    /// `return e` means "settle this and hand the promise back" there and
    /// keeps its ordinary meaning otherwise.
    async_result: Option<AsyncResult>,
    /// The frame a `function*` yields into, where this is one.
    ///
    /// The mirror of `async_result` and set the same way: for the whole of a
    /// generator body and `None` everywhere else, so `yield` means something
    /// there and is refused everywhere else.
    generator: Option<super::GeneratorFrame>,
    /// Which generator each `function*` is, decided once by [`naming`].
    generators: &'a rustc_hash::FxHashMap<NodeId, usize>,
    /// The values in this function that are a generator frame *this call site
    /// made*, and so whose resumption is named after the callee.
    ///
    /// The op cannot answer it. `OpKind::Call` says the call was direct and
    /// says nothing about what it called being a generator, and the two are not
    /// the same question: a plain function handing back a generator someone
    /// else made is a direct call whose name has no resumption. Recorded where
    /// the reservation is read, because that is the only place that knows.
    generator_calls: rustc_hash::FxHashSet<ValueId>,
    /// Which functions can raise a `throw`. See [`Naming::throwing`].
    throwing: &'a rustc_hash::FxHashSet<u32>,
    /// The descriptor's implicit call edges, shared with throwing analysis.
    printers: std::rc::Rc<printed::Plan>,
    iterators: std::rc::Rc<iterator_calls::Plan>,
    /// The declarations a raising copy exists for. See [`raising_copies`](fn@raising_copies).
    raising: &'a rustc_hash::FxHashSet<NodeId>,
    /// For a `(root, member)` family whose raising slot was **withheld**: the member
    /// that withheld it. [`Naming::withheld`] carries why it is published rather than
    /// derived here, and the two refusal sites below are its readers.
    withheld: &'a rustc_hash::FxHashMap<(TypeId, MemberKey), Vec<String>>,
    /// The calls in this body that name a raising copy, and so are followed by
    /// a test. Written by [`Self::lower_try`] and by the raising walk; read by
    /// [`Self::push_call`], which is the one place a plain call is emitted.
    raising_calls: rustc_hash::FxHashSet<NodeId>,
    /// Calls whose selected source specialization has its own raising entry.

    /// Whether this body is a **raising copy**: one reached only from call
    /// sites that test for a raise afterwards.
    ///
    /// A `throw` with no handler in an ordinary function ends the program,
    /// which is what node does when nobody catches and what every caller of
    /// that function is compiled to expect. A `try` around a call needs the
    /// opposite, and the two cannot be one body -- so the callee is copied,
    /// exactly as a generic or a structural cast copies one, and the copy
    /// records the value and returns instead. `@raises` is its suffix.
    ///
    /// **The invariant that makes it sound: a raising copy is named only by a
    /// site that checks.** An ordinary call still names the original and still
    /// ends the program, so nothing that was correct becomes a wrong answer by
    /// this existing, and no boundary has to learn anything.
    raises: bool,
    /// Which property names an `in` asks about. See [`Naming::presence_keys`].
    presence_keys: &'a rustc_hash::FxHashSet<String>,
    /// The order the program writes each field-name set; see
    /// [`Naming::written_order`], which computes it once for the whole program.
    written_order: &'a WrittenOrders,
    /// The keys a write may add to an object after it was made: see
    /// [`added_keys`].
    added_keys: std::rc::Rc<AddedKeys>,
    /// The token index of each class used as a value; see
    /// [`Naming::class_tokens`], and its reason for being decided once.
    class_tokens: &'a rustc_hash::FxHashMap<u32, usize>,
    /// Which of them this function allocated.
    ///
    /// A closure nobody creates is not lowered at all. That is the rule
    /// module-scope declarations already follow, for the same reason: a file
    /// that declares one thing this compiler cannot represent should not be
    /// reported as failing on it unless something reaches it.
    used_closures: Vec<usize>,
    /// Functions this body's bridges call to convert an argument: harvested
    /// into [`Arrivals::conversions`].
    conversions: Vec<Conversion>,
    /// The `JSON.stringify` writers this body's calls name: harvested into
    /// [`Arrivals::json_writers`].
    json_writers: Vec<json::Writer>,
    /// See [`Arrivals`]; drained by [`FuncBuilder::harvest`].
    arrivals: Arrivals,
}

/// The empty binding table, for the probe builders below.
static NO_FOREIGN: std::sync::OnceLock<super::runtime::ForeignTable> = std::sync::OnceLock::new();

impl<'a> FuncBuilder<'a> {
    /// A builder for asking the snapshot a question -- a name, a location, a
    /// refusal -- rather than for lowering a body.
    ///
    /// Seventeen of the nineteen construction sites are this, and most were
    /// already called `probe`. They cannot reach a foreign call, so they get no
    /// binding table rather than an argument threaded through them.
    fn probe(snapshot: &'a LoweringSnapshot<'a>) -> Self {
        Self::new(
            snapshot,
            NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default),
        )
    }

    fn new(snapshot: &'a LoweringSnapshot<'a>, foreign: &'a super::runtime::ForeignTable) -> Self {
        let context = snapshot.probe_context();
        Self {
            snapshot,
            foreign,
            raises: false,
            raising: &context.naming.raising,
            withheld: &context.naming.withheld,
            raising_calls: rustc_hash::FxHashSet::default(),
            boxed: std::rc::Rc::default(),
            guarded: std::rc::Rc::default(),
            in_closure: false,
            values: Vec::new(),
            blocks: vec![PartialBlock::default()],
            current: BlockId(0),
            obligations: Vec::new(),
            return_elements: Vec::new(),
            returned_literal: None,
            bindings: rustc_hash::FxHashMap::default(),
            class_cells: rustc_hash::FxHashMap::default(),
            tested_by_instanceof: rustc_hash::FxHashMap::default(),
            narrowed_past_an_if: Vec::new(),
            settlers: rustc_hash::FxHashMap::default(),
            pending_label: None,
            exits: Vec::new(),
            returns: HirType::Void,
            selected_result: None,
            layouts: BuilderLayouts::default(),
            callee_signature: None,
            argument_declaration: None,
            delegated_signature: None,
            dictionary_slots: None,
            this: None,
            initializing_fields: Vec::new(),
            suffix: String::new(),
            qualified: &context.naming.qualified,
            calls: CallContext::default(),
            member_retyped: rustc_hash::FxHashSet::default(),
            class_instances: std::rc::Rc::default(),
            thenables: std::rc::Rc::default(),
            retyped: Retyped::new(),
            retyped_symbols: std::collections::BTreeMap::new(),
            in_constructor: false,
            made_by: None,
            view_made_as: None,
            construct_target: None,
            vfunc_slot: None,
            chaining_up: None,
            objc_entry: None,
            record_out: None,
            com_entry: None,
            pending_hstrings: Vec::new(),
            pending_labels: Vec::new(),
            hierarchy: &context.hierarchy,
            base: None,
            module: &context.module,
            initialization: context.naming.initialization.clone(),
            closures: SharedClosures::default(),
            expecting: None,
            synthetic: 0,
            breakables: Vec::new(),
            callback_returns: Vec::new(),
            async_result: None,
            generator: None,
            generators: &context.naming.generators,
            generator_calls: rustc_hash::FxHashSet::default(),
            throwing: &context.naming.throwing,
            printers: std::rc::Rc::default(),
            iterators: std::rc::Rc::default(),
            presence_keys: &context.naming.presence_keys,
            class_tokens: &context.naming.class_tokens,
            written_order: &context.naming.written_order,
            added_keys: std::rc::Rc::default(),
            used_closures: Vec::new(),
            conversions: Vec::new(),
            json_writers: Vec::new(),
            arrivals: Arrivals::default(),
            substitution: Substitution::default(),
            sources: super::generics::Sources::default(),
            omitting_for: None,
            argument_sources: rustc_hash::FxHashMap::default(),
            labels_pending: rustc_hash::FxHashSet::default(),
            copied_pending: rustc_hash::FxHashMap::default(),
            copied_lent: rustc_hash::FxHashMap::default(),
            notifying: rustc_hash::FxHashMap::default(),
            unboxed: rustc_hash::FxHashMap::default(),
            labels_lowered: rustc_hash::FxHashMap::default(),
            chain_present: rustc_hash::FxHashMap::default(),
            access_receiver: None,
            parameter_entry: None,
            parameter_types: std::collections::BTreeMap::new(),
            parameter_cut: None,
            parameter_body_functions: std::collections::BTreeMap::new(),
            pending_parameter_properties: Vec::new(),
            read_from: rustc_hash::FxHashMap::default(),
            super_send: None,
            forced_slot: None,
        }
    }

    /// The same, knowing what the module and its classes declare.
    fn within(
        snapshot: &'a LoweringSnapshot<'a>,
        foreign: &'a super::runtime::ForeignTable,
        module: &'a ModuleScope,
        hierarchy: &'a Hierarchy,
        closures: SharedClosures,
    ) -> Self {
        Self {
            module,
            hierarchy,
            boxed: closures.boxed(),
            guarded: closures.guarded(),
            closures,
            ..Self::new(snapshot, foreign)
        }
    }

    /// The same, lowering one instantiation of a generic class.
    fn instantiating(
        snapshot: &'a LoweringSnapshot<'a>,
        foreign: &'a super::runtime::ForeignTable,
        module: &'a ModuleScope,
        hierarchy: &'a Hierarchy,
        closures: SharedClosures,
        substitution: Substitution,
        suffix: String,
    ) -> Self {
        Self {
            suffix,
            substitution,
            ..Self::within(snapshot, foreign, module, hierarchy, closures)
        }
    }

    fn push_block_param(&mut self, block: BlockId, ty: HirType, origin: Origin) -> ValueId {
        let index = u32::try_from(self.blocks[block.0 as usize].params.len()).unwrap_or(0);
        let id = ValueId(u32::try_from(self.values.len()).unwrap_or(u32::MAX));
        self.values.push(Op {
            kind: OpKind::BlockParam(index),
            ty,
            origin,
        });
        self.blocks[block.0 as usize].params.push(id);
        id
    }

    /// Start a new block and return its id. Does not switch to it.
    fn new_block(&mut self) -> BlockId {
        self.blocks.push(PartialBlock::default());
        BlockId(u32::try_from(self.blocks.len() - 1).unwrap_or(u32::MAX))
    }

    fn switch_to(&mut self, block: BlockId) {
        self.current = block;
    }

    /// Whether the current block has already ended.
    ///
    /// A `return` inside a branch terminates its block, and appending a jump
    /// after it would put two terminators in one block.
    fn is_terminated(&self) -> bool {
        self.blocks[self.current.0 as usize].terminator.is_some()
    }

    /// End the current block, unless something already did.
    fn terminate(&mut self, terminator: Terminator) {
        let block = &mut self.blocks[self.current.0 as usize];
        if block.terminator.is_none() {
            block.terminator = Some(terminator);
        }
    }

    fn type_of(&self, id: NodeId) -> Option<HirType> {
        if let Some(read) = self.actual_field_read(id)
            && read.representation(self) == Some(HirType::Erased)
            && !self.narrowing_holds(id, &read)
        {
            return Some(HirType::Erased);
        }
        let ty = self.snapshot.node_types.get(&id)?;
        self.represent(*ty)
    }

    /// A type's machine representation, with this instantiation's substitution
    /// applied. The one place the two are combined.
    fn represent(&self, ty: TypeId) -> Option<HirType> {
        representation_within(
            self.snapshot,
            ty,
            &mut Vec::new(),
            &Representation {
                substitution: &self.substitution,
                cast_faces: &self.hierarchy.cast_faces,
            },
        )
    }

    fn push(&mut self, kind: OpKind, ty: HirType, origin: Origin) -> ValueId {
        let id = ValueId(u32::try_from(self.values.len()).unwrap_or(u32::MAX));
        self.values.push(Op { kind, ty, origin });
        self.blocks[self.current.0 as usize].ops.push(id);
        id
    }

    /// A member of a class the program writes over a `GObject` class: the
    /// compiled function, and -- for an override (`is_override_name`) -- the class struct
    /// slot it fills and the C signature the slot is called with, which are
    /// the overridden declaration's (`@ntsVfunc`). A constructor is refused:
    /// the instance is made by `new` with its properties, and a body run
    /// after that has no `super(...)` to open with yet.
    fn lower_gobject_member(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
    ) -> Result<(Func, Option<super::ForeignMethod>), Diagnostic> {
        if self.kind_of(member) == Some(syntax::CONSTRUCTOR) {
            return Ok((
                self.lower_gobject_constructor(class, member, instance)?,
                None,
            ));
        }
        let name = self
            .member_name(member)
            .ok_or_else(|| self.unsupported(member, "a member whose name the program computes"))?;
        // A handler the class's template names (`<signal handler="...">`):
        // GTK calls it with the signal's arguments and the instance last. A
        // template the compiler cannot read may name any method, so each one
        // a handler could be -- its parameters all C's -- is bound by name,
        // and GTK resolves the template's names against them, as in GJS.
        if let Some(template) = gobject_template(self.snapshot, class) {
            match known_handlers(&template) {
                Some(handlers) => {
                    if handlers.contains(&name) {
                        return self.lower_template_callback(class, member, instance, &name);
                    }
                }
                None => {
                    if !is_override_name(&name)
                        && self.kind_of(member) == Some(syntax::METHOD_DECLARATION)
                        && let Ok(entry) =
                            self.template_callback_entry(class, member, instance, &name)
                    {
                        return self
                            .lower_template_callback_with(class, member, instance, &name, entry);
                    }
                }
            }
        }
        if !is_override_name(&name) {
            return Ok((self.lower_method_of(class, member, instance)?, None));
        }
        // `finalize` is where a class's fields are given back, and the
        // registration installs its own for a class with fields; an override
        // would be written over, and one without chaining up would leak the
        // parent's. `dispose` is the one to override.
        if name == "vfunc_finalize" || name == "vfuncFinalize" {
            return Err(self.unsupported(member, &format!("an override of `{name}`, which gives the class's fields back; override `vfunc_dispose`")));
        }
        let receiver = instance
            .or_else(|| instance_type_of(self.snapshot, class))
            .and_then(|ty| super::native::pointer(self.snapshot, ty));
        let Some(super::native::Pointee::Opaque(handle)) = receiver else {
            return Err(self.unsupported(
                member,
                "a virtual function of a class whose instances are not a GObject handle",
            ));
        };
        let interfaces = gobject_interfaces(self.snapshot, class);
        let (declaration, slot) = self.overridden_vfunc(&handle, &interfaces, &name).ok_or_else(|| {
            let implemented = if interfaces.is_empty() { "" } else { ", the interfaces it implements," };
            self.unsupported(member, &format!("`{name}`, which overrides no virtual function of `{}`{implemented} or its ancestors", handle.tag))
        })?;
        let signature = vfunc_declaration_signature(self.snapshot, declaration)
            .cloned()
            .ok_or_else(|| self.unsupported(member, "a virtual function with no signature"))?;
        let this = signature
            .this_type
            .and_then(|ty| super::native::pointer(self.snapshot, ty))
            .ok_or_else(|| {
                self.unsupported(member, "a virtual function whose instance is not a handle")
            })?;
        // The declaration's tags, read as a call of it reads them: a slot
        // reporting through `GError **error` is `@ntsThrows error`, and its
        // `error?` is that slot rather than an optional some `@ntsDefault` fills.
        let tags = self.parameter_tags(member, Some(declaration))?;
        let outs = self.vfunc_outs(declaration);
        let (entry, has_result) = self.vfunc_entry(member, &this, signature, &tags, &outs)?;
        let func = self.lower_method_of(class, member, instance)?;
        // An override answering its out parameters as a tuple is reached
        // through a wrapper of the slot's C shape, built beside it.
        let function = if outs.is_empty() {
            func.name.clone()
        } else {
            let wrapper = format!("{}#slot", func.name);
            self.vfunc_slot = Some(VfuncSlot {
                name: wrapper.clone(),
                entry: entry.clone(),
                outs,
                has_result,
                member,
            });
            wrapper
        };
        let method = super::ForeignMethod {
            dispatch: super::Dispatch::Selector(slot),
            function,
            signature: std::sync::Arc::new(entry),
            declared_at: self.declaring_module(declaration),
        };
        Ok((func, Some(method)))
    }

    /// The out parameters a virtual function's declaration answers as a
    /// tuple (`@ntsVfuncOut minimum? natural?`), each by whether GTK may pass
    /// NULL for it. None for a slot whose outs its declaration takes.
    fn vfunc_outs(&self, declaration: NodeId) -> Vec<bool> {
        self.node(declaration)
            .native
            .as_ref()
            .and_then(|native| native.vfunc_out.as_deref())
            .map(|outs| {
                outs.split_whitespace()
                    .map(|out| out.ends_with('?'))
                    .collect()
            })
            .unwrap_or_default()
    }

    /// The C signature of an override's slot, and whether a tuple the
    /// declaration answers starts with the slot's own result. Where the
    /// declaration answers its outs as a tuple, the slot takes a pointer to
    /// each element's C scalar after the ins, and returns the tuple's first
    /// element where there is one more than the outs.
    fn vfunc_entry(
        &self,
        member: NodeId,
        this: &super::native::Pointee,
        mut signature: nts_semantic_schema::SignatureRecord,
        tags: &ParameterTags,
        outs: &[bool],
    ) -> Result<(super::native::FnPointer, bool), Diagnostic> {
        let throws = tags
            .throws
            .as_ref()
            .map(|(slot, converter)| (slot.as_str(), converter.as_str()));
        let spell = |signature: &nts_semantic_schema::SignatureRecord| {
            super::native::vfunc_signature(
                self.snapshot,
                this.clone(),
                signature,
                throws,
                &tags.defaults,
            )
            .map_err(|why| self.unsupported(member, &format!("a virtual function's {why}")))
        };
        if outs.is_empty() {
            return Ok((spell(&signature)?, false));
        }
        let (elements, has_result) = self.vfunc_answer(member, signature.return_type, outs)?;
        signature.return_type = if has_result {
            elements[0]
        } else {
            self.void_type()?
        };
        let entry = spell(&signature)?;
        let mut parameters = entry.parameters.clone();
        for element in &elements[usize::from(has_result)..] {
            match super::native::abi_type(self.snapshot, *element) {
                Some(super::native::Type::Scalar(scalar)) => parameters.push(
                    super::native::Type::Pointer(super::native::Pointee::Scalar(scalar)),
                ),
                _ => {
                    return Err(self.unsupported(
                        member,
                        "a virtual function's out parameter that is not a C scalar",
                    ));
                }
            }
        }
        Ok((
            super::native::FnPointer::spell(parameters, (*entry.result).clone()),
            has_result,
        ))
    }

    /// The elements of a tuple a virtual function's declaration answers its
    /// outs as, and whether the first of them is the slot's own C result:
    /// one element more than the outs. A single out with no result is the
    /// value itself, as a call's values form answers one.
    fn vfunc_answer(
        &self,
        id: NodeId,
        answer: TypeId,
        outs: &[bool],
    ) -> Result<(Vec<TypeId>, bool), Diagnostic> {
        let elements = match self
            .snapshot
            .types
            .get(answer.0 as usize)
            .map(|record| &record.kind)
        {
            Some(TypeKind::Tuple(tuple)) if outs.len() > 1 || tuple.elements.len() == 2 => {
                tuple.elements.clone()
            }
            _ => vec![answer],
        };
        let has_result = match elements.len().checked_sub(outs.len()) {
            Some(0) => false,
            Some(1) => true,
            _ => return Err(self.unsupported(
                id,
                "a virtual function whose answer does not match the out parameters its slot takes",
            )),
        };
        Ok((elements, has_result))
    }

    /// The wrapper an override answering its outs as a tuple is reached
    /// through: the slot's C shape -- the override's own parameters, then a
    /// pointer per out -- calling the override, storing each tuple element
    /// through its pointer (where GTK passed one, for an out it may leave
    /// NULL), and answering the slot's result, the tuple's first element.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn lower_vfunc_slot(&mut self, slot: &VfuncSlot, func: &Func) -> Result<Func, Diagnostic> {
        let origin = self.origin(slot.member);
        let mut params = Vec::new();
        let mut arguments = Vec::new();
        for (at, param) in func.params.iter().enumerate() {
            let value = self.push(
                OpKind::Param(u32::try_from(at).unwrap_or(0)),
                param.ty.clone(),
                origin.clone(),
            );
            // C's own argument, so the override's written kind: C passes the
            // type its slot declares, which the override's parameter is.
            params.push(Param {
                name: param.name.clone(),
                shape: ParamShape::Ordinary,
                ty: param.ty.clone(),
                origin: origin.clone(),
                known: Facts::TOP,
                written: param.written,
            });
            arguments.push(value);
        }
        self.this = arguments.first().copied();
        let mut pointers = Vec::new();
        for (at, ty) in slot
            .entry
            .parameters
            .iter()
            .enumerate()
            .skip(func.params.len())
        {
            let ty = ty.representation();
            let value = self.push(
                OpKind::Param(u32::try_from(at).unwrap_or(0)),
                ty.clone(),
                origin.clone(),
            );
            params.push(Param {
                name: format!("out{at}"),
                shape: ParamShape::Ordinary,
                ty: ty.clone(),
                origin: origin.clone(),
                known: Facts::TOP,
                written: None,
            });
            pointers.push((value, ty));
        }
        let answer_ty = func.return_type.clone();
        let answer = self.push(
            OpKind::Call {
                callee: Callee::Direct(func.name.clone()),
                args: arguments,
                frame: None,
            },
            answer_ty.clone(),
            origin.clone(),
        );
        let count = slot.outs.len() + usize::from(slot.has_result);
        let zero = self.push(
            OpKind::ConstInt(0),
            HirType::Int {
                bits: 64,
                signed: true,
            },
            origin.clone(),
        );
        for (at, ((pointer, ty), nullable)) in pointers
            .into_iter()
            .zip(slot.outs.iter().copied())
            .enumerate()
        {
            let HirType::NativePointer(super::native::Pointee::Scalar(scalar)) = ty.clone() else {
                return Err(self.unsupported(
                    slot.member,
                    "a virtual function's out parameter that is not a pointer to a C scalar",
                ));
            };
            let element = self.tuple_element(
                slot.member,
                answer,
                &answer_ty,
                count,
                at + usize::from(slot.has_result),
            )?;
            let value = self.coerce(
                element,
                &super::native::Type::Scalar(scalar).representation(),
                slot.member,
            )?;
            // GTK passes NULL for an output it does not want.
            let after = nullable.then(|| {
                let null = self.push(OpKind::ConstNull, ty.clone(), origin.clone());
                let absent = self.push(
                    OpKind::Binary {
                        op: BinOp::Eq,
                        lhs: pointer,
                        rhs: null,
                    },
                    HirType::Bool,
                    origin.clone(),
                );
                let (store, after) = (self.new_block(), self.new_block());
                self.terminate(Terminator::Branch {
                    cond: absent,
                    then_target: after,
                    then_args: Vec::new(),
                    else_target: store,
                    else_args: Vec::new(),
                });
                self.switch_to(store);
                after
            });
            self.push(
                OpKind::NativeStore {
                    pointer,
                    index: zero,
                    value,
                },
                HirType::Void,
                origin.clone(),
            );
            if let Some(after) = after {
                self.terminate(Terminator::Jump {
                    target: after,
                    args: Vec::new(),
                });
                self.switch_to(after);
            }
        }
        let result = slot.entry.result.representation();
        self.returns = result.clone();
        if slot.has_result {
            let element = self.tuple_element(slot.member, answer, &answer_ty, count, 0)?;
            let value = self.coerce(element, &result, slot.member)?;
            self.terminate(Terminator::Return(Some(value)));
        } else {
            self.terminate(Terminator::Return(None));
        }
        Ok(self.finish(slot.name.clone(), params, result, origin, false))
    }

    /// A method a template names as a signal's handler: lowered as any method,
    /// with an entry point shaped as a virtual function's -- the instance
    /// first, then the method's own parameters in C -- which the backend's
    /// shim reaches with the instance moved from last, where GTK passes it.
    fn lower_template_callback(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
        name: &str,
    ) -> Result<(Func, Option<super::ForeignMethod>), Diagnostic> {
        let entry = self.template_callback_entry(class, member, instance, name)?;
        self.lower_template_callback_with(class, member, instance, name, entry)
    }

    /// The method `name` lowered with `entry`, its entry point as a
    /// template's handler.
    fn lower_template_callback_with(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
        name: &str,
        entry: super::native::FnPointer,
    ) -> Result<(Func, Option<super::ForeignMethod>), Diagnostic> {
        let func = self.lower_method_of(class, member, instance)?;
        let method = super::ForeignMethod {
            dispatch: super::Dispatch::Selector(format!("callback {name}")),
            function: func.name.clone(),
            signature: std::sync::Arc::new(entry),
            declared_at: None,
        };
        Ok((func, Some(method)))
    }

    /// The entry point a method has as a template's handler: the instance,
    /// then its own parameters, each in C. Refused, by name, for a parameter
    /// or a result with no C type.
    fn template_callback_entry(
        &self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
        name: &str,
    ) -> Result<super::native::FnPointer, Diagnostic> {
        let receiver = instance
            .or_else(|| instance_type_of(self.snapshot, class))
            .and_then(|ty| super::native::pointer(self.snapshot, ty))
            .ok_or_else(|| {
                self.unsupported(
                    member,
                    "a template's handler on a class whose instances are not a GObject handle",
                )
            })?;
        let signature = super::generics::declared_signature(self.snapshot, member)
            .cloned()
            .ok_or_else(|| self.unsupported(member, "a template's handler with no signature"))?;
        let mut parameters = vec![super::native::Type::Pointer(receiver)];
        for parameter in &signature.parameters {
            parameters.push(
                super::native::abi_type(self.snapshot, parameter.ty).ok_or_else(|| {
                    self.unsupported(
                        member,
                        &format!(
                            "a template's handler `{name}` whose parameter `{}` has no C type",
                            parameter.name
                        ),
                    )
                })?,
            );
        }
        let result =
            super::native::abi_type(self.snapshot, signature.return_type).ok_or_else(|| {
                self.unsupported(
                    member,
                    &format!("a template's handler `{name}` whose result has no C type"),
                )
            })?;
        Ok(super::native::FnPointer::spell(parameters, result))
    }

    /// `{Class}#template`: the string a class's `static template` holds, for
    /// a template known only at run time. `class_init` calls it when GTK
    /// first sets the class up, after the module has run the initialiser.
    fn lower_template_reader(&mut self, member: NodeId, name: &str) -> Result<Func, Diagnostic> {
        let origin = self.origin(member);
        // The symbol is the declaration's name's, as a read of it finds it.
        let symbol = self
            .children(member)
            .into_iter()
            .find(|&child| self.kind_of(child) == Some(syntax::IDENTIFIER))
            .and_then(|name| self.node(name).symbol)
            .ok_or_else(|| self.unsupported(member, "a `static template` with no symbol"))?;
        if let Some(reason) = self.module.unsupported.get(&symbol.0) {
            let reason = reason.clone();
            return Err(self.unsupported(member, &reason));
        }
        let global = self
            .module
            .variables
            .get(&symbol.0)
            .copied()
            .ok_or_else(|| {
                self.unsupported(member, "a `static template` the module does not store")
            })?;
        let ty = self.module.types[global as usize].clone();
        if ty != HirType::Managed(ManagedType::String) {
            return Err(self.unsupported(
                member,
                "a `static template` that is not a `string`: GJS's `Template` as XML or a URI",
            ));
        }
        self.this = None;
        self.returns = ty.clone();
        let read = self.push(OpKind::GlobalGet(global), ty.clone(), origin.clone());
        self.terminate(Terminator::Return(Some(read)));
        Ok(self.finish(name.to_owned(), Vec::new(), ty, origin, false))
    }

    /// The virtual function `name` (`vfunc_clicked`) a class whose instances
    /// are `handle` inherits: the declaration a binding writes on the nearest
    /// ancestor that has one, and its slot (`GtkButtonClass clicked`). A
    /// binding declares a class as a type, not a class, so this is found by
    /// the method's own `this`, whose tag is on the handle's chain -- or by
    /// its slot, one of an interface's the class implements (`interfaces`,
    /// `GListModelInterface g_list_model_get_type`), which wins over a
    /// class's slot of the same name.
    fn overridden_vfunc(
        &self,
        handle: &super::native::Handle,
        interfaces: &[String],
        name: &str,
    ) -> Option<(NodeId, String)> {
        let chain: Vec<&str> = handle
            .ancestors
            .iter()
            .map(String::as_str)
            .chain(std::iter::once(handle.tag.as_str()))
            .collect();
        self.snapshot
            .nodes
            .iter()
            .enumerate()
            .filter(|(_, node)| {
                node.kind == nts_semantic_schema::NodeKind::Syntax(syntax::METHOD_SIGNATURE)
            })
            .filter_map(|(at, node)| {
                let slot = node.native.as_ref()?.vfunc.clone()?;
                let declaration = NodeId(u32::try_from(at).ok()?);
                if self.member_name(declaration).as_deref() != Some(name) {
                    return None;
                }
                let structure = slot.split_whitespace().next()?;
                if interfaces
                    .iter()
                    .any(|interface| interface.split_whitespace().next() == Some(structure))
                {
                    return Some((chain.len(), declaration, slot));
                }
                let this =
                    super::generics::declared_signature(self.snapshot, declaration)?.this_type?;
                let Some(super::native::Pointee::Opaque(owner)) =
                    super::native::pointer(self.snapshot, this)
                else {
                    return None;
                };
                let depth = chain.iter().position(|tag| *tag == owner.tag)?;
                Some((depth, declaration, slot))
            })
            .max_by_key(|(depth, ..)| *depth)
            .map(|(_, declaration, slot)| (declaration, slot))
    }

    /// A method of a class the program writes over an Objective-C class: the
    /// compiled function, and how the runtime reaches it -- the selector
    /// `@ntsSelector` names or Swift's `@objc` rule makes of its name
    /// (`pressed(sender)` is `pressed:`), and the C signature it is called
    /// with.
    /// One member of a class the program writes over a composable Windows
    /// Runtime class: a method overriding one its base declares for
    /// overriding (`@ntsOverride`), compiled as the program's function taking
    /// the instance and the arguments, and recorded with the adapter
    /// signature its interface's table calls it by. Anything else is refused
    /// by name: the runtime makes the object, so it has no constructor of the
    /// program's, and no room for a field.
    fn lower_com_member(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
    ) -> Result<(Func, Option<super::ForeignMethod>), Diagnostic> {
        match self.kind_of(member) {
            Some(syntax::METHOD_DECLARATION) => {}
            Some(syntax::CONSTRUCTOR) => return Ok((self.lower_com_constructor(class, member, instance)?, None)),
            _ => return Err(self.unsupported(member, "a member of a class written over a composable Windows Runtime class that is not a method")),
        }
        let name = self
            .member_name(member)
            .ok_or_else(|| self.unsupported(member, "a member whose name the program computes"))?;
        // A method that overrides nothing is the program's own, called with
        // the instance as any class's method is; no table answers it.
        let Some((iid, slot, overridden)) = self.overridden_slot(class, &name) else {
            return Ok((self.lower_method_of(class, member, instance)?, None));
        };
        // The table's slot is called as the binding declares it -- an
        // `int32` is an `int32` however the override spells its parameter --
        // and the adapter converts to what the compiled method takes.
        let signature = super::generics::declared_signature(self.snapshot, overridden)
            .cloned()
            .ok_or_else(|| {
                self.unsupported(member, "an override whose binding declares no signature")
            })?;
        let adapter = super::native::override_signature(self.snapshot, &signature)
            .map_err(|why| self.unsupported(member, &format!("an override's {why}")))?;
        let hstrings = signature
            .parameters
            .iter()
            .enumerate()
            .filter(|(_, parameter)| super::native::is_hstring(self.snapshot, parameter.ty))
            .fold(0u64, |mask, (at, _)| mask | (1u64 << (at + 1).min(63)));
        self.com_entry = Some(ComEntry {
            returns_record: matches!(*adapter.result, super::native::Type::Record(_)),
            hstrings,
        });
        let func = self.lower_method_of(class, member, instance);
        self.com_entry = None;
        let func = func?;
        let method = super::ForeignMethod {
            dispatch: super::Dispatch::Slot { iid, slot },
            function: func.name.clone(),
            signature: std::sync::Arc::new(adapter),
            declared_at: None,
        };
        Ok((func, Some(method)))
    }

    /// The slots of the interfaces the class overrides some of that it does
    /// not override, each with the signature it is called with: the base
    /// declares it overridable at the same IID, and no method of the class
    /// answers its slot. A binding lists an overridable interface on every
    /// class deriving from its declarer, so a slot is taken once, nearest
    /// base first. `Err` names the first that cannot be forwarded, and why.
    fn forwarded(
        &self,
        class: NodeId,
        methods: &[super::ForeignMethod],
    ) -> Result<Vec<super::native::Forwarded>, (String, String)> {
        let mut answered: Vec<(String, u32)> = methods
            .iter()
            .filter_map(|method| match &method.dispatch {
                super::Dispatch::Slot { iid, slot } => Some((iid.clone(), *slot)),
                super::Dispatch::Selector(_) => None,
            })
            .collect();
        let used: Vec<String> = answered.iter().map(|(iid, _)| iid.clone()).collect();
        let mut forwarded = Vec::new();
        let mut at = super::native::superclass(self.snapshot, class);
        while let Some(base) = at {
            for member in self.children(base) {
                let Some(tag) = self
                    .node(member)
                    .native
                    .as_ref()
                    .and_then(|native| native.overridable.clone())
                else {
                    continue;
                };
                let words: Vec<&str> = tag.split_whitespace().collect();
                let [iid, slot, name, ..] = words.as_slice() else {
                    continue;
                };
                let Ok(slot) = slot.parse::<u32>() else {
                    continue;
                };
                if !used.iter().any(|used| used == iid)
                    || answered.iter().any(|(done, at)| done == iid && *at == slot)
                {
                    continue;
                }
                let signature = super::generics::declared_signature(self.snapshot, member)
                    .ok_or_else(|| {
                        (
                            (*name).to_owned(),
                            "its binding declares no signature".to_owned(),
                        )
                    })?;
                let signature = super::native::forward_signature(self.snapshot, signature)
                    .map_err(|why| ((*name).to_owned(), why))?;
                answered.push(((*iid).to_owned(), slot));
                forwarded.push(super::native::Forwarded {
                    iid: (*iid).to_owned(),
                    slot,
                    signature: std::sync::Arc::new(signature),
                });
            }
            at = super::native::superclass(self.snapshot, base);
        }
        Ok(forwarded)
    }

    /// The interface and slot a base the program's class extends declares a
    /// method of this name overridable at (`@ntsOverride <IID> <slot> <name>`),
    /// nearest base first, and the binding's declaration of it.
    fn overridden_slot(&self, class: NodeId, name: &str) -> Option<(String, u32, NodeId)> {
        let mut at = super::native::superclass(self.snapshot, class);
        while let Some(base) = at {
            for member in self.children(base) {
                let tagged = self
                    .node(member)
                    .native
                    .as_ref()
                    .and_then(|native| native.overridable.clone());
                if let Some(tag) = tagged
                    && self.member_name(member).as_deref() == Some(name)
                {
                    let words: Vec<&str> = tag.split_whitespace().collect();
                    if let [iid, slot, ..] = words.as_slice() {
                        return Some(((*iid).to_owned(), slot.parse().ok()?, member));
                    }
                }
            }
            at = super::native::superclass(self.snapshot, base);
        }
        None
    }

    /// The selector a method of a class the program writes answers: the one
    /// `@ntsSelector` gives it, else the one a protocol the class adopts
    /// declares for a member of its name, else the one of the superclass's
    /// method it overrides -- `draw(_:)` is `drawRect:` -- else Swift's
    /// `@objc` rule for its name. What the runtime registers the method
    /// under, and what `selector(Class, "name")` answers.
    fn program_method_selector(
        &self,
        class: NodeId,
        member: NodeId,
        name: &str,
        arity: usize,
    ) -> String {
        self.node(member)
            .native
            .as_ref()
            .and_then(|native| native.selector.clone())
            .or_else(|| self.protocol_selector(class, name))
            .or_else(|| self.overridden_selector(class, name, arity))
            .unwrap_or_else(|| objc_selector(name, arity))
    }

    /// `selector(Notes, "add")`: Swift's `#selector(Notes.add(_:))`, the
    /// selector a method of an Objective-C class answers -- one the program
    /// writes, as the runtime registered it, or one a binding declares, as
    /// its `@ntsSelector` says. The method is looked for on the class and its
    /// ancestors; the checker has already said the name is one of its
    /// methods.
    fn lower_selector(&mut self, id: NodeId, arguments: &[NodeId]) -> Result<ValueId, Diagnostic> {
        let [class, method] = arguments else {
            return Err(self.unsupported(id, "`selector` takes a class and the name of its method"));
        };
        let name = self.literal_name(*method).ok_or_else(|| {
            self.unsupported(
                *method,
                "a method name `selector` is not given as a string literal",
            )
        })?;
        // Through an import's alias to the class it names: `NSWindow` from
        // `objc:AppKit` is an import specifier here.
        let mut record = self
            .node(*class)
            .symbol
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize));
        while let Some(aliased) = record.and_then(|r| r.aliased) {
            record = self.snapshot.symbols.get(aliased.0 as usize);
        }
        let mut at = record.and_then(|record| {
            record
                .declarations
                .iter()
                .copied()
                .find(|d| self.kind_of(*d) == Some(syntax::CLASS_DECLARATION))
        });
        if at.is_none() {
            return Err(self.unsupported(
                *class,
                "a `selector` whose first argument does not name a class",
            ));
        }
        while let Some(declaration) = at {
            let member = self.children(declaration).into_iter().find(|member| {
                self.kind_of(*member) == Some(syntax::METHOD_DECLARATION)
                    && self.member_name(*member).as_deref() == Some(name.as_str())
            });
            if let Some(member) = member {
                let arity = super::generics::declared_signature(self.snapshot, member)
                    .map_or(0, |signature| signature.parameters.len());
                let selector = if super::native::is_objc_class(self.snapshot, declaration) {
                    self.node(member)
                        .native
                        .as_ref()
                        .and_then(|native| native.selector.clone())
                        .unwrap_or_else(|| objc_selector(&name, arity))
                } else if super::native::extends_objc(self.snapshot, declaration) {
                    // A method the runtime is not told of answers no selector.
                    let unregistered = super::generics::declared_signature(self.snapshot, member)
                        .is_some_and(|signature| {
                            super::native::imp_signature(
                                self.snapshot,
                                super::native::Pointee::Void,
                                signature,
                            )
                            .is_err()
                        })
                        && !self.objc_requires(declaration, member, &name, arity);
                    if unregistered {
                        return Err(self.unsupported(
                            *method,
                            &format!("`selector` of `{name}`, a method no message could carry the arguments of, which the runtime is not told of"),
                        ));
                    }
                    self.program_method_selector(declaration, member, &name, arity)
                } else {
                    return Err(self.unsupported(
                        *class,
                        "a `selector` of a class that is not an Objective-C class",
                    ));
                };
                let ty = self
                    .type_of(id)
                    .ok_or_else(|| self.unrepresentable(id, "a selector"))?;
                let origin = self.origin(id);
                return Ok(self.push(
                    OpKind::ObjcSelector {
                        name: selector.trim_start_matches('+').to_owned(),
                    },
                    ty,
                    origin,
                ));
            }
            at = super::native::superclass(self.snapshot, declaration);
        }
        Err(self.unsupported(
            *method,
            &format!("`{name}`, which no class in the chain declares as a method"),
        ))
    }

    fn lower_objc_method(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
    ) -> Result<(Func, Option<super::ForeignMethod>), Diagnostic> {
        // An accessor's is its property's getter or setter: the value out, or
        // the value in.
        let signature = match self.kind_of(member) {
            Some(syntax::GET_ACCESSOR) => self
                .snapshot
                .node_types
                .get(&member)
                .map(|value| accessor_signature(None, None, *value)),
            Some(syntax::SET_ACCESSOR) => {
                let value = self
                    .children(member)
                    .into_iter()
                    .find(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
                    .and_then(|parameter| self.snapshot.node_types.get(&parameter).copied());
                value
                    .map(|value| {
                        self.void_type()
                            .map(|void| accessor_signature(None, Some(value), void))
                    })
                    .transpose()?
            }
            _ => super::generics::declared_signature(self.snapshot, member).cloned(),
        }
        .ok_or_else(|| self.unsupported(member, "an Objective-C method with no signature"))?;
        let receiver = instance
            .or_else(|| instance_type_of(self.snapshot, class))
            .and_then(|ty| super::native::pointer(self.snapshot, ty))
            .ok_or_else(|| {
                self.unsupported(
                    member,
                    "an Objective-C method of a class that is not an Objective-C class",
                )
            })?;
        let name = self
            .member_name(member)
            .ok_or_else(|| self.unsupported(member, "a member whose name the program computes"))?;
        let imp = match super::native::imp_signature(self.snapshot, receiver, &signature) {
            Ok(imp) => imp,
            // Swift's method that is not `@objc`: one whose parameters no
            // message could carry -- `append(_ item: String)` -- and that no
            // protocol, override or tag asks the runtime for is the
            // program's alone. A call from the program reaches the compiled
            // method directly (`lower_program_objc_call`), so it is lowered
            // and never registered.
            Err(_) if !self.objc_requires(class, member, &name, signature.parameters.len()) => {
                return Ok((self.lower_method_of(class, member, instance)?, None));
            }
            Err(why) => {
                return Err(self.unsupported(member, &format!("an Objective-C method's {why}")));
            }
        };
        // The selector: the one `@ntsSelector` gives the method, else the one
        // a protocol the class adopts declares for a member of its name, else
        // the one of the superclass's method it overrides -- `draw(_:)` is
        // `drawRect:` -- else Swift's `@objc` rule for its name. An accessor
        // is its property's getter or setter: `get isFlipped()` is sent
        // `isFlipped`.
        let selector = match self.kind_of(member) {
            Some(syntax::GET_ACCESSOR) => self.property_selectors(member, &name).0,
            Some(syntax::SET_ACCESSOR) => self
                .property_selectors(member, &name)
                .1
                .unwrap_or_else(|| default_setter(&name)),
            _ => self.program_method_selector(class, member, &name, signature.parameters.len()),
        };
        self.objc_entry = Some(ObjcEntry {
            returns_record: matches!(*imp.result, super::native::Type::Record(_)),
        });
        let func = self.lower_method_of(class, member, instance)?;
        let method = super::ForeignMethod {
            dispatch: super::Dispatch::Selector(selector),
            function: func.name.clone(),
            signature: std::sync::Arc::new(imp),
            declared_at: None,
        };
        Ok((func, Some(method)))
    }

    /// Whether the runtime must be told of `member`, a method of class
    /// `class` the program writes: its binding tags its selector, a protocol
    /// the class adopts declares it, or it overrides a superclass's method --
    /// each a message something other than the program sends.
    fn objc_requires(&self, class: NodeId, member: NodeId, name: &str, arity: usize) -> bool {
        self.node(member)
            .native
            .as_ref()
            .is_some_and(|native| native.selector.is_some())
            || self.protocol_selector(class, name).is_some()
            || self.overridden_selector(class, name, arity).is_some()
    }

    /// `super(...)` and `super.vfunc_x()` in a class the program writes over
    /// a `GObject` class: its constructor's instance, or the parent's
    /// implementation of a virtual function it overrides. `None` for any
    /// other `super`.
    fn gobject_super_call(
        &mut self,
        id: NodeId,
        member: &str,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if member == "constructor" {
            return None;
        }
        let target = self.snapshot.call_targets.get(&id).copied()?;
        let declaration = target.callee?;
        let slot = self
            .node(declaration)
            .native
            .as_ref()
            .and_then(|n| n.vfunc.clone())?;
        Some(self.lower_gobject_chain_up(id, (declaration, target.signature), &slot, arguments))
    }

    /// `super.vfunc_clicked()` in a method of a class the program writes over
    /// a `GObject` class: the parent class's implementation, read from its
    /// class struct at the slot's offset when the call is made
    /// (`nts_gobject_chain_{Class}_{offset}`, which each backend defines
    /// beside the registration), and nothing where the parent leaves the
    /// slot empty -- `GObject`'s own convention for chaining up. The call is
    /// typed as the overridden declaration is, with `this` first.
    fn lower_gobject_chain_up(
        &mut self,
        id: NodeId,
        (declaration, signature): (NodeId, nts_semantic_schema::SignatureId),
        slot: &str,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let receiver = self
            .this
            .ok_or_else(|| self.unsupported(id, "`super` outside a method"))?;
        let class = std::iter::successors(self.node(id).parent, |at| self.node(*at).parent)
            .find(|at| self.kind_of(*at) == Some(syntax::CLASS_DECLARATION))
            .ok_or_else(|| self.unsupported(id, "`super` outside a class"))?;
        let name = foreign_class_name(self.snapshot, class)
            .filter(|_| super::native::gobject_parent(self.snapshot, class).is_some())
            .ok_or_else(|| {
                self.unsupported(
                    id,
                    "chaining up to a virtual function outside a class over a GObject class",
                )
            })?;
        let offset = slot
            .split_whitespace()
            .nth(2)
            .ok_or_else(|| self.unsupported(id, "a virtual function whose slot has no offset"))?;
        let mut with_this = self.snapshot.signatures[signature.0 as usize].clone();
        let this = with_this
            .this_type
            .ok_or_else(|| self.unsupported(id, "a virtual function with no `this` type"))?;
        with_this.parameters.insert(
            0,
            nts_semantic_schema::ParameterRecord {
                name: "this".to_owned(),
                ty: this,
                optional: false,
                rest: false,
            },
        );
        // A slot whose outs the declaration answers as a tuple: the thunk
        // is called with the ins, then an address per out, and answers the
        // slot's own result; the tuple is made from them after.
        let outs = self.vfunc_outs(declaration);
        let answer = with_this.return_type;
        let shape = if outs.is_empty() {
            None
        } else {
            Some(self.vfunc_answer(id, answer, &outs)?)
        };
        if let Some((elements, has_result)) = &shape {
            with_this.return_type = if *has_result {
                elements[0]
            } else {
                self.void_type()?
            };
        }
        self.chaining_up = Some(id);
        let built = self.native_callee(id, Some(declaration), name.clone(), &with_this);
        self.chaining_up = None;
        let Callee::Native(mut target) = built? else {
            return Err(self.unsupported(id, "a virtual function that is not foreign"));
        };
        // The thunk, not the declaration's name (which the callee takes from
        // it); defined beside the registration and declared by no header, so
        // the witness has nothing to compare it with.
        let thunk = std::sync::Arc::make_mut(&mut target);
        thunk.name = format!("nts_gobject_chain_{name}_{offset}");
        thunk.thunk = Some(super::native::GObjectThunk::Chain {
            class: name,
            slot: offset.parse().map_err(|_| {
                self.unsupported(id, "a virtual function whose slot offset is not an integer")
            })?,
        });
        thunk.declared_at = None;
        let callee = Callee::Native(target);
        let (args, lent) = self.lower_call_arguments(id, &callee, arguments, Some(receiver))?;
        match shape {
            None => self.finish_call(id, callee, args, lent, Some(declaration)),
            Some((elements, has_result)) => self.chain_up_answering_a_tuple(
                id,
                (callee, args, lent),
                declaration,
                answer,
                (&elements, has_result),
            ),
        }
    }

    /// `super.vfunc_measure(o, s)` where the declaration answers the slot's
    /// outs as a tuple: a local per out, its address passed after the ins,
    /// and the tuple made from the slot's result and what C wrote to them.
    fn chain_up_answering_a_tuple(
        &mut self,
        id: NodeId,
        (callee, mut args, lent): (Callee, Vec<ValueId>, Vec<Lent>),
        declaration: NodeId,
        answer: TypeId,
        (elements, has_result): (&[TypeId], bool),
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let Callee::Native(mut target) = callee else {
            return Err(self.unsupported(id, "a virtual function that is not foreign"));
        };
        let mut locals = Vec::new();
        for element in &elements[usize::from(has_result)..] {
            let Some(super::native::Type::Scalar(scalar)) =
                super::native::abi_type(self.snapshot, *element)
            else {
                return Err(self.unsupported(
                    id,
                    "a virtual function's out parameter that is not a C scalar",
                ));
            };
            let pointee = super::native::Pointee::Scalar(scalar);
            let thunk = std::sync::Arc::make_mut(&mut target);
            thunk
                .parameters
                .push(super::native::Type::Pointer(pointee.clone()));
            thunk.retention.push(super::native::Retention::NotRetained);
            let local = self.push(
                OpKind::NativeLocal { count: 1 },
                HirType::NativePointer(pointee),
                origin.clone(),
            );
            args.push(local);
            locals.push(local);
        }
        let result_ty = target.call_result();
        let result = self.finish_call_typed(
            id,
            Callee::Native(target),
            args,
            lent,
            Some(declaration),
            Some(result_ty),
        )?;
        let zero = self.push(
            OpKind::ConstInt(0),
            HirType::Int {
                bits: 64,
                signed: true,
            },
            origin.clone(),
        );
        let mut values = Vec::new();
        if has_result {
            values.push(result);
        }
        for local in locals {
            values.push(self.native_load(id, local, zero)?);
        }
        self.make_tuple(id, answer, values)
    }

    /// Whether a constructor body opens with its `super(...)`: `this` is one
    /// object for the whole body, and one made in a branch is not.
    fn opens_with_super(&self, body: NodeId) -> bool {
        self.children(body).first().is_some_and(|first| {
            self.kind_of(*first) == Some(syntax::EXPRESSION_STATEMENT)
                && self.children(*first).first().is_some_and(|call| {
                    self.kind_of(*call) == Some(syntax::CALL_EXPRESSION)
                        && self.children(*call).first().is_some_and(|callee| {
                            self.kind_of(*callee) == Some(syntax::SUPER_KEYWORD)
                        })
                })
        })
    }

    /// A constructor of a class the program writes over a composable Windows
    /// Runtime class, as C#'s `public App() { ... }`: `{Class}#new`, taking
    /// the constructor's parameters and answering the instance (+1). Its
    /// `super()` composes the instance (`com_super`), whose fields the runtime
    /// has made already, and the body runs with `this`.
    fn lower_com_constructor(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
    ) -> Result<Func, Diagnostic> {
        let name = foreign_class_name(self.snapshot, class)
            .ok_or_else(|| self.unsupported(member, "a constructor of a class with no name"))?;
        let instance = instance
            .or_else(|| instance_type_of(self.snapshot, class))
            .ok_or_else(|| {
                self.unsupported(
                    member,
                    "a constructor of a composed class with no instance type",
                )
            })?;
        let Some(ty @ HirType::NativePointer(_)) = self.represent(instance) else {
            return Err(self.unsupported(
                member,
                "a constructor of a composed class whose instances are not its base's handle",
            ));
        };
        let body = self.method_body(member, false)?.ok_or_else(|| {
            self.unsupported(member, "a composed class's constructor with no body")
        })?;
        if !self.opens_with_super(body) {
            return Err(self.unsupported(member, "a constructor of a class over a composable Windows Runtime class that does not open with its `super()`"));
        }
        let origin = self.origin(member);
        self.this = None;
        self.in_constructor = true;
        let mut params = Vec::new();
        for child in self.children(member) {
            if self.kind_of(child) != Some(syntax::PARAMETER) {
                continue;
            }
            if self.declares_a_field(child) {
                return Err(self.unsupported(child, "a constructor parameter that declares a field of a class over a composable Windows Runtime class"));
            }
            let index = u32::try_from(params.len()).unwrap_or(0);
            params.extend(self.lower_param(child, index)?);
        }
        self.made_by = Some(MadeBy::Com(name.clone()));
        self.returns = ty.clone();
        self.lower_block(body)?;
        if !self.is_terminated() {
            let made = self.this.ok_or_else(|| {
                self.unsupported(
                    member,
                    "a composed class's constructor that made no instance",
                )
            })?;
            self.terminate(Terminator::Return(Some(made)));
        }
        Ok(self.finish(format!("{name}#new"), params, ty, origin, false))
    }

    /// `super()` in such a constructor: the instance, composed by the runtime
    /// by the class's name, and `this` from here on. The base's composable
    /// factory takes nothing of the program's, so neither does `super`.
    fn com_super(
        &mut self,
        id: NodeId,
        name: &str,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        if !arguments.is_empty() {
            return Err(self.unsupported(id, "a `super(...)` with arguments in a class over a composable Windows Runtime class, whose factory takes none"));
        }
        let Some(ty @ HirType::NativePointer(_)) = self.represent(self.this_instance_type(id)?)
        else {
            return Err(self.unsupported(
                id,
                "a composed class whose instances are not its base's handle",
            ));
        };
        let made = self.compose_named(name, ty, &self.origin(id));
        self.this = Some(made);
        Ok(made)
    }

    /// The runtime's composition of the class registered as `name` (+1).
    fn compose_named(&mut self, name: &str, ty: HirType, origin: &Origin) -> ValueId {
        let name = self.push(
            OpKind::ConstString(name.to_owned().into()),
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        self.runtime_call("nts_com_compose_named", vec![name], ty, origin.clone())
    }

    /// A constructor of a class the program writes over a `GObject` class, as
    /// the function `new` calls: `{Class}#new`, taking the constructor's
    /// parameters and answering the instance (one reference, the caller's).
    /// Its `super({ ... })` makes the instance of the class's own `GType` and
    /// sets the literal's properties (`gobject_super`); the fields are the
    /// instance's already, made by `instance_init`. An instance GTK makes
    /// itself -- a builder file -- runs `instance_init` and none of this, as
    /// an Objective-C instance a nib makes runs its superclass's `init`.
    fn lower_gobject_constructor(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
    ) -> Result<Func, Diagnostic> {
        let name = foreign_class_name(self.snapshot, class)
            .ok_or_else(|| self.unsupported(member, "a constructor of a class with no name"))?;
        let instance = instance
            .or_else(|| instance_type_of(self.snapshot, class))
            .ok_or_else(|| {
                self.unsupported(
                    member,
                    "a constructor of a GObject class with no instance type",
                )
            })?;
        let Some(ty @ HirType::NativePointer(_)) = self.represent(instance) else {
            return Err(self.unsupported(
                member,
                "a constructor of a GObject class whose instances are not a handle",
            ));
        };
        let body = self
            .method_body(member, false)?
            .ok_or_else(|| self.unsupported(member, "a GObject constructor with no body"))?;
        if !self.opens_with_super(body) {
            return Err(self.unsupported(member, "a constructor of a class extending a GObject class that does not open with its `super(...)`"));
        }
        let origin = self.origin(member);
        self.this = None;
        self.in_constructor = true;
        let mut params = Vec::new();
        for child in self.children(member) {
            if self.kind_of(child) != Some(syntax::PARAMETER) {
                continue;
            }
            if self.declares_a_field(child) {
                return Err(self.unsupported(child, "a constructor parameter that declares a field of a class extending a GObject class"));
            }
            let index = u32::try_from(params.len()).unwrap_or(0);
            params.extend(self.lower_param(child, index)?);
        }
        self.made_by = Some(MadeBy::Gobject(name.clone()));
        self.returns = ty.clone();
        self.lower_block(body)?;
        if !self.is_terminated() {
            let made = self.this.ok_or_else(|| {
                self.unsupported(member, "a GObject constructor that made no instance")
            })?;
            self.terminate(Terminator::Return(Some(made)));
        }
        Ok(self.finish(format!("{name}#new"), params, ty, origin, false))
    }

    /// `super({ label })` in such a constructor: the instance, made as `new`
    /// without a constructor makes one -- its own `GType`, then a setter per
    /// property -- and `this` from here on. The properties are a literal's,
    /// set without building an object, or a props object's passed through,
    /// each set where it was given (`passed_properties`); a class's own
    /// `Property<T>` among them is written through its state's field
    /// (`constructed_setter`).
    fn gobject_super(&mut self, id: NodeId, name: &str) -> Result<ValueId, Diagnostic> {
        let instance = self.this_instance_type(id)?;
        let made = self.lower_gobject_made(id, name, instance)?;
        self.this = Some(made);
        Ok(made)
    }

    /// A constructor of a class the program writes over an Objective-C class,
    /// as the function `new` calls: `{Class}#new`, taking the constructor's
    /// parameters and answering the instance (+1). Its `super(...)` is where
    /// the instance is made -- `+alloc` sent to this class, then the
    /// superclass constructor's `init...` -- so `this` is that object from
    /// there on, with its fields made at once, whichever `init` it was. Only
    /// a constructor opening with its `super(...)`: `this` is one object for
    /// the whole body, and one made in a branch is not. Not a method the
    /// runtime knows: an instance Objective-C makes itself (`[Counter new]`,
    /// a nib) runs its superclass's `init` and none of this.
    fn lower_objc_constructor(
        &mut self,
        class: NodeId,
        member: NodeId,
        instance: Option<TypeId>,
    ) -> Result<Func, Diagnostic> {
        let instance = instance
            .or_else(|| instance_type_of(self.snapshot, class))
            .ok_or_else(|| {
                self.unsupported(
                    member,
                    "a constructor of an Objective-C class with no instance type",
                )
            })?;
        let Some(HirType::NativePointer(super::native::Pointee::Opaque(handle))) =
            self.represent(instance)
        else {
            return Err(self.unsupported(
                member,
                "a constructor of an Objective-C class that is not a handle",
            ));
        };
        let body = self
            .method_body(member, false)?
            .ok_or_else(|| self.unsupported(member, "an Objective-C constructor with no body"))?;
        if !self.opens_with_super(body) {
            return Err(self.unsupported(member, "a constructor of a class extending an Objective-C class that does not open with its `super(...)`"));
        }
        let fields = self.declares_instance_fields(class);
        let origin = self.origin(member);
        self.this = None;
        self.base = self.base_class(class);
        self.in_constructor = true;
        let mut params = Vec::new();
        let mut parameter_properties = Vec::new();
        for child in self.children(member) {
            if self.kind_of(child) != Some(syntax::PARAMETER) {
                continue;
            }
            let index = u32::try_from(params.len()).unwrap_or(0);
            if self.declares_a_field(child) {
                parameter_properties.push((child, index));
            }
            params.extend(self.lower_param(child, index)?);
        }
        self.made_by = Some(MadeBy::Objc(ObjcConstruct {
            handle: handle.clone(),
            fields,
            parameter_properties,
        }));
        let ty = HirType::NativePointer(super::native::Pointee::Opaque(handle.clone()));
        self.returns = ty.clone();
        self.lower_block(body)?;
        if !self.is_terminated() {
            let made = self.this.ok_or_else(|| {
                self.unsupported(member, "an Objective-C constructor that made no instance")
            })?;
            self.terminate(Terminator::Return(Some(made)));
        }
        Ok(self.finish(format!("{}#new", handle.tag), params, ty, origin, false))
    }

    /// `super(...)` in such a constructor: `+alloc` sent to the program's
    /// class and the superclass constructor's `init...` to what it answered,
    /// ARC's pair as `new` sends it, and the answer `this`. A factory the
    /// binding imports as a constructor makes the superclass's own instance,
    /// not this class's, and is refused.
    fn lower_objc_super_init(
        &mut self,
        id: NodeId,
        ObjcConstruct {
            handle,
            fields,
            parameter_properties,
        }: ObjcConstruct,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let target = self
            .snapshot
            .call_targets
            .get(&id)
            .copied()
            .ok_or_else(|| self.unresolved_call(id))?;
        let Some(constructor) = target
            .callee
            .filter(|c| self.objc_class_member(*c).is_some())
        else {
            return Err(self.unsupported(
                id,
                "a `super(...)` into a constructor the binding does not declare",
            ));
        };
        let Some(selector) = self
            .node(constructor)
            .native
            .as_ref()
            .and_then(|n| n.selector.clone())
        else {
            return Err(self.unsupported(id, "an Objective-C constructor with no `@ntsSelector`"));
        };
        if selector.starts_with('+') {
            return Err(self.unsupported(id, "a `super(...)` into a class method Swift imports as an initializer, which makes the superclass's instance"));
        }
        let instance = self.this_instance_type(id)?;
        let alloc = nts_semantic_schema::SignatureRecord {
            parameters: Vec::new(),
            return_type: instance,
            type_parameters: Vec::new(),
            is_construct: false,
            type_predicate: None,
            this_type: None,
        };
        // Typed as the instance, not as the `super(...)` expression, which
        // the checker has as `void`.
        let made_ty = HirType::NativePointer(super::native::Pointee::Opaque(handle.clone()));
        let callee = self.native_callee_with(
            id,
            Some(constructor),
            "alloc".to_owned(),
            &alloc,
            Some("alloc".to_owned()),
            Some(handle.tag.clone()),
        )?;
        let allocated = self.finish_call_typed(
            id,
            callee,
            Vec::new(),
            Vec::new(),
            Some(constructor),
            Some(made_ty.clone()),
        )?;
        let mut init = self.snapshot.signatures[target.signature.0 as usize].clone();
        init.is_construct = false;
        init.return_type = instance;
        init.parameters.insert(
            0,
            nts_semantic_schema::ParameterRecord {
                name: "this".to_owned(),
                ty: instance,
                optional: false,
                rest: false,
            },
        );
        let callee = self.native_callee_with(
            id,
            Some(constructor),
            selector.clone(),
            &init,
            Some(selector),
            None,
        )?;
        let (args, lent) = self.lower_call_arguments(id, &callee, arguments, Some(allocated))?;
        let made =
            self.finish_call_typed(id, callee, args, lent, Some(constructor), Some(made_ty))?;
        self.this = Some(made);
        // Its fields, made now: only `init` itself makes them on the way in.
        if fields && let Some(&(index, _)) = self.hierarchy.objc_states.get(&handle.tag) {
            let origin = self.origin(id);
            let state = HirType::Managed(ManagedType::Object(super::objc_state_type(index)));
            let _ = self.runtime_call("nts_objc_state", vec![made], state, origin);
        }
        // `constructor(private model: Model)`: the fields its parameters
        // declare, stored now that there is an instance.
        self.store_parameter_properties(&parameter_properties)?;
        Ok(made)
    }

    /// The classes whose fields the state of `class_ty` holds, root first.
    fn objc_chain(&self, class_ty: TypeId) -> Vec<TypeId> {
        self.hierarchy
            .objc_chains
            .get(&class_ty)
            .cloned()
            .unwrap_or_else(|| vec![class_ty])
    }

    /// `{Class}#state`: a new object holding the fields of `class`, a class
    /// the program writes over an Objective-C class, and of the program's
    /// classes it descends from, with their initialisers run base first and
    /// in declaration order. The runtime calls it from the `init` it adds
    /// to the class, so the fields hold their initial values once `new`
    /// returns, as JavaScript's do. An initialiser has no `this` here -- the
    /// instance is still the superclass's `init`'s -- and one reading it is
    /// refused by the ordinary rule for a `this` there is none of.
    fn lower_objc_state(
        &mut self,
        class: NodeId,
        name: &str,
        index: usize,
        class_ty: TypeId,
    ) -> Result<Func, Diagnostic> {
        self.refuse_reaching_initializers(class)?;
        let layout = self.objc_state_layout(class, index, class_ty)?;
        let ty = HirType::Managed(ManagedType::Object(super::objc_state_type(index)));
        let origin = self.origin(class);
        self.this = None;
        self.returns = ty.clone();
        let state = self.push(
            OpKind::ObjectNew { frame: false },
            ty.clone(),
            origin.clone(),
        );
        let chain = self.objc_chain(class_ty);
        self.initialize_declared_fields(class, state, &chain, &layout)?;
        self.terminate(Terminator::Return(Some(state)));
        Ok(self.finish(format!("{name}#state"), Vec::new(), ty, origin, false))
    }

    /// Refuse a field initialiser that could run code: a call, a `new`, a
    /// member read (a getter, or a message), `this`. It runs inside `init`,
    /// before the instance's ivar holds its fields, and code it reaches could
    /// send the half-made instance a message that reads one -- a crash whose
    /// stack points nowhere near the initialiser. A function the initialiser
    /// *makes* is not run by it, so its body is not looked at.
    fn refuse_reaching_initializers(&self, class: NodeId) -> Result<(), Diagnostic> {
        for member in self.children(class) {
            if self.kind_of(member) != Some(syntax::PROPERTY_DECLARATION)
                || is_static_member(self.snapshot, member)
            {
                continue;
            }
            let Some([_, _, _, _, Some(initializer)]) = self.child_slots::<5>(member) else {
                continue;
            };
            let mut pending = vec![initializer];
            while let Some(node) = pending.pop() {
                match self.kind_of(node) {
                    Some(syntax::ARROW_FUNCTION | syntax::FUNCTION_EXPRESSION) => {}
                    // `title = property("")` runs nothing: it declares a
                    // property or a signal (`lower/gobject.rs`). What it is
                    // given is held to this rule all the same.
                    Some(syntax::CALL_EXPRESSION) if self.gobject_intrinsic(node).is_some() => {
                        pending.extend(self.arguments_of(node));
                    }
                    Some(
                        syntax::CALL_EXPRESSION
                        | syntax::NEW_EXPRESSION
                        | syntax::TAGGED_TEMPLATE_EXPRESSION
                        | syntax::PROPERTY_ACCESS_EXPRESSION
                        | syntax::ELEMENT_ACCESS_EXPRESSION
                        | syntax::THIS_KEYWORD
                        | syntax::AWAIT_EXPRESSION
                        | syntax::YIELD_EXPRESSION
                        | syntax::DELETE_EXPRESSION,
                    ) => {
                        return Err(self.unsupported(
                            node,
                            "a field initialiser of a class extending a foreign class (Objective-C, `GObject` or a composable Windows Runtime class) that calls, reads a member or reads `this`: it runs as the runtime makes the instance, before the instance holds its fields, so anything it reaches could reach the half-made instance",
                        ));
                    }
                    _ => pending.extend(self.children(node)),
                }
            }
        }
        Ok(())
    }

    /// Whether `name` is a field of the class the program writes over an
    /// Objective-C class that `pointee` points at: one it declares itself and
    /// stores, as the checker records it.
    fn is_program_objc_field(&self, pointee: &super::native::Pointee, name: &str) -> bool {
        let Some(handle) = opaque_handle(pointee) else {
            return false;
        };
        let Some(&(_, class_ty)) = self.hierarchy.objc_states.get(&handle.tag) else {
            return false;
        };
        self.chain_stores(class_ty, name)
    }

    /// Whether `name` is a field some class of `class_ty`'s chain declares and
    /// stores: its own, or one it inherits from a class the program wrote --
    /// every one of them in the state object (`objc_state_layout`).
    fn chain_stores(&self, class_ty: TypeId, name: &str) -> bool {
        self.objc_chain(class_ty)
            .into_iter()
            .any(|class| declares_stored(self.snapshot, class, name))
    }

    /// The layout of the object holding the fields of the `index`th
    /// Objective-C class with fields: those each class of its chain declares
    /// itself, root first, typed as any class's are (`fields_of`). So a
    /// subclass's state begins with its base's fields, at the base's indices.
    /// Nothing the runtime's classes declare is in it: their members are
    /// reached by message.
    fn objc_state_layout(
        &mut self,
        id: NodeId,
        index: usize,
        class_ty: TypeId,
    ) -> Result<Layout, Diagnostic> {
        let ty = super::objc_state_type(index);
        if let Some(known) = self
            .layouts
            .iter()
            .find(|layout| layout.types.contains(&ty))
        {
            return Ok(known.clone());
        }
        let chain = self.objc_chain(class_ty);
        let mut fields = Vec::new();
        for class in &chain {
            let Some(TypeKind::Object { properties }) = self
                .snapshot
                .types
                .get(class.0 as usize)
                .map(|record| &record.kind)
            else {
                return Err(self.unsupported(
                    id,
                    "the fields of an Objective-C class the checker did not decompose",
                ));
            };
            let own: Vec<_> = properties
                .iter()
                .filter(|property| property.own)
                .cloned()
                .collect();
            fields.extend(self.fields_of(id, *class, &own)?);
        }
        // **The parent's state is this one's prefix, and `verify` checks it.**
        // One object holds a chain's fields, and a parent's method reads its
        // own through the parent's layout: that is sound only while the
        // parent's fields lead this one's, in its order. The loop above
        // arranges that, and `base` is what makes it a checked fact
        // (`BrokenBase`) that `put_bases_first` keeps, not an ordering a field
        // added to one class could silently break.
        let parent = chain
            .len()
            .checked_sub(2)
            .and_then(|at| chain.get(at).copied());
        let base = match parent.and_then(|parent| {
            self.hierarchy
                .objc_states
                .values()
                .find(|(_, declared)| *declared == parent)
                .copied()
        }) {
            Some((parent_index, parent_ty)) => {
                self.objc_state_layout(id, parent_index, parent_ty)?;
                Some(super::objc_state_type(parent_index))
            }
            None => None,
        };
        let name = self.hierarchy.name.get(&class_ty).map_or_else(
            || format!("ObjcState{index}"),
            |name| format!("{name}_state"),
        );
        let layout = Layout {
            types: vec![ty],
            name,
            interfaces: Vec::new(),
            fields,
            // Not a class of this program's: nothing dispatches on it.
            methods: vec![None; self.hierarchy.table_size()],
            base,
        };
        self.layouts.push(layout.clone());
        Ok(layout)
    }

    /// The receiver kind **an instance of a class the program writes over an
    /// Objective-C class**: `recv.x`, where `x` is one of the class's fields,
    /// is that field of the object its ivar holds, which `nts_objc_state`
    /// lends for as long as `recv` lives. `None` for any other receiver, or a
    /// member that is not a field -- a property or a method is the runtime's,
    /// and the arms after this one answer it.
    fn program_objc_instance_place(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        member: &str,
    ) -> Result<Option<Place>, Diagnostic> {
        let HirType::NativePointer(pointee) = &self.values[receiver.0 as usize].ty else {
            return Ok(None);
        };
        let Some(handle) = opaque_handle(pointee) else {
            return Ok(None);
        };
        // An Objective-C class's instances carry its own name as their tag; a
        // `GObject` subclass's carry the parent's struct, which says nothing
        // of which class this is, so its fields are found by the receiver's
        // type (`state_by_type`), as a composed Windows Runtime class's are.
        let (index, class_ty, reader) =
            if let Some(&(index, class_ty)) = self.hierarchy.objc_states.get(&handle.tag) {
                (index, class_ty, "nts_objc_state")
            } else if let Some((index, class_ty, reader)) = self.state_by_type(id) {
                (index, class_ty, reader)
            } else {
                return Ok(None);
            };
        self.state_place(id, receiver, (index, class_ty, reader), member)
    }

    /// `member` of the state `reader` lends for `receiver`, as a place: a
    /// write of it notifies where it is a `GObject` property (`notifying`).
    /// `None` where `member` is not one of the state's fields.
    fn state_place(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        (index, class_ty, reader): (usize, TypeId, &'static str),
        member: &str,
    ) -> Result<Option<Place>, Diagnostic> {
        let layout = self.objc_state_layout(id, index, class_ty)?;
        let Some(field) = layout.index_of(member) else {
            return Ok(None);
        };
        let ty = HirType::Managed(ManagedType::Object(super::objc_state_type(index)));
        let origin = self.origin(id);
        let object = self.runtime_call(reader, vec![receiver], ty, origin);
        if reader == "nts_gobject_state"
            && let Some(thunk) = self.property_notify_thunk(class_ty, member)
        {
            self.notifying.insert((object, field), (receiver, thunk));
        }
        Ok(Some(Place::Field { object, field }))
    }

    /// The thunk a write of `member` notifies through, where `member` is a
    /// property (`Property<T>`) of a class in the chain of `class_ty`: the
    /// declaring class's own, numbered as its registration numbers them.
    fn property_notify_thunk(
        &self,
        class_ty: TypeId,
        member: &str,
    ) -> Option<super::native::GObjectThunk> {
        for ty in self.objc_chain(class_ty) {
            let symbol = self.snapshot.types.get(ty.0 as usize)?.symbol?;
            let class = self
                .snapshot
                .symbols
                .get(symbol.0 as usize)?
                .declarations
                .iter()
                .copied()
                .find(|d| self.kind_of(*d) == Some(syntax::CLASS_DECLARATION))?;
            let fields = property_fields(self.snapshot, class).ok()?;
            if let Some(at) = fields.iter().position(|(name, _)| name == member) {
                let name = foreign_class_name(self.snapshot, class)?;
                return Some(super::native::GObjectThunk::Notify {
                    class: name,
                    index: at,
                });
            }
        }
        None
    }

    /// The function `get_property` (`setter` false) or `set_property` calls
    /// for one property of a `GObject` class the program writes: the field of
    /// the instance's state, read and answered, or written -- through
    /// `write_place`, so it notifies as any write of the field does.
    fn lower_gobject_property_accessor(
        &mut self,
        class: NodeId,
        name: &str,
        (index, class_ty): (usize, TypeId),
        property: &str,
        setter: bool,
    ) -> Result<Func, Diagnostic> {
        let origin = self.origin(class);
        let instance = instance_type_of(self.snapshot, class)
            .and_then(|ty| self.represent(ty))
            .ok_or_else(|| self.unsupported(class, "a GObject class with no handle type"))?;
        let layout = self.objc_state_layout(class, index, class_ty)?;
        let field = layout.index_of(property).ok_or_else(|| {
            self.unsupported(
                class,
                &format!("a property `{property}` that is not a field of the class's state"),
            )
        })?;
        let field_ty = layout.fields[field as usize].ty.clone();
        // The parameters first: each is the value its position names.
        let receiver = self.push(OpKind::Param(0), instance.clone(), origin.clone());
        self.this = Some(receiver);
        let mut params = vec![Param {
            name: "this".to_owned(),
            shape: ParamShape::Ordinary,
            ty: instance,
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        }];
        let value = setter.then(|| {
            params.push(Param {
                name: "value".to_owned(),
                shape: ParamShape::Ordinary,
                ty: field_ty.clone(),
                origin: origin.clone(),
                known: Facts::TOP,
                written: None,
            });
            self.push(OpKind::Param(1), field_ty.clone(), origin.clone())
        });
        let state_ty = HirType::Managed(ManagedType::Object(super::objc_state_type(index)));
        let state = self.runtime_call(
            "nts_gobject_state",
            vec![receiver],
            state_ty,
            origin.clone(),
        );
        if let Some(value) = value {
            let at = fields_index(self.snapshot, class, property);
            self.notifying.insert(
                (state, field),
                (
                    receiver,
                    super::native::GObjectThunk::Notify {
                        class: name.to_owned(),
                        index: at,
                    },
                ),
            );
            self.returns = HirType::Void;
            self.write_place(
                class,
                &Place::Field {
                    object: state,
                    field,
                },
                value,
            )?;
            self.terminate(Terminator::Return(None));
            Ok(self.finish(
                format!("{name}#set_{property}"),
                params,
                HirType::Void,
                origin,
                false,
            ))
        } else {
            let value = self.push(
                OpKind::FieldGet {
                    object: state,
                    field,
                },
                field_ty.clone(),
                origin.clone(),
            );
            self.returns = field_ty.clone();
            self.terminate(Terminator::Return(Some(value)));
            Ok(self.finish(
                format!("{name}#get_{property}"),
                params,
                field_ty,
                origin,
                false,
            ))
        }
    }

    /// The getter (`setter` false) or setter the runtime calls for a field of
    /// a class the program writes over an Objective-C class, which a protocol
    /// it adopts asks for as a property: the field of the instance's state,
    /// read and answered, or written. With the signature the entry point
    /// takes it by, which is the property's.
    fn lower_objc_field_accessor(
        &mut self,
        class: NodeId,
        name: &str,
        (index, class_ty): (usize, TypeId),
        (field, property): (NodeId, &str),
        setter: bool,
    ) -> Result<(Func, super::native::FnPointer), Diagnostic> {
        let origin = self.origin(field);
        let pointee = instance_type_of(self.snapshot, class)
            .and_then(|ty| super::native::pointer(self.snapshot, ty))
            .ok_or_else(|| self.unsupported(class, "an Objective-C class with no handle type"))?;
        let value = *self
            .snapshot
            .node_types
            .get(&field)
            .ok_or_else(|| self.unrepresentable(field, "a field"))?;
        let signature = if setter {
            accessor_signature(None, Some(value), self.void_type()?)
        } else {
            accessor_signature(None, None, value)
        };
        let imp = super::native::imp_signature(self.snapshot, pointee.clone(), &signature)
            .map_err(|why| {
                self.unsupported(
                    field,
                    &format!("a field meeting a protocol's property requirement, whose {why}"),
                )
            })?;
        if matches!(*imp.result, super::native::Type::Record(_)) {
            return Err(self.unsupported(field, "a record field meeting a protocol's property requirement, which is answered by value"));
        }
        let layout = self.objc_state_layout(class, index, class_ty)?;
        let at = layout.index_of(property).ok_or_else(|| {
            self.unsupported(
                field,
                &format!("`{property}`, which is not a field of the class's state"),
            )
        })?;
        let field_ty = layout.fields[at as usize].ty.clone();
        let instance = HirType::NativePointer(pointee);
        let receiver = self.push(OpKind::Param(0), instance.clone(), origin.clone());
        self.this = Some(receiver);
        let mut params = vec![Param {
            name: "this".to_owned(),
            shape: ParamShape::Ordinary,
            ty: instance,
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        }];
        let written = setter.then(|| {
            params.push(Param {
                name: "value".to_owned(),
                shape: ParamShape::Ordinary,
                ty: field_ty.clone(),
                origin: origin.clone(),
                known: Facts::TOP,
                written: None,
            });
            self.push(OpKind::Param(1), field_ty.clone(), origin.clone())
        });
        let state_ty = HirType::Managed(ManagedType::Object(super::objc_state_type(index)));
        let state = self.runtime_call("nts_objc_state", vec![receiver], state_ty, origin.clone());
        let func = if let Some(written) = written {
            self.returns = HirType::Void;
            self.write_place(
                field,
                &Place::Field {
                    object: state,
                    field: at,
                },
                written,
            )?;
            self.terminate(Terminator::Return(None));
            self.finish(
                format!("{name}#objc set {property}"),
                params,
                HirType::Void,
                origin,
                false,
            )
        } else {
            let read = self.push(
                OpKind::FieldGet {
                    object: state,
                    field: at,
                },
                field_ty.clone(),
                origin.clone(),
            );
            self.returns = field_ty.clone();
            self.terminate(Terminator::Return(Some(read)));
            self.finish(
                format!("{name}#objc get {property}"),
                params,
                field_ty,
                origin,
                false,
            )
        };
        Ok((func, imp))
    }

    /// The property requirement named `name` of a protocol `class` adopts, or
    /// one that protocol refines: `UIWindowSceneDelegate`'s `window`.
    fn property_requirement(&self, class: NodeId, name: &str) -> Option<NodeId> {
        let mut pending = self.objc_protocols(class);
        let mut seen = rustc_hash::FxHashSet::default();
        while let Some(protocol) = pending.pop() {
            if !seen.insert(protocol) {
                continue;
            }
            let found = self.children(protocol).into_iter().find(|member| {
                self.kind_of(*member) == Some(syntax::PROPERTY_SIGNATURE)
                    && self.member_name(*member).as_deref() == Some(name)
            });
            if found.is_some() {
                return found;
            }
            pending.extend(
                super::native::implemented(self.snapshot, protocol)
                    .into_iter()
                    .filter(|base| self.in_objc_module(*base)),
            );
        }
        None
    }

    /// `this.title`, where `title` is a child the template of the receiver's
    /// class, or of a class the program wrote below it, names (`declare
    /// readonly title: GtkLabel`): the template's own, which
    /// `nts_gobject_child_{Class}_{i}` lends -- the template holds it for as
    /// long as the widget lives. `None` for any other member.
    fn template_child(
        &mut self,
        access: NodeId,
        receiver: ValueId,
        member: &str,
    ) -> Option<ValueId> {
        let HirType::NativePointer(pointee) = self.values[receiver.0 as usize].ty.clone() else {
            return None;
        };
        let node = *self.children(access).first()?;
        let ty = self.class_behind(*self.snapshot.node_types.get(&node)?);
        let symbol = self.snapshot.types.get(ty.0 as usize)?.symbol?;
        let class = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .iter()
            .copied()
            .find(|d| self.kind_of(*d) == Some(syntax::CLASS_DECLARATION))?;
        super::native::gobject_parent(self.snapshot, class)?;
        // The class whose template names it: `Wide extends Panel` reads
        // `title` from `Panel`'s. Bounded: a chain is as long as the classes
        // written.
        let mut class = class;
        let mut found = None;
        for _ in 0..64 {
            if gobject_template(self.snapshot, class).is_some() {
                let children = template_children(self.snapshot, class);
                if let Some(at) = children.iter().position(|(name, _)| name == member) {
                    found = Some((at, children[at].1));
                    break;
                }
            }
            class = program_superclass(self.snapshot, class)?;
        }
        let (at, child) = found?;
        let child = super::native::pointer(self.snapshot, child)?;
        let name = foreign_class_name(self.snapshot, class)?;
        let mut read = synthesized(
            &super::Template::child_thunk(&name, at),
            vec![super::native::Type::Pointer(pointee)],
            super::native::Type::Pointer(child.clone()),
            None,
            Vec::new(),
        );
        read.thunk = Some(super::native::GObjectThunk::Child {
            class: name,
            index: at,
        });
        let origin = self.origin(access);
        Some(self.push(
            OpKind::Call {
                callee: Callee::Native(std::sync::Arc::new(read)),
                args: vec![receiver],
                frame: None,
            },
            HirType::NativePointer(child),
            origin,
        ))
    }

    /// The state of the class the program writes that the receiver of
    /// `access` (`this.count`, `counter.count`) is an instance of, found by
    /// the receiver's type -- for a `GObject` subclass or a composed Windows
    /// Runtime class, whose handles carry the parent's tag and so say nothing
    /// of which class this is: its index and class type, as `note_objc_state`
    /// numbered it, and the runtime call lending it. `None` for any other
    /// receiver.
    fn state_by_type(&self, access: NodeId) -> Option<(usize, TypeId, &'static str)> {
        let receiver = *self.children(access).first()?;
        self.state_of_type(*self.snapshot.node_types.get(&receiver)?)
    }

    /// [`Self::state_by_type`] for an instance whose type is already known:
    /// the state of the class the program writes behind `ty`, and the reader
    /// that lends it.
    fn state_of_type(&self, ty: TypeId) -> Option<(usize, TypeId, &'static str)> {
        let ty = self.class_behind(ty);
        let symbol = self.snapshot.types.get(ty.0 as usize)?.symbol?;
        let class = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .iter()
            .copied()
            .find(|d| self.kind_of(*d) == Some(syntax::CLASS_DECLARATION))?;
        let reader = if super::native::gobject_parent(self.snapshot, class).is_some() {
            "nts_gobject_state"
        } else if super::native::extends_com(self.snapshot, class) {
            "nts_com_state"
        } else {
            return None;
        };
        let name = foreign_class_name(self.snapshot, class)?;
        let &(index, class_ty) = self.hierarchy.objc_states.get(&name)?;
        Some((index, class_ty, reader))
    }

    /// The Objective-C protocols a class the program writes adopts: each
    /// interface its heritage names that an `objc:` module declares, by the
    /// name the runtime knows it by, which is the interface's.
    fn objc_protocols(&self, class: NodeId) -> Vec<NodeId> {
        super::native::implemented(self.snapshot, class)
            .into_iter()
            .filter(|interface| self.in_objc_module(*interface))
            .collect()
    }

    /// The selector of the method a class the program writes overrides: the
    /// nearest superclass's instance method of `name` taking `arity`
    /// arguments, as its binding tags it. Swift's names are not selectors --
    /// `draw(_:)` is `drawRect:`, `value(forKey:)` is `valueForKey:` -- so an
    /// override answers the runtime by the selector it replaces.
    fn overridden_selector(&self, class: NodeId, name: &str, arity: usize) -> Option<String> {
        for here in self.native_bases(class) {
            let found = self.children(here).into_iter().find_map(|member| {
                let arguments = self
                    .children(member)
                    .into_iter()
                    .filter(|c| self.kind_of(*c) == Some(syntax::PARAMETER))
                    .count();
                (self.kind_of(member) == Some(syntax::METHOD_DECLARATION)
                    && !is_static_member(self.snapshot, member)
                    && self.member_name(member).as_deref() == Some(name)
                    && arguments == arity)
                    .then(|| {
                        self.node(member)
                            .native
                            .as_ref()
                            .and_then(|native| native.selector.clone())
                    })
                    .flatten()
            });
            if found.is_some() {
                return found;
            }
        }
        None
    }

    /// The selector a protocol the class adopts declares for member `name`.
    fn protocol_selector(&self, class: NodeId, name: &str) -> Option<String> {
        self.objc_protocols(class).into_iter().find_map(|protocol| {
            self.children(protocol).into_iter().find_map(|member| {
                (self.kind_of(member) == Some(syntax::METHOD_SIGNATURE)
                    && self.member_name(member).as_deref() == Some(name))
                .then(|| {
                    self.node(member)
                        .native
                        .as_ref()
                        .and_then(|native| native.selector.clone())
                })
                .flatten()
            })
        })
    }

    /// Assemble what has been built into a function.
    fn finish(
        &mut self,
        name: String,
        params: Vec<Param>,
        return_type: HirType,
        origin: Origin,
        exported: bool,
    ) -> Func {
        self.argument_sources.clear();
        let blocks = std::mem::take(&mut self.blocks)
            .into_iter()
            .map(|block| Block {
                params: block.params,
                ops: block.ops,
                // Every block is terminated by construction: an open one is only
                // possible if a lowering forgot, and Unreachable states that
                // rather than leaving a malformed function.
                terminator: block.terminator.unwrap_or(Terminator::Unreachable),
            })
            .collect();
        // The calls through a signature this body made, now that it has a name.
        for mut site in std::mem::take(&mut self.arrivals.pending_sites) {
            site.function.clone_from(&name);
            self.arrivals.uniform_sites.push(site);
        }
        for mut check in std::mem::take(&mut self.arrivals.pending_printer_checks) {
            check.function.clone_from(&name);
            self.arrivals.printer_checks.push(check);
        }
        if let Some(cut) = self.parameter_cut.take() {
            self.arrivals
                .parameter_entries
                .push(parameter_entries::Split {
                    name: name.clone(),
                    cut,
                    public_types: std::mem::take(&mut self.parameter_types),
                });
        }

        Func {
            name,
            params,
            return_type,
            values: std::mem::take(&mut self.values),
            blocks,
            origin,
            exported,
            // Set by the caller: `finish` does not know what it is assembling,
            // and a seventh positional bool next to `exported` would be a
            // parameter waiting to be passed in the wrong order.
            initializes_receiver: false,
            abstract_declaration: false,
            // Not the caller's, because this one is not a property of what is
            // being assembled but of what the body did -- and the body has just
            // finished saying so.
            async_result: self.async_result.as_ref().map(|result| result.promise),
            frame: self.generator.clone(),
            obligations: std::mem::take(&mut self.obligations),
            exact: rustc_hash::FxHashMap::default(),
            written_return: None,
            result_absent: crate::hir::Absent::Impossible,
            validation: None,
            written_return_elements: Vec::new(),
        }
    }

    /// A call to an external runtime function.
    fn call_runtime(
        &mut self,
        name: &str,
        args: Vec<ValueId>,
        ty: HirType,
        origin: &Origin,
    ) -> ValueId {
        self.push(
            OpKind::Call {
                callee: Callee::External(name.to_owned()),
                args,
                frame: None,
            },
            ty,
            origin.clone(),
        )
    }

    /// Lower an expression knowing what type a bare `null` in it should take.
    fn lower_expecting(&mut self, id: NodeId, ty: &HirType) -> Result<ValueId, Diagnostic> {
        let saved = self.expecting.replace(ty.clone());
        let value = self.lower_expression(id);
        self.expecting = saved;
        value
    }

    /// A name no source can have, for a value only the lowering knows about.
    fn synthetic_symbol(&mut self) -> u32 {
        self.synthetic += 1;
        u32::MAX - self.synthetic
    }

    /// `new Counter({ label })`, where `Counter` is a class the program writes
    /// over a `GObject` class: an instance of its own `GType`, made by the
    /// function its backend emits beside the registration
    /// (`nts_gobject_new_Counter`, one reference the caller owns, floating or
    /// not), then a setter for each property. `None` for any other `new`.
    fn gobject_new(&mut self, id: NodeId) -> Option<Result<ValueId, Diagnostic>> {
        let callee = *self.children(id).first()?;
        // Through an import: `new EntryView()` of a class another module
        // wrote names the import's symbol, not the class's.
        let class =
            super::native::schema::class_declaration(self.snapshot, self.node(callee).symbol?)?;
        if super::native::gobject_parent(self.snapshot, class).is_none() {
            // A class of the program's over a handle that nothing registers
            // (`lower_class` refuses it): its `new` would resolve to the
            // parent's construct signature and make a parent.
            let registered = super::native::registered_by_a_runtime(self.snapshot, class);
            let handle = instance_type_of(self.snapshot, class).and_then(|ty| self.represent(ty));
            return (!registered && matches!(handle, Some(HirType::NativePointer(_)))).then(|| {
                Err(self.unsupported(
                    id,
                    "`new` of a class extending a C handle's class that nothing registers",
                ))
            });
        }
        let name = foreign_class_name(self.snapshot, class)?;
        // A class with a constructor is made by it: `{Class}#new`, whose
        // `super(...)` makes the instance.
        if let Some(constructor) = self
            .children(class)
            .into_iter()
            .find(|member| self.kind_of(*member) == Some(syntax::CONSTRUCTOR))
        {
            let callee = Callee::Direct(format!("{name}#new"));
            let arguments = self.arguments_of(id);
            return Some(
                self.lower_call_arguments(id, &callee, &arguments, None)
                    .and_then(|(args, lent)| {
                        self.finish_call(id, callee, args, lent, Some(constructor))
                    }),
            );
        }
        let ty = self.snapshot.node_types.get(&id).copied()?;
        Some(self.lower_gobject_made(id, &name, ty))
    }

    /// An instance of the class `name`, a class the program writes over a
    /// `GObject` class, typed `ty`, with the properties the call at `id`
    /// writes in its literal: `nts_gobject_new_{name}` -- one owned reference
    /// -- then a setter for each. The literal's values first, in its order.
    fn lower_gobject_made(
        &mut self,
        id: NodeId,
        name: &str,
        ty: TypeId,
    ) -> Result<ValueId, Diagnostic> {
        let Some(HirType::NativePointer(pointee @ super::native::Pointee::Opaque(_))) =
            self.represent(ty)
        else {
            return Err(self.unsupported(
                id,
                "an instance of a class extending a GObject class that is not a handle",
            ));
        };
        let represented = HirType::NativePointer(pointee.clone());
        let written = self.constructed_properties(id)?;
        let make = super::native::Function {
            thunk: Some(super::native::GObjectThunk::New {
                class: name.to_owned(),
            }),
            name: format!("nts_gobject_new_{name}"),
            convention: super::native::Convention::C,
            parameters: Vec::new(),
            result: super::native::Type::Pointer(pointee.clone()),
            retention: Vec::new(),
            variadic: None,
            declared_at: None,
            roles: Vec::new(),
            returns_string: None,
            returns_array: None,
            returns_dictionary: None,
            returns_set: None,
            send: None,
            returns_owned: true,
            consumes: Vec::new(),
            frameworks: Vec::new(),
            libraries: Vec::new(),
            defaults: Vec::new(),
            result_as: None,
            vtable: None,
            hresult: false,
            result_as_number: false,
        };
        let origin = self.origin(id);
        let handle = self.push(
            OpKind::Call {
                callee: Callee::Native(std::sync::Arc::new(make)),
                args: Vec::new(),
                frame: None,
            },
            represented,
            origin,
        );
        self.set_constructed(id, handle, ty, &written, &[])?;
        Ok(handle)
    }

    /// After a store into a `GObject` property's field (`notifying`): the
    /// change `GObject` announces (`notify::name`), by the property's spec.
    fn notify_property(
        &mut self,
        id: NodeId,
        slot: (ValueId, u32),
        origin: Origin,
    ) -> Result<(), Diagnostic> {
        let Some((instance, thunk)) = self.notifying.get(&slot).cloned() else {
            return Ok(());
        };
        let void = HirType::NativePointer(super::native::Pointee::Void);
        let instance = self.coerce(instance, &void, id)?;
        let mut notify = synthesized(
            &thunk.symbol(),
            vec![super::native::Type::Pointer(super::native::Pointee::Void)],
            super::native::Type::Void,
            None,
            Vec::new(),
        );
        notify.thunk = Some(thunk);
        self.push(
            OpKind::Call {
                callee: Callee::Native(std::sync::Arc::new(notify)),
                args: vec![instance],
                frame: None,
            },
            HirType::Void,
            origin,
        );
        Ok(())
    }

    /// The selector of `member` where it names a method of an Objective-C
    /// protocol a binding declares: what `delegate?.m?.()` asks the object
    /// whether it answers.
    fn objc_optional_selector(&self, member: NodeId) -> Option<String> {
        let symbol = self
            .snapshot
            .symbols
            .get(self.node(member).symbol?.0 as usize)?;
        symbol
            .declarations
            .iter()
            .copied()
            .find(|declaration| self.objc_protocol_member(*declaration))
            .and_then(|declaration| {
                self.node(declaration)
                    .native
                    .as_ref()
                    .and_then(|native| native.selector.clone())
            })
    }

    /// `delegate?.tableViewDidSelectRowAt?.(table, path)`: Swift's
    /// `delegate?.tableView?(table, didSelectRowAt: path)`. The object is asked
    /// `respondsToSelector:` -- which the runtime answers `NO` for a nil
    /// object, so one test covers an absent receiver too -- and sent the
    /// message only where it answered `YES`. The class the program sees says
    /// nothing here: the object is any class that conforms, and whether it
    /// implements an optional requirement is its class's, at run time.
    fn objc_optional_call(
        &mut self,
        id: NodeId,
        (object, member): (NodeId, NodeId),
        selector: &str,
    ) -> Result<ValueId, Diagnostic> {
        let receiver = self.lower_expression(object)?;
        if !matches!(
            self.values[receiver.0 as usize].ty,
            HirType::NativePointer(_)
        ) {
            return Err(self.unsupported(id, "an optional requirement of an Objective-C protocol on something that is not an object"));
        }
        let origin = self.origin(id);
        let present = self.responds_to(receiver, selector, origin);
        self.lower_branching_value(
            id,
            present,
            Branch::MethodOn(receiver, object, member, None),
            Branch::Absent,
        )
    }

    /// `[receiver respondsToSelector:@selector(selector)]`, which the runtime
    /// answers `NO` for a nil receiver.
    fn responds_to(&mut self, receiver: ValueId, selector: &str, origin: Origin) -> ValueId {
        let HirType::NativePointer(pointee) = self.values[receiver.0 as usize].ty.clone() else {
            unreachable!("`respondsToSelector:` is sent only to an object")
        };
        let selector_pointee = super::native::Pointee::Opaque("objc_selector".into());
        let selector_value = self.push(
            OpKind::ObjcSelector {
                name: selector.to_owned(),
            },
            HirType::NativePointer(selector_pointee.clone()),
            origin.clone(),
        );
        let responds = synthesized(
            "respondsToSelector:",
            vec![
                super::native::Type::Pointer(pointee),
                super::native::Type::Pointer(selector_pointee),
            ],
            super::native::Type::Bool,
            Some(super::native::Send {
                selector: "respondsToSelector:".to_owned(),
                class: None,
                super_of: None,
            }),
            Vec::new(),
        );
        self.push(
            OpKind::Call {
                callee: Callee::Native(std::sync::Arc::new(responds)),
                args: vec![receiver, selector_value],
                frame: None,
            },
            HirType::Bool,
            origin,
        )
    }

    /// Whether `ty` declares `key` as a method *and* optionally.
    ///
    /// Both halves matter. A required method is a plain virtual call and never
    /// reaches here; an optional **property** holding a closure is a field with
    /// a representation already, and stealing it would replace a working
    /// lowering with a class test.
    fn declares_an_optional_method(&self, ty: TypeId, key: &PropertyKey) -> bool {
        let ty = super::generics::concrete(self.snapshot, ty);
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return false;
        };
        match &record.kind {
            TypeKind::Object { .. } => self.declares_it_optionally(ty, key),
            // **`a?.b?.()` — the receiver is optional too.** Its type is then a
            // union with an absence in it rather than an object, and asking an
            // object question of a union answered `false`: the callee fell
            // through to being lowered as a *value*, and the refusal was
            // ``a union of a function type | undefined``, about the member, for
            // a program whose difference is in the receiver.
            //
            // **One test still, not two.** Both absences produce `undefined`
            // and the `InstanceOf` below already answers for both: an absent
            // receiver is an instance of no class, so the arm that calls is
            // exactly the arm where the receiver is present *and* its class
            // has the slot. What the second `?.` adds is the narrowing --
            // `present_of` on the receiver, which a singly-optional call has
            // nothing to do for and which this one cannot omit.
            //
            // **Every** present member has to declare it, not any: a union
            // where one arm has the method and another does not is a program
            // whose receiver may be an object with no slot at all, and the
            // class test would send it to the calling arm.
            TypeKind::Union(members) => {
                let present: Vec<TypeId> = members
                    .iter()
                    .filter(|member| absence_of_member(self.snapshot, **member).is_none())
                    .copied()
                    .collect();
                !present.is_empty()
                    && present.iter().all(|member| {
                        self.declares_it_optionally(
                            super::generics::concrete(self.snapshot, *member),
                            key,
                        )
                    })
            }
            _ => false,
        }
    }

    /// Whether this *object* type declares `key` as a method, optionally.
    ///
    /// One level, deliberately: a union member that is itself a union is not
    /// something the checker hands back, and recursing would buy a shape that
    /// does not occur at the cost of a depth this cannot bound.
    fn declares_it_optionally(&self, ty: TypeId, key: &PropertyKey) -> bool {
        if self.projected_callable(ty, key).is_some() {
            return true;
        }
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return false;
        };
        let TypeKind::Object { properties } = &record.kind else {
            return false;
        };
        properties.iter().any(|property| {
            property.name == *key
                && property.optional
                && property.kind == nts_semantic_schema::MemberKind::Method
        })
    }

    /// A negative HRESULT `status` thrown, as an `Error` carrying the
    /// system's text for it, with what the call was lent given back on both
    /// paths.
    fn throw_on_failure(
        &mut self,
        id: NodeId,
        status: ValueId,
        lent: Vec<Lent>,
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        let zero = self.push(
            OpKind::ConstInt(0),
            HirType::Int {
                bits: 32,
                signed: true,
            },
            origin.clone(),
        );
        let failed = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: status,
                rhs: zero,
            },
            HirType::Bool,
            origin.clone(),
        );
        let raise = self.new_block();
        let after = self.new_block();
        self.terminate(Terminator::Branch {
            cond: failed,
            then_target: raise,
            then_args: Vec::new(),
            else_target: after,
            else_args: Vec::new(),
        });
        self.switch_to(raise);
        self.give_back(id, lent.clone())?;
        let char_pointer = super::native::Type::Pointer(super::native::Pointee::Scalar(
            super::native::Scalar::Char,
        ));
        let message = self.runtime_call(
            "nts_hresult_message",
            vec![status],
            char_pointer.representation(),
            origin.clone(),
        );
        self.throw_c_message(id, message, origin)?;
        self.switch_to(after);
        self.give_back(id, lent)?;
        Ok(())
    }

    /// An `@ntsHresult` call: the HRESULT checked -- a negative one gives back
    /// what was lent and throws an `Error` carrying the system's text for it --
    /// and then the result read out of the slot C wrote it to.
    ///
    /// **What the slot holds decides how it is read**, and each reading is one
    /// the rest of the compiler already knows: a `boolean` byte compared with
    /// zero; a counted handle through
    /// `nts_com_take`, a runtime call, whose result the ownership pass reads
    /// as produced -- the `+1` a Windows Runtime `[out]` object is -- and
    /// releases; an
    /// `HSTRING` copied into a `string` and deleted; a scalar loaded.
    fn finish_hresult_call(
        &mut self,
        id: NodeId,
        callee: Callee,
        args: Vec<ValueId>,
        lent: Vec<Lent>,
        declaration: Option<NodeId>,
        typed: Option<HirType>,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let status = self.push_call(
            id,
            callee,
            args,
            declaration,
            Some(HirType::Int {
                bits: 32,
                signed: true,
            }),
        )?;
        // Failed calls need not leave outputs empty and grant no ownership of
        // what they wrote. Clear every output, including counts and composable
        // inner objects, before any read can take, copy or delete its value.
        // Keep the slots in the call's block: moving their reads past the
        // status branch violates the local-storage contract in loops/async.
        self.clear_failed_results(id, status, &lent, &origin)?;
        // A count slot is the one its received array's slot follows.
        let mut count = None;
        let written: Vec<_> = lent
            .iter()
            .filter_map(|lent| match lent {
                Lent::Count { slot } => {
                    count = Some(*slot);
                    None
                }
                Lent::Result {
                    slot,
                    written,
                    field,
                } => Some((*slot, *written, field.clone(), count.take())),
                _ => None,
            })
            .collect();
        let mut value = None;
        let mut fields = Vec::new();
        for (slot, written, field, count) in written {
            // What the slot is read as: the call's value, or its field.
            let want = match &field {
                Some(field) => self.out_field_type(id, typed.as_ref(), field)?,
                None => typed.clone(),
            };
            let read = self.read_written(id, (slot, count), written, want.as_ref(), &origin)?;
            match field {
                Some(field) => fields.push((field, read)),
                None => value = Some(read),
            }
        }
        let lent: Vec<Lent> = lent
            .into_iter()
            .map(|lent| match lent {
                Lent::Inner { slot } => Lent::Taken {
                    object: self.runtime_call(
                        "nts_com_take",
                        vec![slot],
                        HirType::NativePointer(super::native::Pointee::Void),
                        origin.clone(),
                    ),
                },
                other => other,
            })
            .collect();
        self.throw_on_failure(id, status, lent, &origin)?;
        if fields.is_empty() {
            return Ok(match value {
                Some(value) => value,
                None => self.push(
                    OpKind::ConstUndefined,
                    typed.unwrap_or(HirType::Void),
                    origin,
                ),
            });
        }
        // `@ntsHresult out`: an object of the call's type, one field per
        // slot, made only once the call succeeded -- a failed one throws
        // with nothing allocated. Its values were read before the branch;
        // only the slots have to be.
        // No type given is the node's own, as `push_call` reads it.
        let Some(HirType::Managed(ManagedType::Object(type_id))) =
            typed.or_else(|| self.type_of(id))
        else {
            return Err(
                self.unsupported(id, "an `@ntsHresult out` call whose value is not an object")
            );
        };
        let layout = self.layout_of(id, type_id)?;
        let object = self.push(
            OpKind::ObjectNew { frame: false },
            HirType::Managed(ManagedType::Object(type_id)),
            origin.clone(),
        );
        for (field, read) in fields {
            let Some(index) = layout.index_of(&field) else {
                return Err(self.unsupported(
                    id,
                    "an `@ntsHresult out` field the result's type does not declare",
                ));
            };
            let want = layout.fields[index as usize].ty.clone();
            let read = self.coerce(read, &want, id)?;
            self.field_set(object, index, read, &origin);
        }
        Ok(object)
    }

    fn clear_failed_results(
        &mut self,
        id: NodeId,
        status: ValueId,
        lent: &[Lent],
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        for lent in lent {
            let (Lent::Result { slot, .. } | Lent::Count { slot } | Lent::Inner { slot }) = lent
            else {
                continue;
            };
            let HirType::NativePointer(storage) = self.values[slot.0 as usize].ty.clone() else {
                return Err(self.unsupported(id, "an HRESULT output without native storage"));
            };
            let bytes = self.push(
                OpKind::NativeSizeOf(storage),
                HirType::NUMBER,
                origin.clone(),
            );
            // NativeSizeOf is a number by the op's contract; the external
            // helper takes size_t. State that conversion before the call,
            // rather than relying on runtime-signature specialization.
            let bytes = self.coerce(bytes, &super::native::Scalar::Size.representation(), id)?;
            self.runtime_call(
                "nts_hresult_clear",
                vec![status, *slot, bytes],
                HirType::Void,
                origin.clone(),
            );
        }
        Ok(())
    }

    /// The type of `field` of an `@ntsHresult out` call's value, which a
    /// slot written for that field is read as.
    fn out_field_type(
        &mut self,
        id: NodeId,
        typed: Option<&HirType>,
        field: &str,
    ) -> Result<Option<HirType>, Diagnostic> {
        let Some(HirType::Managed(ManagedType::Object(type_id))) =
            typed.cloned().or_else(|| self.type_of(id))
        else {
            return Ok(None);
        };
        let layout = self.layout_of(id, type_id)?;
        Ok(layout
            .index_of(field)
            .map(|index| layout.fields[index as usize].ty.clone()))
    }

    /// What an `@ntsHresult` call wrote to its result slot, as the program
    /// holds it. See `finish_hresult_call` for where this is read.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn read_written(
        &mut self,
        id: NodeId,
        (slot, count): (ValueId, Option<ValueId>),
        written: super::native::Written,
        typed: Option<&HirType>,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let first =
            |this: &mut Self| this.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        Ok(match written {
            // The elements and their count, copied into a typed array of
            // their kind, and the callee's block freed: the ABI makes it the
            // caller's. A failed call left both zeroed, which reads as empty.
            super::native::Written::Received { kind } => {
                let Some(count) = count else {
                    return Err(
                        self.unsupported(id, "a received array with no count slot before it")
                    );
                };
                let element = match self.values[slot.0 as usize].ty.clone() {
                    HirType::NativePointer(super::native::Pointee::Pointer(element)) => *element,
                    _ => {
                        return Err(self.unsupported(
                            id,
                            "a received array whose slot is not a pointer to its elements",
                        ));
                    }
                };
                let index = first(self);
                let elements = self.push(
                    OpKind::NativeLoad {
                        pointer: slot,
                        index,
                    },
                    HirType::NativePointer(element.clone()),
                    origin.clone(),
                );
                let index = first(self);
                let length_type = HirType::Int {
                    bits: 32,
                    signed: false,
                };
                let length = self.push(
                    OpKind::NativeLoad {
                        pointer: count,
                        index,
                    },
                    length_type,
                    origin.clone(),
                );
                let kind = self.push(
                    OpKind::ConstFloat(f64::from(kind)),
                    HirType::NUMBER,
                    origin.clone(),
                );
                let super::native::Pointee::Scalar(scalar) = element else {
                    return Err(
                        self.unsupported(id, "a received array of something other than numbers")
                    );
                };
                let view = HirType::Managed(ManagedType::View(Box::new(
                    super::native::Type::Scalar(scalar).representation(),
                )));
                self.runtime_call(
                    "nts_winrt_received",
                    vec![elements, length, kind],
                    view,
                    origin.clone(),
                )
            }
            // The objects moved into an array of the program's made for
            // them, and the callee's block freed. Zeroed on a failed call,
            // which reads as empty.
            super::native::Written::ReceivedElements => {
                let Some(count) = count else {
                    return Err(
                        self.unsupported(id, "a received array with no count slot before it")
                    );
                };
                let ty = typed
                    .cloned()
                    .or_else(|| self.type_of(id))
                    .ok_or_else(|| self.unrepresentable(id, "a received array of structs"))?;
                self.elements_received(id, (slot, count), ty)?
            }
            super::native::Written::ReceivedStrings | super::native::Written::ReceivedHandles => {
                self.read_received_references(id, written, (slot, count), typed, origin)?
            }
            super::native::Written::HString => {
                let index = first(self);
                let hstring = self.push(
                    OpKind::NativeLoad {
                        pointer: slot,
                        index,
                    },
                    HirType::NativePointer(super::native::Pointee::Void),
                    origin.clone(),
                );
                self.runtime_call(
                    "nts_string_from_hstring",
                    vec![hstring],
                    HirType::Managed(ManagedType::String),
                    origin.clone(),
                )
            }
            // The object written, unboxed: the runtime takes over the
            // reference and answers the value that owns what is left of it.
            super::native::Written::Boxed => {
                let index = first(self);
                let object = self.push(
                    OpKind::NativeLoad {
                        pointer: slot,
                        index,
                    },
                    HirType::NativePointer(super::native::Pointee::Void),
                    origin.clone(),
                );
                self.runtime_call(
                    "nts_winrt_unbox",
                    vec![object],
                    HirType::Erased,
                    origin.clone(),
                )
            }
            // The slot is the record's storage, and so the value -- which is
            // why a record result is still refused in a loop, as a C
            // function's is.
            super::native::Written::Record => slot,
            // Copied out into an object of the program's, the slot dead after.
            super::native::Written::Copied => {
                let ty = typed
                    .cloned()
                    .or_else(|| self.type_of(id))
                    .ok_or_else(|| self.unrepresentable(id, "a copied struct"))?;
                self.object_from_copied(id, slot, &ty)?
            }
            // A read the checker narrowed to `null` -- right after `x = null`
            // -- has no representation of its own; the erased value is it.
            super::native::Written::Reference(referenced) => {
                let ty = typed
                    .cloned()
                    .or_else(|| self.type_of(id))
                    .unwrap_or(HirType::Erased);
                self.read_reference(id, slot, referenced, &ty)?
            }
            super::native::Written::Bool => {
                let index = first(self);
                let byte_type = HirType::Int {
                    bits: 8,
                    signed: false,
                };
                let byte = self.push(
                    OpKind::NativeLoad {
                        pointer: slot,
                        index,
                    },
                    byte_type.clone(),
                    origin.clone(),
                );
                let zero = self.push(OpKind::ConstInt(0), byte_type, origin.clone());
                self.push(
                    OpKind::Binary {
                        op: BinOp::Ne,
                        lhs: byte,
                        rhs: zero,
                    },
                    HirType::Bool,
                    origin.clone(),
                )
            }
            super::native::Written::Value => {
                match self.values[slot.0 as usize].ty.clone() {
                    HirType::NativePointer(super::native::Pointee::Pointer(held)) => {
                        let handle = super::native::Type::Pointer((*held).clone());
                        if held.counting().is_some() {
                            // A runtime call, which the ownership pass reads as
                            // producing its result: the `+1` the object came with.
                            self.runtime_call(
                                "nts_com_take",
                                vec![slot],
                                handle.representation(),
                                origin.clone(),
                            )
                        } else {
                            let index = first(self);
                            self.push(
                                OpKind::NativeLoad {
                                    pointer: slot,
                                    index,
                                },
                                handle.representation(),
                                origin.clone(),
                            )
                        }
                    }
                    HirType::NativePointer(super::native::Pointee::Scalar(scalar)) => {
                        let index = first(self);
                        self.push(
                            OpKind::NativeLoad {
                                pointer: slot,
                                index,
                            },
                            super::native::Type::Scalar(scalar).representation(),
                            origin.clone(),
                        )
                    }
                    _ => return Err(self.unsupported(
                        id,
                        "an @ntsHresult result slot that holds neither a pointer nor a C scalar",
                    )),
                }
            }
        })
    }

    /// An array of strings or of objects a Windows Runtime call handed back:
    /// its block and count read from their slots, then each `HSTRING` copied
    /// into a `string` of a new array (`nts_winrt_received_strings`), or each
    /// object moved into an array of the program's made for them, whose
    /// descriptor is the objects' family's (`nts_winrt_received_handles`).
    fn read_received_references(
        &mut self,
        id: NodeId,
        written: super::native::Written,
        (slot, count): (ValueId, Option<ValueId>),
        typed: Option<&HirType>,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let Some(count) = count else {
            return Err(self.unsupported(id, "a received array with no count slot before it"));
        };
        let index = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let block = HirType::NativePointer(super::native::Pointee::Pointer(Box::new(
            super::native::Pointee::Void,
        )));
        let block = self.push(
            OpKind::NativeLoad {
                pointer: slot,
                index,
            },
            block,
            origin.clone(),
        );
        let index = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let length = self.push(
            OpKind::NativeLoad {
                pointer: count,
                index,
            },
            HirType::Int {
                bits: 32,
                signed: false,
            },
            origin.clone(),
        );
        if written == super::native::Written::ReceivedStrings {
            let ty = HirType::Managed(ManagedType::Array(Box::new(HirType::Managed(
                ManagedType::String,
            ))));
            return Ok(self.runtime_call(
                "nts_winrt_received_strings",
                vec![block, length],
                ty,
                origin.clone(),
            ));
        }
        let Some(ty @ HirType::Managed(ManagedType::Array(_))) =
            typed.cloned().or_else(|| self.type_of(id))
        else {
            return Err(self.unsupported(
                id,
                "a received array of objects read as something other than an array",
            ));
        };
        let size = self.coerce(length, &HirType::NUMBER, id)?;
        let array = self.push(
            OpKind::ArrayNew {
                length: size,
                fill: ArrayFill::Holes,
            },
            ty,
            origin.clone(),
        );
        self.runtime_call(
            "nts_winrt_received_handles",
            vec![array, block, length],
            HirType::Void,
            origin.clone(),
        );
        Ok(array)
    }

    /// Throw an `Error` whose message is a `malloc`'d C string, which is
    /// copied and then freed: what `@ntsThrows`' converter and a failed
    /// HRESULT both hand back.
    fn throw_c_message(
        &mut self,
        id: NodeId,
        message: ValueId,
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        // Copied into the `Error`'s message, then C's freed. Not through
        // `read_native_string`, which types its copy as the *call's* result.
        let text = self.runtime_call(
            "nts_string_from_required_cstring",
            vec![message],
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        // Freed by the compiler's own memory operation, which is what this is.
        // A `free` synthesized as a native call was a second spelling of it,
        // and the rule that keeps a binding's `free` from colliding with
        // `c:stdlib`'s (`native::layouts`) could not tell the two apart: a
        // program calling a throwing binding and using `malloc` was refused.
        self.push(
            OpKind::NativeFree { pointer: message },
            HirType::Void,
            origin.clone(),
        );
        self.throw_provided_error_text(id, "Error", text)
    }

    /// A record result's storage: a local of the caller's, so the local's
    /// rules are the result's, passed as the call's last argument.
    fn record_destination(
        &mut self,
        target: &super::native::Function,
        origin: &Origin,
    ) -> Option<ValueId> {
        let destination = target.destination()?.representation();
        Some(self.push(
            OpKind::NativeLocal { count: 1 },
            destination,
            origin.clone(),
        ))
    }

    /// `nts_closure_unlend`, as the destroy function's type the binding
    /// states. `GLib`'s `GClosureNotify` takes the `GClosure` second, and the
    /// release ignores it -- which is `GLib`'s own `(GClosureNotify) g_free`.
    fn closure_notify(&mut self, want: HirType, origin: &Origin) -> ValueId {
        let released =
            super::native::Type::FnPointer(std::sync::Arc::new(super::native::FnPointer::spell(
                vec![super::native::Type::Pointer(super::native::Pointee::Void)],
                super::native::Type::Void,
            )))
            .representation();
        let notify = self.runtime_call(
            "nts_closure_notify",
            Vec::new(),
            released.clone(),
            origin.clone(),
        );
        if released == want {
            notify
        } else {
            self.push(OpKind::Convert(notify), want, origin.clone())
        }
    }

    /// The value an `@ntsThrows` parameter receives: the caller's own slot
    /// where one was written, and otherwise a zeroed local of ours, recorded
    /// so that `finish_call` checks it.
    fn error_slot(
        &mut self,
        written: Option<ValueId>,
        ty: HirType,
        converter: String,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> ValueId {
        if let Some(written) = written {
            return written;
        }
        let slot = self.push(OpKind::NativeLocal { count: 1 }, ty, origin.clone());
        lent.push(Lent::Error { slot, converter });
        slot
    }

    /// After a call that reports failure through `slot` (`@ntsThrows`): if C
    /// wrote an error there, throw an `Error` whose message is what
    /// `converter` makes of it. The converter takes the error -- it frees it --
    /// and answers a `malloc`'d message, which is copied and freed here:
    /// `nts_gerror_take_message` for `GLib`'s `GError`.
    fn throw_if_reported(
        &mut self,
        id: NodeId,
        slot: ValueId,
        converter: &str,
        lent: &[Lent],
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let HirType::NativePointer(super::native::Pointee::Pointer(error)) =
            self.values[slot.0 as usize].ty.clone()
        else {
            return Err(
                self.unsupported(id, "an @ntsThrows slot that is not a pointer to a pointer")
            );
        };
        let error_ty = HirType::NativePointer((*error).clone());
        let first = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let reported = self.push(
            OpKind::NativeLoad {
                pointer: slot,
                index: first,
            },
            error_ty.clone(),
            origin.clone(),
        );
        let none = self.push(OpKind::ConstNull, error_ty, origin.clone());
        let failed = self.push(
            OpKind::Binary {
                op: BinOp::Ne,
                lhs: reported,
                rhs: none,
            },
            HirType::Bool,
            origin.clone(),
        );
        let raise = self.new_block();
        let after = self.new_block();
        self.terminate(Terminator::Branch {
            cond: failed,
            then_target: raise,
            then_args: Vec::new(),
            else_target: after,
            else_args: Vec::new(),
        });
        self.switch_to(raise);
        // Everything lent to the call, given back before the throw leaves.
        self.give_back(id, lent.to_vec())?;
        let convert = std::sync::Arc::new(super::native::Function {
            thunk: None,
            name: converter.to_owned(),
            convention: super::native::Convention::C,
            parameters: vec![super::native::Type::Pointer((*error).clone())],
            result: super::native::Type::Pointer(super::native::Pointee::Scalar(
                super::native::Scalar::Char,
            )),
            retention: vec![super::native::Retention::Unknown],
            variadic: None,
            // Not the library's own header: the converter is the program's
            // (GLib's lives in the GLib host), so there is nothing to check
            // its prototype against.
            declared_at: None,
            roles: vec![super::native::Role::Plain],
            returns_string: None,
            returns_array: None,
            returns_dictionary: None,
            returns_set: None,
            send: None,
            returns_owned: false,
            consumes: Vec::new(),
            frameworks: Vec::new(),
            libraries: Vec::new(),
            defaults: Vec::new(),
            result_as: None,
            vtable: None,
            hresult: false,
            result_as_number: false,
        });
        let char_pointer = super::native::Type::Pointer(super::native::Pointee::Scalar(
            super::native::Scalar::Char,
        ));
        let message = self.push(
            OpKind::Call {
                callee: Callee::Native(convert),
                args: vec![reported],
                frame: None,
            },
            char_pointer.representation(),
            origin.clone(),
        );
        self.throw_c_message(id, message, &origin)?;
        self.switch_to(after);
        Ok(())
    }

    fn objc_protocol_member(&self, declaration: NodeId) -> bool {
        self.kind_of(declaration) == Some(syntax::METHOD_SIGNATURE)
            && self.declaring_protocol(declaration).is_some()
    }

    /// The Objective-C protocol a binding declares (`@ntsProtocol`) that
    /// declares `member`, a method or a property requirement.
    fn declaring_protocol(&self, member: NodeId) -> Option<NodeId> {
        let mut owner = self.node(member).parent;
        while let Some(at) = owner.filter(|at| self.kind_of(*at).is_none()) {
            owner = self.node(at).parent;
        }
        owner.filter(|at| {
            self.kind_of(*at) == Some(syntax::INTERFACE_DECLARATION)
                && self
                    .node(*at)
                    .native
                    .as_ref()
                    .is_some_and(|native| native.protocol.is_some())
        })
    }

    /// Whether a binding's method is called on an instance: an interface
    /// method declaring `this: T`, or a member of a Windows Runtime class's
    /// idiomatic surface, which declares no `this` -- it is inherited by every
    /// subclass and called on whichever instance the call names, through the
    /// interface its `@ntsVia` asks for. The one answer `native_method` and
    /// `vtable_of` both ask.
    fn is_native_instance_method(
        &self,
        declaration: NodeId,
        signature: &nts_semantic_schema::SignatureRecord,
    ) -> bool {
        let via = self
            .node(declaration)
            .native
            .as_ref()
            .is_some_and(|n| n.via.is_some() || n.listener.is_some());
        self.kind_of(declaration) == Some(syntax::METHOD_SIGNATURE)
            && (signature.this_type.is_some() || via)
    }

    /// `handle.method(args)` as `function(handle, args)`, for an `@ntsCall`
    /// method: the receiver is the function's first argument, converted to
    /// its type, and the rest are the method's.
    /// The method a call reaches, where it is a method of an Objective-C
    /// class the program writes (`Program::foreign_classes`).
    fn program_objc_method(&self, id: NodeId) -> Option<NodeId> {
        let declaration = self.snapshot.call_targets.get(&id)?.callee?;
        if self.kind_of(declaration) != Some(syntax::METHOD_DECLARATION)
            || is_static_member(self.snapshot, declaration)
        {
            return None;
        }
        let class = self.enclosing_class(declaration)?;
        super::native::extends_objc(self.snapshot, class).then_some(declaration)
    }

    /// A call from TypeScript to a method of an Objective-C class the program
    /// writes: the compiled method itself, called directly, as a call to one
    /// of the program's own class methods is. The runtime reaches the same
    /// function through the entry point the backend builds for it; a call
    /// the program writes needs no message.
    fn lower_program_objc_call(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        method: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let class = self
            .enclosing_class(method)
            .ok_or_else(|| self.unsupported(id, "a method outside a class"))?;
        let member = self
            .member_name(method)
            .ok_or_else(|| self.unsupported(id, "a member whose name the program computes"))?;
        let name = format!("{}#{member}", self.class_name_for(class, None, false)?);
        let parameters: Vec<NodeId> = self
            .children(method)
            .into_iter()
            .filter(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
            .collect();
        if arguments.len() != parameters.len() {
            return Err(self.unsupported(
                id,
                "a call to an Objective-C method of the program's with a default or rest parameter",
            ));
        }
        // A subclass's instance, seen as the class that declares the method:
        // `derived.bumpA()` passes a `Derived` where `Base#bumpA` takes a
        // `Base`, which is one pointer, converted as a handle is.
        let this = instance_type_of(self.snapshot, class)
            .and_then(|ty| self.represent(ty))
            .ok_or_else(|| self.unrepresentable(id, "a method's receiver"))?;
        let mut args = vec![self.coerce(receiver, &this, id)?];
        for (argument, parameter) in arguments.iter().zip(&parameters) {
            // Labels, which the method takes as the runtime passes them: a
            // literal's properties, never built, or an object's fields.
            let declared = self.snapshot.node_types.get(parameter).copied();
            if let Some(labels) = declared
                .filter(|ty| super::native::abi_type(self.snapshot, *ty).is_none())
                .and_then(|ty| super::native::labels_of(self.snapshot, ty))
            {
                if self.kind_of(*argument) == Some(syntax::OBJECT_LITERAL_EXPRESSION) {
                    self.labels_pending.insert(*argument);
                }
                let given = self.lower_expression(*argument)?;
                for (key, ty) in labels {
                    let value = self.label_value(*argument, Some(given), &key)?;
                    let want = self
                        .represent(ty)
                        .ok_or_else(|| self.unrepresentable(*argument, "a label"))?;
                    args.push(self.coerce(value, &want, *argument)?);
                }
                continue;
            }
            let ty = self
                .type_of(*parameter)
                .ok_or_else(|| self.unrepresentable(*parameter, "a method parameter"))?;
            let value = self.lower_expecting(*argument, &ty)?;
            args.push(self.coerce(value, &ty, *argument)?);
        }
        let Some(dispatch) = self.objc_dispatch(class, method, &member) else {
            return self.push_call(id, Callee::Direct(name), args, Some(method), None);
        };
        self.dispatch_objc_call(id, &member, &dispatch, &args)
    }

    /// The method named `member` that `class` itself implements: a method
    /// with a body, not an overload signature or a static one.
    fn own_method(&self, class: NodeId, member: &str) -> Option<NodeId> {
        self.children(class).into_iter().find(|child| {
            self.kind_of(*child) == Some(syntax::METHOD_DECLARATION)
                && !is_static_member(self.snapshot, *child)
                && self.member_name(*child).as_deref() == Some(member)
                && self
                    .children(*child)
                    .into_iter()
                    .any(|part| self.kind_of(part) == Some(syntax::BLOCK))
        })
    }

    /// How a call to `method`, `class`'s method named `member`, dispatches
    /// over the classes the program writes from `class` down -- the whole
    /// world a class of the program's is subclassed in, since a binding's
    /// classes are Objective-C's and never extend one of the program's.
    /// `None` where no subclass overrides it, and the call is direct.
    fn objc_dispatch(&self, class: NodeId, method: NodeId, member: &str) -> Option<ObjcDispatch> {
        let chain = |from: NodeId| {
            let mut seen = rustc_hash::FxHashSet::default();
            std::iter::successors(Some(from), |at| {
                super::native::superclass(self.snapshot, *at)
            })
            .take_while(move |at| seen.insert(*at))
        };
        let mut exact = Vec::new();
        let mut overriders = Vec::new();
        for tested in self
            .hierarchy
            .objc_classes
            .iter()
            .copied()
            .filter(|c| chain(*c).any(|at| at == class))
        {
            // The nearest class from `tested` up to `class` that implements
            // it: `tested`'s own method, or the one it inherits.
            let (owner, answering) = chain(tested).find_map(|at| {
                if at == class {
                    Some((class, method))
                } else {
                    self.own_method(at, member).map(|own| (at, own))
                }
            })?;
            let arm = ObjcArm {
                tested,
                owner,
                method: answering,
            };
            if owner == tested && tested != class {
                overriders.push((chain(tested).count(), arm));
            }
            exact.push(arm);
        }
        if overriders.is_empty() {
            return None;
        }
        // Deepest first: of two overriders a receiver is a kind of, the
        // deeper is nearer its class, and its method is the one it has.
        overriders.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.tested.0.cmp(&b.1.tested.0)));
        let base = ObjcArm {
            tested: class,
            owner: class,
            method,
        };
        Some(ObjcDispatch {
            exact,
            overriders: overriders.into_iter().map(|(_, arm)| arm).collect(),
            base,
        })
    }

    /// A call to a method some of the program's subclasses override, at a
    /// vtable's cost. First the receiver's own class, read once
    /// (`object_getClass`) and compared with each class the program writes
    /// below the method's: a load and a compare each, then a direct call of
    /// the method that class has. Then a class the runtime made below one of
    /// the program's -- key-value observing's `NSKVONotifying_` subclass --
    /// asked `isKindOfClass:` of each overrider, deepest first. Then the
    /// method itself. Every arm is a direct call, so a method no message
    /// could carry (`g(s: string)`) dispatches as a registered one does.
    fn dispatch_objc_call(
        &mut self,
        id: NodeId,
        member: &str,
        dispatch: &ObjcDispatch,
        args: &[ValueId],
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let receiver = args[0];
        let HirType::NativePointer(pointee) = self.values[receiver.0 as usize].ty.clone() else {
            return Err(self.unsupported(id, "a method of an Objective-C class the program writes on something that is not an object"));
        };
        let class_pointee = super::native::Pointee::Opaque("objc_class".into());
        let class_ty = HirType::NativePointer(class_pointee.clone());
        let get_class = synthesized(
            "object_getClass",
            vec![super::native::Type::Pointer(pointee.clone())],
            super::native::Type::Pointer(class_pointee.clone()),
            None,
            Vec::new(),
        );
        let is_kind = std::sync::Arc::new(synthesized(
            "isKindOfClass:",
            vec![
                super::native::Type::Pointer(pointee),
                super::native::Type::Pointer(class_pointee),
            ],
            super::native::Type::Bool,
            Some(super::native::Send {
                selector: "isKindOfClass:".to_owned(),
                class: None,
                super_of: None,
            }),
            Vec::new(),
        ));
        let joined = self.new_block();
        let mut result = None;
        let isa = self.push(
            OpKind::Call {
                callee: Callee::Native(std::sync::Arc::new(get_class)),
                args: vec![receiver],
                frame: None,
            },
            class_ty.clone(),
            origin.clone(),
        );
        for arm in &dispatch.exact {
            let class = self.objc_class_value(id, arm.tested, &class_ty)?;
            let same = self.push(
                OpKind::Binary {
                    op: BinOp::Eq,
                    lhs: isa,
                    rhs: class,
                },
                HirType::Bool,
                origin.clone(),
            );
            self.objc_arm(id, member, Some(same), arm, args, (joined, &mut result))?;
        }
        for arm in &dispatch.overriders {
            let class = self.objc_class_value(id, arm.tested, &class_ty)?;
            let kind = self.push(
                OpKind::Call {
                    callee: Callee::Native(is_kind.clone()),
                    args: vec![receiver, class],
                    frame: None,
                },
                HirType::Bool,
                origin.clone(),
            );
            self.objc_arm(id, member, Some(kind), arm, args, (joined, &mut result))?;
        }
        self.objc_arm(
            id,
            member,
            None,
            &dispatch.base,
            args,
            (joined, &mut result),
        )?;
        self.switch_to(joined);
        // A method returning nothing: the placeholder a statement-level call
        // leaves, as every void expression here is.
        Ok(result.unwrap_or_else(|| self.push(OpKind::ConstFloat(0.0), HirType::Void, origin)))
    }

    /// The class object of `class`, a class the program writes, by the name
    /// the runtime registered it under.
    fn objc_class_value(
        &mut self,
        id: NodeId,
        class: NodeId,
        ty: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let name = super::native::objc_name(self.snapshot, class)
            .ok_or_else(|| self.unsupported(id, "a class the runtime knows by no name"))?;
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::ObjcClass {
                name,
                frameworks: Vec::new(),
            },
            ty.clone(),
            origin,
        ))
    }

    /// One arm of [`Self::dispatch_objc_call`]: where `test` holds -- or
    /// unconditionally, with none -- the receiver as the answering class's
    /// handle (the test just said it is one, as `instanceof` narrows) and a
    /// direct call of its method, whose value joins the others at `joined`.
    fn objc_arm(
        &mut self,
        id: NodeId,
        member: &str,
        test: Option<ValueId>,
        arm: &ObjcArm,
        args: &[ValueId],
        (joined, result): (BlockId, &mut Option<ValueId>),
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let next = test.map(|cond| {
            let (taken, next) = (self.new_block(), self.new_block());
            self.terminate(Terminator::Branch {
                cond,
                then_target: taken,
                then_args: Vec::new(),
                else_target: next,
                else_args: Vec::new(),
            });
            self.switch_to(taken);
            next
        });
        let this_ty = instance_type_of(self.snapshot, arm.owner)
            .and_then(|ty| self.represent(ty))
            .ok_or_else(|| self.unrepresentable(id, "an overriding method's receiver"))?;
        let mut args = args.to_vec();
        if this_ty != self.values[args[0].0 as usize].ty {
            args[0] = self.push(OpKind::Convert(args[0]), this_ty, origin.clone());
        }
        let callee = format!("{}#{member}", self.class_name_for(arm.owner, None, false)?);
        let value = self.push_call(id, Callee::Direct(callee), args, Some(arm.method), None)?;
        let ty = self.values[value.0 as usize].ty.clone();
        let passed = if ty == HirType::Void {
            Vec::new()
        } else {
            if result.is_none() {
                *result = Some(self.push_block_param(joined, ty, origin));
            }
            vec![value]
        };
        self.terminate(Terminator::Jump {
            target: joined,
            args: passed,
        });
        if let Some(next) = next {
            self.switch_to(next);
        }
        Ok(())
    }

    /// The type of a sequence a native method answers -- one with `length` and
    /// `item`, as nts:dom's `EventTargetSequence` -- where the program reads
    /// the call as an array: lib.dom's `composedPath(): EventTarget[]`.
    fn sequence_for_array(&self, id: NodeId, returned: TypeId) -> Option<TypeId> {
        matches!(
            self.type_of(id),
            Some(HirType::Managed(ManagedType::Array(_)))
        )
        .then_some(())?;
        matches!(self.represent(returned), Some(HirType::NativePointer(_))).then_some(())?;
        self.walk_method(returned, "_get_length")?;
        self.walk_method(returned, "item")?;
        Some(returned)
    }

    /// A sequence a binding answered, as the new array the program reads it
    /// as: `WebIDL` converts a `sequence<T>` to a new JavaScript array each time,
    /// so page script's `composedPath()` is a fresh array too, and one the
    /// program owns is that. Each item is read as the array's element type, a
    /// kind of what `item` answers on the ground a `for...of` over a bound
    /// collection reads one ([`Self::delegated_walk`]). A sequence is a list
    /// made once, so its length does not move while it is copied.
    fn array_of_sequence(
        &mut self,
        id: NodeId,
        sequence: ValueId,
        ty: TypeId,
        array_ty: HirType,
    ) -> Result<ValueId, Diagnostic> {
        let HirType::Managed(ManagedType::Array(element)) = &array_ty else {
            return Err(self.unsupported(id, "a sequence read as something other than an array"));
        };
        let element = (**element).clone();
        let (Some(size), Some(at)) = (
            self.walk_method(ty, "_get_length"),
            self.walk_method(ty, "item"),
        ) else {
            return Err(self.unsupported(id, "a sequence with no `length` and `item`"));
        };
        let read = self.represent(at.2.return_type).ok_or_else(|| {
            self.unsupported(
                id,
                "a sequence whose `item` answers a type with no representation",
            )
        })?;
        let narrows = Self::host_downcast(&read, &element);
        let walk = Walk::Native(Box::new(NativeWalk {
            by: NativeBy::Vector(Box::new(VectorMethods {
                size: size.clone(),
                at,
            })),
            element: if narrows { element.clone() } else { read },
            site: id,
            narrows,
        }));
        let origin = self.origin(id);
        let length = self.call_native_walk(id, &size, sequence, Vec::new())?;
        let length = self.coerce(length, &HirType::NUMBER, id)?;
        let array = self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Holes,
            },
            array_ty,
            origin.clone(),
        );
        let (sequence, cursor, _) = self.walk_start(&walk, sequence, &origin)?;
        let cursor =
            cursor.ok_or_else(|| self.unsupported(id, "a sequence walk with no cursor"))?;
        let record = self.begin_loop(id, &[cursor], true, &origin)?;
        let at = self.bindings[&cursor];
        let cond = self.walk_condition(&walk, at, sequence, &origin)?;
        self.test_loop(cond, &record);
        self.switch_to(record.body);
        let at = self.bindings[&cursor];
        let [item] = self.read_element(&walk, sequence, at, &origin)?[..] else {
            return Err(self.unsupported(id, "a sequence walk that did not read one item"));
        };
        let item = self.coerce(item, &element, id)?;
        self.push(
            OpKind::ArraySet {
                array,
                index: at,
                value: item,
                checked: true,
            },
            HirType::Void,
            origin.clone(),
        );
        self.end_loop(
            &record,
            Step::Walk {
                cursor,
                walk,
                sequence,
            },
        )?;
        Ok(array)
    }

    /// `emit(name, ...args)` of a signal a `GObject` class the program writes
    /// declares: a call of `nts_gobject_emit_{kinds}__{name}`, which each
    /// backend defines beside the registration as `g_signal_emit` by the
    /// signal's id, found on the instance's type and kept for the next call.
    /// No variadic call, and no name parsed per emit: the name is the
    /// thunk's, and the arguments are its parameters, typed as the handler
    /// receives them (`SignalArgs`).
    fn lower_gobject_emit(
        &mut self,
        id: NodeId,
        (receiver, receiver_node): (ValueId, NodeId),
        declaration: NodeId,
        mut with_this: nts_semantic_schema::SignatureRecord,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let (name_node, rest) = arguments
            .split_first()
            .ok_or_else(|| self.unsupported(id, "`emit` with no signal"))?;
        let signal = self.constant_member_name(*name_node).ok_or_else(|| {
            self.unsupported(*name_node, "`emit` of a signal whose name is not a literal")
        })?;
        // The receiver's type as the method call has it: the declared `this`,
        // or the class the receiver is an instance of.
        let this_ty = with_this
            .this_type
            .or_else(|| {
                self.snapshot
                    .node_types
                    .get(&receiver_node)
                    .map(|ty| self.class_behind(self.present_part(*ty).unwrap_or(*ty)))
            })
            .ok_or_else(|| self.unsupported(id, "`emit` with no receiver type"))?;
        let declared =
            signals_of_type(self.snapshot, this_ty).map_err(|why| self.unsupported(id, &why))?;
        let kinds = declared
            .iter()
            .find(|declared| declared.name == signal)
            .map(|declared| declared.kinds.clone());
        // `this`, then each of the signal's parameters in place of the name
        // and the rest: the thunk's own signature. A signal a class the
        // program wrote declares has them as `WithSignals`'s rest; a
        // binding's own (`button.emit("clicked")`) as its view's parameters
        // after the name.
        let rest_ty = with_this.parameters.last().filter(|p| p.rest).map(|p| p.ty);
        let elements = match rest_ty
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
            .map(|record| &record.kind)
        {
            Some(TypeKind::Tuple(tuple)) if kinds.is_some() => tuple.elements.clone(),
            _ if kinds.is_none() && rest_ty.is_none() => {
                with_this.parameters.iter().skip(1).map(|p| p.ty).collect()
            }
            _ if kinds.is_none() => {
                return Err(self.unsupported(*name_node, &format!("`emit` of `{signal}`, which neither a class the program wrote nor a binding declares")));
            }
            _ => {
                return Err(
                    self.unsupported(id, "`emit` whose arguments are not a signal's parameters")
                );
            }
        };
        with_this.parameters = vec![nts_semantic_schema::ParameterRecord {
            name: "this".to_owned(),
            ty: this_ty,
            optional: false,
            rest: false,
        }];
        for (at, element) in elements.iter().enumerate() {
            with_this
                .parameters
                .push(nts_semantic_schema::ParameterRecord {
                    name: format!("a{at}"),
                    ty: *element,
                    optional: false,
                    rest: false,
                });
        }
        let Callee::Native(mut target) =
            self.native_callee(id, Some(declaration), signal.clone(), &with_this)?
        else {
            return Err(self.unsupported(id, "`emit` that is not foreign"));
        };
        let thunk = std::sync::Arc::make_mut(&mut target);
        // A binding's signal, named by its parameters' C types, so two
        // classes' same-named signals of different shapes are two thunks --
        // and every pointer is `void *`, so every call of one prints one
        // prototype, whichever class it names.
        let kinds = if let Some(kinds) = kinds {
            kinds
        } else {
            for parameter in &mut thunk.parameters {
                if matches!(parameter, super::native::Type::Pointer(_)) {
                    *parameter = super::native::Type::Pointer(super::native::Pointee::Void);
                }
            }
            binding_signal_kinds(&thunk.parameters[1..], &thunk.result)
                .map_err(|why| self.unsupported(id, &why))?
        };
        thunk.name = super::ForeignSignal::emit_thunk(&signal, &kinds);
        thunk.thunk = Some(super::native::GObjectThunk::Signal {
            name: signal.clone(),
            kinds,
        });
        thunk.declared_at = None;
        // Each argument as written, then converted to the thunk's parameter
        // (`native_arguments`): not `lower_call_arguments`, which reads the
        // call's own signature by position, where the name comes first.
        let mut written = Vec::with_capacity(rest.len());
        for argument in rest {
            written.push(self.lower_expression(*argument)?);
        }
        let (args, lent) =
            self.native_arguments(id, &target.clone(), written, rest.len(), Some(receiver))?;
        let callee = Callee::Native(target);
        self.finish_call(id, callee, args, lent, Some(declaration))
    }

    /// `addEventListener(type, listener)` or `removeEventListener`, which a
    /// Windows Runtime class declares over its events (`@ntsListener add` or
    /// `remove`): the runtime's `nts_winrt_listen(object, iid, add, delegate)`
    /// or `nts_winrt_unlisten(object, iid, add, remove, listener)`, over the
    /// event the listener's `Event<F, IID, Slots>` names -- the interface
    /// declaring it and its `add_` and `remove_` slots, which every event
    /// calls alike. The runtime asks the object for the interface and keeps
    /// the token `add_` answers by object, event and function, which is what
    /// the removal looks up; so a removal passes the function, and makes no
    /// delegate. Either answers an HRESULT, thrown when it failed.
    fn lower_event_listener(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        direction: &str,
        signature: &nts_semantic_schema::SignatureRecord,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let adding = match direction.trim() {
            "add" => true,
            "remove" => false,
            _ => return Err(self.unsupported(id, "@ntsListener is `add` or `remove`")),
        };
        let [event, listener] = arguments else {
            return Err(
                self.unsupported(id, "an event listener call that is not `(type, listener)`")
            );
        };
        let listens = signature
            .parameters
            .get(1)
            .map(|parameter| parameter.ty)
            .ok_or_else(|| {
                self.unsupported(id, "an event listener call that is not `(type, listener)`")
            })?;
        let Some((iid, add, remove)) = super::native::event_slots(self.snapshot, listens) else {
            return Err(self.unsupported(
                id,
                "an event listener whose type names no event (`Event<F, IID, Slots>`)",
            ));
        };
        // `type` is evaluated, as it is written; the event is the one the
        // listener's type names.
        let values = self.lower_arguments(id, &[*event, *listener])?;
        let function = values[1];
        let origin = self.origin(id);
        let [low, high] = self.iid_arguments(&iid, &origin);
        let slot = HirType::Int {
            bits: 32,
            signed: false,
        };
        let add = self.push(
            OpKind::ConstInt(i128::from(add)),
            slot.clone(),
            origin.clone(),
        );
        let status_type = HirType::Int {
            bits: 32,
            signed: true,
        };
        let mut lent = Vec::new();
        let status = if adding {
            let super::native::Role::Delegate {
                bridge,
                signature,
                iid,
            } = super::native::listener_delegate(self.snapshot, listens)
                .map_err(|why| self.unsupported(id, &why))?
            else {
                return Err(self.unsupported(
                    id,
                    "an event listener whose type is not a delegate (`Event<F, IID, Slots>`)",
                ));
            };
            let pointer = HirType::NativePointer(super::native::Pointee::Void);
            let delegate = self.delegate(
                id,
                function,
                (bridge, signature, &iid),
                pointer,
                &mut lent,
                &origin,
            )?;
            self.runtime_call(
                "nts_winrt_listen",
                vec![receiver, low, high, add, delegate],
                status_type,
                origin.clone(),
            )
        } else {
            let remove = self.push(OpKind::ConstInt(i128::from(remove)), slot, origin.clone());
            self.runtime_call(
                "nts_winrt_unlisten",
                vec![receiver, low, high, add, remove, function],
                status_type,
                origin.clone(),
            )
        };
        self.throw_on_failure(id, status, lent, &origin)?;
        Ok(self.push(OpKind::ConstUndefined, HirType::Void, origin))
    }

    /// The receiver a member tagged `@ntsVia <IID>` is called on: the object
    /// asked for that interface (`nts_com_query`), as the Windows Runtime's
    /// projections call a class's member from one of its other interfaces --
    /// and the queried pointer, which [`Self::release_via`] gives back once
    /// the call has returned. Typed `void *`, so the ownership pass does not
    /// count it: it lives for the call alone, whatever the provider. Any other
    /// member is called on the receiver as it is.
    ///
    /// `@ntsVia <IID> <tag>` names the handle tag of the interface the IID is,
    /// where it is its class's default: a receiver whose handle carries that
    /// tag is that interface already -- a class's instance is its default
    /// interface -- and is not asked again.
    fn via_receiver(
        &mut self,
        id: NodeId,
        declaration: NodeId,
        receiver: ValueId,
    ) -> Result<(ValueId, Option<ValueId>), Diagnostic> {
        let Some(tag) = self
            .node(declaration)
            .native
            .as_ref()
            .and_then(|native| native.via.clone())
        else {
            return Ok((receiver, None));
        };
        let mut words = tag.split_whitespace();
        let iid = words.next().unwrap_or_default().to_owned();
        if let Some(owner) = words.next()
            && let HirType::NativePointer(pointee) = &self.values[receiver.0 as usize].ty
            && opaque_handle(pointee).is_some_and(|handle| handle.tag == owner)
        {
            return Ok((receiver, None));
        }
        if !super::native::is_interface_id(&iid) {
            return Err(self.unsupported(
                id,
                "@ntsVia with an interface ID that is not 8-4-4-4-12 hexadecimal digits",
            ));
        }
        let origin = self.origin(id);
        let [low, high] = self.iid_arguments(&iid, &origin);
        let queried = self.runtime_call(
            "nts_com_query",
            vec![receiver, low, high],
            HirType::NativePointer(super::native::Pointee::Void),
            origin,
        );
        Ok((queried, Some(queried)))
    }

    /// The interface [`Self::via_receiver`] asked for, given back.
    fn release_via(&mut self, id: NodeId, queried: Option<ValueId>) {
        if let Some(queried) = queried {
            let origin = self.origin(id);
            self.runtime_call("nts_com_release", vec![queried], HirType::Void, origin);
        }
    }

    /// A message the lowering sends itself, as a value of `result`'s type.
    fn send_bridge(
        &mut self,
        message: super::native::Function,
        args: Vec<ValueId>,
        origin: &Origin,
    ) -> ValueId {
        let ty = message.result.representation();
        self.push(
            OpKind::Call {
                callee: Callee::Native(std::sync::Arc::new(message)),
                args,
                frame: None,
            },
            ty,
            origin.clone(),
        )
    }

    /// A closure as the C function pointer C calls it through: a bridge with
    /// the `bridge` signature, the closure's context last, converted to the
    /// parameter's own type `want` where they differ -- an `ErasedClosure`'s
    /// parameter is `GCallback`, the same code address, which C casts back to
    /// the signature it calls it with.
    fn bridge_closure(
        &mut self,
        id: NodeId,
        closure: ValueId,
        (bridge, bridging): (&std::sync::Arc<super::native::FnPointer>, super::Bridging),
        once: bool,
        want: HirType,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        // Dispatched statically through the closure's own layout where an
        // arrow or function expression gives it one, and through its table
        // where the value is of a bare function type. Anything else is not
        // a closure at all.
        if !matches!(
            self.values[closure.0 as usize].ty,
            HirType::Managed(ManagedType::Object(_))
        ) {
            return Err(self.unsupported(
                id,
                "a closure passed to C whose body is not known here: write the function or arrow at the call, or bind it with `const` in the same function",
            ));
        }
        let bridging = self.with_conversions(closure, bridge, bridging);
        let bridged = self.push(
            OpKind::NativeBridge {
                closure,
                signature: bridge.clone(),
                context: true,
                once,
                bridging,
            },
            HirType::NativePointer(super::native::Pointee::FnPointer(bridge.clone())),
            origin.clone(),
        );
        Ok(if self.values[bridged.0 as usize].ty == want {
            bridged
        } else {
            self.push(OpKind::Convert(bridged), want, origin.clone())
        })
    }

    /// A closure as an Objective-C block: the trampoline into its body, the
    /// closure lent for the call (a callee that keeps the block copies it and
    /// lends it again), and the block in this frame holding both.
    /// `None` for an argument the call does not pass.
    /// `bridging`, with a function of this program's ([`Conversion`],
    /// requested here and made once each) converting each argument C passes
    /// that the closure takes as something else:
    ///
    /// - a sequence where the closure takes an array: lib.dom's
    ///   `MutationObserver` callback `(records: MutationRecord[]) => void`,
    ///   where nts:dom passes a `MutationRecordSequence` -- a new array each
    ///   call, as `WebIDL` makes one of a `sequence<T>` for page script;
    /// - a 64-bit integer where the closure takes a number (`AsNumber<C>`,
    ///   GIO's `FileProgressCallback`): exactly, or a `RangeError` past 2^53,
    ///   as a call's result is read.
    ///
    /// Read off the closure's arrow, its parameters as the program types them:
    /// the bridge carries only C's types, and what the closure takes is the
    /// program's. A sequence whose type is not found, or whose element is not
    /// a handle, is left as it was, and `bridges::check` refuses it.
    fn with_conversions(
        &mut self,
        closure: ValueId,
        bridge: &super::native::FnPointer,
        mut bridging: super::Bridging,
    ) -> super::Bridging {
        let HirType::Managed(ManagedType::Object(ty)) = self.values[closure.0 as usize].ty else {
            return bridging;
        };
        let Some(arrow) = self.closures.get(closure_index(ty)).map(|info| info.node) else {
            return bridging;
        };
        let Some(TypeKind::Function(signature)) = self
            .snapshot
            .node_types
            .get(&arrow)
            .and_then(|ty| self.snapshot.types.get(ty.0 as usize))
            .map(|record| &record.kind)
        else {
            return bridging;
        };
        let parameters = self.snapshot.signatures[signature.0 as usize]
            .parameters
            .clone();
        for (at, foreign) in bridge.parameters.iter().enumerate() {
            let super::native::Type::Pointer(super::native::Pointee::Opaque(handle)) = foreign
            else {
                continue;
            };
            if bridging.boxed(at).is_some() || bridging.array(at).is_some() {
                continue;
            }
            let Some(parameter) = bridging
                .parameter(at)
                .and_then(|parameter| parameters.get(parameter))
            else {
                continue;
            };
            let Some(array) = self.represent(parameter.ty) else {
                continue;
            };
            let HirType::Managed(ManagedType::Array(element)) = &array else {
                continue;
            };
            let HirType::NativePointer(super::native::Pointee::Opaque(element)) = &**element else {
                continue;
            };
            let Some(sequence) = self.sequence_type_of(handle) else {
                continue;
            };
            let function = format!("nts_sequence_{}_as_{}", handle.tag, element.tag);
            self.request_conversion(
                &mut bridging,
                at,
                function,
                Converts::SequenceArray { sequence, array },
                arrow,
            );
        }
        for (at, foreign) in bridge.parameters.iter().enumerate() {
            let super::native::Type::Scalar(kind) = foreign else {
                continue;
            };
            if !kind.needs_exact_integer() {
                continue;
            }
            let Some(parameter) = bridging
                .parameter(at)
                .and_then(|parameter| parameters.get(parameter))
            else {
                continue;
            };
            if self.represent(parameter.ty) != Some(HirType::NUMBER) {
                continue;
            }
            let integer = foreign.representation();
            let HirType::Int { signed, .. } = integer else {
                continue;
            };
            let function = format!("nts_exact_number_{}", if signed { "i64" } else { "u64" });
            self.request_conversion(
                &mut bridging,
                at,
                function,
                Converts::ExactNumber { integer },
                arrow,
            );
        }
        bridging
    }

    /// C's argument `at` converted by `function`, made once per program.
    fn request_conversion(
        &mut self,
        bridging: &mut super::Bridging,
        at: usize,
        function: String,
        converts: Converts,
        site: NodeId,
    ) {
        if !self
            .conversions
            .iter()
            .any(|request| request.name == function)
        {
            self.conversions.push(Conversion {
                name: function.clone(),
                converts,
                site,
            });
        }
        bridging.converted.push(super::ConvertedParameter {
            at: u32::try_from(at).unwrap_or(u32::MAX),
            function,
        });
    }

    /// The type whose handle `handle` is, where it is a sequence: `length`
    /// and `item` (`array_of_sequence`). Searched rather than carried, since
    /// a bridge holds C's types only; asked only for a bridge whose closure
    /// takes an array where C passes a handle.
    fn sequence_type_of(&self, handle: &super::native::Handle) -> Option<TypeId> {
        (0..self.snapshot.types.len()).filter_map(|at| u32::try_from(at).ok().map(TypeId)).find(|ty| {
            matches!(super::native::pointer(self.snapshot, *ty), Some(super::native::Pointee::Opaque(found)) if found.tag == handle.tag)
                && self.walk_method(*ty, "item").is_some()
                && self.walk_method(*ty, "_get_length").is_some()
        })
    }

    /// A function made to convert an argument C passes to a bridge
    /// ([`Self::with_conversions`]): its one parameter what C passes, its
    /// result what the closure takes.
    fn lower_conversion(&mut self, request: &Conversion) -> Result<Func, Diagnostic> {
        match &request.converts {
            Converts::SequenceArray { sequence, array } => {
                self.lower_sequence_array(request, *sequence, array.clone())
            }
            Converts::ExactNumber { integer } => {
                let origin = self.origin(request.site);
                let params = vec![Param {
                    name: "integer".to_owned(),
                    shape: ParamShape::Ordinary,
                    ty: integer.clone(),
                    origin: origin.clone(),
                    known: Facts::TOP,
                    written: None,
                }];
                let passed = self.push(OpKind::Param(0), integer.clone(), origin.clone());
                let number = self.exact_as_number(request.site, passed, "C passed a callback")?;
                self.terminate(Terminator::Return(Some(number)));
                Ok(self.finish(request.name.clone(), params, HirType::NUMBER, origin, false))
            }
        }
    }

    /// The array of a sequence's items, for a bridge: its one parameter the
    /// sequence.
    fn lower_sequence_array(
        &mut self,
        request: &Conversion,
        sequence: TypeId,
        array: HirType,
    ) -> Result<Func, Diagnostic> {
        let origin = self.origin(request.site);
        let taken = self
            .represent(sequence)
            .ok_or_else(|| self.unrepresentable(request.site, "a sequence a bridge passes"))?;
        let params = vec![Param {
            name: "sequence".to_owned(),
            shape: ParamShape::Ordinary,
            ty: taken.clone(),
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        }];
        let passed = self.push(OpKind::Param(0), taken, origin.clone());
        let made = self.array_of_sequence(request.site, passed, sequence, array.clone())?;
        self.terminate(Terminator::Return(Some(made)));
        Ok(self.finish(request.name.clone(), params, array, origin, false))
    }

    fn lend_block(
        &mut self,
        id: NodeId,
        closure: Option<ValueId>,
        (bridge, signature): (
            std::sync::Arc<super::native::FnPointer>,
            std::sync::Arc<super::native::FnPointer>,
        ),
        want: HirType,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let Some(closure) = closure else {
            return Ok(None);
        };
        let invoke = self.bridge_closure(
            id,
            closure,
            (&bridge, super::Bridging::default()),
            false,
            HirType::NativePointer(super::native::Pointee::FnPointer(bridge.clone())),
            origin,
        )?;
        let context = self.runtime_call(
            "nts_closure_lend",
            vec![closure],
            HirType::NativePointer(super::native::Pointee::Void),
            origin.clone(),
        );
        lent.push(Lent::Closure { context });
        let block = self.push(
            OpKind::NativeBlock {
                invoke,
                context,
                signature,
            },
            want.clone(),
            origin.clone(),
        );
        // Swift's `completion: nil`: a closure that is `null` is a NULL block,
        // not a block around nothing, which the callee would call and which
        // would call through a NULL closure. Lending and releasing a NULL
        // closure do nothing, so only the pointer passed is chosen.
        let void = HirType::NativePointer(super::native::Pointee::Void);
        let none = self.push(OpKind::ConstNull, void.clone(), origin.clone());
        let absent = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: context,
                rhs: none,
            },
            HirType::Bool,
            origin.clone(),
        );
        let (nil, given, joined) = (self.new_block(), self.new_block(), self.new_block());
        let passed = self.push_block_param(joined, want.clone(), origin.clone());
        self.terminate(Terminator::Branch {
            cond: absent,
            then_target: nil,
            then_args: Vec::new(),
            else_target: given,
            else_args: Vec::new(),
        });
        self.switch_to(nil);
        let null_block = self.push(OpKind::ConstNull, want, origin.clone());
        self.terminate(Terminator::Jump {
            target: joined,
            args: vec![null_block],
        });
        self.switch_to(given);
        self.terminate(Terminator::Jump {
            target: joined,
            args: vec![block],
        });
        self.switch_to(joined);
        Ok(Some(passed))
    }

    /// What a declaration's `@ntsHresult` says, if it has one: plain,
    /// `composable`, or `out`.
    /// `@ntsReference`: the parameters crossing as an `IReference<T>`.
    fn reference_tags(
        &self,
        call: NodeId,
        declaration: Option<NodeId>,
    ) -> Result<Vec<super::native::Reference>, Diagnostic> {
        Ok(declaration
            .and_then(|decl| self.node(decl).native.as_ref())
            .and_then(|native| native.reference.as_deref())
            .map(super::native::parse_references)
            .transpose()
            .map_err(|why| self.unsupported(call, &why))?
            .unwrap_or_default())
    }

    fn hresult_shape(
        &self,
        call: NodeId,
        declaration: Option<NodeId>,
    ) -> Result<Option<super::native::Hresult>, Diagnostic> {
        // An overridable method answers an HRESULT as every slot does, and
        // its binding says so only by being `@ntsOverride`.
        if self.forced_slot.is_some() {
            return Ok(Some(super::native::Hresult::Plain));
        }
        let Some(shape) = declaration
            .and_then(|decl| self.node(decl).native.as_ref())
            .and_then(|n| n.hresult.as_deref())
        else {
            return Ok(None);
        };
        match shape.trim() {
            "" => Ok(Some(super::native::Hresult::Plain)),
            "composable" => Ok(Some(super::native::Hresult::Composable)),
            "out" => Ok(Some(super::native::Hresult::Out)),
            _ => Err(self.unsupported(
                call,
                "@ntsHresult with a shape other than `composable` or `out`",
            )),
        }
    }

    /// The slots an `@ntsHresult` call adds after the declared arguments: the
    /// result, and a composable factory's outer and inner objects.
    fn hresult_slot(
        &mut self,
        role: &super::native::Role,
        want: HirType,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> ValueId {
        match role {
            // Where C writes the result: a zeroed local, read by
            // `finish_hresult_call` once the HRESULT says it was written.
            super::native::Role::Result { written, field } => {
                let slot = self.push(OpKind::NativeLocal { count: 1 }, want, origin.clone());
                lent.push(Lent::Result {
                    slot,
                    written: *written,
                    field: field.clone(),
                });
                slot
            }
            // Where C writes a received array's count: read with the array.
            super::native::Role::ReceivedCount => {
                let slot = self.push(OpKind::NativeLocal { count: 1 }, want, origin.clone());
                lent.push(Lent::Count { slot });
                slot
            }
            // No outer object: the class is made as itself.
            super::native::Role::Outer => self.push(OpKind::ConstNull, want, origin.clone()),
            // The inner object, given back after the call.
            _ => {
                let slot = self.push(OpKind::NativeLocal { count: 1 }, want, origin.clone());
                lent.push(Lent::Inner { slot });
                slot
            }
        }
    }

    /// An IID's two words, as the runtime's COM helpers take it (`iid_words`):
    /// two constants. Text that is no IID -- refused where the tag is read,
    /// so not reached -- gives zero words, which no interface answers to.
    fn iid_arguments(&mut self, iid: &str, origin: &Origin) -> [ValueId; 2] {
        let (low, high) = super::native::iid_words(iid).unwrap_or_default();
        let word = HirType::Int {
            bits: 64,
            signed: false,
        };
        [
            self.push(
                OpKind::ConstInt(i128::from(low)),
                word.clone(),
                origin.clone(),
            ),
            self.push(OpKind::ConstInt(i128::from(high)), word, origin.clone()),
        ]
    }

    /// Turn each argument for a C function pointer parameter into a bridge.
    ///
    /// A TypeScript function value is a managed closure object, and the
    /// specializer converts every native argument to its parameter's
    /// `representation()` -- one machine word for a code pointer. Left alone
    /// that took the closure's *heap address* and handed it to C as something
    /// to call: a wrong answer that compiles, and one the witness cannot see,
    /// because the emitted prototype and the real header agree about the
    /// parameter. Only the value was wrong.
    ///
    /// So the value becomes a `NativeBridge`, which a backend emits as a real
    /// function with the foreign signature.
    ///
    /// **Non-capturing only, and checked by construction.** The argument's
    /// producing operation must be `ClosureStatic`, which is the closure with
    /// no captured environment. A capturing one has state that a bare C
    /// function pointer has nowhere to put; giving it one means a context
    /// parameter the callee agrees to carry, and no C signature implies that.
    /// Refused here rather than bridged into something that reads freed stack.
    /// One closure, as a real C function with the declared signature.
    ///
    /// The same construction `bridge_callback_arguments` makes for a call, in
    /// the one other place a function crosses into C: a store into a
    /// function-pointer member. Non-capturing only, checked the same way --
    /// see that function for why.
    fn bridged(
        &mut self,
        at: NodeId,
        value: ValueId,
        signature: &std::sync::Arc<super::native::FnPointer>,
    ) -> Result<ValueId, Diagnostic> {
        if let Some(null) = self.null_function_pointer(at, value, signature) {
            return Ok(null);
        }
        if !matches!(self.values[value.0 as usize].kind, OpKind::ClosureStatic) {
            return Err(self.unsupported(
                at,
                "a C function pointer needs a function declared with `function`: an inline function or arrow capturing anything has state a bare C function pointer has nowhere to put",
            ));
        }
        let origin = self.origin(at);
        Ok(self.push(
            OpKind::NativeBridge {
                closure: value,
                signature: signature.clone(),
                context: false,
                once: false,
                bridging: super::Bridging::default(),
            },
            HirType::NativePointer(super::native::Pointee::FnPointer(signature.clone())),
            origin,
        ))
    }

    /// `null` where a C function pointer goes, as the NULL function pointer.
    ///
    /// Only the literal: a binding that says `F | null` has told us C accepts
    /// NULL there. A value that is a function on one path and `null` on another
    /// would need a bridge chosen at run time, which nothing builds, so it is
    /// left to the refusal below, which names the function it wanted.
    fn null_function_pointer(
        &mut self,
        at: NodeId,
        value: ValueId,
        signature: &std::sync::Arc<super::native::FnPointer>,
    ) -> Option<ValueId> {
        let mut source = value;
        while let OpKind::Convert(inner) = self.values[source.0 as usize].kind {
            source = inner;
        }
        if !matches!(self.values[source.0 as usize].kind, OpKind::ConstNull) {
            return None;
        }
        let origin = self.origin(at);
        Some(self.push(
            OpKind::ConstNull,
            HirType::NativePointer(super::native::Pointee::FnPointer(signature.clone())),
            origin,
        ))
    }

    fn bridge_callback_arguments(
        &mut self,
        call: NodeId,
        target: &super::native::Function,
        args: &mut [ValueId],
    ) -> Result<(), Diagnostic> {
        for (at, parameter) in target.parameters.iter().enumerate() {
            let super::native::Type::FnPointer(signature) = parameter else {
                continue;
            };
            // Bridged above with a context, or supplied by the runtime.
            if !matches!(target.roles.get(at), Some(super::native::Role::Plain)) {
                continue;
            }
            let Some(argument) = args.get_mut(at) else {
                continue;
            };
            if let Some(null) = self.null_function_pointer(call, *argument, signature) {
                *argument = null;
                continue;
            }
            if !matches!(self.values[argument.0 as usize].kind, OpKind::ClosureStatic) {
                return Err(self.unsupported(
                    call,
                    "a C function pointer needs a function declared with `function`: an inline function expression is allocated as a closure object, and if it captures anything there is nowhere to put that in a bare code pointer",
                ));
            }
            let origin = self.origin(call);
            // Typed as the function pointer it is, not as `void *`.
            //
            // `void *` was close enough to compile and is not what C says: the
            // emitted program assigned a *function* to a `void *` and passed a
            // `void *` where `NtsFn_int_int` was wanted, neither of which is a
            // conversion ISO C performs. `-pedantic-errors` reported ten of
            // them in `native-callback` alone. It is also the imprecision that
            // let a closure's heap address reach C as something to call, before
            // bridges existed -- a `void *` says nothing a wrong value would
            // contradict.
            let bridging = self.with_conversions(*argument, signature, super::Bridging::default());
            *argument = self.push(
                OpKind::NativeBridge {
                    closure: *argument,
                    signature: signature.clone(),
                    context: false,
                    once: false,
                    bridging,
                },
                HirType::NativePointer(super::native::Pointee::FnPointer(signature.clone())),
                origin,
            );
        }
        Ok(())
    }

    /// What a declaration's `@ntsFactory` names: the runtime class whose
    /// activation factory, as the interface the IID names, is a static's
    /// receiver.
    fn factory_of(
        &self,
        call: NodeId,
        decl: NodeId,
    ) -> Result<Option<super::native::Factory>, Diagnostic> {
        let Some(text) = self
            .node(decl)
            .native
            .as_deref()
            .and_then(|n| n.factory.as_deref())
        else {
            return Ok(None);
        };
        let words: Vec<&str> = text.split_whitespace().collect();
        let [class, iid] = words.as_slice() else {
            return Err(self.unsupported(call, "@ntsFactory names the runtime class and the interface ID, as in `@ntsFactory Windows.Data.Json.JsonValue 5F6B544A-2F53-48E1-91A3-F78B50A6345C`"));
        };
        if !super::native::is_interface_id(iid) {
            return Err(self.unsupported(
                call,
                "@ntsFactory with an interface ID that is not 8-4-4-4-12 hexadecimal digits",
            ));
        }
        Ok(Some(super::native::Factory {
            class: (*class).to_owned(),
            iid: iid.trim_matches(['{', '}']).to_owned(),
        }))
    }

    /// `@ntsQuery`: the receiver as the COM interface the IID names, which is
    /// `QueryInterface` -- a table of the object's own, not a conversion of
    /// the pointer the program has. What comes back is a reference of its own,
    /// released when the program is done with it, as a runtime call's result
    /// is; an object without the interface ends the process naming it, since
    /// the binding said the class implements it.
    fn lower_query(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        iid: &str,
        result: nts_semantic_schema::TypeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        if !arguments.is_empty() {
            return Err(self.unsupported(
                id,
                "@ntsQuery on a method that takes arguments beside `this`",
            ));
        }
        if !super::native::is_interface_id(iid) {
            return Err(self.unsupported(
                id,
                "@ntsQuery with an interface ID that is not 8-4-4-4-12 hexadecimal digits",
            ));
        }
        let ty = self
            .represent(result)
            .ok_or_else(|| self.unrepresentable(id, "the interface @ntsQuery answers"))?;
        let origin = self.origin(id);
        let [low, high] = self.iid_arguments(iid, &origin);
        Ok(self.runtime_call("nts_com_query", vec![receiver, low, high], ty, origin))
    }

    /// The call at `id`, when its callee is an `@ntsActivate` constructor.
    fn activation_call(
        &mut self,
        id: NodeId,
        target: &nts_semantic_schema::CallTarget,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        let activate = self
            .node(target.callee?)
            .native
            .as_ref()
            .and_then(|n| n.activate.clone())?;
        let result = self.snapshot.signatures[target.signature.0 as usize].return_type;
        Some(self.lower_activation(id, &activate, result, arguments))
    }

    /// `@ntsActivate`: a runtime class made by its default constructor
    /// (`IActivationFactory::ActivateInstance` on the class's cached factory)
    /// and answered as its default interface -- a reference of the program's
    /// own, as a runtime call's result is.
    fn lower_activation(
        &mut self,
        id: NodeId,
        activate: &str,
        result: nts_semantic_schema::TypeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let words: Vec<&str> = activate.split_whitespace().collect();
        let [class, iid] = words.as_slice() else {
            return Err(self.unsupported(
                id,
                "@ntsActivate names the runtime class and its default interface's IID",
            ));
        };
        if !arguments.is_empty() {
            return Err(self.unsupported(id, "@ntsActivate on a function that takes arguments; a constructor that does is a factory method"));
        }
        if !super::native::is_interface_id(iid) {
            return Err(self.unsupported(
                id,
                "@ntsActivate with an interface ID that is not 8-4-4-4-12 hexadecimal digits",
            ));
        }
        let ty = self
            .represent(result)
            .ok_or_else(|| self.unrepresentable(id, "the object @ntsActivate makes"))?;
        let origin = self.origin(id);
        let text = HirType::Managed(ManagedType::String);
        let class = self.push(
            OpKind::ConstString((*class).to_owned().into()),
            text,
            origin.clone(),
        );
        let [low, high] = self.iid_arguments(iid, &origin);
        Ok(self.runtime_call("nts_winrt_activate", vec![class, low, high], ty, origin))
    }

    /// The receiver of a runtime class's static: its activation factory as the
    /// interface the binding names, activated once and cached by the runtime.
    fn factory_receiver(&mut self, factory: &super::native::Factory, id: NodeId) -> ValueId {
        let origin = self.origin(id);
        let text = HirType::Managed(ManagedType::String);
        let class = self.push(
            OpKind::ConstString(factory.class.clone().into()),
            text,
            origin.clone(),
        );
        let [low, high] = self.iid_arguments(&factory.iid, &origin);
        self.runtime_call(
            "nts_winrt_factory",
            vec![class, low, high],
            HirType::NativePointer(super::native::Pointee::Void),
            origin,
        )
    }

    /// `NSWindow` as a value: a constant an `objc:` module declares with the
    /// type `ObjcMeta<"NSWindow">`, which is that class object.
    ///
    /// Only a declaration inside `declare module "objc:..."`, where a constant
    /// can have no initializer and so can mean nothing else. The class name is
    /// the brand's, not the constant's, so a binding may name the constant as
    /// it likes. Asked before module scope is, which refuses a native pointer
    /// at module scope for having no storage -- right for a variable, and this
    /// is not one.
    fn objc_class_object(
        &mut self,
        id: NodeId,
        symbol: nts_semantic_schema::SymbolId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        // A class a binding declares with `@ntsClass`, named as a value.
        if let Some(class) = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)
            .and_then(|record| {
                record.declarations.iter().copied().find(|declaration| {
                    self.kind_of(*declaration) == Some(syntax::CLASS_DECLARATION)
                        && super::native::is_objc_class(self.snapshot, *declaration)
                })
            })
        {
            let name = self
                .node(class)
                .native
                .as_ref()
                .and_then(|n| n.class.clone())
                .unwrap_or_default();
            let frameworks = self.declared_names(id, class, LinkTag::FRAMEWORK)?;
            let ty = HirType::NativePointer(super::native::Pointee::Opaque("objc_class".into()));
            return Ok(Some(self.push(
                OpKind::ObjcClass { name, frameworks },
                ty,
                self.origin(id),
            )));
        }
        let Some(ty) = self.snapshot.node_types.get(&id).copied() else {
            return Ok(None);
        };
        let Some(name) = super::native::objc_meta(self.snapshot, ty) else {
            return Ok(None);
        };
        let Some(declaration) = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)
            .and_then(|record| {
                record.declarations.iter().copied().find(|declaration| {
                    self.kind_of(*declaration)
                        == Some(nts_semantic_schema::syntax::VARIABLE_DECLARATION)
                })
            })
        else {
            return Ok(None);
        };
        if !self.in_objc_module(declaration) {
            return Ok(None);
        }
        if !super::native::is_c_identifier(&name) {
            return Err(self.unsupported(
                id,
                &format!(
                    "`ObjcMeta<\"{name}\">` names a class by its name, and `{name}` is not one"
                ),
            ));
        }
        let frameworks = self.declared_names(id, declaration, LinkTag::FRAMEWORK)?;
        let ty = HirType::NativePointer(super::native::Pointee::Opaque("objc_class".into()));
        Ok(Some(self.push(
            OpKind::ObjcClass { name, frameworks },
            ty,
            self.origin(id),
        )))
    }

    /// The Objective-C property `member` names: one an `objc:` module
    /// declares as a property signature of an interface, read with its getter
    /// and written with its setter.
    ///
    /// The getter is the property's name, or the selector `@ntsSelector`
    /// gives it, since a `getter=isVisible` property is read with another.
    /// The setter is the one `@ntsSet` names, or `set` and the name
    /// capitalized, with a colon, which is the one Cocoa's `@property` makes
    /// unless it says `setter=`. Swift's `isHidden` is written with
    /// `setHidden:`, so a binding names it. A `readonly` property has none.
    fn objc_property(&self, object: NodeId, member: NodeId) -> Option<ObjcProperty> {
        // A property signature of an `objc:` interface, or a property of an
        // Objective-C class a binding declares -- a class property when
        // `static`, whose accessors are sent to the class.
        let objc = |declaration: &NodeId| match self.kind_of(*declaration) {
            // Not one read through a function (`@ntsGet`): a Core Foundation
            // class's property is a C function of the instance, which is not
            // an Objective-C message.
            Some(syntax::PROPERTY_SIGNATURE) => {
                self.in_objc_module(*declaration)
                    && self.declared_by_an_interface(*declaration)
                    && !self
                        .node(*declaration)
                        .native
                        .as_deref()
                        .is_some_and(|n| n.get.is_some() || n.set.is_some())
            }
            Some(syntax::PROPERTY_DECLARATION) => self.objc_class_member(*declaration).is_some(),
            // A binding's property, as the accessors an Objective-C property
            // is; or an accessor of a class the program writes over one,
            // which is sent as the runtime would send it, to its own entry.
            Some(syntax::GET_ACCESSOR | syntax::SET_ACCESSOR) => {
                self.objc_class_member(*declaration).is_some()
                    || self.program_objc_accessor(*declaration)
            }
            _ => false,
        };
        let name = self
            .node(member)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)?;
        // By the member's symbol, and otherwise by name on the receiver's
        // type: a property *written* is given a symbol with no declarations,
        // while the type still lists the property it names.
        let declaration = self
            .node(member)
            .symbol
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .and_then(|record| record.declarations.iter().copied().find(objc))
            .or_else(|| {
                // Through the absences of an optional receiver: `w?.contentView`
                // reads it on `NSWindow | null`. And through `this` in a
                // method of a class the program writes, whose type is the
                // class's polymorphic `this`: `this.title` is the class's.
                let ty =
                    self.class_behind(self.present_part(*self.snapshot.node_types.get(&object)?)?);
                let TypeKind::Object { properties } = &self.snapshot.types.get(ty.0 as usize)?.kind
                else {
                    return None;
                };
                properties
                    .iter()
                    .find(|p| p.name.is_name(name.as_ref()))
                    .and_then(|p| p.declaration)
                    .filter(objc)
            })?;
        let is_static = self
            .objc_class_member(declaration)
            .is_some_and(|member| member.is_static);
        let (getter, setter) = self.property_selectors(declaration, &name);
        Some(ObjcProperty {
            declaration,
            is_static,
            getter,
            setter,
        })
    }

    /// Whether a member is declared by an `interface` rather than by an
    /// anonymous type literal.
    ///
    /// **A property signature inside an `objc:` module is not automatically an
    /// Objective-C property**, and `in_objc_module` alone says it is. A C record
    /// declared in the same module is a type literal of field signatures:
    ///
    /// ```ts
    /// declare module "objc:Foundation" {
    ///   export type Size = Struct<{ width: Float64; height: Float64 }, "Size">;
    /// ```
    ///
    /// `width` is a field of a struct read by offset, not a selector sent to an
    /// object -- and reading it as a message made `dirtyRect.size.width` build a
    /// *foreign function* called `width`, which then refused for having a return
    /// with no native ABI. An Objective-C class or protocol arrives as a `class`
    /// or an `interface`; nothing read by selector is an anonymous literal.
    ///
    /// **This was latent, and it is the fill in `symbols::Deferred` that
    /// published it.** `objc_property` looks the declaration up by the member's
    /// symbol and falls back to the receiver's type, and the fallback only
    /// considers a `TypeKind::Object` -- a `Struct<…>` is an intersection, so it
    /// found nothing and answered "not an objc property", correctly and for the
    /// wrong reason. While those members had no declarations recorded, only the
    /// fallback could run.
    ///
    /// Bounded rather than a full ascent, and `TYPE_LITERAL` is a *stop* rather
    /// than something to walk past: a property signature nested inside a literal
    /// inside an interface belongs to the literal, which is the case the bound
    /// alone would get wrong.
    ///
    /// **Both answers are held by a test**, which is worth saying because the
    /// corpus holds neither: forcing this to `false` leaves all 50
    /// `tests/interop` refusal counts byte-identical, and breaks
    /// `a_property_reads_and_writes_by_message` in `codegen/c/tests/objc.rs` --
    /// an `objc:` interface's property, read as a message. The `false` side is
    /// `an_override_takes_the_selector_it_replaces_and_a_record_by_value`, whose
    /// `Struct` field this exists for. So the whole arm lives in those two tests
    /// and nothing in `examples` would notice it going wrong.
    fn declared_by_an_interface(&self, declaration: NodeId) -> bool {
        let mut at = self.node(declaration).parent;
        for _ in 0..8 {
            let Some(parent) = at else { return false };
            match self.kind_of(parent) {
                Some(syntax::INTERFACE_DECLARATION) => return true,
                Some(syntax::TYPE_LITERAL) => return false,
                _ => at = self.node(parent).parent,
            }
        }
        false
    }

    /// `ty` without its absences, where one type is left: `NSWindow` of
    /// `NSWindow | null | undefined`, the receiver `a?.b` reads `b` on in the
    /// arm where `a` is present.
    fn present_part(&self, ty: TypeId) -> Option<TypeId> {
        match &self.snapshot.types.get(ty.0 as usize)?.kind {
            TypeKind::Union(members) => {
                let mut present = members
                    .iter()
                    .filter(|m| absence_of_member(self.snapshot, **m).is_none());
                let only = present.next()?;
                present.next().is_none().then_some(*only)
            }
            _ => Some(ty),
        }
    }

    /// A property's getter and setter selectors, the setter `None` when it is
    /// read-only: a field declared `readonly`, or accessors with no `set`.
    /// Each is its tag where the binding gave one, else the name's -- `title`
    /// and `setTitle:`. An accessor of a class the program writes over an
    /// Objective-C class answers the selectors of the property it overrides,
    /// so `get isFlipped()` is sent `isFlipped`, as `AppKit` sends it.
    fn property_selectors(&self, declaration: NodeId, name: &str) -> (String, Option<String>) {
        if self.program_objc_accessor(declaration)
            && let Some(overridden) = self.overridden_property(declaration, name)
        {
            return self.property_selectors(overridden, name);
        }
        let tag =
            |node: NodeId, pick: fn(&nts_semantic_schema::NativeAttributes) -> Option<String>| {
                self.node(node)
                    .native
                    .as_ref()
                    .and_then(|native| pick(native))
            };
        if self.kind_of(declaration) == Some(syntax::PROPERTY_DECLARATION)
            || self.kind_of(declaration) == Some(syntax::PROPERTY_SIGNATURE)
        {
            let getter =
                tag(declaration, |n| n.selector.clone()).unwrap_or_else(|| name.to_owned());
            let setter = (!self
                .node(declaration)
                .modifiers
                .contains(nts_semantic_schema::DeclarationModifiers::READONLY))
            .then(|| tag(declaration, |n| n.set.clone()).unwrap_or_else(|| default_setter(name)));
            return (getter, setter);
        }
        // Accessors: the pair declared beside this one, in the same class.
        let pair: Vec<NodeId> = self
            .node(declaration)
            .parent
            .map(|list| self.children(list))
            .unwrap_or_default()
            .into_iter()
            .filter(|member| {
                matches!(
                    self.kind_of(*member),
                    Some(syntax::GET_ACCESSOR | syntax::SET_ACCESSOR)
                ) && self.member_name(*member).as_deref() == Some(name)
            })
            .collect();
        let get = pair
            .iter()
            .copied()
            .find(|m| self.kind_of(*m) == Some(syntax::GET_ACCESSOR));
        let set = pair
            .iter()
            .copied()
            .find(|m| self.kind_of(*m) == Some(syntax::SET_ACCESSOR));
        let getter = get
            .and_then(|g| tag(g, |n| n.selector.clone()))
            .unwrap_or_else(|| name.to_owned());
        let setter = set.map(|s| tag(s, |n| n.set.clone()).unwrap_or_else(|| default_setter(name)));
        (getter, setter)
    }

    /// A read or write, from TypeScript, of an accessor of a class the
    /// program writes over an Objective-C class: the compiled accessor,
    /// called directly, as a method of it is (`lower_program_objc_call`).
    fn call_program_accessor(
        &mut self,
        id: NodeId,
        declaration: NodeId,
        kind: &str,
        args: Vec<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        let class = self
            .enclosing_class(declaration)
            .ok_or_else(|| self.unsupported(id, "an accessor outside a class"))?;
        let name = self
            .member_name(declaration)
            .ok_or_else(|| self.unsupported(id, "an accessor whose name the program computes"))?;
        let owner = self.class_name_for(class, None, false)?;
        let ty = if kind == "set" {
            HirType::Void
        } else {
            self.type_of(id)
                .ok_or_else(|| self.unrepresentable(id, "a property"))?
        };
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::Call {
                callee: Callee::Direct(format!("{owner}#{kind} {name}")),
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// Whether `declaration` is an accessor of a class the program writes over
    /// an Objective-C class.
    fn program_objc_accessor(&self, declaration: NodeId) -> bool {
        matches!(
            self.kind_of(declaration),
            Some(syntax::GET_ACCESSOR | syntax::SET_ACCESSOR)
        ) && self
            .enclosing_class(declaration)
            .is_some_and(|class| super::native::extends_objc(self.snapshot, class))
    }

    /// The property of a superclass a binding declares that an accessor of
    /// the program's class overrides: its accessor, or its field.
    fn overridden_property(&self, declaration: NodeId, name: &str) -> Option<NodeId> {
        let class = self.enclosing_class(declaration)?;
        for here in self.native_bases(class) {
            if let Some(found) = self.children(here).into_iter().find(|member| {
                matches!(
                    self.kind_of(*member),
                    Some(
                        syntax::GET_ACCESSOR | syntax::SET_ACCESSOR | syntax::PROPERTY_DECLARATION
                    )
                ) && self.objc_class_member(*member).is_some()
                    && self.member_name(*member).as_deref() == Some(name)
            }) {
                return Some(found);
            }
        }
        None
    }

    /// `object.property` as a message: the getter, sent to the object.
    fn lower_objc_property_get(
        &mut self,
        id: NodeId,
        object: NodeId,
        member: NodeId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let Some(property) = self.objc_property(object, member) else {
            return Ok(None);
        };
        let receiver = if property.is_static {
            None
        } else {
            Some(self.lower_expression(object)?)
        };
        self.read_objc_property(id, object, &property, receiver)
    }

    /// The getter of `property`, sent to `receiver` (lowered already, which
    /// is how `a?.b` reads it in the arm where `a` is present), or to the
    /// class for a class property.
    fn read_objc_property(
        &mut self,
        id: NodeId,
        object: NodeId,
        property: &ObjcProperty,
        receiver: Option<ValueId>,
    ) -> Result<Option<ValueId>, Diagnostic> {
        // The access's type is the property's: the checker gives the member's
        // symbol none of its own.
        let (Some(_), Some(ty)) = (
            self.snapshot.node_types.get(&object).copied(),
            self.snapshot.node_types.get(&id).copied(),
        ) else {
            return Ok(None);
        };
        if self.program_objc_accessor(property.declaration) {
            let receiver = receiver.ok_or_else(|| {
                self.unsupported(
                    id,
                    "a static accessor of a class extending an Objective-C class",
                )
            })?;
            return self
                .call_program_accessor(id, property.declaration, "get", vec![receiver])
                .map(Some);
        }
        // A class's constant: a static getter tagged with the extern variable
        // it reads (`@ntsSymbol UITextFieldTextDidChangeNotification`), which
        // is no message but a load of that variable.
        if receiver.is_none()
            && self
                .node(property.declaration)
                .native
                .as_ref()
                .is_some_and(|native| native.symbol.is_some())
        {
            return self
                .read_native_variable(id, property.declaration, ty)
                .map(Some);
        }
        if let Some(receiver) = receiver
            && self.optional_requirement(property.declaration)
        {
            // Swift's `delegate?.window`, where `window` is an `optional`
            // requirement: sent only to an object that implements it, and
            // absent from one that does not.
            let origin = self.origin(id);
            let present = self.responds_to(receiver, &property.getter, origin);
            return self
                .lower_branching_value(
                    id,
                    present,
                    Branch::ObjcGetter(receiver, object, property.clone()),
                    Branch::Absent,
                )
                .map(Some);
        }
        self.send_objc_getter(id, object, property, receiver)
            .map(Some)
    }

    /// Whether `declaration` is an `optional` property requirement of an
    /// Objective-C protocol a binding declares: `window?: UIWindow | null`.
    fn optional_requirement(&self, declaration: NodeId) -> bool {
        self.kind_of(declaration) == Some(syntax::PROPERTY_SIGNATURE)
            && self
                .children(declaration)
                .iter()
                .any(|child| self.kind_of(*child) == Some(syntax::QUESTION_TOKEN))
            && self.declaring_protocol(declaration).is_some()
    }

    /// The getter of `property`, sent: to `receiver`, or to the class for a
    /// class property.
    fn send_objc_getter(
        &mut self,
        id: NodeId,
        object: NodeId,
        property: &ObjcProperty,
        receiver: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        let (Some(receiver_ty), Some(ty)) = (
            self.snapshot.node_types.get(&object).copied(),
            self.snapshot.node_types.get(&id).copied(),
        ) else {
            return Err(self.unrepresentable(id, "an Objective-C property"));
        };
        // An `optional` requirement's `?` adds an `undefined` the getter does
        // not answer: the one absence is the branch around it, and the getter
        // answers what the declaration writes, `UIWindow | null`.
        let ty = if self.optional_requirement(property.declaration) {
            self.children(property.declaration)
                .last()
                .and_then(|annotation| self.snapshot.node_types.get(annotation).copied())
                .unwrap_or(ty)
        } else {
            ty
        };
        let chained = self.without_chain_absence(id, ty);
        // The receiver is present where the getter is sent: `a?.b?.c` sends
        // `c` to `a.b` as a `B`, not as the `B | null | undefined` the
        // checker gives the expression `a?.b`.
        let receiver_ty = self.class_behind(self.present_part(receiver_ty).unwrap_or(receiver_ty));
        let signature = accessor_signature(receiver.map(|_| receiver_ty), None, chained);
        let callee =
            self.native_callee_sending(id, property.declaration, &property.getter, &signature)?;
        let (args, lent) = self.lower_call_arguments(id, &callee, &[], receiver)?;
        // In a chain, the getter's value is the property's type; the branch
        // around it makes the chain's.
        let typed = if chained == ty {
            None
        } else {
            self.represent(chained)
        };
        self.finish_call_typed(id, callee, args, lent, Some(property.declaration), typed)
    }

    /// `object.property = value` as a message: the setter, sent to the
    /// object, with the value its one argument. The assignment's own value is
    /// that argument, read back at the expression's type.
    fn lower_objc_property_set(
        &mut self,
        id: NodeId,
        target: NodeId,
        source: NodeId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        if self.kind_of(target) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return Ok(None);
        }
        let [object, member] = self.children(target)[..] else {
            return Ok(None);
        };
        let Some(property) = self.objc_property(object, member) else {
            return Ok(None);
        };
        // Defensive: TypeScript refuses the assignment first (TS2540), and a
        // cast to write it anyway names a different property, which is not
        // this one. Kept because a binding could still be wrong about which
        // properties are `readonly`, and sending a setter that does not exist
        // would answer `unrecognized selector` at run time.
        let Some(setter) = property.setter.clone() else {
            return Err(self.unsupported(id, "an assignment to a readonly Objective-C property"));
        };
        let (Some(receiver_ty), Some(ty)) = (
            self.snapshot.node_types.get(&object).copied(),
            self.snapshot.node_types.get(&target).copied(),
        ) else {
            return Ok(None);
        };
        let receiver = if property.is_static {
            None
        } else {
            Some(self.lower_expression(object)?)
        };
        if self.program_objc_accessor(property.declaration) {
            let receiver = receiver.ok_or_else(|| {
                self.unsupported(
                    id,
                    "a static accessor of a class extending an Objective-C class",
                )
            })?;
            let value_ty = self
                .type_of(target)
                .ok_or_else(|| self.unrepresentable(target, "a property"))?;
            let value = self.lower_expecting(source, &value_ty)?;
            self.call_program_accessor(id, property.declaration, "set", vec![receiver, value])?;
            return Ok(Some(value));
        }
        // `this.title = ...` in a method of a class the program writes: the
        // class, not its polymorphic `this`.
        let receiver_ty = self.class_behind(receiver_ty);
        let signature =
            accessor_signature(receiver.map(|_| receiver_ty), Some(ty), self.void_type()?);
        let callee = self.native_callee_sending(id, property.declaration, &setter, &signature)?;
        let (args, lent) = self.lower_call_arguments(id, &callee, &[source], receiver)?;
        let written = *args
            .get(usize::from(receiver.is_some()))
            .ok_or_else(|| self.unsupported(id, "a property setter with no value"))?;
        self.finish_call(id, callee, args, lent, Some(property.declaration))?;
        let want = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "an assignment"))?;
        if self.values[written.0 as usize].ty == want {
            return Ok(Some(written));
        }
        let origin = self.origin(id);
        Ok(Some(self.push(OpKind::Convert(written), want, origin)))
    }

    /// A member of an Objective-C class a binding declares (`@ntsClass`):
    /// the class Objective-C knows it by, and whether the member is `static`.
    fn objc_class_member(&self, declaration: NodeId) -> Option<ObjcClassMember> {
        // Past the member list, which is a node of its own with no syntax kind.
        let mut class = self.node(declaration).parent?;
        while self.kind_of(class).is_none() {
            class = self.node(class).parent?;
        }
        let name = match self.kind_of(class) {
            Some(syntax::CLASS_DECLARATION) => self.node(class).native.as_ref()?.class.clone()?,
            // An interface merging into one -- a Swift extension, as AppKit
            // adds `boolValue` to Foundation's `NSString` in a second `declare
            // module "objc:Foundation"` block -- declares members of that
            // class.
            Some(syntax::INTERFACE_DECLARATION) if self.in_objc_module(class) => {
                self.merged_objc_class(class)?
            }
            _ => return None,
        };
        let is_static = self
            .node(declaration)
            .modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::STATIC);
        Some(ObjcClassMember {
            class: name,
            is_static,
        })
    }

    /// The Objective-C class an interface merges into: the `@ntsClass` of a
    /// class declaration of the same symbol.
    fn merged_objc_class(&self, interface: NodeId) -> Option<String> {
        let name = self
            .children(interface)
            .into_iter()
            .find(|child| self.kind_of(*child) == Some(syntax::IDENTIFIER))?;
        let record = self
            .snapshot
            .symbols
            .get(self.node(name).symbol?.0 as usize)?;
        record
            .declarations
            .iter()
            .find(|declaration| self.kind_of(**declaration) == Some(syntax::CLASS_DECLARATION))
            .and_then(|class| self.node(*class).native.as_ref()?.class.clone())
    }

    /// `new C(...)` for an Objective-C class: `+alloc` sent to the class, then
    /// the constructor's `init...` sent to what it answered, which is ARC's
    /// own pair -- the first hands over an object, the second consumes it and
    /// hands over one. A constructor whose selector is a class method
    /// (`@ntsSelector +buttonWithTitle:target:action:`, which Swift imports as
    /// an `init`) is that one message instead.
    /// `new App()` for a class the program writes over a composable Windows
    /// Runtime class: the runtime composes it (`nts_com_compose_named`, by the
    /// name the class is registered under) and answers the base's default
    /// interface on the aggregate, +1. It takes no arguments: the class has
    /// no constructor of its own, and the base's is its factory's
    /// parameterless one.
    fn lower_com_new(&mut self, id: NodeId) -> Result<Option<ValueId>, Diagnostic> {
        let Some(class) = self.constructed_class(id) else {
            return Ok(None);
        };
        // A runtime class a binding declares, made by the constructor the
        // checker chose: composable or sealed, a factory's method or the
        // default activation. Only the class's own constructor: one a class
        // of the program's inherits from its base would make the base, not
        // the class written over it.
        let own = self
            .snapshot
            .call_targets
            .get(&id)
            .and_then(|target| target.callee)
            .is_some_and(|constructor| self.enclosing_class(constructor) == Some(class));
        if own && let Some(object) = self.lower_com_construct(id)? {
            return Ok(Some(object));
        }
        if super::native::is_com_class(self.snapshot, class) {
            return Ok(None);
        }
        if !super::native::extends_com(self.snapshot, class) {
            return Ok(None);
        }
        let Some(name) = foreign_class_name(self.snapshot, class) else {
            return Err(self.unsupported(
                id,
                "a `new` of an anonymous class written over a composable Windows Runtime class",
            ));
        };
        // A class with a constructor is made by it: `{Class}#new`, whose
        // `super()` composes the instance.
        if let Some(constructor) = self
            .children(class)
            .into_iter()
            .find(|member| self.kind_of(*member) == Some(syntax::CONSTRUCTOR))
        {
            let callee = Callee::Direct(format!("{name}#new"));
            let arguments = self.arguments_of(id);
            let (args, lent) = self.lower_call_arguments(id, &callee, &arguments, None)?;
            return self
                .finish_call(id, callee, args, lent, Some(constructor))
                .map(Some);
        }
        if !self.arguments_of(id).is_empty() {
            return Err(self.unsupported(id, "a `new` with arguments of a class written over a composable Windows Runtime class that declares no constructor"));
        }
        let Some(ty @ HirType::NativePointer(_)) = self.type_of(id) else {
            return Err(self.unsupported(id, "a class written over a composable Windows Runtime class whose instances are not its base's handle"));
        };
        Ok(Some(self.compose_named(&name, ty, &self.origin(id))))
    }

    /// `new Window()`: a composable Windows Runtime class a binding declares,
    /// made as itself -- its constructor is its factory's `CreateInstance`,
    /// tagged as the static is (`@ntsVtable`, `@ntsHresult composable`,
    /// `@ntsFactory`), and called as the static is, with no outer object.
    /// `None` for a constructor with no slot, which nothing lowers.
    fn lower_com_construct(&mut self, id: NodeId) -> Result<Option<ValueId>, Diagnostic> {
        let Some(target) = self.snapshot.call_targets.get(&id).copied() else {
            return Ok(None);
        };
        let Some(declaration) = target.callee else {
            return Ok(None);
        };
        // `new PropertySet()`: the default constructor, activated.
        if let Some(activate) = self
            .node(declaration)
            .native
            .as_ref()
            .and_then(|n| n.activate.clone())
        {
            let result = self.snapshot.signatures[target.signature.0 as usize].return_type;
            let arguments = self.arguments_of(id);
            return self
                .lower_activation(id, &activate, result, &arguments)
                .map(Some);
        }
        let Some(method) = self
            .node(declaration)
            .native
            .as_ref()
            .and_then(|n| n.vtable.as_deref())
            .and_then(|v| v.split_whitespace().nth(1))
            .map(str::to_owned)
        else {
            return Ok(None);
        };
        // The constructor is the factory's method, answering the instance:
        // a call, not a construct signature, to the function it lowers to.
        let mut signature = self.snapshot.signatures[target.signature.0 as usize].clone();
        signature.is_construct = false;
        let callee = self.native_callee(id, Some(declaration), method, &signature)?;
        // Called on the class's factory, as the static is.
        let factory = match &callee {
            Callee::Native(target) => target
                .vtable
                .as_ref()
                .and_then(|vtable| vtable.factory.clone()),
            _ => None,
        };
        let receiver = factory.map(|factory| self.factory_receiver(&factory, id));
        let arguments = self.arguments_of(id);
        let (args, lent) = self.lower_call_arguments(id, &callee, &arguments, receiver)?;
        self.finish_call(id, callee, args, lent, Some(declaration))
            .map(Some)
    }

    /// The class declaration a `new` constructs, through its expression's
    /// symbol: `App` in `new App()`.
    fn constructed_class(&self, id: NodeId) -> Option<NodeId> {
        let expression = *self.children(id).first()?;
        let symbol = self.denoted_symbol(self.node(expression).symbol?);
        self.snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .iter()
            .copied()
            .find(|declaration| self.kind_of(*declaration) == Some(syntax::CLASS_DECLARATION))
    }

    /// A class's `GType`, from the function `gtype_function` named: a program
    /// class's own, which its backend defines and registers it in, or the
    /// binding's `get_type`.
    fn call_gtype(
        &mut self,
        id: NodeId,
        gtype: &super::native::GType,
    ) -> Result<ValueId, Diagnostic> {
        let super::native::GType::ProgramClass(class) = gtype else {
            return self.call_foreign_named(id, &gtype.symbol(), Vec::new());
        };
        let size = super::native::Type::Scalar(super::native::Scalar::Size);
        let ty = size.representation();
        let mut function = synthesized(&gtype.symbol(), Vec::new(), size, None, Vec::new());
        function.thunk = Some(super::native::GObjectThunk::Type {
            class: class.clone(),
        });
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::Call {
                callee: Callee::Native(std::sync::Arc::new(function)),
                args: Vec::new(),
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// `Task.$gtype`, GJS's name for a `GObject` class's `GType`: the one
    /// `gtype_function` names for the class the member is read from -- so a
    /// class the program wrote answers its own, not its parent's, whose
    /// declaration it inherited. `None` for any other read.
    fn gtype_read(
        &mut self,
        id: NodeId,
        object: NodeId,
        member: NodeId,
    ) -> Option<Result<ValueId, Diagnostic>> {
        if self.literal_name(member).as_deref() != Some("$gtype") {
            return None;
        }
        let symbol = self.denoted_symbol(self.node(object).symbol?);
        let gtype = super::native::gtype_function(self.snapshot, symbol)?;
        Some(self.call_gtype(id, &gtype))
    }

    /// Whether `declaration` sits inside `declare module "objc:..."`.
    fn in_objc_module(&self, declaration: NodeId) -> bool {
        let mut at = self.node(declaration).parent;
        while let Some(id) = at {
            // The checker names an ambient module by its specifier, quotes
            // and all: `"objc:AppKit"`. The node carries no symbol, so the
            // module's is found by its declaration; this is asked only of a
            // constant already typed `ObjcMeta`, so the scan is rare.
            if self.kind_of(id) == Some(nts_semantic_schema::syntax::MODULE_DECLARATION) {
                return self
                    .snapshot
                    .symbols
                    .iter()
                    .find(|record| record.declarations.contains(&id))
                    .is_some_and(|record| {
                        record
                            .name
                            .public_name()
                            .is_some_and(|name| name.trim_matches('"').starts_with("objc:"))
                    });
            }
            at = self.node(id).parent;
        }
        false
    }

    /// The Objective-C message a declaration tagged `@ntsSelector` sends.
    ///
    /// Refused here, where the declaration is in hand, for everything the call
    /// could not honour:
    /// - A method sends to `this`, and a function to the class `@ntsClass`
    ///   names. A function with no class has no receiver.
    /// - One argument per colon, because the selector is the method's
    ///   signature. `initWithUTF8String` with an argument would send a message
    ///   the class answers with a different method, or with none.
    /// - No variadic tail and no managed ABI, since the send is a cast to one
    ///   exact C function type. No closures either, because a callback crosses
    ///   into Objective-C as a block, which is A2.
    fn objc_send(
        &self,
        call: NodeId,
        declaration: NodeId,
        native: &super::native::Function,
        selector: String,
        class_send: Option<String>,
    ) -> Result<super::native::Send, Diagnostic> {
        let attributes = self.node(declaration).native.as_deref();
        if attributes.is_some_and(|n| n.symbol.is_some()) {
            return Err(self.unsupported(call, "a declaration that is both an Objective-C message (`@ntsSelector`) and a C function (`@ntsSymbol`)"));
        }
        if !super::native::Send::is_selector(&selector) {
            return Err(self.unsupported(
                call,
                "@ntsSelector names one selector, as in `@ntsSelector initWithUTF8String:`",
            ));
        }
        // A property's accessors send to `this` as a method does. A member of
        // an Objective-C class a binding declares sends to its instance, or
        // to its class when it is `static`; and an explicit class send -- the
        // `alloc` of a `new` -- goes to the class it names.
        let (method, class) = match (class_send, self.objc_class_member(declaration)) {
            (Some(class), _) => (false, Some(class)),
            (None, Some(member)) if member.is_static => (false, Some(member.class)),
            (None, Some(_)) => (true, None),
            (None, None) => (
                matches!(
                    self.kind_of(declaration),
                    Some(syntax::METHOD_SIGNATURE | syntax::PROPERTY_SIGNATURE)
                ),
                attributes.and_then(|n| n.class.clone()),
            ),
        };
        match (method, &class) {
            (true, Some(_)) => {
                return Err(self.unsupported(
                    call,
                    "@ntsClass on a method, whose receiver is already `this`",
                ));
            }
            (false, None) => {
                return Err(self.unsupported(call, "an Objective-C message with no receiver: `this` on a method, or `@ntsClass` on a function"));
            }
            (false, Some(name)) if !super::native::is_c_identifier(name) => {
                return Err(self.unsupported(
                    call,
                    "@ntsClass names one Objective-C class, as in `@ntsClass NSString`",
                ));
            }
            _ => {}
        }
        if native.variadic.is_some() || native.convention != super::native::Convention::C {
            return Err(self.unsupported(call, "an Objective-C message with a variadic tail or a managed ABI, which a cast to one C function type cannot carry"));
        }
        if native.roles.iter().any(|role| {
            let role = match role {
                super::native::Role::Label { inner, .. } => inner.as_ref(),
                role => role,
            };
            !matches!(
                role,
                super::native::Role::Plain
                    | super::native::Role::String(_)
                    | super::native::Role::Block { .. }
                    | super::native::Role::Label { .. }
                    | super::native::Role::NSString
                    | super::native::Role::NSArray(_)
                    | super::native::Role::NSDictionary(_)
                    | super::native::Role::NSSet(_)
                    | super::native::Role::ErrorSlot { .. }
            )
        }) {
            return Err(self.unsupported(call, "an Objective-C message taking a C callback, an array or an error slot; a callback crosses as a `Block<F>`"));
        }
        // The *message's* arguments: the declared parameters less the
        // receiver. Not the C arity, which also counts `self` and `_cmd` --
        // `uppercaseString` has no colon and a two-parameter C signature.
        let arguments = native.parameters.len() - usize::from(method);
        if super::native::Send::arity(&selector) != arguments {
            return Err(self.unsupported(
                call,
                &format!(
                    "an Objective-C message whose selector `{selector}` takes {} argument(s) where the declaration passes {arguments}: one colon per argument",
                    super::native::Send::arity(&selector)
                ),
            ));
        }
        // An object the program counts is ARC's to retain and release. A
        // binding that still declares `release` (as A1a's had to) would
        // release behind the count's back: a use-after-free in a program that
        // compiled the day before.
        let counted_receiver = method
            && matches!(&native.parameters[0], super::native::Type::Pointer(pointee) if pointee.counting().is_some());
        if counted_receiver && super::native::ARC_OWNED_SELECTORS.contains(&selector.as_str()) {
            return Err(self.unsupported(
                call,
                &format!("`{selector}` sent to an Objective-C object the program counts, which ARC reserves: the compiler retains and releases it"),
            ));
        }
        Ok(super::native::Send {
            selector,
            class,
            super_of: self.super_send.clone(),
        })
    }

    fn push_call(
        &mut self,
        id: NodeId,
        callee: Callee,
        args: Vec<ValueId>,
        declaration: Option<NodeId>,
        typed: Option<HirType>,
    ) -> Result<ValueId, Diagnostic> {
        let reserved =
            declaration.and_then(|declaration| self.generators.get(&declaration).copied());
        // A native function returning a string returns C's `const char *`,
        // which is what the call's own value is; the caller copies it into the
        // string the program sees (`read_native_string`).
        // And one whose result C declares as an ancestor (`Declared`), which
        // is that ancestor until `finish_call` converts it, and a 64-bit
        // integer read as a number (`AsNumber`), which `finish_call` checks.
        let native_string = match &callee {
            Callee::Native(target)
                if target.returns_string.is_some()
                    || target.result_as.is_some()
                    || target.result_as_number =>
            {
                Some(target.result.representation())
            }
            // And one returning nothing, whatever the node it lowers: a
            // property's setter stands where the assigned value's type is.
            Callee::Native(target) if target.result == super::native::Type::Void => {
                Some(HirType::Void)
            }
            // A record result is written into the call's destination, and the
            // call itself produces nothing.
            Callee::Native(target) if target.destination().is_some() => Some(target.call_result()),
            // A native call that returns nothing produces nothing, whatever the
            // expression around it is typed: a property setter is called for
            // an assignment, whose type is the value's.
            Callee::Native(target) if target.call_result() == HirType::Void => Some(HirType::Void),
            _ => None,
        };
        let ty = reserved
            .map(|index| HirType::Managed(ManagedType::Object(super::generator_frame(index))))
            .or(native_string)
            .or(typed)
            .or_else(|| self.type_of(id))
            .ok_or_else(|| self.unrepresentable(id, "a call result"))?;
        // **A native handle is never the program's array or string.** A call
        // typed as the node it lowers takes the program's type, and where the
        // native function answers a pointer that type is not a conversion but
        // a cast in C: a `ResizeObserverSizeSequence *` read as `NtsArray *`
        // had its length read out of the Blink object (the Chromium lane's
        // lib-dom-a-sequence-attribute-read-as-its-array). Whatever reaches
        // here that way is refused by name, so the next such path fails
        // loudly instead of reading memory.
        if let Callee::Native(target) = &callee
            && matches!(target.result.representation(), HirType::NativePointer(_))
            && matches!(
                ty,
                HirType::Managed(ManagedType::Array(_) | ManagedType::String)
            )
        {
            return Err(self.unsupported(
                id,
                &format!(
                    "a native function's handle result read as {}, which no conversion makes",
                    if matches!(ty, HirType::Managed(ManagedType::String)) {
                        "a string"
                    } else {
                        "an array"
                    }
                ),
            ));
        }
        let origin = self.origin(id);
        let call = self.push(
            OpKind::Call {
                callee,
                args,
                frame: None,
            },
            ty,
            origin,
        );
        let call = self.note_generator_call(call, reserved);
        self.test_for_a_raise(id);
        Ok(call)
    }

    fn runtime_call(
        &mut self,
        name: &str,
        args: Vec<ValueId>,
        ty: HirType,
        origin: Origin,
    ) -> ValueId {
        self.push(
            OpKind::Call {
                callee: Callee::External(name.to_owned()),
                args,
                frame: None,
            },
            ty,
            origin,
        )
    }

    /// A call to a helper that takes a key ([`super::tables::KEYED`]), told
    /// the kind of key the call was written against -- `table`'s, the type it
    /// was resolved on -- as its last argument. Fixed here, where the type is
    /// the call's own, and never derived later from the table operand, which
    /// inlining can retype (`hir::tables`).
    fn keyed_call(
        &mut self,
        name: &str,
        table: &HirType,
        mut args: Vec<ValueId>,
        ty: HirType,
        origin: Origin,
    ) -> ValueId {
        let kind = self.push(
            OpKind::ConstInt(i128::from(super::tables::key_kind_of_table(table))),
            super::tables::KIND_TYPE,
            origin.clone(),
        );
        args.push(kind);
        self.runtime_call(name, args, ty, origin)
    }

    fn optional_method_presence(
        &mut self,
        id: NodeId,
        operator: u16,
        lhs: NodeId,
        rhs: NodeId,
    ) -> Option<Result<ValueId, Diagnostic>> {
        if !matches!(
            operator,
            syntax::EQUALS_EQUALS_TOKEN
                | syntax::EQUALS_EQUALS_EQUALS_TOKEN
                | syntax::EXCLAMATION_EQUALS_TOKEN
                | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN
        ) {
            return None;
        }
        let positive = matches!(
            operator,
            syntax::EQUALS_EQUALS_TOKEN | syntax::EQUALS_EQUALS_EQUALS_TOKEN
        );
        // Either order: `o.m !== undefined` and `undefined !== o.m` ask the
        // same thing, as do both orders of the `typeof` form.
        let (access, present) = self
            .presence_operand(lhs, rhs, positive)
            .or_else(|| self.presence_operand(rhs, lhs, positive))?;
        if self.kind_of(access) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return None;
        }
        let parts = self.children(access);
        let (Some(&object), Some(&member)) = (parts.first(), parts.last()) else {
            return None;
        };
        if object == member {
            return None;
        }
        let key = self.property_key(member)?;
        let receiver_ty = *self.snapshot.node_types.get(&object)?;
        if !self.declares_an_optional_method(receiver_ty, &key) {
            return None;
        }
        // **`present` and not the operator from here on.** Four comparisons
        // reach this and two of each pair mean the same thing, so the token was
        // being normalised back into a token and re-read twice -- one fact with
        // three spellings inside twenty lines, which is the shape of every
        // defect found today.
        Some((|| {
            let Some((_, has_it)) = self.has_the_slot(id, object, &key)? else {
                // Nothing in the program defines it, so no runtime value can
                // carry the slot and the answer is a constant: absent.
                let origin = self.origin(id);
                return Ok(self.push(OpKind::ConstBool(!present), HirType::Bool, origin));
            };
            // `InstanceOf` answers *present*, so a test asking for absent is
            // its negation.
            if !present {
                let origin = self.origin(id);
                return Ok(self.push(
                    OpKind::Unary {
                        op: UnOp::Not,
                        operand: has_it,
                    },
                    HirType::Bool,
                    origin,
                ));
            }
            Ok(has_it)
        })())
    }
}

/// A branch target and the arguments its block takes: what [`FuncBuilder::lower_jumps`]
/// sends each test's outcome to.
type JumpTarget<'a> = (BlockId, &'a [ValueId]);

mod overload_results;

#[cfg(test)]
mod result_overload_tests;

#[cfg(test)]
mod implementation_tests;

#[cfg(test)]
mod import_phase_tests;

#[cfg(test)]
mod collection_tests;
#[cfg(test)]
mod view_class_tests;

#[cfg(test)]
mod carried_reference_tests;

mod binding_thens;
mod type_bases;

#[cfg(test)]
mod storage_ancestry_tests;

#[cfg(test)]
mod container_layout_tests;

#[cfg(test)]
mod binding_ancestry_tests;

#[cfg(test)]
mod native_lookup_tests;

#[cfg(test)]
mod collection_view_tests;

#[cfg(test)]
mod tests {
    use super::super::{Field, Layout, Program};
    use super::{MemberKey, TypeId};

    #[test]
    fn only_the_typed_receiver_fact_proves_its_class_representation() {
        use nts_semantic_schema::{
            NodeId, SemanticSnapshot, SymbolFlags, SymbolId, SymbolRecord, TypeKind, TypeRecord,
        };
        let mut snapshot = SemanticSnapshot::default();
        snapshot.symbols.push(SymbolRecord {
            name: "SameName".to_owned().into(),
            flags: SymbolFlags::CLASS,
            builtin: None,
            declarations: Vec::new(),
            declaration_sites: Vec::new(),
            ty: None,
            aliased: None,
            owner: None,
            constructor_value: None,
            library: None,
        });
        snapshot.types.push(TypeRecord {
            kind: TypeKind::Object {
                properties: Vec::new(),
            },
            symbol: Some(SymbolId(0)),
        });
        for (name, is_this) in [("T", false), ("SameName", false), ("\u{7f}class", true)] {
            snapshot.types.push(TypeRecord {
                kind: TypeKind::TypeParameter {
                    name: name.into(),
                    constraint: Some(TypeId(0)),
                    is_this,
                },
                // Even matching semantic symbol and printed class name do not
                // turn an ordinary constrained parameter into `this`.
                symbol: Some(SymbolId(0)),
            });
        }
        let bound = super::representation(&snapshot, TypeId(0));
        assert!(bound.is_some());
        for at in [TypeId(1), TypeId(2)] {
            assert_eq!(super::representation(&snapshot, at), None);
            assert!(!super::short(&snapshot, at).starts_with("`this`"));
        }
        assert_eq!(super::representation(&snapshot, TypeId(3)), bound);
        assert_eq!(
            super::short(&snapshot, TypeId(3)),
            "`this`, which stands for `SameName` here"
        );
        for at in 1..=3 {
            snapshot.node_types.insert(NodeId(at), TypeId(at));
        }
        let lowering = super::LoweringSnapshot::new(&snapshot);
        let probe = super::FuncBuilder::probe(&lowering);
        for at in 1..=3 {
            assert_eq!(probe.stands_for_its_own_class(NodeId(at)), at == 3);
            assert_eq!(
                probe.class_behind(TypeId(at)),
                if at == 3 { TypeId(0) } else { TypeId(at) }
            );
        }
    }

    #[test]
    fn semantic_computed_numbers_use_javascript_property_spelling() {
        use nts_semantic_schema::{LiteralValue, NodeId, SemanticSnapshot, TypeKind, TypeRecord};
        let mut snapshot = SemanticSnapshot::default();
        for (at, value) in [1e-7, 1e21, -0.0, 1000.0].into_iter().enumerate() {
            let at = u32::try_from(at).expect("four constants");
            snapshot.types.push(TypeRecord {
                kind: TypeKind::Literal(LiteralValue::Number(value)),
                symbol: None,
            });
            snapshot.node_types.insert(NodeId(at), TypeId(at));
        }
        let lowering = super::LoweringSnapshot::new(&snapshot);
        let probe = super::FuncBuilder::probe(&lowering);
        for (at, expected) in ["1e-7", "1e+21", "0", "1000"].into_iter().enumerate() {
            assert_eq!(
                probe
                    .constant_member_name(NodeId(u32::try_from(at).expect("four constants")))
                    .as_deref(),
                Some(expected)
            );
        }
    }

    #[test]
    fn a_private_template_member_needs_equal_source_arguments_and_storage() {
        use nts_semantic_schema::{
            NodeId, SemanticSnapshot, SymbolFlags, SymbolId, SymbolRecord, TypeKind, TypeRecord,
        };
        let mut snapshot = SemanticSnapshot::default();
        for index in 0..2 {
            snapshot.symbols.push(SymbolRecord {
                builtin: None,
                name: "SameName".to_owned().into(),
                flags: SymbolFlags::CLASS,
                declarations: vec![NodeId(index)],
                declaration_sites: Vec::new(),
                ty: None,
                aliased: None,
                owner: None,
                constructor_value: None,
                library: None,
            });
        }
        for symbol in [0, 0, 1, 0, 0] {
            snapshot.types.push(TypeRecord {
                kind: TypeKind::Object {
                    properties: Vec::new(),
                },
                symbol: Some(SymbolId(symbol)),
            });
        }
        for name in ["K", "V"] {
            snapshot.types.push(TypeRecord {
                kind: TypeKind::TypeParameter {
                    name: name.to_owned(),
                    is_this: false,
                    constraint: None,
                },
                symbol: None,
            });
        }
        snapshot
            .type_arguments
            .insert(TypeId(1), vec![TypeId(5), TypeId(6)]);
        snapshot
            .type_arguments
            .insert(TypeId(2), vec![TypeId(5), TypeId(6)]);
        snapshot
            .type_arguments
            .insert(TypeId(4), vec![TypeId(6), TypeId(5)]);
        for kind in [TypeKind::Number, TypeKind::String] {
            snapshot.types.push(TypeRecord { kind, symbol: None });
        }
        snapshot
            .type_arguments
            .insert(TypeId(0), vec![TypeId(7), TypeId(8)]);
        snapshot
            .type_arguments
            .insert(TypeId(3), vec![TypeId(8), TypeId(7)]);
        let snapshot = super::LoweringSnapshot::new(&snapshot);
        let mut probe = super::FuncBuilder::probe(&snapshot);
        let member = |owner| Field {
            name: nts_semantic_schema::PropertyKey::Private("#value".to_owned()),
            ty: super::HirType::NUMBER,
            declared_by: Some(TypeId(owner)),
            readonly: false,
            written: None,
        };
        assert!(
            !probe.one_slot(&member(1), &member(0)),
            "an unbound template"
        );
        probe.sources.insert(TypeId(5), TypeId(7));
        probe.sources.insert(TypeId(6), TypeId(8));
        assert!(probe.one_slot(&member(1), &member(0)));
        assert!(probe.one_slot(&member(0), &member(1)));
        assert!(
            !probe.one_slot(&member(2), &member(0)),
            "different declarations"
        );
        assert!(
            !probe.one_slot(&member(3), &member(0)),
            "two concrete instances"
        );
        assert!(super::is_a_generic_declaration(&snapshot, TypeId(4)));
        assert!(
            !probe.one_slot(&member(4), &member(0)),
            "a permuted template"
        );
        let mut different = member(0);
        different.ty = super::HirType::Bool;
        assert!(!probe.one_slot(&member(1), &different), "different storage");
        different = member(0);
        different.name = nts_semantic_schema::PropertyKey::Private("#other".to_owned());
        assert!(!probe.one_slot(&member(1), &different), "different members");
    }

    #[test]
    #[allow(clippy::unwrap_used, clippy::expect_used)]
    fn an_anonymous_field_schema_shares_its_source_supplier_in_either_demand_order() {
        use nts_frontend_ts::Frontend;
        let config = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/programs/accessor-schema-supplier/tsconfig.json");
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .unwrap();
        let snapshot = super::LoweringSnapshot::new(&snapshot);
        let foreign = super::NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default);
        let readers =
            super::initialization::PrivateReaders::new(&super::FuncBuilder::probe(&snapshot));
        let closures = super::collect_closures(&snapshot, &readers);
        let (hierarchy, naming) =
            super::hierarchy_and_naming(&snapshot, foreign, &closures, &readers);
        let schemas: Vec<_> = snapshot
            .types
            .iter()
            .enumerate()
            .filter_map(|(at, record)| {
                let super::TypeKind::Object { properties } = &record.kind else {
                    return None;
                };
                (properties.len() == 1 && properties[0].name.is_name("destroyed"))
                    .then(|| TypeId(u32::try_from(at).unwrap()))
            })
            .collect();
        assert!(
            schemas.len() >= 2,
            "the declaration and literal must be distinct source types"
        );
        for reversed in [false, true] {
            let mut probe = super::FuncBuilder::new(&snapshot, foreign);
            probe.hierarchy = &hierarchy;
            probe.closures = closures.clone().into();
            super::wire_naming(&mut probe, &naming);
            let mut schemas = schemas.clone();
            if reversed {
                schemas.reverse();
            }
            for schema in schemas {
                probe.layout_of(super::NodeId(0), schema).unwrap();
            }
            assert_eq!(
                probe
                    .layouts
                    .iter()
                    .filter(|layout| {
                        layout.fields.len() == 1 && layout.fields[0].name.is_name("destroyed")
                    })
                    .count(),
                1,
                "schema demand order reversed={reversed}"
            );
        }
    }

    #[test]
    #[allow(clippy::unwrap_used, clippy::expect_used)]
    fn anonymous_reservations_survive_layout_demand_order() {
        use nts_frontend_ts::Frontend;
        let config = camino::Utf8Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("tests/programs/accessor-schema-order/tsconfig.json")
            .canonicalize_utf8()
            .unwrap();
        let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
            .with_checkers(std::num::NonZeroU16::MIN)
            .snapshot(&config)
            .unwrap();
        let snapshot = super::LoweringSnapshot::new(&snapshot);
        let foreign = super::NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default);
        let readers =
            super::initialization::PrivateReaders::new(&super::FuncBuilder::probe(&snapshot));
        let closures = super::collect_closures(&snapshot, &readers);
        let (hierarchy, naming) =
            super::hierarchy_and_naming(&snapshot, foreign, &closures, &readers);
        let groups = [["item", "remove"], ["hostname", "port"]];
        let mut faces = Vec::new();
        let mut anonymous = Vec::new();
        for (at, record) in snapshot.types.iter().enumerate() {
            let super::TypeKind::Object { properties } = &record.kind else {
                continue;
            };
            if !groups.iter().any(|group| {
                properties
                    .iter()
                    .map(|p| p.name.public_name().expect("the fixture has public keys"))
                    .eq(*group)
            }) {
                continue;
            }
            let ty = TypeId(u32::try_from(at).unwrap());
            if hierarchy.faces.contains(&ty) {
                faces.push(ty);
            } else if !hierarchy
                .access_families
                .licensed
                .iter()
                .any(|family| family.supplies.iter().any(|supply| supply.owner == ty))
            {
                anonymous.push(ty);
            }
        }
        assert!(
            anonymous.len() >= 2,
            "both inferred callback schemas must be exercised"
        );
        assert!(faces.len() >= 2);
        for anonymous_first in [true, false] {
            let mut probe = super::FuncBuilder::new(&snapshot, foreign);
            probe.hierarchy = &hierarchy;
            probe.closures = closures.clone().into();
            super::wire_naming(&mut probe, &naming);
            let (first, second) = if anonymous_first {
                (&anonymous, &faces)
            } else {
                (&faces, &anonymous)
            };
            for ty in first.iter().chain(second) {
                probe.layout_of(super::NodeId(0), *ty).unwrap();
            }
            for fields in groups {
                let count = probe
                    .layouts
                    .iter()
                    .filter(|layout| {
                        layout
                            .fields
                            .iter()
                            .map(|field| {
                                field
                                    .name
                                    .public_name()
                                    .expect("the fixture has public keys")
                            })
                            .eq(fields)
                    })
                    .count();
                assert_eq!(count, 1, "anonymous first={anonymous_first}: {fields:?}");
            }
        }
    }

    fn layout(name: &str, ty: u32, fields: &[&str]) -> Layout {
        Layout {
            types: vec![TypeId(ty)],
            name: name.to_owned(),
            fields: fields
                .iter()
                .map(|field| Field {
                    name: (*field).to_owned().into(),
                    ty: super::HirType::NUMBER,
                    declared_by: None,
                    readonly: false,
                    written: None,
                })
                .collect(),
            methods: Vec::new(),
            interfaces: Vec::new(),
            base: None,
        }
    }

    /// One type laid out two ways is recorded, and the same type laid out the
    /// same way twice is not.
    ///
    /// **The must-fire arm for a guard whose whole point is a silence.** Two
    /// layouts for one type with the same field *names* in a different *order*
    /// merge into one, and the merge keeps whichever arrived first -- so every
    /// function that indexed the other is wrong by a slot, the struct is the
    /// same size, the offset asserts all hold, and clang says nothing. Without
    /// the record there is no evidence left by the time anything can look.
    ///
    /// The three negative arms are what say the record is about *order*: a
    /// layout reached twice identically is ordinary (`layout_of` is asked from
    /// many places and hands back a clone), a different field *set* is a
    /// different question `same_shape` already decides, and a different *count*
    /// is not a reordering at all.
    #[test]
    fn one_type_laid_out_two_ways_is_recorded() {
        let mut program = Program::default();
        super::collect_layouts(
            &mut program,
            vec![layout("Resolved", 10, &["depth", "colors"])],
        );
        super::collect_layouts(
            &mut program,
            vec![layout("Resolved", 10, &["colors", "depth"])],
        );
        assert_eq!(
            program.disputed_layouts.len(),
            1,
            "a reorder must be recorded"
        );
        let disputed = &program.disputed_layouts[0];
        assert_eq!(disputed.name, "Resolved");
        assert_eq!(
            disputed.kept,
            ["depth", "colors"],
            "the order that arrived first is kept"
        );
        assert_eq!(
            disputed.discarded,
            ["colors", "depth"],
            "and the one some function indexed by"
        );

        // The same layout twice: ordinary, and the commonest case there is.
        let mut program = Program::default();
        super::collect_layouts(&mut program, vec![layout("Same", 11, &["a", "b"])]);
        super::collect_layouts(&mut program, vec![layout("Same", 11, &["a", "b"])]);
        assert!(
            program.disputed_layouts.is_empty(),
            "one order twice is not a dispute"
        );

        // A different field set is `same_shape`'s question, not this one.
        let mut program = Program::default();
        super::collect_layouts(&mut program, vec![layout("Other", 12, &["a", "b"])]);
        super::collect_layouts(&mut program, vec![layout("Other", 12, &["a", "c"])]);
        assert!(
            program.disputed_layouts.is_empty(),
            "a different name is not a reorder"
        );

        // And a different count is not a reordering either.
        let mut program = Program::default();
        super::collect_layouts(&mut program, vec![layout("Wider", 13, &["a", "b"])]);
        super::collect_layouts(&mut program, vec![layout("Wider", 13, &["a", "b", "c"])]);
        assert!(
            program.disputed_layouts.is_empty(),
            "a different width is not a reorder"
        );
    }

    /// `verify` reports what the merge recorded.
    ///
    /// Separate from the test above because they are two failures: the merge
    /// can record and nothing read it, which is the state every silent defect
    /// in this file started from.
    #[test]
    fn a_disputed_layout_is_reported_by_verify() {
        let mut program = Program::default();
        super::collect_layouts(
            &mut program,
            vec![layout("Resolved", 10, &["depth", "colors"])],
        );
        super::collect_layouts(
            &mut program,
            vec![layout("Resolved", 10, &["colors", "depth"])],
        );
        let problems = super::super::verify::verify(&program).expect_err("a dispute is invalid");
        assert!(
            problems.iter().any(|problem| matches!(
                problem,
                super::super::verify::Invalid::DisputedLayout { .. }
            )),
            "expected a DisputedLayout, got {problems:?}",
        );
    }

    /// Two dispatch roots that `hierarchy.name` spells alike get one shell.
    ///
    /// The check for "already declared" read `program.funcs` only, and the
    /// shells this loop makes are held back until it ends -- so two roots of
    /// one name both passed it and both were pushed. `verify` calls that
    /// `DuplicateFunction`, `emit-c` calls it "refusing to emit code from
    /// invalid HIR", and six of the twenty-six node modules emitted **no
    /// output at all** the first time something made two such roots.
    ///
    /// Latent today: nothing in the tree produces two roots of one name. A
    /// latent guard is worth what it costs to write, and this one is a test
    /// rather than a paragraph because the failure it prevents is silent in
    /// the worst way -- the whole module, with a diagnostic naming a function
    /// rather than the pass that duplicated it.
    #[test]
    fn two_roots_of_one_name_declare_one_shell() {
        use super::{Hierarchy, ManagedType};
        use crate::hir::facts::Facts;
        use crate::hir::{Block, Func, Origin, Param, ParamShape, Terminator};
        use nts_diagnostics::{Location, SourceId, Span};

        let here = || {
            Origin::source(Location {
                file: SourceId(0),
                span: Span::new(0, 1),
            })
        };
        let receiver = |ty: u32| super::HirType::Managed(ManagedType::Object(TypeId(ty)));
        let mut hierarchy = Hierarchy::default();
        // Two roots, one name -- the shape a generic instantiation and its
        // declaration make, and the one `implements` inference made in bulk.
        for root in [1_u32, 2] {
            hierarchy.name.insert(TypeId(root), "Sink".to_owned());
            hierarchy
                .declares
                .insert(TypeId(root), vec![MemberKey::named("write")]);
            hierarchy
                .slots
                .insert((TypeId(root), MemberKey::named("write"), false), root - 1);
        }
        // Both roots, in one entry: inserting twice overwrites, and with only
        // the second edge the first root finds no implementer and declares
        // nothing -- so the test passed with the fix sabotaged, which is the
        // hollow arm this file's neighbours keep finding.
        hierarchy
            .implements
            .insert(TypeId(9), vec![TypeId(1), TypeId(2)]);
        // The implementer, whose body both roots would take a shell from.
        let mut program = Program::default();
        program.funcs.push(Func {
            name: "Impl#write".to_owned(),
            params: vec![Param {
                name: "this".to_owned(),
                ty: receiver(9),
                shape: ParamShape::Ordinary,
                origin: here(),
                known: Facts::TOP,
                written: None,
            }],
            return_type: super::HirType::Void,
            values: Vec::new(),
            blocks: vec![Block {
                params: Vec::new(),
                ops: Vec::new(),
                terminator: Terminator::Return(None),
            }],
            origin: here(),
            exported: false,
            initializes_receiver: false,
            abstract_declaration: false,
            async_result: None,
            frame: None,
            obligations: Vec::new(),
            exact: rustc_hash::FxHashMap::default(),
            written_return: None,
            result_absent: crate::hir::Absent::Impossible,
            validation: None,
            written_return_elements: Vec::new(),
        });

        program.layouts.push(crate::hir::Layout {
            types: vec![TypeId(9)],
            name: "Impl".to_owned(),
            fields: Vec::new(),
            methods: vec![Some("Impl#write".to_owned()); 2],
            interfaces: vec![TypeId(1), TypeId(2)],
            base: None,
        });
        let snapshot = nts_semantic_schema::SemanticSnapshot::default();
        let snapshot = super::LoweringSnapshot::new(&snapshot);
        let mut collector = super::LayoutCollector::new(std::mem::take(&mut program.layouts));
        super::declare_interface_methods(
            &mut collector,
            &hierarchy,
            &mut super::FuncBuilder::probe(&snapshot),
            &mut program,
        );
        program.layouts = collector.into_layouts();
        let shells = program
            .funcs
            .iter()
            .filter(|func| func.name == "Sink#write")
            .count();
        assert_eq!(
            shells, 1,
            "two roots of one name must declare one shell, not two"
        );
    }

    /// Two declarations named alike are two layouts named apart, whichever
    /// way the second one arrives.
    ///
    /// The push path suffixed a taken name for a year. The **rename on
    /// merge** -- a declared name beating a generated one -- adopted it
    /// unasked, and that is the order `zlib` produced: `stream/transform.ts`'s
    /// 24-field `TransformOptions` pushed first, an anonymous `{ signal }`
    /// second, and `stream/iter/pull.ts`'s one-field `TransformOptions`
    /// third, merging into the anonymous one by shape and taking a name the
    /// first already held. `verify` reported `DuplicateLayout` and the module
    /// emitted nothing. Both orders below must end with two distinct names.
    #[test]
    fn a_second_declaration_of_one_name_is_named_apart_on_merge_too() {
        // The push order the push path already handled.
        let mut program = Program::default();
        super::collect_layouts(&mut program, vec![layout("Options", 1, &["a", "b", "c"])]);
        super::collect_layouts(&mut program, vec![layout("Options", 7, &["signal"])]);
        let names: Vec<&str> = program.layouts.iter().map(|it| it.name.as_str()).collect();
        assert_eq!(names, ["Options", "Options7"]);

        // The merge order that produced the duplicate: the big declared one,
        // then an anonymous shape, then the small declared one that merges
        // into the anonymous shape and would take its declared name.
        let mut program = Program::default();
        super::collect_layouts(&mut program, vec![layout("Options", 1, &["a", "b", "c"])]);
        super::collect_layouts(&mut program, vec![layout("Type5", 5, &["signal"])]);
        super::collect_layouts(&mut program, vec![layout("Options", 7, &["signal"])]);
        let names: Vec<&str> = program.layouts.iter().map(|it| it.name.as_str()).collect();
        assert_eq!(program.layouts.len(), 2, "the two one-field shapes merge");
        assert_eq!(names, ["Options", "Options5"]);
        assert_eq!(program.layouts[1].types, [TypeId(5), TypeId(7)]);

        // And the control: a declared name still beats a generated one where
        // nothing holds it.
        let mut program = Program::default();
        super::collect_layouts(&mut program, vec![layout("Type5", 5, &["signal"])]);
        super::collect_layouts(&mut program, vec![layout("Options", 7, &["signal"])]);
        assert_eq!(program.layouts.len(), 1);
        assert_eq!(program.layouts[0].name, "Options");
    }

    /// A foreign layout's name is its identity, like the three families beside
    /// it in `nominal_name`.
    ///
    /// **The control is the pair that must still merge.** Two field-less
    /// TypeScript classes *do* merge today -- measured, `class Alpha {}` and
    /// `class Beta {}` produce one layout -- and the JVM emitter repairs that by
    /// subclassing. Nothing here should change it. What must not merge is a
    /// layout standing for a class we did not lay out, because the repair works
    /// by inventing a name and a foreign class's binary name is fixed by its
    /// jar.
    #[test]
    fn a_foreign_layout_name_is_its_identity() {
        assert!(super::is_foreign_name("java/lang/Runnable"));
        assert!(super::is_foreign_name("android/view/View"));
        assert!(super::nominal_name("java/util/Observer"));

        // A TypeScript identifier cannot contain `/`, so no layout of ours is
        // ever mistaken for a foreign one. Without this the rule would stop two
        // ordinary empty classes from merging and cost the subclass repair its
        // whole purpose.
        assert!(!super::is_foreign_name("Alpha"));
        assert!(!super::is_foreign_name("Beta"));
        assert!(!super::nominal_name("Alpha"));
        assert!(!super::nominal_name("Point"));
    }

    use super::{closure_type, parse_bigint, parse_handle_constant, parse_number};

    #[test]
    fn native_pointer_constant_bits_are_lossless_and_bounded() {
        for (text, want) in [
            ("65535", 65535),
            ("+32512", 32512),
            ("0x3", 3),
            ("-0", 0),
            ("-1", u64::MAX),
            ("-0x3", u64::MAX - 2),
            ("9007199254740993", 9_007_199_254_740_993),
            ("0x8000000000000000", 1 << 63),
            ("-9223372036854775808", 1 << 63),
            ("18446744073709551615", u64::MAX),
        ] {
            assert_eq!(parse_handle_constant(text), Some(want), "{text}");
        }
        for text in [
            "",
            "0x",
            "1.5",
            "1e3",
            "NaN",
            "1n",
            "++1",
            "-+1",
            "1_000",
            "18446744073709551616",
            "-9223372036854775809",
        ] {
            assert_eq!(parse_handle_constant(text), None, "{text}");
        }
    }

    #[test]
    fn bigint_literal_and_guard_spellings_are_exact() {
        assert_eq!(
            parse_bigint("9_007_199_254_740_993n"),
            Some(9_007_199_254_740_993)
        );
        assert_eq!(
            parse_bigint("0x10000000000000007n"),
            Some((1_i128 << 64) + 7)
        );
        assert_eq!(parse_bigint("-0b101n"), Some(-5));
        assert_eq!(parse_bigint("0o17n"), Some(15));
        assert_eq!(
            parse_bigint("170141183460469231731687303715884105727"),
            Some(i128::MAX)
        );
        assert_eq!(
            parse_bigint("-170141183460469231731687303715884105728"),
            Some(i128::MIN)
        );
        assert_eq!(
            parse_bigint("170141183460469231731687303715884105728n"),
            None
        );
        assert_eq!(parse_bigint(""), None);
    }

    /// The synthetic id bands do not overlap.
    ///
    /// This is the invariant two comments each asserted and the code broke.
    /// `closure_type` counted **down** from `u32::MAX` — "so it cannot collide
    /// with anything the snapshot assigned", which is true and is not the whole
    /// question — straight into [`super::super::CONSTRUCTOR_TOKENS`], sixteen
    /// ids at `u32::MAX - 15`, whose own comment says it is placed there
    /// *because closures are numbered upward from `SYNTHETIC_CLOSURES`*.
    ///
    /// So a program's fifteenth closure had the id of `Ctor_Error` and its
    /// fourteenth `Ctor_TypeError`, and closures sixteen through thirty-one
    /// landed in [`super::super::PROVIDED_ERRORS`]. `Program::layout` finds a
    /// layout by asking which one holds the id, so it returned whichever it met
    /// first: `runtime/node/async_hooks` emitted a callback as
    /// `&nts_fnval_NtsObj_Ctor_TypeError` for a call whose HIR correctly said
    /// `const closure.static`.
    ///
    /// **Asserted over the partition rather than over a program**, which is why
    /// this is a unit test and not an example. Two backends compile the lie
    /// without complaint — the C only failed because the emitted prototype met
    /// a hand-written header that disagreed — so no differential can see it, and
    /// a program that reproduces it needs sixteen closures *and* a class used as
    /// a value, which is a shape nobody writes on purpose.
    ///
    /// The old assertion checked the *floor* of the closure band, which a
    /// descending counter passes for half a million closures, and never the
    /// ceiling it was walking into. This checks the ceiling.
    #[test]
    fn no_closure_id_lands_in_a_reserved_band() {
        for index in 0..4096usize {
            let id = closure_type(index).0;
            assert!(
                id >= crate::hir::SYNTHETIC_CLOSURES,
                "closure {index} is below the closure floor: {id}",
            );
            assert!(
                id < crate::hir::PROVIDED_ERRORS,
                "closure {index} reaches the provided-error band: {id}",
            );
            assert!(
                id < crate::hir::CONSTRUCTOR_TOKENS,
                "closure {index} reaches the constructor-token band: {id}",
            );
        }
    }

    /// And the two reserved bands do not overlap each other.
    ///
    /// Sixteen apart by construction, and stated here so that widening either
    /// one has to come past a test rather than past a reader.
    #[test]
    fn the_reserved_bands_are_disjoint() {
        // Read through a binding so the comparison is not folded at compile
        // time: `assert!(A < B)` on two constants is a constant, and clippy
        // says so -- correctly, because a test that cannot fail is not one.
        let errors = crate::hir::PROVIDED_ERRORS;
        let tokens = crate::hir::CONSTRUCTOR_TOKENS;
        assert!(errors < tokens, "the bands are ordered");
        assert_eq!(
            tokens - errors,
            16,
            "the provided-error band holds sixteen and ends where the tokens begin",
        );
        assert!(
            crate::hir::builtin::ERRORS.len() <= 16,
            "more provided error classes than either band holds",
        );
    }

    /// Every spelling a JavaScript numeric literal has.
    #[test]
    fn a_literal_parses_as_the_double_it_denotes() {
        assert_eq!(parse_number("0"), Some(0.0));
        assert_eq!(parse_number("1_000_000"), Some(1_000_000.0));
        assert_eq!(parse_number("1e-320"), Some(1e-320));
        assert_eq!(parse_number("0x1f"), Some(31.0));
        assert_eq!(parse_number("0o17"), Some(15.0));
        assert_eq!(parse_number("0b1011"), Some(11.0));
        assert_eq!(parse_number(".5"), Some(0.5));
        assert_eq!(parse_number("1.7976931348623157e308"), Some(f64::MAX));

        // A BigInt is a different type with different arithmetic, and is not
        // this. Saying so beats parsing off the `n` and being quietly wrong.
        assert_eq!(parse_number("1n"), None);
    }

    /// The reason this function exists rather than trusting the checker.
    ///
    /// The pre-switch tsgo returned `1` for this literal: a mantissa of sixteen nines is above
    /// 2^53 and rounds up before the division by a power of ten. The neighbour
    /// below survives, because that mantissa is even. Rust's parser is correctly
    /// rounded and the literal's own text is the authority on what it says.
    #[test]
    fn seventeen_significant_digits_survive() {
        assert_eq!(
            parse_number("0.9999999999999999"),
            Some(0.999_999_999_999_999_9)
        );
        assert_ne!(parse_number("0.9999999999999999"), Some(1.0));
        assert_eq!(
            parse_number("0.9999999999999998"),
            Some(0.999_999_999_999_999_8)
        );
        assert_eq!(
            parse_number("1.9999999999999998"),
            Some(1.999_999_999_999_999_8)
        );
    }
}

mod absence;
mod access;
mod access_families;
mod access_family_flow;
mod access_family_functions;
mod access_family_sites;
mod accessors;
mod arguments;
mod array_construction;
mod array_from;
mod array_methods;
mod array_sort;
mod assertions;
mod assignments;
mod bigint;
mod binding_calls;
mod body_entries;
mod bound_functions;
mod branch_values;
mod buffers;
mod call_expression;
mod callable_fields;
mod capture_discovery;
mod cast_descriptions;
mod claimed_reads;
mod class_members;
mod closure_bodies;
mod closure_calls;
mod closure_context;
mod closure_values;
mod coercion;
mod construct_expressions;
mod construction;
mod date_builtins;
mod destructuring;
mod diagnostics;
mod elision_patterns;
mod equality;
mod exceptions;
mod expression_types;
mod field_initialization;
mod foreign_arguments;
mod foreign_values;
mod function_names;
mod generator_iteration;
mod generic_copies;
mod gobject;
mod hierarchy;
mod host_builtins;
mod implementations;
mod initialization;
mod interfaces;
mod iterable_walks;
mod iteration_callbacks;
mod iterator_calls;
mod iterator_close;
mod json;
mod layout_collection;
mod literal_methods;
mod literals;
mod local_bindings;
mod loop_flow;
mod made_instance;
mod member_layouts;
mod member_origins;
mod method_calls;
mod module_binding_bodies;
mod module_binding_types;
mod module_bindings;
mod module_evaluation;
mod module_exports;
mod module_namespaces;
mod names;
mod native_calls;
mod native_construction;
mod native_memory;
mod native_modules;
mod native_properties;
mod numeric_arguments;
mod numeric_builtins;
mod object_assign;
mod object_builtins;
mod object_layouts;
mod object_literals;
mod operators;
mod optional_chains;
mod parameter_entries;
mod parameters;
mod places;
mod primitive_conversion;
mod printed;
mod project_semantics;
mod promise_reactions;
mod promise_settlement;
mod property_keys;
mod property_presence;
mod provided_errors;
mod raising_calls;
mod raising_copies;
mod raising_reachability;
mod receiver_binding;
mod reference_index;
mod representations;
mod returns;
mod scopes;
mod signature_entries;
mod snapshot_queries;
mod statement_branches;
mod static_builtins;
mod string_builtins;
mod string_positions;
mod structural_copies;
mod suspended_bodies;
mod symbol_builtins;
mod table_methods;
mod thenable_jobs;
mod tuples;
mod type_tests;
mod typed_arrays;
mod typed_signatures;
mod typeof_expression;
mod uniform_inputs;
mod virtual_returns;

#[derive(Clone)]
struct ObjcProperty {
    declaration: NodeId,
    /// A class property, sent to the class.
    is_static: bool,
    getter: String,
    setter: Option<String>,
}

/// The signature one accessor sends with: the receiver first, as
/// `lower_native_method_call` puts a method's `this` -- none for a class
/// property, which is sent to the class -- then the value for a setter, and
/// what it returns.
fn accessor_signature(
    receiver: Option<TypeId>,
    value: Option<TypeId>,
    result: TypeId,
) -> nts_semantic_schema::SignatureRecord {
    let parameter = |name: &str, ty| nts_semantic_schema::ParameterRecord {
        name: name.to_owned(),
        ty,
        optional: false,
        rest: false,
    };
    nts_semantic_schema::SignatureRecord {
        parameters: receiver
            .map(|ty| parameter("this", ty))
            .into_iter()
            .chain(value.map(|ty| parameter("value", ty)))
            .collect(),
        return_type: result,
        type_parameters: Vec::new(),
        is_construct: false,
        type_predicate: None,
        this_type: receiver,
    }
}

/// A member of an Objective-C class a binding declares.
struct ObjcClassMember {
    /// The class's Objective-C name.
    class: String,
    is_static: bool,
}

/// Swift's `throws`: a message's `@ntsThrows` naming no parameter is the
/// `NSError **` Swift leaves out, a slot the program never writes -- answered
/// as the converter of that hidden slot, and no longer a tag on a parameter.
fn split_hidden_throws(
    throws: Option<(String, String)>,
    message: bool,
    signature: &nts_semantic_schema::SignatureRecord,
) -> (Option<(String, String)>, Option<String>) {
    match throws {
        Some((slot, converter))
            if message
                && !signature
                    .parameters
                    .iter()
                    .any(|parameter| parameter.name == slot) =>
        {
            (None, Some(converter))
        }
        throws => (throws, None),
    }
}

/// Swift's `throws`: the `NSError **` a message reports through, which the
/// binding leaves out as Swift does, appended as the slot the compiler
/// supplies and reads after the call.
fn append_error_slot(native: &mut super::native::Function, converter: String) {
    use super::native::{Handle, Pointee, Retention, Role, Type};
    native
        .parameters
        .push(Type::Pointer(Pointee::Pointer(Box::new(Pointee::Opaque(
            Handle::objc("NSError"),
        )))));
    native.roles.push(Role::ErrorSlot { converter });
    // Written through during the call and never kept: an out-parameter.
    native.retention.push(Retention::NotRetained);
}

/// Swift's closures at an Objective-C message: a parameter of a plain function
/// type is a block, as a Swift closure passed to one is, lent for the call and
/// copied by a callee that keeps it. A C function's is a function pointer
/// still, and a `Block<F>` is a block wherever it is written.
fn bridge_blocks(
    native: &mut super::native::Function,
    signature: &nts_semantic_schema::SignatureRecord,
    snapshot: &SemanticSnapshot,
) {
    use super::native::{Pointee, Role, Type};
    // A function, or one that may be `null` -- Swift's optional closure, a
    // block property's `(() => void) | null`.
    let function = |ty: TypeId| {
        let kind = |id: TypeId| snapshot.types.get(id.0 as usize).map(|record| &record.kind);
        match kind(ty) {
            Some(TypeKind::Function(_)) => true,
            Some(TypeKind::Union(members)) => {
                members
                    .iter()
                    .any(|m| matches!(kind(*m), Some(TypeKind::Function(_))))
                    && members
                        .iter()
                        .all(|m| matches!(kind(*m), Some(TypeKind::Function(_) | TypeKind::Null)))
            }
            _ => false,
        }
    };
    let slots: Vec<(usize, Option<usize>)> = native.slots().map(|(at, _, fed)| (at, fed)).collect();
    for (at, fed) in slots {
        let Some(parameter) = fed.and_then(|ts| signature.parameters.get(ts)) else {
            continue;
        };
        let Type::FnPointer(declared) = native.parameters[at].clone() else {
            continue;
        };
        match &mut native.roles[at] {
            role @ Role::Plain if function(parameter.ty) => {
                *role = super::native::block_role(&declared);
            }
            Role::Label { key, inner, .. } if **inner == Role::Plain => {
                let key = key.clone();
                let label = super::native::labels_of(snapshot, parameter.ty)
                    .and_then(|labels| labels.into_iter().find(|(named, _)| *named == key));
                if !label.is_some_and(|(_, ty)| function(ty)) {
                    continue;
                }
                **inner = super::native::block_role(&declared);
            }
            _ => continue,
        }
        native.parameters[at] = Type::Pointer(Pointee::Void);
    }
}

#[cfg(test)]
mod immutable_context_tests;

#[cfg(test)]
mod context_scaling;
