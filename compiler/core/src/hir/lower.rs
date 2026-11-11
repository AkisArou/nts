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
use self::com_class::{ComEntry, register_com_class};
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
use self::foreign_callbacks::{bridge_blocks, lower_conversions};
use self::foreign_results::{append_error_slot, split_hidden_throws};
use self::foreign_values::{StringsBridged, bridge_strings};
use self::generator_iteration::iterator_result_element;
use self::generic_copies::{
    ClassCopy, Copy, class_copies, copies_of, function_copies, generic_classes,
    is_a_generic_declaration, is_an_instantiation, is_generic_function, template_instances,
    uninstantiated,
};
#[cfg(test)]
use self::gobject_class::signals_of_type;
use self::gobject_class::{
    VfuncSlot, gobject_properties, program_superclass, register_gobject_class, template_handlers,
    with_vfunc_slot,
};
use self::gobject_templates::{
    StaticValue, gobject_template, known_handlers, property_fields, static_value, template_reader,
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
use self::objc_class::{
    ObjcConstruct, ObjcEntry, objc_field_properties, objc_state_function, register_objc_class,
};
use self::objc_dispatch::{ObjcProperty, accessor_signature};
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
mod com_class;
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
mod foreign_callbacks;
mod foreign_results;
mod foreign_values;
mod function_names;
mod generator_iteration;
mod generic_copies;
mod gobject;
mod gobject_class;
mod gobject_templates;
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
mod objc_class;
mod objc_dispatch;
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

#[cfg(test)]
mod immutable_context_tests;

#[cfg(test)]
mod context_scaling;
