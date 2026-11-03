//! Publish source identity while the semantic producer still owns it.
use super::{Hierarchy, SemanticSnapshot, TypeId, named_class_source};
use crate::hir::{
    DispatchMember, DispatchRoot, MemberAccessor, OpKind, Program, SourcePosition,
    StaticDeclaration, StaticValueKind as Kind, StaticValueSource, StaticValueVariant,
    SymbolSource,
};
use nts_semantic_schema::{NodeKind, TypeKind, syntax};
use std::collections::btree_map::Entry;

fn named_source(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<crate::hir::NamedClassSource> {
    let record = snapshot.types.get(ty.0 as usize)?;
    let symbol = record.symbol?;
    let binding = snapshot.symbols.get(symbol.0 as usize)?;
    let captured = binding
        .declarations
        .iter()
        .find_map(|&declaration| named_class_source(snapshot, declaration, symbol.0));
    if captured.is_some() {
        return captured;
    }
    // Library declarations have owned locators without captured syntax. The
    // checked global binding supplies the name; its declaration supplies the
    // module, independently of use sites and semantic arena numbering.
    let global = crate::hir::features::global_binding(
        &snapshot.symbols,
        symbol,
        crate::hir::features::GlobalMeaning::Type,
    )
    .ok()??;
    let declaration = global
        .record()
        .declaration_sites
        .iter()
        .filter_map(|&site| snapshot.declaration_identity(site))
        .min_by(|left, right| left.source.path.cmp(&right.source.path))?;
    Some(crate::hir::NamedClassSource {
        symbol: global.symbol().0,
        module: declaration.source.path.to_string(),
        scopes: vec![global.name().to_owned()],
    })
}

fn type_arguments(snapshot: &SemanticSnapshot, ty: TypeId) -> &[TypeId] {
    let arguments = snapshot
        .type_arguments
        .get(&ty)
        .map_or(&[][..], Vec::as_slice);
    snapshot
        .reference_parameter_counts
        .get(&ty)
        .and_then(|&count| arguments.get(..count as usize))
        .unwrap_or(arguments)
}

fn type_identity(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    first: &rustc_hash::FxHashMap<TypeId, nts_semantic_schema::NodeId>,
    locations: &mut nts_diagnostics::SourceLocations<'_>,
    active: &mut rustc_hash::FxHashSet<TypeId>,
) -> crate::hir::TypeIdentity {
    use crate::hir::TypeIdentity as Identity;
    if !active.insert(ty) {
        return named_source(snapshot, ty).map_or(Identity::Unavailable(ty), Identity::Recursive);
    }
    let result = if let Some(source) = named_source(snapshot, ty) {
        Identity::Named(
            source,
            type_arguments(snapshot, ty)
                .iter()
                .map(|&ty| type_identity(snapshot, ty, first, locations, active))
                .collect(),
        )
    } else if let Some(record) = snapshot.types.get(ty.0 as usize) {
        let primitive = match record.kind {
            TypeKind::Any => Some("any"),
            TypeKind::Unknown => Some("unknown"),
            TypeKind::Never => Some("never"),
            TypeKind::Void => Some("void"),
            TypeKind::Undefined => Some("undefined"),
            TypeKind::Null => Some("null"),
            TypeKind::Boolean => Some("boolean"),
            TypeKind::Number => Some("number"),
            TypeKind::BigInt => Some("bigint"),
            TypeKind::String => Some("string"),
            TypeKind::Symbol => Some("symbol"),
            TypeKind::NonPrimitive => Some("object"),
            _ => None,
        };
        if let Some(kind) = primitive {
            Identity::Intrinsic(kind)
        } else {
            match &record.kind {
                TypeKind::Literal(value) => Identity::Literal(value.clone()),
                TypeKind::Array(element) => Identity::Array(Box::new(type_identity(
                    snapshot, *element, first, locations, active,
                ))),
                TypeKind::Tuple(tuple) => Identity::Tuple(
                    tuple
                        .element_flags
                        .iter()
                        .copied()
                        .zip(&tuple.elements)
                        .map(|(kind, &ty)| {
                            (kind, type_identity(snapshot, ty, first, locations, active))
                        })
                        .collect(),
                ),
                TypeKind::Union(types) => Identity::Union(
                    types
                        .iter()
                        .map(|&ty| type_identity(snapshot, ty, first, locations, active))
                        .collect(),
                ),
                TypeKind::Intersection(types) => Identity::Intersection(
                    types
                        .iter()
                        .map(|&ty| type_identity(snapshot, ty, first, locations, active))
                        .collect(),
                ),
                _ => first
                    .get(&ty)
                    .and_then(|node| snapshot.nodes.get(node.0 as usize))
                    .and_then(|node| locations.source_position(&node.origin.location))
                    .map_or(Identity::Unavailable(ty), |(module, line, column)| {
                        Identity::Site(SourcePosition {
                            module,
                            line,
                            column,
                        })
                    }),
            }
        }
    } else {
        Identity::Unavailable(ty)
    };
    active.remove(&ty);
    result
}

fn first_uses(
    snapshot: &SemanticSnapshot,
) -> rustc_hash::FxHashMap<TypeId, nts_semantic_schema::NodeId> {
    let mut first_uses = rustc_hash::FxHashMap::default();
    for (&node, &ty) in &snapshot.node_types {
        first_uses
            .entry(ty)
            .and_modify(|first: &mut nts_semantic_schema::NodeId| *first = (*first).min(node))
            .or_insert(node);
    }
    first_uses
}

pub(super) fn dispatch(snapshot: &SemanticSnapshot, hierarchy: &Hierarchy, program: &mut Program) {
    use crate::hir::member_key::Accessor;
    program.member_origins.generator_resume = hierarchy.generator_slot;
    let roots: rustc_hash::FxHashSet<_> =
        hierarchy.slots.keys().map(|(root, _, _)| *root).collect();
    let first_uses = first_uses(snapshot);
    let mut locations = nts_diagnostics::SourceLocations::new(&snapshot.sources);
    let identities: rustc_hash::FxHashMap<_, _> = roots
        .into_iter()
        .map(|root| {
            let identity = if let Some(name) = hierarchy
                .provided_errors
                .get(&root)
                .and_then(|&index| crate::hir::PROVIDED_ERROR_NAMES.get(index))
            {
                DispatchRoot::Provided((*name).to_owned())
            } else if let Some(source) = named_source(snapshot, root) {
                DispatchRoot::Named {
                    source,
                    arguments: type_arguments(snapshot, root)
                        .iter()
                        .map(|&ty| {
                            type_identity(
                                snapshot,
                                ty,
                                &first_uses,
                                &mut locations,
                                &mut rustc_hash::FxHashSet::default(),
                            )
                        })
                        .collect(),
                }
            } else {
                let binding = snapshot
                    .types
                    .get(root.0 as usize)
                    .and_then(|record| record.symbol)
                    .and_then(|symbol| snapshot.symbols.get(symbol.0 as usize));
                if binding.is_some_and(|binding| binding.declarations.is_empty())
                    && !super::is_anonymous_shape(snapshot, root)
                {
                    DispatchRoot::Unavailable(root)
                } else {
                    let source = binding
                        .and_then(|binding| binding.declarations.first())
                        .or_else(|| first_uses.get(&root))
                        .and_then(|node| snapshot.nodes.get(node.0 as usize))
                        .and_then(|node| locations.source_position(&node.origin.location))
                        .map(|(module, line, column)| SourcePosition {
                            module,
                            line,
                            column,
                        });
                    DispatchRoot::Anonymous { id: root, source }
                }
            };
            (root, identity)
        })
        .collect();
    program.member_origins.dispatch = hierarchy
        .slots
        .iter()
        .map(|((root, member, raising), &slot)| {
            (
                slot,
                DispatchMember {
                    root: identities[root].clone(),
                    key: member.key.clone(),
                    raising: *raising,
                    ordinary_slot: if *raising {
                        hierarchy
                            .slots
                            .get(&(*root, member.clone(), false))
                            .copied()
                    } else {
                        None
                    },
                    accessor: match member.accessor {
                        Accessor::Method => MemberAccessor::Method,
                        Accessor::Get => MemberAccessor::Get,
                        Accessor::Set => MemberAccessor::Set,
                    },
                },
            )
        })
        .collect();
}

fn position(
    locations: &mut nts_diagnostics::SourceLocations<'_>,
    at: &nts_diagnostics::Location,
) -> Option<SourcePosition> {
    locations
        .source_position(at)
        .map(|(module, line, column)| SourcePosition {
            module,
            line,
            column,
        })
}

fn symbol_sources(
    snapshot: &SemanticSnapshot,
    locations: &mut nts_diagnostics::SourceLocations<'_>,
    program: &mut Program,
) {
    let mut first_uses = std::collections::BTreeMap::new();
    for (&node, &ty) in &snapshot.node_types {
        if snapshot
            .types
            .get(ty.0 as usize)
            .is_some_and(|record| record.kind == TypeKind::UniqueSymbol)
        {
            first_uses
                .entry(ty)
                .and_modify(|first: &mut nts_semantic_schema::NodeId| *first = (*first).min(node))
                .or_insert(node);
        }
    }
    for (at, record) in snapshot.types.iter().enumerate() {
        if record.kind != TypeKind::UniqueSymbol {
            continue;
        }
        let ty = TypeId(u32::try_from(at).unwrap_or(u32::MAX));
        let source = if let Some((&well_known, _)) = snapshot
            .well_known_symbols
            .iter()
            .find(|(_, key)| **key == ty)
        {
            SymbolSource::WellKnown(well_known)
        } else if let Some(source) = named_source(snapshot, ty) {
            SymbolSource::Named(source)
        } else if record.symbol.is_some() {
            SymbolSource::Unavailable
        } else {
            let site = first_uses
                .get(&ty)
                .copied()
                .and_then(|id| snapshot.nodes.get(id.0 as usize))
                .and_then(|node| position(locations, &node.origin.location));
            SymbolSource::Anonymous(site)
        };
        program.member_origins.symbols.insert(ty, source);
    }
}

fn closure_binding(
    snapshot: &SemanticSnapshot,
    declarations: &rustc_hash::FxHashMap<
        nts_semantic_schema::NodeId,
        nts_semantic_schema::SymbolId,
    >,
    node: nts_semantic_schema::NodeId,
) -> Option<crate::hir::NamedClassSource> {
    let node_record = snapshot.nodes.get(node.0 as usize)?;
    let parent = node_record.parent.filter(|parent| {
        snapshot.nodes.get(parent.0 as usize).is_some_and(|parent| {
            matches!(
                parent.kind,
                NodeKind::Syntax(
                    syntax::VARIABLE_DECLARATION
                        | syntax::PROPERTY_ASSIGNMENT
                        | syntax::PROPERTY_DECLARATION
                        | syntax::PARAMETER
                )
            )
        })
    });
    let declaration = parent.unwrap_or(node);
    if parent.is_none()
        && matches!(
            node_record.kind,
            NodeKind::Syntax(syntax::ARROW_FUNCTION | syntax::FUNCTION_EXPRESSION)
        )
    {
        return None;
    }
    let symbol = snapshot
        .nodes
        .get(declaration.0 as usize)?
        .symbol
        .or_else(|| declarations.get(&declaration).copied())?;
    named_class_source(snapshot, declaration, symbol.0)
}

fn declaration(
    snapshot: &SemanticSnapshot,
    declarations: &rustc_hash::FxHashMap<
        nts_semantic_schema::NodeId,
        nts_semantic_schema::SymbolId,
    >,
    node: nts_semantic_schema::NodeId,
    locations: &mut nts_diagnostics::SourceLocations<'_>,
) -> StaticDeclaration {
    let Some(record) = snapshot.nodes.get(node.0 as usize) else {
        return StaticDeclaration::Unavailable;
    };
    record
        .symbol
        .or_else(|| declarations.get(&node).copied())
        .and_then(|symbol| named_class_source(snapshot, node, symbol.0))
        .map(StaticDeclaration::Named)
        .or_else(|| position(locations, &record.origin.location).map(StaticDeclaration::Site))
        .unwrap_or(StaticDeclaration::Unavailable)
}

fn closure_variant(
    snapshot: &SemanticSnapshot,
    declarations: &rustc_hash::FxHashMap<
        nts_semantic_schema::NodeId,
        nts_semantic_schema::SymbolId,
    >,
    closure: &super::ClosureInfo,
    first: &rustc_hash::FxHashMap<TypeId, nts_semantic_schema::NodeId>,
    locations: &mut nts_diagnostics::SourceLocations<'_>,
) -> StaticValueVariant {
    let Some(copy) = &closure.within_copy else {
        return if closure.within.is_none() {
            StaticValueVariant::Original
        } else {
            // closure_variants only creates these when a captured binding was
            // retyped. They are real per-evaluation objects, never singletons.
            StaticValueVariant::Captured
        };
    };
    let mut arguments: Vec<_> = copy.sources.iter().collect();
    arguments.sort_by_key(|(parameter, _)| **parameter);
    StaticValueVariant::Instantiation {
        owner: declaration(snapshot, declarations, copy.declaration, locations),
        instance: copy.instance.map(|ty| {
            type_identity(
                snapshot,
                ty,
                first,
                locations,
                &mut rustc_hash::FxHashSet::default(),
            )
        }),
        arguments: arguments
            .into_iter()
            .map(|(&parameter, &ty)| {
                let owner = named_source(snapshot, parameter)
                    .map_or(StaticDeclaration::Unavailable, StaticDeclaration::Named);
                (
                    owner,
                    type_identity(
                        snapshot,
                        ty,
                        first,
                        locations,
                        &mut rustc_hash::FxHashSet::default(),
                    ),
                )
            })
            .collect(),
    }
}

fn closure_sources(
    snapshot: &SemanticSnapshot,
    closures: &[super::ClosureInfo],
    namespaces: &[Option<TypeId>],
    locations: &mut nts_diagnostics::SourceLocations<'_>,
    program: &mut Program,
) {
    let first = first_uses(snapshot);
    let declarations: rustc_hash::FxHashMap<_, _> = snapshot
        .symbols
        .iter()
        .enumerate()
        .flat_map(|(at, symbol)| {
            let at =
                nts_semantic_schema::SymbolId(u32::try_from(at).expect("snapshot symbol index"));
            symbol.declarations.iter().map(move |&node| (node, at))
        })
        .collect();
    for (index, closure) in closures.iter().enumerate() {
        let declaration = closure_binding(snapshot, &declarations, closure.node)
            .map(StaticDeclaration::Named)
            .or_else(|| {
                snapshot
                    .nodes
                    .get(closure.node.0 as usize)
                    .and_then(|node| position(locations, &node.origin.location))
                    .map(StaticDeclaration::Site)
            })
            .unwrap_or(StaticDeclaration::Unavailable);
        let kind = match closure.source {
            super::ClosureSource::Authored => Kind::Authored,
            super::ClosureSource::Function => Kind::Function,
            super::ClosureSource::Method => Kind::Method,
            super::ClosureSource::Job {
                calls: super::Then::Method(_),
                ..
            } => Kind::ThenMethod,
            super::ClosureSource::Job {
                calls: super::Then::Function,
                ..
            } => Kind::ThenFunction,
            super::ClosureSource::Resolving { rejects: false } => Kind::Resolve,
            super::ClosureSource::Resolving { rejects: true } => Kind::Reject,
            super::ClosureSource::Reaction => Kind::Reaction,
            super::ClosureSource::ModuleJob { .. } => Kind::ModuleJob,
            super::ClosureSource::Bound => Kind::Bound,
        };
        // The job and the namespace it fulfils with have one actual module
        // owner. Its payload type comes from the same module-role producer
        // lower_module_job consumes, independently of any rendered name.
        if let super::ClosureSource::ModuleJob { module } = closure.source
            && let Some(namespace) = namespaces.get(module).copied().flatten()
        {
            let source = StaticValueSource {
                declaration: declaration.clone(),
                kind: Kind::ModuleNamespace,
                variant: StaticValueVariant::Original,
            };
            match program.member_origins.values.entry(namespace) {
                Entry::Vacant(entry) => {
                    entry.insert(source);
                }
                Entry::Occupied(entry) => debug_assert_eq!(
                    entry.get(),
                    &source,
                    "a module namespace has conflicting source owners"
                ),
            }
        }
        program.member_origins.values.insert(
            super::closure_type(index),
            StaticValueSource {
                declaration,
                kind,
                variant: closure_variant(snapshot, &declarations, closure, &first, locations),
            },
        );
    }
}

fn token_sources(snapshot: &SemanticSnapshot, naming: &super::Naming, program: &mut Program) {
    for (&symbol, &index) in &naming.class_tokens {
        let declaration = snapshot
            .symbols
            .get(symbol as usize)
            .and_then(|record| record.declarations.first())
            .and_then(|&node| named_class_source(snapshot, node, symbol))
            .map_or(StaticDeclaration::Unavailable, StaticDeclaration::Named);
        program.member_origins.values.insert(
            crate::hir::class_token(index),
            StaticValueSource {
                declaration,
                kind: Kind::ClassToken,
                variant: StaticValueVariant::Original,
            },
        );
    }
    for (index, name) in crate::hir::PROVIDED_ERROR_NAMES.iter().enumerate() {
        program.member_origins.values.insert(
            crate::hir::constructor_token(index),
            StaticValueSource {
                declaration: StaticDeclaration::Provided((*name).to_owned()),
                kind: Kind::ProvidedConstructor,
                variant: StaticValueVariant::Original,
            },
        );
    }
}

fn template_sources(
    snapshot: &SemanticSnapshot,
    locations: &mut nts_diagnostics::SourceLocations<'_>,
    program: &mut Program,
) {
    for func in &program.funcs {
        for op in &func.values {
            if let OpKind::ConstTemplate { site, .. } = op.kind {
                let at = snapshot
                    .nodes
                    .get(site as usize)
                    .map_or(&op.origin.location, |node| &node.origin.location);
                program
                    .member_origins
                    .templates
                    .entry(site)
                    .or_insert_with(|| position(locations, at));
            }
        }
    }
}

pub(super) fn sources(
    snapshot: &SemanticSnapshot,
    closures: &[super::ClosureInfo],
    namespaces: &[Option<TypeId>],
    naming: &super::Naming,
    program: &mut Program,
) {
    let mut locations = nts_diagnostics::SourceLocations::new(&snapshot.sources);
    symbol_sources(snapshot, &mut locations, program);
    closure_sources(snapshot, closures, namespaces, &mut locations, program);
    token_sources(snapshot, naming, program);
    template_sources(snapshot, &mut locations, program);
}
