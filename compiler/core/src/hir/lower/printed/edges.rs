//! Source identities behind the descriptor's implicit calls. Built before
//! throw analysis and shared with descriptor selection and conversion lowering,
//! so an implicit call cannot select a different exception entry in each phase.

use std::{cell::RefCell, collections::BTreeSet, rc::Rc, sync::Arc};

use nts_semantic_schema::{NodeId, SemanticSnapshot, TypeId, TypeKind};
use rustc_hash::{FxHashMap, FxHashSet};

use super::super::{FuncBuilder, Hierarchy, HirType, ManagedType, Reached, syntax};

#[derive(Default)]
pub(in crate::hir::lower) struct Plan {
    pub targets: Vec<Target>,
    by_class: FxHashMap<TypeId, Option<usize>>,
    all: Rc<[usize]>,
    by_type: RefCell<FxHashMap<TypeId, Rc<[usize]>>>,
    sites: FxHashMap<NodeId, Rc<[usize]>>,
    raising_entries: RefCell<FxHashMap<Vec<usize>, Arc<[String]>>>,
}

pub(in crate::hir::lower) struct Target {
    pub declaration: NodeId,
    pub symbol: u32,
    pub name: String,
}

pub(in crate::hir::lower) enum ClassTarget<'a> {
    Default,
    Unavailable,
    Method(&'a Target),
}

impl Target {
    pub(in crate::hir::lower) fn entry_name(&self, raises: bool) -> String {
        if raises {
            format!("{}{}", self.name, super::super::RAISING_SUFFIX)
        } else {
            self.name.clone()
        }
    }
}

impl Plan {
    /// Possible raising entries, shared across conversions with the same source
    /// candidates. This is not availability: only `Program::printed` settles
    /// which of these functions actually exists and is a descriptor callback.
    pub(in crate::hir::lower) fn raising_entries(
        &self,
        candidates: &[usize],
        throwing: &FxHashSet<u32>,
    ) -> Arc<[String]> {
        if let Some(entries) = self.raising_entries.borrow().get(candidates) {
            return entries.clone();
        }
        let entries: Arc<[String]> = candidates
            .iter()
            .filter_map(|at| {
                let target = &self.targets[*at];
                throwing
                    .contains(&target.symbol)
                    .then(|| target.entry_name(true))
            })
            .collect::<Vec<_>>()
            .into();
        self.raising_entries
            .borrow_mut()
            .insert(candidates.to_vec(), entries.clone());
        entries
    }

    pub(in crate::hir::lower) fn new(probe: &FuncBuilder<'_>) -> Self {
        let mut plan = Self::default();
        let mut classes: Vec<TypeId> = probe.hierarchy.name.keys().copied().collect();
        classes.sort();
        let mut named = FxHashMap::default();
        // Method declarations carry their symbol on the name child. The
        // declaration index also covers computed or otherwise unnamed nodes.
        let declarations: FxHashMap<NodeId, u32> = probe
            .snapshot
            .symbols
            .iter()
            .enumerate()
            .filter_map(|(at, symbol)| u32::try_from(at).ok().map(|at| (at, symbol)))
            .flat_map(|(at, symbol)| symbol.declarations.iter().map(move |node| (*node, at)))
            .collect();
        for ty in classes {
            if probe.hierarchy.faces.contains(&ty) {
                continue;
            }
            let Some(owner) = probe.hierarchy.declaring(ty, "toString") else {
                continue;
            };
            plan.by_class.insert(ty, None);
            let Some(name) = probe.hierarchy.name.get(&owner) else {
                continue;
            };
            let name = format!("{name}#toString");
            let Some(declaration) = probe.member_declaration(owner, "toString") else {
                continue;
            };
            let declaration = probe.implementation_of(declaration);
            let symbol = probe
                .name_node(declaration)
                .and_then(|name| probe.node(name).symbol.map(|symbol| symbol.0))
                .or_else(|| declarations.get(&declaration).copied());
            let Some(symbol) = symbol else {
                continue;
            };
            let index = *named.entry(name.clone()).or_insert_with(|| {
                let at = plan.targets.len();
                plan.targets.push(Target {
                    declaration,
                    symbol,
                    name,
                });
                at
            });
            plan.by_class.insert(ty, Some(index));
        }
        plan.all = (0..plan.targets.len()).collect::<Vec<_>>().into();
        if plan.targets.is_empty() {
            return plan;
        }
        for (at, _) in probe.snapshot.nodes.iter().enumerate() {
            let Ok(at) = u32::try_from(at) else {
                break;
            };
            let node = NodeId(at);
            let mut targets: Rc<[usize]> = Rc::default();
            for input in conversion_inputs(probe, node) {
                let found = probe.snapshot.node_types.get(&input).map_or_else(
                    || plan.all.clone(),
                    |ty| plan.for_type(probe.snapshot, &probe.hierarchy, *ty),
                );
                if targets.is_empty() || found.len() == plan.all.len() {
                    targets = found;
                } else if !found.is_empty() && !Rc::ptr_eq(&targets, &found) {
                    targets = targets
                        .iter()
                        .chain(found.iter())
                        .copied()
                        .collect::<BTreeSet<_>>()
                        .into_iter()
                        .collect::<Vec<_>>()
                        .into();
                }
            }
            if !targets.is_empty() {
                plan.sites.insert(node, targets);
            }
        }
        plan
    }

    pub(in crate::hir::lower) fn class_target(&self, ty: TypeId) -> ClassTarget<'_> {
        match self.by_class.get(&ty) {
            None => ClassTarget::Default,
            Some(None) => ClassTarget::Unavailable,
            Some(Some(at)) => ClassTarget::Method(&self.targets[*at]),
        }
    }

    pub(in crate::hir::lower) fn potential_calls(
        &self,
        node: NodeId,
    ) -> impl Iterator<Item = Reached> {
        self.at(node)
            .iter()
            .map(|at| Reached::Printer(self.targets[*at].symbol))
    }

    pub(in crate::hir::lower) fn at(&self, node: NodeId) -> &[usize] {
        self.sites.get(&node).map_or(&[], Rc::as_ref)
    }

    fn for_value(
        &self,
        snapshot: &SemanticSnapshot,
        hierarchy: &Hierarchy,
        ty: &HirType,
    ) -> Rc<[usize]> {
        match ty {
            HirType::Erased => self.all.clone(),
            HirType::Managed(ManagedType::Object(ty))
                if ty.0 < crate::hir::SYNTHETIC_TYPE_FLOOR =>
            {
                self.for_type(snapshot, hierarchy, *ty)
            }
            HirType::Managed(ManagedType::Array(element)) => {
                self.for_value(snapshot, hierarchy, element)
            }
            _ => Rc::default(),
        }
    }

    pub(in crate::hir::lower) fn for_conversion(
        &self,
        probe: &FuncBuilder<'_>,
        from: NodeId,
        ty: &HirType,
    ) -> Rc<[usize]> {
        let represented = self.for_value(probe.snapshot, &probe.hierarchy, ty);
        let Some(source) = probe.snapshot.node_types.get(&from) else {
            return represented;
        };
        let source = self.for_type(probe.snapshot, &probe.hierarchy, *source);
        if represented.is_empty() || source.len() == self.all.len() {
            return represented;
        }
        if source.is_empty() || represented.len() == self.all.len() {
            return source;
        }
        represented
            .iter()
            .filter(|at| source.binary_search(at).is_ok())
            .copied()
            .collect::<Vec<_>>()
            .into()
    }

    fn for_type(
        &self,
        snapshot: &SemanticSnapshot,
        hierarchy: &Hierarchy,
        ty: TypeId,
    ) -> Rc<[usize]> {
        if let Some(answer) = self.by_type.borrow().get(&ty) {
            return answer.clone();
        }
        let mut found = BTreeSet::new();
        let mut pending = vec![ty];
        let mut seen = BTreeSet::new();
        while let Some(at) = pending.pop() {
            if !seen.insert(at) {
                continue;
            }
            match snapshot.types.get(at.0 as usize).map(|record| &record.kind) {
                Some(TypeKind::Array(element)) => pending.push(*element),
                Some(TypeKind::Union(members) | TypeKind::Intersection(members)) => {
                    pending.extend(members);
                }
                Some(TypeKind::Object { .. })
                    if hierarchy.name.contains_key(&at) && !hierarchy.faces.contains(&at) =>
                {
                    found.extend(self.by_class.iter().filter_map(|(class, target)| {
                        hierarchy.descends(*class, at).then_some(*target).flatten()
                    }));
                }
                Some(TypeKind::TypeParameter {
                    constraint: Some(constraint),
                    ..
                }) => {
                    pending.push(*constraint);
                }
                Some(
                    TypeKind::Any
                    | TypeKind::Unknown
                    | TypeKind::Evolving
                    | TypeKind::Object { .. }
                    | TypeKind::TypeParameter {
                        constraint: None, ..
                    }
                    | TypeKind::Conditional { .. }
                    | TypeKind::IndexedAccess { .. }
                    | TypeKind::Structured { .. }
                    | TypeKind::Unsupported { .. },
                )
                | None => found.extend(self.all.iter().copied()),
                // A tuple refuses its printing representation, a function has
                // compiler-supplied text, and primitives run no program printer.
                Some(
                    TypeKind::Never
                    | TypeKind::Void
                    | TypeKind::Undefined
                    | TypeKind::Null
                    | TypeKind::Boolean
                    | TypeKind::Number
                    | TypeKind::BigInt
                    | TypeKind::String
                    | TypeKind::Symbol
                    | TypeKind::Literal(_)
                    | TypeKind::Tuple(_)
                    | TypeKind::Function(_)
                    | TypeKind::TemplateLiteral { .. },
                ) => {}
            }
        }
        let answer: Rc<[usize]> = found.into_iter().collect::<Vec<_>>().into();
        self.by_type.borrow_mut().insert(ty, answer.clone());
        answer
    }
}

/// Only the existing language conversion points, not generic coercion,
/// inspection, property-key primitive formatting or future `ToPrimitive` work.
fn conversion_inputs(probe: &FuncBuilder<'_>, node: NodeId) -> Vec<NodeId> {
    match probe.kind_of(node) {
        Some(syntax::CALL_EXPRESSION | syntax::NEW_EXPRESSION) => {
            let Some(callee) = probe.children(node).first().copied() else {
                return Vec::new();
            };
            let name = probe.literal_name(callee);
            let builtin_string = name.as_deref() == Some("String")
                && probe
                    .snapshot
                    .call_targets
                    .get(&node)
                    .is_some_and(|target| target.callee.is_none());
            let error = name.as_deref().is_some_and(crate::hir::builtin::is_error)
                && probe
                    .snapshot
                    .call_targets
                    .get(&node)
                    .is_some_and(|target| target.callee.is_none());
            let error_super = if probe.kind_of(callee) == Some(syntax::SUPER_KEYWORD) {
                probe
                    .enclosing_class(node)
                    .and_then(|class| super::super::instance_type_of(probe.snapshot, class))
                    .and_then(|ty| {
                        let named = probe
                            .hierarchy
                            .base
                            .get(&ty)
                            .and_then(|base| probe.hierarchy.constructor(*base))
                            .and_then(|base| probe.hierarchy.name.get(&base));
                        if named.is_none() {
                            probe.provided_error_base(ty)
                        } else {
                            None
                        }
                    })
            } else {
                None
            };
            if builtin_string || error || error_super.is_some() {
                let aggregate = name.as_deref() == Some("AggregateError")
                    || error_super.as_deref() == Some("AggregateError");
                return probe
                    .arguments_of(node)
                    .get(usize::from(aggregate))
                    .copied()
                    .into_iter()
                    .collect();
            }
            Vec::new()
        }
        Some(syntax::TEMPLATE_SPAN) => probe.children(node).first().copied().into_iter().collect(),
        Some(syntax::BINARY_EXPRESSION) => {
            let children = probe.children(node);
            let [left, operator, right] = children.as_slice() else {
                return Vec::new();
            };
            if matches!(
                probe.kind_of(*operator),
                Some(syntax::PLUS_TOKEN | syntax::PLUS_EQUALS_TOKEN)
            ) && [node, *left, *right]
                .into_iter()
                .any(|at| probe.type_of(at) == Some(HirType::Managed(ManagedType::String)))
            {
                return vec![*left, *right];
            }
            Vec::new()
        }
        _ => Vec::new(),
    }
}
