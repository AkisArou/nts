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
use self::native_modules::{LinkTag, collect_declared_facts};
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
use self::structural_copies::{
    CallContext, Retyped, Structural, calls_in_a_default, calls_in_the_body_of, member_symbols,
    planned_callee, retyped_symbols_of, structural_instantiations, with_const_aliases,
};
use self::suspended_bodies::{
    AsyncResult, abstract_generator_kind, generator_element_type, generator_indices,
    shared_generator_result,
};
use self::table_methods::{table_fill, table_key_within, walks_pairs};
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

/// Resolve possible printer polls only after descriptor selection has seen
/// the actual program. Repeated as the refusal cascade removes callbacks;
/// before suspension and optimization can move or renumber recorded values.
pub(super) fn settle_printer_checks(lowered: &mut Lowered) {
    printed::settle_checks(&mut lowered.program, &mut lowered.arrivals.printer_checks);
}

// Observe actual element clones, so the guard also detects a clone introduced
// at a different builder call site. Production keeps the derived implementation.
/// Which `then` a [`ClosureSource::Job`] calls.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Then {
    /// A class's own method, through the ordinary dispatch: a subclass that
    /// overrides it is the one called.
    Method(TypeId),
    /// The function a binding's `then` names with `@ntsCall`, called with
    /// the thenable as its first argument. The job's node is the function.
    ///
    /// A binding's type -- a Windows Runtime `IAsyncOperation<T>` -- is a
    /// foreign handle, which has no class a run-time test could ask for: two
    /// specialisations are one handle type. So such a job is chosen from the
    /// *checker's* type at the resolve site, statically, and is never a
    /// candidate of the `instanceof` chain.
    Function,
}

/// What resolving a promise with an instance of one class does.
///
/// The specification's promise resolve function reads `then` off the value at
/// run time and, where it is callable, queues `NewPromiseResolveThenableJob`
/// -- which is how `await x` and `return x` and `resolve(x)` all come to call a
/// thenable's `then`. The program is closed, so which classes answer that
/// question is known before anything is lowered. [`thenables`] is the one
/// census of it, and every resolve site reads its answer rather than deriving
/// one.
///
/// **What a site does with a candidate depends on whether it proves the
/// value is one.** A site whose static type is the class or below it resolves
/// only with instances of it, and refuses at compile time where the answer is
/// not a plain [`Self::Job`]. A site that merely *could* receive one -- an
/// erased value, or a class below the static type -- decides when the value
/// arrives, as the specification's own `Get(x, "then")` does. Refusing those
/// would refuse every `await` of an `unknown` in a program that declares one
/// awkward `then` anywhere.
#[derive(Clone, Debug)]
enum Thenable {
    /// Resolved through the job at this closure index.
    Job(usize),
    /// A job exists, and `then` can throw. See [`RAISING_THEN`]: refused where
    /// a site proves it, and where it is merely possible the job runs and a
    /// throw ends the program by name through the uncaught path.
    Raises(usize),
    /// A `then` no job can call, and why: refused where a site proves it, and
    /// where it is merely possible, a named stop (`nts_refused`) if one
    /// arrives.
    Refused(&'static str),
}

/// Why a `then` that can throw is refused where a site proves it reaches one.
///
/// A throw from `then` rejects the promise, so the job must catch it -- and
/// only a plain function has a raising copy to catch a throw through, which
/// is the same line a `try` around a call to such a method is refused at.
const RAISING_THEN: &str = "a thenable whose `then` can throw: the job must reject with what it throws, and a \
                            method has no raising copy to catch it through";

/// The census's two tables: the classes a resolve site tests for at run
/// time, and the binding `then`s it finds from the checker's type.
#[derive(Clone, Debug, Default)]
struct Thenables {
    /// By the class that declares `then`.
    classes: rustc_hash::FxHashMap<TypeId, Thenable>,
    /// By the `@ntsCall` method signature a binding declares `then` with.
    signatures: rustc_hash::FxHashMap<NodeId, Thenable>,
}

/// A resolving function's pair number, as `nts_promise_claim` takes it.
const PAIR: HirType = HirType::Int {
    bits: 32,
    signed: false,
};

/// A promise whose payload this closure does not know.
///
/// **The job and the resolving functions are payload-generic**, one per
/// `then` rather than one per `then` and payload, so they hold the promise as
/// `Promise<unknown>`: the resolve site puts a `Promise<number>` there through
/// an erase and an unerase. Sound because a promise's representation does not
/// vary with its payload -- one `NtsPromise` on every backend. A resolving
/// function settles it at the type it delivers, relabelled back the same way;
/// `check_delivery` held the resolve site's payload to that type, so the
/// reader at the `await` reads what was stored.
fn erased_promise() -> HirType {
    HirType::Managed(ManagedType::Promise(Box::new(HirType::Erased)))
}

/// A thenable job's fields: the thenable, and the promise it resolves.
fn thenable_job_fields(thenable: HirType) -> Vec<Field> {
    vec![
        Field {
            name: ("thenable".to_owned()).into(),
            ty: thenable,
            readonly: true,
            declared_by: None,
            written: None,
        },
        Field {
            name: ("promise".to_owned()).into(),
            ty: erased_promise(),
            readonly: true,
            declared_by: None,
            written: None,
        },
    ]
}

/// A module job's one field: the import's promise.
fn module_job_fields(promise: HirType) -> Vec<Field> {
    vec![Field {
        name: ("promise".to_owned()).into(),
        ty: promise,
        readonly: true,
        declared_by: None,
        written: None,
    }]
}

/// A resolving function's fields: the promise, and which pair it is.
fn resolving_function_fields() -> Vec<Field> {
    vec![
        Field {
            name: ("promise".to_owned()).into(),
            ty: erased_promise(),
            readonly: true,
            declared_by: None,
            written: None,
        },
        Field {
            name: ("pair".to_owned()).into(),
            ty: PAIR,
            readonly: true,
            declared_by: None,
            written: None,
        },
    ]
}

/// Why a reaction inside a generic is refused.
///
/// A reaction is lowered once, from its site's types, and a generic's copies
/// each see the site at different ones -- so a copy's `Promise<T>` would be read
/// by a body built for the declaration's. Making the reaction a variant per copy
/// is what [`ClosureInfo::within`] does for an arrow, and it is not done here yet.
const A_REACTION_IN_A_GENERIC: &str = "a `.then`, `.catch` or `.finally` inside a generic function or class, whose \
                                       copies would each need their own reaction";

/// Every `.then`, `.catch` and `.finally` called on a promise, and the reaction
/// closure each one subscribes: a [`ClosureSource::Reaction`] per site, appended
/// to `closures`.
///
/// **Per site rather than one for the program**, and the JVM is what decides it.
/// A reaction calls its handlers, and a call through a function value dispatches
/// on the *signature's* class -- `invokevirtual` there -- so a field holding a
/// handler is typed at its signature, and the signature is the site's. One
/// program-wide reaction would have to hold every handler as `unknown`, which no
/// backend can call. Typed per site, the source's payload is also read by the
/// reader its type names and the result settled by the helper its payload names,
/// exactly as an `await` of the same promise would.
///
/// A closure for every site the checker types as a promise method, whether or not
/// the site is ever lowered: one that is not costs a `ClosureInfo`, since only a
/// closure some body names is built.
fn reactions(probe: &FuncBuilder, closures: &mut Vec<ClosureInfo>) {
    for at in 0..probe.snapshot.nodes.len() {
        let site = NodeId(u32::try_from(at).unwrap_or(u32::MAX));
        if probe.kind_of(site) != Some(syntax::CALL_EXPRESSION) {
            continue;
        }
        let Some((receiver, method)) = probe
            .children(site)
            .first()
            .and_then(|callee| probe.member_access(*callee))
        else {
            continue;
        };
        if !matches!(method.as_str(), "then" | "catch" | "finally")
            || !matches!(
                probe.type_of(receiver),
                Some(HirType::Managed(ManagedType::Promise(_)))
            )
        {
            continue;
        }
        let generic = std::iter::successors(probe.node(site).parent, |at| probe.node(*at).parent)
            .any(|enclosing| {
                probe
                    .children(enclosing)
                    .into_iter()
                    .any(|child| probe.kind_of(child) == Some(syntax::TYPE_PARAMETER))
            });
        closures.push(ClosureInfo {
            source: ClosureSource::Reaction,
            refusal: generic.then_some(A_REACTION_IN_A_GENERIC),
            ..ClosureInfo::as_written(site)
        });
    }
}

/// What one reaction holds and does, read off its site.
///
/// **One derivation for both sides.** The site that builds the closure and the
/// body that reads it each ask [`FuncBuilder::reaction_shape`], so the fields one
/// writes are the fields the other reads -- the agreement `collect_layouts` would
/// otherwise have to find broken.
#[derive(Clone, Debug)]
struct ReactionShape {
    /// What the promise it subscribes to holds: `T` of the receiver's `Promise<T>`.
    payload: HirType,
    /// What the promise it hands back holds: `U` of the call's `Promise<U>`.
    answer: HirType,
    callbacks: Callbacks,
}

/// Which handlers a reaction calls, by the settlement each one answers.
#[derive(Clone, Debug)]
enum Callbacks {
    /// `.then(onFulfilled, onRejected)`, and `.catch(onRejected)`, which the
    /// specification defines as `.then(undefined, onRejected)`. An absent one
    /// passes the settlement through to the result.
    Then {
        fulfilled: Option<Callback>,
        rejected: Option<Callback>,
    },
    /// `.finally(onFinally)`: called with nothing on either path, and the result
    /// settles as the source did unless it throws -- **two ticks later** than a
    /// `.then` would settle it, because the specification resolves it with
    /// `Promise.resolve(onFinally()).then(() => value)`, a promise.
    Finally(Option<Callback>),
}

/// One handler a reaction holds.
#[derive(Clone, Debug)]
struct Callback {
    /// The argument it was written as.
    argument: NodeId,
    /// What the field holding it is typed as: the handler's signature.
    ty: HirType,
    /// What calling it answers.
    returns: HirType,
}

impl ReactionShape {
    /// The handlers present, in field order, each with its field index.
    fn present(&self) -> Vec<(u32, &'static str, &Callback)> {
        let named = match &self.callbacks {
            Callbacks::Then {
                fulfilled,
                rejected,
            } => {
                vec![
                    ("onFulfilled", fulfilled.as_ref()),
                    ("onRejected", rejected.as_ref()),
                ]
            }
            Callbacks::Finally(finally) => vec![("onFinally", finally.as_ref())],
        };
        named
            .into_iter()
            .filter_map(|(name, callback)| callback.map(|callback| (name, callback)))
            .zip(2..)
            .map(|((name, callback), field)| (field, name, callback))
            .collect()
    }

    /// The field index a handler is held at.
    fn field_of(&self, callback: &Callback) -> u32 {
        self.present()
            .into_iter()
            .find_map(|(field, _, held)| (held.argument == callback.argument).then_some(field))
            .unwrap_or_else(|| unreachable!("a handler of this shape is one of its fields"))
    }

    /// The source, the result, and the handlers present.
    fn fields(&self) -> Vec<Field> {
        let field = |name: &str, ty: HirType| Field {
            name: (name.to_owned()).into(),
            ty,
            readonly: true,
            declared_by: None,
            written: None,
        };
        let mut fields = vec![
            field(
                "source",
                HirType::Managed(ManagedType::Promise(Box::new(self.payload.clone()))),
            ),
            field(
                "result",
                HirType::Managed(ManagedType::Promise(Box::new(self.answer.clone()))),
            ),
        ];
        fields.extend(
            self.present()
                .into_iter()
                .map(|(_, name, callback)| field(name, callback.ty.clone())),
        );
        fields
    }
}

/// Every class a promise can be resolved with through its `then`, and the
/// closures that do it: for each, a [`ClosureSource::Job`] and the
/// [`ClosureSource::Resolving`] pair it hands `then`, appended to `closures`.
///
/// Classes that *declare* `then` only. A subclass that inherits one is an
/// instance of the class that declared it, whose job dispatches -- so it needs
/// no job of its own, and one that overrides `then` declares it.
fn thenables(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    hierarchy: &Hierarchy,
    throwing: &rustc_hash::FxHashSet<u32>,
    closures: &mut Vec<ClosureInfo>,
) -> Thenables {
    let mut found = rustc_hash::FxHashMap::default();
    // Sorted, so one compiler on one input numbers the closures one way.
    let mut classes: Vec<TypeId> = hierarchy
        .name
        .keys()
        .copied()
        .filter(|class| !hierarchy.faces.contains(class))
        .collect();
    classes.sort_unstable_by_key(|class| class.0);
    for class in classes {
        let Some(TypeKind::Object { properties }) = snapshot
            .types
            .get(class.0 as usize)
            .map(|record| &record.kind)
        else {
            continue;
        };
        let Some(then) = properties
            .iter()
            .find(|property| property.name.is_name("then"))
        else {
            continue;
        };
        let answer = match then.kind {
            nts_semantic_schema::MemberKind::Method
                if hierarchy.declares_itself(class, &MemberKey::named("then")) =>
            {
                match then.declaration {
                    Some(method) => {
                        class_thenable(snapshot, probe, class, method, throwing, closures)
                    }
                    None => Thenable::Refused("a thenable whose `then` has no declaration to call"),
                }
            }
            // Inherited: the declaring class's job covers it.
            nts_semantic_schema::MemberKind::Method => continue,
            // **Refused rather than skipped**, because skipping is a wrong
            // answer: the specification calls a `then` whatever kind of member
            // holds it, and a site resolving with one of these would fulfil
            // with the object where node calls it.
            nts_semantic_schema::MemberKind::Accessor(_) => Thenable::Refused(
                "a thenable whose `then` is an accessor, which a job would have to run to find the function it calls",
            ),
            nts_semantic_schema::MemberKind::Field => Thenable::Refused(
                "a thenable whose `then` is a field holding a function, which a job would call through the field rather than a method",
            ),
        };
        found.insert(class, answer);
    }
    let signatures = binding_thenables(snapshot, probe, throwing, closures);
    Thenables {
        classes: found,
        signatures,
    }
}

/// Every `then` a binding declares with `@ntsCall`, by its signature, and
/// the job for the function it names.
///
/// A Windows Runtime async operation is the case this is for: its binding
/// declares `then` on each specialisation, naming a function the binder
/// wrote beside it that subscribes `Completed` -- so `await operation` is the
/// operation itself awaited, as C# awaits it, rather than a second name for
/// it that returns a promise. In source order, so the closures are numbered
/// one way.
fn binding_thenables(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    throwing: &rustc_hash::FxHashSet<u32>,
    closures: &mut Vec<ClosureInfo>,
) -> rustc_hash::FxHashMap<NodeId, Thenable> {
    let mut found = rustc_hash::FxHashMap::default();
    for at in 0..snapshot.nodes.len() {
        let signature = NodeId(u32::try_from(at).unwrap_or(u32::MAX));
        if probe.kind_of(signature) != Some(syntax::METHOD_SIGNATURE)
            || probe.member_name(signature).as_deref() != Some("then")
        {
            continue;
        }
        let Some(name) = probe
            .node(signature)
            .native
            .as_ref()
            .and_then(|native| native.call.clone())
        else {
            continue;
        };
        let mut named = (0..snapshot.nodes.len())
            .map(|at| NodeId(u32::try_from(at).unwrap_or(u32::MAX)))
            .filter(|node| {
                probe.kind_of(*node) == Some(syntax::FUNCTION_DECLARATION)
                    && probe.has_a_body(*node)
                    && probe.declared_name(*node).as_deref() == Some(name.as_str())
            });
        let answer = match (named.next(), named.next()) {
            (Some(function), None) => {
                let callbacks: Vec<NodeId> =
                    parameters_of(probe, function).into_iter().skip(1).collect();
                thenable_job(
                    snapshot,
                    Then::Function,
                    function,
                    &callbacks,
                    throwing,
                    closures,
                )
            }
            (None, _) => Thenable::Refused(
                "a binding's `then` whose @ntsCall names a function this program does not define",
            ),
            (Some(_), Some(_)) => Thenable::Refused(
                "a binding's `then` whose @ntsCall names a function this program defines twice",
            ),
        };
        found.insert(signature, answer);
    }
    found
}

/// The job for one class's `then`, and its resolving functions, or why there
/// can be none.
fn class_thenable(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    class: TypeId,
    method: NodeId,
    throwing: &rustc_hash::FxHashSet<u32>,
    closures: &mut Vec<ClosureInfo>,
) -> Thenable {
    // Each refusal says which gap it is, because they are cleared by different
    // work, and a reader clearing one must not take the sentence for another.
    if named(snapshot, class).is_none() || is_anonymous_shape(snapshot, class) {
        // Literals of one shape share a layout, and `instanceof` is a test of
        // the layout -- so it could not say whose `then` to call.
        return Thenable::Refused(
            "an object literal with a `then` method, whose layout another literal of the same shape can share",
        );
    }
    if !instantiation_suffix(snapshot, class).is_empty() {
        return Thenable::Refused(
            "a thenable generic class: its `then` has a copy per instantiation, and the job is one per declaration",
        );
    }
    let callbacks = parameters_of(probe, method);
    thenable_job(
        snapshot,
        Then::Method(class),
        method,
        &callbacks,
        throwing,
        closures,
    )
}

/// The job that calls `then` -- a method, or a binding's function -- and the
/// resolving functions it hands it, or why there can be none. `parameters`
/// are the callbacks: all of a method's, and a function's after its receiver.
fn thenable_job(
    snapshot: &SemanticSnapshot,
    calls: Then,
    declaration: NodeId,
    parameters: &[NodeId],
    throwing: &rustc_hash::FxHashSet<u32>,
    closures: &mut Vec<ClosureInfo>,
) -> Thenable {
    if is_generic_function(snapshot, declaration) {
        return Thenable::Refused(
            "a thenable whose `then` is generic: a job calls one copy of it, and which copy a generic method needs is \
             chosen at a call site the job does not have",
        );
    }
    // Whether `then` can throw, which a job cannot catch: see `RAISING_THEN`.
    let symbol = snapshot
        .symbols
        .iter()
        .position(|record| record.declarations.contains(&declaration))
        .and_then(|at| u32::try_from(at).ok());
    let raises = symbol.is_some_and(|symbol| throwing.contains(&symbol));
    if parameters.len() > 2 {
        return Thenable::Refused(
            "a thenable whose `then` takes more than the two callbacks a job passes it",
        );
    }
    // Each parameter is the resolving function it will be handed, so each has
    // to be typed as a function: the resolving function's signature is that
    // type's, which is what makes the call `then` makes the call it built.
    let is_function = |parameter: &NodeId| {
        snapshot
            .node_types
            .get(parameter)
            .is_some_and(|ty| signature_key(snapshot, *ty).is_some())
    };
    if !parameters.iter().all(is_function) {
        return Thenable::Refused(
            "a thenable whose `then` takes a callback not typed as a function",
        );
    }
    let job = closures.len();
    let mut next = job + 1;
    let mut resolving = |at: usize| {
        parameters.get(at).map(|_| {
            let index = next;
            next += 1;
            index
        })
    };
    let resolve = resolving(0);
    let reject = resolving(1);
    closures.push(ClosureInfo {
        source: ClosureSource::Job {
            calls,
            resolve,
            reject,
        },
        ..ClosureInfo::as_written(declaration)
    });
    for (parameter, rejects) in parameters.iter().zip([false, true]) {
        closures.push(ClosureInfo {
            source: ClosureSource::Resolving { rejects },
            ..ClosureInfo::as_written(*parameter)
        });
    }
    if raises {
        Thenable::Raises(job)
    } else {
        Thenable::Job(job)
    }
}

/// Which `lib.d.ts` name an `instanceof` names, where it is one this compiler
/// answers without a class. See [`FuncBuilder::instanceof_builtin`].
#[derive(Clone, Copy)]
enum Builtin {
    Array,
    Object,
    Function,
    /// A name nothing a compiled program holds can be an instance of, so the
    /// answer is `false` whatever the operand.
    Never,
}

/// The name of the `n`th closure's class, and of its one method.
/// The function holding a module's top-level statements.
///
/// `#` cannot appear in a TypeScript identifier, which is why the qualified
/// names use it: no program can declare something that collides with this.
pub const MODULE_INIT: &str = "module#init";

/// Every symbol naming a `new Promise` executor's `resolve` or `reject`, and
/// which of the two it is.
///
/// Wanted by [`collect_closures`] rather than by lowering, for the reason
/// [`Capture::settles`] gives: the closure table is built once and cloned, so
/// this has to be known before any body is lowered.
///
/// `Promise.withResolvers` settlers are deliberately **not** here. They are
/// settlers too and a closure capturing one refuses identically, but nothing in
/// the corpus writes that, and a name list that covers a shape no program uses
/// is a claim with no evidence behind it. The refusal names the construct, so
/// the day one appears it says so.
fn settler_symbols(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
) -> rustc_hash::FxHashMap<u32, bool> {
    let mut found = rustc_hash::FxHashMap::default();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind != NodeKind::Syntax(syntax::NEW_EXPRESSION) {
            continue;
        }
        let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
        let children = probe.children(id);
        let Some(callee) = children.first().copied() else {
            continue;
        };
        if probe
            .node(callee)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            != Some("Promise")
        {
            continue;
        }
        // **`arguments_of`, not the remaining children.** `new Promise<number>(
        // (resolve, reject) => ...)` carries its type argument as a child too,
        // so the first thing after the callee is `number` and the arrow is
        // never reached. The first version of this walked raw children, found
        // no executor in any program, and every capture came back `settles:
        // None` -- a silent miss, because a settler that is not marked simply
        // takes the refusal it took before.
        //
        // `lower_new_promise` reads the executor the same way, which is the
        // point: two derivations of "which argument is the executor" would
        // disagree exactly here.
        let arguments = probe.arguments_of(id);
        let Some(executor) = arguments.first().copied() else {
            continue;
        };
        if probe.kind_of(executor) != Some(syntax::ARROW_FUNCTION) {
            continue;
        }
        // Position decides which is which, exactly as `lower_new_promise`
        // decides it: `rejects: at == 1`. One derivation would be better than
        // two, and this is the cheaper half to keep honest -- the two are
        // checked against each other by `a-promise-settler-captured-by-a-closure`
        // answering with the right word.
        let parameters = probe
            .children(executor)
            .into_iter()
            .filter(|child| probe.kind_of(*child) == Some(syntax::PARAMETER));
        for (at, parameter) in parameters.enumerate() {
            let Some(name) = probe
                .children(parameter)
                .into_iter()
                .find(|field| probe.kind_of(*field) == Some(syntax::IDENTIFIER))
            else {
                continue;
            };
            if let Some(symbol) = probe.node(name).symbol {
                found.insert(symbol.0, at == 1);
            }
        }
    }
    found
}

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

/// The C name a host rejects a promise with ([`FuncBuilder::lower_reject_error`]).
pub(crate) const REJECT_ERROR: &str = "nts_promise_reject_error";

/// `nts_promise_reject_error`, in a program declaring a foreign function that
/// answers a promise -- declaring, not calling: a host compiled once for every
/// program (the Chromium lane's adapter) refers to it from every promise
/// member it binds, so every program typed against that surface defines it,
/// and no other program does.
fn lower_reject_error(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    shared: &Shared,
    lowered: &mut Lowered,
    wanted: &mut std::collections::BTreeSet<usize>,
) {
    let Some(site) = declared_promise_function(snapshot) else {
        return;
    };
    let mut builder = shared.builder(
        snapshot,
        NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default),
        Copy::default(),
    );
    match builder.lower_reject_error(site) {
        Ok(func) => lowered.program.funcs.push(func),
        Err(diagnostic) => lowered.diagnostics.push(diagnostic),
    }
    builder.harvest(wanted, &mut lowered.arrivals);
    layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
}

/// A foreign function a program declares -- a function or method signature
/// with a native symbol, or a function a scheme module (`c:`, `nts:dom`)
/// declares -- whose result is a `Promise`.
fn declared_promise_function(snapshot: &SemanticSnapshot) -> Option<NodeId> {
    snapshot.nodes.iter().enumerate().find_map(|(at, node)| {
        let id = NodeId(u32::try_from(at).ok()?);
        // A native symbol names one; and a function a scheme module declares
        // -- `c:later`, `nts:dom` -- is one by its own name.
        let foreign = matches!(
            node.kind,
            NodeKind::Syntax(syntax::FUNCTION_DECLARATION | syntax::METHOD_SIGNATURE)
        ) && (node
            .native
            .as_ref()
            .is_some_and(|native| native.symbol.is_some())
            || nts_semantic_schema::binding::enclosing_module(snapshot, id)
                .is_some_and(|module| module.contains(':')));
        let TypeKind::Function(signature) = snapshot
            .types
            .get(snapshot.node_types.get(&id)?.0 as usize)?
            .kind
        else {
            return None;
        };
        let returned = snapshot.signatures.get(signature.0 as usize)?.return_type;
        (foreign
            && matches!(
                representation(snapshot, returned),
                Some(HirType::Managed(ManagedType::Promise(_)))
            ))
        .then_some(id)
    })
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

/// How a construction writes one property (`Lowerer::constructed_setter`).
enum ConstructedSetter {
    /// A binding's, through the method its `@ntsSet` names.
    Method(String),
    /// A class the program writes, through its state's field.
    Field(Place),
}

/// One property a construction sets: its value, where it was written, and --
/// for one read from a props object passed through -- the test of whether it
/// was given at all.
struct SetProperty {
    name: String,
    value: ValueId,
    node: NodeId,
    present: Option<ValueId>,
    /// What an erased value read from a props object is read back as where
    /// it was given: its type without the `undefined` that optional adds.
    unerase: Option<HirType>,
}

/// What `resolve` or `reject` names inside a `new Promise` executor.
///
/// The executor runs *synchronously* -- `new Promise(f)` calls `f` before it
/// returns -- so its body is lowered at the construction site and these two
/// names are not values at all. A call to one is the settle it stands for.
#[derive(Clone)]
struct Settler {
    /// The promise being constructed, and the payload it settles with.
    result: AsyncResult,
    /// `reject` rather than `resolve`.
    rejects: bool,
}

/// What one slot of a destructured promise capability binds.
///
/// `read` is the value for `promise` and `None` for `resolve` and `reject`,
/// which bind a [`Settler`] instead and have no value at all. A bare
/// `Option<ValueId>` would have said "no binding" and "a binding of nothing"
/// with the same word.
struct CapabilityBinding {
    read: Option<ValueId>,
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
    /// See [`Thenable`].
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

struct ParameterTags {
    /// `@ntsThrows error convert`: the slot parameter and the converter.
    throws: Option<(String, String)>,
    /// `@ntsDefault flags=0 cancellable=null`: what an omitted argument is.
    defaults: Vec<(String, super::native::ParameterDefault)>,
}

/// Something lent to a native call for its duration, given back once the call
/// returns.
#[derive(Debug, Clone)]
enum Lent {
    /// A C string, beside the string it was made from and how it was encoded.
    String {
        string: ValueId,
        pointer: ValueId,
        encoding: super::native::Encoding,
    },
    /// The slot an `@ntsHresult` call writes its result to, read after it:
    /// the call's value, or the field of it an `@ntsHresult out` names.
    Result {
        slot: ValueId,
        written: super::native::Written,
        field: Option<std::sync::Arc<str>>,
    },
    /// Where an `@ntsHresult` call writes a received array's element count,
    /// read with the `Result` after it (`Role::ReceivedCount`).
    Count { slot: ValueId },
    /// A `char **` made from a `string[]`.
    Strings { pointer: ValueId },
    /// A block of `HSTRING`s lent from a `string[]`, one per element.
    HStrings { array: ValueId, block: ValueId },
    /// A block of structs copied from an array of objects for the call
    /// (`Role::Records`), from COM's task allocator: freed after it.
    Block { block: ValueId },
    /// A block of the call's that it fills for `array` (`Role::FilledStrings`,
    /// `Role::FilledRecords`): copied into the array after it, and freed.
    Filled { array: ValueId, block: ValueId },
    /// A `Uint8Array` whose bytes C reads in place: nothing to free, and the
    /// view must outlive the call.
    View { view: ValueId },
    /// A string a C struct's `StringView` field points at: nothing to free,
    /// and the string must outlive the call, which reads only the struct.
    Borrowed { string: ValueId },
    /// A `CHandles` array whose element block C was lent: given back after
    /// the call (`nts_array_unlend`), which is its last use, so the array
    /// outlives C's read of the block. Defensive under today's placement,
    /// which releases a temporary at the end of its statement; necessary once
    /// a release moves to the last read (see the header).
    Array { array: ValueId },
    /// An array of objects asked, element by element, for the interface a
    /// Windows Runtime call takes (`nts_com_query_array`): the block of the
    /// references that made, given back after the call with the array.
    Queried { array: ValueId, block: ValueId },
    /// The compiler's own error slot, for an `@ntsThrows` parameter the caller
    /// left out: read after the call, and a failure reported there thrown.
    Error { slot: ValueId, converter: String },
    /// A closure's context, for a `ScopedClosure`.
    Closure { context: ValueId },
    /// A boxed record whose pointer C reads during the call: the box must
    /// outlive it (`nts_boxed_unlend`), as a view lent in place does.
    Boxed { boxed: ValueId },
    /// A delegate object the call was passed: the *caller's* reference, given
    /// back after the call. That ends the delegate only if the callee kept no
    /// reference of its own. An event's `add_` keeps one, so the delegate
    /// outlives the call and lives until the source lets go (`remove_`, or
    /// the source's own end), and the closure with it. The one reference this
    /// gives back is the one `nts_com_delegate` made, whatever the callee
    /// does.
    Delegate { object: ValueId },
    /// The slot a composable factory wrote its inner object to, released
    /// after the call when it was written: nothing of the program holds it.
    Inner { slot: ValueId },
    /// That inner object, taken from its slot in the call's own block
    /// (`finish_hresult_call`) and released on both paths after it.
    Taken { object: ValueId },
    /// A string, number or boolean boxed for an `IInspectable` parameter
    /// (`Role::Box`): the runtime's reference, given back after the call,
    /// which leaves the box to whatever the callee kept of it.
    Box { object: ValueId },
}

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

    /// The conversions into a native pointer that are not refusals: a boxed
    /// record's storage, `null`, any native pointer to `void *`, and a
    /// record's fields held in an object. `None` for anything else, which
    /// [`Self::coerce_arm`] goes on to convert or refuse.
    fn coerce_to_native_pointer(
        &mut self,
        value: ValueId,
        have: &HirType,
        want: &HirType,
        id: NodeId,
    ) -> Option<Result<ValueId, Diagnostic>> {
        // A boxed record where C takes the struct's pointer: the box's.
        if *have == HirType::Managed(ManagedType::Object(TypeId(super::BOXED_RECORD)))
            && matches!(want, HirType::NativePointer(_))
        {
            let origin = self.origin(id);
            return Some(Ok(self.unbox_record(value, want, &origin)));
        }
        if matches!(want, HirType::NativePointer(_))
            && matches!(self.values[value.0 as usize].kind, OpKind::ConstNull)
        {
            let origin = self.origin(id);
            return Some(Ok(self.push(OpKind::ConstNull, want.clone(), origin)));
        }
        // Any native pointer converts to `void *`, which is what C does at the
        // call and the only pointer conversion it does without being asked. One
        // direction: `void *` back to a typed pointer is where the mistakes
        // live, and it stays refused here. TypeScript refuses it too, since
        // `Ptr<void>` is not assignable to `Ptr<Uint8>` -- this is the
        // second of the two, not the only one.
        //
        // A `Convert` rather than a relabel: the address is unchanged, but the
        // verifier checks call argument types, so the value reaching the call
        // has to *be* of the parameter's type rather than merely share its
        // representation.
        if let (HirType::NativePointer(from), HirType::NativePointer(to)) = (have, want)
            && from.converts_to(to)
        {
            let origin = self.origin(id);
            // A Windows Runtime object as another of its interfaces is a
            // different pointer, which the object answers `QueryInterface`
            // for -- not the address relabelled, which reads the wrong table.
            if let (super::native::Pointee::Opaque(from), super::native::Pointee::Opaque(to)) = (from, to)
                && from.family == super::native::Family::Com
                && to.family == super::native::Family::Com
                && from.tag != to.tag
                // Every Windows Runtime interface begins with `IInspectable`'s
                // table, so any of them is one as it is: the root every
                // interface's chain ends in is a relabel, not a query.
                && to.tag != "IInspectable"
            {
                let Some(iid) = self.hierarchy.com_iids.get(&to.tag).cloned() else {
                    return Some(Err(self.unsupported(id, &format!("a Windows Runtime object as `{}`, an interface no binding asks for by IID", to.tag))));
                };
                let [low, high] = self.iid_arguments(&iid, &origin);
                return Some(Ok(self.runtime_call(
                    "nts_com_query",
                    vec![value, low, high],
                    want.clone(),
                    origin,
                )));
            }
            return Some(Ok(self.push(OpKind::Convert(value), want.clone(), origin)));
        }
        // A record's fields held in an object, where C takes the record by
        // value: `Fields<T>` in a variable.
        if matches!(want, HirType::NativePointer(view) if matches!(view.viewed(), super::native::Pointee::Record(_)))
            && matches!(have, HirType::Managed(ManagedType::Object(_)))
        {
            return Some(self.native_record_from_object(id, value, want.clone()));
        }
        // **`{}` where C takes a record**: a literal that writes no member,
        // which is built as an empty object and erased
        // (blockers/an-empty-object-literal), so it arrives here as no object
        // a field can be read from -- `new CustomEvent("x", {})`, `new
        // Request(url, {})`, an options bag with nothing in it, refused as a
        // managed value (the Chromium lane's
        // lib-dom-an-empty-literal-for-a-dictionary). Copied, every field is
        // the zero it was left out as, so it is the record's zeroed storage.
        // Only the literal: an erased value from anywhere else may hold
        // members, which zeroes would drop.
        if matches!(want, HirType::NativePointer(view) if matches!(view.viewed(), super::native::Pointee::Record(_)))
            && *have == HirType::Erased
            && self.kind_of(id) == Some(syntax::OBJECT_LITERAL_EXPRESSION)
            && self.syntax_children_of(id).is_empty()
        {
            let origin = self.origin(id);
            let storage = self.push(OpKind::NativeLocal { count: 1 }, want.clone(), origin);
            return Some(Ok(storage));
        }
        None
    }

    /// The same again, told whether the merge's **other** arm is the
    /// short-circuit's `undefined`. See [`Self::absence_at_excluding`].
    /// Why these two managed types cannot share a pointer: one keeps its members
    /// as fields at fixed offsets and the other as keys looked up at run time.
    ///
    /// `coerce_arm`'s managed-to-managed branch checks the pairs it was written
    /// for -- two arrays whose elements differ in width, and two structs that
    /// disagree about where a shared field is -- and then hands the pointer back
    /// as an upcast. That is true of those pairs and false of an object wanted
    /// where a `Record<string, V>` is: the pointer arrives as an `NtsMap` and
    /// every keyed read finds nothing.
    ///
    /// The React lane found it, and the symptom depends on where the value lives.
    /// `const mixed = { children: ["a", 1] }` handed to
    /// `describe(props: Record<string, unknown>)` reads **undefined** at module
    /// scope and **segfaults inside a function**, with no diagnostic either way.
    /// An *annotated* literal is built as a table from the start by
    /// `lower_table_literal`, which is why an inline argument -- contextually
    /// typed, so built as what it is wanted as -- never showed it. Their sweep is
    /// the other half of the evidence: all five operations React needs from a
    /// props record (`for...in` with `Object.hasOwn`, `in`, `Object.keys`, a
    /// spread, a keyed read) agree with node on an annotated `Record`, so the
    /// table machinery is sound and this conversion is the whole defect.
    ///
    /// Refused rather than converted, for the reason both arms above give and the
    /// spread path already gives in as many words -- "a spread of something that
    /// is not a table into a table". A conversion is a copy, `===` then answers
    /// differently, and building the table would mean walking the layout's names
    /// into `nts_map_new`/`nts_map_set`, which is `lower_table_literal`'s job and
    /// a feature of its own.
    ///
    /// **And an array beside an object laid out as fields**, for the same reason
    /// one container over: an array keeps its elements in a block behind a
    /// length, so an `NtsArray *` is not a pointer to a struct and the reverse.
    /// It went unrefused and arrived unchanged, and the verifier stopped the
    /// whole program at the store -- `g = [1, 2, 3]` into a module variable
    /// declared `{ length: number }`, whose one slot cannot be specialized as
    /// a parameter's call can, or a tuple whose positions have mixed storage.
    fn crossing_storage(&self, have: &HirType, want: &HirType) -> Option<String> {
        let keyed = |ty: &HirType| {
            matches!(
                ty,
                HirType::Managed(ManagedType::Table(_, _) | ManagedType::Map(_, _))
            )
        };
        let laid_out = |ty: &HirType| matches!(ty, HirType::Managed(ManagedType::Object(_)));
        let array = |ty: &HirType| matches!(ty, HirType::Managed(ManagedType::Array(_)));
        // The article belongs to the phrase, not to the format: a name comes back
        // as ``a `Thing` `` and the nameless cases carry their own, so the
        // sentence reads the same either way.
        let named = |ty: &HirType| match ty {
            HirType::Managed(ManagedType::Object(at))
                if matches!(
                    self.snapshot.types.get(at.0 as usize).map(|t| &t.kind),
                    Some(TypeKind::Tuple(_))
                ) =>
            {
                "a tuple laid out as fields".to_owned()
            }
            HirType::Managed(ManagedType::Object(at)) => self.name_of_type(*at).map_or_else(
                || "an anonymous object type".to_owned(),
                |name| format!("a `{name}`"),
            ),
            HirType::Managed(ManagedType::Array(_)) => "an array".to_owned(),
            _ => "a table".to_owned(),
        };
        if (laid_out(have) && array(want)) || (array(have) && laid_out(want)) {
            let (from, to) = (named(have), named(want));
            return Some(format!(
                "{from} where {to} is wanted -- one keeps its elements in a block behind a \
                 length and the other its members as fields at fixed offsets, so a pointer to \
                 either is not a pointer to the other"
            ));
        }
        if !((laid_out(have) && keyed(want)) || (keyed(have) && laid_out(want))) {
            return None;
        }
        let (from, to) = (named(have), named(want));
        Some(format!(
            "{from} where {to} is wanted -- one keeps its members as fields at fixed offsets \
             and the other as keys looked up at run time, so a pointer to either is not a \
             pointer to the other and every read through it finds nothing"
        ))
    }

    fn coerce_to_parameter(
        &mut self,
        call: NodeId,
        at: usize,
        value: ValueId,
        argument: NodeId,
        argument_ty: Option<TypeId>,
    ) -> Result<ValueId, Diagnostic> {
        let Some(want) = self.parameter_representation(call, at) else {
            return Ok(value);
        };
        // An array of handles lent to C (`CHandles`) crosses as its element
        // block, which C reads as pointers to objects whatever class the
        // program's array is of: a `GtkLabel[]` where `readonly GObject[]` is
        // declared is the same block, and converting it would be a copy.
        // `readonly` is what makes that sound -- nothing writes a `GObject`
        // into the label array through it -- and `Role::Handles` refuses an
        // array whose elements are not handles.
        if let HirType::Managed(ManagedType::Array(element)) = &self.values[value.0 as usize].ty
            && matches!(
                **element,
                HirType::NativePointer(super::native::Pointee::Opaque(_))
            )
            && self.lends_handles(call, at)
        {
            return Ok(value);
        }
        if self.fills_records(call, at) {
            return Ok(value);
        }
        // A tuple position has its own type. Erase it here, before the
        // concrete value disappears, rather than attributing its absence to
        // the tuple object used to read it. Already-erased values keep their tag.
        if want == HirType::Erased && argument_ty.is_some() {
            return self.erase_uniform_argument(value, argument, Some((argument, argument_ty)));
        }
        self.coerce(value, &want, argument)
    }

    /// What the native call being lowered (`omitting_for`, when it is `call`)
    /// wants its written argument `at` as, where the slot decides it: a string
    /// for a string slot (`Role::String`), and the record for one C takes by
    /// value -- which an object literal is built as, and a held object copied
    /// into (`native_record_from_object`).
    fn native_slot(&self, call: NodeId, at: usize) -> Option<HirType> {
        let (target, spelled, lowering) = self.omitting_for.as_ref()?;
        if *lowering != call {
            return None;
        }
        let (slot, role, _) = target
            .slots()
            .find(|(_, _, fed)| *fed == Some(at + spelled))?;
        match role {
            super::native::Role::String(_) => Some(HirType::Managed(ManagedType::String)),
            super::native::Role::Plain
                if matches!(target.parameters[slot], super::native::Type::Record(_)) =>
            {
                Some(target.parameters[slot].representation())
            }
            _ => None,
        }
    }

    /// Whether the call's `at`th parameter is `CHandles`.
    fn lends_handles(&self, call: NodeId, at: usize) -> bool {
        self.parameter_type_id(call, at)
            .is_some_and(|ty| super::native::lends_handles(self.snapshot, ty))
    }

    /// Whether the call's `at`th parameter is an array the callee fills with
    /// records (`FilledArray<T>`). Each struct C writes is copied into a new
    /// object of the array's *own* element type (`copy_filled`), and C writes
    /// while only the program reads: so the array crosses as the program holds
    /// it, with the kinds its own type wrote or none. Converted to the
    /// declared `Copied<T>[]` instead, an inferred `[{ x: 0, y: 0 }]` was
    /// refused for holding records whose fields were not written as C's.
    fn fills_records(&self, call: NodeId, at: usize) -> bool {
        self.parameter_type_id(call, at)
            .is_some_and(|ty| super::native::fills_records(self.snapshot, ty))
    }

    /// How a call's `at`th parameter is represented, from the resolved
    /// signature rather than from the argument.
    ///
    /// **Unless this call was specialised**, in which case the copy's parameter
    /// is what the argument has to match. The declaration still says `Named`
    /// and the copy takes a `Thing`; coercing to the declaration would meet the
    /// prefix check that the copy exists to avoid.
    fn parameter_representation(&self, call: NodeId, at: usize) -> Option<HirType> {
        // **A native slot decides what its argument is, whatever declared the call.**
        // A lib.dom global or member a binding implements is resolved by the
        // checker to lib.dom's declaration, which can be wider than the
        // binding's: `alert(message?: any)`, `fetch(input: RequestInfo | URL)`.
        // Lowered expecting that, a string argument was erased on its way to
        // `nts_dom_Window_fetch_1`'s `StringView` and refused there as "a value
        // that is not a string". The slot the argument feeds is the truth, and
        // the one answer both lowering and coercion read; a value that really
        // is not a string still meets `coerce`'s refusal. A record C takes by
        // value is the same question: `fetch(url, { keepalive: true })` passed
        // lib.dom's `RequestInit` object where `nts_dom_Window_fetch_2` takes
        // the struct -- invalid HIR -- while `window.fetch(...)` compiled (the
        // Chromium lane's lib-dom-bare-global-with-a-dictionary).
        if let Some(slot) = self.native_slot(call, at) {
            return Some(slot);
        }
        if self.parameter_entry_for_call(call).is_some()
            && self.declared_default(call, at).is_some()
        {
            return Some(HirType::Erased);
        }
        // The callee erased an elision pattern nothing annotates, whatever its
        // checker type says; the argument is erased to meet it.
        if self
            .declared_parameter(call, at)
            .is_some_and(|(parameter, _)| elision_patterns::takes_any_iterable(self, parameter))
        {
            return Some(HirType::Erased);
        }
        if let Some(bound) = self
            .calls
            .structural(call)
            .and_then(|(_, retyped)| retyped.get(&u32::try_from(at).unwrap_or(u32::MAX)))
        {
            return Some(bound.clone());
        }
        let ty = self.parameter_type_id(call, at)?;
        // `object` at a call to a native declaration is C's `void *`: any
        // handle converts to it, and a managed value is refused by `coerce`,
        // which is what keeps a TypeScript object's heap address from C.
        //
        // Two conditions, each the one the rest of the compiler already uses,
        // because each was once got wrong here by asking a nearby question:
        //
        // - **Native** is what `lower_call` means by it: a `function` this
        //   program declares and does not define. "No body" alone is not that
        //   -- an interface's method signature has none either, and reading
        //   it as C refused `hook.init(…, resource)` in `async_hooks.emitInit`.
        // - **The C convention** is what `native::Function::from_signature`
        //   maps `object` to `void *` under: no `@ntsAbi`. Under
        //   `@ntsAbi managed` the object itself is passed, which is what
        //   `nts_on_collected(resource, …)` takes.
        let in_c = self
            .snapshot
            .call_targets
            .get(&call)
            .and_then(|target| target.callee)
            .is_some_and(|declaration| {
                let function = self.kind_of(declaration) == Some(syntax::FUNCTION_DECLARATION)
                    && !self.defines(declaration);
                // And a C method a binding declares on a handle, which
                // `native_method` lowers to its C function.
                let method = self.native_method(call).is_some();
                (function || method)
                    && self
                        .node(declaration)
                        .native
                        .as_ref()
                        .and_then(|n| n.abi.as_deref())
                        .is_none()
            });
        if in_c && super::native::is_object_pointer(self.snapshot, ty) {
            return Some(HirType::NativePointer(super::native::Pointee::Void));
        }
        // `CStrings` / `CBytes` / `CHandles`: the argument is the `string[]`,
        // the `Uint8Array` or the `readonly H[]` the markers are intersected
        // with, which the call converts or borrows; the markers have no
        // representation of their own.
        if in_c && let Some(argument) = super::native::native_array_argument(self.snapshot, ty) {
            return Some(argument);
        }
        // An optional C pointer -- `error?: Ptr<GError | null> | null`, an
        // `@ntsThrows` slot -- is the pointer: absent is NULL, as `null` is.
        if in_c
            && let Some(TypeKind::Union(members)) = self
                .snapshot
                .types
                .get(ty.0 as usize)
                .map(|record| &record.kind)
            && members.iter().any(|member| {
                matches!(
                    self.snapshot.types.get(member.0 as usize).map(|r| &r.kind),
                    Some(TypeKind::Undefined)
                )
            })
            && let Some(pointer) = members
                .iter()
                .find_map(|member| match self.represent(*member) {
                    Some(pointer @ HirType::NativePointer(_)) => Some(pointer),
                    _ => None,
                })
        {
            return Some(pointer);
        }
        // **`in_a_slot`, for the same reason the declaration applies it**: a
        // parameter has to have a width because the caller passes it
        // positionally, and the two sides of a call are one calling convention.
        // Without it here, `run(1, value)` inside `request<void>` coerced an
        // erased value to the `Void` the signature's type id still said, and
        // refused as `an erased value where a concrete representation is
        // wanted` -- one derivation of a convention disagreeing with the other.
        self.represent(ty).map(in_a_slot)
    }

    /// `NewPromiseResolveThenableJob`: `x.then(resolve, reject)`, where `x` is
    /// the thenable a promise was resolved with.
    ///
    /// Its fields are the thenable and the promise, which the resolve site
    /// wrote. The resolving functions are made here, when the job runs rather
    /// than when it was queued, because that is where the specification makes
    /// them -- and their pair is the promise's `nts_promise_pair` now, which is
    /// the one after the use that queued this.
    fn lower_thenable_job(
        &mut self,
        index: usize,
        declaration: NodeId,
        calls: Then,
        resolving: [Option<usize>; 2],
    ) -> Result<Func, Diagnostic> {
        let (_, name) = closure_names(index);
        let receiver_ty = HirType::Managed(ManagedType::Object(closure_type(index)));
        let origin = self.origin(declaration);
        let receiver = self.push(OpKind::Param(0), receiver_ty.clone(), origin.clone());
        let params = vec![Param {
            name: "this".to_owned(),
            shape: ParamShape::Ordinary,
            ty: receiver_ty,
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        }];
        let thenable_ty = self.thenable_type(index)?;
        self.layouts
            .push(self.closure_layout(index, thenable_job_fields(thenable_ty.clone())));
        let thenable = self.push(
            OpKind::FieldGet {
                object: receiver,
                field: 0,
            },
            thenable_ty,
            origin.clone(),
        );
        let promise = self.push(
            OpKind::FieldGet {
                object: receiver,
                field: 1,
            },
            erased_promise(),
            origin.clone(),
        );
        let pair = self.runtime_call("nts_promise_pair", vec![promise], PAIR, origin.clone());

        // What `then` is called as, and its parameters' types after the
        // thenable: a method's own, or the named function's after its
        // receiver, which is where the thenable goes.
        let (callee, receiver_param, parameters, returns) = match calls {
            Then::Method(class) => {
                let (parameters, returns) = self.method_signature(declaration)?;
                (
                    self.callee_for(declaration, class, "then")?,
                    None,
                    parameters,
                    returns,
                )
            }
            Then::Function => {
                let function = self
                    .qualified
                    .get(&declaration)
                    .cloned()
                    .or_else(|| self.declared_name(declaration))
                    .ok_or_else(|| {
                        self.unsupported(declaration, "an @ntsCall function with no name")
                    })?;
                let mut types = Vec::new();
                for parameter in parameters_of(self, declaration) {
                    types.push(self.type_of(parameter).ok_or_else(|| {
                        self.unrepresentable(parameter, "an @ntsCall function parameter")
                    })?);
                }
                let returns = self.return_type_of(declaration)?;
                let receiver_param = (!types.is_empty()).then(|| types.remove(0));
                (Callee::Direct(function), receiver_param, types, returns)
            }
        };
        let mut args = vec![match receiver_param {
            Some(ty) => self.coerce(thenable, &ty, declaration)?,
            None => thenable,
        }];
        for (function, parameter) in resolving.into_iter().flatten().zip(&parameters) {
            let object = self.resolving_function(function, promise, pair, &origin);
            args.push(self.coerce(object, parameter, declaration)?);
        }
        for ty in parameters.iter().chain([&returns]) {
            self.materialize(declaration, ty)?;
        }
        // For a method, the ordinary dispatch, so a subclass that overrides
        // `then` is the one called: the job is per declaring class, and the
        // value may be below it.
        self.push(
            OpKind::Call {
                callee,
                args,
                frame: None,
            },
            returns,
            origin.clone(),
        );
        self.terminate(Terminator::Return(None));
        Ok(self.finish(name, params, HirType::Void, origin, false))
    }

    /// What a job holds its thenable as: an instance of the class whose
    /// `then` it calls, or what the named function takes as its receiver.
    /// Both sides of the job's layout ask this, so they agree by construction.
    fn thenable_type(&self, job: usize) -> Result<HirType, Diagnostic> {
        let info = &self.closures[job];
        match info.source {
            ClosureSource::Job {
                calls: Then::Method(class),
                ..
            } => Ok(HirType::Managed(ManagedType::Object(class))),
            ClosureSource::Job {
                calls: Then::Function,
                ..
            } => parameters_of(self, info.node)
                .first()
                .and_then(|receiver| self.type_of(*receiver))
                .ok_or_else(|| {
                    self.unsupported(
                        info.node,
                        "an @ntsCall `then` function that takes no receiver",
                    )
                }),
            _ => Err(self.unsupported(info.node, "a thenable job that is not one")),
        }
    }

    /// One of a promise's resolving functions, as a value: the closure a job
    /// hands `then`.
    fn resolving_function(
        &mut self,
        index: usize,
        promise: ValueId,
        pair: ValueId,
        origin: &Origin,
    ) -> ValueId {
        let object = self.push(
            OpKind::ObjectNew { frame: false },
            HirType::Managed(ManagedType::Object(closure_type(index))),
            origin.clone(),
        );
        self.field_set(object, 0, promise, origin);
        self.field_set(object, 1, pair, origin);
        self.layouts
            .push(self.closure_layout(index, resolving_function_fields()));
        self.used_closures.push(index);
        object
    }

    /// A resolving function's body: if its pair is unspent, resolve the promise
    /// with what it was called with, or reject it.
    ///
    /// Its signature is the `then` parameter's function type, exactly: `then`
    /// calls it as that type says, directly once specialisation has seen it and
    /// through the closure slot otherwise, and a body built from its own
    /// opinion of the signature would be called with somebody else's. So the
    /// parameters are the type's, the first is the value, and it returns what
    /// the type returns -- `undefined` of it.
    ///
    /// Resolving is `settle`, the one resolve procedure, recursively: a
    /// thenable handed to `onFulfilled` is resolved through its own job, as the
    /// specification does.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn lower_resolving_function(
        &mut self,
        index: usize,
        parameter: NodeId,
        rejects: bool,
    ) -> Result<Func, Diagnostic> {
        let (_, name) = closure_names(index);
        let receiver_ty = HirType::Managed(ManagedType::Object(closure_type(index)));
        let origin = self.origin(parameter);
        let receiver = self.push(OpKind::Param(0), receiver_ty.clone(), origin.clone());
        let mut params = vec![Param {
            name: "this".to_owned(),
            shape: ParamShape::Ordinary,
            ty: receiver_ty,
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        }];
        self.layouts
            .push(self.closure_layout(index, resolving_function_fields()));
        let function = self.snapshot.node_types.get(&parameter).copied();
        let Some((arguments, returned)) = function.and_then(|ty| signature_key(self.snapshot, ty))
        else {
            return Err(
                self.unsupported(parameter, "a thenable's callback not typed as a function")
            );
        };
        let mut values = Vec::new();
        for (at, argument) in arguments.iter().enumerate() {
            // As `lower_param` types a parameter, so the call `then` makes and
            // this signature agree: a `void` one is erased, see `in_a_slot`.
            let ty = self.represent(*argument).map(in_a_slot).ok_or_else(|| {
                self.unrepresentable(parameter, "a thenable callback's parameter")
            })?;
            self.materialize(parameter, &ty)?;
            let position = u32::try_from(at + 1).unwrap_or(u32::MAX);
            values.push(self.push(OpKind::Param(position), ty.clone(), origin.clone()));
            params.push(Param {
                name: if at == 0 {
                    if rejects { "reason" } else { "value" }.to_owned()
                } else {
                    format!("unused{at}")
                },
                shape: ParamShape::Ordinary,
                ty,
                origin: origin.clone(),
                known: Facts::TOP,
                written: None,
            });
        }
        let returns = self
            .represent(returned)
            .ok_or_else(|| self.unrepresentable(parameter, "a thenable callback's result"))?;
        let answers = match returns {
            HirType::Void => false,
            HirType::Erased => true,
            _ => {
                return Err(self.unsupported(
                    parameter,
                    "a thenable's callback declared to return something other than `void` or `unknown`, which \
                     a resolving function has no value of",
                ));
            }
        };

        let promise = self.push(
            OpKind::FieldGet {
                object: receiver,
                field: 0,
            },
            erased_promise(),
            origin.clone(),
        );
        let pair = self.push(
            OpKind::FieldGet {
                object: receiver,
                field: 1,
            },
            PAIR,
            origin.clone(),
        );
        let live = self.runtime_call(
            "nts_promise_claim",
            vec![promise, pair],
            HirType::Bool,
            origin.clone(),
        );
        let settles = self.new_block();
        let join = self.new_block();
        self.terminate(Terminator::Branch {
            cond: live,
            then_target: settles,
            then_args: Vec::new(),
            else_target: join,
            else_args: Vec::new(),
        });
        self.switch_to(settles);
        let value = values.first().copied();
        if rejects {
            self.reject_with(parameter, promise, value)?;
        } else {
            // **At what `then` delivers**: this function's own parameter type,
            // which `check_delivery` held the promise's payload to at the
            // resolve site. So the promise is settled as a promise of that
            // type is -- a counted handle boxed, a number as a number -- and
            // the reader at the `await`, chosen from the same type, reads it.
            // Settling through the tag instead would store a handle as an
            // erased handle where that reader expects the box.
            //
            // **Except a thenable delivered**, which is resolved in turn
            // through its own job: what finally arrives is decided by *its*
            // `then`, not by this parameter's type, so the promise is held
            // erased and the reader asks the tag -- the same step aside
            // `check_delivery` makes.
            let delivered = value.map_or(HirType::Void, |value| {
                self.values[value.0 as usize].ty.clone()
            });
            let payload = if self.thenable_candidates(&delivered).is_empty() {
                delivered
            } else {
                HirType::Erased
            };
            // A promise is never absent.
            let erased = self.erased(promise, Absent::Impossible, &origin);
            let promise = self.push(
                OpKind::unerase(erased),
                HirType::Managed(ManagedType::Promise(Box::new(payload.clone()))),
                origin.clone(),
            );
            self.settle(
                parameter,
                &AsyncResult {
                    promise,
                    payload,
                    written: None,
                },
                value,
            )?;
        }
        self.terminate(Terminator::Jump {
            target: join,
            args: Vec::new(),
        });
        self.switch_to(join);
        let answer =
            answers.then(|| self.push(OpKind::ConstUndefined, HirType::Erased, origin.clone()));
        self.terminate(Terminator::Return(answer));
        Ok(self.finish(name, params, returns, origin, false))
    }

    /// What the reaction at `site` holds and calls, or why there can be none.
    ///
    /// Asked by the site and by the body: see [`ReactionShape`]. Everything here is
    /// read from the checker's types rather than from values, which is what lets
    /// two builders that share no values agree -- and why a generic's site, whose
    /// types the copy substitutes, is refused before this is asked.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn reaction_shape(&self, site: NodeId) -> Result<ReactionShape, Diagnostic> {
        let Some((receiver, method)) = self
            .children(site)
            .first()
            .and_then(|callee| self.member_access(*callee))
        else {
            return Err(self.unsupported(site, "a promise reaction whose method is not named"));
        };
        let Some(HirType::Managed(ManagedType::Promise(payload))) = self.type_of(receiver) else {
            return Err(self.unrepresentable(receiver, "the promise a reaction subscribes to"));
        };
        let Some(HirType::Managed(ManagedType::Promise(answer))) = self.type_of(site) else {
            return Err(self.unrepresentable(site, "the promise a reaction hands back"));
        };
        // A counted handle is boxed in its promise, and an `await` unboxes it
        // (`suspend::read_settled`); a reaction reading one would need the same
        // step a second time, and passing it through needs it a third.
        if matches!(*payload, HirType::NativePointer(_))
            || matches!(*answer, HirType::NativePointer(_))
        {
            return Err(self.unsupported(
                site,
                "a promise reaction over a native handle, which its promise holds boxed",
            ));
        }
        let arguments = self.arguments_of(site);
        let callback = |at: usize| -> Result<Option<Callback>, Diagnostic> {
            let Some(&argument) = arguments.get(at) else {
                return Ok(None);
            };
            let checker = self.snapshot.node_types.get(&argument).copied();
            // **Absent by the checker's type, not by the spelling.** `undefined` is a
            // name a scope can rebind, and the site and the body see different
            // scopes -- so a test of the text could give the two different field
            // lists. The type is one answer for both.
            if checker.is_some_and(|ty| {
                matches!(
                    self.snapshot
                        .types
                        .get(ty.0 as usize)
                        .map(|record| &record.kind),
                    Some(TypeKind::Undefined | TypeKind::Null)
                )
            }) {
                return Ok(None);
            }
            let Some((_, returned)) = checker.and_then(|ty| signature_key(self.snapshot, ty))
            else {
                return Err(self.unsupported(
                    argument,
                    "a promise reaction's handler that is not one function type: one that may be absent is \
                     tested where the reaction runs, which this compiler does not do yet",
                ));
            };
            let ty = self
                .type_of(argument)
                .ok_or_else(|| self.unrepresentable(argument, "a promise reaction's handler"))?;
            let returns = self.represent(returned).ok_or_else(|| {
                self.unrepresentable(argument, "what a promise reaction's handler returns")
            })?;
            Ok(Some(Callback {
                argument,
                ty,
                returns,
            }))
        };
        let (callbacks, takes) = match method.as_str() {
            "then" => (
                Callbacks::Then {
                    fulfilled: callback(0)?,
                    rejected: callback(1)?,
                },
                2,
            ),
            "catch" => (
                Callbacks::Then {
                    fulfilled: None,
                    rejected: callback(0)?,
                },
                1,
            ),
            _ => {
                let finally = callback(0)?;
                // `onFinally`'s answer is waited for when it is a promise or a
                // thenable, and the result then settles after it does. A reaction
                // that discards it would settle a tick early, and one that rejects
                // would be lost -- so an answer that can be either is refused.
                if let Some(callback) = &finally
                    && (matches!(
                        callback.returns,
                        HirType::Managed(ManagedType::Promise(_)) | HirType::Erased
                    ) || !self.thenable_candidates(&callback.returns).is_empty())
                {
                    return Err(self.unsupported(
                        callback.argument,
                        "a `finally` callback that can return a promise, whose settlement the result would have \
                         to wait for",
                    ));
                }
                (Callbacks::Finally(finally), 1)
            }
        };
        if arguments.len() > takes {
            return Err(self.unsupported(
                site,
                "a promise reaction given more arguments than it takes",
            ));
        }
        Ok(ReactionShape {
            payload: *payload,
            answer: *answer,
            callbacks,
        })
    }

    /// `.then`, `.catch` and `.finally` on a promise, where the census found the
    /// site; `None` for any other call.
    fn promise_reaction(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        held: &HirType,
    ) -> Option<Result<ValueId, Diagnostic>> {
        if !matches!(held, HirType::Managed(ManagedType::Promise(_))) {
            return None;
        }
        let index = self
            .closures
            .iter()
            .position(|closure| closure.source == ClosureSource::Reaction && closure.node == id)?;
        Some(self.subscribe_a_reaction(id, index, receiver))
    }

    /// `p.then(f, g)`, `p.catch(g)` and `p.finally(f)`: a result promise, and the
    /// reaction that settles it subscribed to `p`.
    ///
    /// The handlers are evaluated here, in order, as any call's arguments are; the
    /// reaction holds them and calls them later. Subscribing is what marks `p`
    /// handled, which the specification's `PerformPromiseThen` does too -- so a
    /// rejection is reported unhandled only if the *result* goes unhandled, and the
    /// result carries it onward because an absent handler passes it through.
    fn subscribe_a_reaction(
        &mut self,
        site: NodeId,
        index: usize,
        receiver: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        if let Some(reason) = self.closures[index].refusal {
            return Err(self.unsupported(site, reason));
        }
        let shape = self.reaction_shape(site)?;
        let Some(slot) = self.hierarchy.closure_slot else {
            return Err(
                self.unsupported(site, "a promise reaction in a program with no closure slot")
            );
        };
        let origin = self.origin(site);
        let fields = shape.fields();
        for field in &fields {
            self.materialize(site, &field.ty)?;
        }
        let mut handlers = Vec::new();
        for (_, _, callback) in shape.present() {
            let value = self.lower_expression(callback.argument)?;
            handlers.push(self.coerce(value, &callback.ty, callback.argument)?);
        }
        let source = self.coerce(receiver, &fields[0].ty, site)?;
        let result = self.runtime_call(
            "nts_promise_new",
            Vec::new(),
            fields[1].ty.clone(),
            origin.clone(),
        );
        let reaction = self.push(
            OpKind::ObjectNew { frame: false },
            HirType::Managed(ManagedType::Object(closure_type(index))),
            origin.clone(),
        );
        for (field, value) in [source, result].into_iter().chain(handlers).enumerate() {
            self.field_set(
                reaction,
                u32::try_from(field).unwrap_or(u32::MAX),
                value,
                &origin,
            );
        }
        self.layouts.push(self.closure_layout(index, fields));
        self.used_closures.push(index);
        self.push(
            OpKind::PromiseSubscribe {
                promise: source,
                reaction,
                slot,
            },
            HirType::Void,
            origin,
        );
        Ok(result)
    }

    /// A reaction's body: the specification's `NewPromiseReactionJob`, for whichever
    /// way the source settled.
    ///
    /// ```text
    /// rejected = nts_promise_is_rejected(source)
    /// fulfilled:  onFulfilled ? settle(result, onFulfilled(value))  : settle(result, value)
    /// rejected:   onRejected  ? settle(result, onRejected(reason))  : reject result as source was
    /// finally:    onFinally(); nts_promise_adopt(result, source)
    /// ```
    ///
    /// **`finally` adopts rather than passing through**, and the difference is two
    /// ticks. Its specification is `p.then(v => Promise.resolve(onFinally()).then(()
    /// => v))`: the result is resolved with a promise, which costs the
    /// `NewPromiseResolveThenableJob` and the reaction behind it. Node, measured: a
    /// `.then`'s result settles after two ticks of a counting chain and a
    /// `.finally`'s after four. `nts_promise_adopt` of a promise that has already
    /// settled is exactly those two hops, on both paths, so the source is adopted
    /// whole and nothing branches on how it settled. The first version passed the
    /// settlement through as `.then` does and was two ticks early -- which the
    /// blocker this replaced (`a-promise-method-call`) had measured and said, and
    /// which `finallyTicks` in `tests/programs/promise-reactions` now pins.
    ///
    /// A handler's `throw` rejects the result, through the raising entry; see
    /// [`Self::call_a_reaction_handler`]. Settling is [`Self::settle`], the one
    /// resolve procedure, so a handler returning a promise is adopted and one
    /// returning a thenable runs its job -- the two ticks node takes for it.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn lower_reaction(&mut self, index: usize, info: &ClosureInfo) -> Result<Func, Diagnostic> {
        let site = info.node;
        if let Some(reason) = info.refusal {
            return Err(self.unsupported(site, reason));
        }
        let shape = self.reaction_shape(site)?;
        let (_, name) = closure_names(index);
        let receiver_ty = HirType::Managed(ManagedType::Object(closure_type(index)));
        let origin = self.origin(site);
        let receiver = self.push(OpKind::Param(0), receiver_ty.clone(), origin.clone());
        let params = vec![Param {
            name: "this".to_owned(),
            shape: ParamShape::Ordinary,
            ty: receiver_ty,
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        }];
        let fields = shape.fields();
        for field in &fields {
            self.materialize(site, &field.ty)?;
        }
        let source = self.push(
            OpKind::FieldGet {
                object: receiver,
                field: 0,
            },
            fields[0].ty.clone(),
            origin.clone(),
        );
        let promise = self.push(
            OpKind::FieldGet {
                object: receiver,
                field: 1,
            },
            fields[1].ty.clone(),
            origin.clone(),
        );
        let result = AsyncResult {
            promise,
            payload: shape.answer.clone(),
            written: None,
        };
        self.layouts.push(self.closure_layout(index, fields));

        let (fulfilled, rejected) = match &shape.callbacks {
            Callbacks::Then {
                fulfilled,
                rejected,
            } => (fulfilled.as_ref(), rejected.as_ref()),
            Callbacks::Finally(finally) => {
                let join = self.new_block();
                if let Some(finally) = finally {
                    self.call_a_reaction_handler(
                        site, receiver, &shape, finally, None, promise, join,
                    )?;
                }
                self.runtime_call(
                    "nts_promise_adopt",
                    vec![promise, source],
                    HirType::Void,
                    origin.clone(),
                );
                self.terminate(Terminator::Jump {
                    target: join,
                    args: Vec::new(),
                });
                self.switch_to(join);
                self.terminate(Terminator::Return(None));
                return Ok(self.finish(name, params, HirType::Void, origin, false));
            }
        };
        let is_rejected = self.runtime_call(
            "nts_promise_is_rejected",
            vec![source],
            HirType::Bool,
            origin.clone(),
        );
        let on_fulfilment = self.new_block();
        let on_rejection = self.new_block();
        let join = self.new_block();
        self.terminate(Terminator::Branch {
            cond: is_rejected,
            then_target: on_rejection,
            then_args: Vec::new(),
            else_target: on_fulfilment,
            else_args: Vec::new(),
        });

        for (block, rejects, callback) in [
            (on_fulfilment, false, fulfilled),
            (on_rejection, true, rejected),
        ] {
            self.switch_to(block);
            // What the handler is called with, or what passes through without one.
            let settled = if rejects {
                callback.map(|_| {
                    self.runtime_call(
                        "nts_promise_reason",
                        vec![source],
                        HirType::Erased,
                        origin.clone(),
                    )
                })
            } else {
                self.read_fulfilment(source, &shape.payload, &origin)
            };
            match callback {
                Some(callback) => {
                    let answer = self.call_a_reaction_handler(
                        site, receiver, &shape, callback, settled, promise, join,
                    )?;
                    self.settle(site, &result, answer)?;
                }
                None if rejects => {
                    self.runtime_call(
                        "nts_promise_reject_with",
                        vec![promise, source],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                None => {
                    self.settle(site, &result, settled)?;
                }
            }
            self.terminate(Terminator::Jump {
                target: join,
                args: Vec::new(),
            });
        }
        self.switch_to(join);
        self.terminate(Terminator::Return(None));
        Ok(self.finish(name, params, HirType::Void, origin, false))
    }

    /// What a fulfilled promise holds, read at its payload's type: the reader an
    /// `await` of it calls, from [`super::suspend::settled_reader`]. `None` for a
    /// promise that holds nothing.
    ///
    /// **And for a `Promise<never>`**, which is what `Promise.reject(e)` is typed:
    /// it is never fulfilled, so there is nothing to read, and reading a `never`
    /// to hand a handler refused the reaction -- `twice` in
    /// `tests/programs/promise-reactions`. Its handler is called with `undefined`, which
    /// is what it would see if the type were wrong and it ran.
    fn read_fulfilment(
        &mut self,
        source: ValueId,
        payload: &HirType,
        origin: &Origin,
    ) -> Option<ValueId> {
        if *payload == HirType::Never {
            return None;
        }
        let reader = super::suspend::settled_reader(payload)?;
        let storage = super::suspend::settled_storage(payload);
        let value = self.runtime_call(reader, vec![source], storage.clone(), origin.clone());
        Some(if storage == *payload {
            value
        } else {
            self.push(OpKind::unerase(value), payload.clone(), origin.clone())
        })
    }

    /// Call one of a reaction's handlers with `argument`, and answer what it
    /// returned -- `None` where that is nothing a promise settles with.
    ///
    /// **Through the raising entry where the program has one**, because a handler's
    /// `throw` rejects the result: that is the whole of how `.catch` at the end of a
    /// chain sees a throw from its middle. The call is guarded the way `lower_try`
    /// guards one, with a handler frame whose block rejects `result` and goes to
    /// `join`, so the flag test sits immediately after the call and before anything
    /// reads the answer.
    ///
    /// Where the program has no raising entry (`Hierarchy::closures_carry` is
    /// false) the call takes the ordinary one, and a `throw` ends the program by
    /// name through the uncaught path -- the trade [`Thenable::Raises`] makes for a
    /// job's `then`, for the same reason: the alternative is refusing every
    /// reaction in a program because one closure somewhere cannot carry a raise.
    #[allow(clippy::too_many_arguments)]
    fn call_a_reaction_handler(
        &mut self,
        site: NodeId,
        reaction: ValueId,
        shape: &ReactionShape,
        callback: &Callback,
        argument: Option<ValueId>,
        result: ValueId,
        join: BlockId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        let origin = self.origin(site);
        let handler = self.push(
            OpKind::FieldGet {
                object: reaction,
                field: shape.field_of(callback),
            },
            callback.ty.clone(),
            origin.clone(),
        );
        let catches = self.hierarchy.closures_carry && self.hierarchy.raising_call_slot.is_some();
        let slot = if catches {
            self.hierarchy.raising_call_slot
        } else {
            self.hierarchy.erased_call_slot
        };
        let Some(slot) = slot else {
            return Err(
                self.unsupported(site, "a promise reaction in a program with no closure slot")
            );
        };
        let args = std::iter::once(handler).chain(argument).collect();
        let callee = ClosureEntry(slot);
        let answered = if catches {
            let entry = self.bindings.clone();
            self.exits.push(Exit::Handler(Handler {
                block: None,
                edges: Vec::new(),
                rejections: Vec::new(),
            }));
            let answered = self.call_a_closure_entry(site, callee, None, args, &HirType::Erased);
            if answered.is_ok() {
                self.emit_the_raise_test(&origin);
            }
            let Some(Exit::Handler(frame)) = self.exits.pop() else {
                unreachable!("pushed immediately above")
            };
            let answered = answered?;
            if let Some(caught) = frame.block {
                let carry_on = self.current;
                let thrown = self.open_handler(caught, &frame, &entry, &origin);
                self.switch_to(caught);
                self.reject_with(site, result, Some(thrown))?;
                self.terminate(Terminator::Jump {
                    target: join,
                    args: Vec::new(),
                });
                self.switch_to(carry_on);
            }
            answered
        } else {
            self.call_a_closure_entry(site, callee, None, args, &HirType::Erased)?
        };
        // Read back at what the handler's signature returns, after the test: the
        // inverse of the erased ABI this call asked for, as `call_a_closure_entry`
        // argues for its own read-back.
        Ok(match &callback.returns {
            HirType::Void | HirType::Never => None,
            HirType::Erased => Some(answered),
            returns => Some(self.push(OpKind::unerase(answered), returns.clone(), origin)),
        })
    }

    /// The type of the promise a captured settler settles.
    ///
    /// Read from the `new Promise` the parameter belongs to, by walking up from
    /// the name to the `NewExpression` and taking the checker's type for it.
    /// The allocating side put that promise in the field; this is the same type
    /// arrived at from the declaration rather than from a value, because the
    /// body's builder has no value in hand.
    fn settler_promise_type(&self, name: NodeId) -> Option<HirType> {
        // Bounded at 64 like every other parent walk here, and not at 8: the
        // read is inside a *nested* closure, so the chain to the
        // `NewExpression` runs call -> if -> block -> arrow -> declaration ->
        // block -> arrow -> new, and a program with one more `if` around it is
        // longer still. Eight hops missed the shape this exists for.
        let mut at = self.node(name).parent;
        for _ in 0..64 {
            let here = at?;
            if self.kind_of(here) == Some(syntax::NEW_EXPRESSION) {
                let ty = self.type_of(here)?;
                return matches!(ty, HirType::Managed(ManagedType::Promise(_))).then_some(ty);
            }
            at = self.node(here).parent;
        }
        None
    }

    /// A counted handle in the box a promise holds it in
    /// ([`super::native::handle_box`]): stored as the family's root, whose
    /// release the box's descriptor calls when the box dies.
    fn box_handle(
        &mut self,
        id: NodeId,
        value: ValueId,
        pointee: &super::native::Pointee,
    ) -> Result<(ValueId, TypeId), Diagnostic> {
        let origin = self.origin(id);
        let boxed = self.boxed(value, pointee, &origin).ok_or_else(|| {
            self.unsupported(
                id,
                "a promise settling with a counted handle of a family with no box",
            )
        })?;
        let HirType::Managed(ManagedType::Object(ty)) = self.values[boxed.0 as usize].ty else {
            return Err(self.unsupported(id, "a handle box that is not an object"));
        };
        Ok((boxed, ty))
    }

    /// The box of a handle's family: its type, with its layout recorded, and
    /// the family's root the box's one field is typed as.
    fn handle_box_layout(
        &mut self,
        pointee: &super::native::Pointee,
    ) -> Option<(TypeId, super::native::Pointee)> {
        let (ty, root, name) = pointee.family().and_then(super::native::handle_box)?;
        if !self.layouts.iter().any(|layout| layout.types.contains(&ty)) {
            self.layouts.push(Layout {
                types: vec![ty],
                name: name.to_owned(),
                interfaces: Vec::new(),
                fields: vec![Field {
                    name: ("handle".to_owned()).into(),
                    ty: HirType::NativePointer(root.clone()),
                    readonly: true,
                    declared_by: None,
                    written: None,
                }],
                methods: vec![None; self.hierarchy.table_size()],
                base: None,
            });
        }
        Some((ty, root))
    }

    /// The return type a function or method declaration declares, as the
    /// checker's type.
    fn declared_result_type(&self, declaration: NodeId) -> Option<TypeId> {
        if let Some((body, contract)) = self.selected_result
            && body == declaration
        {
            return self
                .snapshot
                .signatures
                .get(contract.resolved.0 as usize)
                .map(|s| s.return_type);
        }
        let ty = std::iter::once(declaration)
            .chain(self.children(declaration))
            .find_map(|node| self.snapshot.node_types.get(&node).copied())?;
        match self.snapshot.types.get(ty.0 as usize).map(|t| &t.kind) {
            Some(TypeKind::Function(signature)) => {
                Some(self.snapshot.signatures[signature.0 as usize].return_type)
            }
            _ => None,
        }
    }

    /// The layout of the box a `GLib` boxed record lives in (`BOXED_RECORD`):
    /// the runtime's `NtsBoxed`, `{ boxed, free, data }` after the header,
    /// which the runtime makes and frees (`nts_boxed_new`, `NTS_KIND_BOXED`),
    /// and whose first field the program reads. The C backend asserts it
    /// against `NtsBoxed`.
    fn boxed_record_layout(&mut self) -> TypeId {
        let ty = TypeId(super::BOXED_RECORD);
        if !self.layouts.iter().any(|layout| layout.types.contains(&ty)) {
            let field = |name: &str, ty: HirType| Field {
                name: (name.to_owned()).into(),
                ty,
                readonly: true,
                declared_by: None,
                written: None,
            };
            let pointer = HirType::NativePointer(super::native::Pointee::Void);
            self.layouts.push(Layout {
                types: vec![ty],
                name: "BoxedRecord".to_owned(),
                interfaces: Vec::new(),
                fields: vec![
                    field("boxed", pointer.clone()),
                    field("free", pointer),
                    field(
                        "data",
                        HirType::Int {
                            bits: 64,
                            signed: false,
                        },
                    ),
                ],
                methods: vec![None; self.hierarchy.table_size()],
                base: None,
            });
        }
        ty
    }

    /// A plain argument as C takes it: a boxed record's box where C takes the
    /// struct's pointer -- lent for the call, since a box whose pointer is
    /// passed must live until C is done with it -- and anything else as it is.
    ///
    /// A `number` where C takes an integer is converted with the call's other
    /// arguments (`specialize`), and C's own conversion is exact there: the
    /// strict check proved the value fits (`docs/records/notebooks/scalar-numbers.md`, D1), so
    /// no wrapping conversion stands in for a proof.
    fn unboxed_argument(
        &mut self,
        value: ValueId,
        parameter: &super::native::Type,
        origin: &Origin,
    ) -> ValueId {
        if self.values[value.0 as usize].ty
            != HirType::Managed(ManagedType::Object(TypeId(super::BOXED_RECORD)))
        {
            return value;
        }
        self.unbox_record(value, &parameter.representation(), origin)
    }

    /// The struct a boxed record's box holds, as the C pointer `want` a
    /// function takes: its first field, or NULL for a null box. Recorded
    /// against the box, so the call passing it lends the box.
    fn unbox_record(&mut self, boxed: ValueId, want: &HirType, origin: &Origin) -> ValueId {
        self.boxed_record_layout();
        let box_ty = self.values[boxed.0 as usize].ty.clone();
        let null = self.push(OpKind::ConstNull, box_ty, origin.clone());
        let absent = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: boxed,
                rhs: null,
            },
            HirType::Bool,
            origin.clone(),
        );
        let (none_block, some_block, merge) =
            (self.new_block(), self.new_block(), self.new_block());
        let result = self.push_block_param(merge, want.clone(), origin.clone());
        self.terminate(Terminator::Branch {
            cond: absent,
            then_target: none_block,
            then_args: Vec::new(),
            else_target: some_block,
            else_args: Vec::new(),
        });
        self.switch_to(none_block);
        let none = self.push(OpKind::ConstNull, want.clone(), origin.clone());
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![none],
        });
        self.switch_to(some_block);
        let raw = self.push(
            OpKind::FieldGet {
                object: boxed,
                field: 0,
            },
            HirType::NativePointer(super::native::Pointee::Void),
            origin.clone(),
        );
        let pointer = self.push(OpKind::Convert(raw), want.clone(), origin.clone());
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![pointer],
        });
        self.switch_to(merge);
        self.unboxed.insert(result, boxed);
        result
    }

    /// A boxed record a C function returned, in a box of the program's: as
    /// it is where the function handed it over (`Owned`), or a copy of it
    /// where the function lent it -- the box frees what it holds -- by the
    /// record's `GType`. A NULL result is `null`.
    fn box_record(
        &mut self,
        id: NodeId,
        pointer: ValueId,
        record: &super::native::schema::BoxedRecord,
        owned: bool,
    ) -> Result<ValueId, Diagnostic> {
        let ty = HirType::Managed(ManagedType::Object(self.boxed_record_layout()));
        let gtype = self.call_foreign_named(id, &record.get_type, Vec::new())?;
        let origin = self.origin(id);
        let helper = if owned {
            "nts_gobject_boxed"
        } else {
            "nts_gobject_boxed_copy"
        };
        Ok(self.runtime_call(helper, vec![pointer, gtype], ty, origin))
    }

    /// `new GtkTextIter()`: a zeroed boxed record of the size the headers
    /// give it, for C to fill, in a box of the program's.
    fn new_boxed_record(
        &mut self,
        id: NodeId,
        record: &super::native::schema::BoxedRecord,
    ) -> Result<ValueId, Diagnostic> {
        if record.size == 0 {
            return Err(self.unsupported(
                id,
                "`new` of a boxed record whose struct the headers keep opaque",
            ));
        }
        let ty = HirType::Managed(ManagedType::Object(self.boxed_record_layout()));
        let gtype = self.call_foreign_named(id, &record.get_type, Vec::new())?;
        let origin = self.origin(id);
        let size = self.push(
            OpKind::ConstInt(i128::from(record.size)),
            HirType::Int {
                bits: 64,
                signed: false,
            },
            origin.clone(),
        );
        Ok(self.runtime_call("nts_gobject_boxed_new", vec![gtype, size], ty, origin))
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

    /// What a foreign declaration's tags say about its parameters.
    fn parameter_tags(
        &self,
        call: NodeId,
        declaration: Option<NodeId>,
    ) -> Result<ParameterTags, Diagnostic> {
        let tags = declaration.and_then(|decl| self.node(decl).native.as_ref());
        let throws = match tags.and_then(|n| n.throws.as_deref()).map(|text| text.split_whitespace().collect::<Vec<_>>()) {
            None => None,
            Some(words) => match words.as_slice() {
                [slot, converter] => Some(((*slot).to_owned(), (*converter).to_owned())),
                _ => return Err(self.unsupported(call, "@ntsThrows names the error parameter and its converter, as in `@ntsThrows error nts_gerror_take_message`")),
            },
        };
        let defaults = tags
            .and_then(|n| n.defaults.as_deref())
            .map(super::native::parse_defaults)
            .transpose()
            .map_err(|why| self.unsupported(call, &why))?
            .unwrap_or_default();
        Ok(ParameterTags { throws, defaults })
    }

    /// A method parameter: labels, for a method the runtime calls, or else
    /// an ordinary one.
    fn lower_param_or_labels(&mut self, id: NodeId, index: u32) -> Result<Vec<Param>, Diagnostic> {
        if let Some(name) = self.name_node(id)
            && let Some(params) = self.lower_label_params(name, index)?
        {
            return Ok(params);
        }
        self.lower_param(id, index)
    }

    /// The parameters an Objective-C entry point adds, and what the function
    /// then returns. A record by value is written through the address the
    /// entry point passes last, so the function returns nothing; any other
    /// result is returned as it is. Then the labels objects are made, with
    /// every parameter in place.
    fn finish_params(
        &mut self,
        params: &mut Vec<Param>,
        return_type: HirType,
        origin: &Origin,
    ) -> Result<HirType, Diagnostic> {
        let return_type = if self.objc_entry.is_some_and(|entry| entry.returns_record)
            || self.com_entry.is_some_and(|entry| entry.returns_record)
        {
            let index = u32::try_from(params.len()).unwrap_or(0);
            let out = self.push(OpKind::Param(index), return_type.clone(), origin.clone());
            params.push(Param {
                name: "returned".to_owned(),
                shape: ParamShape::Ordinary,
                ty: return_type,
                origin: origin.clone(),
                known: Facts::TOP,
                written: None,
            });
            self.record_out = Some(out);
            HirType::Void
        } else {
            return_type
        };
        self.make_pending_labels()?;
        for (symbol, handle, name_node, ty) in std::mem::take(&mut self.pending_hstrings) {
            let text =
                self.runtime_call("nts_string_copy_hstring", vec![handle], ty, origin.clone());
            let text = self.open_cell(symbol, text, name_node);
            self.bindings.insert(symbol, text);
        }
        Ok(return_type)
    }

    /// The labels parameter of a method the runtime calls, which it passes
    /// as it is sent -- one argument each, in declared order -- made into the
    /// object the method's body reads: `override mouseDown(labels: { with:
    /// NSEvent })`, Swift's `mouseDown(with:)`, is `mouseDown:` taking the
    /// event.
    fn lower_label_params(
        &mut self,
        name_node: NodeId,
        index: u32,
    ) -> Result<Option<Vec<Param>>, Diagnostic> {
        let Some(labels) = self
            .objc_entry
            .and(self.snapshot.node_types.get(&name_node).copied())
            .filter(|declared| super::native::abi_type(self.snapshot, *declared).is_none())
            .and_then(|declared| super::native::labels_of(self.snapshot, declared))
        else {
            return Ok(None);
        };
        let origin = self.origin(name_node);
        let mut params = Vec::new();
        let mut values = Vec::new();
        for (at, (key, ty)) in labels.into_iter().enumerate() {
            let ty = self
                .represent(ty)
                .ok_or_else(|| self.unrepresentable(name_node, "a label"))?;
            let value = self.push(
                OpKind::Param(index + u32::try_from(at).unwrap_or(0)),
                ty.clone(),
                origin.clone(),
            );
            params.push(Param {
                name: key.clone(),
                shape: ParamShape::Ordinary,
                ty,
                origin: origin.clone(),
                known: Facts::TOP,
                written: None,
            });
            values.push((key, value));
        }
        self.pending_labels.push((name_node, values));
        Ok(Some(params))
    }

    /// The labels objects of [`Self::lower_label_params`], made from their
    /// parameters now that every parameter is, and bound to their names.
    fn make_pending_labels(&mut self) -> Result<(), Diagnostic> {
        for (name_node, values) in std::mem::take(&mut self.pending_labels) {
            let object_ty = self
                .type_of(name_node)
                .ok_or_else(|| self.unrepresentable(name_node, "labels"))?;
            let HirType::Managed(ManagedType::Object(type_id)) = object_ty.clone() else {
                return Err(self.unsupported(name_node, "labels that are not an object"));
            };
            self.materialize(name_node, &object_ty)?;
            let layout = self.layout_of(name_node, type_id)?;
            let origin = self.origin(name_node);
            let object = self.push(
                OpKind::ObjectNew { frame: false },
                object_ty,
                origin.clone(),
            );
            for (key, value) in values {
                let field = layout
                    .index_of(&key)
                    .ok_or_else(|| self.absent_member(name_node, type_id, &key))?;
                let want = layout.fields[field as usize].ty.clone();
                let value = self.coerce(value, &want, name_node)?;
                self.field_set(object, field, value, &origin);
            }
            if let Some(symbol) = self.node(name_node).symbol {
                let object = self.open_cell(symbol.0, object, name_node);
                self.bindings.insert(symbol.0, object);
            }
        }
        Ok(())
    }

    /// An override's string argument, lent by the Windows Runtime as its
    /// `HSTRING`: the parameter is the handle, and the name the string its
    /// text is copied into, which this function then owns. `None` for any
    /// other parameter.
    fn lent_hstring_param(
        &mut self,
        name_node: NodeId,
        index: u32,
        name: &str,
        ty: &HirType,
    ) -> Option<Param> {
        if !self
            .com_entry
            .is_some_and(|entry| index < 64 && entry.hstrings & (1u64 << index) != 0)
        {
            return None;
        }
        let symbol = self.node(name_node).symbol?;
        let origin = self.origin(name_node);
        let handle_ty = HirType::NativePointer(super::native::Pointee::Void);
        let handle = self.push(OpKind::Param(index), handle_ty.clone(), origin.clone());
        // Copied once every parameter is in place (`finish_params`): the
        // parameters are the function's first values, in order.
        self.pending_hstrings
            .push((symbol.0, handle, name_node, ty.clone()));
        Some(Param {
            name: name.to_owned(),
            shape: ParamShape::Ordinary,
            ty: handle_ty,
            origin,
            known: Facts::TOP,
            written: None,
        })
    }

    /// `Promise.resolve(v)` and `Promise.reject(e)`.
    ///
    /// `None` when the callee is not one of them, which is a different answer
    /// from `Some(Err(..))`: the second is one of these given something it
    /// cannot take, and it says so rather than falling through to a diagnostic
    /// about a member of `Promise` that does not exist.
    ///
    /// Already settled, which is not the same as synchronous. A reaction
    /// subscribed to one of these still runs on the microtask queue, one tick
    /// later, because running it inline would be a different observable order.
    /// That is the runtime's rule and this does not have to restate it.
    /// A static whose answer the checker's types already contain.
    ///
    /// `Array.isArray(x)` is a constant wherever the argument has a static
    /// type, and so is `Object.hasOwn(o, "k")` wherever the layout is known:
    /// there is nothing to ask at run time, because the question was settled
    /// when the type was. `Object.keys(o)` is the same fact one step further --
    /// the field names of a layout, which is a list the compiler is holding.
    ///
    /// Answered from the *checker's* type rather than from the representation,
    /// which is the whole subtlety. A `Uint8Array` is a `Managed(Array(u8))`
    /// here, and `Array.isArray(new Uint8Array(4))` is **false** in node -- a
    /// typed array is not an Array. Reading the representation would have
    /// answered `true` and been wrong in a way nothing else would catch.
    fn lower_decided_static(
        &mut self,
        id: NodeId,
        callee: NodeId,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if self.kind_of(callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return None;
        }
        let parts = self.children(callee);
        let [object, member] = parts.as_slice() else {
            return None;
        };
        if self.kind_of(*object) != Some(syntax::IDENTIFIER) {
            return None;
        }
        let global = self
            .node(*object)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)?;
        let name = self
            .node(*member)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)?;

        match (global.as_str(), name.as_str(), arguments) {
            ("Array", "isArray", [argument]) => Some(self.decide_is_array(id, *argument)),
            // `ArrayBuffer.isView(x)`, which is the same question asked of a
            // different family and answered the same way: from the type where
            // the type knows, and from the descriptor where it does not.
            //
            // It is the one question a typed array and a `DataView` answer
            // together -- `instanceof` separates them and this does not -- so
            // the runtime side compares two descriptors rather than testing a
            // kind. `AnyView` is true by construction: it *is* the union.
            ("ArrayBuffer", "isView", [argument]) => Some(self.decide_is_view(id, *argument)),
            // `Array.from(xs)` where `xs` is already an array is a copy, which
            // is what `[...xs]` is and what `slice` already does. Twelve of the
            // twenty-two `Array.from` calls in `runtime/node` take one
            // argument; the ones that take a mapper, or something that is
            // iterable without being an array, are a different question and
            // fall through to being refused by name.
            ("Array", "from", [argument]) => Some(self.lower_array_from(id, *argument)),
            // The two-argument form is two features wearing one name. With an
            // iterable it is `map` fused into the walk, which the callback
            // machinery does for `xs.map(f)` and would have to do here; with
            // `{ length: n }` it is not an iteration at all -- an *array-like*
            // is read by index, and `Array.from({ length: 4 })` builds four
            // `undefined`s from an object that has no elements. Both are in
            // `runtime/node`, and neither is this.
            ("Array", "from", [argument, callback]) => {
                Some(self.lower_array_from_mapped(id, *argument, *callback))
            }
            // `Symbol.for(key)`: the one symbol for this key in this runtime.
            //
            // The registry is a *strong* reference and that is the
            // specification's own rule rather than an oversight -- a registered
            // symbol is reachable for the life of the runtime, which is exactly
            // what distinguishes `Symbol.for("a")` from `Symbol("a")`.
            ("Symbol", "for", [argument]) => Some(self.lower_symbol_for(id, *argument)),
            // `Symbol.keyFor(sym)`: the key a registered symbol was made under,
            // and `undefined` for one that was not registered.
            ("Symbol", "keyFor", [argument]) => Some(self.lower_symbol_key_for(id, *argument)),
            ("Object", "keys", [argument]) => Some(self.decide_object_keys(id, *argument)),
            ("Object", "values", [argument]) => {
                Some(self.decide_object_columns(id, *argument, false))
            }
            ("Object", "entries", [argument]) => {
                Some(self.decide_object_columns(id, *argument, true))
            }
            // `Object.create(null)` is a **dictionary**, and the refusal beside
            // this has said so all along: "a fixed layout has nowhere to put"
            // the prototype argument, and "`Object.create(null)` is a dictionary
            // and is a different, buildable thing". This builds it. Only the
            // `null` form: any other prototype is a real prototype and keeps
            // that refusal.
            ("Object", "create", [prototype]) => Some(self.decide_object_create(id, *prototype)),
            ("Object", "is", [left, right]) => Some(self.decide_object_is(id, *left, *right)),
            ("Object", "hasOwn", [argument, key]) => Some(self.decide_has_own(id, *argument, *key)),
            // `Object.assign(target, ...sources)` between dictionaries. React's
            // `cloneElement`, its class state merge and its props resolution are
            // all this shape, and it was 6 root refusals in that runtime.
            //
            // **Every arity**, because the argument list is written down. The
            // first version of this arm took two arguments and called three a
            // fold "the caller can write", which was wrong twice over: a fold
            // over three *named* sources is three calls and not a loop, and the
            // arm it refused into says "a global member with no definition here"
            // -- so `Object.assign({}, prevState, partialState)`, React's one
            // canonical state merge, read as an unimplemented member.
            ("Object", "assign", [target, sources @ ..]) => {
                Some(self.decide_object_assign(id, *target, sources))
            }
            // `BigInt.asIntN(64, v)`, which is how the profile reads a signed
            // 64-bit quantity back out of an unsigned one. A width and a value,
            // both already machine types here.
            ("BigInt", helper @ ("asIntN" | "asUintN"), [width, value]) => {
                let call = if helper == "asIntN" {
                    "nts_bigint_as_intn"
                } else {
                    "nts_bigint_as_uintn"
                };
                Some(self.decide_as_n(id, call, *width, *value))
            }
            _ => None,
        }
    }

    /// The call forms that are not ordinary calls.
    ///
    /// Three kinds, and they are asked in this order because each is narrower
    /// than the last:
    ///
    /// `Math.floor(x)` and friends are *operations*. Lowering them as
    /// operations is what lets the analysis see that the result is a whole
    /// number, which is the entire reason an author writes `Math.floor` rather
    /// than a division.
    ///
    /// `Array.isArray(x)`, `Object.keys(o)` and `Object.hasOwn(o, "k")` are
    /// questions the *types* already answer, so they become constants.
    ///
    /// `Promise.resolve(v)` and `Promise.reject(e)` are constructors: each
    /// allocates a promise and settles it before anyone can subscribe.
    #[expect(
        clippy::too_many_lines,
        reason = "keep semantic text and key projection beside its existing dispatch"
    )]
    fn lower_special_call(
        &mut self,
        id: NodeId,
        callee: NodeId,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if self.is_standard_array_constructor(callee) {
            return Some(self.lower_array_call(id, callee));
        }
        // `GtkStringObject.new("x")`: a C function as a static member of a
        // class value, which has no value to be a receiver.
        if self.kind_of(callee) == Some(syntax::PROPERTY_ACCESS_EXPRESSION)
            && let [target, member] = self.children(callee).as_slice()
            && let Some(declaration) = self.static_native(id, *target)
        {
            return Some(self.lower_static_native(id, declaration, *member, arguments));
        }
        // A declaration of a `GObject` class's, `@ntsIntrinsic gobject.*`
        // (`lower/gobject.rs`).
        if let Some(intrinsic) = self.gobject_intrinsic(id) {
            return Some(self.lower_gobject_intrinsic(id, intrinsic, arguments));
        }
        if let Some(decl) = self
            .snapshot
            .call_targets
            .get(&id)
            .and_then(|target| target.callee)
            && self
                .node(decl)
                .native
                .as_ref()
                .and_then(|n| n.abi.as_deref())
                == Some("intrinsic")
            && !self.has_a_body(decl)
        {
            match self.declared_name(decl).as_deref() {
                Some("addrOf") => return Some(self.native_address_of(id, arguments)),
                Some(name @ ("local" | "sizeof" | "malloc" | "free" | "copy")) => {
                    return Some(self.native_storage(id, name, arguments));
                }
                Some("unsafeDowncast") => return Some(self.native_downcast(id, arguments)),
                Some("stringFrom") => return Some(self.native_string_from(id, arguments)),
                Some("pointerBits") => return Some(self.native_pointer_bits(id, arguments)),
                Some("bytesFrom") => return Some(self.native_bytes_from(id, arguments)),
                Some("selector") if self.in_objc_module(decl) => {
                    return Some(self.lower_selector(id, arguments));
                }
                _ => {}
            }
        }

        // `Number.parseInt` and `Number.parseFloat` before the intrinsic table,
        // because that table's entries all take exactly one argument and
        // `parseInt` takes a radix.
        //
        // Each is the same function object as its global in JavaScript, so both
        // reach the same helper rather than a second one -- and reaching a
        // *different* one is how two spellings of an operation come to disagree,
        // which this file has three comments about already.
        //
        // **`parseFloat` was missing and `parseInt` was not**, which is the
        // shape a table one entry short always has: thirteen of `Number`'s
        // fourteen members answered and the fourteenth said `a global member
        // with no definition here`. The pair is written here together so that a
        // reader adding one finds the other, which is the same argument
        // `lower_global_call` makes for keeping them adjacent two hundred lines
        // apart from the single-argument builtins.
        //
        // Only these two. `Number.isNaN` and `Number.isFinite` are **not** their
        // globals -- the whole reason those spellings exist is what they do to a
        // value that is not a number -- and aliasing them would be a silent
        // wrong answer rather than a missing one. They reach `Number`'s own
        // entries in `intrinsic_of`, which is correct because a `number` is all
        // that can arrive there.
        if self.kind_of(callee) == Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            let parts = self.children(callee);
            if let [object, member] = parts.as_slice()
                && self
                    .node(*object)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    == Some("Number")
            {
                match self
                    .node(*member)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                {
                    Some("parseInt") => return Some(self.lower_parse_int(id, arguments)),
                    Some("parseFloat") => return Some(self.lower_parse_float(id, arguments)),
                    _ => {}
                }
            }
        }
        // `Uint8Array.of(…)` and `Uint8Array.from(xs)`, beside the `Number`
        // block above and before the intrinsic table, which is keyed on a fixed
        // pair of names and has nowhere to put a class family.
        if self.kind_of(callee) == Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            let parts = self.children(callee);
            if let [object, member] = parts.as_slice()
                && let Some(class) = self
                    .node(*object)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .map(str::to_owned)
                && let Some(element) = super::builtin::typed_array_element(&class)
            {
                match self
                    .node(*member)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                {
                    Some("of") => {
                        return Some(self.lower_typed_array_of(id, &class, element, arguments));
                    }
                    Some("from") => {
                        return Some(self.lower_typed_array_from(id, &class, element, arguments));
                    }
                    _ => {}
                }
            }
        }
        if let Some(to_stderr) = self.console_method(callee) {
            return Some(self.lower_console(id, arguments, to_stderr));
        }
        if self.is_json_stringify(callee) {
            return Some(self.lower_json_stringify(id, arguments));
        }
        if let Some((intrinsic, builtin)) = self.intrinsic_of(callee) {
            return Some(self.lower_intrinsic(id, intrinsic, builtin, arguments));
        }
        if let Some(decided) = self.lower_decided_static(id, callee, arguments) {
            return Some(decided);
        }
        if let Some(settled) = self.lower_capability_call(id, callee, arguments) {
            return Some(settled);
        }
        self.lower_promise_static(id, callee, arguments)
    }

    fn lower_promise_static(
        &mut self,
        id: NodeId,
        callee: NodeId,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if self.kind_of(callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return None;
        }
        let parts = self.children(callee);
        let object = *parts.first()?;
        let member = *parts.last()?;
        if self.kind_of(object) != Some(syntax::IDENTIFIER)
            || self
                .node(object)
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
                != Some("Promise")
        {
            return None;
        }
        let member = self
            .node(member)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)?;
        Some(match member.as_str() {
            "resolve" => self.settled_promise(id, arguments, false),
            "reject" => self.settled_promise(id, arguments, true),
            "all" => self.combinator(id, arguments, true),
            "race" => self.combinator(id, arguments, false),
            "withResolvers" => self.promise_capability(id, arguments),
            _ => return None,
        })
    }

    /// `Promise.all(xs)` and `Promise.race(xs)`.
    ///
    /// One function because they are one machine with two dials, which is the
    /// same claim the runtime makes: both subscribe to every element in order
    /// before returning, and both settle their result once. What differs is
    /// whether the values are kept.
    ///
    /// `collecting` is `all`. The result array is allocated *here* rather than
    /// in the runtime: whether a payload is a double or a pointer is a fact
    /// about the type, and an array carries its own descriptor, so allocating
    /// it on this side says that fact once instead of passing it separately.
    ///
    /// A heterogeneous tuple -- `Promise.all([Promise<number>, Promise<string>])`,
    /// whose result is `Promise<[number, string]>` -- needs no rule here. A
    /// tuple whose elements do not share a representation has none either, so
    /// the type is refused before this is reached.
    fn combinator(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
        collecting: bool,
    ) -> Result<ValueId, Diagnostic> {
        let [only] = arguments else {
            // `Promise.all()` and `Promise.all(a, b)` are both type errors, so
            // arriving here means the shape is not what this reads.
            return Err(self.unsupported(id, "a `Promise` combinator with these arguments"));
        };
        let promises = self.lower_expression(*only)?;
        let HirType::Managed(ManagedType::Array(element)) =
            self.values[promises.0 as usize].ty.clone()
        else {
            // An iterable that is not an array: legal JavaScript, and it needs
            // the iteration protocol rather than a length and an index.
            return Err(self.unsupported(id, "a `Promise` combinator over a non-array"));
        };
        let HirType::Managed(ManagedType::Promise(settles)) = *element else {
            // `Promise.all([1, 2])` is legal and fulfils with the values
            // unchanged. Supporting it means a per-element test for whether a
            // value is a promise at all, which is a different mechanism from
            // this one rather than a bigger version of it.
            return Err(self.unsupported(id, "a `Promise` combinator over non-promises"));
        };
        // Asked of the promises, before the result type: a promise of a C
        // handle settles outside the value `all` collects
        // (`NtsPromise::native`), and the runtime's collector reads values.
        // Not left to `Array<NativePointer>` being unrepresentable -- the day
        // it represents, this still refuses.
        if collecting && matches!(*settles, HirType::NativePointer(_)) {
            return Err(self.unsupported(id, "`Promise.all` over promises of C handles, which settle outside the value it collects"));
        }
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `Promise` combinator result"))?;
        let HirType::Managed(ManagedType::Promise(payload)) = ty.clone() else {
            return Err(self.unrepresentable(id, "a `Promise` combinator result"));
        };
        let origin = self.origin(id);
        if !collecting {
            if *payload != *settles {
                return Err(self.unrepresentable(id, "a `Promise.race` result"));
            }
            return Ok(self.runtime_call("nts_promise_race", vec![promises], ty, origin));
        }
        // The checker's answer is `Promise<T[]>`; the argument's is `Promise<T>[]`.
        // They agree by construction, and disagreeing means this read one of
        // them wrong rather than that the program is unusual.
        let HirType::Managed(ManagedType::Array(collected)) = &*payload else {
            return Err(self.unrepresentable(id, "a `Promise.all` result"));
        };
        if **collected != *settles {
            return Err(self.unrepresentable(id, "a `Promise.all` result"));
        }
        let length = self.push(OpKind::Length(promises), HirType::NUMBER, origin.clone());
        let values = self.push(
            // Zeroed, because a rejection leaves it partly filled and a
            // collector that walked the rest would follow whatever was there.
            OpKind::ArrayNew {
                length,
                // Filled: the `Promise.all` result: the runtime fills it as the promises settle, and the program receives it only once every one has; a rejection delivers the reason instead.
                fill: ArrayFill::Filled,
            },
            HirType::Managed(ManagedType::Array(collected.clone())),
            origin.clone(),
        );
        Ok(self.runtime_call("nts_promise_all", vec![promises, values], ty, origin))
    }

    /// Whether this expression is a `PromiseWithResolvers<T>`.
    ///
    /// Asked of the **checker's** type rather than the representation, because
    /// the representation is deliberately the same as a plain `Promise<T>` --
    /// that is the whole trick -- and telling the two apart is exactly what
    /// decides whether `.resolve` is a member to settle through or a name this
    /// compiler does not have.
    fn names_a_promise_capability(&self, node: NodeId) -> bool {
        self.snapshot
            .node_types
            .get(&node)
            .copied()
            .is_some_and(|ty| self.is_a_capability_type(ty))
    }

    /// The same question of a **type**, seeing through a union with an absence.
    ///
    /// A capability that may be missing is still a capability:
    /// `cap?.resolve(v)` types its receiver as
    /// `PromiseWithResolvers<T> | undefined`, and asking `named` of that union
    /// answers `None` -- so the settle was not recognised and the call fell all
    /// the way through to *``resolve`` on a promise, which has no method table
    /// here*, while the very same settle written without the `?.` lowered.
    ///
    /// Only an absence is looked past. A union of a capability with anything
    /// *else* is two things the settle cannot be written for, and the member
    /// read below has to refuse it rather than pick one.
    fn is_a_capability_type(&self, ty: nts_semantic_schema::TypeId) -> bool {
        if provided(self.snapshot, ty) == Some("PromiseWithResolvers") {
            return true;
        }
        let Some(TypeKind::Union(members)) =
            self.snapshot.types.get(ty.0 as usize).map(|r| &r.kind)
        else {
            return false;
        };
        let mut capability = false;
        for member in members.iter().copied() {
            if matches!(
                self.snapshot.types.get(member.0 as usize).map(|r| &r.kind),
                Some(TypeKind::Void | TypeKind::Undefined | TypeKind::Null)
            ) {
                continue;
            }
            if provided(self.snapshot, member) == Some("PromiseWithResolvers") {
                capability = true;
                continue;
            }
            return false;
        }
        capability
    }

    /// `Promise.withResolvers<T>()`, which allocates a promise and nothing else.
    fn promise_capability(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        if !arguments.is_empty() {
            return Err(self.unsupported(id, "a `Promise.withResolvers` with arguments"));
        }
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `Promise.withResolvers` result"))?;
        // The representation rule above is what makes this a promise. If it
        // did not fire -- an un-annotated `withResolvers()` whose payload the
        // checker never pinned -- refusing is the answer, for the reason
        // `Promise<T>` gives one argument up there: a guessed payload settles
        // into a slot of the wrong kind and the collector follows it.
        if !matches!(ty, HirType::Managed(ManagedType::Promise(_))) {
            return Err(self.unrepresentable(id, "a `Promise.withResolvers` result"));
        }
        let origin = self.origin(id);
        Ok(self.runtime_call("nts_promise_new", Vec::new(), ty, origin))
    }

    /// `capability.resolve(v)` and `capability.reject(e)`.
    ///
    /// Not a method call: there is no object with a `resolve` slot in it, so
    /// [`Self::lower_method_call`] would look for a layout that does not exist.
    /// The receiver *is* the promise, and these are the two settles the runtime
    /// already performs for an `async` function's `return` and for
    /// `Promise.reject`.
    fn lower_capability_call(
        &mut self,
        id: NodeId,
        callee: NodeId,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if self.kind_of(callee) != Some(syntax::PROPERTY_ACCESS_EXPRESSION) {
            return None;
        }
        let parts = self.children(callee);
        let [object, member] = parts.as_slice() else {
            return None;
        };
        let (object, member) = (*object, *member);
        if !self.names_a_promise_capability(object) {
            return None;
        }
        let rejecting = match self
            .node(member)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
        {
            Some("resolve") => false,
            Some("reject") => true,
            _ => return None,
        };
        Some(self.settle_capability(id, object, arguments, rejecting))
    }

    /// The body of [`Self::lower_capability_call`], once the member is known.
    fn settle_capability(
        &mut self,
        id: NodeId,
        object: NodeId,
        arguments: &[NodeId],
        rejecting: bool,
    ) -> Result<ValueId, Diagnostic> {
        let ty = self
            .type_of(object)
            .ok_or_else(|| self.unrepresentable(object, "a promise capability"))?;
        let HirType::Managed(ManagedType::Promise(payload)) = ty else {
            return Err(self.unrepresentable(object, "a promise capability"));
        };
        let promise = self.lower_expression(object)?;
        self.settle_lowered(id, promise, *payload, arguments, rejecting)
    }

    /// `cap.resolve(v)` and `cap.reject(e)` on a receiver already lowered.
    ///
    /// Reached from [`Self::lower_method_on`], which is where the *optional*
    /// spelling arrives: `lower_capability_call` recognises a settle
    /// syntactically and cannot see the three-child callee `a?.b()` has.
    ///
    /// Asked of the **checker's** type, because the representation of a
    /// capability is deliberately a plain `Promise<T>` -- that is the whole
    /// trick -- and telling the two apart is what decides whether `resolve` is
    /// a settle or a name this compiler does not have.
    fn capability_settle(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        receiver_node: NodeId,
        member: NodeId,
        arguments: &[NodeId],
        held: &HirType,
    ) -> Option<Result<ValueId, Diagnostic>> {
        let HirType::Managed(ManagedType::Promise(payload)) = held else {
            return None;
        };
        if !self.names_a_promise_capability(receiver_node) {
            return None;
        }
        let rejecting = match self
            .node(member)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
        {
            Some("resolve") => false,
            Some("reject") => true,
            _ => return None,
        };
        let payload = (**payload).clone();
        Some(self.settle_lowered(id, receiver, payload, arguments, rejecting))
    }

    /// The settle itself, on a receiver that is **already a value**.
    ///
    /// Split out of [`Self::settle_capability`] so the optional-chained form
    /// can reach it. `lower_capability_call` recognises the settle
    /// *syntactically* -- a two-child property-access callee -- and `a?.b()`
    /// has **three** children, the `?.` being a token of its own, so
    /// `cap?.resolve(v)` fell past it and out the bottom of `lower_method_on`
    /// as *`resolve` on a promise, which has no method table here* while
    /// `cap.resolve(v)` lowered. Nine distinct sites in `runtime/node` and
    /// `runtime/web-platform` are the optional spelling, all of the shape
    /// `this.#writeRequests.dequeue()?.reject(...)`.
    ///
    /// It cannot be fixed by teaching the syntactic path about three children:
    /// the settle must happen **inside the present arm**, and the arm is built
    /// by `lower_optional_method_call`, which hands a narrowed `ValueId` to
    /// `lower_method_on`. So this is where both spellings meet.
    fn settle_lowered(
        &mut self,
        id: NodeId,
        promise: ValueId,
        payload: HirType,
        arguments: &[NodeId],
        rejecting: bool,
    ) -> Result<ValueId, Diagnostic> {
        let value = match arguments {
            [] => None,
            [only] => Some(self.lower_expression(*only)?),
            _ => {
                return Err(self.unsupported(id, "a settle with this many arguments"));
            }
        };
        if rejecting {
            return self.reject_with(id, promise, value);
        }
        let result = AsyncResult {
            promise,
            payload,
            written: None,
        };
        self.settle(id, &result, value)
    }

    /// The body of [`Self::lower_promise_static`], once the shape is known.
    /// A promise already settled with `value`, for `await` to suspend on.
    ///
    /// The same two steps `Promise.resolve(v)` takes -- allocate, settle -- and
    /// deliberately not a shortcut past them: a reaction on a settled promise
    /// still runs one tick later, and that tick is the whole difference between
    /// `await v` and `v`.
    fn settled_around(
        &mut self,
        id: NodeId,
        value: ValueId,
        payload: HirType,
    ) -> Result<ValueId, Diagnostic> {
        let ty = HirType::Managed(ManagedType::Promise(Box::new(payload.clone())));
        let origin = self.origin(id);
        let promise = self.runtime_call("nts_promise_new", Vec::new(), ty, origin);
        let result = AsyncResult {
            promise,
            payload,
            written: None,
        };
        self.settle(id, &result, Some(value))?;
        Ok(promise)
    }

    fn settled_promise(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
        rejecting: bool,
    ) -> Result<ValueId, Diagnostic> {
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `Promise` this compiler can settle"))?;
        let HirType::Managed(ManagedType::Promise(payload)) = ty.clone() else {
            return Err(self.unrepresentable(id, "a `Promise.resolve` result"));
        };
        let value = match arguments {
            [] => None,
            [only] => Some(self.lower_expression(*only)?),
            // `Promise.resolve(v, extra)` is not a thing the signature admits,
            // so reaching here means the shape is not what this reads.
            _ => return Err(self.unsupported(id, "a `Promise` call with this many arguments")),
        };
        let origin = self.origin(id);
        let promise = self.runtime_call("nts_promise_new", Vec::new(), ty, origin);
        if rejecting {
            // Through `reject_with`, which is the one place that knows an
            // erased reason takes a different helper. This was the fourth copy
            // of that decision and the second that got it wrong.
            self.reject_with(id, promise, value)?;
            return Ok(promise);
        }
        let result = AsyncResult {
            promise,
            payload: *payload,
            written: None,
        };
        self.settle(id, &result, value)?;
        Ok(promise)
    }

    /// The thenable half of the resolve procedure. Where `value` can be an
    /// instance of a class that declares `then`, ask which, and queue that
    /// class's job instead of fulfilling. `None` where its type rules every
    /// thenable out, which is almost everywhere and costs nothing.
    ///
    /// **A test per candidate, most-derived first**, each an `InstanceOf` of
    /// the class and everything under it, and a value none of them matches is
    /// fulfilled as before. A type that declares `then` itself is a candidate
    /// like any other rather than a jump straight to its job, because a
    /// reference of that type can still be `null`, which is not a thenable.
    ///
    /// A candidate the census refused refuses *here*, at the site that reaches
    /// it: the census knows why and the site knows whether, and a site that
    /// did not ask would fulfil with the object where node calls its `then`.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn settle_through_thenables(
        &mut self,
        id: NodeId,
        result: &AsyncResult,
        value: ValueId,
    ) -> Result<Option<ValueId>, Diagnostic> {
        // A binding's thenable first, from the checker's type: see
        // `Then::Function` for why no run-time test could choose it.
        if let Some(job) = self.binding_thenable(id)? {
            self.check_delivery(id, job, &result.payload)?;
            let origin = self.origin(id);
            self.queue_thenable_job(id, job, value, result.promise, &origin)?;
            return Ok(Some(self.push(
                OpKind::ConstUndefined,
                HirType::Void,
                origin,
            )));
        }
        let candidates = self.thenable_candidates(&self.values[value.0 as usize].ty.clone());
        if candidates.is_empty() {
            return Ok(None);
        }
        // Where the static type is the class or below it, every value that is
        // not null is an instance: the site proves it. See `Thenable`.
        let declared = match self.values[value.0 as usize].ty {
            HirType::Managed(ManagedType::Object(declared)) => Some(declared),
            _ => None,
        };
        let mut arms = Vec::new();
        for class in candidates {
            let proven =
                declared.is_some_and(|declared| self.hierarchy.descends_from(declared, class));
            let arm = match self.thenables.classes.get(&class) {
                Some(Thenable::Raises(_)) if proven => {
                    return Err(
                        self.unsupported(id, &format!("resolving a promise with {RAISING_THEN}"))
                    );
                }
                Some(Thenable::Refused(reason)) if proven => {
                    return Err(self.unsupported(id, &format!("resolving a promise with {reason}")));
                }
                Some(Thenable::Job(job) | Thenable::Raises(job)) => Ok(*job),
                Some(Thenable::Refused(reason)) => Err(*reason),
                None => continue,
            };
            if let Ok(job) = arm {
                self.check_delivery(id, job, &result.payload)?;
            }
            arms.push((class, arm));
        }
        let origin = self.origin(id);
        // A reference of a thenable's type can still be `null`, which is no
        // thenable: its own node says which absence it is.
        let erased = self.erased_from(value, id, &origin);
        let join = self.new_block();
        for (class, arm) in arms {
            let classes = self.classes_under(class);
            let test = self.push(
                OpKind::InstanceOf {
                    value: erased,
                    classes,
                    by_layout: false,
                },
                HirType::Bool,
                origin.clone(),
            );
            let hit = self.new_block();
            let miss = self.new_block();
            self.terminate(Terminator::Branch {
                cond: test,
                then_target: hit,
                then_args: Vec::new(),
                else_target: miss,
                else_args: Vec::new(),
            });
            self.switch_to(hit);
            match arm {
                Ok(job) => {
                    let thenable = self.push(
                        OpKind::unerase(erased),
                        HirType::Managed(ManagedType::Object(class)),
                        origin.clone(),
                    );
                    self.queue_thenable_job(id, job, thenable, result.promise, &origin)?;
                    self.terminate(Terminator::Jump {
                        target: join,
                        args: Vec::new(),
                    });
                }
                // A value no job can resolve arrived, where the type only
                // allowed it: stop, naming why, rather than fulfil with it.
                Err(reason) => {
                    let what = self.push(
                        OpKind::ConstString(format!("resolving a promise with {reason}").into()),
                        HirType::Managed(ManagedType::String),
                        origin.clone(),
                    );
                    self.runtime_call("nts_refused", vec![what], HirType::Void, origin.clone());
                    self.terminate(Terminator::Unreachable);
                }
            }
            self.switch_to(miss);
        }
        // **The miss is fulfilled through the tag**, not through `fulfil`.
        // The payload was typed for what `then` delivers -- `await box` is a
        // `number` -- and a value that is not a thenable is not that: where
        // the static type declares `then`, it is only the `null` the type
        // admits. So it is resolved as an erased value is, under its own tag.
        // Where the payload can hold it, the typed reader at the `await` reads
        // it; where the checker's type said it could not arrive, that reader's
        // assertion names it rather than reading a null as a number.
        let promise = self.erased(result.promise, Absent::Impossible, &origin);
        let promise = self.push(OpKind::unerase(promise), erased_promise(), origin.clone());
        self.runtime_call(
            "nts_promise_resolve_value",
            vec![promise, erased],
            HirType::Void,
            origin.clone(),
        );
        self.terminate(Terminator::Jump {
            target: join,
            args: Vec::new(),
        });
        self.switch_to(join);
        Ok(Some(self.push(
            OpKind::ConstUndefined,
            HirType::Void,
            origin,
        )))
    }

    /// Refuse where a thenable would resolve this promise with something its
    /// payload cannot hold.
    ///
    /// The payload is the checker's, and the checker reads `then` from the
    /// *static* type: `await held` with `held: Base` is typed `Base`, and a
    /// `Derived` that declares `then(onFulfilled: (value: number) => ...)`
    /// resolves it with a number. Node answers the number. Here the slot is a
    /// `Base` pointer, so the honest answer is to say so rather than to read a
    /// number's bits as one.
    ///
    /// What `then` delivers is its first callback's first parameter, which is
    /// the resolving function's signature. An erased payload holds anything,
    /// and two references share a reader; anything else must be the same
    /// representation.
    fn check_delivery(&self, id: NodeId, job: usize, payload: &HirType) -> Result<(), Diagnostic> {
        let ClosureSource::Job {
            resolve: Some(resolve),
            ..
        } = self.closures[job].source
        else {
            // A `then` with no `onFulfilled` never fulfils anything.
            return Ok(());
        };
        let delivered = self
            .snapshot
            .node_types
            .get(&self.closures[resolve].node)
            .and_then(|ty| signature_key(self.snapshot, *ty))
            .and_then(|(parameters, _)| parameters.first().copied())
            .and_then(|ty| self.represent(ty))
            .map(in_a_slot);
        let Some(delivered) = delivered else {
            return Ok(());
        };
        // A thenable delivered is resolved in turn, through its own job, so
        // what finally arrives is decided there -- and the reader at the
        // `await` asks its tag, which is where a mismatch then says so.
        if !self.thenable_candidates(&delivered).is_empty() {
            return Ok(());
        }
        // The resolving function settles at what it delivers, so the reader
        // here must read that: the same type, a reference beside a reference,
        // or an erased payload's tag -- except a native handle, which a
        // promise of one holds boxed and an erased reader would hand back as
        // the box.
        // A `void` payload is read by nothing, so anything may arrive in it.
        let holds = match (payload, &delivered) {
            (HirType::Void, _) => true,
            (_, HirType::NativePointer(_)) => payload == &delivered,
            (HirType::Erased, _) | (HirType::Managed(_), HirType::Managed(_)) => true,
            (payload, delivered) => payload == delivered,
        };
        if holds {
            return Ok(());
        }
        Err(self.unsupported(
            id,
            &format!(
                "resolving a promise typed to settle with {payload:?} through a thenable whose `then` delivers \
                 {delivered:?}, which the checker typed from a class above the one declaring `then`",
            ),
        ))
    }

    /// The thenable classes a value of this type can be an instance of, most
    /// derived first: those below it, and the one above it that declares
    /// `then` if it inherits one. Everything, for an erased value.
    fn thenable_candidates(&self, ty: &HirType) -> Vec<TypeId> {
        let related = |class: &TypeId, to: TypeId| {
            self.hierarchy.descends_from(*class, to) || self.hierarchy.descends_from(to, *class)
        };
        let mut found: Vec<TypeId> = match ty {
            HirType::Erased => self.thenables.classes.keys().copied().collect(),
            HirType::Managed(ManagedType::Object(declared))
                if declared.0 < super::SYNTHETIC_TYPE_FLOOR =>
            {
                self.thenables
                    .classes
                    .keys()
                    .copied()
                    .filter(|class| related(class, *declared))
                    .collect()
            }
            _ => Vec::new(),
        };
        let depth = |class: TypeId| self.hierarchy.ancestors(class).count();
        found.sort_by_key(|class| (std::cmp::Reverse(depth(*class)), class.0));
        found
    }

    /// The job for a binding's `then`, where the value a resolve site
    /// resolves with has one in its checker type -- or the site's refusal,
    /// where the census could not make one.
    ///
    /// Static, because the type is all there is to ask: see `Then::Function`.
    /// So it is a proof, as a class at or above the static type is, and every
    /// answer that is not a plain job refuses here.
    fn binding_thenable(&self, id: NodeId) -> Result<Option<usize>, Diagnostic> {
        if self.thenables.signatures.is_empty() {
            return Ok(None);
        }
        let Some(ty) = self
            .resolved_node(id)
            .and_then(|node| self.snapshot.node_types.get(&node).copied())
        else {
            return Ok(None);
        };
        let found = binding_thens::collect(self.snapshot, &self.thenables, ty)
            .map_err(|reason| self.unsupported(id, reason))?;
        let signature = match found {
            binding_thens::Found::None => return Ok(None),
            binding_thens::Found::One(signature, true) => signature,
            // A union that holds one: `IAsyncOperation<T> | null` is either
            // the operation or not, and which is a run-time question the
            // static choice cannot ask.
            _ => {
                return Err(self.unsupported(
                    id,
                    "resolving a promise with a value that may or may not be a binding's thenable, which is chosen \
                     from the type rather than tested for",
                ));
            }
        };
        match self.thenables.signatures.get(&signature) {
            Some(Thenable::Job(job)) => Ok(Some(*job)),
            Some(Thenable::Raises(_)) => {
                Err(self.unsupported(id, &format!("resolving a promise with {RAISING_THEN}")))
            }
            Some(Thenable::Refused(reason)) => {
                Err(self.unsupported(id, &format!("resolving a promise with {reason}")))
            }
            None => Ok(None),
        }
    }

    /// The node whose value a resolve site resolves with: what an `await`
    /// awaits and a `return` returns, the argument of `resolve(x)` or
    /// `Promise.resolve(x)`, and otherwise the site itself -- a concise
    /// `async` arrow's body is both.
    fn resolved_node(&self, id: NodeId) -> Option<NodeId> {
        match self.kind_of(id) {
            Some(syntax::AWAIT_EXPRESSION | syntax::RETURN_STATEMENT) => {
                self.children(id).first().copied()
            }
            Some(syntax::CALL_EXPRESSION) => self.arguments_of(id).first().copied(),
            _ => Some(id),
        }
    }

    /// Queue `NewPromiseResolveThenableJob` for `thenable`, to resolve
    /// `promise`: `HostEnqueuePromiseJob`, with the job the census made for its
    /// class.
    fn queue_thenable_job(
        &mut self,
        id: NodeId,
        job: usize,
        thenable: ValueId,
        promise: ValueId,
        origin: &Origin,
    ) -> Result<(), Diagnostic> {
        let thenable_ty = self.thenable_type(job)?;
        let thenable = self.coerce(thenable, &thenable_ty, id)?;
        // See `erased_promise`: the job holds the promise without its payload.
        let erased = self.erased(promise, Absent::Impossible, origin);
        let promise = self.push(OpKind::unerase(erased), erased_promise(), origin.clone());
        let object = self.push(
            OpKind::ObjectNew { frame: false },
            HirType::Managed(ManagedType::Object(closure_type(job))),
            origin.clone(),
        );
        self.field_set(object, 0, thenable, origin);
        self.field_set(object, 1, promise, origin);
        self.layouts
            .push(self.closure_layout(job, thenable_job_fields(thenable_ty)));
        self.used_closures.push(job);
        // Present whenever a class declares `then`, which is a superset of
        // there being a job -- see where the hierarchy numbers it.
        let Some(slot) = self.hierarchy.closure_slot else {
            return Err(self.unsupported(id, "a thenable job in a program with no closure slot"));
        };
        let slot = self.push(OpKind::DispatchSlot(slot), HirType::NUMBER, origin.clone());
        self.runtime_call(
            "nts_enqueue_job",
            vec![object, slot],
            HirType::Void,
            origin.clone(),
        );
        Ok(())
    }

    /// Settle an `async` function's promise and hand it back.
    ///
    /// The function's HIR return type is the promise, not the payload, so every
    /// `return` in the body becomes two steps: settle, then return the promise
    /// that was allocated on entry.
    ///
    /// Which `fulfill` depends on the payload's representation, which is the
    /// whole reason [`ManagedType::Promise`] carries one. The runtime stores a
    /// tagged union and the tag has to be right: a number written into the
    /// reference slot is a pointer the collector would follow.
    fn settle_and_return(
        &mut self,
        id: NodeId,
        result: &AsyncResult,
        value: Option<ValueId>,
    ) -> Result<(), Diagnostic> {
        self.settle(id, result, value)?;
        self.terminate(Terminator::Return(Some(result.promise)));
        Ok(())
    }

    /// Write a value into a promise, through the helper its payload needs.
    ///
    /// Which one depends on the payload's representation, which is the whole
    /// reason [`ManagedType::Promise`] carries one. The runtime stores a tagged
    /// union and the tag has to be right: a number written into the reference
    /// slot is a pointer the collector would follow.
    fn settle(
        &mut self,
        id: NodeId,
        result: &AsyncResult,
        value: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        // **Settling a promise with a promise is adoption**, and it is a
        // runtime operation rather than a copy here. The outer one does not
        // take the inner *promise* as its payload -- that would be a different
        // value of a different type -- it takes the inner's eventual
        // settlement, two microtasks later, and both halves are observable
        // through interleaving.
        //
        // The two hops are the specification's two jobs:
        // `NewPromiseResolveThenableJob` subscribes, and the subscription's
        // reaction settles. Measured against node before this was built, with a
        // chain of eight microtasks to count against, a `return g()` whose
        // `g()` has already settled lands exactly one tick after a
        // `return await g()` would. `nts_promise_adopt` carries that argument
        // in all three runtimes and they have to stay the same number of hops.
        if let Some(value) = value
            && let HirType::Managed(ManagedType::Promise(inner)) =
                self.values[value.0 as usize].ty.clone()
        {
            // **The payloads have to agree**, and the checker is not enough to
            // say so: `Promise<Buffer>` and `Promise<unknown>` are assignable
            // in TypeScript and are a pointer and a tagged value here. The
            // forward copies one `NtsValue` across, so a disagreement would put
            // the inner's spelling in a slot the outer's readers unpack
            // differently -- which is the shape the comment this replaced was
            // written about, one layer along.
            if *inner != result.payload {
                return Err(self.unsupported(
                    id,
                    "a promise settled with a promise whose payload is represented differently",
                ));
            }
            let origin = self.origin(id);
            return Ok(self.runtime_call(
                "nts_promise_adopt",
                vec![result.promise, value],
                HirType::Void,
                origin,
            ));
        }
        // **Then a thenable**, which is the other half of the specification's
        // resolve procedure: it reads `then` off whatever it is given, and
        // where there is one, the promise follows it instead of holding it.
        if let Some(value) = value
            && let Some(settled) = self.settle_through_thenables(id, result, value)?
        {
            return Ok(settled);
        }
        self.fulfil(id, result, value)
    }

    /// Settle with what is neither a promise nor a thenable: the
    /// specification's `FulfillPromise`, which `settle` reaches once it has
    /// asked both.
    fn fulfil(
        &mut self,
        id: NodeId,
        result: &AsyncResult,
        value: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        // At the payload's own type before the helper is chosen from it. The
        // two were read independently, so a `Promise<Buffer>` settled from a
        // value the flow had erased picked `nts_promise_fulfill_tagged` -- from
        // the declared payload -- and handed it the erased value, which is a
        // struct where the helper wants a pointer. Five modules, one site each,
        // and the C was the only thing that objected.
        let value = match value {
            Some(value) => Some(self.coerce(value, &result.payload, id)?),
            None => None,
        };
        let origin = self.origin(id);
        let (helper, args) = match (&result.payload, value) {
            // A C handle -- `query_info_async`'s `GFileInfo *` -- into the
            // promise's own slot for one, never into its value, which the
            // collector reads.
            // A host's object as a tagged value, which the promise keeps alive
            // through the host's pair (`NTS_TAG_HANDLE_HOST`) -- the
            // representation a host settling one uses too, so an `await` reads
            // either the same way (`suspend::settled_reader`).
            (HirType::NativePointer(pointee), Some(value))
                if super::suspend::host_handle(pointee) =>
            {
                let erased = self.push(
                    OpKind::Erase {
                        value,
                        absent: Absent::Impossible,
                        slots: Absent::Impossible,
                    },
                    HirType::Erased,
                    origin.clone(),
                );
                ("nts_promise_fulfill_value", vec![result.promise, erased])
            }
            // A counted one boxed, so the promise holds a reference to it.
            (HirType::NativePointer(pointee), Some(value)) if pointee.counting().is_some() => {
                let (boxed, boxed_ty) = self.box_handle(id, value, pointee)?;
                let tag = super::tags::of_reference(&ManagedType::Object(boxed_ty));
                let tag = self.push(
                    OpKind::ConstInt(i128::from(tag)),
                    HirType::Int {
                        bits: 32,
                        signed: false,
                    },
                    self.origin(id),
                );
                (
                    "nts_promise_fulfill_tagged",
                    vec![result.promise, boxed, tag],
                )
            }
            (HirType::NativePointer(_), Some(value)) => {
                ("nts_promise_fulfill_pointer", vec![result.promise, value])
            }
            (HirType::Void, _) | (_, None) => ("nts_promise_fulfill_void", vec![result.promise]),
            (HirType::Float { .. } | HirType::Int { .. } | HirType::Bool, Some(value)) => {
                ("nts_promise_fulfill_number", vec![result.promise, value])
            }
            // Logical BigInt uses the existing tagged payload; late boxing
            // supplies its owned native reference before counting/emission.
            (HirType::BigInt | HirType::PossiblyUndefined(_), Some(value)) => {
                let erased = self.push(
                    OpKind::Erase {
                        value,
                        absent: Absent::Impossible,
                        slots: Absent::Impossible,
                    },
                    HirType::Erased,
                    origin.clone(),
                );
                ("nts_promise_fulfill_value", vec![result.promise, erased])
            }
            // The tag, supplied rather than derived. The compiler emitted the
            // type, so it knows whether this is a string; making the runtime
            // read the header back to find out is asking a question that was
            // already answered.
            (HirType::Managed(managed), Some(value)) => {
                let tag = super::tags::of_reference(managed);
                let origin = self.origin(id);
                let tag = self.push(
                    OpKind::ConstInt(i128::from(tag)),
                    HirType::Int {
                        bits: 32,
                        signed: false,
                    },
                    origin,
                );
                (
                    "nts_promise_fulfill_tagged",
                    vec![result.promise, value, tag],
                )
            }
            (HirType::Never, Some(_)) => {
                return Err(self.unrepresentable(id, "an `async` function returning `never`"));
            }
            // The runtime settles a promise with a number or with a reference,
            // and an erased value is neither: it is a tag beside a payload, so
            // fulfilling with one needs a third helper that knows the layout.
            // This was refused, on the argument that settling one through
            // whichever arm looks closest is how a reference payload goes out
            // as a double. The argument was right and one helper short: the
            // third one exists, all three backends already emit it, and it
            // needs no tag because the value carries its own.
            //
            // **Resolved, not fulfilled.** An erased value can hold a promise,
            // and resolving with a promise adopts it -- the arm above that
            // does so is chosen from the type, and here only the tag knows.
            // Fulfilling stored the inner promise *as* the payload, and a
            // reader expecting a number found a promise and aborted where node
            // answers the inner's value.
            (HirType::Erased, Some(value)) => {
                ("nts_promise_resolve_value", vec![result.promise, value])
            }
        };
        Ok(self.runtime_call(helper, args, HirType::Void, origin))
    }

    /// `Symbol()` and `Symbol(description)`: a fresh identity every call.
    ///
    /// The description is optional and takes no part in what a symbol *is* --
    /// `Symbol("a") === Symbol("a")` is **false**, because each call allocates
    /// a cell and a symbol's identity is its address. So this is one
    /// allocation and nothing else, and the null description is the ordinary
    /// absent pointer rather than a second entry point.
    fn lower_symbol_new(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let description = match arguments {
            [] => self.push(
                OpKind::ConstNull,
                HirType::Managed(ManagedType::String),
                origin.clone(),
            ),
            [only] => {
                let value = self.lower_expression(*only)?;
                if !matches!(
                    self.values[value.0 as usize].ty,
                    HirType::Managed(ManagedType::String)
                ) {
                    return Err(self.unsupported(id, "a `Symbol` description that is not a string"));
                }
                value
            }
            _ => {
                return Err(self.unsupported(id, "a `Symbol` of more than one argument"));
            }
        };
        Ok(self.call_runtime(
            "nts_symbol_new",
            vec![description],
            HirType::Managed(ManagedType::Symbol),
            &origin,
        ))
    }

    /// `Symbol.for(key)`, which is the interning half of the feature.
    fn lower_symbol_for(&mut self, id: NodeId, argument: NodeId) -> Result<ValueId, Diagnostic> {
        let key = self.lower_expression(argument)?;
        if !matches!(
            self.values[key.0 as usize].ty,
            HirType::Managed(ManagedType::String)
        ) {
            return Err(self.unsupported(id, "a `Symbol.for` key that is not a string"));
        }
        let origin = self.origin(id);
        Ok(self.call_runtime(
            "nts_symbol_for",
            vec![key],
            HirType::Managed(ManagedType::Symbol),
            &origin,
        ))
    }

    /// `Symbol.keyFor(sym)`, whose answer is a string or `undefined`.
    ///
    /// The runtime answers with a null `NtsString *` for an unregistered
    /// symbol, which is the representation `string | undefined` already has --
    /// a pointer with one absent value -- so nothing is erased here.
    fn lower_symbol_key_for(
        &mut self,
        id: NodeId,
        argument: NodeId,
    ) -> Result<ValueId, Diagnostic> {
        let symbol = self.lower_expression(argument)?;
        if !matches!(
            self.values[symbol.0 as usize].ty,
            HirType::Managed(ManagedType::Symbol)
        ) {
            return Err(self.unsupported(id, "a `Symbol.keyFor` of something that is not a symbol"));
        }
        let origin = self.origin(id);
        Ok(self.call_runtime(
            "nts_symbol_key_for",
            vec![symbol],
            HirType::Managed(ManagedType::String),
            &origin,
        ))
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

    /// `new GtkButton({ label: "Hi" })`, where the construct signature the
    /// call resolved to carries `@ntsConstruct gtk_button_new`: that function,
    /// then the setter each property's `@ntsSet` names, in the order the
    /// literal writes them -- the literal is known here, so no object is built
    /// and no property is tested for presence. `None` for any other `new`.
    ///
    /// Any further names are functions called with nothing, each answering
    /// the constructor's next argument, the rest left to its defaults:
    /// `@ntsConstruct GtkLabel_construct gtk_label_get_type` is
    /// `g_object_new_with_properties(gtk_label_get_type(), 0, NULL, NULL)`.
    fn native_construct(&mut self, id: NodeId) -> Option<Result<ValueId, Diagnostic>> {
        if let Some(constructed) = self.gobject_new(id) {
            return Some(constructed);
        }
        let declaration = self.snapshot.call_targets.get(&id)?.callee?;
        if self.kind_of(declaration) != Some(syntax::CONSTRUCT_SIGNATURE) {
            return None;
        }
        if let Some(record) = self
            .snapshot
            .node_types
            .get(&id)
            .and_then(|ty| super::native::schema::boxed(self.snapshot, *ty))
        {
            return Some(self.new_boxed_record(id, &record));
        }
        let construct = self.node(declaration).native.as_ref()?.construct.clone()?;
        Some(self.lower_native_construct(id, &construct))
    }

    fn lower_native_construct(
        &mut self,
        id: NodeId,
        construct: &str,
    ) -> Result<ValueId, Diagnostic> {
        let construct = self.chosen_constructor(id, construct);
        // The head is `g_simple_action_new(name, parameter_type?)` whole,
        // spaces in its list included; a `GType` function may follow it.
        let (head, rest) = match (construct.find('('), construct.find(')')) {
            (Some(open), Some(close)) if open < close => {
                (&construct[..=close], &construct[close + 1..])
            }
            _ => construct
                .trim()
                .split_once(char::is_whitespace)
                .unwrap_or((construct.trim(), "")),
        };
        let head = head.trim();
        if head.is_empty() {
            return Err(self.unsupported(id, "@ntsConstruct naming no function"));
        }
        // `… with name names`: the construct-only properties a construction
        // by its `GType` can be given (`construct_with`).
        let (rest, with) = rest.split_once(" with ").unwrap_or((rest, ""));
        let with: Vec<&str> = with.split_whitespace().collect();
        let names = rest.split_whitespace();
        // `g_list_store_new(item_type)`: a class with construct-only
        // properties is made by the constructor that takes them, each the
        // literal's own; the rest are set as for any other.
        let (function, from): (&str, Vec<&str>) = match head.split_once('(') {
            Some((function, rest)) => (
                function,
                rest.trim_end_matches(')')
                    .split(',')
                    .map(str::trim)
                    .filter(|name| !name.is_empty())
                    .collect(),
            ),
            None => (head, Vec::new()),
        };
        let ty = self
            .snapshot
            .node_types
            .get(&id)
            .copied()
            .ok_or_else(|| self.unsupported(id, "a constructed handle with no type"))?;
        // The literal's values first, in the order it writes them -- the
        // literal is known here, so no object is built -- then the
        // constructor, then a setter for each value it did not take.
        let written = self.constructed_properties(id)?;
        if written
            .iter()
            .any(|property| with.contains(&property.name.as_str()))
        {
            let get_type = rest.split_whitespace().next().ok_or_else(|| {
                self.unsupported(id, "@ntsConstruct `with` and no `GType` function")
            })?;
            return self.construct_with(id, (function, get_type), &with, &written, ty);
        }
        let mut arguments = names
            .map(|name| self.call_foreign_named(id, name, Vec::new()).map(Some))
            .collect::<Result<Vec<_>, _>>()?;
        // `parameter_type?`: a nullable parameter, NULL where the literal
        // leaves it out.
        for name in &from {
            let (name, nullable) = name
                .strip_suffix('?')
                .map_or((*name, false), |name| (name, true));
            match written.iter().find(|written| written.name == name) {
                Some(written) => arguments.push(Some(written.value)),
                None if nullable => arguments.push(None),
                None => {
                    return Err(self.unsupported(
                        id,
                        &format!(
                            "a handle constructed without `{name}`, which its constructor takes"
                        ),
                    ));
                }
            }
        }
        let from: Vec<&str> = from.iter().map(|name| name.trim_end_matches('?')).collect();
        let handle = self.call_foreign_named_absent(id, function, arguments)?;
        self.set_constructed(id, handle, ty, &written, &from)?;
        Ok(handle)
    }

    /// GJS's `new Gio.ThemedIcon({ name })`: a construct-only property has
    /// no setter, so the object is built with it -- `{C}_builder(type)`,
    /// `{C}_with_{name}(builder, value)` for each the literal writes of
    /// those the tag lists (`with`), then `{C}_build`, owned as the class's
    /// `{C}_construct` view is -- and the literal's other properties are set
    /// as for any construction. `view` is that view's name (`GThemedIcon_construct`)
    /// and the class's `GType` function.
    fn construct_with(
        &mut self,
        id: NodeId,
        (view, get_type): (&str, &str),
        with: &[&str],
        written: &[SetProperty],
        ty: TypeId,
    ) -> Result<ValueId, Diagnostic> {
        let class = view.strip_suffix("_construct").ok_or_else(|| {
            self.unsupported(
                id,
                "@ntsConstruct `with` on a constructor that is not a view",
            )
        })?;
        let object_type = self.call_foreign_named(id, get_type, Vec::new())?;
        let builder =
            self.call_foreign_named(id, &format!("{class}_builder"), vec![object_type])?;
        let mut given = Vec::new();
        for property in written
            .iter()
            .filter(|property| with.contains(&property.name.as_str()))
        {
            // A props object passed through gives it only where present,
            // which a build given it unconditionally would not be.
            if property.present.is_some() {
                return Err(self.unsupported(
                    id,
                    &format!("a construct-only property `{}` given through a props object rather than a literal", property.name),
                ));
            }
            self.call_foreign_named(
                id,
                &format!("{class}_with_{}", property.name),
                vec![builder, property.value],
            )?;
            given.push(property.name.as_str());
        }
        let handle = self.call_foreign_named(id, &format!("{class}_build"), vec![builder])?;
        self.set_constructed(id, handle, ty, written, &given)?;
        Ok(handle)
    }

    /// Of a binding's constructors (`g_simple_action_new(name,
    /// parameter_type?) | g_simple_action_new_stateful(name, parameter_type?,
    /// state)`), the one GJS would call: of those whose required properties
    /// the literal writes, the one taking the most of what it writes, the
    /// fewest-taking first on a tie. A props object passed through, whose
    /// keys are not known here, gets the first.
    fn chosen_constructor<'c>(&self, id: NodeId, construct: &'c str) -> &'c str {
        let alternatives: Vec<&str> = construct.split(" | ").collect();
        let [first, ..] = alternatives.as_slice() else {
            return construct;
        };
        if alternatives.len() == 1 {
            return construct;
        }
        let written: Vec<String> = match self.arguments_of(id).as_slice() {
            [literal] if self.kind_of(*literal) == Some(syntax::OBJECT_LITERAL_EXPRESSION) => self
                .children(*literal)
                .into_iter()
                .filter_map(|property| self.member_name(property))
                .collect(),
            _ => return first,
        };
        let taken = |alternative: &str| -> Vec<String> {
            alternative
                .split_once('(')
                .map(|(_, rest)| {
                    rest.trim_end()
                        .trim_end_matches(')')
                        .split(',')
                        .map(|name| name.trim().to_owned())
                        .filter(|name| !name.is_empty())
                        .collect()
                })
                .unwrap_or_default()
        };
        let mut best: Option<(&str, usize)> = None;
        for alternative in &alternatives {
            let names = taken(alternative);
            if !names
                .iter()
                .filter(|name| !name.ends_with('?'))
                .all(|name| written.contains(name))
            {
                continue;
            }
            let covered = names
                .iter()
                .filter(|name| written.contains(&name.trim_end_matches('?').to_owned()))
                .count();
            if best.is_none_or(|(_, most)| covered > most) {
                best = Some((alternative, covered));
            }
        }
        best.map_or(first, |(alternative, _)| alternative)
    }

    /// The properties a handle's `new` is given.
    ///
    /// A literal's, in the order it writes them -- `{ label }` names the
    /// local, and a computed name is refused -- each set unconditionally,
    /// with no object built. Or a props object passed through, GJS's
    /// `super(props)`: each property its type declares, read from it and set
    /// where it is not `undefined`, strictly -- `{ child: null }` sets `child`
    /// to null. A construct-only property a constructor takes is read
    /// whether or not it is there, as the type requires it to be.
    fn constructed_properties(&mut self, id: NodeId) -> Result<Vec<SetProperty>, Diagnostic> {
        match self.arguments_of(id).as_slice() {
            [] => Ok(Vec::new()),
            [literal] if self.kind_of(*literal) == Some(syntax::OBJECT_LITERAL_EXPRESSION) => {
                let mut written = Vec::new();
                for property in self.children(*literal) {
                    let (name, value) = self.property_parts(property, None)?;
                    let name = name
                        .public_name()
                        .ok_or_else(|| {
                            self.unsupported(property, "a native property with a non-string key")
                        })?
                        .to_owned();
                    written.push(SetProperty {
                        name,
                        value,
                        node: property,
                        present: None,
                        unerase: None,
                    });
                }
                Ok(written)
            }
            [props] => self.passed_properties(*props),
            _ => Err(self.unsupported(id, "a handle constructed from more than one argument")),
        }
    }

    /// The properties of a props object passed to a construction, each with
    /// the test of whether it was given.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn passed_properties(&mut self, props: NodeId) -> Result<Vec<SetProperty>, Diagnostic> {
        let ty = *self
            .snapshot
            .node_types
            .get(&props)
            .ok_or_else(|| self.unsupported(props, "a props object with no type"))?;
        let Some(TypeKind::Object { properties }) = self
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| record.kind.clone())
        else {
            return Err(self.unsupported(props, "a props object whose type is not an object type"));
        };
        let object = self.lower_expression(props)?;
        let HirType::Managed(ManagedType::Object(represented)) = self.values[object.0 as usize].ty
        else {
            return Err(self.unsupported(
                props,
                "a props object that is not an object of the program's",
            ));
        };
        let layout = self.layout_of(props, represented)?;
        let origin = self.origin(props);
        let mut written = Vec::new();
        // The phantom members a binding marks its types with are not
        // properties: `__c_props`.
        for property in properties.iter().filter(|property| {
            !property
                .name
                .public_name()
                .is_some_and(|name| name.starts_with("__c_"))
        }) {
            let field = layout.index_of_key(&property.name).ok_or_else(|| {
                self.unsupported(
                    props,
                    &format!("a props object without a field for `{}`", property.name),
                )
            })?;
            let field_ty = layout.fields[field as usize].ty.clone();
            let value = self.push(
                OpKind::FieldGet { object, field },
                field_ty.clone(),
                origin.clone(),
            );
            let present = match field_ty {
                HirType::Erased => {
                    let unsigned = HirType::Int {
                        bits: 32,
                        signed: false,
                    };
                    let tag = self.push(OpKind::TagOf { value }, unsigned.clone(), origin.clone());
                    let undefined = self.push(
                        OpKind::ConstInt(i128::from(super::tags::UNDEFINED)),
                        unsigned,
                        origin.clone(),
                    );
                    Some(self.push(
                        OpKind::Binary {
                            op: BinOp::Ne,
                            lhs: tag,
                            rhs: undefined,
                        },
                        HirType::Bool,
                        origin.clone(),
                    ))
                }
                HirType::Managed(_) | HirType::NativePointer(_) if property.optional => {
                    let null = self.push(OpKind::ConstNull, field_ty, origin.clone());
                    Some(self.push(
                        OpKind::Binary {
                            op: BinOp::Ne,
                            lhs: value,
                            rhs: null,
                        },
                        HirType::Bool,
                        origin.clone(),
                    ))
                }
                _ => None,
            };
            // Read back where it was given, at the representation of what it is
            // when it is not `undefined`: an erased `sensitive?: boolean` is
            // the boolean the setter takes.
            let given = match self
                .snapshot
                .types
                .get(property.ty.0 as usize)
                .map(|record| &record.kind)
            {
                Some(TypeKind::Union(parts)) => {
                    let defined: Vec<TypeId> = parts
                        .iter()
                        .copied()
                        .filter(|part| {
                            !matches!(
                                self.snapshot
                                    .types
                                    .get(part.0 as usize)
                                    .map(|record| &record.kind),
                                Some(TypeKind::Undefined)
                            )
                        })
                        .collect();
                    // Each member's representation, where they share one --
                    // `boolean` is `true | false`, and an enum its members --
                    // as `present_of` reads a payload back.
                    let each: Option<Vec<HirType>> = defined
                        .iter()
                        .map(|part| self.represent_passed(*part))
                        .collect();
                    each.filter(|each| each.windows(2).all(|pair| pair[0] == pair[1]))
                        .and_then(|each| each.first().cloned())
                }
                _ => None,
            };
            let unerase = given.filter(|given| {
                self.values[value.0 as usize].ty == HirType::Erased && *given != HirType::Erased
            });
            written.push(SetProperty {
                name: property
                    .name
                    .public_name()
                    .ok_or_else(|| {
                        self.unsupported(props, "a native property with a non-string key")
                    })?
                    .to_owned(),
                value,
                node: props,
                present,
                unerase,
            });
        }
        Ok(written)
    }

    /// Each property a constructed handle was given and its constructor did
    /// not take (`except`), written through the setter its `@ntsSet` names.
    fn set_constructed(
        &mut self,
        id: NodeId,
        handle: ValueId,
        ty: TypeId,
        written: &[SetProperty],
        except: &[&str],
    ) -> Result<(), Diagnostic> {
        for SetProperty {
            name,
            value,
            node,
            present,
            unerase,
        } in written
            .iter()
            .filter(|written| !except.contains(&written.name.as_str()))
        {
            let setter = self.constructed_setter(*node, handle, ty, name)?;
            let Some(present) = present else {
                self.write_constructed(id, handle, ty, &setter, *value)?;
                continue;
            };
            let (set, after) = (self.new_block(), self.new_block());
            self.terminate(Terminator::Branch {
                cond: *present,
                then_target: set,
                then_args: Vec::new(),
                else_target: after,
                else_args: Vec::new(),
            });
            self.switch_to(set);
            let value = match unerase {
                Some(want) => {
                    let origin = self.origin(*node);
                    self.push(OpKind::unerase(*value), want.clone(), origin)
                }
                None => *value,
            };
            self.write_constructed(id, handle, ty, &setter, value)?;
            if !self.is_terminated() {
                self.terminate(Terminator::Jump {
                    target: after,
                    args: Vec::new(),
                });
            }
            self.switch_to(after);
        }
        Ok(())
    }

    /// How a construction writes the property `name` of `ty`: a binding's
    /// property through the method its `@ntsSet` names -- asked first, so a
    /// property a subclass inherits from its base is written as the base
    /// declares it -- and a property of a class the program writes (`title:
    /// Property<string>`) through the field of its state, as `note.title =
    /// ...` writes it, so it notifies. Anything else is refused by name.
    fn constructed_setter(
        &mut self,
        node: NodeId,
        handle: ValueId,
        ty: TypeId,
        name: &str,
    ) -> Result<ConstructedSetter, Diagnostic> {
        let bound = super::native::schema::property(self.snapshot, ty, name)
            .and_then(|record| record.declaration)
            .and_then(|declaration| self.node(declaration).native.as_ref())
            .and_then(|native| native.set.clone());
        if let Some(method) = bound {
            return Ok(ConstructedSetter::Method(method));
        }
        // Only a registered property: a plain field of the state (`plain = 1`)
        // is the program's own, and a construction sets properties, as GJS's
        // does -- a props object typed wider than `Properties<T>` must not
        // reach it.
        if let Some(state) = self.state_of_type(ty)
            && self.property_notify_thunk(state.1, name).is_some()
            && let Some(place) = self.state_place(node, handle, state, name)?
        {
            return Ok(ConstructedSetter::Field(place));
        }
        Err(self.unsupported(
            node,
            &format!("a constructed property `{name}` that is neither a binding's (no @ntsSet names a method for it) nor one the class registers (`Property<T>`)"),
        ))
    }

    fn write_constructed(
        &mut self,
        id: NodeId,
        handle: ValueId,
        ty: TypeId,
        setter: &ConstructedSetter,
        value: ValueId,
    ) -> Result<(), Diagnostic> {
        match setter {
            ConstructedSetter::Method(method) => self
                .lower_accessor_on(id, handle, ty, method, Some(value))
                .map(|_| ()),
            ConstructedSetter::Field(place) => self.write_place(id, place, value),
        }
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

    /// A foreign function a tag names, called at `id` with `arguments` and
    /// its defaults for the rest -- `Declared`, `Owned` and its tags applying
    /// as at any call of it. Found by its symbol: every binding's declarations
    /// are in the program, and a C name is one function wherever it is
    /// declared.
    fn call_foreign_named(
        &mut self,
        id: NodeId,
        function: &str,
        arguments: Vec<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        self.call_foreign_named_absent(id, function, arguments.into_iter().map(Some).collect())
    }

    /// As [`Self::call_foreign_named`], where an argument may be absent: a
    /// nullable parameter a construction's props left out, passed as the
    /// NULL its own type represents.
    fn call_foreign_named_absent(
        &mut self,
        id: NodeId,
        function: &str,
        arguments: Vec<Option<ValueId>>,
    ) -> Result<ValueId, Diagnostic> {
        let declaration = self
            .snapshot
            .symbols
            .iter()
            .filter(|symbol| symbol.name.is_name(function.as_ref()))
            .flat_map(|symbol| symbol.declarations.iter().copied())
            .find(|node| {
                self.kind_of(*node) == Some(syntax::FUNCTION_DECLARATION) && !self.has_a_body(*node)
            })
            .ok_or_else(|| {
                self.unsupported(
                    id,
                    &format!("a tag naming `{function}`, which no foreign function declares"),
                )
            })?;
        self.call_foreign_declaration_absent(id, declaration, function, arguments)
    }

    /// As [`Self::call_foreign_named`], of a declaration already in hand -- one
    /// a binding resolved within its module, where a name alone could find a
    /// namesake in another.
    fn call_foreign_declaration(
        &mut self,
        id: NodeId,
        declaration: NodeId,
        function: &str,
        arguments: Vec<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        self.call_foreign_declaration_absent(
            id,
            declaration,
            function,
            arguments.into_iter().map(Some).collect(),
        )
    }

    fn call_foreign_declaration_absent(
        &mut self,
        id: NodeId,
        declaration: NodeId,
        function: &str,
        arguments: Vec<Option<ValueId>>,
    ) -> Result<ValueId, Diagnostic> {
        // Its own signature, as a call of it would resolve: a symbol's type is
        // its declaration's (`node_types`), which the frontend records there
        // rather than on the symbol.
        let signature = std::iter::once(declaration)
            .chain(self.children(declaration))
            .find_map(|node| self.snapshot.node_types.get(&node).copied())
            .and_then(
                |ty| match self.snapshot.types.get(ty.0 as usize).map(|t| &t.kind) {
                    Some(TypeKind::Function(signature)) => Some(*signature),
                    #[expect(
                        clippy::match_same_arms,
                        reason = "keep audited semantic type variants explicit"
                    )]
                    Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => None,
                    _ => None,
                },
            )
            .ok_or_else(|| {
                self.unsupported(
                    id,
                    &format!("a tag naming `{function}`, whose signature is unknown"),
                )
            })?;
        let record = self.snapshot.signatures[signature.0 as usize].clone();
        let callee = self.native_callee(id, Some(declaration), function.to_owned(), &record)?;
        let Callee::Native(target) = &callee else {
            return Err(self.unsupported(
                id,
                &format!("a tag naming `{function}`, which is not foreign"),
            ));
        };
        let origin = self.origin(id);
        let mut given = Vec::with_capacity(arguments.len());
        for (at, argument) in arguments.into_iter().enumerate() {
            let value = if let Some(value) = argument {
                value
            } else {
                let ty = record
                    .parameters
                    .get(at)
                    // As a `null` written there is: the parameter as passed.
                    .and_then(|parameter| self.represent_passed(parameter.ty))
                    // A handle, or an array lent to C: what a `null` there is.
                    .filter(|ty| ty.is_managed() || matches!(ty, HirType::NativePointer(_)))
                    .ok_or_else(|| self.unsupported(id, &format!("`{function}` left without an argument that is not a nullable reference")))?;
                self.push(OpKind::ConstNull, ty, origin.clone())
            };
            given.push(value);
        }
        // The parameters past `arguments` by their `@ntsDefault`s, as a call
        // leaving them out gets them.
        let written = given.len();
        let mut arguments = given;
        let outer = self.omitting_for.replace((target.clone(), 0, id));
        let defaults = (written..record.parameters.len())
            .map(|at| self.omitted_by_default(at, &origin))
            .collect::<Option<Vec<_>>>();
        self.omitting_for = outer;
        arguments.extend(defaults.ok_or_else(|| {
            self.unsupported(id, &format!("a tag naming `{function}`, whose parameters past the {written} it is given are not all `@ntsDefault`ed"))
        })?);
        let (args, lent) = self.native_arguments(id, &target.clone(), arguments, written, None)?;
        let typed = target.call_result();
        self.finish_call_typed(id, callee, args, lent, Some(declaration), Some(typed))
    }

    /// A native handle's property as a place (`Place::NativeAccessor`):
    /// its methods, and the receiver, lowered once. A Windows Runtime
    /// property, reached through a slot rather than a method, is refused by
    /// name.
    fn native_accessor_place(
        &mut self,
        target: NodeId,
        object: NodeId,
        member: NodeId,
    ) -> Result<Place, Diagnostic> {
        let setter = self.accessor(member, true).ok_or_else(|| {
            self.unsupported(
                target,
                "an assignment to a native property no @ntsSet names a method for",
            )
        })?;
        let getter = self.accessor(member, false);
        if setter.contains(char::is_whitespace)
            || getter
                .as_deref()
                .is_some_and(|getter| getter.contains(char::is_whitespace))
        {
            return Err(self.unsupported(
                target,
                "reading a Windows Runtime property as part of assigning to it",
            ));
        }
        let ty = self
            .snapshot
            .node_types
            .get(&object)
            .copied()
            .ok_or_else(|| {
                self.unsupported(
                    target,
                    &format!("a native property whose accessor `{setter}` has no receiver type"),
                )
            })?;
        let receiver = self.lower_expression(object)?;
        Ok(Place::NativeAccessor {
            receiver,
            ty,
            getter,
            setter,
            takes_value: true,
        })
    }

    /// A native property's value through its `@ntsGet` method, for a place
    /// read before it is written; refused by name for one only written.
    fn read_native_accessor(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        ty: TypeId,
        getter: Option<&str>,
    ) -> Result<ValueId, Diagnostic> {
        let getter = getter.ok_or_else(|| {
            self.unsupported(id, "reading a native property no @ntsGet names a method for, as part of assigning to it")
        })?;
        self.lower_accessor_on(id, receiver, ty, getter, None)
    }

    /// Cooked literal pieces and substitutions in source order. An empty piece
    /// is a real string; raw-string access remains a separate named boundary.
    fn template_cooked(&self, token: NodeId) -> Result<nts_semantic_schema::JsText, Diagnostic> {
        self.node(token).text.clone().ok_or_else(|| {
            self.unsupported(
                token,
                "a tagged template with an undefined cooked entry from an invalid escape",
            )
        })
    }

    fn template_parts(
        &mut self,
        template: NodeId,
    ) -> Result<(Vec<nts_semantic_schema::JsText>, Vec<NodeId>), Diagnostic> {
        let mut pieces = Vec::new();
        let mut substitutions: Vec<NodeId> = Vec::new();
        match self.kind_of(template) {
            Some(syntax::NO_SUBSTITUTION_TEMPLATE_LITERAL) => {
                pieces.push(self.template_cooked(template)?);
            }
            Some(syntax::TEMPLATE_EXPRESSION) => {
                for part in self.children(template) {
                    match self.kind_of(part) {
                        Some(syntax::TEMPLATE_HEAD) => {
                            pieces.push(self.template_cooked(part)?);
                        }
                        Some(syntax::TEMPLATE_SPAN) => {
                            let inner = self.children(part);
                            let [expression, literal] = inner.as_slice() else {
                                return Err(
                                    self.unsupported(part, "a template span of unexpected shape")
                                );
                            };
                            substitutions.push(*expression);
                            pieces.push(self.template_cooked(*literal)?);
                        }
                        _ => {
                            return Err(
                                self.unsupported(part, "a template part of unexpected shape")
                            );
                        }
                    }
                }
            }
            _ => return Err(self.unsupported(template, "a tagged template over this literal")),
        }
        Ok((pieces, substitutions))
    }

    fn lower_tagged_template(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let children = self.children(id);
        let [tag, template] = children.as_slice() else {
            return Err(self.unsupported(id, "a tagged template of unexpected shape"));
        };
        let (tag, template) = (*tag, *template);
        self.a_raising_body_carries_this_call(id)?;
        let target = self
            .snapshot
            .call_targets
            .get(&id)
            .copied()
            .ok_or_else(|| self.unresolved_call(id))?;
        let declaration = self
            .direct_callee(target.callee, tag)
            .filter(|declaration| {
                self.kind_of(*declaration) == Some(syntax::FUNCTION_DECLARATION)
                    && self.defines(*declaration)
            })
            .filter(|_| {
                !self
                    .node(tag)
                    .symbol
                    .is_some_and(|symbol| self.bindings.contains_key(&symbol.0))
            })
            .ok_or_else(|| {
                self.unsupported(
                    id,
                    "a tagged template whose tag is not a plain declared function",
                )
            })?;

        let (pieces, substitutions) = self.template_parts(template)?;

        let origin = self.origin(id);
        let strings = self.push(
            OpKind::ConstTemplate {
                site: id.0,
                cooked: pieces,
            },
            HirType::Managed(ManagedType::Template),
            origin,
        );

        let arguments: Vec<Argument> = std::iter::once(Argument {
            node: template,
            value: Some(strings),
        })
        .chain(substitutions.into_iter().map(Argument::expression))
        .collect();
        let args = self.lower_argument_values(id, &arguments, None, None)?;
        let name = self.emitted_callee_name(Some(declaration), tag)?;
        let specialization = self.calls.suffix(id).map_or("", String::as_str);
        let name = format!("{name}{specialization}{}", self.raising_suffix_of(id));
        self.push_call(id, Callee::Direct(name), args, Some(declaration), None)
    }

    fn lower_template(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let text = HirType::Managed(ManagedType::String);
        let mut result: Option<ValueId> = None;

        for part in self.children(id) {
            match self.kind_of(part) {
                Some(syntax::TEMPLATE_HEAD) => {
                    let literal = self.node(part).text.clone().unwrap_or_default();
                    if !literal.is_empty() {
                        let origin = self.origin(part);
                        result =
                            Some(self.push(OpKind::ConstString(literal), text.clone(), origin));
                    }
                }
                Some(syntax::TEMPLATE_SPAN) => {
                    let pieces = self.children(part);
                    let [expression, literal] = pieces.as_slice() else {
                        return Err(self.unsupported(part, "a template span of unexpected shape"));
                    };
                    let value = self.lower_expression(*expression)?;
                    let value = self.as_string(*expression, value)?;
                    result = Some(self.join(part, result, value, &text));

                    let literal_text = self.node(*literal).text.clone().unwrap_or_default();
                    if !literal_text.is_empty() {
                        let origin = self.origin(*literal);
                        let piece =
                            self.push(OpKind::ConstString(literal_text), text.clone(), origin);
                        result = Some(self.join(part, result, piece, &text));
                    }
                }
                _ => return Err(self.unsupported(part, "a template part of unexpected shape")),
            }
        }

        // `` `` `` has no parts at all, and a template of empty ones reduces to
        // the same nothing. Both are the empty string.
        if let Some(value) = result {
            return Ok(value);
        }
        let origin = self.origin(id);
        Ok(self.push(OpKind::ConstString("".into()), text, origin))
    }

    /// Concatenate onto what a template has built so far, or start it.
    fn join(
        &mut self,
        at: NodeId,
        left: Option<ValueId>,
        right: ValueId,
        text: &HirType,
    ) -> ValueId {
        let Some(left) = left else {
            return right;
        };
        let origin = self.origin(at);
        self.push(
            OpKind::Binary {
                op: BinOp::Concat,
                lhs: left,
                rhs: right,
            },
            text.clone(),
            origin,
        )
    }

    fn implicit_printer_callees(&self, node: NodeId) -> Vec<NodeId> {
        self.printers
            .at(node)
            .iter()
            .filter_map(|at| {
                let target = &self.printers.targets[*at];
                self.throwing
                    .contains(&target.symbol)
                    .then_some(target.declaration)
            })
            .collect()
    }

    /// A descriptor callback returns NULL with the original payload pending.
    /// This language boundary takes it exactly once and uses the ordinary
    /// throw path, including finally and an uncaught ordinary caller. Runtime
    /// forwarders never take it; `emit_the_raise_test`'s no-handler return is
    /// insufficient here because this function need not be a raising copy.
    fn printer_text(&mut self, from: NodeId, value: ValueId) -> Result<ValueId, Diagnostic> {
        let mut represented = value;
        while let OpKind::Erase { value: inner, .. } = self.values[represented.0 as usize].kind {
            represented = inner;
        }
        let candidates =
            self.printers
                .for_conversion(self, from, &self.values[represented.0 as usize].ty);
        let entries = self.printers.raising_entries(&candidates, self.throwing);
        let origin = self.origin(from);
        let text = self.runtime_call(
            "nts_value_to_string",
            vec![value],
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        if !entries.is_empty() {
            let flag_type = HirType::Int {
                bits: 32,
                signed: true,
            };
            let flag =
                self.runtime_call("nts_raising", Vec::new(), flag_type.clone(), origin.clone());
            self.arrivals.pending_printer_checks.push(printed::Check {
                function: String::new(),
                flag,
                entries,
            });
            let zero = self.push(OpKind::ConstInt(0), flag_type, origin.clone());
            let raised = self.push(
                OpKind::Binary {
                    op: BinOp::Ne,
                    lhs: flag,
                    rhs: zero,
                },
                HirType::Bool,
                origin.clone(),
            );
            let took = self.new_block();
            let carry_on = self.new_block();
            self.terminate(Terminator::Branch {
                cond: raised,
                then_target: took,
                then_args: Vec::new(),
                else_target: carry_on,
                else_args: Vec::new(),
            });
            self.switch_to(took);
            self.lower_arm(|this| {
                let thrown =
                    this.runtime_call("nts_raise_take", Vec::new(), HirType::Erased, origin);
                this.throw_erased(from, thrown, thrown, &HirType::Erased)
            })?;
            self.switch_to(carry_on);
        }
        Ok(text)
    }

    fn as_string(&mut self, from: NodeId, value: ValueId) -> Result<ValueId, Diagnostic> {
        let text = HirType::Managed(ManagedType::String);
        match self.values[value.0 as usize].ty {
            // A `string | null` is one pointer and the null in it is not a
            // string. Passing it through handed the concatenation a null
            // pointer, and the program aborted on the first thing that read it
            // -- which the differential reports as a *declined* case rather
            // than a disagreement, so "agreed on every case" was counting only
            // the runs that reached the end.
            //
            // `String(null)` is "null" and `String(undefined)` is "undefined".
            // Which one is a property of the type, exactly as it is for `===`.
            HirType::Managed(ManagedType::String)
                if matches!(self.absences_of(from).as_deref(), Some([_])) =>
            {
                let absent = self.absences_of(from).unwrap_or_default();
                let spelling = if absent.first() == Some(&super::tags::NULL) {
                    "null"
                } else {
                    "undefined"
                };
                let origin = self.origin(from);
                let when_absent = self.push(
                    OpKind::ConstString(spelling.to_owned().into()),
                    text,
                    origin,
                );
                // The type is that absence and nothing else -- what the checker
                // leaves a binding at after `v = null`. There is no branch to
                // build, and trying to build one asked for the representation
                // of `null`, which there is none of.
                if self.only_absences(from) {
                    return Ok(when_absent);
                }
                let Some(condition) = self.absence_of(from, value) else {
                    return Ok(value);
                };
                self.lower_branching_value(
                    from,
                    condition,
                    Branch::Value(when_absent),
                    Branch::Value(value),
                )
            }
            HirType::Managed(ManagedType::String) => Ok(value),
            // An erased value carries the tag that says which spelling it
            // wants, and the runtime spells every one: a primitive as itself,
            // an object or a function as its type says, off its descriptor
            // (`Program::printed`), and a tuple or a `Date` by a refusal naming
            // it. So `String(unknown)` converts, and what the value turns out
            // to be decides the text, as in node.
            //
            // `String(xs.pop())` -- `number | undefined` -- is the absent answer
            // surviving the conversion, which a typed `double` could not carry.
            HirType::Erased => self.printer_text(from, value),
            // A `bool` and a `bigint` each have an exact spelling of their
            // own: two words, and decimal with no exponent however large.
            // Neither is something a double's formatter can be handed.
            HirType::Float { .. } | HirType::Int { .. } | HirType::Bool | HirType::BigInt => {
                let helper = match self.values[value.0 as usize].ty {
                    HirType::Bool => "nts_bool_to_string",
                    HirType::BigInt => "nts_bigint_to_string",
                    _ => "nts_number_to_string",
                };
                let origin = self.origin(from);
                Ok(self.push(
                    OpKind::Call {
                        callee: Callee::External(helper.to_owned()),
                        args: vec![value],
                        frame: None,
                    },
                    text,
                    origin,
                ))
            }
            // `String(sym)` is `SymbolDescriptiveString` -- `"Symbol("`, the
            // description, `")"` -- and it is the one conversion the language
            // *only* allows through `String`: `sym + ""` throws a `TypeError`
            // by 13.15.3, which is why this arm exists and no implicit
            // coercion reaches it.
            //
            // `nts_symbol_to_string` already exists in all three backends --
            // the C runtime, `hir::runtime`'s table, LLVM's signatures and the
            // JVM's `ops` -- so this arm is the whole of the feature. It was
            // reached the moment `typeof v === "symbol"` on an `unknown`
            // stopped being refused, which is `determineSpecificType`'s next
            // link in `runtime/node/internal/errors.ts`.
            // **A class's own `toString`.** `${o}`, `"" + o` and `String(o)`
            // all convert through it -- `ToPrimitive` with hint string calls
            // it -- so the receiver's class decides what the conversion means,
            // and where the static type declares one the conversion is a
            // direct call. An object whose chain declares none prints
            // `"[object Object]"`, through the arm below. That used to be
            // refused, on the argument that eight constant characters would
            // make a missing method look like a working one; but it is what
            // node prints, and a compiler that differs from node to warn about
            // a program's design is the wrong place for the warning.
            HirType::Managed(ManagedType::Symbol) => {
                let origin = self.origin(from);
                Ok(self.push(
                    OpKind::Call {
                        callee: Callee::External("nts_symbol_to_string".to_owned()),
                        args: vec![value],
                        frame: None,
                    },
                    text,
                    origin,
                ))
            }
            // **Any other object prints as its type says**, read off its
            // descriptor at run time (`Program::printed`): `"[object Object]"`
            // for one whose chain adds nothing, the error rule for an `Error`,
            // the elements joined for an array, `"[object Map]"` and its kin.
            // Through the conversion an erased value takes, so a typed object
            // and the same object erased cannot print differently.
            HirType::Managed(_) if self.prints_off_its_descriptor(value) => {
                let erased = self.coerce(value, &HirType::Erased, from)?;
                self.printer_text(from, erased)
            }
            _ => {
                let named = self.describe_node(from);
                Err(self.unsupported(from, &format!("a conversion to string from {named}")))
            }
        }
    }

    /// Whether a typed object converts to a string through its descriptor, as
    /// an erased one does: every object but those the type proves the runtime
    /// would refuse, which are refused here instead -- a `Date`, whose text
    /// depends on the time zone, and a tuple, which is laid out as a record and
    /// not as the array node joins.
    fn prints_off_its_descriptor(&self, value: ValueId) -> bool {
        match &self.values[value.0 as usize].ty {
            HirType::Managed(ManagedType::Date) => false,
            HirType::Managed(ManagedType::Object(ty)) => !matches!(
                self.snapshot
                    .types
                    .get(ty.0 as usize)
                    .map(|record| &record.kind),
                Some(TypeKind::Tuple(_))
            ),
            HirType::Managed(_) => true,
            _ => false,
        }
    }

    /// Whether every member of a node's type prints the same under `String()`
    /// and `util.inspect`, which `console.log` uses: a number, a string, a
    /// boolean, a bigint, a symbol, `null` and `undefined`. An object's two
    /// texts differ -- `"[object Object]"` against `{ a: 1 }` -- so it is not
    /// one of them, and `nts_value_inspect` refuses it by name.
    fn spells_itself(&self, node: NodeId) -> bool {
        let Some(ty) = self.snapshot.node_types.get(&node) else {
            return false;
        };
        let Some(record) = self.snapshot.types.get(ty.0 as usize) else {
            return false;
        };
        let members: Vec<TypeId> = match &record.kind {
            TypeKind::Union(members) => members.clone(),
            _ => vec![*ty],
        };
        members.iter().all(|member| {
            self.snapshot
                .types
                .get(member.0 as usize)
                .is_some_and(|record| {
                    matches!(
                        record.kind,
                        TypeKind::Number
                            | TypeKind::String
                            | TypeKind::Boolean
                            | TypeKind::BigInt
                            | TypeKind::Null
                            | TypeKind::Undefined
                            | TypeKind::Void
                            // `String(sym)` is `SymbolDescriptiveString`, and
                            // `nts_value_to_string` spells it from the tag like
                            // every other member here. Added when
                            // `String(type)` on a `string | symbol` turned out
                            // to be under `EventEmitter#on`.
                            //
                            | TypeKind::Symbol
        | TypeKind::UniqueSymbol
                            | TypeKind::Literal(_)
                    )
                })
        })
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

    /// `String.fromCodePoint(x)` throws a `RangeError` for anything that is
    /// not a code point.
    ///
    /// The specification is: throw unless `x` is an integer in
    /// `[0, 0x10FFFF]`. Three tests, and the third earns its place twice --
    /// `NaN` fails every comparison, so `x < 0` and `x > 0x10FFFF` are both
    /// false for it, and only `x !== trunc(x)` catches it. `-0` is an integer
    /// and is not less than zero, which is the answer.
    ///
    /// Here rather than in the runtime, and that is the whole point: the C
    /// helper printed the value and called `abort()`, so `ucs2.encode([NaN])`
    /// took the process down where node throws something catchable. A runtime
    /// cannot fix that on its own -- a `RangeError` is laid out by the
    /// *program*, and the descriptor lives in the generated file -- so the
    /// check belongs where the class can be built. Putting it in HIR also
    /// means the JVM lane, which has its own `fromCodePoint`, is guarded by
    /// the same three tests rather than by a second copy of them.
    fn guard_code_point(&mut self, id: NodeId, point: ValueId) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let below = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: point,
                rhs: zero,
            },
            HirType::Bool,
            origin.clone(),
        );
        let throwing = self.new_block();
        let second = self.new_block();
        let third = self.new_block();
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: below,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: second,
            else_args: Vec::new(),
        });

        self.switch_to(second);
        let ceiling = self.push(
            OpKind::ConstFloat(1_114_111.0),
            HirType::NUMBER,
            origin.clone(),
        );
        let above = self.push(
            OpKind::Binary {
                op: BinOp::Gt,
                lhs: point,
                rhs: ceiling,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: above,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: third,
            else_args: Vec::new(),
        });

        self.switch_to(third);
        let truncated = self.push(
            OpKind::Unary {
                op: UnOp::Trunc,
                operand: point,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let whole = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: point,
                rhs: truncated,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: whole,
            then_target: carry_on,
            then_args: Vec::new(),
            else_target: throwing,
            else_args: Vec::new(),
        });

        self.switch_to(throwing);
        // The value is in the message, because node's is: `Invalid code point
        // 1.5`, not a fixed sentence. That is the one place a provided error
        // needs a message it cannot spell as a constant, which is why
        // `throw_provided_error` grew a form taking the text as a value.
        let text = HirType::Managed(ManagedType::String);
        let prefix = self.push(
            OpKind::ConstString("Invalid code point ".into()),
            text.clone(),
            origin.clone(),
        );
        let printed = self.runtime_call(
            "nts_number_to_string",
            vec![point],
            text.clone(),
            origin.clone(),
        );
        let message = self.runtime_call("nts_concat", vec![prefix, printed], text, origin);
        self.throw_provided_error_text(id, "RangeError", message)?;
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: carry_on,
                args: Vec::new(),
            });
        }
        self.switch_to(carry_on);
        Ok(())
    }

    /// `new Date(ms)`.
    ///
    /// One argument and one allocation. The normalisation the specification
    /// calls `TimeClip` -- truncate toward zero, NaN outside +/-8.64e15 -- is
    /// the runtime's, done once at construction rather than at every read,
    /// because it is observable: `new Date(1.5).getTime()` is 1.
    ///
    /// **`new Date()` with no argument is refused**, and so is `Date.now()`.
    /// Both read a wall clock this runtime has no capability for, and neither
    /// could be checked if it did: the differential compares against node, and
    /// node would answer with its instant and this with a later one. That is
    /// the same reason `Math.random` is absent -- "the one member of the family
    /// no differential can check".
    fn lower_new_date(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let arguments = self.arguments_of(id);
        let [only] = arguments.as_slice() else {
            return Err(self.unsupported(
                id,
                "a `new Date` with no argument, which reads a clock this compiler has no \
                 capability for and no differential could check",
            ));
        };
        let ms = self.lower_expression(*only)?;
        let ms = self.coerce(ms, &HirType::NUMBER, id)?;
        let origin = self.origin(id);
        Ok(self.call_runtime(
            "nts_date_new",
            vec![ms],
            HirType::Managed(ManagedType::Date),
            &origin,
        ))
    }

    /// `new Promise<T>(executor)`.
    ///
    /// # The executor is not a function here
    ///
    /// `new Promise(f)` calls `f` *synchronously*, before the constructor
    /// returns. So when `f` is written at the call -- which is how essentially
    /// every one of them is written -- its body belongs at the construction
    /// site, and `resolve` and `reject` are not values that have to exist. A
    /// call to `resolve` is the settle it stands for, which is the same helper
    /// an `async` function's `return` emits.
    ///
    /// That is the whole reason this needs no closure over the promise, which
    /// is what made the feature look hard. The promise is a local, `resolve(v)`
    /// is `nts_promise_fulfill_*(p, v)`, and nothing is captured by anything.
    ///
    /// The same shape, and the same refusal, as an array method whose callback
    /// is not an arrow written at the call: an executor that arrives as a name
    /// is a genuine indirect call, and answering it needs a real closure over
    /// the promise rather than a harder version of this.
    fn lower_new_promise(
        &mut self,
        id: NodeId,
        ty: &HirType,
        payload: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        let arguments = self.arguments_of(id);
        let [executor] = arguments.as_slice() else {
            return Err(self.unsupported(id, "a `new Promise` with more than an executor"));
        };
        let executor = *executor;
        if self.kind_of(executor) != Some(syntax::ARROW_FUNCTION) {
            return Err(self.unsupported(
                id,
                "a `new Promise` whose executor is not an arrow written at the call",
            ));
        }
        let names = self.callback_parameters(executor, "Promise")?;
        if names.len() > 2 {
            return Err(self.unsupported(executor, "a `new Promise` executor of this shape"));
        }
        let Some(&body) = self.children(executor).last() else {
            return Err(self.unsupported(executor, "a `new Promise` executor with no body"));
        };

        let origin = self.origin(id);
        let promise = self.runtime_call("nts_promise_new", Vec::new(), ty.clone(), origin);
        let result = AsyncResult {
            promise,
            payload: payload.clone(),
            written: None,
        };

        // Saved and restored rather than inserted and removed: an executor
        // nested inside another one rebinds the same names, and the outer
        // meanings have to come back when it ends.
        let outer = self.settlers.clone();
        for (at, symbol) in names.into_iter().enumerate() {
            self.settlers.insert(
                symbol,
                Settler {
                    result: result.clone(),
                    rejects: at == 1,
                },
            );
        }
        // A concise body is an expression whose value the executor discards --
        // `new Promise(r => r(n))` is the shortest spelling there is.
        let lowered = if self.kind_of(body) == Some(syntax::BLOCK) {
            self.lower_statement(body)
        } else {
            self.lower_expression(body).map(|_| ())
        };
        self.settlers = outer;
        lowered?;

        Ok(promise)
    }

    /// `resolve(v)` or `reject(e)` inside a `new Promise` executor.
    ///
    /// `None` when this call is an ordinary one, which is every call in a
    /// program that is not inside an executor.
    fn lower_settler_call(&mut self, id: NodeId) -> Result<Option<ValueId>, Diagnostic> {
        if self.settlers.is_empty() {
            return Ok(None);
        }
        let Some(&callee) = self.children(id).first() else {
            return Ok(None);
        };
        if self.kind_of(callee) != Some(syntax::IDENTIFIER) {
            return Ok(None);
        }
        let Some(symbol) = self.node(callee).symbol else {
            return Ok(None);
        };
        let Some(settler) = self.settlers.get(&symbol.0).cloned() else {
            return Ok(None);
        };

        let arguments = self.arguments_of(id);
        let value = match arguments.as_slice() {
            [] => None,
            [one] => Some(self.lower_expression(*one)?),
            _ => {
                return Err(self.unsupported(
                    id,
                    "a `resolve` or `reject` with more than one \
                                                 argument",
                ));
            }
        };

        // **Only while the pair is unspent.** The specification gives
        // `resolve` and `reject` one `alreadyResolved` flag between them, and
        // it is not the same as being settled: `resolve(p)` with a promise
        // leaves this one pending until `p` settles, and a `resolve(v)` or
        // `reject(e)` in that window is ignored. The settle helpers refuse only
        // a promise that has already settled, so without this
        // `r(later); r(1)` answered 1 where node waits for `later`.
        //
        // The argument is evaluated first either way, as a call's arguments
        // are before the callee runs. An executor's pair is the promise's
        // first, numbered 0 -- see `nts_promise_claim`.
        let origin = self.origin(id);
        let pair = self.push(
            OpKind::ConstInt(0),
            HirType::Int {
                bits: 32,
                signed: false,
            },
            origin.clone(),
        );
        let live = self.runtime_call(
            "nts_promise_claim",
            vec![settler.result.promise, pair],
            HirType::Bool,
            origin.clone(),
        );
        let settles = self.new_block();
        let join = self.new_block();
        self.terminate(Terminator::Branch {
            cond: live,
            then_target: settles,
            then_args: Vec::new(),
            else_target: join,
            else_args: Vec::new(),
        });
        self.switch_to(settles);
        if settler.rejects {
            self.reject_with(id, settler.result.promise, value)?;
        } else {
            self.settle(id, &settler.result, value)?;
        }
        self.terminate(Terminator::Jump {
            target: join,
            args: Vec::new(),
        });
        self.switch_to(join);
        Ok(Some(self.push(
            OpKind::ConstUndefined,
            HirType::Void,
            origin,
        )))
    }

    /// Reject `promise` with `reason`, or refuse.
    ///
    /// **One rejection path, because there were two and they disagreed.** A
    /// rejection reason is `any` and the runtime takes a reference:
    /// `reject(new Error(m))` and `reject("text")` are both one, and `reject(7)`
    /// is not. Refused rather than boxed, because a number written into the
    /// reason slot is a pointer the collector would follow.
    ///
    /// `Promise.withResolvers`'s settle was written as a second copy of this
    /// and left the check out. It did not refuse and it did not box: it emitted
    /// `nts_promise_reject(p, (NtsHeader *)v)` over a `NtsValue`, and clang said
    /// `operand of type 'NtsValue' where arithmetic or pointer type is
    /// required` -- eleven of them in `assert`, which is a module that does not
    /// write `withResolvers` at all and reaches one through `web-platform`.
    fn reject_with(
        &mut self,
        id: NodeId,
        promise: ValueId,
        reason: Option<ValueId>,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        let Some(reason) = reason else {
            return Err(self.unsupported(id, "a `reject` with no reason"));
        };
        // **`Erased` needs the other helper, and saying so was missing here.**
        // `nts_promise_reject` takes an `NtsHeader *`; an erased value is an
        // `NtsValue`, a sixteen-byte tagged struct, and the emitter cast one to
        // the other -- `operand of type 'NtsValue' where arithmetic or pointer
        // type is required`, from clang, on C that `emit-c` had already exited
        // zero over. `nts_promise_reject_value` reads the reference out of the
        // tag, which is what an `async` function's `throw` of a rethrown
        // `catch (e)` has always done; this path listed `Erased` as acceptable
        // and then emitted the wrong call for it.
        //
        // Reachable before `Promise.withResolvers` existed, and measured on the
        // pinned binary: `Promise.reject(x)` and `new Promise((_, r) => r(x))`
        // with an `unknown` reason both emit C clang refuses. Nothing in the
        // corpus got that far, because `web-platform`'s streams -- where every
        // such reason lives -- were refused earlier for a different reason.
        let helper = match self.values[reason.0 as usize].ty {
            HirType::Erased => "nts_promise_reject_value",
            HirType::Managed(_) => "nts_promise_reject",
            _ => {
                return Err(
                    self.unsupported(id, "a `reject` with a reason that is not a reference")
                );
            }
        };
        Ok(self.runtime_call(helper, vec![promise, reason], HirType::Void, origin))
    }

    /// `s[i]` where `s` is a string, which is a one-unit string rather than an
    /// element of anything.
    ///
    /// `None` where the receiver is not a string, so the array path runs
    /// unchanged. Decided from the *checker's* type rather than by lowering the
    /// receiver and looking, because the array path lowers it again and a
    /// receiver with a side effect would then have it twice.
    ///
    /// Two of the seven things `runtime/node/path` could not compile were this,
    /// both in the same shape: `path[i]` inside a loop bounded by
    /// `path.length`, and `ext[0]` guarded by `ext` being non-empty.
    fn lower_string_index(&mut self, id: NodeId) -> Result<Option<ValueId>, Diagnostic> {
        let children = self.children(id);
        let [object, index] = children.as_slice() else {
            return Ok(None);
        };
        if !matches!(
            self.type_of(*object),
            Some(HirType::Managed(ManagedType::String))
        ) {
            return Ok(None);
        }
        let (receiver, guard) = access::receiver(self, *object)?;
        let at = self.lower_expression(*index)?;
        if let Some(guard) = guard {
            let key = access::index_key(self, id, at);
            access::require(self, id, &guard, &key, false)?;
        }
        let origin = self.origin(id);
        Ok(Some(self.runtime_call(
            "nts_str_at",
            vec![receiver, at],
            HirType::Managed(ManagedType::String),
            origin,
        )))
    }

    /// A read an object system answers rather than a field: an Objective-C
    /// property, which is a message, and the one named read through a handle
    /// that is not refused in [`Self::lower_property_access`]; and
    /// `Task.$gtype`, a `GObject` class's `GType`.
    fn foreign_property_read(&mut self, id: NodeId) -> Result<Option<ValueId>, Diagnostic> {
        let [object, member] = self.children(id)[..] else {
            return Ok(None);
        };
        if let Some(value) = self.lower_objc_property_get(id, object, member)? {
            return Ok(Some(value));
        }
        self.gtype_read(id, object, member).transpose()
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

    /// `+x` with `x` a bigint, which is a `TypeError` whatever the value:
    /// implicit `ToNumber` of a `BigInt` throws. One fact for the lowering
    /// ([`Self::throw_to_number_of_a_bigint`]) and for the effect analysis
    /// that decides which handler can catch it.
    fn plus_of_a_bigint(&self, id: NodeId) -> bool {
        self.kind_of(id) == Some(syntax::PREFIX_UNARY_EXPRESSION)
            && matches!(self.node(id).data, nts_semantic_schema::NodeData::Children { small, .. }
                if small & syntax::prefix_operator::MASK == syntax::prefix_operator::PLUS)
            && self
                .children(id)
                .last()
                .and_then(|operand| self.type_of(*operand))
                == Some(HirType::BigInt)
    }

    /// The `TypeError` `+1n` is. What follows the throw is unreachable, and
    /// answers NaN only so the expression has a value to be.
    fn throw_to_number_of_a_bigint(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        self.throw_provided_error(id, "TypeError", "Cannot convert a BigInt value to a number")?;
        let unreachable = self.new_block();
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: unreachable,
                args: Vec::new(),
            });
        }
        self.switch_to(unreachable);
        let origin = self.origin(id);
        Ok(self.push(OpKind::ConstFloat(f64::NAN), HirType::NUMBER, origin))
    }

    /// `n.toString(radix)`, with node's domain check in front of it.
    ///
    /// Lifted out of [`Self::lower_method_call`] for length, and the split is
    /// where it would be anyway: everything here is about the *argument* having
    /// a domain, and nothing above it is.
    fn lower_radix_to_string(
        &mut self,
        id: NodeId,
        value: ValueId,
        radix: ValueId,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let origin = origin.clone();
        // `(5).toString(1)` is a `RangeError` in node and a string
        // here, until this. The differential found it on the first run
        // -- it feeds arbitrary numbers, and nine of its cases were a
        // radix node refuses -- which is the whole argument for
        // comparing against node rather than against an expectation:
        // nothing in the source or the fixture says the argument has a
        // domain, and node says so nine times.
        //
        // The bound belongs here rather than in the runtime because a
        // provided `RangeError` is a *class*, and the runtime has no
        // way to construct one. That asymmetry is what
        // `throw_provided_error_text` exists for.
        //
        // The specification bounds `ToIntegerOrInfinity(radix)`, not the
        // number, and the two comparisons below are that bound exactly, with
        // no truncation emitted (`guard_repeat_count` makes the same move):
        // the integer is below 2 precisely when `!(radix >= 2)` -- which a
        // `NaN` satisfies, as `ToIntegerOrInfinity(NaN)` is 0 -- and above
        // 36 precisely when `radix >= 37`. Comparing the number itself let a
        // `NaN` through to the runtime's `(int)` and threw for `36.5`, which
        // node reads as base 36. The Wasm lane found both.
        let throwing = self.new_block();
        let carry_on = self.new_block();
        let two = self.push(OpKind::ConstFloat(2.0), HirType::NUMBER, origin.clone());
        let at_least_two = self.push(
            OpKind::Binary {
                op: BinOp::Ge,
                lhs: radix,
                rhs: two,
            },
            HirType::Bool,
            origin.clone(),
        );
        let checking = self.new_block();
        self.terminate(Terminator::Branch {
            cond: at_least_two,
            then_target: checking,
            then_args: Vec::new(),
            else_target: throwing,
            else_args: Vec::new(),
        });

        self.switch_to(checking);
        let thirty_seven = self.push(OpKind::ConstFloat(37.0), HirType::NUMBER, origin.clone());
        let above = self.push(
            OpKind::Binary {
                op: BinOp::Ge,
                lhs: radix,
                rhs: thirty_seven,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: above,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });

        self.switch_to(throwing);
        // Node's exact sentence, and it names no value: `RangeError:
        // toString() radix must be between 2 and 36`.
        let text = HirType::Managed(ManagedType::String);
        let message = self.push(
            OpKind::ConstString("toString() radix must be between 2 and 36".into()),
            text,
            origin.clone(),
        );
        self.throw_provided_error_text(id, "RangeError", message)?;
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: carry_on,
                args: Vec::new(),
            });
        }

        self.switch_to(carry_on);
        Ok(self.runtime_call(
            "nts_number_to_string_radix",
            vec![value, radix],
            HirType::Managed(ManagedType::String),
            origin,
        ))
    }

    /// The methods a **number** receiver has here.
    ///
    /// Its own function because `lower_method_on` is at the line limit and this
    /// is the self-contained part: every arm tests the same `name` and none of
    /// them looks at anything the caller still needs.
    fn lower_number_method(
        &mut self,
        id: NodeId,
        receiver_node: NodeId,
        receiver: ValueId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let name = self
            .node(member)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)
            .unwrap_or_default();
        if name == "toString" && arguments.is_empty() {
            return self.as_string(receiver_node, receiver);
        }
        // `n.toString(radix)`, which is three calls from every module's
        // front door: `ERR_INVALID_ARG_TYPE` renders the offending value
        // into its message, rendering a control character means a hex
        // escape, and `code.toString(16)` is that escape. A module cannot
        // validate an argument without this, and validating arguments is
        // what node's entry points do first.
        //
        // The receiver is widened to `f64` because the runtime takes one
        // and an `i32` receiver is common -- `charCodeAt` gives one.
        if name == "toString" && arguments.len() == 1 {
            let radix = self.lower_expression(arguments[0])?;
            let radix = self.builtin_number_argument(
                (id, arguments[0]),
                NumericBuiltin::NumberMethod(&name),
                1,
                radix,
            )?;
            let radix = self.coerce(radix, &HirType::NUMBER, arguments[0])?;
            let value = self.coerce(receiver, &HirType::NUMBER, receiver_node)?;
            let origin = self.origin(id);

            return self.lower_radix_to_string(id, value, radix, &origin);
        }
        // `n.toFixed(d)`, which the widened statement fuzzer reached and
        // nothing else had: 14 draws in 3,000 cases, and the only wall in
        // that run that was not already a decision.
        //
        // The digits are range-checked the way `toString`'s radix is, in
        // node's own sentence, because the specification throws for the
        // same reason: a `RangeError` at run time is the answer, and there
        // is nowhere at compile time to put it.
        if name == "toFixed" && arguments.len() == 1 {
            let digits = self.lower_expression(arguments[0])?;
            let digits = self.builtin_number_argument(
                (id, arguments[0]),
                NumericBuiltin::NumberMethod(&name),
                1,
                digits,
            )?;
            let digits = self.coerce(digits, &HirType::NUMBER, arguments[0])?;
            let value = self.coerce(receiver, &HirType::NUMBER, receiver_node)?;
            let origin = self.origin(id);

            return self.lower_fixed_to_string(id, value, digits, &origin);
        }
        Err(self.unsupported(id, &format!("`{name}` on a number")))
    }

    /// `ToIntegerOrInfinity` after the caller has performed `ToNumber`.
    ///
    /// Truncation preserves infinities. A zero or NaN becomes positive zero;
    /// comparing the truncated magnitude with zero handles both without any
    /// float-to-integer cast. Domain checks must read this result, and the
    /// runtime receives the same integer that was checked.
    fn lower_to_integer_or_infinity(&mut self, value: ValueId, origin: &Origin) -> ValueId {
        // Keep constant calls such as `toFixed(3)` free of conversion control
        // flow on every backend. Numeric signs are pure too; do not evaluate
        // a load, call, conversion or a narrower float as a literal.
        let mut literal = value;
        let mut negative = false;
        loop {
            let argument = &self.values[literal.0 as usize];
            if argument.ty != HirType::NUMBER {
                break;
            }
            match argument.kind {
                OpKind::ConstFloat(number) => {
                    let whole = (if negative { -number } else { number }).trunc();
                    let integer = if whole.is_nan() || whole == 0.0 {
                        0.0
                    } else {
                        whole
                    };
                    if integer.to_bits() == number.to_bits() {
                        return literal;
                    }
                    return self.push(OpKind::ConstFloat(integer), HirType::NUMBER, origin.clone());
                }
                OpKind::Unary {
                    op: UnOp::Neg,
                    operand,
                } => {
                    literal = operand;
                    negative = !negative;
                }
                _ => break,
            }
        }
        let whole = self.push(
            OpKind::Unary {
                op: UnOp::Trunc,
                operand: value,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let magnitude = self.push(
            OpKind::Unary {
                op: UnOp::Abs,
                operand: whole,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let nonzero = self.push(
            OpKind::Binary {
                op: BinOp::Gt,
                lhs: magnitude,
                rhs: zero,
            },
            HirType::Bool,
            origin.clone(),
        );
        let keep = self.new_block();
        let carry_on = self.new_block();
        let integer = self.push_block_param(carry_on, HirType::NUMBER, origin.clone());
        self.terminate(Terminator::Branch {
            cond: nonzero,
            then_target: keep,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: vec![zero],
        });
        self.switch_to(keep);
        self.terminate(Terminator::Jump {
            target: carry_on,
            args: vec![whole],
        });
        self.switch_to(carry_on);
        integer
    }

    /// `n.toFixed(d)`, with the domain the specification gives it.
    ///
    /// The same shape as [`Self::lower_radix_to_string`] and for the same
    /// reason: the bound belongs here rather than in the runtime because a
    /// provided `RangeError` is a *class* and the runtime has no way to
    /// construct one.
    ///
    /// `nts_number_to_fixed` carries why the formatting is not `printf` -- the
    /// specification rounds half *away from zero* and C rounds half to even,
    /// which disagree on every exact tie.
    fn lower_fixed_to_string(
        &mut self,
        id: NodeId,
        value: ValueId,
        digits: ValueId,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let origin = origin.clone();
        let digits = self.lower_to_integer_or_infinity(digits, &origin);
        let throwing = self.new_block();
        let carry_on = self.new_block();
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let below = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: digits,
                rhs: zero,
            },
            HirType::Bool,
            origin.clone(),
        );
        let checking = self.new_block();
        self.terminate(Terminator::Branch {
            cond: below,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: checking,
            else_args: Vec::new(),
        });

        self.switch_to(checking);
        let hundred = self.push(OpKind::ConstFloat(100.0), HirType::NUMBER, origin.clone());
        let above = self.push(
            OpKind::Binary {
                op: BinOp::Gt,
                lhs: digits,
                rhs: hundred,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: above,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });

        self.switch_to(throwing);
        // Node's exact sentence: `RangeError: toFixed() digits argument must be
        // between 0 and 100`.
        let text = HirType::Managed(ManagedType::String);
        let message = self.push(
            OpKind::ConstString("toFixed() digits argument must be between 0 and 100".into()),
            text,
            origin.clone(),
        );
        self.throw_provided_error_text(id, "RangeError", message)?;
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: carry_on,
                args: Vec::new(),
            });
        }

        self.switch_to(carry_on);
        Ok(self.runtime_call(
            "nts_number_to_fixed",
            vec![value, digits],
            HirType::Managed(ManagedType::String),
            origin,
        ))
    }

    /// A symbol's `description`, which is a **member read** where `String(sym)`
    /// is a conversion — the same helper family, reached from the other side of
    /// the language.
    ///
    /// The ledger row for this said `nts_symbol_description` and
    /// `nts_symbol_to_string` "exist and are tested, and nothing lowers a member
    /// access to them yet", and that was exactly true: both are in `runtime/c`,
    /// in `hir::runtime`'s table and in LLVM's signatures already. So this and
    /// [`Self::symbol_method`] are the whole of the feature — no runtime surface
    /// to add, nothing to regenerate, no backend to red-gate while it catches up.
    ///
    /// `description` is `string | undefined` and the helper returns a
    /// possibly-null `NtsString *`, which is what this compiler already means by
    /// an absent string: `null` and `undefined` are one value in a compiled
    /// program. So the representation is a nullable managed string and
    /// `d === undefined` is the null test it already lowers.
    fn symbol_property(
        &mut self,
        id: NodeId,
        value: ValueId,
        member_name: &str,
    ) -> Result<ValueId, Diagnostic> {
        if member_name != "description" {
            return Err(self.unsupported(
                id,
                &format!(
                    "`{member_name}` on a symbol, where `description` is the one member \
                     this compiler reads"
                ),
            ));
        }
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::Call {
                callee: Callee::External("nts_symbol_description".to_owned()),
                args: vec![value],
                frame: None,
            },
            HirType::Managed(ManagedType::String),
            origin,
        ))
    }

    /// `sym.toString()`, the other half of the same row.
    ///
    /// Named rather than left to fall through, because the refusal below it
    /// would read "`toString` on a symbol, which has no method table here" and
    /// a symbol *has* two methods the language defines. Saying it has no method
    /// table would send its reader to the wrong file.
    fn symbol_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let name = self.literal_name(member);
        if name.as_deref() != Some("toString") {
            let what = name.unwrap_or_else(|| "a computed member".to_owned());
            return Err(self.unsupported(
                id,
                &format!(
                    "`{what}()` on a symbol, where `toString` is the one method this \
                     compiler calls"
                ),
            ));
        }
        if !arguments.is_empty() {
            return Err(self.unsupported(id, "`toString()` on a symbol with an argument"));
        }
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::Call {
                callee: Callee::External("nts_symbol_to_string".to_owned()),
                args: vec![receiver],
                frame: None,
            },
            HirType::Managed(ManagedType::String),
            origin,
        ))
    }

    fn lower_date_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let name = self
            .literal_name(member)
            .ok_or_else(|| self.unsupported(id, "a `Date` member the program computes"))?;
        if !arguments.is_empty() {
            return Err(self.unsupported(id, &format!("a `Date.{name}` with arguments")));
        }
        let origin = self.origin(id);
        match name.as_str() {
            "getTime" | "valueOf" => {
                Ok(self.call_runtime("nts_date_value", vec![receiver], HirType::NUMBER, &origin))
            }
            // Refused, and the reason is the oracle rather than the calendar.
            // `new Date(NaN).toISOString()` **throws a RangeError** in node,
            // and this compiler has no throw to give from a runtime helper --
            // so it would answer with a string where node raises, and the
            // differential cannot see that: it scores node's throw as a case
            // not reached rather than as a disagreement. A silent divergence
            // the oracle is blind to is the worst outcome available, so this is
            // refused until a helper can throw.
            //
            // Both call sites in `runtime/node` already guard it --
            // `Number.isNaN(d.getTime()) ? "Invalid Date" : d.toISOString()` --
            // and the guard is on the *value*, which the lowering cannot see.
            "toISOString" => Err(self.unsupported(
                id,
                "`Date.toISOString`, which throws a RangeError on an invalid date -- a \
                 runtime helper here has no way to throw, and answering with a string \
                 instead is a divergence the differential cannot see",
            )),
            // Named individually so the message says which family it is in.
            "getFullYear" | "getMonth" | "getDate" | "getHours" | "getMinutes" | "getSeconds"
            | "getMilliseconds" | "getDay" | "getTimezoneOffset" => Err(self.unsupported(
                id,
                &format!(
                    "`Date.{name}`, which reads a *local* calendar -- that needs a timezone \
                         database this compiler does not carry, and would make one program \
                         answer differently on two machines"
                ),
            )),
            _ => Err(self.unsupported(id, &format!("`Date.{name}`"))),
        }
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

    /// The method a binding declares on a C handle, when the call at `id`
    /// resolved to one: a method signature naming its C function with
    /// `@ntsSymbol` and its instance with `this: T` -- what `bind-gir` writes
    /// on `GtkButtonMethods` for `button.set_label(text)`.
    /// A C function a binding declares as a static method of a value --
    /// `GtkStringObject.new("x")`, GJS's constructors -- when the call at `id`
    /// resolved to one: an `@ntsSymbol` method signature with no `this`,
    /// called on a plain name. The name is a declaration only, with nothing to
    /// evaluate, and a name is all that is accepted, so nothing is skipped.
    fn static_native(&self, id: NodeId, target: NodeId) -> Option<NodeId> {
        let call = self.snapshot.call_targets.get(&id)?;
        let declaration = call.callee?;
        let signature = &self.snapshot.signatures[call.signature.0 as usize];
        (self.kind_of(target) == Some(syntax::IDENTIFIER)
            && self.kind_of(declaration) == Some(syntax::METHOD_SIGNATURE)
            && signature.this_type.is_none()
            && self
                .node(declaration)
                .native
                .as_ref()
                .is_some_and(|n| n.symbol.is_some()))
        .then_some(declaration)
    }

    /// [`Self::static_native`]'s call: the C function, with the arguments the
    /// program wrote and no receiver.
    fn lower_static_native(
        &mut self,
        id: NodeId,
        declaration: NodeId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let signature = self.snapshot.call_targets[&id].signature;
        let record = self.snapshot.signatures[signature.0 as usize].clone();
        let name = self
            .node(member)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)
            .unwrap_or_default();
        let callee = self.native_callee(id, Some(declaration), name, &record)?;
        let (args, lent) = self.lower_call_arguments(id, &callee, arguments, None)?;
        self.finish_call(id, callee, args, lent, Some(declaration))
    }

    fn native_method(&self, id: NodeId) -> Option<(NodeId, nts_semantic_schema::SignatureId)> {
        let target = self.snapshot.call_targets.get(&id)?;
        let declaration = target.callee?;
        let signature = &self.snapshot.signatures[target.signature.0 as usize];
        // `@ntsSelector` as well as `@ntsSymbol`: an Objective-C instance
        // method is the same shape, a method whose instance is its first
        // argument. Only the call differs.
        let tagged = self.node(declaration).native.as_ref().is_some_and(|n| {
            n.symbol.is_some()
                || n.selector.is_some()
                || n.vtable.is_some()
                || n.query.is_some()
                || n.vfunc.is_some()
                || n.listener.is_some()
        });
        // Or a method of an Objective-C class a binding declares, whose
        // receiver is the object it is called on, or the class when `static`:
        // declared in the class, or in an interface merging into it (a Swift
        // extension from another framework's package).
        let objc_member = (matches!(
            self.kind_of(declaration),
            Some(syntax::METHOD_DECLARATION | syntax::METHOD_SIGNATURE)
        ) && self.objc_class_member(declaration).is_some())
            || self.objc_protocol_member(declaration);
        (tagged && (self.is_native_instance_method(declaration, signature) || objc_member))
            .then_some((declaration, target.signature))
    }

    /// Whether `declaration` is a method of an Objective-C protocol a binding
    /// declares (`@ntsProtocol`), called on a value of the protocol's type:
    /// Swift's `dataSource?.tableView(table, numberOfRowsInSection: 0)`, a
    /// message to whatever object conforms.
    /// A method of a type the program uses and does not own, as the same-named
    /// method of the type implementing it (`SemanticSnapshot::bound_types`):
    /// `document.createElement("div")` is `nts:dom`'s `createElement`.
    ///
    /// The checker resolved the call to lib.dom.d.ts's declaration, which the
    /// frontend never decodes, so the call has no callee to read tags from; the
    /// receiver's binding is where the method is. Its members are found
    /// through the bound type's intersection, so an inherited one (`Node`'s,
    /// `EventTarget`'s) is found as the program's own call resolves it.
    fn delegated_method(
        &self,
        receiver_node: NodeId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Option<(NodeId, nts_semantic_schema::SignatureRecord)> {
        let bound = self.delegated_type(*self.snapshot.node_types.get(&receiver_node)?)?;
        self.method_of_bound(bound, &self.literal_name(member)?, arguments)
    }

    /// A call of a lib.dom global a binding implements: a function it names
    /// (`requestAnimationFrame(f)`, [`Self::delegated_function`]), or a method
    /// of the global object (`getComputedStyle(el)`, [`Self::window_global`]).
    fn lower_bound_global_call(
        &mut self,
        id: NodeId,
        callee: NodeId,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        if let Some(function) = self.delegated_function(callee) {
            return Some(self.lower_delegated_call(id, function, arguments));
        }
        let (function, name, window) = self.window_global(callee)?;
        let method = self.method_of_bound(
            window,
            self.node(callee)
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())?,
            arguments,
        )?;
        Some(
            self.call_foreign_declaration(id, function, &name, Vec::new())
                .and_then(|receiver| {
                    self.lower_native_method_call_as(
                        id,
                        (receiver, callee),
                        method,
                        callee,
                        arguments,
                    )
                }),
        )
    }

    /// The global object, where a binding implements it and `name` names one
    /// of lib.dom's globals no binding names by itself: page script's
    /// `location` is `window.location`, and `getComputedStyle(el)` is
    /// `window.getComputedStyle(el)`, so each is read from what `window`'s
    /// binding answers (`/** @ntsBoundBy "nts:dom" window */ declare var
    /// window`) where the type implementing it declares the member. Only a name
    /// declared where nothing was decoded -- lib.dom -- so a program's own
    /// global is never taken for one. The bound function, its name, and the
    /// type implementing the global object.
    fn window_global(&self, name: NodeId) -> Option<(NodeId, String, TypeId)> {
        let symbol = self.denoted_symbol(self.node(name).symbol?);
        if !self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .is_empty()
        {
            return None;
        }
        let (function, bound) = self.module.global_object.clone()?;
        let TypeKind::Function(signature) = self
            .snapshot
            .types
            .get(self.snapshot.node_types.get(&function)?.0 as usize)?
            .kind
        else {
            return None;
        };
        let returned = self
            .snapshot
            .signatures
            .get(signature.0 as usize)?
            .return_type;
        Some((function, bound, returned))
    }

    /// [`Self::delegated_method`] on the type implementing the receiver's:
    /// the method `name` of `bound`, its overload chosen by `arguments`.
    fn method_of_bound(
        &self,
        bound: TypeId,
        name: &str,
        arguments: &[NodeId],
    ) -> Option<(NodeId, nts_semantic_schema::SignatureRecord)> {
        let property = super::native::schema::property(self.snapshot, bound, name)?;
        let first = property.declaration?;
        // **Every overload, chosen by the call's arguments.** A binding spells
        // one lib.dom member as several C functions where its parameters have
        // more than one native form: `append(...nodes: (Node | string)[])` is
        // eight `append` overloads, `nts_dom_Element_append_nns` among them,
        // one per arity and arm. The first whose parameters fit what the call
        // passes is the one; with none, the first, so its own coercion says
        // which argument does not.
        let overloads: Vec<NodeId> = self
            .name_node(first)
            .and_then(|name| self.node(name).symbol)
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .map_or_else(|| vec![first], |record| record.declarations.clone());
        let TypeKind::Function(merged) = self.snapshot.types.get(property.ty.0 as usize)?.kind
        else {
            return None;
        };
        let merged = &self.snapshot.signatures[merged.0 as usize];
        let method =
            |declaration: NodeId| -> Option<(NodeId, nts_semantic_schema::SignatureRecord)> {
                let tagged = self
                    .node(declaration)
                    .native
                    .as_ref()
                    .is_some_and(|n| n.symbol.is_some() || n.listener.is_some());
                let record = self.overload_signature(declaration, merged);
                (tagged && self.is_native_instance_method(declaration, &record))
                    .then_some((declaration, record))
            };
        let candidates: Vec<_> = overloads.into_iter().filter_map(method).collect();
        if candidates.len() > 1
            && let Some(at) = self.shortest_fit(&candidates, merged, arguments)
        {
            return candidates.into_iter().nth(at);
        }
        candidates.into_iter().next().or_else(|| method(first))
    }

    /// One overload's own signature, from its declaration's parameters: the
    /// snapshot's function type for an overloaded member carries the first
    /// overload's only. Each parameter node carries its annotated type, and
    /// the `this` parameter is the receiver's; the result is the member's,
    /// which a binding's overloads of one member share.
    fn overload_signature(
        &self,
        declaration: NodeId,
        merged: &nts_semantic_schema::SignatureRecord,
    ) -> nts_semantic_schema::SignatureRecord {
        let mut record = merged.clone();
        let mut parameters = Vec::new();
        for parameter in self
            .children(declaration)
            .into_iter()
            .filter(|child| self.kind_of(*child) == Some(syntax::PARAMETER))
        {
            let Some(&ty) = self.snapshot.node_types.get(&parameter) else {
                return merged.clone();
            };
            let name = self
                .name_node(parameter)
                .and_then(|name| {
                    self.node(name)
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                        .map(str::to_owned)
                })
                .unwrap_or_default();
            if name == "this" {
                record.this_type = Some(ty);
                continue;
            }
            let children = self.children(parameter);
            let rest = children
                .iter()
                .any(|child| self.kind_of(*child) == Some(syntax::DOT_DOT_DOT_TOKEN));
            let optional = children
                .iter()
                .any(|child| self.kind_of(*child) == Some(syntax::QUESTION_TOKEN));
            parameters.push(nts_semantic_schema::ParameterRecord {
                name,
                ty,
                optional,
                rest,
            });
        }
        record.parameters = parameters;
        record
    }

    /// Whether a call's written arguments fit a native signature: as many as
    /// it takes, less its optional tail, and each of the kind its parameter
    /// is -- a string where it takes a string or a `StringView`, a handle
    /// where it takes that handle or one it extends, a number where a number.
    /// A parameter of any other type takes anything, which its coercion then
    /// decides.
    fn arguments_fit(
        &self,
        record: &nts_semantic_schema::SignatureRecord,
        checked: Option<&nts_semantic_schema::SignatureRecord>,
        arguments: &[NodeId],
    ) -> bool {
        let required = record
            .parameters
            .iter()
            .filter(|parameter| !parameter.optional && !parameter.rest)
            .count();
        if arguments.len() < required || arguments.len() > record.parameters.len() {
            return false;
        }
        record.parameters.iter().enumerate().zip(arguments).all(|((at, parameter), argument)| {
            let Some(&given) = self.snapshot.node_types.get(argument) else { return true };
            let taken = parameter.ty;
            // The parameter of the signature the call was checked against,
            // at the same position: the dictionary whose members a record
            // conversion may read (`record_holds`).
            let checked = checked
                .and_then(|checked| checked.parameters.get(at))
                .map(|parameter| parameter.ty);
            if let Some(lent) = super::native::native_array_argument(self.snapshot, taken) {
                return self.lends_as(&lent, given);
            }
            if super::native::string_encoding(self.snapshot, taken).is_some() || super::native::is_string(self.snapshot, taken) {
                return matches!(self.represent(given), Some(HirType::Managed(ManagedType::String)));
            }
            if let Some(super::native::Pointee::Opaque(want)) = super::native::pointer(self.snapshot, taken) {
                return matches!(super::native::pointer(self.snapshot, given),
                    Some(super::native::Pointee::Opaque(have)) if have == want || have.upcasts_to(&want));
            }
            if matches!(self.represent(taken), Some(HirType::Float { .. } | HirType::Int { .. })) {
                return matches!(self.represent(given), Some(HirType::Float { .. } | HirType::Int { .. }));
            }
            if let Some(HirType::NativePointer(view)) = self.represent(taken)
                && let super::native::Pointee::Record(record) = view.viewed()
            {
                return self.record_holds(record, *argument, given, checked);
            }
            true
        })
    }

    /// Whether an argument of type `given` is an array a parameter lending
    /// `lent` -- the array its `CStrings`, `CHandles`, `CBytes` or `CElements`
    /// markers are intersected with -- can lend: strings to `CStrings`,
    /// handles of the class or one extending it to `CHandles`, a typed array
    /// of the elements C reads to `CBytes` and `CElements`. So
    /// `new Blob(["a"])` takes nts:dom's strings overload and
    /// `new Blob([blob])` its blobs' (the Chromium lane's
    /// lib-dom-an-array-overload-chosen-by-its-elements). `null` and
    /// `undefined` fit, being the NULL C is lent, as does an array of any
    /// other element, which the lend itself decides.
    fn lends_as(&self, lent: &HirType, given: TypeId) -> bool {
        use super::native::Pointee;
        let absent = matches!(
            self.snapshot
                .types
                .get(given.0 as usize)
                .map(|record| &record.kind),
            Some(TypeKind::Null | TypeKind::Undefined)
        );
        let Some(have) = self.represent(given) else {
            return true;
        };
        match (lent, &have) {
            (
                HirType::Managed(ManagedType::Array(want)),
                HirType::Managed(ManagedType::Array(have)),
            ) => match (&**want, &**have) {
                (
                    HirType::NativePointer(Pointee::Opaque(want)),
                    HirType::NativePointer(Pointee::Opaque(have)),
                ) => have == want || have.upcasts_to(want),
                (HirType::Managed(ManagedType::String), have) => {
                    *have == HirType::Managed(ManagedType::String)
                }
                (HirType::NativePointer(Pointee::Opaque(_)), _) => false,
                _ => true,
            },
            (
                HirType::Managed(ManagedType::View(want)),
                HirType::Managed(ManagedType::View(have)),
            ) => want == have,
            (HirType::Managed(ManagedType::Array(_) | ManagedType::View(_)), _) => absent,
            _ => true,
        }
    }

    /// The member names of the dictionary a checked parameter type names,
    /// its own and inherited -- an object type's properties carry both --
    /// through the unions a parameter may spell the dictionary in
    /// (`number | DOMPointInit | ...`). `None` where no part of the type is
    /// an object: no dictionary to key on.
    fn dictionary_member_names(&self, ty: TypeId) -> Option<Vec<&str>> {
        fn collect<'a>(
            snapshot: &'a LoweringSnapshot<'a>,
            ty: TypeId,
            path: &mut Vec<TypeId>,
            names: &mut Vec<&'a str>,
        ) -> bool {
            if path.contains(&ty) {
                return false;
            }
            path.push(ty);
            let found = match snapshot.types.get(ty.0 as usize).map(|r| &r.kind) {
                Some(TypeKind::Object { properties }) => {
                    names.extend(properties.iter().filter_map(|p| p.name.public_name()));
                    true
                }
                // A generic dictionary (`UnderlyingSource<R>`) arrives as an
                // opaque nominal whose members are not traversed; the
                // object types carrying its symbol carry the names, read
                // from the snapshot's index of them -- never by revisiting
                // the nominal's same-symbol siblings, which re-enters this
                // arm for each and enumerates their permutations.
                Some(TypeKind::Structured) => snapshot
                    .types
                    .get(ty.0 as usize)
                    .and_then(|record| record.symbol)
                    .and_then(|symbol| snapshot.dictionary_members(symbol))
                    // A hit is a known dictionary even with no members to
                    // read: only a miss -- no object row for the symbol --
                    // leaves the fit without a dictionary to key on, as
                    // the object walk this replaced answered.
                    .is_some_and(|members| {
                        names.extend(members.iter().map(String::as_str));
                        true
                    }),
                Some(TypeKind::Union(parts) | TypeKind::Intersection(parts)) => parts
                    .iter()
                    .map(|part| collect(snapshot, *part, path, names))
                    .collect::<Vec<_>>()
                    .contains(&true),
                _ => false,
            };
            path.pop();
            found
        }
        let mut names = Vec::new();
        collect(self.snapshot, ty, &mut Vec::new(), &mut names).then_some(names)
    }

    /// Whether every member `argument` can carry is a field of `record`, the C
    /// record a binding takes a dictionary by.
    ///
    /// **A member the record has no field for is dropped without a word**:
    /// the record is written field by field from the object
    /// (`copy_into_native_record`), so `new CustomEvent("ready", { bubbles:
    /// true, detail: 5 })` made an event whose detail was null, nts:dom's
    /// `CustomEventInit` having no field for an `any`, and `fetch(url, { method:
    /// "POST", body })` sent no body (the Chromium lane's
    /// lib-dom-a-dictionary-member-its-binding-has-no-field-for). The call is
    /// typechecked against lib.dom's dictionary and lowered to the binding's
    /// record, so nothing else compares the two. An overload this does not
    /// fit is not taken -- a binding offering the members as parameters is
    /// chosen instead -- and with none left the call is refused by name.
    ///
    /// A literal says which members it writes, a nested literal for a
    /// nested record included. Any other object may hold every property its
    /// type declares, an optional one too -- but a dictionary conversion
    /// reads only the dictionary's own members, so where the checked
    /// signature's dictionary is known (`checked`), only a property that
    /// *is* one of its members (inherited ones included) must have a field:
    /// the rest of the object's face, `DOMPointReadOnly`'s `matrixTransform`
    /// and `toJSON` beside its `x`, is never read and cannot be dropped.
    /// Keyed on membership, not on property kind: a member the dictionary
    /// declares as a callback is written as a method by the class
    /// implementing it, and would be dropped all the same. Without the
    /// checked dictionary, every property must have a field, as before.
    fn record_holds(
        &self,
        record: &super::native::Record,
        argument: NodeId,
        given: TypeId,
        checked: Option<TypeId>,
    ) -> bool {
        let field = |name: &str| record.fields.iter().find(|field| field.name == name);
        if self.kind_of(argument) != Some(syntax::OBJECT_LITERAL_EXPRESSION) {
            // A handle is never copied into a record: the copy writes a
            // managed object's fields, and an opaque value is read through
            // the overload beside this one that takes it as itself (the
            // object arm a dictionary argument is offered by). Letting the
            // record hold one by its members took it over that arm for
            // `matrix.multiply(rotate)` -- every member has a field -- and
            // the conversion then refused the pointer. (A struct value is
            // a record already, not a handle, and is not this.)
            if let Some(HirType::NativePointer(view)) = self.represent(given)
                && matches!(view.viewed(), super::native::Pointee::Opaque(_))
            {
                return false;
            }
            let members = checked.and_then(|ty| self.dictionary_member_names(ty));
            let parts = match self.snapshot.types.get(given.0 as usize).map(|r| &r.kind) {
                Some(TypeKind::Union(parts) | TypeKind::Intersection(parts)) => parts.clone(),
                #[expect(
                    clippy::match_same_arms,
                    reason = "keep audited semantic type variants explicit"
                )]
                Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => vec![given],
                _ => vec![given],
            };
            return parts.iter().all(|part| {
                match self.snapshot.types.get(part.0 as usize).map(|r| &r.kind) {
                    Some(TypeKind::Object { properties }) => {
                        properties
                            .iter()
                            .all(|p| match (&members, p.name.public_name()) {
                                (Some(members), Some(name)) => {
                                    !members.contains(&name) || field(name).is_some()
                                }
                                (Some(_), None) => true,
                                (None, name) => name.is_some_and(|name| field(name).is_some()),
                            })
                    }
                    Some(TypeKind::Null | TypeKind::Undefined) => true,
                    #[expect(
                        clippy::match_same_arms,
                        reason = "keep audited semantic type variants explicit"
                    )]
                    Some(TypeKind::NonPrimitive | TypeKind::UniqueSymbol) => false,
                    _ => false,
                }
            });
        }
        self.children(argument)
            .into_iter()
            .all(|member| match self.kind_of(member) {
                Some(syntax::PROPERTY_ASSIGNMENT) => {
                    let [name, value] = self.children(member)[..] else {
                        return false;
                    };
                    let Some(native) = self.literal_name(name).and_then(|name| field(&name)) else {
                        return false;
                    };
                    match (&native.ty, self.snapshot.node_types.get(&value)) {
                        // A `Given<T>` pair is written from the member's value
                        // -- its `T`, or `undefined` -- not from a literal of
                        // the pair's own fields (`write_given`).
                        (super::native::Pointee::Record(inner), _) if inner.given => true,
                        (super::native::Pointee::Record(inner), Some(&ty)) => {
                            self.record_holds(inner, value, ty, None)
                        }
                        _ => true,
                    }
                }
                Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT) => {
                    let [name, ..] = self.children(member)[..] else {
                        return false;
                    };
                    self.literal_name(name)
                        .is_some_and(|name| field(&name).is_some())
                }
                // A spread, a method or an accessor: which members it writes is
                // not written here.
                _ => false,
            })
    }

    /// The function implementing a call's callee, where a binding implements
    /// it: lib.dom.d.ts's `requestAnimationFrame`, `@ntsBoundBy "nts:dom"
    /// requestAnimationFrame` on the overlay's declaration of the same name,
    /// is `nts:dom`'s. Asked of the name's symbol rather than the checker's
    /// callee, which may be lib.dom's own declaration and is then never decoded.
    fn delegated_function(&self, callee_node: NodeId) -> Option<(NodeId, TypeId)> {
        if self.kind_of(callee_node) != Some(syntax::IDENTIFIER) {
            return None;
        }
        let symbol = self.denoted_symbol(self.node(callee_node).symbol?);
        let record = self.snapshot.symbols.get(symbol.0 as usize)?;
        let binding = record.declarations.iter().find_map(|declaration| {
            (self.kind_of(*declaration) == Some(syntax::FUNCTION_DECLARATION))
                .then(|| {
                    self.node(*declaration)
                        .native
                        .as_deref()?
                        .bound_by
                        .as_deref()
                })
                .flatten()
        })?;
        let (module, name) = nts_semantic_schema::binding::parse(binding)?;
        let function = nts_semantic_schema::binding::declared_in(
            self.snapshot,
            module,
            name,
            syntax::FUNCTION_DECLARATION,
        )?;
        Some((function, *self.snapshot.node_types.get(&function)?))
    }

    /// The function implementing a **static** operation of a class a binding
    /// implements: lib.dom's `URL.canParse(x)` -- a member of `declare var URL:
    /// { …; canParse(…) }` -- is the bound module's `URL_canParse`, declared beside
    /// the type it binds and named `<Interface>_<member>`, as its constructor is
    /// `new<Interface>` ([`Self::delegated_constructor`]). The binding is read from
    /// the interface the receiver's name also declares (`/** @ntsBoundBy "nts:dom"
    /// URL */ interface URL {}`). Overloads by arity, as everywhere.
    fn delegated_static(&self, receiver: NodeId, member: NodeId) -> Option<(NodeId, TypeId)> {
        if self.kind_of(receiver) != Some(syntax::IDENTIFIER) {
            return None;
        }
        let symbol = self.denoted_symbol(self.node(receiver).symbol?);
        let (module, name) = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .iter()
            .find_map(|declaration| {
                (self.kind_of(*declaration) == Some(syntax::INTERFACE_DECLARATION))
                    .then(|| {
                        nts_semantic_schema::binding::parse(
                            self.node(*declaration)
                                .native
                                .as_deref()?
                                .bound_by
                                .as_deref()?,
                        )
                    })
                    .flatten()
            })?;
        let member = self.literal_name(member)?;
        let function = nts_semantic_schema::binding::declared_in(
            self.snapshot,
            module,
            &format!("{name}_{member}"),
            syntax::FUNCTION_DECLARATION,
        )?;
        Some((function, *self.snapshot.node_types.get(&function)?))
    }

    /// A call of a function a binding implements, as a call of that function,
    /// at its parameters: `@ntsDefault`s and ABI types are the bound
    /// declaration's (`callee_signature`), as for [`Self::delegated_method`].
    fn lower_delegated_call(
        &mut self,
        id: NodeId,
        (function, ty): (NodeId, TypeId),
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let Some(TypeKind::Function(signature)) = self
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| &record.kind)
        else {
            return Err(
                self.unsupported(id, "a function a binding names, whose signature is unknown")
            );
        };
        // Its overload chosen by the arguments, as a bound method's is:
        // `requestIdleCallback(f)` and `requestIdleCallback(f, { timeout })`
        // are two of nts:dom's declarations.
        let merged = self.snapshot.signatures[signature.0 as usize].clone();
        let (function, record) = self.overload_by_arguments(function, &merged, arguments);
        let name = nts_semantic_schema::binding::declared_name(self.snapshot, function)
            .unwrap_or_default()
            .to_owned();
        let callee = self.native_callee(id, Some(function), name, &record)?;
        let spread = self.spread_for(id, &record, arguments);
        let outer = self.delegated_signature.replace((id, record));
        let lowered = self.lower_call_arguments(id, &callee, arguments, None);
        self.delegated_signature = outer;
        self.dictionary_slots = spread;
        let (args, lent) = lowered?;
        self.finish_call(id, callee, args, lent, Some(function))
    }

    /// The overload of the function declared at `first` its arguments fit
    /// ([`Self::call_fits`]), each overload's signature read from its own
    /// parameters; with none, the first.
    fn overload_by_arguments(
        &self,
        first: NodeId,
        merged: &nts_semantic_schema::SignatureRecord,
        arguments: &[NodeId],
    ) -> (NodeId, nts_semantic_schema::SignatureRecord) {
        let overloads: Vec<NodeId> = self
            .name_node(first)
            .and_then(|name| self.node(name).symbol)
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .map_or_else(|| vec![first], |record| record.declarations.clone());
        let candidates: Vec<_> = overloads
            .into_iter()
            .map(|declaration| (declaration, self.overload_signature(declaration, merged)))
            .collect();
        let at = self
            .shortest_fit(&candidates, merged, arguments)
            .unwrap_or(0);
        candidates
            .into_iter()
            .nth(at)
            .unwrap_or_else(|| (first, merged.clone()))
    }

    /// Refuse a call that passes an argument the bound function it lowers to has no
    /// parameter for.
    ///
    /// **A binding's overloads are a subset of lib.dom's**, and when none fits,
    /// the first is taken so that argument coercion can say which argument does
    /// not fit (`method_of_bound`). That covers an argument of the wrong type and
    /// not one *too many*: an argument past the last parameter is dropped, as
    /// JavaScript drops one -- and silently. `new Blob(["héllo"])`, with nts:dom
    /// binding only `newBlob()` because the parts constructor takes a
    /// `sequence<BlobPart>`, built an empty Blob where V8 had the text
    /// (`blockers/lib-dom-new-that-fits-no-constructor`, the Chromium lane's).
    fn refuse_dropped_arguments(
        &self,
        declaration: NodeId,
        record: &nts_semantic_schema::SignatureRecord,
        arguments: &[NodeId],
    ) -> Result<(), Diagnostic> {
        // Every parameter, the `@ntsThrows` one included: `as_written` leaves it
        // out for choosing an overload, but a program may pass its own out slot
        // (`parser.parse("q", mine)`), and that argument is not dropped.
        if record.parameters.iter().any(|parameter| parameter.rest) {
            return Ok(());
        }
        let Some(&dropped) = arguments.get(record.parameters.len()) else {
            return Ok(());
        };
        let name = nts_semantic_schema::binding::declared_name(self.snapshot, declaration)
            .unwrap_or("the bound function");
        Err(self.unsupported(
            dropped,
            &format!(
                "an argument `{name}` has no parameter for: no overload the binding declares \
                 takes {} argument(s), and the call would drop it",
                arguments.len()
            ),
        ))
    }

    /// An overload's signature as a call writes it: without the parameter its
    /// `@ntsThrows` names, which the binding passes itself and no argument
    /// supplies. Left in, `observe(target, error?)` -- the binding's own out
    /// pointer for a `DOMException` -- fitted `observe(target, { childList:
    /// true })`, the literal landing in `error`, and being shorter was chosen
    /// over `observe(target, options)`.
    fn as_written(
        &self,
        declaration: NodeId,
        record: &nts_semantic_schema::SignatureRecord,
    ) -> nts_semantic_schema::SignatureRecord {
        let thrown = self
            .node(declaration)
            .native
            .as_deref()
            .and_then(|native| native.throws.as_deref())
            .and_then(|text| text.split_whitespace().next());
        let Some(thrown) = thrown else {
            return record.clone();
        };
        let mut written = record.clone();
        written
            .parameters
            .retain(|parameter| parameter.name != thrown);
        written
    }

    /// Which overload a call takes: of those its arguments fit
    /// ([`Self::call_fits`]), the one with the fewest parameters, the first
    /// declared among equals. The shortest, because an overload's extra
    /// parameters are what the call does not say: `addEventListener(t, f,
    /// { once: true })` fits both nts:dom's `(.., capture?, once?, signal?)` and
    /// the one that adds `passive?`, and leaving `passive` unset is the first's
    /// whole point -- Blink's default for touch and wheel listeners needs it
    /// unset, not false.
    fn shortest_fit(
        &self,
        candidates: &[(NodeId, nts_semantic_schema::SignatureRecord)],
        checked: &nts_semantic_schema::SignatureRecord,
        arguments: &[NodeId],
    ) -> Option<usize> {
        let written: Vec<nts_semantic_schema::SignatureRecord> = candidates
            .iter()
            .map(|(declaration, record)| self.as_written(*declaration, record))
            .collect();
        // WebIDL's overload resolution first narrows to an effective set by
        // count alone: of the entries for a call of n arguments, only those
        // whose argument count is min(maxarg, n) remain -- maxarg the most
        // parameters any entry takes, optional and variadic parameters
        // counted. An entry here is unexpanded, so it participates at every
        // count from its required parameters to its total, a variadic one
        // without an upper bound, and survives where that span covers the
        // kept count. Only then do the arguments distinguish entries,
        // [`Self::call_fits`] and, with none fitting, the fallback below
        // alike: without the count a zero-parameter entry passed every
        // per-parameter test vacuously and answered for an argument it has
        // no parameter for. A dictionary spread is not WebIDL's shape -- a
        // literal's members are the arguments, not one of them -- so an
        // entry the call spreads into is kept by that, not by count.
        let maxarg = written
            .iter()
            .map(|record| {
                if record.parameters.iter().any(|parameter| parameter.rest) {
                    usize::MAX
                } else {
                    record.parameters.len()
                }
            })
            .max()
            .unwrap_or(0);
        let kept = maxarg.min(arguments.len());
        let counted = |record: &nts_semantic_schema::SignatureRecord| {
            if self.dictionary_spread(record, arguments).is_some() {
                return true;
            }
            let required = record
                .parameters
                .iter()
                .filter(|parameter| !parameter.optional && !parameter.rest)
                .count();
            let variadic = record.parameters.iter().any(|parameter| parameter.rest);
            required <= kept && (variadic || kept <= record.parameters.len())
        };
        if let Some(at) = candidates
            .iter()
            .enumerate()
            .filter(|(at, _)| counted(&written[*at]))
            .filter(|(at, _)| self.call_fits(&written[*at], checked, arguments))
            .min_by_key(|(at, (_, record))| (record.parameters.len(), *at))
            .map(|(at, _)| at)
        {
            return Some(at);
        }
        // None fits, and the caller takes what this answers so coercion can
        // name what it cannot carry. A lent array is never that answer for
        // an argument that does not lend as one: it is the one parameter
        // kind whose refusal says nothing about the argument's own kind,
        // and taking it by declaration order made `roundRect`'s radii list
        // answer for a DOMPointReadOnly (its dictionary arm, declared
        // after, is the conversion that cannot carry it -- and the one
        // that names it). The first candidate the count kept that no lent
        // parameter refuses outright; where every one does, none, and the
        // caller falls back as before.
        candidates.iter().enumerate().position(|(at, _)| {
            let written = &written[at];
            counted(written)
                && written
                    .parameters
                    .iter()
                    .zip(arguments)
                    .all(|(parameter, argument)| {
                        if super::native::native_array_argument(self.snapshot, parameter.ty)
                            .is_none()
                        {
                            return true;
                        }
                        // An array of the wrong elements is not refused here:
                        // the lend names its elements, which is the refusal the
                        // call owes (a Blob[] for the strings Blob's parts are
                        // bound by). Only an argument that is no array at all
                        // leaves the lent refusal with nothing to say about it.
                        let Some(&given) = self.snapshot.node_types.get(argument) else {
                            return true;
                        };
                        if matches!(
                            self.snapshot
                                .types
                                .get(given.0 as usize)
                                .map(|record| &record.kind),
                            Some(TypeKind::Null | TypeKind::Undefined)
                        ) {
                            return true;
                        }
                        match self.represent(given) {
                            Some(HirType::Managed(
                                ManagedType::Array(_) | ManagedType::View(_),
                            )) => true,
                            Some(_) => false,
                            None => matches!(
                                self.snapshot
                                    .types
                                    .get(given.0 as usize)
                                    .map(|record| &record.kind),
                                Some(TypeKind::Array(_) | TypeKind::Tuple(_))
                            ),
                        }
                    })
        })
    }

    /// Whether a call's arguments fit `record`, a dictionary literal last
    /// taken as its members where the binding takes them so
    /// ([`Self::dictionary_spread`]).
    ///
    /// **A dictionary fits only where it is taken whole or as members.** A
    /// literal no member of which names a parameter is one object, which no
    /// boolean, number or string parameter takes -- `arguments_fit` lets a
    /// parameter of a type it does not check take anything, and so
    /// `{ passive: true }` fitted `addEventListener`'s `capture?: boolean` of
    /// the overload without `passive`. And spread, a member left out is a gap
    /// only where its parameter is optional, as is every parameter after the
    /// last member: the overload with a required `passive` does not fit a
    /// literal without one.
    fn call_fits(
        &self,
        record: &nts_semantic_schema::SignatureRecord,
        checked: &nts_semantic_schema::SignatureRecord,
        arguments: &[NodeId],
    ) -> bool {
        let Some((_, slots)) = self.dictionary_spread(record, arguments) else {
            let whole = arguments.split_last().is_some_and(|(literal, before)| {
                self.kind_of(*literal) == Some(syntax::OBJECT_LITERAL_EXPRESSION)
                    && record
                        .parameters
                        .get(before.len())
                        .is_some_and(|parameter| self.is_scalar_type(parameter.ty))
            });
            return !whole && self.arguments_fit(record, Some(checked), arguments);
        };
        record
            .parameters
            .iter()
            .skip(slots.len())
            .all(|parameter| parameter.optional || parameter.rest)
            && slots
                .iter()
                .zip(&record.parameters)
                .all(|(slot, parameter)| match slot {
                    None => parameter.optional,
                    Some(argument) => {
                        let one = nts_semantic_schema::SignatureRecord {
                            parameters: vec![parameter.clone()],
                            ..record.clone()
                        };
                        self.arguments_fit(&one, None, &[*argument])
                    }
                })
    }

    /// Whether `ty` is a boolean, a number or a string, or one of them or
    /// `null` or `undefined`: a type no object is.
    fn is_scalar_type(&self, ty: TypeId) -> bool {
        let scalar = |kind: &TypeKind| {
            matches!(
                kind,
                TypeKind::Boolean | TypeKind::Number | TypeKind::String | TypeKind::Literal(_)
            )
        };
        match self
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| &record.kind)
        {
            Some(TypeKind::Union(parts)) => {
                let kinds: Vec<&TypeKind> = parts
                    .iter()
                    .filter_map(|part| {
                        self.snapshot
                            .types
                            .get(part.0 as usize)
                            .map(|record| &record.kind)
                    })
                    .collect();
                kinds.iter().any(|kind| scalar(kind))
                    && kinds.iter().all(|kind| {
                        scalar(kind) || matches!(kind, TypeKind::Null | TypeKind::Undefined)
                    })
            }
            Some(kind) => scalar(kind),
            None => false,
        }
    }

    /// A dictionary argument a binding takes as its members: lib.dom's
    /// `addEventListener(type, f, { once: true })` is nts:dom's
    /// `addEventListener(type, f, capture?, once?, signal?)`, and
    /// `requestIdleCallback(f, { timeout: 500 })` its `(f, timeout)`. The
    /// literal, and the call's arguments as the binding takes them: those
    /// before the literal as written, then for each parameter up to the last
    /// one the literal names, its member's expression, or `None` -- the
    /// parameter's `@ntsDefault`, which a member left out means.
    ///
    /// **Only where every member names a parameter**, so a binding that takes
    /// the dictionary whole (`Fields<EventInit>`) is never taken apart. And
    /// only where order cannot be seen: the members are evaluated in the
    /// binding's order, which is the literal's unless at most one of them can
    /// have an effect.
    fn dictionary_spread(
        &self,
        record: &nts_semantic_schema::SignatureRecord,
        arguments: &[NodeId],
    ) -> Option<(NodeId, Vec<Option<NodeId>>)> {
        let (&literal, before) = arguments.split_last()?;
        if self.kind_of(literal) != Some(syntax::OBJECT_LITERAL_EXPRESSION) {
            return None;
        }
        let tail = record.parameters.get(before.len()..)?;
        let mut members: Vec<(String, NodeId)> = Vec::new();
        for property in self.children(literal) {
            if self.kind_of(property) != Some(syntax::PROPERTY_ASSIGNMENT) {
                return None;
            }
            let [name, value] = self.children(property)[..] else {
                return None;
            };
            members.push((self.literal_name(name)?, value));
        }
        let at = |name: &str| tail.iter().position(|parameter| parameter.name == name);
        let positions = members
            .iter()
            .map(|(name, _)| at(name))
            .collect::<Option<Vec<_>>>()?;
        let last = *positions.iter().max()?;
        let reordered = positions.windows(2).any(|pair| pair[0] > pair[1]);
        if reordered
            && members
                .iter()
                .filter(|(_, value)| !self.cannot_have_effects(*value))
                .count()
                > 1
        {
            return None;
        }
        let slots = before
            .iter()
            .map(|argument| Some(*argument))
            .chain(tail[..=last].iter().map(|parameter| {
                members
                    .iter()
                    .find(|(name, _)| *name == parameter.name)
                    .map(|(_, value)| *value)
            }))
            .collect();
        Some((literal, slots))
    }

    /// The dictionary plan for a call at `record` ([`Self::dictionary_spread`]),
    /// installed for [`Self::lower_call_arguments`]; what was installed
    /// before, for the caller to put back.
    fn spread_for(
        &mut self,
        id: NodeId,
        record: &nts_semantic_schema::SignatureRecord,
        arguments: &[NodeId],
    ) -> Option<(NodeId, NodeId, Vec<Option<NodeId>>)> {
        let plan = self
            .dictionary_spread(record, arguments)
            .map(|(literal, slots)| (id, literal, slots));
        std::mem::replace(&mut self.dictionary_slots, plan)
    }

    /// The function constructing the class a `new` builds, where a binding
    /// implements the class: `new URL(href, base)` is `nts:dom`'s `newURL`,
    /// declared beside the type it binds and named for it. One declaration
    /// per constructor overload and arity, as `append`'s arms are, chosen by
    /// the arguments as a delegated method's are ([`Self::delegated_method`]).
    ///
    /// The binding is read from the interface that names it
    /// (`/** @ntsBoundBy "nts:dom" URL */ interface URL {}`), which is where
    /// `bound_types` reads it too.
    fn delegated_constructor(
        &self,
        id: NodeId,
        arguments: &[NodeId],
    ) -> Option<(NodeId, nts_semantic_schema::SignatureRecord)> {
        let built = *self.snapshot.node_types.get(&id)?;
        self.snapshot.bound_types.get(&built)?;
        let symbol = self.snapshot.types.get(built.0 as usize)?.symbol?;
        let (module, name) = self
            .snapshot
            .symbols
            .get(symbol.0 as usize)?
            .declarations
            .iter()
            .find_map(|declaration| {
                (self.kind_of(*declaration) == Some(syntax::INTERFACE_DECLARATION))
                    .then(|| {
                        nts_semantic_schema::binding::parse(
                            self.node(*declaration)
                                .native
                                .as_deref()?
                                .bound_by
                                .as_deref()?,
                        )
                    })
                    .flatten()
            })?;
        let first = nts_semantic_schema::binding::declared_in(
            self.snapshot,
            module,
            &format!("new{name}"),
            syntax::FUNCTION_DECLARATION,
        )?;
        let TypeKind::Function(merged) = self
            .snapshot
            .types
            .get(self.snapshot.node_types.get(&first)?.0 as usize)?
            .kind
        else {
            return None;
        };
        let merged = &self.snapshot.signatures[merged.0 as usize];
        let overloads: Vec<NodeId> = self
            .name_node(first)
            .and_then(|name| self.node(name).symbol)
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .map_or_else(|| vec![first], |record| record.declarations.clone());
        let candidates: Vec<_> = overloads
            .into_iter()
            .map(|declaration| (declaration, self.overload_signature(declaration, merged)))
            .collect();
        // The construct signature the checker selected for this `new` is
        // what its arguments were checked against; `merged` here is the
        // binding's own constructor function, whose parameters would key
        // `record_holds` on the record's markers instead of the dictionary.
        let checked = self
            .snapshot
            .call_targets
            .get(&id)
            .and_then(|target| self.snapshot.signatures.get(target.signature.0 as usize))
            .unwrap_or(merged);
        let at = self
            .shortest_fit(&candidates, checked, arguments)
            .unwrap_or(0);
        candidates.into_iter().nth(at)
    }

    /// A `new` of a class a binding implements, as a call of its constructor
    /// function ([`Self::delegated_constructor`]) at that overload's
    /// parameters.
    fn lower_delegated_construction(
        &mut self,
        id: NodeId,
        (function, record): (NodeId, nts_semantic_schema::SignatureRecord),
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        self.refuse_dropped_arguments(function, &record, arguments)?;
        let name = nts_semantic_schema::binding::declared_name(self.snapshot, function)
            .unwrap_or_default()
            .to_owned();
        let callee = self.native_callee(id, Some(function), name, &record)?;
        let spread = self.spread_for(id, &record, arguments);
        let outer = self.delegated_signature.replace((id, record));
        let lowered = self.lower_call_arguments(id, &callee, arguments, None);
        self.delegated_signature = outer;
        self.dictionary_slots = spread;
        let (args, lent) = lowered?;
        self.finish_call(id, callee, args, lent, Some(function))
    }

    /// The type implementing `ty`, where a binding implements it -- through a
    /// `| null`, as the representation's own arm reads it.
    fn delegated_type(&self, ty: TypeId) -> Option<TypeId> {
        if let Some(bound) = self.snapshot.bound_types.get(&ty) {
            return Some(*bound);
        }
        let TypeKind::Union(parts) = &self.snapshot.types.get(ty.0 as usize)?.kind else {
            return None;
        };
        let is_null = |part: &&TypeId| {
            matches!(
                self.snapshot.types.get(part.0 as usize).map(|t| &t.kind),
                Some(TypeKind::Null)
            )
        };
        let [payload] = parts
            .iter()
            .filter(|part| !is_null(part))
            .collect::<Vec<_>>()[..]
        else {
            return None;
        };
        self.snapshot.bound_types.get(payload).copied()
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

    /// `handle.method(args)` as the C call `symbol(handle, args)`: the
    /// declared `this` is the C function's first parameter, and the receiver
    /// is passed there -- converted, so a `GtkToggleButton` reaches a method
    /// `GtkButton` declares. No wrapper object and no dispatch: the method
    /// *is* the C function.
    fn lower_native_method_call(
        &mut self,
        id: NodeId,
        (receiver, receiver_node): (ValueId, NodeId),
        (declaration, signature): (NodeId, nts_semantic_schema::SignatureId),
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let record = self.snapshot.signatures[signature.0 as usize].clone();
        self.lower_native_method_call_as(
            id,
            (receiver, receiver_node),
            (declaration, record),
            member,
            arguments,
        )
    }

    /// As [`Self::lower_native_method_call`], at a signature in hand: a
    /// delegated overload's, which the snapshot does not intern.
    fn lower_native_method_call_as(
        &mut self,
        id: NodeId,
        (receiver, receiver_node): (ValueId, NodeId),
        (declaration, record): (NodeId, nts_semantic_schema::SignatureRecord),
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        self.refuse_dropped_arguments(declaration, &record, arguments)?;
        let mut with_this = record;
        let chained = self.without_chain_absence(id, with_this.return_type);
        // A sequence the binding answers where the program reads an array
        // (`event.composedPath()`): the call is the sequence's, and the array
        // is made of it below.
        let sequence = self.sequence_for_array(id, with_this.return_type);
        // In a chain, the message's value is the method's type; the branch
        // around it makes the chain's.
        let typed = if sequence.is_some() {
            self.represent(with_this.return_type)
        } else if chained == with_this.return_type {
            None
        } else {
            self.represent(chained)
        };
        with_this.return_type = chained;
        let name = self
            .node(member)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())
            .map(str::to_owned)
            .unwrap_or_default();
        // `list.as_IVector()`: the object as another of its interfaces.
        if let Some(iid) = self
            .node(declaration)
            .native
            .as_ref()
            .and_then(|n| n.query.clone())
        {
            return self.lower_query(id, receiver, &iid, with_this.return_type, arguments);
        }
        // `button.addEventListener("click", f)`: the runtime's, over the
        // event the listener's type names.
        if let Some(direction) = self
            .node(declaration)
            .native
            .as_ref()
            .and_then(|n| n.listener.clone())
        {
            return self.lower_event_listener(id, receiver, &direction, &with_this, arguments);
        }
        // `this.emit("incremented", 1)`: a signal a class the program wrote
        // declares, emitted by its id (`WithSignals` in `c:types`).
        if self
            .node(declaration)
            .native
            .as_ref()
            .and_then(|n| n.symbol.as_deref())
            == Some("nts_gobject_emit")
        {
            return self.lower_gobject_emit(
                id,
                (receiver, receiver_node),
                declaration,
                with_this,
                arguments,
            );
        }
        // A class method is sent to the class, which the send looks up
        // itself: the receiver the program wrote is the class, as a value.
        if self
            .objc_class_member(declaration)
            .is_some_and(|member| member.is_static)
        {
            let callee = self.native_callee(id, Some(declaration), name, &with_this)?;
            let (args, lent) = self.lower_call_arguments(id, &callee, arguments, None)?;
            return self.finish_call_typed(id, callee, args, lent, Some(declaration), typed);
        }
        // An Objective-C class's method has no written `this`: it is the
        // object the method is called on, at the type the program has it.
        let this = with_this
            .this_type
            // `this` in a method of a class the program writes over a
            // handle's is the class's polymorphic `this`: its members, and
            // its representation, are the class's.
            // Present where the message is sent: `a?.b?.m()` sends `m` to
            // `a.b` as a `B`.
            .or_else(|| {
                self.snapshot
                    .node_types
                    .get(&receiver_node)
                    .map(|ty| self.class_behind(self.present_part(*ty).unwrap_or(*ty)))
            })
            .ok_or_else(|| self.unsupported(id, "a C method with no `this` type"))?;
        // Written arguments answer to the selected binding overload, not
        // the lib.dom/global signature which led us here. Keep its parameter
        // list before adding the synthetic C receiver below.
        let argument_signature = with_this.clone();
        with_this.parameters.insert(
            0,
            nts_semantic_schema::ParameterRecord {
                name: "this".to_owned(),
                ty: this,
                optional: false,
                rest: false,
            },
        );
        let mut callee = self.native_callee(id, Some(declaration), name, &with_this)?;
        // `nts_gobject_connect` takes the instance as the `gpointer` it is in
        // C, whichever class a declaration names -- a binding's `Erased<X>`, or
        // the class a program wrote (`WithSignals`, whose `this` is the class
        // itself so that the handler's `self` is) -- so every call prints the
        // one prototype.
        if let Callee::Native(target) = &mut callee
            && target.name == "nts_gobject_connect"
            && let Some(first) = std::sync::Arc::make_mut(target).parameters.first_mut()
        {
            *first = super::native::Type::Pointer(super::native::Pointee::Void);
        }
        let (receiver, queried) = self.via_receiver(id, declaration, receiver)?;
        let callee = via_callee(callee, queried.is_some());
        let (args, lent) =
            self.bound_arguments(id, &callee, arguments, receiver, argument_signature)?;
        let answer = self.finish_call_typed(id, callee, args, lent, Some(declaration), typed)?;
        self.release_via(id, queried);
        match sequence {
            Some(sequence) => {
                let array = self
                    .type_of(id)
                    .ok_or_else(|| self.unrepresentable(id, "an array made of a sequence"))?;
                self.array_of_sequence(id, answer, sequence, array)
            }
            None => Ok(answer),
        }
    }

    /// Scope the selected native binding's written parameter contract to this
    /// call, restoring an enclosing call's context before propagating failure.
    fn bound_arguments(
        &mut self,
        id: NodeId,
        callee: &Callee,
        arguments: &[NodeId],
        receiver: ValueId,
        signature: nts_semantic_schema::SignatureRecord,
    ) -> Result<(Vec<ValueId>, Vec<Lent>), Diagnostic> {
        let outer = self.delegated_signature.replace((id, signature));
        let lowered = self.lower_call_arguments(id, callee, arguments, Some(receiver));
        self.delegated_signature = outer;
        lowered
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

    /// A TypeScript array as the `NSArray` an Objective-C message takes, as
    /// Swift's `[T]` crosses: made for the call by the CF host in one
    /// `CFArrayCreate` over the array's own elements, or over an `NSString`
    /// made of each string, and the caller's (+1), so the program's count
    /// releases it after the send.
    fn ns_array_of(
        &mut self,
        id: NodeId,
        array: ValueId,
        element: &super::native::Bridged,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        use super::native::{Bridged, Handle, Pointee, Type};
        if !matches!(
            self.values[array.0 as usize].ty,
            HirType::Managed(ManagedType::Array(_))
        ) {
            return Err(self.unsupported(id, "an `NSArray` argument that is not an array"));
        }
        let helper = match element {
            Bridged::Object(_) => "nts_nsarray_of_objects",
            Bridged::String => "nts_nsarray_of_strings",
        };
        let made = Type::Pointer(Pointee::Opaque(Handle::objc("NSArray")));
        Ok(self.runtime_call(helper, vec![array], made.representation(), origin.clone()))
    }

    /// A `Map<string, V>` as the `NSDictionary` an Objective-C message takes,
    /// as Swift's `[String: V]` crosses: made for the call by the CF host from
    /// the map's entries -- each key an `NSString`, each value the object its
    /// box holds or an `NSString` made of a string -- and the caller's (+1),
    /// so the program's count releases it after the send.
    fn ns_dictionary_of(
        &mut self,
        id: NodeId,
        map: ValueId,
        value: &super::native::Bridged,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        use super::native::{Bridged, Handle, Pointee, Type};
        if !matches!(
            self.values[map.0 as usize].ty,
            HirType::Managed(ManagedType::Map(_, _))
        ) {
            return Err(self.unsupported(id, "an `NSDictionary` argument that is not a map"));
        }
        let helper = match value {
            Bridged::Object(_) => "nts_nsdictionary_of_objects",
            Bridged::String => "nts_nsdictionary_of_strings",
        };
        let made = Type::Pointer(Pointee::Opaque(Handle::objc("NSDictionary")));
        Ok(self.runtime_call(helper, vec![map], made.representation(), origin.clone()))
    }

    /// The `NSArray` a message returned, as the TypeScript array the program
    /// reads (Swift's `[T]`): an array of `count` elements, filled by the CF
    /// host in one pass -- the objects, each counted by the array, or a string
    /// copied out of each `NSString`.
    fn read_ns_array(
        &mut self,
        id: NodeId,
        returned: ValueId,
        element: &super::native::Bridged,
        ty: HirType,
    ) -> Result<ValueId, Diagnostic> {
        use super::native::{Bridged, Handle, Pointee, Scalar, Type};
        let origin = self.origin(id);
        if !matches!(ty, HirType::Managed(ManagedType::Array(_))) {
            return Err(self.unsupported(
                id,
                "an `NSArray` result the program does not read as an array",
            ));
        }
        // Swift's `[T]?`: a nil `NSArray` is `null`, and only one that is
        // there is counted and filled.
        let nil = self.push(
            OpKind::ConstNull,
            self.values[returned.0 as usize].ty.clone(),
            origin.clone(),
        );
        let absent = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: returned,
                rhs: nil,
            },
            HirType::Bool,
            origin.clone(),
        );
        let (none_block, some_block, merge) =
            (self.new_block(), self.new_block(), self.new_block());
        let result = self.push_block_param(merge, ty.clone(), origin.clone());
        self.terminate(Terminator::Branch {
            cond: absent,
            then_target: none_block,
            then_args: Vec::new(),
            else_target: some_block,
            else_args: Vec::new(),
        });
        self.switch_to(none_block);
        let none = self.push(OpKind::ConstNull, ty.clone(), origin.clone());
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![none],
        });
        self.switch_to(some_block);
        let array = Type::Pointer(Pointee::Opaque(Handle::objc("NSArray")));
        let count = self.send_bridge(
            bridge_send("count", None, vec![array], Type::Scalar(Scalar::ULong)),
            vec![returned],
            &origin,
        );
        let length = self.coerce(count, &HirType::NUMBER, id)?;
        let out = self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Holes,
            },
            ty,
            origin.clone(),
        );
        let fill = match element {
            Bridged::Object(_) => "nts_array_fill_from_nsarray",
            Bridged::String => "nts_array_fill_strings_from_nsarray",
        };
        self.runtime_call(fill, vec![out, returned], HirType::Void, origin);
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![out],
        });
        self.switch_to(merge);
        Ok(result)
    }

    /// The `NSDictionary` a message returned, as the `Map<string, V>` the
    /// program reads (Swift's `[String: V]`), or `null` for nil: its keys
    /// and values filled into two arrays by the CF host in one pass -- each
    /// key a string, each value an object the array counts or a string --
    /// then set into a new map a pair at a time, each object boxed as any
    /// map holds one.
    /// A TypeScript collection as the Foundation one a message takes, as
    /// Swift's `[T]`, `[String: V]` and `Set<T>` cross.
    fn foundation_collection(
        &mut self,
        id: NodeId,
        value: ValueId,
        role: &super::native::Role,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        use super::native::Role;
        match role {
            Role::NSArray(element) => self.ns_array_of(id, value, element, origin),
            Role::NSDictionary(kind) => self.ns_dictionary_of(id, value, kind, origin),
            Role::NSSet(element) => self.ns_set_of(id, value, element, origin),
            _ => Err(self.unsupported(
                id,
                "a collection a message takes that is not an array, a dictionary or a set",
            )),
        }
    }

    /// A `Set<T>` as the `NSSet` a message takes, as Swift's `Set<T>` crosses:
    /// made of the elements (`nts_nsset_of_*`), +1, released after the call.
    fn ns_set_of(
        &mut self,
        id: NodeId,
        set: ValueId,
        element: &super::native::Bridged,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        use super::native::{Bridged, Handle, Pointee, Type};
        if !matches!(
            self.values[set.0 as usize].ty,
            HirType::Managed(ManagedType::Set(_))
        ) {
            return Err(self.unsupported(id, "an `NSSet` argument that is not a set"));
        }
        let helper = match element {
            Bridged::Object(_) => "nts_nsset_of_objects",
            Bridged::String => "nts_nsset_of_strings",
        };
        let made = Type::Pointer(Pointee::Opaque(Handle::objc("NSSet")));
        Ok(self.runtime_call(helper, vec![set], made.representation(), origin.clone()))
    }

    /// An `NSSet` a message returns, read as a `Set<T>`: its `allObjects`,
    /// read as an array is, then each added -- an object in its family's
    /// box, which the set hashes and compares by `-hash` and `-isEqual:`. A
    /// nil set is `null`.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn read_ns_set(
        &mut self,
        id: NodeId,
        returned: ValueId,
        element: &super::native::Bridged,
        ty: HirType,
    ) -> Result<ValueId, Diagnostic> {
        use super::native::{Handle, Pointee, Type};
        let origin = self.origin(id);
        let HirType::Managed(ManagedType::Set(element_ty)) = ty.clone() else {
            return Err(
                self.unsupported(id, "an `NSSet` result the program does not read as a set")
            );
        };
        let nil = self.push(
            OpKind::ConstNull,
            self.values[returned.0 as usize].ty.clone(),
            origin.clone(),
        );
        let absent = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: returned,
                rhs: nil,
            },
            HirType::Bool,
            origin.clone(),
        );
        let (none_block, some_block, merge) =
            (self.new_block(), self.new_block(), self.new_block());
        let result = self.push_block_param(merge, ty.clone(), origin.clone());
        self.terminate(Terminator::Branch {
            cond: absent,
            then_target: none_block,
            then_args: Vec::new(),
            else_target: some_block,
            else_args: Vec::new(),
        });
        self.switch_to(none_block);
        let none = self.push(OpKind::ConstNull, ty.clone(), origin.clone());
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![none],
        });
        self.switch_to(some_block);
        let set_type = Type::Pointer(Pointee::Opaque(Handle::objc("NSSet")));
        let array_type = Type::Pointer(Pointee::Opaque(Handle::objc("NSArray")));
        let all = self.send_bridge(
            bridge_send("allObjects", None, vec![set_type], array_type),
            vec![returned],
            &origin,
        );
        let items = self.read_ns_array(
            id,
            all,
            element,
            HirType::Managed(ManagedType::Array(element_ty.clone())),
        )?;
        let kind = self.push(
            OpKind::ConstFloat(f64::from(super::tables::key_kind(&element_ty))),
            HirType::NUMBER,
            origin.clone(),
        );
        let set = self.runtime_call("nts_set_new", vec![kind], ty.clone(), origin.clone());
        // `for (const item of items) set.add(item)`.
        let length = self.push(OpKind::Length(items), HirType::NUMBER, origin.clone());
        let (head, body, done) = (self.new_block(), self.new_block(), self.new_block());
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        self.terminate(Terminator::Jump {
            target: head,
            args: vec![zero],
        });
        self.switch_to(head);
        let at = self.push_block_param(head, HirType::NUMBER, origin.clone());
        let more = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: at,
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: more,
            then_target: body,
            then_args: Vec::new(),
            else_target: done,
            else_args: Vec::new(),
        });
        self.switch_to(body);
        let item = self.push(
            OpKind::ArrayGet {
                array: items,
                index: at,
                checked: false,
            },
            (*element_ty).clone(),
            origin.clone(),
        );
        // An `NSSet` holds no `nil`.
        let key = self.erased(item, Absent::Impossible, &origin);
        self.keyed_call(
            "nts_set_add",
            &ty.clone(),
            vec![set, key],
            ty,
            origin.clone(),
        );
        let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
        let next = self.push(
            OpKind::Binary {
                op: BinOp::Add,
                lhs: at,
                rhs: one,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        self.terminate(Terminator::Jump {
            target: head,
            args: vec![next],
        });
        self.switch_to(done);
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![set],
        });
        self.switch_to(merge);
        Ok(result)
    }

    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn read_ns_dictionary(
        &mut self,
        id: NodeId,
        returned: ValueId,
        value: &super::native::Bridged,
        ty: HirType,
    ) -> Result<ValueId, Diagnostic> {
        use super::native::{Bridged, Handle, Pointee, Scalar, Type};
        let origin = self.origin(id);
        let HirType::Managed(ManagedType::Map(key_ty, value_ty)) = ty.clone() else {
            return Err(self.unsupported(
                id,
                "an `NSDictionary` result the program does not read as a map",
            ));
        };
        let nil = self.push(
            OpKind::ConstNull,
            self.values[returned.0 as usize].ty.clone(),
            origin.clone(),
        );
        let absent = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: returned,
                rhs: nil,
            },
            HirType::Bool,
            origin.clone(),
        );
        let (none_block, some_block, merge) =
            (self.new_block(), self.new_block(), self.new_block());
        let result = self.push_block_param(merge, ty.clone(), origin.clone());
        self.terminate(Terminator::Branch {
            cond: absent,
            then_target: none_block,
            then_args: Vec::new(),
            else_target: some_block,
            else_args: Vec::new(),
        });
        self.switch_to(none_block);
        let none = self.push(OpKind::ConstNull, ty.clone(), origin.clone());
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![none],
        });
        self.switch_to(some_block);
        let dictionary = Type::Pointer(Pointee::Opaque(Handle::objc("NSDictionary")));
        let count = self.send_bridge(
            bridge_send("count", None, vec![dictionary], Type::Scalar(Scalar::ULong)),
            vec![returned],
            &origin,
        );
        let length = self.coerce(count, &HirType::NUMBER, id)?;
        let keys = self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Holes,
            },
            HirType::Managed(ManagedType::Array(key_ty.clone())),
            origin.clone(),
        );
        let values = self.push(
            OpKind::ArrayNew {
                length,
                fill: ArrayFill::Holes,
            },
            HirType::Managed(ManagedType::Array(value_ty.clone())),
            origin.clone(),
        );
        let fill = match value {
            Bridged::Object(_) => "nts_dictionary_fill_from_nsdictionary",
            Bridged::String => "nts_dictionary_fill_strings_from_nsdictionary",
        };
        self.runtime_call(
            fill,
            vec![keys, values, returned],
            HirType::Void,
            origin.clone(),
        );
        let kind = self.push(
            OpKind::ConstFloat(f64::from(super::tables::key_kind(&key_ty))),
            HirType::NUMBER,
            origin.clone(),
        );
        // A table where the binding types the dictionary as an object, a `Map`
        // where it says `Map`: the two print differently (`nts_desc_table`).
        let allocate = if matches!(ty, HirType::Managed(ManagedType::Table(_, _))) {
            "nts_table_new"
        } else {
            "nts_map_new"
        };
        let map = self.runtime_call(allocate, vec![kind], ty.clone(), origin.clone());
        // `for (let at = 0; at < length; at++) map.set(keys[at], values[at])`.
        let (head, body, done) = (self.new_block(), self.new_block(), self.new_block());
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        self.terminate(Terminator::Jump {
            target: head,
            args: vec![zero],
        });
        self.switch_to(head);
        let at = self.push_block_param(head, HirType::NUMBER, origin.clone());
        let more = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: at,
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: more,
            then_target: body,
            then_args: Vec::new(),
            else_target: done,
            else_args: Vec::new(),
        });
        self.switch_to(body);
        let key = self.push(
            OpKind::ArrayGet {
                array: keys,
                index: at,
                checked: false,
            },
            (*key_ty).clone(),
            origin.clone(),
        );
        let entry = self.push(
            OpKind::ArrayGet {
                array: values,
                index: at,
                checked: false,
            },
            (*value_ty).clone(),
            origin.clone(),
        );
        // An `NSDictionary` holds no `nil`, as a key or as a value.
        let key = self.erased(key, Absent::Impossible, &origin);
        let entry = self.erased(entry, Absent::Impossible, &origin);
        self.keyed_call(
            "nts_map_set",
            &ty.clone(),
            vec![map, key, entry],
            ty,
            origin.clone(),
        );
        let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
        let next = self.push(
            OpKind::Binary {
                op: BinOp::Add,
                lhs: at,
                rhs: one,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        self.terminate(Terminator::Jump {
            target: head,
            args: vec![next],
        });
        self.switch_to(done);
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![map],
        });
        self.switch_to(merge);
        Ok(result)
    }

    /// The string a native function returned: C's `const char *`, copied,
    /// then released with the declaration's `@ntsFree` if it names one.
    ///
    /// Immediately after the call and in the same block, and nothing can
    /// branch between them: a native call names no raising copy, so it gets no
    /// raise test, and the copy and the free are runtime calls that cannot
    /// raise either. The free comes after the copy, which is the one order in
    /// which C's string is never read after it is released.
    /// A labelled argument: the property of the labels literal its key names,
    /// at the slot's type. `placeholder` is what the literal lowered to.
    /// A label's value as the C argument its role makes of it.
    fn label_argument(
        &mut self,
        id: NodeId,
        value: ValueId,
        inner: &super::native::Role,
        slot: &super::native::Type,
        lent: &mut Vec<Lent>,
    ) -> Result<ValueId, Diagnostic> {
        use super::native::Role;
        let origin = self.origin(id);
        Ok(match inner {
            Role::NSString => self.ns_string_of(value, &origin),
            Role::NSArray(_) | Role::NSDictionary(_) | Role::NSSet(_) => {
                self.foundation_collection(id, value, inner, &origin)?
            }
            Role::Block { bridge, signature } => self
                .lend_block(
                    id,
                    Some(value),
                    (bridge.clone(), signature.clone()),
                    slot.representation(),
                    lent,
                    &origin,
                )?
                .ok_or_else(|| self.unsupported(id, "a block label with no function"))?,
            Role::String(encoding) => {
                self.lend_string(value, *encoding, slot.representation(), lent, origin)
            }
            _ => self.coerce(value, &slot.representation(), id)?,
        })
    }

    /// The value a call gave the label `key`: the literal's property, or a
    /// field of labels passed as an object -- `self.beginSheet(labels, ...)`,
    /// which is how a wrapper passes on the labels it was given.
    fn label_value(
        &mut self,
        id: NodeId,
        placeholder: Option<ValueId>,
        key: &str,
    ) -> Result<ValueId, Diagnostic> {
        let missing =
            |this: &Self| this.unsupported(id, &format!("a call missing its `{key}` label"));
        let Some(argument) = placeholder else {
            return Err(missing(self));
        };
        if let Some(values) = self.labels_lowered.get(&argument) {
            return values
                .iter()
                .find(|(named, _)| named == key)
                .map(|(_, value)| *value)
                .ok_or_else(|| missing(self));
        }
        let HirType::Managed(ManagedType::Object(type_id)) =
            self.values[argument.0 as usize].ty.clone()
        else {
            return Err(self.unsupported(
                id,
                "labels that are neither an object literal nor an object",
            ));
        };
        let layout = self.layout_of(id, type_id)?;
        let field = layout.index_of(key).ok_or_else(|| missing(self))?;
        let ty = layout.fields[field as usize].ty.clone();
        let origin = self.origin(id);
        Ok(self.push(
            OpKind::FieldGet {
                object: argument,
                field,
            },
            ty,
            origin,
        ))
    }

    /// A `string` as the `NSString` an Objective-C message takes, as Swift's
    /// `String` crosses: made by the CF host from the string's own storage,
    /// one-byte or two-byte as it is (`nts_nsstring_of`), and the caller's
    /// (+1), so the program's count releases it once the message is sent.
    fn ns_string_of(&mut self, string: ValueId, origin: &Origin) -> ValueId {
        let object = super::native::Type::Pointer(super::native::Pointee::Opaque(
            super::native::Handle::ns_string(),
        ));
        self.runtime_call(
            "nts_nsstring_of",
            vec![string],
            object.representation(),
            origin.clone(),
        )
    }

    fn read_native_string(
        &mut self,
        id: NodeId,
        pointer: ValueId,
        target: &super::native::Function,
        string: &super::native::ReturnedString,
        typed: Option<HirType>,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        // A message that returns an `NSString` the program reads as a
        // `string`, as Swift's `String`: copied by the CF host from its own
        // storage, the eight-bit bytes as they are where it has them. A nil
        // object is `null`. A C function's `BridgedString` result is one too
        // (`bridge_strings`), and not the `char *` its `string` would be.
        let ns_string = matches!(&target.result, super::native::Type::Pointer(super::native::Pointee::Opaque(handle)) if *handle == super::native::Handle::ns_string());
        if (target.send.is_some()
            && matches!(
                target.result,
                super::native::Type::Pointer(super::native::Pointee::Opaque(_))
            ))
            || ns_string
        {
            let ty = typed
                .or_else(|| self.type_of(id))
                .ok_or_else(|| self.unrepresentable(id, "a returned string"))?;
            return Ok(self.runtime_call("nts_string_of_nsstring", vec![pointer], ty, origin));
        }
        let value = if string.view {
            // C's view holds only until C is called again, so it is copied
            // now, exactly, at the narrowest width that holds it.
            let ty = typed
                .or_else(|| self.type_of(id))
                .ok_or_else(|| self.unrepresentable(id, "a returned string"))?;
            let copy = if string.nullable {
                "nts_string_from_view"
            } else {
                "nts_string_from_required_view"
            };
            self.runtime_call(copy, vec![pointer], ty, origin.clone())
        } else if string.array {
            // Every element copied, so the array is the program's whatever C
            // does with its own afterwards. `required` is the declaration's
            // promise that C returns one, which a NULL breaks.
            let required = self.push(
                OpKind::ConstBool(!string.nullable),
                HirType::Bool,
                origin.clone(),
            );
            let ty = HirType::Managed(ManagedType::Array(Box::new(HirType::Managed(
                ManagedType::String,
            ))));
            self.runtime_call(
                "nts_strings_from_cstrings",
                vec![pointer, required],
                ty,
                origin.clone(),
            )
        } else {
            let ty = typed
                .or_else(|| self.type_of(id))
                .ok_or_else(|| self.unrepresentable(id, "a returned string"))?;
            let copy = if string.nullable {
                "nts_string_from_cstring"
            } else {
                "nts_string_from_required_cstring"
            };
            self.runtime_call(copy, vec![pointer], ty, origin.clone())
        };
        if let Some(free) = &string.free {
            let release = super::native::Function {
                thunk: None,
                name: free.clone(),
                convention: super::native::Convention::C,
                parameters: vec![if string.array {
                    target.result.clone()
                } else {
                    super::native::Type::Pointer(super::native::Pointee::Void)
                }],
                result: super::native::Type::Void,
                retention: vec![super::native::Retention::Unknown],
                variadic: None,
                // The same header as the function that returned the string:
                // a library's free function is declared where its allocator's
                // results are.
                declared_at: target.declared_at,
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
            };
            self.push(
                OpKind::Call {
                    callee: Callee::Native(std::sync::Arc::new(release)),
                    args: vec![pointer],
                    frame: None,
                },
                HirType::Void,
                origin,
            );
        }
        Ok(value)
    }

    /// Give back everything a native call was lent -- C strings and scoped
    /// closures' contexts -- now that it returned.
    ///
    /// Immediately after the call and in the same block, so nothing on the
    /// straight-line path can skip it. **One path does, and it is shared by
    /// both kinds:** a raise from a call sequenced *after* the lend and before
    /// this, inside one `try`, branches to the handler and skips the give-back.
    /// Today nothing sits between them -- the conversions are built as the
    /// arguments, and a native call names no raising copy so gets no test --
    /// but an argument expression that raises after an earlier one was lent
    /// would leak it. A leak, not a crash; whoever fixes it for one kind fixes
    /// it for the other.
    /// A `string` as the C argument its encoding makes of it, lent for the call.
    ///
    /// A conversion -- UTF-8, UTF-16, an `HSTRING` -- is a runtime call whose
    /// result is given back after the call (`give_back`). A view is the string
    /// itself, reinterpreted as the opaque `const NtsBorrowedString *` C reads
    /// with `nts_string_view`: no call and nothing to give back. The pointer
    /// holds no count of its own, so it leans on the string, and the string's
    /// release is placed after the call that reads it.
    /// A string argument lent as [`Self::lend_string`] lends it.
    ///
    /// **A string is lent, and only a string.** A call's own types vouch for
    /// that everywhere but a member lib.dom declares wider than the binding
    /// implementing it: `ctx.fillStyle = gradient` reached
    /// `_set_fillStyle_string(StringView)`, and the gradient's handle was lent
    /// as the string -- a pointer cast, which compiled. Refused here, where
    /// every native call's string passes, rather than at each way of reaching
    /// one.
    fn lend_string_argument(
        &mut self,
        id: NodeId,
        string: ValueId,
        encoding: super::native::Encoding,
        representation: HirType,
        lent: &mut Vec<Lent>,
        origin: Origin,
    ) -> Result<ValueId, Diagnostic> {
        let have = &self.values[string.0 as usize].ty;
        if !matches!(have, HirType::Managed(ManagedType::String)) && *have != representation {
            return Err(self.unsupported(
                id,
                "a value that is not a string, where the native function takes a string",
            ));
        }
        Ok(self.lend_string(string, encoding, representation, lent, origin))
    }

    fn lend_string(
        &mut self,
        string: ValueId,
        encoding: super::native::Encoding,
        representation: HirType,
        lent: &mut Vec<Lent>,
        origin: Origin,
    ) -> ValueId {
        let Some(to_c) = encoding.to_c() else {
            // A view is the string itself, lent (`NativeStringView`). One
            // already at the view's representation is passed on as it is.
            if self.values[string.0 as usize].ty == representation {
                return string;
            }
            return self.push(OpKind::NativeStringView { string }, representation, origin);
        };
        let pointer = self.runtime_call(to_c, vec![string], representation, origin);
        lent.push(Lent::String {
            string,
            pointer,
            encoding,
        });
        pointer
    }

    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn give_back(&mut self, id: NodeId, lent: Vec<Lent>) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        for lent in lent {
            match lent {
                Lent::String {
                    string,
                    pointer,
                    encoding,
                } => {
                    // Only a conversion is lent this way; a view made nothing.
                    if let Some(release) = encoding.release() {
                        self.runtime_call(
                            release,
                            vec![string, pointer],
                            HirType::Void,
                            origin.clone(),
                        );
                    }
                }
                Lent::Closure { context } => {
                    self.runtime_call(
                        "nts_closure_unlend",
                        vec![context],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                Lent::Strings { pointer } => {
                    self.runtime_call(
                        "nts_cstrings_release",
                        vec![pointer],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                Lent::HStrings { array, block } => {
                    self.runtime_call(
                        "nts_hstrings_release",
                        vec![array, block],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                Lent::Filled { array, block } => self.copy_filled(id, array, block)?,
                Lent::Block { block } => {
                    let freed = self.push(
                        OpKind::Convert(block),
                        HirType::NativePointer(super::native::Pointee::Void),
                        origin.clone(),
                    );
                    self.runtime_call("nts_winrt_free", vec![freed], HirType::Void, origin.clone());
                }
                Lent::View { view } => {
                    self.runtime_call("nts_view_unlend", vec![view], HirType::Void, origin.clone());
                }
                Lent::Borrowed { string } => {
                    self.runtime_call(
                        "nts_string_unlend",
                        vec![string],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                Lent::Array { array } => {
                    self.runtime_call(
                        "nts_array_unlend",
                        vec![array],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                Lent::Queried { array, block } => {
                    self.runtime_call(
                        "nts_com_release_array",
                        vec![array, block],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                Lent::Boxed { boxed } => {
                    self.runtime_call(
                        "nts_boxed_unlend",
                        vec![boxed],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                // A reference the call was handed, or the inner object a
                // composable factory answered: the program's, given back.
                Lent::Delegate { object } | Lent::Taken { object } | Lent::Box { object } => {
                    self.runtime_call(
                        "nts_com_release",
                        vec![object],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                Lent::Inner { slot } => {
                    let inner = self.runtime_call(
                        "nts_com_take",
                        vec![slot],
                        HirType::NativePointer(super::native::Pointee::Void),
                        origin.clone(),
                    );
                    self.runtime_call(
                        "nts_com_release",
                        vec![inner],
                        HirType::Void,
                        origin.clone(),
                    );
                }
                // Checked, or read, by `finish_call` after everything else is
                // given back; each is a local of the caller's own.
                Lent::Error { .. } | Lent::Result { .. } | Lent::Count { .. } => {}
            }
        }
        Ok(())
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

    /// `nts_promise_reject_error(promise, name, message)`: what a host rejects
    /// a promise a foreign function answered with (`native::promised`) --
    /// the program's own `Error`, `name` and `message` copied from the C
    /// strings the host keeps, as an `@ntsThrows` call surfaces a synchronous
    /// one. A function of the program's, since only the program has its
    /// `Error`'s layout; declared by `nts_runtime.h` for the host to call.
    fn lower_reject_error(&mut self, site: NodeId) -> Result<Func, Diagnostic> {
        let origin = self.origin(site);
        let text = HirType::NativePointer(super::native::Pointee::Const(Box::new(
            super::native::Pointee::Scalar(super::native::Scalar::Char),
        )));
        let promise_ty = HirType::Managed(ManagedType::Promise(Box::new(HirType::Erased)));
        let param = |name: &str, ty: &HirType| Param {
            name: name.to_owned(),
            shape: ParamShape::Ordinary,
            ty: ty.clone(),
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        };
        let params = vec![
            param("promise", &promise_ty),
            param("name", &text),
            param("message", &text),
        ];
        let promise = self.push(OpKind::Param(0), promise_ty, origin.clone());
        let name = self.push(OpKind::Param(1), text.clone(), origin.clone());
        let message = self.push(OpKind::Param(2), text, origin.clone());
        let string = HirType::Managed(ManagedType::String);
        let name = self.runtime_call(
            "nts_string_from_required_cstring",
            vec![name],
            string.clone(),
            origin.clone(),
        );
        let message = self.runtime_call(
            "nts_string_from_required_cstring",
            vec![message],
            string,
            origin.clone(),
        );
        let (error, _) = self.provided_error_named(site, "Error", message, name)?;
        self.runtime_call(
            "nts_promise_reject",
            vec![promise, error],
            HirType::Void,
            origin.clone(),
        );
        self.terminate(Terminator::Return(None));
        Ok(self.finish(REJECT_ERROR.to_owned(), params, HirType::Void, origin, true))
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

    /// An argument where the Windows Runtime takes any object (`Role::Box`):
    /// an object as itself, and a string, number or boolean boxed by the
    /// runtime (`nts_winrt_box`, from the value erased) into an
    /// `IPropertyValue` the call is lent and gives back.
    fn box_argument(
        &mut self,
        id: NodeId,
        value: ValueId,
        want: HirType,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        // Lowered against the union the parameter is, an object arrives
        // erased: the object it was is passed instead.
        let object = match self.values[value.0 as usize].kind {
            OpKind::Erase { value: inner, .. }
                if matches!(self.values[inner.0 as usize].ty, HirType::NativePointer(_)) =>
            {
                Some(inner)
            }
            _ => matches!(self.values[value.0 as usize].ty, HirType::NativePointer(_))
                .then_some(value),
        };
        if let Some(object) = object {
            return self.coerce(object, &want, id);
        }
        let erased = self.coerce(value, &HirType::Erased, id)?;
        let object = self.runtime_call("nts_winrt_box", vec![erased], want, origin.clone());
        lent.push(Lent::Box { object });
        Ok(object)
    }

    /// A closure as a Windows Runtime delegate: a COM object made for the call
    /// (`nts_com_delegate`) whose `Invoke` is the adapter for `signature`, and
    /// which holds the bridge into the closure's body and the closure, lent
    /// until the object's count reaches zero. The caller's reference is given
    /// back after the call.
    fn delegate(
        &mut self,
        id: NodeId,
        closure: ValueId,
        (bridge, signature, iid): (
            std::sync::Arc<super::native::FnPointer>,
            std::sync::Arc<super::native::FnPointer>,
            &str,
        ),
        want: HirType,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        if !super::native::is_interface_id(iid) {
            return Err(self.unsupported(
                id,
                "a `Delegate` whose interface ID is not 8-4-4-4-12 hexadecimal digits",
            ));
        }
        let pointer = HirType::NativePointer(super::native::Pointee::Void);
        let invoke = self.bridge_closure(
            id,
            closure,
            (&bridge, super::Bridging::default()),
            false,
            pointer.clone(),
            origin,
        )?;
        let adapter = self.push(
            OpKind::DelegateInvoke { signature },
            pointer.clone(),
            origin.clone(),
        );
        let context = self.runtime_call(
            "nts_closure_lend",
            vec![closure],
            pointer.clone(),
            origin.clone(),
        );
        let [low, high] = self.iid_arguments(iid, origin);
        let object = self.runtime_call(
            "nts_com_delegate",
            vec![adapter, invoke, context, low, high],
            want,
            origin.clone(),
        );
        lent.push(Lent::Delegate { object });
        Ok(object)
    }

    /// A typed array's storage lent to a call that reads it as `element`s
    /// (`Role::Bytes`), in place (`nts_view_lend_bytes`), given back after the call
    /// (`Lent::View`). No copy: C reads the elements the program holds.
    ///
    /// **Nothing else has that storage.** The call is checked against the
    /// declaration the program wrote, and a lib.dom member a binding
    /// implements is checked against lib.dom's, which takes any sequence of
    /// numbers: so `ctx.setLineDash([5, 3])` gave a `number[]` where nts:dom
    /// lends a `Float64Array`, and `nts_view_bytes` read the array's header as
    /// a view's (the Chromium lane's
    /// lib-dom-a-number-array-for-a-typed-array-parameter). Anything else is
    /// refused by name, as `lend_handles` refuses an array of non-handles.
    fn lend_bytes(
        &mut self,
        id: NodeId,
        view: ValueId,
        element: &HirType,
        want: HirType,
        lent: &mut Vec<Lent>,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        match &self.values[view.0 as usize].ty {
            HirType::Managed(ManagedType::View(held)) if **held == *element => {}
            HirType::Managed(ManagedType::View(_)) => {
                return Err(self.unsupported(
                    id,
                    "a `CBytes` or `CElements` argument whose typed array holds other elements than C reads",
                ));
            }
            held => {
                let why = format!(
                    "a `CBytes` or `CElements` argument that is {}, not a typed array: C would read it as one",
                    named_representation(held)
                );
                return Err(self.unsupported(id, &why));
            }
        }
        lent.push(Lent::View { view });
        Ok(self.borrow_bytes(view, want, &origin))
    }

    /// A typed array's storage where C takes a pointer to its elements, NULL
    /// for `null`: `nts_view_lend_bytes`, in place -- read as the bytes it is and
    /// cast to the element pointer C takes, which is a `const int32_t *` for
    /// an `Int32Array` and only coincides with the bytes for a `Uint8Array`.
    fn borrow_bytes(&mut self, view: ValueId, want: HirType, origin: &Origin) -> ValueId {
        let absent = self.push(OpKind::ConstNull, want.clone(), origin.clone());
        self.unless_null(view, absent, origin, |this| {
            let bytes = HirType::NativePointer(super::native::Pointee::Scalar(
                super::native::Scalar::UInt8,
            ));
            let storage = this.runtime_call(
                "nts_view_lend_bytes",
                vec![view],
                bytes.clone(),
                origin.clone(),
            );
            if want == bytes {
                storage
            } else {
                this.push(OpKind::Convert(storage), want, origin.clone())
            }
        })
    }

    /// A `string[]` as a block of `HSTRING`s, each lent for the call, NULL for
    /// a `null` array, and all given back after it (`Lent::HStrings`).
    fn lend_hstrings(
        &mut self,
        array: ValueId,
        want: HirType,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> ValueId {
        let absent = self.push(OpKind::ConstNull, want.clone(), origin.clone());
        let block = self.unless_null(array, absent, origin, |this| {
            this.runtime_call("nts_strings_to_hstrings", vec![array], want, origin.clone())
        });
        lent.push(Lent::HStrings { array, block });
        block
    }

    /// An array lent to a call as a block its role makes: a `string[]` as
    /// a `char **` or as `HSTRING`s, NULL for a `null` array, an array of
    /// plain objects as a block of structs -- each converted for the call and
    /// given back after it -- or an array the callee fills: objects in the
    /// array's own block, strings and structs in one of the call's, copied
    /// into the array after it.
    fn lend_array(
        &mut self,
        id: NodeId,
        role: &super::native::Role,
        array: ValueId,
        want: HirType,
        lent: &mut Vec<Lent>,
    ) -> Result<ValueId, Diagnostic> {
        use super::native::{Pointee, Role};
        let origin = self.origin(id);
        // **Only a `string[]` has strings to convert.** The call is checked
        // against the declaration the program wrote, and a lib.dom member a
        // binding implements is checked against lib.dom's: so `new
        // Blob([blob, blob])` gave a `Blob[]` where nts:dom lends a
        // `string[]`, and `nts_strings_to_cstrings` read each handle as a
        // string (the Chromium lane's
        // lib-dom-a-cstrings-argument-whose-elements-are-not-strings). Refused
        // by name, as `lend_handles` refuses an array of non-handles.
        if matches!(role, Role::Strings | Role::HStrings)
            && !matches!(
                &self.values[array.0 as usize].ty,
                HirType::Managed(ManagedType::Array(element))
                    if **element == HirType::Managed(ManagedType::String)
            )
        {
            return Err(
                self.unsupported(id, "a `CStrings` argument whose elements are not strings")
            );
        }
        Ok(match role {
            Role::Strings => self.lend_strings(array, want, lent, &origin),
            Role::HStrings => self.lend_hstrings(array, want, lent, &origin),
            Role::Records(record) => self.records_argument(id, array, record, &want, lent)?,
            Role::FilledHandles => self.filled_handles(id, array, want, lent)?,
            Role::Booleans => self.lend_booleans(id, array, want, lent),
            Role::FilledStrings => self.filled_block(
                id,
                array,
                Pointee::Pointer(Box::new(Pointee::Void)),
                want,
                lent,
            ),
            Role::FilledRecords(record) => {
                self.filled_block(id, array, Pointee::Record(record.clone()), want, lent)
            }
            _ => return Err(self.unsupported(id, "an array crossing as something no array is")),
        })
    }

    /// A `string[]` as C's NULL-terminated `char **`, converted for the call
    /// and freed after it (`Lent::Strings`).
    fn lend_strings(
        &mut self,
        array: ValueId,
        want: HirType,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> ValueId {
        let pointer =
            self.runtime_call("nts_strings_to_cstrings", vec![array], want, origin.clone());
        lent.push(Lent::Strings { pointer });
        pointer
    }

    /// An array of handles' element block, C's array of pointers to them,
    /// or NULL for a `null` array; the array given back after the call
    /// (`Lent::Array`). Only an array whose elements are native pointers has
    /// such a block, so any other is refused, whatever its type said: C would
    /// read its elements as objects.
    fn lend_handles(
        &mut self,
        id: NodeId,
        array: ValueId,
        want: HirType,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> Result<ValueId, Diagnostic> {
        let HirType::Managed(ManagedType::Array(element)) = &self.values[array.0 as usize].ty
        else {
            return Err(self.unsupported(id, "a `CHandles` argument that is not an array"));
        };
        let HirType::NativePointer(super::native::Pointee::Opaque(held)) = &**element else {
            return Err(
                self.unsupported(id, "a `CHandles` argument whose elements are not handles")
            );
        };
        // A COM object's interfaces are different pointers, so an array of
        // one interface's is not an array of another's: each element is asked
        // for the one C takes, into a block of the call's. Every interface
        // is an `IInspectable` as it is, as a single argument's is.
        if let HirType::NativePointer(super::native::Pointee::Pointer(wanted)) = &want
            && let super::native::Pointee::Opaque(wanted) = &**wanted
            && wanted.family == super::native::Family::Com
            && held.tag != wanted.tag
            && wanted.tag != "IInspectable"
        {
            let Some(iid) = self.hierarchy.com_iids.get(&wanted.tag).cloned() else {
                return Err(self.unsupported(
                    id,
                    &format!(
                        "an array of objects as `{}`, an interface no binding asks for by IID",
                        wanted.tag
                    ),
                ));
            };
            let [low, high] = self.iid_arguments(&iid, origin);
            let absent = self.push(OpKind::ConstNull, want.clone(), origin.clone());
            let block = self.unless_null(array, absent, origin, |this| {
                this.runtime_call(
                    "nts_com_query_array",
                    vec![array, low, high],
                    want,
                    origin.clone(),
                )
            });
            lent.push(Lent::Queried { array, block });
            return Ok(block);
        }
        let absent = self.push(OpKind::ConstNull, want.clone(), origin.clone());
        let block = self.unless_null(array, absent, origin, |this| {
            this.runtime_call("nts_array_handles", vec![array], want, origin.clone())
        });
        lent.push(Lent::Array { array });
        Ok(block)
    }

    /// The element count of each array a call passes beside a count, by the
    /// count's slot, read before anything is lent for the call. One C takes
    /// narrower than an array can be long -- a `uint32_t`, as the Windows
    /// Runtime takes every one -- is bounded there too: an array too long for
    /// it throws a `RangeError`. The binding declared the array crosses with
    /// that count, so the check is one it wrote (`docs/records/notebooks/scalar-numbers.md`,
    /// Q4), and the count is then proven to fit.
    fn bounded_counts(
        &mut self,
        id: NodeId,
        target: &super::native::Function,
        args: &[ValueId],
    ) -> Result<rustc_hash::FxHashMap<usize, ValueId>, Diagnostic> {
        let mut counts = rustc_hash::FxHashMap::default();
        for (at, role, _) in target.slots() {
            let super::native::Role::Length { array, nullable } = role else {
                continue;
            };
            let fed = target
                .slots()
                .find(|(slot, _, _)| *slot == array)
                .and_then(|(_, _, fed)| fed);
            let Some(array) = fed.and_then(|ts| args.get(ts).copied()) else {
                continue;
            };
            let origin = self.origin(id);
            let count = self.array_count(array, nullable, &origin);
            counts.insert(at, count);
            // Nothing holds 2^53 elements, so a count that wide takes any.
            let narrower = match &target.parameters[at] {
                super::native::Type::Scalar(kind) => kind
                    .integer_range()
                    .filter(|(_, greatest)| *greatest < 1 << 53)
                    .map(|(_, greatest)| (*kind, greatest)),
                _ => None,
            };
            let Some((kind, greatest)) = narrower else {
                continue;
            };
            #[allow(clippy::cast_precision_loss)]
            let most = self.push(
                OpKind::ConstFloat(greatest as f64),
                HirType::NUMBER,
                origin.clone(),
            );
            let fits = self.push(
                OpKind::Binary {
                    op: BinOp::Le,
                    lhs: count,
                    rhs: most,
                },
                HirType::Bool,
                origin.clone(),
            );
            let (throws, carries_on) = (self.new_block(), self.new_block());
            self.terminate(Terminator::Branch {
                cond: fits,
                then_target: carries_on,
                then_args: Vec::new(),
                else_target: throws,
                else_args: Vec::new(),
            });
            self.switch_to(throws);
            let message = format!(
                "an array too long for the `{}` count `{}` takes",
                super::native::Type::Scalar(kind).c_type(),
                target.name
            );
            self.throw_provided_error(id, "RangeError", &message)?;
            if !self.is_terminated() {
                self.terminate(Terminator::Unreachable);
            }
            self.switch_to(carries_on);
        }
        Ok(counts)
    }

    /// What C means by a length beside an array: its elements -- a
    /// `string[]`'s, a view's -- and 0 for a `null` one.
    ///
    /// **Elements, not bytes.** A `Uint8Array`'s two are one number, which is
    /// how this read the byte length for as long as a byte array was the only
    /// view C took. An `Int32Array` of three is twelve bytes, and a count of
    /// twelve beside it is a callee reading nine elements past the end.
    fn array_count(&mut self, array: ValueId, nullable: bool, origin: &Origin) -> ValueId {
        let view = matches!(
            self.values[array.0 as usize].ty,
            HirType::Managed(ManagedType::View(_))
        );
        let length = |this: &mut Self| {
            if view {
                this.runtime_call(
                    "nts_view_length",
                    vec![array],
                    HirType::NUMBER,
                    origin.clone(),
                )
            } else {
                this.push(OpKind::Length(array), HirType::NUMBER, origin.clone())
            }
        };
        if nullable {
            let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
            self.unless_null(array, zero, origin, length)
        } else {
            length(self)
        }
    }

    /// `value === null ? absent : present(value)`, for what C takes beside
    /// or in place of a managed argument that may be `null` -- a count of 0,
    /// a NULL pointer -- where reading the absent value would fault.
    /// `absent` is built by the caller, before the branch.
    fn unless_null(
        &mut self,
        value: ValueId,
        absent: ValueId,
        origin: &Origin,
        present: impl FnOnce(&mut Self) -> ValueId,
    ) -> ValueId {
        let ty = self.values[value.0 as usize].ty.clone();
        let out = self.values[absent.0 as usize].ty.clone();
        let null = self.push(OpKind::ConstNull, ty, origin.clone());
        let missing = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: value,
                rhs: null,
            },
            HirType::Bool,
            origin.clone(),
        );
        let taken = self.new_block();
        let merge = self.new_block();
        self.terminate(Terminator::Branch {
            cond: missing,
            then_target: merge,
            then_args: vec![absent],
            else_target: taken,
            else_args: Vec::new(),
        });
        let answer = self.push_block_param(merge, out, origin.clone());
        self.switch_to(taken);
        let there = present(self);
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![there],
        });
        self.switch_to(merge);
        answer
    }

    /// A call's arguments, lowered the way its callee wants them, and what was
    /// lent for the call, which the caller gives back once it returns.
    ///
    /// Four things separate a native callee from every other. Its variadic
    /// tail is arguments rather than a gathered rest array; a function-typed
    /// argument becomes a bridge rather than a closure address; a `string`
    /// parameter receives a C string converted for the call; and a closure
    /// parameter becomes *three* C arguments -- the bridge, the closure's
    /// context, and for a retained one the function that releases it -- of
    /// which the program wrote one.
    /// The arguments the program wrote, and in the places it left one out,
    /// what goes there -- for a foreign function, its `@ntsDefault`, which
    /// `absent_argument` reads from `omitting_for` while these are lowered.
    fn lower_written_arguments(
        &mut self,
        id: NodeId,
        callee: &Callee,
        arguments: &[NodeId],
        method: bool,
        tail: Option<&HirType>,
    ) -> Result<Vec<ValueId>, Diagnostic> {
        let outer = match callee {
            Callee::Native(target) => {
                self.omitting_for
                    .replace((target.clone(), usize::from(method), id))
            }
            _ => self.omitting_for.take(),
        };
        let args = match tail {
            Some(element) => self.lower_native_arguments(id, arguments, element),
            None => self.lower_arguments(id, arguments),
        };
        self.omitting_for = outer;
        args
    }

    fn lower_call_arguments(
        &mut self,
        id: NodeId,
        callee: &Callee,
        arguments: &[NodeId],
        receiver: Option<ValueId>,
    ) -> Result<(Vec<ValueId>, Vec<Lent>), Diagnostic> {
        if let (Some((call, literal, slots)), Callee::Native(target)) =
            (self.dictionary_slots.clone(), callee)
            && call == id
        {
            return self.lower_dictionary_slots(id, target, (literal, &slots), receiver);
        }
        let tail = match callee {
            Callee::Native(target) => target
                .variadic
                .as_ref()
                .map(super::native::Type::representation),
            _ => None,
        };
        // Whether the receiver is an argument the declaration spells (`this`),
        // which moves every written argument up one, or a `Role::Receiver`
        // slot fed directly, which moves nothing.
        let spelled = receiver.is_some()
            && !matches!(callee, Callee::Native(target) if target.roles.first() == Some(&super::native::Role::Receiver));
        if let Callee::Native(target) = callee {
            self.mark_literals(target, arguments, spelled);
        }
        let args = self.lower_written_arguments(id, callee, arguments, spelled, tail.as_ref())?;
        let Callee::Native(target) = callee else {
            return Ok((args, Vec::new()));
        };
        self.native_arguments(id, &target.clone(), args, arguments.len(), receiver)
    }

    /// [`Self::lower_call_arguments`] for a call whose dictionary the binding
    /// takes as its members ([`Self::dictionary_spread`]): each member where
    /// its parameter is, and the parameter's `@ntsDefault` where the literal
    /// leaves it out.
    fn lower_dictionary_slots(
        &mut self,
        id: NodeId,
        target: &std::sync::Arc<super::native::Function>,
        (literal, slots): (NodeId, &[Option<NodeId>]),
        receiver: Option<ValueId>,
    ) -> Result<(Vec<ValueId>, Vec<Lent>), Diagnostic> {
        let spelled =
            receiver.is_some() && target.roles.first() != Some(&super::native::Role::Receiver);
        let positional: Vec<NodeId> = slots.iter().map(|slot| slot.unwrap_or(literal)).collect();
        self.mark_literals(target, &positional, spelled);
        let outer = self
            .omitting_for
            .replace((target.clone(), usize::from(spelled), id));
        let mut arguments = Vec::with_capacity(slots.len());
        for (at, slot) in slots.iter().enumerate() {
            arguments.push(match slot {
                Some(node) => Argument::expression(*node),
                None => match self.absent_argument(id, at) {
                    Ok(value) => Argument {
                        node: literal,
                        value: Some(value),
                    },
                    Err(why) => {
                        self.omitting_for = outer;
                        return Err(why);
                    }
                },
            });
        }
        let args = self.lower_argument_values(id, &arguments, None, None);
        self.omitting_for = outer;
        self.native_arguments(id, &target.clone(), args?, arguments.len(), receiver)
    }

    /// Mark each object literal a native call passes that is never built:
    /// labels -- the call's own spelling of them, as Swift's are -- whose
    /// properties are passed as they are, and a `Copied<T>`'s fields, written
    /// straight into the struct. Either passed any other way is an object
    /// like any other, and each field is read from it.
    fn mark_literals(
        &mut self,
        target: &super::native::Function,
        arguments: &[NodeId],
        method: bool,
    ) {
        for (at, role, fed) in target.slots() {
            let Some(&argument) = fed
                .and_then(|ts| ts.checked_sub(usize::from(method)))
                .and_then(|ts| arguments.get(ts))
            else {
                continue;
            };
            if self.kind_of(argument) != Some(syntax::OBJECT_LITERAL_EXPRESSION) {
                continue;
            }
            match role {
                super::native::Role::Label { last: true, .. } => {
                    self.labels_pending.insert(argument);
                }
                super::native::Role::Copied => {
                    self.copied_pending
                        .insert(argument, target.parameters[at].representation());
                }
                _ => {}
            }
        }
    }

    /// A labels literal, a property at a time in the order it is written --
    /// which is when JavaScript evaluates them -- and never an object. What it
    /// answers is a placeholder at the literal's type, which nothing reads:
    /// `native_arguments` passes each property's value in the slot its key
    /// names, and the placeholder is dead.
    fn lower_labels(&mut self, id: NodeId) -> Result<ValueId, Diagnostic> {
        let mut values = Vec::new();
        for property in self.syntax_children_of(id) {
            let (key, value) = match self.kind_of(property) {
                Some(syntax::PROPERTY_ASSIGNMENT) => {
                    let parts = self.syntax_children_of(property);
                    let [name, initializer] = parts[..] else {
                        return Err(
                            self.unsupported(property, "a label that is not a name and a value")
                        );
                    };
                    let key = self
                        .node(name)
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                        .map(str::to_owned)
                        .ok_or_else(|| self.unsupported(name, "a label whose name is computed"))?;
                    (key, self.lower_expression(initializer)?)
                }
                // `{ data }`: the value the name holds, found as an object
                // literal's shorthand finds it -- the name's own symbol is the
                // *property*'s, not the value's.
                Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT) => {
                    let parts = self.syntax_children_of(property);
                    let [name] = parts[..] else {
                        return Err(
                            self.unsupported(property, "a shorthand label of unexpected shape")
                        );
                    };
                    let key = self
                        .node(name)
                        .text
                        .as_ref()
                        .and_then(|text| text.as_utf8())
                        .map(str::to_owned)
                        .ok_or_else(|| self.unsupported(name, "a label whose name is computed"))?;
                    let symbol = self.shorthand_value_symbol(name, &key)?;
                    (key, self.lower_named_value(name, symbol)?)
                }
                _ => {
                    return Err(self
                        .unsupported(property, "a spread, a method or an accessor among labels"));
                }
            };
            values.push((key, value));
        }
        // At the parameter's type rather than the literal's own: `{ at: 0 }`
        // is `{ at: number }`, the parameter `{ at: UInt }`, and the argument
        // is converted to the parameter's type before any role sees it.
        let ty = self
            .contextual_type(id, 0)
            .or_else(|| self.type_of(id))
            .ok_or_else(|| self.unrepresentable(id, "labels"))?;
        let origin = self.origin(id);
        let placeholder = self.push(OpKind::ConstNull, ty, origin);
        self.labels_lowered.insert(placeholder, values);
        Ok(placeholder)
    }

    /// A node's children, seeing through the list nodes between them.
    fn syntax_children_of(&self, id: NodeId) -> Vec<NodeId> {
        let mut out = Vec::new();
        for child in self.children(id) {
            if self.kind_of(child).is_some() {
                out.push(child);
            } else {
                out.extend(self.syntax_children_of(child));
            }
        }
        out
    }

    /// A foreign call's C arguments from the TypeScript ones already lowered:
    /// the receiver first for a method, then each slot as its role says --
    /// strings and arrays lent, closures bridged, lengths filled in, the error
    /// slot supplied where the program wrote `written` arguments and left it
    /// out. Separate from lowering them so an argument that is a value rather
    /// than a node -- a property's assigned value -- goes through the same
    /// roles.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn native_arguments(
        &mut self,
        id: NodeId,
        target: &std::sync::Arc<super::native::Function>,
        mut args: Vec<ValueId>,
        written: usize,
        receiver: Option<ValueId>,
    ) -> Result<(Vec<ValueId>, Vec<Lent>), Diagnostic> {
        let target = target.clone();
        let origin = self.origin(id);
        let fed_receiver = target.roles.first() == Some(&super::native::Role::Receiver);
        let receiver_value = self.place_receiver(id, &target, &mut args, receiver)?;
        let counts = self.bounded_counts(id, &target, &args)?;
        let mut lent = Vec::new();
        let mut c_args = Vec::with_capacity(target.parameters.len());
        // The closure the context slots that follow a closure slot belong to.
        let mut lending: Option<(ValueId, super::native::Lifetime)> = None;
        for (at, role, fed) in target.slots() {
            use super::native::Role;
            let argument = fed.and_then(|ts| args.get(ts).copied());
            match role {
                Role::Plain => {
                    let Some(value) = argument else { continue };
                    // A record literal's lent strings, for the call it is passed to.
                    lent.extend(self.copied_lent.remove(&value).unwrap_or_default());
                    c_args.push(self.unboxed_argument(value, &target.parameters[at], &origin));
                }
                Role::Receiver => c_args.extend(receiver_value),
                // An object as itself; a string, number or boolean boxed by
                // the runtime (`nts_winrt_box`, from the value erased) into
                // an `IPropertyValue` the call is lent and gives back.
                Role::Box => {
                    let Some(value) = argument else { continue };
                    let want = target.parameters[at].representation();
                    c_args.push(self.box_argument(id, value, want, &mut lent, &origin)?);
                }
                // A label crosses as its own role says, with the value the
                // literal gave that property.
                Role::Label { key, inner, .. } => {
                    let value = self.label_value(id, argument, &key)?;
                    c_args.push(self.label_argument(
                        id,
                        value,
                        &inner,
                        &target.parameters[at],
                        &mut lent,
                    )?);
                }
                // A slot the caller passed is theirs to read; one they left out
                // is a zeroed local of ours, checked after the call.
                Role::ErrorSlot { converter } => {
                    // `fed` counts a method's receiver, which `written` --
                    // the arguments the program wrote after the dot -- does not.
                    let written = fed.is_some_and(|ts| {
                        ts < written + usize::from(receiver.is_some() && !fed_receiver)
                    });
                    let ty = target.parameters[at].representation();
                    c_args.push(self.error_slot(
                        argument.filter(|_| written),
                        ty,
                        converter,
                        &mut lent,
                        &origin,
                    ));
                }
                // A value or `null`, as an `IReference<T>` made for the call.
                Role::Reference {
                    iid,
                    value,
                    property_type,
                } => {
                    let want = target.parameters[at].representation();
                    c_args.extend(
                        argument
                            .map(|given| {
                                self.reference_argument(
                                    id,
                                    given,
                                    (&iid, value, property_type),
                                    want,
                                    &mut lent,
                                )
                            })
                            .transpose()?,
                    );
                }
                Role::Strings
                | Role::HStrings
                | Role::Records(_)
                | Role::Booleans
                | Role::FilledHandles
                | Role::FilledStrings
                | Role::FilledRecords(_) => c_args.extend(
                    argument
                        .map(|array| {
                            self.lend_array(
                                id,
                                &role,
                                array,
                                target.parameters[at].representation(),
                                &mut lent,
                            )
                        })
                        .transpose()?,
                ),
                // A `Uint8Array` in place: its bytes, for the call, and the
                // view given back after it. The give-back does nothing at run
                // time; it is the view's last use, without which reference
                // counting released a temporary view -- and with it the only
                // reference to the buffer -- before C read the bytes.
                Role::Bytes(element) => c_args.extend(
                    argument
                        .map(|view| {
                            self.lend_bytes(
                                id,
                                view,
                                &element,
                                target.parameters[at].representation(),
                                &mut lent,
                            )
                        })
                        .transpose()?,
                ),
                // An array of handles in place: its element block, for the
                // call, and the array given back after it.
                Role::Handles => c_args.extend(
                    argument
                        .map(|array| {
                            self.lend_handles(
                                id,
                                array,
                                target.parameters[at].representation(),
                                &mut lent,
                                &origin,
                            )
                        })
                        .transpose()?,
                ),
                // The array's element count, into the slot C reads it from --
                // before the array's own slot as often as after, so it is read
                // from the arguments rather than from what was pushed.
                Role::Length { .. } => {
                    let Some(&count) = counts.get(&at) else {
                        continue;
                    };
                    c_args.push(self.coerce(count, &target.parameters[at].representation(), id)?);
                }
                Role::NSString => {
                    c_args.extend(argument.map(|string| self.ns_string_of(string, &origin)));
                }
                Role::NSArray(_) | Role::NSDictionary(_) | Role::NSSet(_) => {
                    let Some(collection) = argument else { continue };
                    c_args.push(self.foundation_collection(id, collection, &role, &origin)?);
                }
                Role::Result { .. } | Role::ReceivedCount | Role::Outer | Role::Inner => {
                    c_args.push(self.hresult_slot(
                        &role,
                        target.parameters[at].representation(),
                        &mut lent,
                        &origin,
                    ));
                }
                // The struct, copied into the frame, its strings lent.
                Role::Copied => c_args.extend(
                    argument
                        .map(|value| {
                            self.copied_argument(
                                id,
                                value,
                                target.parameters[at].representation(),
                                &mut lent,
                            )
                        })
                        .transpose()?,
                ),
                Role::String(encoding) => {
                    let Some(string) = argument else { continue };
                    let want = target.parameters[at].representation();
                    c_args.push(self.lend_string_argument(
                        id,
                        string,
                        encoding,
                        want,
                        &mut lent,
                        origin.clone(),
                    )?);
                }
                Role::Closure {
                    lifetime,
                    bridge,
                    bridging,
                } => {
                    let Some(closure) = argument else { continue };
                    let want = target.parameters[at].representation();
                    let once = lifetime == super::native::Lifetime::Once;
                    c_args.push(self.bridge_closure(
                        id,
                        closure,
                        (&bridge, bridging),
                        once,
                        want,
                        &origin,
                    )?);
                    lending = Some((closure, lifetime));
                }
                Role::Block { bridge, signature } => c_args.extend(self.lend_block(
                    id,
                    argument,
                    (bridge, signature),
                    target.parameters[at].representation(),
                    &mut lent,
                    &origin,
                )?),
                Role::Delegate {
                    bridge,
                    signature,
                    iid,
                } => c_args.extend(
                    argument
                        .map(|closure| {
                            self.delegate(
                                id,
                                closure,
                                (bridge, signature, &iid),
                                target.parameters[at].representation(),
                                &mut lent,
                                &origin,
                            )
                        })
                        .transpose()?,
                ),
                Role::ClosureData => {
                    let Some((closure, lifetime)) = lending else {
                        continue;
                    };
                    let want = target.parameters[at].representation();
                    c_args.push(self.lend_context(closure, lifetime, want, &mut lent, &origin));
                }
                Role::ClosureNotify => {
                    let want = target.parameters[at].representation();
                    c_args.push(self.closure_notify(want, &origin));
                }
            }
        }
        // The variadic tail, past every declared parameter.
        let declared = target.slots().filter(|(_, _, fed)| fed.is_some()).count();
        c_args.extend(args.iter().skip(declared).copied());
        c_args.extend(self.record_destination(&target, &origin));
        self.bridge_callback_arguments(id, &target, &mut c_args)?;
        lent.extend(
            c_args
                .iter()
                .filter_map(|arg| self.unboxed.get(arg))
                .map(|&boxed| Lent::Boxed { boxed }),
        );
        Ok((c_args, lent))
    }

    /// The context C hands back to a closure's bridge: the closure, lent for
    /// as long as `lifetime` says. Once: counted as a callback C still owes
    /// until the bridge gives it back, which keeps a `GLib` loop turning.
    fn lend_context(
        &mut self,
        closure: ValueId,
        lifetime: super::native::Lifetime,
        want: HirType,
        lent: &mut Vec<Lent>,
        origin: &Origin,
    ) -> ValueId {
        let helper = if lifetime == super::native::Lifetime::Once {
            "nts_closure_lend_once"
        } else {
            "nts_closure_lend"
        };
        let context = self.runtime_call(helper, vec![closure], want, origin.clone());
        if lifetime == super::native::Lifetime::Call {
            lent.push(Lent::Closure { context });
        }
        context
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

    fn native_callee(
        &self,
        call: NodeId,
        declaration: Option<NodeId>,
        name: String,
        signature: &nts_semantic_schema::SignatureRecord,
    ) -> Result<Callee, Diagnostic> {
        self.native_callee_with(call, declaration, name, signature, None, None)
    }

    /// The message one accessor of an Objective-C property sends: the
    /// property's declaration, with the getter's or the setter's selector
    /// rather than any the declaration tags.
    fn native_callee_sending(
        &self,
        call: NodeId,
        declaration: NodeId,
        selector: &str,
        signature: &nts_semantic_schema::SignatureRecord,
    ) -> Result<Callee, Diagnostic> {
        self.native_callee_with(
            call,
            Some(declaration),
            selector.to_owned(),
            signature,
            Some(selector.to_owned()),
            None,
        )
    }

    /// [`Self::native_callee`], with the selector given when `selector` is,
    /// and otherwise the one the declaration's `@ntsSelector` names; and sent
    /// to the class `class_send` names when it names one, rather than to the
    /// receiver the declaration's kind implies.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn native_callee_with(
        &self,
        call: NodeId,
        declaration: Option<NodeId>,
        name: String,
        signature: &nts_semantic_schema::SignatureRecord,
        selector: Option<String>,
        class_send: Option<String>,
    ) -> Result<Callee, Diagnostic> {
        // `@ntsSymbol`: the C function a declaration binds, when its own name
        // is another -- one typed view per GObject signal of the one
        // `g_signal_connect_data`.
        let symbol = declaration
            .and_then(|decl| self.node(decl).native.as_ref())
            .and_then(|n| n.symbol.clone());
        if let Some(symbol) = &symbol
            && !super::native::is_c_identifier(symbol)
        {
            return Err(self.unsupported(
                call,
                "@ntsSymbol names one C function, as in `@ntsSymbol g_signal_connect_data`",
            ));
        }
        let name = symbol
            .or_else(|| declaration.and_then(|decl| self.declared_name(decl)))
            .unwrap_or(name);
        let abi = declaration.and_then(|decl| {
            self.snapshot.nodes[decl.0 as usize]
                .native
                .as_ref()
                .and_then(|n| n.abi.as_deref())
        });
        // An explicit request for a backend-owned intrinsic. Backends resolve
        // these against their closed tables and refuse unavailable names;
        // this does not authorize inventing an external C prototype.
        if abi == Some("intrinsic") {
            return Ok(Callee::External(name));
        }
        let ParameterTags { throws, defaults } = self.parameter_tags(call, declaration)?;
        let declared = declaration.and_then(|decl| {
            self.node(decl)
                .native
                .as_ref()
                .and_then(|n| n.selector.clone())
        });
        // A declaration's `@ntsThrows` is its own selector's: the `+alloc` a
        // throwing constructor sends first takes no error slot.
        let throws = throws.filter(|_| {
            selector.as_deref().is_none_or(|sent| {
                declared
                    .as_deref()
                    .is_none_or(|own| own.trim_start_matches('+') == sent)
            })
        });
        let selector = selector.or(declared);
        let (throws, hidden) = split_hidden_throws(throws, selector.is_some(), signature);
        let hresult = self.hresult_shape(call, declaration)?;
        let references = self.reference_tags(call, declaration)?;
        let mut native = super::native::Function::from_signature(
            self.snapshot,
            name,
            signature,
            abi,
            throws
                .as_ref()
                .map(|(slot, converter)| (slot.as_str(), converter.as_str())),
            &defaults,
            (hresult, &references),
        )
        .map_err(|why| self.unsupported(call, &why))?;
        if let Some(converter) = hidden {
            append_error_slot(&mut native, converter);
        }
        // The module whose `@ntsHeader` covers this declaration, recorded where
        // the declaration node is still in hand. `collect_native_headers` reads
        // it, so a program carries the headers it reaches rather than every one
        // in the snapshot.
        native.declared_at = declaration.and_then(|decl| self.declaring_module(decl));
        // Only an explicit semantic operation can request a generated thunk.
        // A header function with the same spelling retains its declaration.
        native.thunk = declaration
            .and_then(|decl| self.node(decl).native.as_ref())
            .and_then(|metadata| metadata.intrinsic.as_deref())
            .map(super::native::GObjectThunk::from_intrinsic)
            .transpose()
            .map_err(|why| self.unsupported(call, &why))?
            .flatten();
        if let Some(thunk) = &native.thunk {
            native.name = thunk.symbol();
            native.declared_at = None;
            if let Some(object) = native.parameters.first_mut() {
                *object = super::native::Type::Pointer(super::native::Pointee::Void);
            }
        }
        // A virtual function is a class struct's slot, overridden by a
        // subclass and reached through the class; it has no symbol, so a
        // direct call would link one that does not exist.
        if self.chaining_up.is_none()
            && let Some(slot) = declaration
                .and_then(|decl| self.node(decl).native.as_ref())
                .and_then(|n| n.vfunc.as_deref())
        {
            return Err(self.unsupported(
                call,
                &format!("a direct call of a GObject virtual function (`{slot}`), which a subclass overrides and nothing calls by name"),
            ));
        }
        if let Some(decl) = declaration {
            native.frameworks = self.declared_names(call, decl, LinkTag::FRAMEWORK)?;
            native.libraries = self.declared_names(call, decl, LinkTag::LIBRARY)?;
            native.vtable = self.slot_of(
                call,
                decl,
                signature,
                selector.is_some() || symbol_tagged(self, decl),
                &mut native,
            )?;
        }
        self.make_call(
            call,
            declaration,
            &mut native,
            signature,
            (selector, class_send),
        )?;
        self.refuse_unbridged(call, &native)?;
        if let Some(free) = declaration
            .and_then(|decl| self.node(decl).native.as_ref())
            .and_then(|n| n.free.as_deref())
        {
            let Some(string) = native.returns_string.as_mut() else {
                return Err(self.unsupported(call, "@ntsFree names what releases a returned string, and this function does not return one"));
            };
            if !super::native::is_c_identifier(free) {
                return Err(self.unsupported(
                    call,
                    "@ntsFree names one C function, as in `@ntsFree g_free`",
                ));
            }
            string.free = Some(free.to_owned());
            // A string the caller frees is `char *` in C, and a borrowed one
            // `const char *`: that is how C libraries spell whose it is, GLib's
            // `gchar *` for transfer-full among them. The witness compares.
            // And an owned array is `char **` for the same reason, GLib's
            // `gchar **`, which the free function is declared taking.
            native.result = if string.array {
                let char = super::native::Pointee::Scalar(super::native::Scalar::Char);
                super::native::Type::Pointer(super::native::Pointee::Pointer(Box::new(char)))
            } else {
                super::native::Type::Pointer(super::native::Pointee::Scalar(
                    super::native::Scalar::Char,
                ))
            };
        }
        if let Some(names) = declaration
            .and_then(|decl| self.node(decl).native.as_ref())
            .and_then(|n| n.no_escape.as_ref())
        {
            if names.is_empty() {
                return Err(self.unsupported(
                    call,
                    "@ntsNoEscape needs at least one native-pointer parameter",
                ));
            }
            for name in names {
                let slot = signature
                    .parameters
                    .iter()
                    .position(|p| p.name == *name)
                    .and_then(|ts| native.c_index(ts))
                    .ok_or_else(|| {
                        self.unsupported(call, &format!("@ntsNoEscape names no parameter `{name}`"))
                    })?;
                // A *callback* takes the same contract, and means the same
                // thing by it: nothing of this argument outlives the call. For
                // a pointer that is "no address into it is kept, freed or
                // invalidated"; for a function pointer it is "not called after
                // this returns". Both are what lets the caller pass storage,
                // or a bridge, that it owns for the duration and no longer.
                if !matches!(
                    native.parameters[slot],
                    super::native::Type::Pointer(_) | super::native::Type::FnPointer(_)
                ) || native.retention[slot] == super::native::Retention::NotRetained
                {
                    return Err(self.unsupported(
                        call,
                        "@ntsNoEscape needs distinct native-pointer or callback parameters",
                    ));
                }
                native.retention[slot] = super::native::Retention::NotRetained;
            }
        }
        // A `CStrings` array is lent for the call and freed after it, so a
        // callee that kept it would read freed memory -- which no test in
        // either profile reaches. The binding says it does not, or the call
        // is refused: that is the direction this check fails safe in.
        if native.slots().any(|(slot, role, _)| {
            matches!(
                role,
                super::native::Role::Strings
                    | super::native::Role::HStrings
                    | super::native::Role::Bytes(_)
                    | super::native::Role::Handles
            ) && native.retention[slot] != super::native::Retention::NotRetained
        }) {
            return Err(self.unsupported(call, "a `CStrings`, `CBytes` or `CHandles` parameter without `@ntsNoEscape`, which is what says C does not keep the array it is lent"));
        }
        Ok(Callee::Native(std::sync::Arc::new(native)))
    }

    /// What `@ntsVtable` and `@ntsFactory` say of a declaration: the slot of
    /// the receiver's table the call goes through, the method the binding says
    /// that slot is, and for a static the runtime class whose factory receives
    /// it -- which then becomes the call's first parameter, as a method's
    /// instance is.
    ///
    /// **The method name is checked against the declaration's**, so that a
    /// slot and a method cannot be edited apart: `@ntsVtable 7 Parse` on
    /// `Parse` is refused rather than a quiet call to `TryParse`. What the
    /// slot *is* is the metadata's, and `bind-winmd` writes both from it.
    /// The slot a call goes through: the one the lowering forces -- a
    /// property's getter or setter, `super.m()` in an override -- or the one
    /// the declaration's `@ntsVtable` names. A forced slot of a static
    /// property is its class's factory's, whose receiver the call supplies,
    /// as a static method's is.
    fn slot_of(
        &self,
        call: NodeId,
        decl: NodeId,
        signature: &nts_semantic_schema::SignatureRecord,
        otherwise_bound: bool,
        native: &mut super::native::Function,
    ) -> Result<Option<super::native::Vtable>, Diagnostic> {
        let Some((slot, method)) = &self.forced_slot else {
            return self.vtable_of(call, decl, signature, otherwise_bound, native);
        };
        let factory = self.factory_of(call, decl)?;
        if factory.is_some() {
            native.prepend_receiver(super::native::Type::Pointer(super::native::Pointee::Void));
        }
        Ok(Some(super::native::Vtable {
            slot: *slot,
            method: method.clone(),
            factory,
        }))
    }

    fn vtable_of(
        &self,
        call: NodeId,
        decl: NodeId,
        signature: &nts_semantic_schema::SignatureRecord,
        otherwise_bound: bool,
        native: &mut super::native::Function,
    ) -> Result<Option<super::native::Vtable>, Diagnostic> {
        let tags = self.node(decl).native.as_deref();
        let Some(text) = tags.and_then(|n| n.vtable.as_deref()) else {
            if tags.is_some_and(|n| n.factory.is_some()) {
                return Err(self.unsupported(
                    call,
                    "`@ntsFactory` without the `@ntsVtable` slot it calls through the factory",
                ));
            }
            return Ok(None);
        };
        let words: Vec<&str> = text.split_whitespace().collect();
        let [slot, method] = words.as_slice() else {
            return Err(self.unsupported(call, "@ntsVtable names the slot and the method the metadata gives it, as in `@ntsVtable 6 Parse`"));
        };
        let slot: u32 = slot
            .parse()
            .map_err(|_| self.unsupported(call, "@ntsVtable naming a slot that is not a number"))?;
        if slot < 3 {
            return Err(self.unsupported(call, "@ntsVtable on slots 0 to 2, which are IUnknown's and called by the compiler itself"));
        }
        if otherwise_bound {
            return Err(self.unsupported(
                call,
                "@ntsVtable beside @ntsSymbol or @ntsSelector, which name another way to call it",
            ));
        }
        // The idiomatic surface names a slot's method in camelCase
        // (`getFolderFromPathAsync` for `GetFolderFromPathAsync`), by the one
        // rule `bind-winmd` writes it by; any other name is a disagreement.
        // A constructor has no name to disagree with: it is the class's
        // factory method, whichever the metadata calls it.
        let declared = self.declared_name(decl);
        if self.kind_of(decl) != Some(syntax::CONSTRUCTOR)
            && declared.as_deref() != Some(*method)
            && declared.as_deref() != Some(super::native::js_name(method).as_str())
        {
            return Err(self.unsupported(
                call,
                &format!("@ntsVtable {slot} {method} on a declaration of another name: the slot's method and the declaration disagree"),
            ));
        }
        if native.variadic.is_some() || native.convention != super::native::Convention::C {
            return Err(self.unsupported(call, "@ntsVtable on a variadic or non-C function"));
        }
        let factory = self.factory_of(call, decl)?;
        let method_of_instance = self.is_native_instance_method(decl, signature);
        match (&factory, method_of_instance) {
            (None, false) => {
                return Err(self.unsupported(call, "@ntsVtable on a function with neither an instance (`this`) nor an @ntsFactory to call it on"));
            }
            (Some(_), true) => {
                return Err(self.unsupported(
                    call,
                    "@ntsFactory on a method, whose instance is already its receiver",
                ));
            }
            // The factory is the receiver: a first parameter the call supplies.
            (Some(_), false) => {
                native.prepend_receiver(super::native::Type::Pointer(super::native::Pointee::Void));
            }
            (None, true) => {}
        }
        Ok(Some(super::native::Vtable {
            slot,
            method: (*method).to_owned(),
            factory,
        }))
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

    /// `native` as the message `selector` names, where it names one, and
    /// otherwise as the C function it is: a C function's `BridgedString`,
    /// Swift's `String` where the header says `NSString *`, still bridged.
    fn make_call(
        &self,
        call: NodeId,
        declaration: Option<NodeId>,
        native: &mut super::native::Function,
        signature: &nts_semantic_schema::SignatureRecord,
        (selector, class_send): (Option<String>, Option<String>),
    ) -> Result<(), Diagnostic> {
        if let (Some(decl), Some(selector)) = (declaration, selector) {
            return self.make_message(call, decl, native, signature, selector, class_send);
        }
        bridge_strings(native, signature, self.snapshot, StringsBridged::Branded);
        Ok(())
    }

    /// `native` as the Objective-C message `selector` names: its closures,
    /// strings and arrays bridged as Swift's are, and the ownership ARC's
    /// method families give its result and receiver.
    fn make_message(
        &self,
        call: NodeId,
        decl: NodeId,
        native: &mut super::native::Function,
        signature: &nts_semantic_schema::SignatureRecord,
        selector: String,
        class_send: Option<String>,
    ) -> Result<(), Diagnostic> {
        bridge_blocks(native, signature, self.snapshot);
        let send = self.objc_send(call, decl, native, selector, class_send)?;
        bridge_strings(native, signature, self.snapshot, StringsBridged::Plain);
        // A family is a claim about the returned *object*, so it applies
        // only where the result is a pointer, as in clang: a `newValue`
        // returning a number owns nothing.
        let pointer = match &native.result {
            super::native::Type::Pointer(pointee) => Some(pointee),
            _ => None,
        };
        native.returns_owned =
            pointer.is_some() && super::native::Send::returns_owned(&send.selector);
        // An object handed over (+1) that the program does not count is
        // an object nobody will release. The binding has to say what it
        // is, which is `ObjcClass`, not `Class`.
        if native.returns_owned && pointer.is_some_and(|pointee| pointee.counting().is_none()) {
            return Err(self.unsupported(
                call,
                &format!(
                    "`{}` hands back an object the caller owns, as a handle the program does not count; declare its class with `ObjcClass` from \"objc:types\", not `Class`",
                    send.selector
                ),
            ));
        }
        if send.class.is_none() && super::native::Send::consumes_receiver(&send.selector) {
            native.consumes = vec![0];
        }
        // A record's or a number's address -- Swift's
        // `UnsafeMutablePointer<NSRange>` or `<CGFloat>`, its `&range` -- is
        // the message's to read or write during the send and no longer, which
        // is what Swift's own conversion promises: a `local<NSRange>()` may be
        // passed.
        // Grown only: a record result's destination is one entry past the
        // parameters, and is not retained either.
        if native.retention.len() < native.parameters.len() {
            native
                .retention
                .resize(native.parameters.len(), super::native::Retention::Unknown);
        }
        for (at, ty) in native.parameters.iter().enumerate() {
            if matches!(
                ty,
                super::native::Type::Pointer(
                    super::native::Pointee::Record(_) | super::native::Pointee::Scalar(_)
                )
            ) {
                native.retention[at] = super::native::Retention::NotRetained;
            }
        }
        native.send = Some(send);
        Ok(())
    }

    /// An array a C function would take or return as Swift's `[T]`, which only
    /// a message can: the `NSArray` it crosses as is a Foundation object.
    fn refuse_unbridged(
        &self,
        call: NodeId,
        native: &super::native::Function,
    ) -> Result<(), Diagnostic> {
        let bridged = native.returns_array.is_some()
            || native.returns_dictionary.is_some()
            || native.returns_set.is_some()
            || native.roles.iter().any(|role| match role {
                super::native::Role::NSArray(_)
                | super::native::Role::NSDictionary(_)
                | super::native::Role::NSSet(_) => true,
                super::native::Role::Label { inner, .. } => matches!(
                    **inner,
                    super::native::Role::NSArray(_)
                        | super::native::Role::NSDictionary(_)
                        | super::native::Role::NSSet(_)
                ),
                _ => false,
            });
        if native.send.is_none() && bridged {
            return Err(self.unsupported(call, "an array of objects or strings, which crosses an Objective-C message as an `NSArray` and a C function as nothing"));
        }
        Ok(())
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

    /// The value of the extern variable `declaration` names (`@ntsSymbol`),
    /// at the declared type: a native with no parameters whose convention
    /// is [`super::native::Convention::Variable`], which each backend reads
    /// rather than calls. An `NSString *` crosses as a C function's does,
    /// as a `BridgedString` copied into the program's string.
    fn read_native_variable(
        &mut self,
        id: NodeId,
        declaration: NodeId,
        ty: TypeId,
    ) -> Result<ValueId, Diagnostic> {
        let signature = accessor_signature(None, None, ty);
        let Callee::Native(target) =
            self.native_callee(id, Some(declaration), String::new(), &signature)?
        else {
            return Err(self.unsupported(id, "a constant whose binding names no C variable"));
        };
        if !target.parameters.is_empty()
            || matches!(
                target.result,
                super::native::Type::Record(_) | super::native::Type::Void
            )
        {
            return Err(self.unsupported(id, "a constant that is not one value a C variable holds"));
        }
        let mut variable = (*target).clone();
        variable.convention = super::native::Convention::Variable;
        let callee = Callee::Native(std::sync::Arc::new(variable));
        self.finish_call_typed(id, callee, Vec::new(), Vec::new(), Some(declaration), None)
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

    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn lower_objc_new(&mut self, id: NodeId) -> Result<Option<ValueId>, Diagnostic> {
        let Some(HirType::NativePointer(super::native::Pointee::Opaque(handle))) = self.type_of(id)
        else {
            return Ok(None);
        };
        if handle.family != super::native::Family::Objc {
            return Ok(None);
        }
        let Some(target) = self.snapshot.call_targets.get(&id).copied() else {
            return Err(self.unsupported(
                id,
                "a `new` of an Objective-C class the checker resolved to no constructor",
            ));
        };
        // The program's own constructor: `{Class}#new`, which makes the
        // instance. Only its own class's -- one inherited from a program
        // class would make that class's instance.
        if let Some(constructor) = target.callee.filter(|c| {
            self.kind_of(*c) == Some(syntax::CONSTRUCTOR) && self.objc_class_member(*c).is_none()
        }) {
            let declaring = self.node(constructor).parent.and_then(|mut at| {
                while self.kind_of(at).is_none() {
                    at = self.node(at).parent?;
                }
                Some(at)
            });
            let own = declaring
                .and_then(|class| super::native::objc_name(self.snapshot, class))
                .is_some_and(|name| name == handle.tag);
            if !own {
                return Err(self.unsupported(id, "a `new` of a class that inherits a constructor from a program's Objective-C class"));
            }
            let arguments = self.arguments_of(id);
            let args = self.lower_arguments(id, &arguments)?;
            let ty = HirType::NativePointer(super::native::Pointee::Opaque(handle.clone()));
            let origin = self.origin(id);
            return Ok(Some(self.push(
                OpKind::Call {
                    callee: Callee::Direct(format!("{}#new", handle.tag)),
                    args,
                    frame: None,
                },
                ty,
                origin,
            )));
        }
        let Some(constructor) = target
            .callee
            .filter(|c| self.objc_class_member(*c).is_some())
        else {
            return Err(self.unsupported(
                id,
                "a `new` of an Objective-C class whose constructor the binding does not declare",
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
        let Some(instance) = self.snapshot.node_types.get(&id).copied() else {
            return Err(self.unrepresentable(id, "a `new`"));
        };
        let arguments = self.arguments_of(id);
        let signature = self.snapshot.signatures[target.signature.0 as usize].clone();
        if let Some(factory) = selector.strip_prefix('+') {
            let mut sent = signature;
            sent.is_construct = false;
            sent.return_type = instance;
            let callee = self.native_callee_with(
                id,
                Some(constructor),
                factory.to_owned(),
                &sent,
                Some(factory.to_owned()),
                Some(handle.tag.clone()),
            )?;
            let (args, lent) = self.lower_call_arguments(id, &callee, &arguments, None)?;
            return self
                .finish_call(id, callee, args, lent, Some(constructor))
                .map(Some);
        }
        let alloc = nts_semantic_schema::SignatureRecord {
            parameters: Vec::new(),
            return_type: instance,
            type_parameters: Vec::new(),
            is_construct: false,
            type_predicate: None,
            this_type: None,
        };
        let callee = self.native_callee_with(
            id,
            Some(constructor),
            "alloc".to_owned(),
            &alloc,
            Some("alloc".to_owned()),
            Some(handle.tag.clone()),
        )?;
        let allocated = self.finish_call(id, callee, Vec::new(), Vec::new(), Some(constructor))?;
        let mut init = signature;
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
        let (args, lent) = self.lower_call_arguments(id, &callee, &arguments, Some(allocated))?;
        self.finish_call(id, callee, args, lent, Some(constructor))
            .map(Some)
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

    /// The `Math` or `Number` member a callee names, if it names one.
    ///
    /// Recognized by shape rather than by symbol identity, which is a
    /// simplification: a program that shadowed the global `Math` with its own
    /// object would be mis-read. It cannot be shadowed by a *function* in the
    /// compiled program — that call would resolve to a direct target and never
    /// reach here — so the remaining case is an import named `Math` with
    /// matching method names.
    ///
    /// `docs/records/notebooks/any-unknown.md` describes the principled version: profiles that
    /// associate trusted *declaration identities* with a closed set of
    /// compiler-owned semantics, so the core never matches on a name at all.
    /// This is the shape that becomes.
    fn intrinsic_of(&self, callee: NodeId) -> Option<(Intrinsic, NumericBuiltin<'static>)> {
        let (object, member) = self.member_access(callee)?;
        if self.kind_of(object) != Some(syntax::IDENTIFIER) {
            return None;
        }
        let member = member.as_str();
        match self
            .node(object)
            .text
            .as_ref()
            .and_then(|text| text.as_utf8())?
        {
            "Math" => math_member(member).map(|intrinsic| (intrinsic, NumericBuiltin::Math)),
            // `Number`'s four predicates. The first two are `Number` only in
            // spelling: over a `number` they are exactly the global `isNaN`
            // and `isFinite`, because the whole difference the `Number.` forms
            // exist for is what they do to a value that is *not* a number,
            // and one cannot reach here.
            // `Number.parseInt` and the global are the same function object in
            // JavaScript, which is why this maps to the same helper rather than
            // to a second one.
            "Number" => Some((
                match member {
                    "isNaN" => Intrinsic::NotANumber,
                    "isFinite" => Intrinsic::UnaryCall("nts_is_finite"),
                    "isInteger" => Intrinsic::UnaryCall("nts_is_integer"),
                    "isSafeInteger" => Intrinsic::UnaryCall("nts_is_safe_integer"),
                    _ => return None,
                },
                NumericBuiltin::NumberPredicate,
            )),
            // Two functions rather than two names for one. `fromCharCode`
            // takes a UTF-16 code *unit* through `ToUint16` and always yields
            // one of them; `fromCodePoint` takes a code *point* and yields a
            // surrogate pair above 0xFFFF.
            "String" => Some((
                match member {
                    "fromCharCode" => Intrinsic::UnaryCall("nts_string_from_char_code"),
                    "fromCodePoint" => Intrinsic::UnaryCall("nts_string_from_code_point"),
                    _ => return None,
                },
                NumericBuiltin::StringFactory,
            )),
            _ => None,
        }
    }

    /// Whether `callee` is a member of the global `console` this compiler
    /// provides, and if so whether it writes to stderr: `log`, `info` and
    /// `debug` write to stdout, `error` and `warn` to stderr, as node's do.
    ///
    /// The library's `console`, which nothing compiled declares. A program's
    /// own binding of that name, such as an import, is the program's.
    /// `console.trace` prints a stack, and `console.table` and `console.dir`
    /// inspect structure, so they stay refused.
    fn console_method(&self, callee: NodeId) -> Option<bool> {
        let (object, member) = self.member_access(callee)?;
        if self.kind_of(object) != Some(syntax::IDENTIFIER)
            || self
                .node(object)
                .text
                .as_ref()
                .and_then(|text| text.as_utf8())
                != Some("console")
        {
            return None;
        }
        let global = self
            .node(object)
            .symbol
            .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
            .is_some_and(|record| record.declarations.is_empty());
        if !global {
            return None;
        }
        match member.as_str() {
            "log" | "info" | "debug" => Some(false),
            "error" | "warn" => Some(true),
            _ => None,
        }
    }

    /// `console.log(a, b)`: each argument spelled as node's `util.inspect`
    /// spells it at the top level, joined by a space, and written with a
    /// newline by `nts_console_write`.
    ///
    /// The spelling is `String(v)` with two corrections, `-0` and `10n`.
    /// An object is refused: node prints its structure, with depth and
    /// colour rules, and a placeholder would look like it works. So is a
    /// first argument that can hold a `%` directive when others follow it,
    /// which node substitutes from them (`console.log("%d items", n)`). A
    /// literal with no `%` is spelled as written.
    ///
    /// Written with the program's other output in the order it happens, and
    /// with no promise about output the program makes some other way, such as
    /// a C `printf` holding its own buffer.
    fn lower_console(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
        to_stderr: bool,
    ) -> Result<ValueId, Diagnostic> {
        let text = HirType::Managed(ManagedType::String);
        if arguments.len() > 1
            && let Some(first) = arguments.first()
            && self.may_format(*first)
        {
            return Err(self.unsupported(
                *first,
                "a first argument of `console.log` that can hold a `%` directive, which node substitutes from the arguments after it",
            ));
        }
        let mut line = None;
        for (at, argument) in arguments.iter().enumerate() {
            if self.kind_of(*argument) == Some(syntax::SPREAD_ELEMENT) {
                return Err(self.unsupported(*argument, "a spread argument of `console.log`"));
            }
            // `null` and `undefined` as written, which have no value to lower.
            let spelled = if let Some(absent) = self.absence_written_at(*argument) {
                let origin = self.origin(*argument);
                let word = if absent == super::tags::NULL {
                    "null"
                } else {
                    "undefined"
                };
                self.push(
                    OpKind::ConstString(word.to_owned().into()),
                    text.clone(),
                    origin,
                )
            } else {
                let value = self.lower_expression(*argument)?;
                self.inspected(*argument, value)?
            };
            if at > 0 {
                let origin = self.origin(*argument);
                let space = self.push(OpKind::ConstString(" ".into()), text.clone(), origin);
                line = Some(self.join(*argument, line, space, &text));
            }
            line = Some(self.join(*argument, line, spelled, &text));
        }
        let origin = self.origin(id);
        let line = match line {
            Some(line) => line,
            None => self.push(OpKind::ConstString("".into()), text, origin.clone()),
        };
        let stream = self.push(OpKind::ConstBool(to_stderr), HirType::Bool, origin.clone());
        Ok(self.runtime_call(
            "nts_console_write",
            vec![line, stream],
            HirType::Void,
            origin,
        ))
    }

    /// Whether a first argument of `console.log` could hold a `%` directive:
    /// a literal that has one, a template with one in its text or in a
    /// substitution that could hold one, or a value whose type admits a
    /// string that is not a literal without one.
    fn may_format(&self, node: NodeId) -> bool {
        match self.kind_of(node) {
            Some(
                syntax::STRING_LITERAL
                | syntax::NO_SUBSTITUTION_TEMPLATE_LITERAL
                | syntax::TEMPLATE_HEAD
                | syntax::TEMPLATE_MIDDLE
                | syntax::TEMPLATE_TAIL,
            ) => {
                return self
                    .node(node)
                    .text
                    .as_ref()
                    .and_then(|text| text.as_utf8())
                    .is_some_and(|written| written.contains('%'));
            }
            Some(
                syntax::TEMPLATE_EXPRESSION
                | syntax::TEMPLATE_SPAN
                | syntax::PARENTHESIZED_EXPRESSION,
            ) => {
                return self
                    .children(node)
                    .into_iter()
                    .any(|part| self.may_format(part));
            }
            _ => {}
        }
        let Some(ty) = self.snapshot.node_types.get(&node) else {
            return true;
        };
        let members = match self
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| &record.kind)
        {
            Some(TypeKind::Union(members)) => members.clone(),
            _ => vec![*ty],
        };
        members.iter().any(|member| {
            match self
                .snapshot
                .types
                .get(member.0 as usize)
                .map(|record| &record.kind)
            {
                Some(TypeKind::Literal(nts_semantic_schema::LiteralValue::String(value))) => {
                    value.encode_utf16().any(|unit| unit == u16::from(b'%'))
                }
                Some(
                    TypeKind::Number
                    | TypeKind::Boolean
                    | TypeKind::BigInt
                    | TypeKind::Null
                    | TypeKind::Undefined
                    | TypeKind::Void
                    | TypeKind::Symbol
                    | TypeKind::UniqueSymbol
                    | TypeKind::Literal(_),
                ) => false,
                _ => true,
            }
        })
    }

    /// One argument of `console.log`, spelled as node's `util.inspect`
    /// spells it at the top level: a string as itself, and a primitive as
    /// `String` spells it, except that negative zero is `-0` and a bigint
    /// ends in `n`.
    #[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
    fn inspected(&mut self, from: NodeId, value: ValueId) -> Result<ValueId, Diagnostic> {
        let text = HirType::Managed(ManagedType::String);
        // `undefined` is spelled by what it is, not by the type it was given:
        // `void expr` takes its context's type (`lower_void`), so as the first
        // argument of a `log(message: string, ...)` it is a string-typed
        // constant, and no arm below would read it as `undefined`.
        if matches!(self.values[value.0 as usize].kind, OpKind::ConstUndefined)
            || self.values[value.0 as usize].ty == HirType::Void
        {
            let origin = self.origin(from);
            return Ok(self.push(OpKind::ConstString("undefined".into()), text, origin));
        }
        match self.values[value.0 as usize].ty {
            HirType::Float { .. } => {
                let spelled = self.as_string(from, value)?;
                let origin = self.origin(from);
                let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
                let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
                let minus = self.push(
                    OpKind::ConstString("-0".into()),
                    text.clone(),
                    origin.clone(),
                );
                // `x === 0`, then which zero by its reciprocal's sign: `1/x`
                // alone is `-Infinity` for a subnormal too.
                let is_zero = self.push(
                    OpKind::Binary {
                        op: BinOp::Eq,
                        lhs: value,
                        rhs: zero,
                    },
                    HirType::Bool,
                    origin.clone(),
                );
                let inverse = self.push(
                    OpKind::Binary {
                        op: BinOp::Div,
                        lhs: one,
                        rhs: value,
                    },
                    HirType::NUMBER,
                    origin.clone(),
                );
                let negative = self.push(
                    OpKind::Binary {
                        op: BinOp::Lt,
                        lhs: inverse,
                        rhs: zero,
                    },
                    HirType::Bool,
                    origin,
                );
                let zero_spelled = self.lower_branching_value_at(
                    from,
                    text.clone(),
                    negative,
                    Branch::Value(minus),
                    Branch::Value(spelled),
                )?;
                self.lower_branching_value_at(
                    from,
                    text,
                    is_zero,
                    Branch::Value(zero_spelled),
                    Branch::Value(spelled),
                )
            }
            HirType::BigInt => {
                let spelled = self.as_string(from, value)?;
                let origin = self.origin(from);
                let suffix = self.push(OpKind::ConstString("n".into()), text.clone(), origin);
                Ok(self.join(from, Some(spelled), suffix, &text))
            }
            HirType::Erased if self.spells_itself(from) => {
                let origin = self.origin(from);
                Ok(self.runtime_call("nts_value_inspect", vec![value], text, origin))
            }
            // **An `unknown` erased right here from a primitive is that
            // primitive.** `const value: unknown = n; console.log(value)` is an
            // `Erase` of a number in this function: what node prints is decided
            // by the operand, which is known. Only where the erase carries no
            // absence -- one that can be `null` or `undefined` is the runtime's
            // question again -- and only for what the arms below spell.
            HirType::Erased
                if let OpKind::Erase {
                    value: inner,
                    absent: Absent::Impossible,
                    ..
                } = self.values[value.0 as usize].kind
                    && matches!(
                        self.values[inner.0 as usize].ty,
                        HirType::Float { .. }
                            | HirType::Int { .. }
                            | HirType::Bool
                            | HirType::BigInt
                            | HirType::Managed(ManagedType::String | ManagedType::Symbol)
                    ) =>
            {
                self.inspected(from, inner)
            }

            HirType::Int { .. }
            | HirType::Bool
            | HirType::Managed(ManagedType::String | ManagedType::Symbol) => {
                self.as_string(from, value)
            }
            _ => {
                let named = self.describe_node(from);
                Err(self.unsupported(
                    from,
                    &format!(
                        "`console.log` of {named}, which node prints by inspecting its structure"
                    ),
                ))
            }
        }
    }

    /// A global function this compiler implements, if this call names one.
    ///
    /// `None` means the name is not one of them, which is a different answer
    /// from `Some(Err(..))`: the second is a builtin that is provided and was
    /// given something it cannot take, and it says so rather than falling
    /// through to "a builtin this compiler does not provide".
    /// `parseInt(string, radix)`.
    ///
    /// The radix defaults to **zero** rather than to ten, because zero is what
    /// the specification's "decide from the text" is: `parseInt("0x1f")` is 31
    /// and `parseInt("0x1f", 10)` is 0. Passing ten as the default would answer
    /// the second for both.
    fn lower_parse_int(&mut self, id: NodeId, arguments: &[NodeId]) -> Result<ValueId, Diagnostic> {
        let Some(text) = arguments.first() else {
            return Err(self.unsupported(id, "`parseInt` with no argument"));
        };
        let values = self.builtin_raw_arguments(NumericBuiltin::ParseRadix, arguments, None)?;
        let value = values[0];
        let value = self.coerce(value, &HirType::Managed(ManagedType::String), *text)?;
        let origin = self.origin(id);
        let radix = match arguments.get(1) {
            // ToNumber precedes ToInt32: unchecked JavaScript can pass a
            // boolean or undefined. Normalize it before the shared integer
            // operation, whose constant folding and int32 identity apply at
            // the call site instead of inside an out-of-line parser.
            Some(node) => {
                let number = self.builtin_number_argument(
                    (id, *node),
                    NumericBuiltin::ParseRadix,
                    2,
                    values[1],
                )?;
                self.coerce(number, &HirType::NUMBER, *node)?
            }
            None => self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone()),
        };
        let radix = self.push(
            OpKind::Unary {
                op: UnOp::ToInt32,
                operand: radix,
            },
            HirType::NUMBER,
            origin.clone(),
        );
        Ok(self.runtime_call("nts_parse_int", vec![value, radix], HirType::NUMBER, origin))
    }

    /// `parseFloat(string)`.
    ///
    /// No radix, so no default to get wrong -- the grammar decides, and
    /// `nts_parse_float` is where it lives. What it is *not* is `Number(s)`:
    /// `Number("12abc")` is NaN and `parseFloat("12abc")` is 12, which is the
    /// same difference `lower_parse_int` records.
    fn lower_parse_float(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let Some(text) = arguments.first() else {
            return Err(self.unsupported(id, "`parseFloat` with no argument"));
        };
        let value = self.lower_expression(*text)?;
        let value = self.coerce(value, &HirType::Managed(ManagedType::String), *text)?;
        let origin = self.origin(id);
        Ok(self.runtime_call("nts_parse_float", vec![value], HirType::NUMBER, origin))
    }

    /// `encodeURI`, `encodeURIComponent`, `decodeURI` and `decodeURIComponent`.
    ///
    /// The runtime does the transcoding and answers `NULL` for input the other
    /// direction could not have produced -- a truncated escape, an overlong
    /// encoding, an unpaired surrogate. **A runtime function here cannot
    /// throw**, so the `URIError` is raised from this side, which is the same
    /// split `lower_repeat` makes for its `RangeError`.
    ///
    /// The message is node's, character for character. `querystring.parse`
    /// catches this by class and not by text, but a message that differs from
    /// node's is a difference a test can see and there is no reason to have
    /// one.
    fn lower_uri(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
        encode: bool,
        component: bool,
    ) -> Result<ValueId, Diagnostic> {
        let Some(text) = arguments.first() else {
            return Err(self.unsupported(id, "a URI builtin with no argument"));
        };
        let value = self.lower_expression(*text)?;
        let value = self.coerce(value, &HirType::Managed(ManagedType::String), *text)?;
        let origin = self.origin(id);
        let flag = self.push(
            OpKind::ConstFloat(if component { 1.0 } else { 0.0 }),
            HirType::NUMBER,
            origin.clone(),
        );
        let callee = if encode {
            "nts_encode_uri"
        } else {
            "nts_decode_uri"
        };
        let string = HirType::Managed(ManagedType::String);
        let built = self.runtime_call(callee, vec![value, flag], string.clone(), origin.clone());

        // `NULL` is the refusal, and it is tested here rather than left to the
        // caller: every use of the result reads a length or a unit through it,
        // so an untested `NULL` is a load from address zero rather than the
        // `URIError` the language specifies.
        let nothing = self.push(OpKind::ConstNull, string, origin.clone());
        let failed = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: built,
                rhs: nothing,
            },
            HirType::Bool,
            origin.clone(),
        );
        let throwing = self.new_block();
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: failed,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });
        self.switch_to(throwing);
        self.throw_provided_error(id, "URIError", "URI malformed")?;
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: carry_on,
                args: Vec::new(),
            });
        }
        self.switch_to(carry_on);
        Ok(built)
    }

    /// `setTimeout(fn, ms)` and `setInterval(fn, ms)`.
    ///
    /// A *capability* over the host's `post_delayed` rather than part of the
    /// host contract, so both hosts have it and neither implements it -- which
    /// is what makes a `setTimeout` ordering testable against node, because the
    /// deterministic host runs the same code the libuv one does.
    ///
    /// The callback is a closure, and a closure in this compiler is an object
    /// with a method table, so the runtime is handed the object *and* the slot
    /// its call occupies. One slot serves every closure: what makes that safe
    /// is that the caller spells the signature, and a timer callback has one.
    fn lower_set_timer(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
        repeating: bool,
    ) -> Result<ValueId, Diagnostic> {
        let (callback, delay) = match arguments {
            [callback] => (*callback, None),
            [callback, delay] => (*callback, Some(*delay)),
            // `setTimeout(fn, ms, a, b)` forwards the extra arguments to the
            // callback. That is a different shape rather than a longer one:
            // the callback's signature stops being "takes nothing", and the
            // arguments have to outlive the call in something.
            _ => return Err(self.unsupported(id, "a timer that forwards arguments")),
        };
        // `@types/node` types this `NodeJS.Timeout`, an object with `unref`.
        // The default library says `number`, which is what the runtime returns,
        // and guessing across that difference would hand a program an object it
        // could not use.
        let returns = self.type_of(id).unwrap_or(HirType::Void);
        if !matches!(returns, HirType::Float { .. } | HirType::Int { .. }) {
            return Err(self.unsupported(id, "a timer whose id is not a number"));
        }
        let closure = self.lower_expression(callback)?;
        if !matches!(
            self.values[closure.0 as usize].ty,
            HirType::Managed(ManagedType::Object(_))
        ) {
            return Err(self.unsupported(id, "a timer callback that is not a function"));
        }
        let Some(slot) = self.hierarchy.closure_slot else {
            return Err(self.unsupported(id, "a timer in a program with no closures"));
        };
        let origin = self.origin(id);
        let slot = self.push(OpKind::DispatchSlot(slot), HirType::NUMBER, origin.clone());
        let delay = match delay {
            Some(node) => self.lower_expression(node)?,
            // `setTimeout(fn)` is `setTimeout(fn, 0)`.
            None => self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone()),
        };
        let repeating = self.push(OpKind::ConstBool(repeating), HirType::Bool, origin.clone());
        Ok(self.runtime_call(
            "nts_set_timeout",
            vec![closure, slot, delay, repeating],
            returns,
            origin,
        ))
    }

    /// `clearTimeout(id)` and `clearInterval(id)`, which are one operation.
    ///
    /// Clearing a timer that already fired is legal and does nothing, so this
    /// needs no test for whether the id is live -- the host's table knows, and
    /// it is the only thing that can.
    fn lower_clear_timer(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let [timer] = arguments else {
            // `clearTimeout()` with no argument is legal and does nothing, but
            // it is also never what a program means.
            return Err(self.unsupported(id, "a `clearTimeout` with no timer"));
        };
        let timer = self.lower_expression(*timer)?;
        let origin = self.origin(id);
        Ok(self.runtime_call("nts_clear_timeout", vec![timer], HirType::Void, origin))
    }

    fn lower_provided_builtin(
        &mut self,
        id: NodeId,
        name: &str,
        arguments: &[NodeId],
    ) -> Option<Result<ValueId, Diagnostic>> {
        let primitive = primitive_builtin(name);
        // The globals convert their argument; the Number predicates do not.
        // Carry that semantic owner through intrinsic selection rather than
        // inferring conversion from the shared numeric helper signature.
        if let Some(intrinsic) = global_predicate(name) {
            return Some(self.lower_intrinsic(
                id,
                intrinsic,
                NumericBuiltin::GlobalPredicate,
                arguments,
            ));
        }
        // `parseInt(string, radix)`, whose second argument is optional -- so it
        // is read here rather than below, where every builtin takes exactly
        // one.
        //
        // It is not `Number(s)` with a radix. `Number("")` is 0 and
        // `parseInt("")` is NaN; `Number("12abc")` is NaN and `parseInt("12abc")`
        // is 12. Stopping at the first character the radix does not admit is
        // the whole of the difference, and `nts_parse_int` is where it lives.
        //
        // 14 sites across 6 modules, and `os.networkInterfaces` is behind one of
        // them through `getCIDR`.
        if name == "parseInt" {
            return Some(self.lower_parse_int(id, arguments));
        }
        // `parseFloat(string)`, beside `parseInt` because it is the same
        // operation with the radix fixed and the grammar widened -- and because
        // a reader looking for one will look here for the other.
        //
        // One argument, so it could have gone in the single-argument section
        // below. It is here because the *pair* is the thing: whatever is true of
        // stopping at the first character the grammar does not admit is true of
        // both, and splitting them put two halves of one behaviour two hundred
        // lines apart.
        if name == "parseFloat" {
            return Some(self.lower_parse_float(id, arguments));
        }
        // The four URI builtins, as one lowering with two flags. They are a
        // pair of pairs and the members of each pair differ only in a character
        // set, so four entry points would be four copies of the `URIError`
        // half -- which is the part with the edges in it.
        //
        // `decodeURIComponent` gates `querystring.parse`, and `parse` is what
        // six of `querystring`'s seven failing test files stop at.
        if let Some((encode, component)) = match name {
            "encodeURI" => Some((true, false)),
            "encodeURIComponent" => Some((true, true)),
            "decodeURI" => Some((false, false)),
            "decodeURIComponent" => Some((false, true)),
            _ => None,
        } {
            return Some(self.lower_uri(id, arguments, encode, component));
        }
        // The `timers` capability, which takes two arguments and so has to be
        // read before the single-argument builtins below.
        match name {
            "setTimeout" => return Some(self.lower_set_timer(id, arguments, false)),
            "setInterval" => return Some(self.lower_set_timer(id, arguments, true)),
            "clearTimeout" | "clearInterval" => {
                return Some(self.lower_clear_timer(id, arguments));
            }
            _ => {}
        }
        // `Symbol()` and `Symbol(description)`. The one builtin here that takes
        // *no* argument as well as one, so it is read before the single
        // argument is destructured below.
        //
        // Called rather than `new`-ed: `new Symbol()` is a TypeError in
        // JavaScript, and the checker rejects it, so there is no constructor
        // form to handle.
        if primitive == Some(PrimitiveBuiltin::Symbol) {
            return Some(self.lower_symbol_new(id, arguments));
        }
        let [argument] = arguments else {
            return None;
        };
        // `String(x)` is `ToString`, which is what `s + n` already needs. For a
        // number only -- `String(unknown)` is a general renderer and
        // `String({})` walks a prototype chain.
        if primitive == Some(PrimitiveBuiltin::String) {
            return Some(
                self.lower_expression(*argument)
                    .and_then(|value| self.as_string(*argument, value)),
            );
        }
        // `Boolean(x)` is `ToBoolean`, and `ToBoolean` is the test `if (x)`
        // already performs -- so it is that operation rather than a conversion
        // of its own, and it inherits whatever the truthiness rule already
        // knows about each representation. Nineteen sites in the profile, every
        // one of them turning an optional or an erased value into a flag to
        // store.
        if primitive == Some(PrimitiveBuiltin::Boolean) {
            let value = match self.lower_expression(*argument) {
                Ok(value) => value,
                Err(problem) => return Some(Err(problem)),
            };
            return Some(Ok(self.truthy(id, value)));
        }
        // `Number(x)`, the mirror of it and a much smaller job: the identity on
        // a number, and `ToNumber` on a boolean, which the specification gives
        // as 1 and 0. On a string it is a parse -- the same parse `parseFloat`
        // needs, and neither exists yet -- and on anything else it is `valueOf`
        // off a prototype chain.
        if primitive == Some(PrimitiveBuiltin::Number) {
            let value = match self.lower_expression(*argument) {
                Ok(value) => value,
                Err(problem) => return Some(Err(problem)),
            };
            return Some(self.coerce_explicit_number(id, *argument, value));
        }

        // `BigInt(x)`, the mirror of `Number(x)` and not quite its twin.
        //
        // The identity on a bigint, and `0n`/`1n` on a boolean, both of which a
        // C cast already is. On a *number* it is a conversion with a
        // precondition: the specification throws a `RangeError` when the value
        // is not an integer, so `BigInt(1.5)` is not `1n` and a cast would be a
        // wrong answer rather than a lossy one. `nts_bigint_from_number` checks
        // and refuses, the way an index past the end of an array does.
        //
        // On a string it is a parse, which `parseInt` would need too and
        // neither has; on anything else it is `valueOf` off a prototype chain.
        // Both are refused by name -- 22 sites in the node profile said only
        // "a builtin this compiler does not provide" before this existed.
        if primitive == Some(PrimitiveBuiltin::BigInt) {
            let value = match self.lower_expression(*argument) {
                Ok(value) => value,
                Err(problem) => return Some(Err(problem)),
            };
            let origin = self.origin(id);
            return Some(match self.values[value.0 as usize].ty {
                HirType::BigInt => Ok(value),
                HirType::Bool => Ok(self.push(OpKind::Convert(value), HirType::BigInt, origin)),
                HirType::Float { .. } | HirType::Int { .. } => Ok(self.runtime_call(
                    "nts_bigint_from_number",
                    vec![value],
                    HirType::BigInt,
                    origin,
                )),
                _ => Err(self.unsupported(id, "a conversion to bigint from this type")),
            });
        }
        None
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

    /// ECMAScript's exponentiation, which `**`, `**=` and `Math.pow` all spell.
    ///
    /// A call rather than an operation, because it is **not** C's `pow`: the
    /// specification says a base of 1 or -1 with an infinite exponent is NaN,
    /// where C99 says 1. The runtime holds that difference in one place; see
    /// `nts_math_pow`.
    fn exponentiate(
        &mut self,
        id: NodeId,
        ty: HirType,
        base: ValueId,
        exponent: ValueId,
    ) -> Result<ValueId, Diagnostic> {
        let origin = self.origin(id);
        if self.values[base.0 as usize].ty == HirType::BigInt
            && self.values[exponent.0 as usize].ty == HirType::BigInt
        {
            // A negative exponent is a JavaScript RangeError, not a runtime
            // domain refusal. Lower its throw so a local or caller catch can
            // handle it, just as the radix guard does.
            if !matches!(self.values[exponent.0 as usize].kind, OpKind::ConstInt(n) if n >= 0) {
                let zero = self.push(OpKind::ConstInt(0), HirType::BigInt, origin.clone());
                let negative = self.push(
                    OpKind::Binary {
                        op: BinOp::Lt,
                        lhs: exponent,
                        rhs: zero,
                    },
                    HirType::Bool,
                    origin.clone(),
                );
                // Node v26.13.0/V8's observed text; this is oracle wording rather
                // than the specification's sentence about negative exponents.
                self.bigint_range_error_if(id, negative, "Exponent must be positive")?;
            }
            return Ok(self.runtime_call("nts_bigint_pow", vec![base, exponent], ty, origin));
        }
        if let OpKind::ConstFloat(power) = self.values[exponent.0 as usize].kind
            && let Some(folded) = self.fold_power(base, power, &ty, &origin)
        {
            return Ok(folded);
        }
        Ok(self.runtime_call("nts_math_pow", vec![base, exponent], ty, origin))
    }

    /// Lower bigint operator domain errors through the provided-error path,
    /// so both the local handler and a raising caller can catch them.
    fn bigint_range_error_if(
        &mut self,
        id: NodeId,
        invalid: ValueId,
        text: &str,
    ) -> Result<(), Diagnostic> {
        let throwing = self.new_block();
        let carry_on = self.new_block();
        self.terminate(Terminator::Branch {
            cond: invalid,
            then_target: throwing,
            then_args: Vec::new(),
            else_target: carry_on,
            else_args: Vec::new(),
        });
        self.switch_to(throwing);
        let origin = self.origin(id);
        let message = self.push(
            OpKind::ConstString(text.to_owned().into()),
            HirType::Managed(ManagedType::String),
            origin,
        );
        self.throw_provided_error_text(id, "RangeError", message)?;
        if !self.is_terminated() {
            self.terminate(Terminator::Jump {
                target: carry_on,
                args: Vec::new(),
            });
        }
        self.switch_to(carry_on);
        Ok(())
    }

    /// A zero bigint divisor throws before the backend's division/remainder.
    fn require_bigint_divisor(
        &mut self,
        id: NodeId,
        op: BinOp,
        lhs: ValueId,
        rhs: ValueId,
    ) -> Result<(), Diagnostic> {
        if matches!(op, BinOp::Div | BinOp::Rem)
            && self.values[lhs.0 as usize].ty == HirType::BigInt
            && self.values[rhs.0 as usize].ty == HirType::BigInt
            && !matches!(self.values[rhs.0 as usize].kind, OpKind::ConstInt(n) if n != 0)
        {
            let origin = self.origin(id);
            let zero = self.push(OpKind::ConstInt(0), HirType::BigInt, origin.clone());
            let invalid = self.push(
                OpKind::Binary {
                    op: BinOp::Eq,
                    lhs: rhs,
                    rhs: zero,
                },
                HirType::Bool,
                origin,
            );
            self.bigint_range_error_if(id, invalid, "Division by zero")?;
        }
        Ok(())
    }

    /// `x ** k` for a literal `k`, where the operations spell it exactly.
    ///
    /// Worth doing because `nts_math_pow` lives in the runtime's translation
    /// unit, so the C compiler cannot see through it the way it sees through
    /// `pow` -- `x ** 2` would cost a call where the C++ it is measured against
    /// costs a multiply. `pow(x, 2)` is one of the calls clang folds itself,
    /// and this compiler has to fold its own.
    ///
    /// Three exponents, and the boundary was found by measurement rather than
    /// by reasoning:
    ///
    /// - `x ** 3` is **not** `x * x * x`. `pow` rounds the cube once and three
    ///   multiplications round twice, and they differ: at `x = -828.3432249414309`
    ///   the two answers are `-568369773.2487181` and `-568369773.2487183`.
    ///   A pool of interesting values agreed on every one of them, which is
    ///   what makes the case worth writing down.
    /// - `x ** -1` is **not** `1 / x` in practice, even though it is in theory:
    ///   both are the correctly rounded reciprocal, and V8's `pow` is not
    ///   correctly rounded at `x = -2.126284657577152e-37`. The specification
    ///   allows that -- `pow` is implementation-approximated -- so the fold
    ///   would be righter than node and would still be a difference.
    /// - `x ** 0.5` is not `sqrt(x)`: they disagree on `-0`, where `pow` gives
    ///   `+0` and `sqrt` gives `-0`.
    ///
    /// What is left is exact. `x * x` is the correctly rounded square for every
    /// double including the infinities, the zeros and NaN; `x ** 1` is `x`; and
    /// `x ** 0` is `1` for every base, NaN included, which the specification
    /// says before it says anything else about the base.
    // The comparisons here are exact on purpose: the exponent is a literal, and
    // folding `x ** 1.9999999999999998` as though it were `x ** 2` would be a
    // wrong answer rather than an imprecise one. A margin is what this lint
    // exists to suggest and is exactly what must not happen.
    #[allow(clippy::float_cmp)]
    fn fold_power(
        &mut self,
        base: ValueId,
        power: f64,
        ty: &HirType,
        origin: &Origin,
    ) -> Option<ValueId> {
        if power == 0.0 {
            return Some(self.push(OpKind::ConstFloat(1.0), ty.clone(), origin.clone()));
        }
        if power == 1.0 {
            return Some(base);
        }
        if power == 2.0 {
            return Some(self.push(
                OpKind::Binary {
                    op: BinOp::Mul,
                    lhs: base,
                    rhs: base,
                },
                ty.clone(),
                origin.clone(),
            ));
        }
        None
    }

    fn lower_intrinsic(
        &mut self,
        id: NodeId,
        intrinsic: Intrinsic,
        builtin: NumericBuiltin<'_>,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let ty = self
            .type_of(id)
            .ok_or_else(|| self.unrepresentable(id, "a `Math` call"))?;
        let origin = self.origin(id);

        match (intrinsic, arguments) {
            (Intrinsic::Unary(op), [_]) => {
                let values = self.builtin_arguments(id, builtin, arguments)?;
                let operand = values[0];
                Ok(self.push(OpKind::Unary { op, operand }, ty, origin))
            }
            // `Math.min(a, b, c)`, `Math.max(a)` and `Math.max()`.
            //
            // **Associative and exact**, which is what makes folding right here
            // and wrong for `Math.hypot` below: each step selects one of its
            // operands, so three arguments folded pairwise give the number the
            // specification's n-ary comparison gives -- including the `NaN`
            // that propagates out of any argument, and the `+0` that
            // `max(-0, +0)` answers.
            //
            // The empty call is that fold's identity: `Math.max()` is
            // `-Infinity` and `Math.min()` is `+Infinity`, which is what the
            // specification says and what a fold with no operands needs.
            //
            // **And every argument is converted, not assumed.** This comment used
            // to end "one argument is itself, which is `ToNumber(a)` where `a` is
            // already a number", and that last clause was the bug: nothing made it
            // so. `Math.max(1, obj)` folded a `Float` against a
            // `Managed(Object)` and reached the verifier as `OperandsDiffer` --
            // invalid HIR from a program test262 runs
            // (`Math/max/Math.max_each-element-coerced.js`), and
            // `outcomes/math-max-converts-every-argument` is the record.
            //
            // The builtin argument catalog now guards primitive ToNumber here.
            // It throws for Symbol/BigInt, and objects stop by name until their
            // ToPrimitive conversion is available.
            (Intrinsic::Binary(op @ (BinOp::Min | BinOp::Max)), args) => {
                let mut folded: Option<ValueId> = None;
                for operand in self.builtin_arguments(id, builtin, args)? {
                    folded = Some(match folded {
                        None => operand,
                        Some(lhs) => self.push(
                            OpKind::Binary {
                                op,
                                lhs,
                                rhs: operand,
                            },
                            ty.clone(),
                            origin.clone(),
                        ),
                    });
                }
                if let Some(value) = folded {
                    return Ok(value);
                }
                let identity = if matches!(op, BinOp::Max) {
                    f64::NEG_INFINITY
                } else {
                    f64::INFINITY
                };
                Ok(self.push(OpKind::ConstFloat(identity), ty, origin))
            }
            // Every other binary `Math` member, and on the same terms: the
            // specification converts both arguments with `ToNumber` and so does
            // this. `Math.pow(obj, 2)` had the same `OperandsDiffer` waiting in it.
            (Intrinsic::Binary(op), [_, _]) => {
                let values = self.builtin_arguments(id, builtin, arguments)?;
                let (lhs, rhs) = (values[0], values[1]);
                Ok(self.push(OpKind::Binary { op, lhs, rhs }, ty, origin))
            }
            (Intrinsic::NotANumber, [_]) => {
                let values = self.builtin_arguments(id, builtin, arguments)?;
                let operand = values[0];
                Ok(self.push(
                    OpKind::Binary {
                        op: BinOp::Ne,
                        lhs: operand,
                        rhs: operand,
                    },
                    ty,
                    origin,
                ))
            }
            (Intrinsic::UnaryCall(name), [_]) => {
                let values = self.builtin_arguments(id, builtin, arguments)?;
                let operand = values[0];
                // A code point the helper will not accept throws before it is
                // reached. See `guard_code_point`.
                if name == "nts_string_from_code_point" {
                    self.guard_code_point(id, operand)?;
                }
                Ok(self.runtime_call(name, vec![operand], ty, origin))
            }
            (Intrinsic::BinaryCall(name), [_, _]) => {
                let values = self.builtin_arguments(id, builtin, arguments)?;
                let (lhs, rhs) = (values[0], values[1]);
                Ok(self.runtime_call(name, vec![lhs, rhs], ty, origin))
            }
            // `String.fromCharCode` takes any number of code units and the
            // runtime offers one at a time, so the n-ary call is the fold.
            // Concatenation is associative and exact on strings, which is what
            // makes folding this one right where folding `Math.hypot` would
            // not be -- `sqrt(sqrt(a^2+b^2)^2+c^2)` is the same number only in
            // arithmetic that has no rounding.
            //
            // It is the shape real code uses, and refusing it stopped Node's
            // own UTF-8 decoder: a code point above the BMP is written
            // `fromCharCode(0xd800 + (c >> 10), 0xdc00 + (c & 0x3ff))`, which
            // is the surrogate pair, and there is no one-at-a-time spelling of
            // it that does not allocate the same two strings anyway.
            (Intrinsic::UnaryCall(name), [_, rest @ ..])
                if !rest.is_empty() && name == "nts_string_from_char_code" =>
            {
                let values = self.builtin_arguments(id, builtin, arguments)?;
                let operand = values[0];
                let mut folded = self.runtime_call(name, vec![operand], ty.clone(), origin.clone());
                for operand in values.into_iter().skip(1) {
                    let unit = self.runtime_call(name, vec![operand], ty.clone(), origin.clone());
                    // The *call* spelling of concatenation, not `BinOp::Concat`.
                    // The emitter renders both as `nts_concat`, but only a call
                    // carries `frame`: `hir::frame_capacity` reads a call's
                    // callee and a binary operator has nowhere to put storage.
                    //
                    // Each side here is exactly one code unit, so the pair is
                    // two and fits a frame slot -- which `flow::string_span`
                    // can now say, because it knows what `fromCharCode` returns.
                    // As a binop this was a heap allocation: three of the eight
                    // `node-utf8` makes per decoded string, for its three emoji.
                    folded = self.runtime_call(
                        "nts_concat",
                        vec![folded, unit],
                        ty.clone(),
                        origin.clone(),
                    );
                }
                Ok(folded)
            }
            // Only the arities selected above are admitted. A helper's f64
            // parameter is storage, not permission to reinterpret other calls.
            _ => Err(self.unsupported(id, "an intrinsic call with this many arguments")),
        }
    }

    /// A method on a string.
    ///
    /// Every one of these is a runtime call, because a string has no layout to
    /// resolve a member against and no class the program declares. The set is
    /// deliberately the operations that are *exactly* expressible over UTF-16
    /// code units, which is what a `NtsString` holds -- so each is the same
    /// function JavaScript specifies rather than an approximation of it.
    ///
    /// `toUpperCase`, `toLowerCase` and `trim` are absent for that reason. All
    /// three are defined over Unicode, not over ASCII, and an ASCII version
    /// would be right for most inputs and quietly wrong for the rest. Refusing
    /// beats that.
    /// The string calls whose n-ary form is a fold, and the empty one.
    ///
    /// `None` where the helper is neither, which is every other one: the arity
    /// check is right about those, and the refusal it produces names the method.
    fn fold_string_call(
        &mut self,
        helper: &str,
        args: &[ValueId],
        ty: &HirType,
        origin: &Origin,
    ) -> Option<ValueId> {
        // **`s.split(sep, limit)` splits and then truncates.**
        //
        // Exact for a string separator: the specification stops early and a
        // truncation of the whole result is the same list, because a separator
        // that is not a regular expression cannot make the earlier elements
        // depend on how many are wanted.
        //
        // The limit goes through `ToUint32` first, and that is not decoration.
        // `split(",", -1)` means *no* limit -- `ToUint32(-1)` is 4294967295 --
        // while slicing to `-1` counts from the end and would drop the last
        // element.
        //
        // `UnOp::ToUint32` and not the `>>> 0` that spells it in source. The
        // idiom is two operands and a coercion on each, which the binary path
        // inserts and a hand-built op does not: writing the shift here gave
        // LLVM a raw double where it wanted a converted one, and `-1` came back
        // as a negative index that dropped the last element. The operation the
        // specification names is the one op this needs.
        if helper == "nts_str_split" && args.len() == 3 {
            let whole = self.runtime_call(
                "nts_str_split",
                vec![args[0], args[1]],
                ty.clone(),
                origin.clone(),
            );
            let limit = self.push(
                OpKind::Unary {
                    op: UnOp::ToUint32,
                    operand: args[2],
                },
                HirType::NUMBER,
                origin.clone(),
            );
            let from = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
            return Some(self.runtime_call(
                "nts_array_slice_ref",
                vec![whole, from, limit],
                ty.clone(),
                origin.clone(),
            ));
        }

        // **`s.concat()` is `s`.** With no arguments there is nothing to join,
        // and the arity check would otherwise pad the missing one -- with a
        // *number*, because the filler does not know this parameter is a
        // string. That emitted `nts_concat(v0, v1)` with a `double` in the
        // second slot, which clang rejects, on the gated binary, with no
        // diagnostic from this compiler at all.
        if helper == "nts_concat" && args.len() == 1 {
            return Some(args[0]);
        }

        // **`s.concat(a, b, c)` is the fold**, for the reason
        // `String.fromCharCode` folds: concatenation is associative and exact
        // on strings, so pairing them left to right gives the string the n-ary
        // call gives. The runtime offers two at a time and the arity check
        // would otherwise refuse anything else as `a string method with this
        // many arguments`, which is true of the helper and not of the method.
        if helper == "nts_concat" && args.len() > 2 {
            let mut folded = args[0];
            for value in args.iter().skip(1) {
                folded = self.runtime_call(
                    "nts_concat",
                    vec![folded, *value],
                    ty.clone(),
                    origin.clone(),
                );
            }
            return Some(folded);
        }
        None
    }

    fn lower_string_method(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        member: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        // [`Self::literal_name`] rather than the node's text, because the
        // decoder carries none on a literal: `o["twice"]()` names its method
        // with a `STRING_LITERAL`, and reading `.text` there answered `None`
        // for a name the program spells in full. Three call paths -- a string's
        // methods, an array's and an object's -- each read it the same wrong
        // way, so a bracketed method call was refused as "a computed method
        // name" on every receiver there is.
        let name = self
            .called_member_name(member)
            .ok_or_else(|| self.unsupported(member, "a computed method name"))?;

        // (runtime function, how many arguments after the receiver, result)
        let string = HirType::Managed(ManagedType::String);
        // `charCodeAt` is an operation rather than a call: as a call its index
        // would have to match a C signature, which pins the loop counter that
        // produces it to a `double` and makes every step downstream floating
        // point.
        if name == "charCodeAt"
            && let [argument] = arguments
        {
            return self.builtin_string_unit_at(id, receiver, *argument);
        }

        if let Some(value) = self.lower_positioned_string_method(id, receiver, &name, arguments)? {
            return Ok(value);
        }

        // `s.concat()` concatenates nothing: `s` itself, which is immutable.
        if name == "concat" && arguments.is_empty() {
            return Ok(receiver);
        }
        let (helper, arity, ty) = match name.as_str() {
            "codePointAt" => ("nts_str_code_point_at", 1, HirType::NUMBER),
            "charAt" => ("nts_str_char_at", 1, string.clone()),
            "repeat" => ("nts_str_repeat", 1, string.clone()),
            "slice" => ("nts_str_slice", 2, string.clone()),
            "substring" => ("nts_str_substring", 2, string.clone()),
            "concat" => ("nts_concat", 1, string.clone()),
            // `trim` and its two halves. The whitespace set is the
            // specification's rather than `isspace`'s -- it includes NBSP and
            // the byte order mark -- and lives in the runtime, where it can be
            // read as a list.
            "trim" => ("nts_str_trim", 0, string.clone()),
            // `padStart(n)` pads with a single space, which the filler below
            // supplies: every other omitted argument here is "to the end" and
            // is a number, and this one is a string.
            "padStart" => ("nts_str_pad_start", 2, string.clone()),
            "padEnd" => ("nts_str_pad_end", 2, string.clone()),
            // The only two members that are about surrogates rather than
            // characters. A one-byte string cannot hold a lone one, which is
            // most strings and the whole of the answer for them.
            "isWellFormed" => ("nts_str_is_well_formed", 0, HirType::Bool),
            "toWellFormed" => ("nts_str_to_well_formed", 0, string.clone()),

            // Case conversion, which is a table rather than an algorithm -- see
            // `runtime/c/quickjs`. The locale forms are deliberately *not*
            // aliased onto these: `toLocaleUpperCase` of `i` in Turkish is
            // `\u0130` and not `I`, so answering it with the
            // locale-independent mapping would be wrong rather than
            // approximate, and a wrong answer is worse than a named refusal.
            "toLowerCase" => ("nts_str_to_lower_case", 0, string.clone()),
            "toUpperCase" => ("nts_str_to_upper_case", 0, string.clone()),

            "trimStart" => ("nts_str_trim_start", 0, string.clone()),
            "trimEnd" => ("nts_str_trim_end", 0, string.clone()),
            // `split`, with a *string* separator. A regular expression is a
            // different feature and is refused below by falling through, which
            // names it rather than splitting on its source text.
            "split" => (
                "nts_str_split",
                1,
                HirType::Managed(ManagedType::Array(Box::new(string))),
            ),
            // `replace` takes the first match, `replaceAll` every one. The
            // difference is the whole of it, so they share a runtime function
            // and differ by which entry point calls it.
            //
            // Both expand `$` in the replacement, which is not optional: node
            // answers `"a-b".replace("-", "$&")` with `"a-b"`, not with
            // `"a$&b"`. A pattern that is a regular expression is refused just
            // below rather than here, because the member exists for it and it
            // is the *argument* that is not something this can do.
            "replace" => ("nts_str_replace", 2, string.clone()),
            "replaceAll" => ("nts_str_replace_all", 2, string.clone()),
            // Named, because twenty-eight instances of "this string method"
            // in the node profile is a bucket and not a work item.
            other => {
                return Err(self.unsupported(
                    member,
                    &format!("`{other}`, which a string does not have here"),
                ));
            }
        };

        let mut args = vec![receiver];
        self.lower_method_arguments(id, (MethodsOf::String, name.as_str()), arguments, &mut args)?;
        let origin = self.origin(id);

        if let Some(folded) = self.fold_string_call(helper, &args, &ty, &origin) {
            return Ok(folded);
        }
        // A count `repeat` will not accept throws before the helper is
        // reached. See `guard_repeat_count`.
        if helper == "nts_str_repeat" && args.len() == 2 {
            self.guard_repeat_count(id, args[1])?;
        }

        self.fill_string_arguments((id, name.as_str()), helper, arity, &mut args, &origin)?;

        // A regular expression is a pattern `String.prototype.replace` accepts
        // and this does not. It has to be named and refused *here*: everything
        // below spells a call handing a `NtsString *` to the runtime, so a
        // `RegExp` arriving at it is a wrong answer rather than a type error.
        if matches!(helper, "nts_str_replace" | "nts_str_replace_all")
            && args[1..].iter().any(|value| {
                self.values[value.0 as usize].ty != HirType::Managed(ManagedType::String)
            })
        {
            return Err(self.unsupported(id, "`replace` with a pattern that is not a string"));
        }

        // `codePointAt` answers **`undefined`** for an index that is not there
        // and the helper answers NaN, which is not the same value: `?? 0` takes
        // the one and not the other, and `String(v)` is `"undefined"` against
        // `"NaN"`. Every out-of-range case disagreed with node, silently.
        //
        // Its sibling `charCodeAt` answers NaN and is **right** to, which is why
        // this lasted: the helper is written in terms of that one, and the
        // sibling's answer reads as a precedent for it. They are different
        // questions with different answers, exactly as `at`, `charAt` and `s[i]`
        // are three answers for an index that is not there.
        //
        // Only where the result is erased -- where the caller has not narrowed
        // it away with a guard, or with a `!` its consumer converts
        // (`claimed_reads::read_as_number`) -- so a program that promised the
        // index was there pays nothing. That is the rule `pop` and `at`
        // already follow.
        if helper == "nts_str_code_point_at"
            && self.type_of(id) == Some(HirType::Erased)
            && !claimed_reads::read_as_number(self, id)
        {
            let value = self.push(
                OpKind::Call {
                    callee: Callee::External(helper.to_owned()),
                    args,
                    frame: None,
                },
                ty,
                origin.clone(),
            );
            return Ok(self.code_point_or_undefined(value, &origin));
        }

        Ok(self.push(
            OpKind::Call {
                callee: Callee::External(helper.to_owned()),
                args,
                frame: None,
            },
            ty,
            origin,
        ))
    }

    /// A code point, or `undefined` where the helper answered NaN.
    ///
    /// **NaN is not a code point**, so a number-returning helper can carry the
    /// absence after all and no second helper is needed for it — which means C,
    /// LLVM and the JVM all get this the day it lands rather than two of them
    /// getting it and the third red-gating while it catches up.
    ///
    /// `v !== v` is true of NaN and of nothing else.
    fn code_point_or_undefined(&mut self, value: ValueId, origin: &Origin) -> ValueId {
        let absent = self.push(
            OpKind::Binary {
                op: BinOp::Ne,
                lhs: value,
                rhs: value,
            },
            HirType::Bool,
            origin.clone(),
        );
        let missing = self.new_block();
        let present = self.new_block();
        let merge = self.new_block();
        let answer = self.push_block_param(merge, HirType::Erased, origin.clone());
        self.terminate(Terminator::Branch {
            cond: absent,
            then_target: missing,
            then_args: Vec::new(),
            else_target: present,
            else_args: Vec::new(),
        });
        self.switch_to(missing);
        let undefined = self.push(OpKind::ConstUndefined, HirType::Erased, origin.clone());
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![undefined],
        });
        self.switch_to(present);
        let erased = self.push(
            OpKind::Erase {
                value,
                absent: Absent::Impossible,
                slots: Absent::Impossible,
            },
            HirType::Erased,
            origin.clone(),
        );
        self.terminate(Terminator::Jump {
            target: merge,
            args: vec![erased],
        });
        self.switch_to(merge);
        answer
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

/// The `Math` member a name spells.
fn math_member(member: &str) -> Option<Intrinsic> {
    Some(match member {
        "floor" => Intrinsic::Unary(UnOp::Floor),
        "ceil" => Intrinsic::Unary(UnOp::Ceil),
        "trunc" => Intrinsic::Unary(UnOp::Trunc),
        "round" => Intrinsic::Unary(UnOp::Round),
        "abs" => Intrinsic::Unary(UnOp::Abs),
        "sqrt" => Intrinsic::Unary(UnOp::Sqrt),
        "min" => Intrinsic::Binary(BinOp::Min),
        "max" => Intrinsic::Binary(BinOp::Max),
        "pow" => Intrinsic::BinaryCall("nts_math_pow"),
        "atan2" => Intrinsic::BinaryCall("nts_math_atan2"),
        "hypot" => Intrinsic::BinaryCall("nts_math_hypot"),
        // Exact, so not `APPROXIMATED`: the 32-bit multiply every string hash
        // (FNV, Murmur) is written with.
        "imul" => Intrinsic::BinaryCall("nts_math_imul"),
        "sign" => Intrinsic::UnaryCall("nts_math_sign"),
        "fround" => Intrinsic::UnaryCall("nts_math_fround"),
        "cbrt" => Intrinsic::UnaryCall("nts_math_cbrt"),
        "exp" => Intrinsic::UnaryCall("nts_math_exp"),
        "expm1" => Intrinsic::UnaryCall("nts_math_expm1"),
        "log" => Intrinsic::UnaryCall("nts_math_log"),
        "log2" => Intrinsic::UnaryCall("nts_math_log2"),
        "log10" => Intrinsic::UnaryCall("nts_math_log10"),
        "log1p" => Intrinsic::UnaryCall("nts_math_log1p"),
        "sin" => Intrinsic::UnaryCall("nts_math_sin"),
        "cos" => Intrinsic::UnaryCall("nts_math_cos"),
        "tan" => Intrinsic::UnaryCall("nts_math_tan"),
        "asin" => Intrinsic::UnaryCall("nts_math_asin"),
        "acos" => Intrinsic::UnaryCall("nts_math_acos"),
        "atan" => Intrinsic::UnaryCall("nts_math_atan"),
        "sinh" => Intrinsic::UnaryCall("nts_math_sinh"),
        "cosh" => Intrinsic::UnaryCall("nts_math_cosh"),
        "tanh" => Intrinsic::UnaryCall("nts_math_tanh"),
        // `Math.random` is absent on purpose: it is the one member of this
        // family that no differential can check, because two runs of the
        // same program disagree by design.
        _ => return None,
    })
}

/// Primitive conversions and symbol creation. Initialization analysis uses the
/// same classification as lowering; with primitive inputs none calls user code.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PrimitiveBuiltin {
    Symbol,
    String,
    Boolean,
    Number,
    BigInt,
}

fn primitive_builtin(name: &str) -> Option<PrimitiveBuiltin> {
    match name {
        "Symbol" => Some(PrimitiveBuiltin::Symbol),
        "String" => Some(PrimitiveBuiltin::String),
        "Boolean" => Some(PrimitiveBuiltin::Boolean),
        "Number" => Some(PrimitiveBuiltin::Number),
        "BigInt" => Some(PrimitiveBuiltin::BigInt),
        _ => None,
    }
}

/// The global function a name spells, for the two that are numeric predicates.
fn global_predicate(name: &str) -> Option<Intrinsic> {
    Some(match name {
        "isNaN" => Intrinsic::NotANumber,
        "isFinite" => Intrinsic::UnaryCall("nts_is_finite"),
        _ => return None,
    })
}

/// The value a namespace's named constant holds.
///
/// `Math` and `Number` between them, because both are namespaces of numbers
/// with no representation of their own, and the lowering asks the same question
/// of each.
fn named_constant(namespace: &str, name: &str) -> Option<f64> {
    match namespace {
        "Math" => math_constant(name),
        "Number" => number_constant(name),
        _ => None,
    }
}

/// The value `Number`'s named constants hold.
///
/// The specification gives each as an exact `double`, so these are values and
/// not approximations -- `EPSILON` is 2^-52 and `MAX_SAFE_INTEGER` is 2^53 - 1,
/// both exactly representable. `Number.NaN` is here as well: it is a constant
/// like the rest, and the global `NaN` is the same value under a shorter name.
fn number_constant(name: &str) -> Option<f64> {
    Some(match name {
        "MAX_SAFE_INTEGER" => 9_007_199_254_740_991.0,
        "MIN_SAFE_INTEGER" => -9_007_199_254_740_991.0,
        "MAX_VALUE" => f64::MAX,
        // The smallest *subnormal*, which is what the specification says and is
        // not `f64::MIN_POSITIVE` -- that is the smallest normal, 2^-1022,
        // where this is 2^-1074. Four orders of magnitude apart in the exponent.
        "MIN_VALUE" => f64::from_bits(1),
        "EPSILON" => f64::EPSILON,
        "POSITIVE_INFINITY" => f64::INFINITY,
        "NEGATIVE_INFINITY" => f64::NEG_INFINITY,
        "NaN" => f64::NAN,
        _ => return None,
    })
}

/// The value `Math`'s named constants hold.
///
/// Spelled out rather than computed, because the specification gives each one
/// as the `double` nearest a mathematical constant and `M_PI` and friends are
/// not guaranteed to be that -- they are a POSIX extension, not C, and their
/// precision is the implementation's business. These are the digits node
/// prints.
fn math_constant(name: &str) -> Option<f64> {
    Some(match name {
        "PI" => std::f64::consts::PI,
        "E" => std::f64::consts::E,
        "LN2" => std::f64::consts::LN_2,
        "LN10" => std::f64::consts::LN_10,
        "LOG2E" => std::f64::consts::LOG2_E,
        "LOG10E" => std::f64::consts::LOG10_E,
        "SQRT2" => std::f64::consts::SQRT_2,
        "SQRT1_2" => std::f64::consts::FRAC_1_SQRT_2,
        _ => return None,
    })
}

/// A `Math` member the compiler implements directly.
#[derive(Debug, Clone, Copy)]
enum Intrinsic {
    Unary(UnOp),
    Binary(BinOp),
    /// A one-argument call into the runtime, named here.
    UnaryCall(&'static str),
    /// A two-argument call into the runtime, named here.
    BinaryCall(&'static str),
    /// `Number.isNaN`, which is `x != x` rather than a call.
    ///
    /// Free, and it folds away entirely where the specializer has narrowed the
    /// operand to an integer -- which cannot be NaN, so the comparison is a
    /// constant `false` that the C compiler removes. A runtime call would have
    /// pinned the value to a `double` to pass it.
    NotANumber,
}

/// A branch target and the arguments its block takes: what [`FuncBuilder::lower_jumps`]
/// sends each test's outcome to.
type JumpTarget<'a> = (BlockId, &'a [ValueId]);

/// A natively represented thing an erased value can be, for the one question
/// `in` asks of it: does something of this shape declare the name.
///
/// Each variant is a test the runtime already performs for `instanceof`, which
/// is why the list is these eight and not a kind enum: a kind the compiler
/// cannot name is a kind it cannot answer for, and a variant here that no
/// `natives_declaring` entry mentions would be dead rather than conservative.
#[derive(Clone, Copy)]
enum Native {
    /// An array or a tuple. One `nts_is_array`, which accepts both because the
    /// language calls a tuple an Array.
    Array,
    /// A typed array or a `DataView`.
    View,
    /// A typed array and not a `DataView`, which is `View` minus one test.
    TypedArray,
    ArrayBuffer,
    Map,
    Set,
    Promise,
    /// Not a descriptor at all: a closure's erased form carries its own tag.
    Function,
}

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
mod destructuring;
mod diagnostics;
mod elision_patterns;
mod equality;
mod exceptions;
mod expression_types;
mod field_initialization;
mod function_names;
mod generator_iteration;
mod generic_copies;
mod gobject;
mod hierarchy;
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
mod native_memory;
mod native_modules;
mod numeric_arguments;
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
mod string_positions;
mod structural_copies;
mod suspended_bodies;
mod table_methods;
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

/// A foreign function the compiler calls on its own account -- a C function,
/// or an Objective-C message when `send` is one -- rather than one a binding
/// declares: plain arguments, nothing retained or lent, owning nothing.
fn synthesized(
    name: &str,
    parameters: Vec<super::native::Type>,
    result: super::native::Type,
    send: Option<super::native::Send>,
    frameworks: Vec<String>,
) -> super::native::Function {
    super::native::Function {
        thunk: None,
        name: name.to_owned(),
        convention: super::native::Convention::C,
        retention: vec![super::native::Retention::Unknown; parameters.len()],
        roles: vec![super::native::Role::Plain; parameters.len()],
        parameters,
        result,
        variadic: None,
        declared_at: None,
        returns_string: None,
        returns_array: None,
        returns_dictionary: None,
        returns_set: None,
        send,
        returns_owned: false,
        consumes: Vec::new(),
        frameworks,
        libraries: Vec::new(),
        defaults: Vec::new(),
        result_as: None,
        vtable: None,
        hresult: false,
        result_as_number: false,
    }
}

/// A message the lowering makes itself -- a bridge's `alloc`, `count`,
/// `addObject:` -- with the ownership ARC's method families give it, as
/// `native_callee_with` gives a declared one: a pointer from `alloc`, `init`,
/// `new` or `copy` is the caller's, and `init` consumes its receiver.
fn bridge_send(
    selector: &str,
    class: Option<&str>,
    parameters: Vec<super::native::Type>,
    result: super::native::Type,
) -> super::native::Function {
    let send = super::native::Send {
        selector: selector.to_owned(),
        class: class.map(str::to_owned),
        super_of: None,
    };
    let pointer = matches!(result, super::native::Type::Pointer(_));
    let mut message = synthesized(
        selector,
        parameters,
        result,
        Some(send),
        vec!["Foundation".to_owned()],
    );
    message.returns_owned = pointer && super::native::Send::returns_owned(selector);
    if class.is_none() && super::native::Send::consumes_receiver(selector) {
        message.consumes = vec![0];
    }
    message
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

/// Which strings a call bridges to `NSString`s: see [`bridge_strings`].
#[derive(Clone, Copy, PartialEq, Eq)]
enum StringsBridged {
    /// A message's: a plain `string`, or a `BridgedString`.
    Plain,
    /// A C function's: a `BridgedString` only.
    Branded,
}

/// Swift's `String` at an Objective-C message: a plain `string` parameter is
/// an `NSString` (`Role::NSString`), and a plain `string` result is one the
/// program reads back as text. A `CString` stays a C string, and so does
/// what a C function takes -- unless its binding says `BridgedString`, where
/// the header's type is `NSString *`.
fn bridge_strings(
    native: &mut super::native::Function,
    signature: &nts_semantic_schema::SignatureRecord,
    snapshot: &SemanticSnapshot,
    which: StringsBridged,
) {
    let kind = |id: TypeId| snapshot.types.get(id.0 as usize).map(|record| &record.kind);
    let branded = |id: TypeId| {
        match kind(id) {
        Some(TypeKind::Intersection(parts)) => parts.iter().any(|part| {
            matches!(kind(*part), Some(TypeKind::Object { properties }) if properties.iter().any(|p| p.name.is_name("__objc_nsstring")))
        }),
        _ => false,
    }
    };
    let text = |id: TypeId| match which {
        StringsBridged::Plain => matches!(kind(id), Some(TypeKind::String)) || branded(id),
        StringsBridged::Branded => branded(id),
    };
    let plain = |ty: TypeId| match kind(ty) {
        Some(TypeKind::Union(parts)) => {
            parts.iter().any(|part| text(*part))
                && parts
                    .iter()
                    .all(|part| text(*part) || matches!(kind(*part), Some(TypeKind::Null)))
        }
        _ => text(ty),
    };
    let utf8 = super::native::Role::String(super::native::Encoding::Utf8);
    let ns_string = super::native::Type::Pointer(super::native::Pointee::Opaque(
        super::native::Handle::ns_string(),
    ));
    let slots: Vec<(usize, Option<usize>)> = native.slots().map(|(at, _, fed)| (at, fed)).collect();
    for (at, fed) in slots {
        let Some(parameter) = fed.and_then(|ts| signature.parameters.get(ts)) else {
            continue;
        };
        match &mut native.roles[at] {
            role if *role == utf8 && plain(parameter.ty) => {
                *role = super::native::Role::NSString;
                native.parameters[at] = ns_string.clone();
            }
            // A label is the property of the parameter's object type that
            // its key names, and crosses as that property's type says.
            super::native::Role::Label { key, inner, .. } if **inner == utf8 => {
                let key = key.clone();
                let label = super::native::labels_of(snapshot, parameter.ty)
                    .and_then(|labels| labels.into_iter().find(|(named, _)| *named == key));
                if label.is_some_and(|(_, ty)| plain(ty)) {
                    **inner = super::native::Role::NSString;
                    native.parameters[at] = ns_string.clone();
                }
            }
            _ => {}
        }
    }
    if native
        .returns_string
        .as_ref()
        .is_some_and(|returned| !returned.array)
        && plain(signature.return_type)
    {
        native.result = super::native::Type::Pointer(super::native::Pointee::Opaque(
            super::native::Handle::ns_string(),
        ));
    }
    // A message's `string[]` is Swift's `[String]`, an `NSArray` of
    // `NSString`s, where a C function's is a NULL-terminated `char **`.
    if which == StringsBridged::Plain
        && native
            .returns_string
            .as_ref()
            .is_some_and(|returned| returned.array)
    {
        native.returns_string = None;
        native.returns_array = Some(super::native::Bridged::String);
        native.result = super::native::Type::Pointer(super::native::Pointee::Opaque(
            super::native::Handle::objc("NSArray"),
        ));
    }
}

/// Whether a declaration names another way to be called: a C symbol
/// (`@ntsSymbol`) or an Objective-C message (`@ntsSelector`).
fn symbol_tagged(lowerer: &FuncBuilder<'_>, decl: NodeId) -> bool {
    lowerer
        .node(decl)
        .native
        .as_ref()
        .is_some_and(|n| n.symbol.is_some() || n.selector.is_some())
}

#[cfg(test)]
mod immutable_context_tests;

#[cfg(test)]
mod context_scaling;
