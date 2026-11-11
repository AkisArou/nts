//! Structural body copies from argument storage and retyped symbols.

use super::{
    FuncBuilder, Hierarchy, HirType, LoweringSnapshot, ManagedType, NodeId, Settled, TypeId,
    TypeKind, admits_absence, children_in_the_body_of, children_that_run, declares_a_class,
    erased_calls, is_generic_function, literal_methods, syntax,
};

/// Copies of ordinary functions specialised to the concrete type an argument
/// actually has.
///
/// # The construct
///
/// ```text
/// class Thing  { id: number; name: string }   name at offset 32
/// interface Named { name: string }            name at offset 24
/// function readName(v: Named) { return v.name.length }
/// readName(new Thing(1))
/// ```
///
/// A compiled reference is a pointer, so passing a `Thing` where a `Named` is
/// wanted is a pointer cast — and it is only sound where the target's fields are
/// the source's first fields, which `laid_out_as_a_prefix` decides. Here they are
/// not, so `readName` would load `id` as an `NtsString *`. That was a **segfault**
/// before it was a refusal.
///
/// A copy of `readName` over `Thing` reads `name` at *Thing's* offset. No cast,
/// no dispatch, nothing to be wrong about.
///
/// # Why specialising, and not laying the interface out like its implementor
///
/// Reordering an interface's fields to match its one implementor would make the
/// cast a genuine prefix and need no copies at all — and it fixes two backends of
/// three. **A prefix buys the JVM nothing**: that lane relates classes by name,
/// so coinciding offsets are not a relation and `getfield Counted.n` still needs
/// the object to *be* a `Counted`. It also needs the complete set of classes
/// satisfying each interface, which the snapshot does not carry.
///
/// And on ART, where that lane's product actually runs, there is no inline cache:
/// a monomorphic interface call costs 1.97x a direct read rather than 1.04x. So
/// specialisation is not "make dispatch predictable" — worth nothing at a site
/// that is already monomorphic — it is **remove dispatch**, worth about half the
/// call there. Record 0294.
///
/// # What this deliberately does not do
///
/// Only where the argument's concrete type is known at the call. A value read out
/// of a field declared at the interface type has no concrete type to specialise
/// over, and stays refused — that is the quarter of this construct that needs an
/// interface to have a representation, and it is a different piece of work.
/// Which parameters a copy re-types, by position.
///
/// **By position, not by type**, and the difference is the whole of why the
/// first attempt was thrown away. Binding the interface's `TypeId` in a
/// `Substitution` -- which is what a generic copy does with a type parameter --
/// makes *every* mention of `Named` in that body mean `Thing`, including a local
/// declared `const other: Named = somethingElse`. A type parameter is only ever
/// inhabited by what it was substituted with, so a generic can do that soundly.
/// An interface is an ordinary type and other values of it live in the same
/// function.
///
/// Seven of twenty-four addons stopped building on that, with refusals like
/// ``null` or `undefined` where what it stands in for is not a reference`` --
/// which name a consequence several steps downstream of the cause.
///
/// A position is exactly as much as the copy changes.
pub(super) type Retyped = std::collections::BTreeMap<u32, HirType>;

#[derive(Default)]
pub(super) struct Structural {
    /// Copies to emit, by declaration node.
    pub(super) copies: rustc_hash::FxHashMap<NodeId, Vec<(Retyped, String)>>,
    /// What each call site names, and which parameters its callee's copy
    /// re-typed — the second half is what the *caller* needs, so it coerces its
    /// argument to the copy's parameter rather than the declaration's.
    ///
    /// **Per enclosing copy.** The outer key is the suffix of the copy the call
    /// is lowered *in* -- `""` for the original -- because the same call node
    /// answers differently in different copies: `inner(s)` inside `outer`
    /// passes a `Named` in the original and a `Thing` in `outer`'s copy over
    /// `Thing`. A builder takes the original's answers and lets its own copy's
    /// override them. Keyed by suffix rather than by (declaration, suffix)
    /// because a call node lives in exactly one function, so two functions'
    /// copies sharing a suffix cannot collide in the inner map.
    pub(super) at_call:
        rustc_hash::FxHashMap<String, rustc_hash::FxHashMap<NodeId, (String, Retyped)>>,
    /// Erased-triggered source copies, independent of their exception mode.
    pub(super) erased_copies: rustc_hash::FxHashSet<(NodeId, String)>,
    /// The subset that can carry exceptions in their own representation context.
    pub(super) raising: rustc_hash::FxHashSet<(NodeId, String)>,
    /// Constructor copies over a union member (`union_member_retype`), which
    /// are lowered beside their class and named at each `new` and
    /// `super(...)` that passes that member.
    pub(super) constructions: rustc_hash::FxHashSet<(NodeId, String)>,
    /// The positions each copy re-types to a union member, which decide the
    /// `typeof` tests on them (`FuncBuilder::decided_typeof`).
    members: rustc_hash::FxHashMap<(NodeId, String), Retyped>,
    /// Implementations with a union parameter that has no representation and
    /// that something reaches as declared: a site passing a union, a reference
    /// that is not a call, an export. The others are lowered as their copies
    /// alone, as an uninstantiated generic is lowered as none.
    declared_reached: rustc_hash::FxHashSet<NodeId>,
}

impl Structural {
    /// Whether `declaration` is lowered as written as well as as its copies.
    pub(super) fn lowers_as_declared(&self, declaration: NodeId) -> bool {
        !self
            .members
            .keys()
            .any(|(copied, _)| *copied == declaration)
            || self.declared_reached.contains(&declaration)
    }
}

/// Borrowed layers in the same precedence order as call planning. Selecting a
/// body must not copy every call in the program into that body's builder.
#[derive(Default)]
pub(super) struct CallContext<'a> {
    pub(super) generic: Option<&'a rustc_hash::FxHashMap<NodeId, String>>,
    pub(super) structural: Option<&'a Structural>,
    original: Option<&'a rustc_hash::FxHashMap<NodeId, (String, Retyped)>>,
    within: Option<&'a rustc_hash::FxHashMap<NodeId, (String, Retyped)>>,
    pub(super) class: Option<&'a rustc_hash::FxHashMap<NodeId, String>>,
    pub(super) function: Option<&'a rustc_hash::FxHashMap<NodeId, String>>,
}

impl<'a> CallContext<'a> {
    pub(super) fn structural(&self, call: NodeId) -> Option<&'a (String, Retyped)> {
        self.within
            .and_then(|calls| calls.get(&call))
            .or_else(|| self.original.and_then(|calls| calls.get(&call)))
    }

    pub(super) fn suffix(&self, call: NodeId) -> Option<&'a String> {
        self.function
            .and_then(|calls| calls.get(&call))
            .or_else(|| self.class.and_then(|calls| calls.get(&call)))
            .or_else(|| self.structural(call).map(|(suffix, _)| suffix))
            .or_else(|| self.generic.and_then(|calls| calls.get(&call)))
    }
}

impl Structural {
    pub(super) fn wire_calls<'a>(&'a self, builder: &mut FuncBuilder<'a>, suffix: &str) {
        builder.calls.structural = Some(self);
        builder.calls.original = self.at_call.get("");
        builder.calls.within = self.at_call.get(suffix);
    }
}

/// The parameter symbols, and their `const` aliases, a copy re-typed to a union
/// member ([`Structural::members`]).
pub(super) fn member_symbols(
    probe: &FuncBuilder,
    structural: &Structural,
    declaration: NodeId,
    suffix: &str,
) -> rustc_hash::FxHashSet<u32> {
    structural
        .members
        .get(&(declaration, suffix.to_owned()))
        .map(|members| {
            retyped_symbols_of(probe, declaration, members)
                .into_keys()
                .collect()
        })
        .unwrap_or_default()
}

/// The declaration a call's structural copy is planned for: the function the
/// call names as call lowering resolves it (`FuncBuilder::direct_callee`), not
/// always the checker's callee.
///
/// They differ for a call through a `const` holding a function: the checker
/// resolves `boxIdentity(box)` with `const boxIdentity: (value: Box) => Box =
/// identity` to the *annotation*, a signature with no body, while the call
/// names `identity`. Planned against the annotation, the call was given a copy
/// `identity@0obj6` that nothing builds -- a signature is never copied -- and
/// `wire_calls` let that suffix override the generic pin the call needed
/// (`identity<value-obj4@4>`): "nothing in this program defines" it. Planned
/// against `identity`, a generic function, the structural planner stands back
/// as it does for every generic callee, and a plain function gets a copy that
/// is actually lowered.
///
/// A `new` of a source class and a `super(...)` are planned against the
/// constructor lowering runs (`referenced_constructor`, `super_constructor`),
/// for the same reason: through `const C: new (n: number) => Sized = Sized`,
/// the checker resolves `new C(n)` to the annotation's signature, and the site,
/// unplanned, called a declared constructor lowered only as its copies.
pub(super) fn planned_callee(probe: &FuncBuilder, call: NodeId) -> Option<NodeId> {
    let constructor = match probe.kind_of(call) {
        Some(syntax::NEW_EXPRESSION) => probe.referenced_constructor(call),
        Some(syntax::CALL_EXPRESSION)
            if probe
                .children(call)
                .first()
                .is_some_and(|callee| probe.kind_of(*callee) == Some(syntax::SUPER_KEYWORD)) =>
        {
            probe.super_constructor(call)
        }
        _ => None,
    };
    if constructor.is_some() {
        return constructor;
    }
    let checker = probe.snapshot.call_targets.get(&call)?.callee?;
    let named = probe
        .children(call)
        .first()
        .filter(|callee| probe.kind_of(**callee) == Some(syntax::IDENTIFIER))
        .and_then(|callee| probe.node(*callee).symbol)
        .and_then(|symbol| match probe.initializer_settles(symbol.0) {
            Settled::Names(declaration) => Some(declaration),
            Settled::Unsettled | Settled::NotAVariable => None,
        });
    Some(named.unwrap_or(checker))
}

/// A copy whose body has yet to be walked for the calls it makes.
struct PendingCopy {
    declaration: NodeId,
    retyped: Retyped,
    suffix: String,
}

struct StructuralPlanner<'a, 's> {
    probe: &'a FuncBuilder<'s>,
    found: Structural,
    pending: Vec<PendingCopy>,
    erased: erased_calls::ClosedParameters,
    erased_copies: rustc_hash::FxHashMap<NodeId, rustc_hash::FxHashSet<String>>,
}

pub(super) fn structural_instantiations(
    snapshot: &LoweringSnapshot<'_>,
    hierarchy: &Hierarchy,
) -> Structural {
    let mut probe = FuncBuilder::probe(snapshot);
    probe.hierarchy = hierarchy;

    // Every call in the program, in the original's context: an argument's type
    // is what the checker says it is.
    let mut calls: Vec<(NodeId, NodeId)> = snapshot
        .call_targets
        .keys()
        .filter_map(|call| Some((*call, planned_callee(&probe, *call)?)))
        .collect();
    calls.sort_by_key(|(call, _)| call.0);
    let mut planner = StructuralPlanner {
        probe: &probe,
        found: Structural::default(),
        pending: Vec::new(),
        erased: erased_calls::ClosedParameters::collect(&probe),
        erased_copies: rustc_hash::FxHashMap::default(),
    };
    let original = std::collections::BTreeMap::new();
    for (call, callee) in &calls {
        let actual = |argument: NodeId| snapshot.node_types.get(&argument).copied();
        planner.record_call("", *call, *callee, actual, |argument| {
            erased_calls::produced(&probe, argument, &original, 0)
        });
    }

    // **Then every copy, to a fixpoint.** A copy re-types a parameter, and a
    // call in its body that passes that parameter on hands the callee the
    // concrete type -- which the original's walk above cannot see, because
    // the checker still says `Named` there. Without this, `outer`'s copy over
    // `Thing` called the *original* `inner` with a `Thing`, and `coerce`
    // refused the cast the copy exists to avoid: `runtime/node/stream` is
    // chains of exactly this shape, `onWritableConstructed(stream)` handing
    // `stream` to `clearBuffer`, `finishMaybe`, `errorOrDestroy`. A parameter
    // passed as itself, or a `const` alias of one, carries the copy's type
    // (`retyped_symbols_of`); a `let`, a field read, or a call result is what
    // the checker says, as in the original.
    // Each copy is walked once, so this ends: the set of copies is bounded by
    // the concrete types the program has.
    while let Some(copy) = planner.pending.pop() {
        let symbols = retyped_symbols_of(&probe, copy.declaration, &copy.retyped);
        for call in calls_in_the_body_of(&probe, copy.declaration) {
            let Some(callee) = planned_callee(&probe, call) else {
                continue;
            };
            let actual = |argument: NodeId| {
                let as_retyped = probe
                    .node(argument)
                    .symbol
                    .filter(|_| probe.kind_of(argument) == Some(syntax::IDENTIFIER))
                    .and_then(|symbol| symbols.get(&symbol.0))
                    .and_then(|ty| match ty {
                        HirType::Managed(ManagedType::Object(have)) => Some(*have),
                        _ => None,
                    });
                as_retyped.or_else(|| snapshot.node_types.get(&argument).copied())
            };
            planner.record_call(&copy.suffix, call, callee, actual, |argument| {
                erased_calls::produced(&probe, argument, &symbols, 0)
            });
        }
    }
    for copies in planner.found.copies.values_mut() {
        copies.sort_by(|a, b| a.1.cmp(&b.1));
    }
    let copied: Vec<NodeId> = planner
        .found
        .members
        .keys()
        .map(|(declaration, _)| *declaration)
        .collect();
    for declaration in copied {
        if reached_beyond_its_calls(&probe, declaration) {
            planner.found.declared_reached.insert(declaration);
        }
    }
    planner.found.erased_copies = planner
        .erased_copies
        .into_iter()
        .flat_map(|(declaration, suffixes)| {
            suffixes
                .into_iter()
                .map(move |suffix| (declaration, suffix))
        })
        .collect();
    planner.found
}

/// The signature a call is planned against, and whether only a copy over a
/// union member may be made of it. A constructor's node carries its class
/// rather than a signature, so a `new` or `super(...)` is planned from the
/// signature it resolved to, and only for such a copy.
fn planned_signature<'s>(
    probe: &FuncBuilder<'s>,
    call: NodeId,
    callee: NodeId,
) -> Option<(&'s nts_semantic_schema::SignatureRecord, bool)> {
    let snapshot = probe.snapshot;
    if let Some(declared) = crate::hir::generics::declared_signature(snapshot, callee) {
        return Some((declared, false));
    }
    if probe.kind_of(callee) != Some(syntax::CONSTRUCTOR) {
        return None;
    }
    let target = snapshot.call_targets.get(&call)?;
    Some((snapshot.signatures.get(target.signature.0 as usize)?, true))
}

/// Whether an implementation declares a parameter whose union has no
/// representation of its own: one only its copies over a member compile.
fn has_a_union_without_representation(probe: &FuncBuilder, implementation: NodeId) -> bool {
    probe.has_a_body(implementation)
        && probe
            .parameters_declared_by(implementation)
            .iter()
            .any(|(declared, _, rest)| {
                !rest
                    && declared.is_some_and(|ty| {
                        matches!(
                            probe
                                .snapshot
                                .types
                                .get(ty.0 as usize)
                                .map(|record| &record.kind),
                            Some(TypeKind::Union(_))
                        ) && probe.represent(ty).is_none()
                    })
            })
}

/// Whether a declaration with copies over union members is reached other than
/// by the calls `record_call` planned. By identity: a module exports the
/// symbol naming it (the export table holds every form -- a modifier, `export
/// { }`, `export default`, `export =`; a constructor is named by its class), or,
/// for a function, an identifier denoting it is not a call's callee. A
/// shorthand `{ size }` carries the property's own symbol, and the value it
/// reads is resolved by name in scope (`shorthand_value_symbol`), which the
/// snapshot does not record: any shorthand spelling the name counts as a
/// reach, which can keep a declaration nothing needs but never drops one
/// something does.
fn reached_beyond_its_calls(probe: &FuncBuilder, declaration: NodeId) -> bool {
    let constructor = probe.kind_of(declaration) == Some(syntax::CONSTRUCTOR);
    let mut owner = declaration;
    while constructor && !probe.kind_of(owner).is_some_and(declares_a_class) {
        let Some(parent) = probe.node(owner).parent else {
            return true;
        };
        owner = parent;
    }
    let Some(name) = probe.name_node(owner) else {
        return true;
    };
    let Some(symbol) = probe
        .node(name)
        .symbol
        .map(|symbol| probe.denoted_symbol(symbol))
    else {
        return true;
    };
    let exported = probe.snapshot.modules.iter().any(|module| {
        module
            .exports
            .iter()
            .any(|(_, exported)| probe.denoted_symbol(*exported) == symbol)
    });
    if exported {
        return true;
    }
    // A constructor runs only by `new` and `super(...)`, which are planned.
    if constructor {
        return false;
    }
    let spelled = probe.node(name).text.clone();
    // Its overload signatures name it too, and are not uses.
    let names: Vec<NodeId> = probe
        .snapshot
        .symbols
        .get(symbol.0 as usize)
        .map(|record| {
            record
                .declarations
                .iter()
                .filter_map(|at| probe.name_node(*at))
                .collect()
        })
        .unwrap_or_default();
    (0..probe.snapshot.nodes.len()).any(|at| {
        let Ok(at) = u32::try_from(at).map(NodeId) else {
            return false;
        };
        match probe.kind_of(at) {
            Some(syntax::SHORTHAND_PROPERTY_ASSIGNMENT) => probe
                .children(at)
                .first()
                .is_some_and(|key| spelled.is_some() && probe.node(*key).text == spelled),
            Some(syntax::IDENTIFIER) if at != name && !names.contains(&at) => {
                probe.node(at).symbol.map(|it| probe.denoted_symbol(it)) == Some(symbol)
                    && !probe.node(at).parent.is_some_and(|parent| {
                        probe.kind_of(parent) == Some(syntax::CALL_EXPRESSION)
                            && probe.children(parent).first() == Some(&at)
                    })
            }
            _ => false,
        }
    })
}

/// The union members a call passes, by position, each with its spelling
/// (`union_member_retype`). A copy over union members is made where some
/// parameter whose union has no representation receives one member; it then
/// takes every union parameter at the member its argument is, one copy per
/// tuple. Empty otherwise, and for a spread, whose positions are not the
/// parameters'. Against the implementation's own parameters, the body a copy
/// is made of; an optional one its site passes is re-typed like any other,
/// since only sites passing it name the copy.
fn member_retypes(
    probe: &FuncBuilder,
    implementation: NodeId,
    arguments: &[NodeId],
    actual: &impl Fn(NodeId) -> Option<TypeId>,
) -> std::collections::BTreeMap<u32, (HirType, String)> {
    let applies = probe.has_a_body(implementation)
        && crate::hir::generics::declared_signature(probe.snapshot, implementation)
            .is_none_or(|signature| signature.this_type.is_none())
        && !arguments
            .iter()
            .any(|argument| probe.kind_of(*argument) == Some(syntax::SPREAD_ELEMENT));
    if !applies {
        return std::collections::BTreeMap::new();
    }
    let implemented = probe.parameters_declared_by(implementation);
    let mut needed = false;
    let members = arguments
        .iter()
        .enumerate()
        .filter_map(|(at, argument)| {
            let Some((Some(union), _, false)) = implemented.get(at).copied() else {
                return None;
            };
            let (ty, spelling) = union_member_retype(probe, union, actual(*argument)?)?;
            needed |= probe.represent(union).is_none();
            Some((u32::try_from(at).ok()?, (ty, format!("{at}{spelling}"))))
        })
        .collect();
    if needed {
        members
    } else {
        std::collections::BTreeMap::new()
    }
}

/// A parameter declared as a union, re-typed to the one member its argument is:
/// `new Buffer(size)` with `value: number | string | ArrayBuffer |
/// ArrayLike<number>` copies the constructor over a number. Proved by the
/// argument's own type having a concrete representation, so a site whose
/// argument is itself a union, an absence among its members included, keeps
/// the declared parameter and its refusal.
/// `record_call` makes such a copy only where some parameter's union has no
/// representation, and then over every union parameter's member. In the copy,
/// the `typeof` tests the member decides are folded (`decided_typeof`), so the
/// other members' branches are never lowered.
fn union_member_retype(
    probe: &FuncBuilder,
    declared: TypeId,
    actual: TypeId,
) -> Option<(HirType, String)> {
    if !matches!(
        probe.snapshot.types.get(declared.0 as usize)?.kind,
        TypeKind::Union(_)
    ) || crate::hir::instantiate::mentions_a_parameter(probe.snapshot, actual)
        // `string | undefined` represents as the string alone, its absence a
        // null pointer: still a union, so the site keeps the declaration.
        || admits_absence(probe.snapshot, actual)
    {
        return None;
    }
    let member = probe.represent(actual)?;
    if matches!(member, HirType::Erased | HirType::Void | HirType::Never) {
        return None;
    }
    let spelling = match &member {
        HirType::Managed(ManagedType::Array(element)) => {
            format!("uarr{}", crate::hir::generics::spell(element))
        }
        other => format!("u{}", crate::hir::generics::spell(other)),
    };
    Some((member, spelling))
}

/// Whether a callee is copied with one parameter re-typed to what its argument
/// actually is, and to what: the re-typed representation and the copy name's
/// spelling of it. `None` keeps the declared parameter.
///
/// **One decision, whatever triggers it.** An object passed where another
/// object type is declared, and an array where a record is declared, are two
/// triggers of the same transform -- and a third (an `any` parameter pinned by
/// its call sites) is the next one, which is why this is a function and not a
/// second arm at the call.
///
/// It does not ask what `monomorphize` asks, and that is deliberate. That pass
/// re-types a parameter of HIR already lowered, so it refuses one that is
/// "stored, returned or passed on": everything downstream would need re-typing
/// too. A copy here is *lowered again from source* with the parameter's new
/// type, so each downstream use is decided again -- a call passing it on is
/// walked and copied in turn (`pending`), and a read the new type does not
/// have refuses by name. A store or return of it into the declared type is the
/// one use left as it was, unconverted, which is what every use was before.
///
/// An erased-parameter trigger additionally needs positional producer evidence
/// and a closed-flow proof. `erasure.rs` classifies what uses require; it does
/// not prove all writers, storage consumers, exports and captures are known.
/// A known examined use can coexist with an unresolved use, and even a site
/// with no unresolved classification may flow through storage the report does
/// not follow. Its verdict alone must never authorize this transform.
///
/// **An array where a record is declared** -- `requireArguments(args: {
/// readonly length: number })` called with an argument tuple, which
/// TypeScript accepts because an array has a `length`. Without a copy the
/// array reaches the record's parameter unconverted: C reads the record's
/// field at the array's length by layout, and the JVM verifier rejects
/// `NtsArrayL` where the record's class is wanted (jvm-verifies cause A, seven
/// runtime modules). In the copy `args.length` is the array's own length.
fn copy_retype(
    probe: &FuncBuilder,
    callee: NodeId,
    position: u32,
    declared: TypeId,
    actual: TypeId,
) -> Option<(HirType, String)> {
    if actual == declared {
        return None;
    }
    // An open form -- `Ctx<T>` inside `read<T>` -- is no value's type in any
    // copy: each copy holds its own instance of it. A copy of the callee made
    // for the open form was laid out with no base (open forms are not
    // instantiations), so `read<f64>` converted its `Ctx<number>` to it and
    // was refused (`outcomes/a-generic-subclass-passed-as-its-base-inside-a-generic-function`).
    // The callee itself takes the instance as its base, which is a prefix.
    if crate::hir::instantiate::mentions_a_parameter(probe.snapshot, actual) {
        return None;
    }
    let (Some(HirType::Managed(ManagedType::Object(want))), Some(represented)) =
        (probe.represent(declared), probe.represent(actual))
    else {
        return None;
    };
    if let HirType::Managed(ManagedType::Object(have)) = represented
        && literal_methods::uses_dispatch(probe, have, want)
        && !probe
            .hierarchy
            .literal_methods
            .method_values_only(callee, position)
    {
        return None;
    }
    // **A face that carries views is not the layout of what it holds.** A copy
    // over it reads the face's own offsets, positionally, for every member the
    // callee touches -- and a carried owner keeps them elsewhere. `g(f)` with
    // `f: Face` holding an `S1` viewed as `Face`, and `g(p: Plain)` reading
    // `p.b`, got `g@0obj1` reading `Face`'s `b` slot on an `S1`, a SIGSEGV
    // (`tests/programs/a-structural-alias-read-after-an-interface-view`). Without
    // the copy the call converts `Face` to `Plain`, which
    // `carried_owners_fit` decides for every carried owner.
    if let HirType::Managed(ManagedType::Object(have)) = represented
        && probe.hierarchy.access_families.changes_transport(have)
    {
        return None;
    }
    match represented {
        // Spelled by representation, as an object's is: seven tuple types in
        // web-platform are one `[str]`, and a spelling by type id made seven
        // copies of one body.
        HirType::Managed(ManagedType::Array(ref element)) => {
            let spelling = format!("arr{}", crate::hir::generics::spell(element));
            Some((represented, spelling))
        }
        HirType::Managed(ManagedType::Object(have))
            if want != have
                && !crate::hir::is_closure_type(declared)
                && !crate::hir::is_closure_type(actual)
                && !probe.is_a_signature(declared)
                && !probe.is_a_signature(actual) =>
        {
            Some((represented, format!("obj{}", have.0)))
        }
        _ => None,
    }
}

/// Decide what one call names, given what each argument actually is.
///
/// `actual` answers the argument's type in the context the call is being
/// walked in: the checker's type in the original, and the copy's for a
/// parameter the copy re-typed. A callee copy seen for the first time is
/// queued so its own body gets walked.
impl StructuralPlanner<'_, '_> {
    /// The union members a call passes (`member_retypes`); a call passing none
    /// to a union without a representation reaches the declaration as written.
    fn plan_members(
        &mut self,
        implementation: NodeId,
        arguments: &[NodeId],
        actual: &impl Fn(NodeId) -> Option<TypeId>,
    ) -> std::collections::BTreeMap<u32, (HirType, String)> {
        let members = member_retypes(self.probe, implementation, arguments, actual);
        if members.is_empty() && has_a_union_without_representation(self.probe, implementation) {
            self.found.declared_reached.insert(implementation);
        }
        members
    }

    fn record_call(
        &mut self,
        within: &str,
        call: NodeId,
        callee: NodeId,
        actual: impl Fn(NodeId) -> Option<TypeId>,
        producer: impl Fn(NodeId) -> Option<HirType>,
    ) {
        let probe = self.probe;
        let snapshot = probe.snapshot;
        if is_generic_function(snapshot, callee) {
            return;
        }
        let Some((signature, members_only)) = planned_signature(probe, call, callee) else {
            return;
        };
        let parameters: Vec<TypeId> = signature.parameters.iter().map(|p| p.ty).collect();
        let arguments = probe.arguments_of(call);
        let positional = probe.kind_of(call) == Some(syntax::CALL_EXPRESSION)
            && !arguments
                .iter()
                .any(|argument| probe.kind_of(*argument) == Some(syntax::SPREAD_ELEMENT));

        let mut retyped = Retyped::new();
        let mut spelled = Vec::new();
        let mut legacy = Retyped::new();
        let mut legacy_spelled = Vec::new();
        let mut recovered = false;
        let implementation = snapshot.implementation_of(callee);
        let by_member = self.plan_members(implementation, &arguments, &actual);
        let mut members = Retyped::new();
        for (at, (declared, argument)) in parameters.iter().zip(&arguments).enumerate() {
            // A literal is built as the parameter's own type, so it needs no
            // copy: an object literal always, and an array literal where the
            // parameter is a tuple (its slot wins over the literal's type).
            // Copied for the literal's type instead, `g([x, "a"])` with `g(t:
            // [c_int, string])` gave `g` a copy over an unwritten `[number,
            // string]` that the strict check refused inside `g`.
            let tuple_slot = || matches!(probe.represent(*declared), Some(HirType::Managed(ManagedType::Object(tuple))) if probe.is_tuple(tuple));
            match probe.kind_of(*argument) {
                Some(syntax::OBJECT_LITERAL_EXPRESSION) => continue,
                Some(syntax::ARRAY_LITERAL_EXPRESSION) if tuple_slot() => continue,
                _ => {}
            }
            let Ok(position) = u32::try_from(at) else {
                continue;
            };
            if let Some((ty, spelling)) = by_member.get(&position) {
                legacy.insert(position, ty.clone());
                legacy_spelled.push(spelling.clone());
                members.insert(position, ty.clone());
                retyped.insert(position, ty.clone());
                spelled.push(spelling.clone());
            } else if !members_only
                && let Some((ty, spelling)) = actual(*argument)
                    .and_then(|actual| copy_retype(probe, callee, position, *declared, actual))
            {
                legacy.insert(position, ty.clone());
                legacy_spelled.push(format!("{at}{spelling}"));
                retyped.insert(position, ty);
                spelled.push(format!("{at}{spelling}"));
            } else if !members_only
                && positional
                && probe.represent(*declared) == Some(HirType::Erased)
                && let Some(ty) = producer(*argument)
                && self.erased.admits(callee, position, &ty)
            {
                spelled.push(format!("{at}e{}", crate::hir::generics::spell(&ty)));
                retyped.insert(position, ty);
                recovered = true;
            }
        }
        if retyped.is_empty() {
            return;
        }
        let mut suffix = format!("@{}", spelled.join("_"));
        if recovered {
            let offered = self.erased_copies.entry(callee).or_default();
            if !offered.contains(&suffix) && offered.len() >= erased_calls::COPY_CAP {
                // Keep the established structural decision when the separate
                // erased-copy budget is exhausted; no other call changes identity.
                retyped = legacy;
                if retyped.is_empty() {
                    return;
                }
                suffix = format!("@{}", legacy_spelled.join("_"));
            } else {
                offered.insert(suffix.clone());
            }
        }
        self.found
            .at_call
            .entry(within.to_owned())
            .or_default()
            .insert(call, (suffix.clone(), retyped.clone()));
        // A copy over a union member is a copy of the implementation, the one
        // body there is; a constructor's is lowered beside its class.
        let by_member = !members.is_empty();
        let callee = if by_member { implementation } else { callee };
        let constructs = by_member && probe.kind_of(callee) == Some(syntax::CONSTRUCTOR);
        if constructs {
            self.found.constructions.insert((callee, suffix.clone()));
        }
        if by_member {
            self.found.members.insert((callee, suffix.clone()), members);
        }
        let copies = self.found.copies.entry(callee).or_default();
        if !copies.iter().any(|(_, at)| *at == suffix) {
            copies.push((retyped.clone(), suffix.clone()));
            // Walked only where a copy will be lowered: `function_copies` makes
            // copies of plain function declarations, and the class makes a
            // constructor's over a union member. A method's or an accessor's
            // would be a context no builder ever runs in.
            if probe.kind_of(callee) == Some(syntax::FUNCTION_DECLARATION) || constructs {
                self.pending.push(PendingCopy {
                    declaration: callee,
                    retyped,
                    suffix,
                });
            }
        }
    }
}

pub(super) fn calls_in_the_body_of(probe: &FuncBuilder, declaration: NodeId) -> Vec<NodeId> {
    let mut calls = Vec::new();
    for child in children_in_the_body_of(probe, declaration) {
        calls_under(probe, child, &mut calls);
    }
    calls
}

/// The calls a **parameter default** evaluates, its own expression included.
///
/// [`calls_in_the_body_of`] starts *below* its argument, which is right for a
/// declaration whose body is a block and wrong here: in `x = thrower()` the default
/// **is** the call, so a walk that skipped the root saw nothing at all.
pub(super) fn calls_in_a_default(probe: &FuncBuilder, default: NodeId) -> Vec<NodeId> {
    let mut calls = Vec::new();
    calls_under(probe, default, &mut calls);
    calls
}

/// One walk, shared, because two spellings of "which calls does this subtree make"
/// is how the set a `try` handles and the set a copy is built from come apart.
fn calls_under(probe: &FuncBuilder, id: NodeId, into: &mut Vec<NodeId>) {
    match probe.kind_of(id) {
        Some(
            syntax::FUNCTION_DECLARATION
            | syntax::METHOD_DECLARATION
            | syntax::CLASS_DECLARATION
            | syntax::CLASS_EXPRESSION,
        ) => return,
        // **A `new` belongs here too**, and did not: the walk yielded
        // `CallExpression` only, so a body that constructs a class whose
        // constructor or field initializer throws looked like a body that calls
        // nothing. Third omission in the same shape, after the accessor in this
        // walk and the accessor in `throwing_symbols`' -- and every one of them
        // was found by running a program the census called compiled.
        Some(
            syntax::CALL_EXPRESSION | syntax::NEW_EXPRESSION | syntax::TAGGED_TEMPLATE_EXPRESSION,
        ) => into.push(id),
        // **An accessor is a call, and an assignment to one is not a call node.**
        // `call_within` draws exactly this line for a `try` and has since 6 of 29
        // cases declined without it; this walk did not, so a body that writes a
        // throwing setter looked like a body that calls nothing. `{ set y(v) {
        // throw … } }` with `attempt(() => { x.y = 23; })` then escaped the
        // handler on `ac1533ca4` -- loud, and a wrong answer -- because the gate
        // counts what a body *calls* and never saw the setter. Found by the
        // conformance lane through test262's dstr `put-prop-ref-user-err` files
        // and recorded as `outcomes/a-setter-throwing-inside-a-function-value`.
        //
        // A read is the same shape, which is what their private-static-getter
        // file shows, and `reads_an_accessor` answers for both by the member
        // symbol's declarations rather than by the syntax around it.
        _ if probe.reads_an_accessor(id)
            || !probe.implicit_printer_callees(id).is_empty()
            || !probe.implicit_iterator_callees(id).is_empty()
            || probe.iterators.close_can_raise(id) =>
        {
            into.push(id);
        }
        _ => {}
    }
    for child in children_that_run(probe, id) {
        calls_under(probe, child, into);
    }
}

/// The symbols a copy re-types, at the copy's types: its parameters by
/// position, and every `const` in its body initialised from one of them.
///
/// **One derivation for the two things that read it** -- the call walk, which
/// decides what a call passing the symbol names, and `closure_variants`, which
/// decides what a closure capturing it reads. A `const stream = source;` is
/// how node's own code hands a parameter to a closure, and the alias carries
/// the copy's value like the parameter does; a `let` can be reassigned to
/// something the checker's type admits and the copy's does not, so it is
/// what the checker says. To a fixpoint, for an alias of an alias.
pub(super) fn retyped_symbols_of(
    probe: &FuncBuilder,
    declaration: NodeId,
    retyped: &Retyped,
) -> std::collections::BTreeMap<u32, HirType> {
    let parameters = probe.parameter_symbols(declaration);
    let seeds: std::collections::BTreeMap<u32, HirType> = retyped
        .iter()
        .filter_map(|(at, ty)| {
            let symbol = parameters.get(*at as usize).copied().flatten()?;
            Some((symbol, ty.clone()))
        })
        .collect();
    with_const_aliases(probe, declaration, seeds)
}

/// `seeds`, plus every `const` in `root`'s body initialised from one of them,
/// to a fixpoint. The alias half of `retyped_symbols_of`, on its own for a
/// closure variant, whose seeds are its re-typed captures.
pub(super) fn with_const_aliases(
    probe: &FuncBuilder,
    root: NodeId,
    mut symbols: std::collections::BTreeMap<u32, HirType>,
) -> std::collections::BTreeMap<u32, HirType> {
    if symbols.is_empty() {
        return symbols;
    }
    let mut declarations = Vec::new();
    probe.subtree(root, &mut declarations);
    let aliases: Vec<(u32, u32)> = declarations
        .into_iter()
        .filter(|node| probe.kind_of(*node) == Some(syntax::VARIABLE_DECLARATION))
        .filter(|node| probe.declaration_kind(*node) == nts_semantic_schema::VariableKind::Const)
        .filter_map(|node| {
            let children = probe.children(node);
            let [name, .., initializer] = children.as_slice() else {
                return None;
            };
            if probe.kind_of(*name) != Some(syntax::IDENTIFIER)
                || probe.kind_of(*initializer) != Some(syntax::IDENTIFIER)
            {
                return None;
            }
            Some((
                probe.node(*name).symbol?.0,
                probe.node(*initializer).symbol?.0,
            ))
        })
        .collect();
    loop {
        let mut grew = false;
        for (alias, of) in &aliases {
            if symbols.contains_key(alias) {
                continue;
            }
            if let Some(ty) = symbols.get(of).cloned() {
                symbols.insert(*alias, ty);
                grew = true;
            }
        }
        if !grew {
            return symbols;
        }
    }
}
