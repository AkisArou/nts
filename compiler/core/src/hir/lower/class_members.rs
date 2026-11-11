//! Select the methods and constructors a class contributes, lower their copies, and hand platform registration to its owner.

#[cfg(test)]
use super::view_class_tests;
use super::{
    Callee, CollectedConstructor, Copy, Diagnostic, Func, FuncBuilder, HirType, LayoutCollector,
    Lowered, LoweringSnapshot, NodeId, NodeKind, RAISING_SUFFIX, Retyped, SemanticSnapshot, Shared,
    Substitution, TypeId, children_that_run, copies_of, declaration_initializer, declares_a_class,
    gobject_properties, instance_type_of, instantiation_suffix, is_static_member,
    lower_object_literal_members, made_instance, member_symbols, note_member, note_uncompiled,
    objc_field_properties, objc_state_function, raising_method, register_com_class,
    register_gobject_class, register_objc_class, retyped_symbols_of, syntax, template_reader,
    with_vfunc_slot,
};

/// The constructor a class declaration writes, where it writes one.
///
/// A class's *symbol* declares the class, and `throwing_symbols` gives it an entry whose
/// meaning is construction -- so every set keyed on "the declaration a raising copy belongs
/// to" has to be able to get from the one to the other. `lower_new` names
/// `{owner}#constructor` and `raising_method` builds the copy from this node, so this is
/// the only spelling of that step.
///
/// `None` for a class with no constructor of its own: there is no body to copy, and
/// construction then runs field initialisers that `walk_one_declaration` already attributes
/// to the class.
///
/// **Through [`FuncBuilder::implementation_of`], because the first `constructor` child of
/// an overloaded one is a signature.** `Blob` writes four of them above its body;
/// `lower_class` skips a signature and lowers the implementation, so a set keyed on the
/// first child is a set of nodes nothing builds -- and the fixpoint cannot disqualify one
/// either, since a signature has no body to walk. That is `eb92ee8f9`'s body-less-signature
/// defect at the one construct whose name is a keyword.
pub(super) fn the_constructor_declared_by(probe: &FuncBuilder, class: NodeId) -> Option<NodeId> {
    if !probe.kind_of(class).is_some_and(declares_a_class) {
        return None;
    }
    probe
        .children(class)
        .into_iter()
        .find(|member| probe.kind_of(*member) == Some(syntax::CONSTRUCTOR))
        .map(|at| probe.implementation_of(at))
}

/// A class body's entry is construction, not definition. Static elements and
/// computed names execute during definition; instance initializers and constructor
/// parameters/body execute during construction. Keep that distinction shared by
/// initialization and exception analysis.
pub(super) fn children_in_the_body_of(probe: &FuncBuilder, declaration: NodeId) -> Vec<NodeId> {
    if !probe.kind_of(declaration).is_some_and(declares_a_class) {
        return children_that_run(probe, declaration);
    }
    let mut children = Vec::new();
    for member in probe.children(declaration) {
        if probe.kind_of(member) == Some(syntax::CONSTRUCTOR) {
            children.extend(probe.children(probe.implementation_of(member)));
        } else if let Some(initializer) = instance_initializer(probe, member) {
            children.push(initializer);
        }
    }
    children
}

/// The part of a field which runs during construction. Its computed name and
/// a static field's initializer instead run while the class is defined.
pub(super) fn instance_initializer(probe: &FuncBuilder, member: NodeId) -> Option<NodeId> {
    if probe.kind_of(member) != Some(syntax::PROPERTY_DECLARATION)
        || is_static_member(probe.snapshot, member)
    {
        return None;
    }
    let fields = probe.children(member);
    let name = fields.first().copied()?;
    declaration_initializer(&fields, name, |at| probe.kind_of(at))
}

/// The methods and constructors a class declares.
pub(super) fn members_of(
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    id: NodeId,
) -> Vec<NodeId> {
    // An Objective-C class a binding declares is the framework's: every
    // member is a message, sent where it is called, and none is a function
    // of this program -- as a bound Java member is not, below.
    // And a composable Windows Runtime class a binding declares: its members
    // are vtable calls, and the overrides it declares are a subclass's to
    // write.
    if crate::hir::native::is_objc_class(snapshot, id)
        || crate::hir::native::is_com_class(snapshot, id)
    {
        return Vec::new();
    }
    let probe = FuncBuilder::probe(snapshot);
    probe
        .children(id)
        .into_iter()
        .filter(|child| {
            matches!(
                probe.kind_of(*child),
                Some(
                    syntax::METHOD_DECLARATION
                        | syntax::CONSTRUCTOR
                        | syntax::GET_ACCESSOR
                        | syntax::SET_ACCESSOR
                )
            )
        })
        // **A bound foreign member contributes no function.** Its body is in a
        // jar; there is nothing of ours to emit, and `callee_for` turns a call
        // to it into a `Callee::External` that never names a function this
        // program defines.
        //
        // Filtered here rather than refused in `method_body`, because Java
        // overloads collapse onto one HIR name: `Catalog#find` has four, and
        // emitting an empty function per declaration produced
        // `DuplicateFunction { name: "Catalog#find" }` three times over. The
        // member is not a function that is missing a body -- it is not a
        // function of ours at all.
        .filter(|child| {
            let at = probe.location(*child);
            !foreign.contains_key(&(at.file.0, at.span.end))
        })
        .collect()
}

/// The copies of a class to lower.
///
/// Every function one class declaration contributes, once per instantiation.
///
/// A generic class is lowered once per instantiation and not at all as itself:
/// a field of type `T` has no width, and `Vector<Body>` and `Vector<double>`
/// are two classes that happen to share a source.
///
/// A class with type parameters that **nothing here instantiates** still comes
/// through, and is refused a member at a time. That is not the same as being
/// dead: `runtime/node` exports generic classes a consumer instantiates, and a
/// copy needs type arguments only a caller has. 129 refusal sites in the
/// profile are exactly this, and the message names the class so they read as
/// what they are rather than as a lowering gap.
/// Lower the methods and accessors an object literal declares.
///
/// The same shape as [`lower_class`] with everything a class has and a literal
/// does not taken out: no copies, because there is no way to write a generic
/// object literal; no statics; no constructor; and no base.
///
/// The instance type is the literal's own, which is what makes
/// `class_name_for` answer -- it takes the name from the layout when it has an
/// instance, and a layout is exactly what an anonymous object type has.
///
/// The driver calls this **without** `continue`, unlike a class declaration: a
/// literal is an expression inside something else, and that something else
/// still has to be lowered.
/// Lower the members of whatever owns some, and say whether that is all this
/// node is.
///
/// Two kinds own members and they end differently. A **class declaration** is
/// only its members, so the driver stops -- `true`. An **object literal** is an
/// expression inside something else, and that something else still has to be
/// lowered, so the driver carries on -- `false`, which is also the answer for
/// every other node.
///
/// One function rather than two branches in the driver because "which nodes own
/// members" is one fact, and the driver's job is dispatch rather than knowing
/// it.
#[expect(
    clippy::too_many_arguments,
    reason = "explicit layout owner during collection"
)]
pub(super) fn lower_members_of(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    id: NodeId,
    generic: &rustc_hash::FxHashMap<NodeId, Vec<crate::hir::generics::Instantiation>>,
    shared: &Shared,
    lowered: &mut Lowered,
    wanted: &mut std::collections::BTreeSet<usize>,
) -> bool {
    match snapshot.nodes.get(id.0 as usize).map(|node| node.kind) {
        Some(NodeKind::Syntax(kind)) if declares_a_class(kind) => {
            lower_class(
                layout_collector,
                snapshot,
                foreign,
                id,
                generic,
                shared,
                lowered,
                wanted,
            );
            true
        }
        Some(NodeKind::Syntax(syntax::OBJECT_LITERAL_EXPRESSION)) => {
            lower_object_literal_members(
                layout_collector,
                snapshot,
                foreign,
                id,
                shared,
                lowered,
                wanted,
            );
            false
        }
        _ => false,
    }
}

/// The copy description a class member's builder gets.
///
/// **One spelling, because the raising variant needs the same one with a single flag
/// flipped** -- the substitution, the sources and the closure suffix each have a
/// reason stated here, and a variant that had three of the four would read a field or
/// a capture at the wrong type. The same argument `lower_wanted_closures`' `copy_for`
/// makes for a closure, one construct over.
pub(super) fn member_copy(
    snapshot: &SemanticSnapshot,
    instance: Option<TypeId>,
    substitution: &Substitution,
    sources: &crate::hir::generics::Sources,
    raises: bool,
) -> Copy {
    Copy {
        substitution: substitution.clone(),
        // **What a tuple's arity survives in.** Empty here until 2026-09-30, which is
        // why a spread of a class field typed at a type parameter bound to a uniform
        // tuple could not be expanded: the array representation the substitution
        // carries does not say how many positions there were. See
        // `generics::Instantiation::sources`.
        sources: sources.clone(),
        instance,
        // The suffix its closures are keyed under, so an arrow in this body picks the
        // variant lowered under this copy's substitution. See
        // `class_closure_variants`.
        suffix: instance
            .map(|ty| instantiation_suffix(snapshot, ty))
            .unwrap_or_default(),
        raises,
        ..Copy::default()
    }
}

/// The name a constructor's copy keyed on `target` carries after the
/// constructor's own ([`FuncBuilder::construct_target`]).
pub(super) fn target_suffix(target: TypeId) -> String {
    format!("@as{}", target.0)
}

/// The classes each constructor whose base makes the instance is run for
/// besides its own ([`FuncBuilder::construct_target`]).
///
/// For each class extending a typed array that a `new` builds, or that
/// declares a constructor of its own (whose `super(...)` then runs its base's
/// for it), every constructor its construction runs that another class
/// declares, keyed on it. A constructor no subclass inherits has no copy.
pub(super) fn constructor_targets(
    probe: &FuncBuilder<'_>,
) -> rustc_hash::FxHashMap<NodeId, Vec<TypeId>> {
    let mut constructors = made_instance::ConstructorMemo::new(probe);
    let mut built: Vec<NodeId> = Vec::new();
    for index in 0..probe.snapshot.nodes.len() {
        let Ok(at) = u32::try_from(index).map(NodeId) else {
            continue;
        };
        match probe.kind_of(at) {
            Some(syntax::NEW_EXPRESSION) => {
                let Some(class) = probe
                    .children(at)
                    .first()
                    .and_then(|callee| constructors.declaration(*callee))
                else {
                    continue;
                };
                built.push(class);
            }
            Some(kind)
                if declares_a_class(kind) && the_constructor_declared_by(probe, at).is_some() =>
            {
                built.push(at);
            }
            _ => {}
        }
    }
    built.sort_unstable_by_key(|class| class.0);
    built.dedup();
    let mut targets = ConstructorTargets::default();
    for class in built {
        if !probe.kind_of(class).is_some_and(declares_a_class) {
            continue;
        }
        let Some(target) = instance_type_of(probe.snapshot, class) else {
            continue;
        };
        let mut next = constructors.of(class);
        while let Some(proof) = next {
            let (owner, constructor) = match proof {
                CollectedConstructor::Source { class, constructor } => (class, constructor),
                CollectedConstructor::Builtin => break,
            };
            if owner != class {
                targets.insert(constructor, target);
            }
            next = constructors.above(owner);
        }
    }
    #[cfg(test)]
    view_class_tests::note_discovery_retained(constructors.owned_binding_elements());
    targets.finish()
}

/// Membership is indexed while collecting; only publication orders the rows.
#[derive(Default)]
pub(super) struct ConstructorTargets {
    rows: rustc_hash::FxHashMap<NodeId, rustc_hash::FxHashSet<TypeId>>,
}

impl ConstructorTargets {
    pub(super) fn insert(&mut self, constructor: NodeId, target: TypeId) {
        #[cfg(test)]
        view_class_tests::note_target();
        self.rows.entry(constructor).or_default().insert(target);
    }

    pub(super) fn finish(self) -> rustc_hash::FxHashMap<NodeId, Vec<TypeId>> {
        self.rows
            .into_iter()
            .map(|(owner, targets)| {
                let mut targets: Vec<_> = targets.into_iter().collect();
                targets.sort_unstable_by_key(|ty| ty.0);
                (owner, targets)
            })
            .collect()
    }
}

/// A constructor's copies keyed on the classes that inherit it
/// ([`Shared::target_copies`]), each beside its raising form where the
/// constructor raises: named as a `new` or a `super(...)` run for that class
/// names them, and recorded as constructing it ([`Program::constructed_as`](crate::hir::Program::constructed_as)).
#[expect(
    clippy::too_many_arguments,
    reason = "explicit layout owner during collection"
)]
fn target_constructor_copies(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    shared: &Shared,
    lowered: &mut Lowered,
    class: NodeId,
    member: NodeId,
    wanted: &mut std::collections::BTreeSet<usize>,
) {
    let Some(targets) = shared.target_copies.get(&member) else {
        return;
    };
    for target in targets {
        let suffix = target_suffix(*target);
        for raises in [false, true] {
            if raises && !shared.naming.raising.contains(&member) {
                continue;
            }
            let copy = Copy {
                suffix: suffix.clone(),
                raises,
                constructs: Some(*target),
                ..Copy::default()
            };
            let mut builder = shared.builder(snapshot, foreign, copy);
            match builder.lower_method_of(class, member, None) {
                Ok(mut func) => {
                    let ordinary = std::mem::take(&mut func.name);
                    let mode = if raises { RAISING_SUFFIX } else { "" };
                    func.name = format!("{ordinary}{suffix}{mode}");
                    builder.rename_arrivals(&ordinary, &func.name);
                    lowered
                        .program
                        .constructed_as
                        .insert(func.name.clone(), *target);
                    lowered.program.funcs.push(func);
                }
                Err(diagnostic) => {
                    note_member(&mut builder, lowered, class, member, None, &diagnostic);
                    lowered.diagnostics.push(diagnostic);
                }
            }
            builder.harvest(wanted, &mut lowered.arrivals);
            layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
        }
    }
}

/// A constructor's copies over the union members its `new` and `super(...)`
/// sites pass ([`Structural::constructions`](super::Structural::constructions)), each beside its raising form
/// where the constructor raises. Named as a site names them: the copy's
/// suffix, then the exception mode's.
#[expect(
    clippy::too_many_arguments,
    reason = "explicit layout owner during collection"
)]
fn constructor_copies(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    shared: &Shared,
    lowered: &mut Lowered,
    class: NodeId,
    member: NodeId,
    wanted: &mut std::collections::BTreeSet<usize>,
) {
    let Some(copies) = shared.structural.copies.get(&member) else {
        return;
    };
    let probe = FuncBuilder::probe(snapshot);
    // An object's constructor takes the instance first; one whose base makes
    // the instance takes none.
    let receiver = u32::from(probe.native_instance(class, None).is_none());
    for (retyped, suffix) in copies {
        if !shared
            .structural
            .constructions
            .contains(&(member, suffix.clone()))
        {
            continue;
        }
        let retyped_symbols = retyped_symbols_of(&probe, member, retyped);
        let shifted: Retyped = retyped
            .iter()
            .map(|(at, ty)| (at + receiver, ty.clone()))
            .collect();
        for raises in [false, true] {
            if raises && !shared.naming.raising.contains(&member) {
                continue;
            }
            let copy = Copy {
                retyped: shifted.clone(),
                suffix: suffix.clone(),
                raises,
                ..Copy::default()
            };
            let mut builder = shared.builder(snapshot, foreign, copy);
            builder.retyped_symbols.clone_from(&retyped_symbols);
            builder.member_retyped = member_symbols(&probe, &shared.structural, member, suffix);
            match builder.lower_method_of(class, member, None) {
                Ok(mut func) => {
                    let ordinary = std::mem::take(&mut func.name);
                    let mode = if raises { RAISING_SUFFIX } else { "" };
                    func.name = format!("{ordinary}{suffix}{mode}");
                    builder.rename_arrivals(&ordinary, &func.name);
                    lowered.program.funcs.push(func);
                }
                Err(diagnostic) => {
                    note_member(&mut builder, lowered, class, member, None, &diagnostic);
                    lowered.diagnostics.push(diagnostic);
                }
            }
            builder.harvest(wanted, &mut lowered.arrivals);
            layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
        }
    }
}

#[expect(clippy::too_many_lines, reason = "over 100 lines once formatted")]
#[expect(
    clippy::too_many_arguments,
    reason = "explicit layout owner during collection"
)]
fn lower_class(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    foreign: &crate::hir::runtime::ForeignTable,
    class: NodeId,
    generic: &rustc_hash::FxHashMap<NodeId, Vec<crate::hir::generics::Instantiation>>,
    shared: &Shared,
    lowered: &mut Lowered,
    wanted: &mut std::collections::BTreeSet<usize>,
) {
    let members = members_of(snapshot, foreign, class);
    let mut objc_methods = Vec::new();
    let mut gobject_methods = Vec::new();
    let gobject = crate::hir::native::gobject_parent(snapshot, class);
    if refuses_an_unregistered_handle(snapshot, class, lowered) {
        return;
    }
    let mut com_methods = Vec::new();
    for (copy, (instance, substitution, sources)) in
        copies_of(generic, class).into_iter().enumerate()
    {
        for &member in &members {
            // One function for a `static` member, however many copies the class
            // has -- see `class_name_for`, which names it without the
            // instantiation for the same reason. Emitting it per copy would
            // define `Factory.of` twice.
            if copy > 0 && is_static_member(snapshot, member) {
                continue;
            }
            let mut builder = shared.builder(
                snapshot,
                foreign,
                member_copy(snapshot, instance, &substitution, &sources, false),
            );
            // An overload signature declares a call shape and has no body. The
            // implementation beside it is the one member emitted, and every
            // call resolving to a signature is built against that one -- so
            // there is nothing here to lower and nothing absent to report.
            if builder.is_an_overload_signature(class, member) {
                continue;
            }
            // A class the program writes over a GObject class is a GType of
            // its own, registered the first time one is made, with each
            // `vfunc_` method its class struct's slot. Its instances are the
            // parent's handle, so every method takes one as `this`.
            if gobject.is_some() && !is_static_member(snapshot, member) {
                let lowered_member = builder.lower_gobject_member(class, member, instance);
                let lowered_member = with_vfunc_slot(
                    layout_collector,
                    snapshot,
                    foreign,
                    shared,
                    (lowered_member, builder.vfunc_slot.take()),
                    lowered,
                );
                keep_foreign_member(
                    snapshot,
                    member,
                    lowered_member,
                    &mut gobject_methods,
                    lowered,
                );
                builder.harvest(wanted, &mut lowered.arrivals);
                layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
                continue;
            }
            // A class the program writes over a composable Windows Runtime
            // class is composed by the runtime (`class App extends
            // Application`): each method an override the runtime's table for
            // its interface answers, and nothing else yet -- no constructor
            // of its own, which `new` does not run, and no field.
            if crate::hir::native::extends_com(snapshot, class)
                && !is_static_member(snapshot, member)
            {
                let lowered_member = builder.lower_com_member(class, member, instance);
                keep_foreign_member(snapshot, member, lowered_member, &mut com_methods, lowered);
                builder.harvest(wanted, &mut lowered.arrivals);
                layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
                continue;
            }
            // A class the program writes over an Objective-C class is an
            // Objective-C class of its own, registered when the program loads
            // with its methods as the runtime's -- not an object of ours with
            // an Objective-C base inside it, which would put two
            // representations on one chain.
            if crate::hir::native::extends_objc(snapshot, class)
                && builder.kind_of(member) == Some(syntax::CONSTRUCTOR)
            {
                match builder.lower_objc_constructor(class, member, instance) {
                    Ok(func) => lowered.program.funcs.push(func),
                    Err(diagnostic) => {
                        note_member(&mut builder, lowered, class, member, instance, &diagnostic);
                        lowered.diagnostics.push(diagnostic);
                    }
                }
                builder.harvest(wanted, &mut lowered.arrivals);
                layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
                continue;
            }
            // A `static` member is the program's alone -- a function and a
            // global, as any class's is -- and not a class method the runtime
            // is told of: nothing but the program calls it.
            if crate::hir::native::extends_objc(snapshot, class)
                && !is_static_member(snapshot, member)
            {
                match builder.lower_objc_method(class, member, instance) {
                    Ok((func, method)) => {
                        lowered.program.funcs.push(func);
                        objc_methods.extend(method);
                    }
                    Err(diagnostic) => {
                        note_member(&mut builder, lowered, class, member, instance, &diagnostic);
                        lowered.diagnostics.push(diagnostic);
                    }
                }
                builder.harvest(wanted, &mut lowered.arrivals);
                layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
                continue;
            }
            if instance.is_none()
                && builder.kind_of(member) == Some(syntax::CONSTRUCTOR)
                && !shared.structural.lowers_as_declared(member)
            {
                // Reached only as its copies over union members.
                constructor_copies(
                    layout_collector,
                    snapshot,
                    foreign,
                    shared,
                    lowered,
                    class,
                    member,
                    wanted,
                );
                target_constructor_copies(
                    layout_collector,
                    snapshot,
                    foreign,
                    shared,
                    lowered,
                    class,
                    member,
                    wanted,
                );
                builder.harvest(wanted, &mut lowered.arrivals);
                layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
                continue;
            }
            // **Attempted whether or not the ordinary body compiles**, because the two
            // are independent lowerings and the *call site* names one of them without
            // asking: `callee_for` appends the suffix when the declaration is in
            // `naming.raising`, which is a fact about what a `try` reaches and not
            // about what lowered. Nested inside the `Ok` arm, a member whose ordinary
            // body refused got no raising copy and no refusal recorded for one either,
            // so a caller's cascade read `it calls `X@raises`, which nothing in this
            // program defines` -- a cascade with no root, which `integrity` reports
            // and which is the weaker of two sentences about one cause. Eight of them
            // in `outcomes/a-teed-stream-read-back`.
            raising_method(
                snapshot,
                foreign,
                shared,
                lowered,
                class,
                member,
                instance,
                &substitution,
                &sources,
                wanted,
            );
            if instance.is_none() && builder.kind_of(member) == Some(syntax::CONSTRUCTOR) {
                constructor_copies(
                    layout_collector,
                    snapshot,
                    foreign,
                    shared,
                    lowered,
                    class,
                    member,
                    wanted,
                );
                target_constructor_copies(
                    layout_collector,
                    snapshot,
                    foreign,
                    shared,
                    lowered,
                    class,
                    member,
                    wanted,
                );
            }
            match builder.lower_method_of(class, member, instance) {
                Ok(func) => lowered.program.funcs.push(func),
                // **Recorded, not only reported** -- the same omission the two
                // sites in `super::mod` carry a note about, one layer up. A
                // class member is lowered *here* and never through the
                // `lower_function` arm that files a refusal under a name, so
                // every refused method and every refused constructor in the
                // program was reported to a person and left out of the list the
                // next pass reads.
                //
                // The napi wrapper asks `program.uncompiled` for
                // `Readable#constructor` and printed `is a class whose
                // constructor was not compiled` -- the effect, cause unsaid --
                // when it found nothing. It never could: on 2026-09-15
                // `uncompiled` was **empty** for a two-class fixture whose
                // constructor refuses with a named cause. Seven declines in
                // `stream` said that sentence, four of them classes that do
                // declare a constructor, and `Readable` is the single
                // most-named export in that module's failing tests.
                Err(diagnostic) => {
                    note_member(&mut builder, lowered, class, member, instance, &diagnostic);
                    lowered.diagnostics.push(diagnostic);
                }
            }
            builder.harvest(wanted, &mut lowered.arrivals);
            layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
        }
    }
    if crate::hir::native::extends_objc(snapshot, class) {
        objc_methods.extend(objc_field_properties(
            layout_collector,
            snapshot,
            foreign,
            class,
            shared,
            lowered,
        ));
        let state =
            objc_state_function(layout_collector, snapshot, foreign, class, shared, lowered);
        register_objc_class(snapshot, class, objc_methods, state, lowered);
    }
    if let Some(parent) = gobject {
        let state =
            objc_state_function(layout_collector, snapshot, foreign, class, shared, lowered);
        let properties =
            gobject_properties(layout_collector, snapshot, foreign, class, shared, lowered);
        if template_reader(snapshot, foreign, class, shared, lowered) {
            register_gobject_class(
                snapshot,
                class,
                parent,
                (gobject_methods, properties),
                state,
                lowered,
            );
        }
    }
    if let Some(composition) = crate::hir::native::composable_base(snapshot, class) {
        let state =
            objc_state_function(layout_collector, snapshot, foreign, class, shared, lowered);
        register_com_class(snapshot, class, composition, com_methods, state, lowered);
    }
}

/// A class member lowered for a foreign runtime: its function, and how the
/// runtime reaches it where it does.
pub(super) type LoweredMember = Result<(Func, Option<crate::hir::ForeignMethod>), Diagnostic>;

fn keep_foreign_member(
    snapshot: &LoweringSnapshot<'_>,
    member: NodeId,
    lowered_member: LoweredMember,
    methods: &mut Vec<crate::hir::ForeignMethod>,
    lowered: &mut Lowered,
) {
    match lowered_member {
        Ok((func, method)) => {
            lowered.program.funcs.push(func);
            methods.extend(method);
        }
        Err(diagnostic) => {
            note_uncompiled(snapshot, &mut lowered.program, member, None, &diagnostic);
            lowered.diagnostics.push(diagnostic);
        }
    }
}

/// **A class over a C handle that nothing registers is refused whole.** Its
/// instances are the handle -- the parent's representation, inherited with
/// its brands -- so without a registration `new` made a parent and every
/// override was silently never called: `class Counter extends GtkButton` ran
/// as a plain button before subclasses were registered. What a runtime
/// registers is [`crate::hir::native::registered_by_a_runtime`]'s; anything else
/// extending a handle, a subclass of such a subclass among them, is refused
/// by name rather than lowered as its parent. Whether it refused.
fn refuses_an_unregistered_handle(
    snapshot: &LoweringSnapshot<'_>,
    class: NodeId,
    lowered: &mut Lowered,
) -> bool {
    if crate::hir::native::registered_by_a_runtime(snapshot, class) {
        return false;
    }
    let probe = FuncBuilder::probe(snapshot);
    let handle = instance_type_of(snapshot, class).and_then(|ty| probe.represent(ty));
    if !matches!(handle, Some(HirType::NativePointer(_))) {
        return false;
    }
    let diagnostic = probe.unsupported(
        class,
        "a class extending a C handle's class that nothing registers -- only a GObject class a binding declares, an Objective-C class, or a composable Windows Runtime class can be extended",
    );
    note_uncompiled(snapshot, &mut lowered.program, class, None, &diagnostic);
    lowered.diagnostics.push(diagnostic);
    true
}

/// A call whose receiver [`FuncBuilder::via_receiver`] queried: its instance
/// parameter is the interface pointer the query answered, `void *` and
/// uncounted, rather than the receiver's own type. Any other call is itself.
pub(super) fn via_callee(callee: Callee, queried: bool) -> Callee {
    match callee {
        Callee::Native(target) if queried && !target.parameters.is_empty() => {
            let mut target = (*target).clone();
            target.parameters[0] =
                crate::hir::native::Type::Pointer(crate::hir::native::Pointee::Void);
            Callee::Native(std::sync::Arc::new(target))
        }
        other => other,
    }
}
