//! Enumerate checker-materialized function and class instantiations and their declaration copies.

use super::{
    Diagnostic, FuncBuilder, LoweringSnapshot, NodeId, NodeKind, Retyped, SemanticSnapshot,
    Structural, Substitution, SymbolId, TypeId, TypeKind, declares_a_class,
    declares_or_instantiates, instantiation_suffix, syntax,
};

/// Which class declarations are generic, and what each was instantiated at.
///
/// Keyed by the declaration rather than by its symbol, because the lowering
/// walks nodes.
pub(super) fn generic_classes(
    snapshot: &LoweringSnapshot<'_>,
) -> rustc_hash::FxHashMap<NodeId, Vec<crate::hir::generics::Instantiation>> {
    let by_symbol = crate::hir::generics::instantiations(snapshot);
    let probe = FuncBuilder::probe(snapshot);
    snapshot
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, node)| matches!(node.kind, NodeKind::Syntax(kind) if declares_a_class(kind)))
        .filter_map(|(index, _)| {
            let id = NodeId(u32::try_from(index).unwrap_or(u32::MAX));
            let symbol = probe
                .children(id)
                .into_iter()
                .find(|child| probe.kind_of(*child) == Some(syntax::IDENTIFIER))
                .and_then(|child| probe.node(child).symbol)?;
            Some((id, by_symbol.get(&symbol)?.clone()))
        })
        .collect()
}

/// Whether `ty` is an instantiation of a generic interface rather than the
/// declaration's own type.
pub(super) fn is_an_instantiation(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder,
    ty: TypeId,
) -> bool {
    let Some(symbol) = snapshot
        .types
        .get(ty.0 as usize)
        .and_then(|record| record.symbol)
    else {
        return false;
    };
    let Some(record) = snapshot.symbols.get(symbol.0 as usize) else {
        return false;
    };
    record.declarations.iter().any(|declaration| {
        probe.kind_of(*declaration) == Some(syntax::INTERFACE_DECLARATION)
            && snapshot
                .node_types
                .get(declaration)
                .is_some_and(|declared| {
                    *declared != ty && declares_or_instantiates(snapshot, ty, *declared)
                })
    })
}

/// Each type a generic body names, to every instance a copy of the body makes
/// of it: what [`Hierarchy::template_instances`](super::Hierarchy::template_instances) holds. Read off every copy's
/// `Substitution` -- generic functions, their value fallbacks, and class
/// instantiations.
pub(super) fn template_instances(
    snapshot: &SemanticSnapshot,
    instantiations: &rustc_hash::FxHashMap<SymbolId, Vec<crate::hir::generics::Instantiation>>,
) -> rustc_hash::FxHashMap<TypeId, Vec<TypeId>> {
    let functions = crate::hir::generics::function_instantiations(snapshot);
    let mut by_template: rustc_hash::FxHashMap<TypeId, Vec<TypeId>> =
        rustc_hash::FxHashMap::default();
    let substitutions = functions
        .copies
        .values()
        .flatten()
        .map(|copy| &copy.substitution)
        .chain(
            functions
                .value_fallbacks
                .values()
                .map(|copy| &copy.substitution),
        )
        .chain(instantiations.values().flatten().map(|i| &i.substitution));
    for substitution in substitutions {
        for (template, instance) in substitution.instances() {
            by_template.entry(template).or_default().push(instance);
        }
    }
    for instances in by_template.values_mut() {
        instances.sort_unstable();
        instances.dedup();
    }
    by_template
}

pub(super) fn uninstantiated(
    snapshot: &LoweringSnapshot<'_>,
    generics: &crate::hir::generics::GenericFunctions,
    id: NodeId,
) -> Option<Diagnostic> {
    if !is_generic_function(snapshot, id) {
        return None;
    }
    let loose = generics
        .unpinned
        .get(&id)
        .filter(|loose| !loose.is_empty())
        .map(|loose| {
            loose
                .iter()
                .map(|name| format!("`{name}`"))
                .collect::<Vec<_>>()
                .join(", ")
        });
    // The modifier is on the declaration itself. `declaration_is_exported` is
    // the *variable statement* form -- it looks for a `VARIABLE_STATEMENT`
    // ancestor, which a function declaration does not have -- and answered
    // `false` for `export function schedule`, which is the shape this exists
    // for.
    let exported = snapshot.nodes.get(id.0 as usize).is_some_and(|node| {
        node.modifiers
            .contains(nts_semantic_schema::DeclarationModifiers::EXPORT)
    });
    let what = match loose {
        Some(named) if named.contains(", ") => {
            format!("a generic function no call pins down (the type parameters {named})")
        }
        Some(named) => format!("a generic function no call pins down (the type parameter {named})"),
        None if exported => "an exported generic function this program never instantiates, so \
                             there is no copy for the export to name"
            .to_owned(),
        // **Called, generic, and no copy: the hidden root.**
        //
        // Every caller says "it calls `f`, which was refused above" and there is
        // nothing above, because this arm used to answer `None` for a generic that
        // is not exported. Three lanes reported the same shape in three days --
        // the smallest reproduction is
        // `blockers/a-generic-pinned-through-two-unions`, four functions -- and in
        // each of them the census named a cause that was invisible, so the work
        // was ranked against a sentence nobody could read.
        //
        // `unpinned` being empty is what makes it worth its own sentence rather
        // than the one above: nothing was left unpinned, so the copy was not
        // missing for want of a binding. It was not made *where the call is*,
        // which is the deferred expansion's business, and saying so points at the
        // mechanism instead of at the type parameters.
        //
        // Only where something calls it. A generic nothing calls and nothing
        // exports is dead code, and a refusal for it would be noise in every
        // census that already has too much.
        None if generics.copies.get(&id).is_none_or(Vec::is_empty)
            && snapshot
                .call_targets
                .values()
                .any(|target| target.callee == Some(id)) =>
        {
            "a generic function this program calls and never copies, with no type parameter left \
             unpinned -- so the copy was not made where the call is, and the call has nothing to \
             name"
                .to_owned()
        }
        None => return None,
    };
    Some(FuncBuilder::probe(snapshot).unsupported(id, &what))
}

/// The copies of a function to lower.
///
/// A generic function is lowered once per instantiation and not at all as
/// itself: a parameter of type `T` has no width. The instantiations come from
/// the *calls*, because that is where the checker puts them — see
/// [`crate::hir::generics::function_instantiations`]. One that nothing calls is
/// dead, and lowering it would report a refusal for a program nobody wrote.
pub(super) fn function_copies(
    snapshot: &SemanticSnapshot,
    generic: &crate::hir::generics::GenericFunctions,
    structural: &Structural,
    raising: &rustc_hash::FxHashSet<NodeId>,
    id: NodeId,
) -> Vec<Copy> {
    let mut copies: Vec<Copy> =
        if let Some(instances) = generic.copies.get(&id) {
            instances
                .iter()
                .map(|instance| Copy {
                    substitution: instance.substitution.clone(),
                    sources: instance.sources.clone(),
                    retyped: Retyped::new(),
                    suffix: instance.suffix.clone(),
                    // A copy of a generic *function*: its own parameters are
                    // bound, and there is no enclosing class copy to answer for.
                    instance: None,
                    declaration: Some(id),
                    raises: false,
                    constructs: None,
                })
                .collect()
        } else if is_generic_function(snapshot, id) {
            return Vec::new();
        } else {
            // An ordinary function keeps its unspecialized body as well: a call
            // passing the declared parameter type still names that body.
            let mut copies = if structural.lowers_as_declared(id) {
                vec![Copy::default()]
            } else {
                Vec::new()
            };
            copies.extend(structural.copies.get(&id).into_iter().flatten().map(
                |(retyped, suffix)| Copy {
                    retyped: retyped.clone(),
                    suffix: suffix.clone(),
                    ..Copy::default()
                },
            ));
            copies
        };
    // Exception mode does not change the specialization context. Pair every
    // ordinary copy with the same bindings in raising mode; this includes
    // structural copies, whose previous ordinary-only form escaped a `try`.
    // `raising` selects reachable declarations, and unused instances are pruned.
    for index in 0..copies.len() {
        if raising.contains(&id)
            || structural
                .raising
                .contains(&(id, copies[index].suffix.clone()))
        {
            let mut raising = copies[index].clone();
            raising.raises = true;
            copies.push(raising);
        }
    }
    copies
}

/// One version of a function to emit: a generic instantiation, a structural
/// specialisation, or the plain one with neither.
#[derive(Clone, Default)]
pub(super) struct Copy {
    pub(super) substitution: Substitution,
    pub(super) sources: crate::hir::generics::Sources,
    pub(super) retyped: Retyped,
    /// Specialization identity, shared by ordinary and raising forms. Exception
    /// mode is appended only when naming a function, never to lookup contexts.
    pub(super) suffix: String,
    /// The instantiation this is a copy *of*, where it is a generic class's.
    ///
    /// A call written in a generic body names a different copy of its callee
    /// in each copy of the class around it, and that is the key those answers
    /// are held under. See `generics::GenericFunctions::at_call_in`.
    pub(super) instance: Option<TypeId>,
    /// And the declaration this is a copy of, where it is a generic
    /// *function*'s -- which with [`Self::suffix`] is what identifies the copy,
    /// since a function instantiation is not a type and has no id of its own.
    /// See `generics::GenericFunctions::at_call_in_copy`.
    pub(super) declaration: Option<NodeId>,
    /// A copy whose unhandled `throw` records and returns rather than ending
    /// the program. See [`FuncBuilder::raises`].
    pub(super) raises: bool,
    /// The class a constructor copy constructs, where it is run for a class
    /// that inherits it ([`FuncBuilder::construct_target`]).
    pub(super) constructs: Option<TypeId>,
}

/// Whether a function declaration has type parameters of its own.
pub(super) fn is_generic_function(snapshot: &SemanticSnapshot, id: NodeId) -> bool {
    crate::hir::generics::declared_type_parameters(snapshot, id) > 0
}

/// A generic class is lowered once per instantiation and not at all as itself:
/// a field of type `T` has no width, and `Vector<Body>` and `Vector<double>` are
/// two classes that happen to share a source. A class with type parameters that
/// nothing instantiates is dead, and lowering it would report a refusal for a
/// program nobody wrote.
pub(super) fn copies_of(
    generic: &rustc_hash::FxHashMap<NodeId, Vec<crate::hir::generics::Instantiation>>,
    id: NodeId,
) -> Vec<(Option<TypeId>, Substitution, crate::hir::generics::Sources)> {
    generic.get(&id).map_or_else(
        || {
            vec![(
                None,
                Substitution::default(),
                crate::hir::generics::Sources::default(),
            )]
        },
        |instances| {
            instances
                .iter()
                .map(|instance| {
                    (
                        Some(instance.ty),
                        instance.substitution.clone(),
                        instance.sources.clone(),
                    )
                })
                .collect()
        },
    )
}

/// Every copy of every generic, class and function alike.
///
/// The suffix is the instantiation's, the same one `instantiation_suffix`
/// gives a layout — so a closure variant, the copy that makes it and the
/// builder that lowers it all name one string, and none of them has to derive
/// it a second way.
///
/// **A list and not a map keyed by that suffix**, which is what it was until
/// 2026-09-25 and which lost copies. A suffix names an *instantiation* and not a
/// generic: `plain<S>(v: S)` and `united<S>(v: (() => S) | S)` both spell
/// `<f64>`, so the second entry was dropped, `class_closure_variants` made
/// variants only for the surviving declaration, and closures in the other's
/// copies were lowered with an **empty** substitution -- their captures read at
/// the declaration's types, refusing as `a captured variable of unrepresentable
/// type (the type parameter S)`. Which of the two lost depended on node order, so
/// swapping the declarations in the file swapped which one refused.
///
/// It lost a copy rather than assigning a wrong one, because
/// `class_closure_variants` pairs a closure with a copy of *its own*
/// declaration. That is the difference between a refusal and a type confusion,
/// and it was luck rather than design.
pub(super) fn class_copies(
    snapshot: &LoweringSnapshot<'_>,
    generics: &crate::hir::generics::GenericFunctions,
) -> Vec<ClassCopy> {
    let mut found: Vec<ClassCopy> = Vec::new();
    let mut seen: rustc_hash::FxHashSet<(NodeId, String)> = rustc_hash::FxHashSet::default();
    let mut record = |copy: ClassCopy| {
        if seen.insert((copy.declaration, copy.suffix.clone())) {
            found.push(copy);
        }
    };
    for (declaration, instances) in generic_classes(snapshot) {
        for instance in instances {
            record(ClassCopy {
                declaration,
                suffix: instantiation_suffix(snapshot, instance.ty),
                instance: Some(instance.ty),
                substitution: instance.substitution,
                sources: instance.sources,
            });
        }
    }
    // **And a generic function's copies, which have the same problem.** A
    // closure written in one is lowered in a builder of its own, and without
    // the copy's substitution a rest parameter typed `Arguments` is the bare
    // type parameter again: `fs`'s `asRequest` returns `(...args: Arguments)
    // => void` and the arrow refused with `a rest parameter whose element
    // type has no representation` while the copy around it had `Arguments`
    // pinned to a tuple.
    //
    // Sorted, so one compiler on one input makes the variants in one order.
    let mut declarations: Vec<(&NodeId, &Vec<crate::hir::generics::FunctionInstance>)> =
        generics.copies.iter().collect();
    declarations.sort_by_key(|(declaration, _)| declaration.0);
    for (declaration, copies) in declarations {
        for copy in copies {
            record(ClassCopy {
                declaration: *declaration,
                suffix: copy.suffix.clone(),
                instance: None,
                substitution: copy.substitution.clone(),
                sources: copy.sources.clone(),
            });
        }
    }
    found
}

/// One copy of a generic class or function: where it is written, what it is,
/// and what it binds.
#[derive(Clone, Debug)]
pub(super) struct ClassCopy {
    pub(super) declaration: NodeId,
    /// What this copy's name carries, and what a closure variant of it is
    /// keyed under. See [`ClosureInfo::within`](super::ClosureInfo::within).
    pub(super) suffix: String,
    /// The instantiation, for a class. A function's copy is named by its
    /// arguments and has no type of its own.
    pub(super) instance: Option<TypeId>,
    pub(super) substitution: Substitution,
    pub(super) sources: crate::hir::generics::Sources,
}

/// `<id>` where a type is a generic *instantiation*, and nothing otherwise.
///
/// The declaration is not one: its arguments are its own type parameters, and
/// it is never laid out — a field of type `T` has no width.
/// Whether a type is a generic **declaration** -- `Box<T>` with `T` its own
/// parameter -- rather than an instantiation of one.
///
/// The two are the same shape in the schema: both are an object type with a
/// symbol and a `type_arguments` list. What tells them apart is what is in
/// that list, and [`instantiation_suffix`] asks it the other way round so that
/// one rule answers both questions.
pub(super) fn is_a_generic_declaration(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    snapshot.type_arguments.get(&ty).is_some_and(|arguments| {
        !arguments.is_empty()
            && arguments.iter().all(|argument| {
                matches!(
                    snapshot.types.get(argument.0 as usize).map(|r| &r.kind),
                    Some(TypeKind::TypeParameter { .. })
                )
            })
    })
}
