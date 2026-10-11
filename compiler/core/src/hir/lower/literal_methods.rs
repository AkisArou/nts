//! Concrete method supplies for objects built at a contextual record type.
//!
//! One layout serves every literal built at that type. An inferred interface
//! edge therefore needs every initial supply and later write to fit, using
//! the actual function's signature rather than the contextual method's.
use rustc_hash::{FxHashMap, FxHashSet};

use super::interfaces::{self, Contract};
use super::{FuncBuilder, Hierarchy, NodeId, NodeKind, PropertyRecord, TypeId, TypeKind, syntax};

mod adapters;
mod values;
pub(super) use adapters::declare;

#[derive(Debug, Clone, Default)]
pub(super) struct Supplies {
    owners: FxHashMap<TypeId, Vec<NodeId>>,
    allocations: FxHashMap<NodeId, TypeId>,
    writes: FxHashMap<(TypeId, Option<String>), Vec<NodeId>>,
    mixed: FxHashSet<TypeId>,
    functions: Option<std::sync::Arc<super::closed_calls::Functions>>,
    value_only: FxHashSet<(NodeId, u32)>,
    legacy: FxHashSet<TypeId>,
}

impl Supplies {
    pub(super) fn register(&mut self, owner: TypeId, literal: NodeId, stands_alone: bool) {
        self.owners.entry(owner).or_default().push(literal);
        self.allocations.insert(literal, owner);
        if !stands_alone {
            self.mixed.insert(owner);
        }
    }

    pub(super) fn owners(&self) -> impl Iterator<Item = TypeId> + '_ {
        self.owners.keys().copied()
    }

    pub(super) fn contains(&self, owner: TypeId) -> bool {
        self.owners.contains_key(&owner)
    }

    /// An unknown computed write may replace any member of this owner.
    pub(super) fn collect_writes(&mut self, probe: &FuncBuilder, faces: &FxHashSet<TypeId>) {
        if self.owners.is_empty() {
            return;
        }
        let functions = super::closed_calls::Functions::collect(probe);
        (self.value_only, self.legacy) = values::collect(probe, &functions, faces, self);
        self.functions = Some(std::sync::Arc::new(functions));
        for node in &probe.snapshot.nodes {
            if node.kind != NodeKind::Syntax(syntax::BINARY_EXPRESSION) {
                continue;
            }
            let [left, operator, right] = node.children.as_slice() else {
                continue;
            };
            if probe.kind_of(*operator) != Some(syntax::EQUALS_TOKEN) {
                continue;
            }
            let left = probe.through_assertions(*left);
            let (object, member) = match probe.member_access(left) {
                Some((object, member)) => (object, Some(member)),
                None if probe.kind_of(left) == Some(syntax::ELEMENT_ACCESS_EXPRESSION) => {
                    let Some(object) = probe.children(left).first().copied() else {
                        continue;
                    };
                    (object, None)
                }
                _ => continue,
            };
            let object = probe.through_assertions(object);
            let mut receivers = self
                .allocated_receiver(probe, object, 0)
                .unwrap_or_else(|| {
                    probe.snapshot.node_types.get(&object).map_or_else(
                        || self.owners().collect(),
                        |owner| self.receivers(probe, *owner, 0),
                    )
                });
            receivers.sort_unstable_by_key(|owner| owner.0);
            receivers.dedup();
            for owner in receivers {
                self.writes
                    .entry((owner, member.clone()))
                    .or_default()
                    .push(*right);
            }
        }
    }

    pub(super) fn closed_functions(&self) -> Option<&super::closed_calls::Functions> {
        self.functions.as_deref()
    }

    pub(super) fn method_values_only(&self, callee: NodeId, position: u32) -> bool {
        self.value_only.contains(&(callee, position))
    }

    pub(super) fn is_legacy(&self, face: TypeId) -> bool {
        self.legacy.contains(&face)
    }

    /// The pre-1c all-or-none guard, retained only for legacy faces. A literal
    /// owner without a direct class table prevented inferring this face.
    pub(super) fn legacy_blocks(
        &self,
        probe: &FuncBuilder,
        classes: &[TypeId],
        wanted: &[PropertyRecord],
    ) -> bool {
        self.owners.keys().any(|owner| {
            classes
                .binary_search_by_key(&owner.0, |class| class.0)
                .is_err()
                && wanted.iter().all(|member| {
                    member.optional
                        || interfaces::property(probe.snapshot, *owner, &member.name).is_some()
                })
        })
    }

    /// An immutable alias to a freshly allocated literal has that literal's
    /// identity, even through an erased or differently named face. Conversely,
    /// a fresh empty object cannot replace a method on another allocation.
    fn allocated_receiver(
        &self,
        probe: &FuncBuilder,
        source: NodeId,
        depth: u32,
    ) -> Option<Vec<TypeId>> {
        if depth >= 16 {
            return None;
        }
        let source = probe.through_assertions(source);
        match probe.kind_of(source)? {
            syntax::OBJECT_LITERAL_EXPRESSION => {
                Some(self.allocations.get(&source).copied().into_iter().collect())
            }
            syntax::IDENTIFIER => {
                self.allocated_receiver(probe, immutable_initializer(probe, source)?, depth + 1)
            }
            _ => None,
        }
    }

    fn receivers(&self, probe: &FuncBuilder, ty: TypeId, depth: u32) -> Vec<TypeId> {
        if depth >= 16 {
            return self.owners().collect();
        }
        if self.contains(ty) {
            return vec![ty];
        }
        if matches!(
            probe.represent(ty),
            Some(super::HirType::Managed(super::ManagedType::Table(_, _)))
        ) {
            // A pure dictionary uses table storage rather than a record's
            // fields. Assertions were removed above, so an erased record
            // asserted to be a dictionary still participates in the census.
            return Vec::new();
        }
        match &probe
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| &record.kind)
        {
            Some(TypeKind::Union(arms) | TypeKind::Intersection(arms)) => arms
                .iter()
                .flat_map(|arm| self.receivers(probe, *arm, depth + 1))
                .collect(),
            Some(TypeKind::Object { properties }) => self
                .owners()
                .filter(|owner| {
                    properties.iter().all(|property| {
                        property.optional
                            || interfaces::property(probe.snapshot, *owner, &property.name)
                                .is_some()
                    })
                })
                .collect(),
            Some(TypeKind::Any | TypeKind::Unknown | TypeKind::Structured { .. }) | None => {
                self.owners().collect()
            }
            _ => Vec::new(),
        }
    }

    pub(super) fn fits(
        &self,
        probe: &FuncBuilder,
        hierarchy: &Hierarchy,
        owner: TypeId,
        wanted: &PropertyRecord,
    ) -> bool {
        let Some(property) = interfaces::property(probe.snapshot, owner, &wanted.name) else {
            return false;
        };
        let stored = hierarchy.stores(owner, &wanted.name) || property.kind.is_stored();
        if stored && self.mixed.contains(&owner) {
            // A class supplying the same contextual face need not have this
            // closure field. It must not inherit the literal's inferred edge.
            return false;
        }
        if property
            .declaration
            .and_then(|at| probe.syntactic_parent(at))
            .is_some_and(|at| probe.kind_of(at).is_some_and(super::declares_a_class))
        {
            // Literals typed as declared classes do not change their tables;
            // a class property holding a function remains outside this plan.
            return false;
        }
        let Some(contract) = interfaces::contract(probe, wanted) else {
            return false;
        };
        if stored && !adapters::can_check_result(probe.snapshot, &contract.returns) {
            return false;
        }
        let Some(literals) = self.owners.get(&owner) else {
            return false;
        };
        let initial = literals.iter().all(|literal| {
            if probe
                .children(*literal)
                .iter()
                .any(|at| probe.kind_of(*at) == Some(syntax::SPREAD_ASSIGNMENT))
            {
                // A spread can replace the method after its explicit supply.
                // No contextual signature proves what that field will hold.
                return false;
            }
            let member = probe
                .children(*literal)
                .into_iter()
                .find(|member| probe.member_name(*member).as_deref() == Some(wanted.name.as_str()));
            member.is_some_and(|member| {
                if probe.kind_of(member) == Some(syntax::METHOD_DECLARATION) {
                    initial_contract(probe, *literal, member).is_some_and(|mine| {
                        interfaces::fits_contracts(probe.snapshot, hierarchy, &mine, &contract)
                    })
                } else if matches!(
                    probe.kind_of(member),
                    Some(syntax::PROPERTY_ASSIGNMENT | syntax::SHORTHAND_PROPERTY_ASSIGNMENT)
                ) {
                    probe.children(member).last().is_some_and(|source| {
                        self.source_fits(probe, hierarchy, *source, &contract, 0)
                    })
                } else {
                    false
                }
            })
        });
        initial
            && [Some(wanted.name.clone()), None].iter().all(|name| {
                self.writes
                    .get(&(owner, name.clone()))
                    .into_iter()
                    .flatten()
                    .all(|source| self.source_fits(probe, hierarchy, *source, &contract, 0))
            })
    }

    /// Concrete functions and immutable aliases prove their authored contract.
    /// A helper parameter proves it only through every known incoming supply;
    /// its contextual method signature alone permits unsafe bivariance.
    fn source_fits(
        &self,
        probe: &FuncBuilder,
        hierarchy: &Hierarchy,
        source: NodeId,
        wanted: &Contract,
        depth: u32,
    ) -> bool {
        if depth >= 16 {
            return false;
        }
        let source = probe.through_assertions(source);
        if let Some(mine) = callable_contract(probe, source, 0) {
            return interfaces::fits_contracts(probe.snapshot, hierarchy, &mine, wanted);
        }
        if probe.kind_of(source) != Some(syntax::IDENTIFIER) {
            return false;
        }
        if let Some(initializer) = immutable_initializer(probe, source) {
            return self.source_fits(probe, hierarchy, initializer, wanted, depth + 1);
        }
        self.closed_functions()
            .and_then(|functions| functions.inputs(probe, source))
            .is_some_and(|inputs| {
                inputs
                    .into_iter()
                    .all(|input| self.source_fits(probe, hierarchy, input, wanted, depth + 1))
            })
    }

    /// A direct body is emitted at the allocation owner's name, even when
    /// the contextual interface inherits the method's signature elsewhere.
    fn declares_direct(&self, probe: &FuncBuilder, owner: TypeId, member: &str) -> bool {
        self.owners.get(&owner).is_some_and(|literals| {
            literals.iter().all(|literal| {
                probe.children(*literal).into_iter().any(|at| {
                    probe.kind_of(at) == Some(syntax::METHOD_DECLARATION)
                        && probe.member_name(at).as_deref() == Some(member)
                })
            })
        })
    }
}

/// A method value through another face would require extracting the original
/// closure across layouts. A fresh bound wrapper would silently change `===`.
pub(super) fn supplies_method_value(probe: &FuncBuilder, face: TypeId, member: &str) -> bool {
    !probe.hierarchy.literal_methods.is_legacy(face)
        && probe.hierarchy.declaring(face, member).is_some()
        && probe.hierarchy.literal_methods.owners().any(|owner| {
            owner != face
                && probe.hierarchy.descends_from(owner, face)
                && probe.literal_member_is_storage(owner, member)
        })
}

fn initial_contract(probe: &FuncBuilder, literal: NodeId, member: NodeId) -> Option<Contract> {
    match probe.kind_of(member)? {
        syntax::METHOD_DECLARATION => {
            let name = probe.member_name(member)?;
            let actual = *probe.snapshot.node_types.get(&literal)?;
            let property = interfaces::property(probe.snapshot, actual, &name)?;
            interfaces::contract_at(probe, property.ty, Some(member))
        }
        syntax::PROPERTY_ASSIGNMENT | syntax::SHORTHAND_PROPERTY_ASSIGNMENT => {
            callable_contract(probe, *probe.children(member).last()?, 0)
        }
        _ => None,
    }
}

/// Only a concrete authored function or an immutable alias proves a supply.
/// A parameter or mutable binding may hold a bivariantly narrowed method; its
/// contextual callable signature cannot vouch for every closure that arrives.
fn callable_contract(probe: &FuncBuilder, source: NodeId, depth: u32) -> Option<Contract> {
    if depth >= 16 {
        return None;
    }
    let source = probe.through_assertions(source);
    match probe.kind_of(source)? {
        syntax::ARROW_FUNCTION | syntax::FUNCTION_EXPRESSION => {
            let ty = *probe.snapshot.node_types.get(&source)?;
            interfaces::contract_at(probe, ty, Some(source))
        }
        syntax::IDENTIFIER => {
            callable_contract(probe, immutable_initializer(probe, source)?, depth + 1)
        }
        _ => None,
    }
}

fn immutable_initializer(probe: &FuncBuilder, source: NodeId) -> Option<NodeId> {
    let symbol = probe.node(source).symbol?;
    let declarations = &probe.snapshot.symbols.get(symbol.0 as usize)?.declarations;
    let declaration = declarations.iter().copied().find(|at| {
        probe.kind_of(*at) == Some(syntax::VARIABLE_DECLARATION)
            && probe.declaration_kind(*at) == nts_semantic_schema::VariableKind::Const
    })?;
    let children = probe.children(declaration);
    let name = *children.first()?;
    super::declaration_initializer(&children, name, |at| probe.kind_of(at))
}

/// Lowering calls a closure field at a literal owner, even when the checker
/// resolved a method signature. Exception analysis must use that same answer,
/// including the retyped receiver of a structural specialization.
pub(super) fn stored_call(probe: &FuncBuilder, call: NodeId) -> bool {
    if probe.kind_of(call) != Some(syntax::CALL_EXPRESSION) {
        return false;
    }
    let Some(callee) = probe.children(call).first().copied() else {
        return false;
    };
    let Some((receiver, member)) = probe.member_access(probe.through_assertions(callee)) else {
        return false;
    };
    let effective = probe
        .node(receiver)
        .symbol
        .and_then(|symbol| probe.retyped_symbols.get(&symbol.0))
        .cloned()
        .or_else(|| probe.type_of(receiver));
    let Some(super::HirType::Managed(super::ManagedType::Object(owner))) = effective else {
        return false;
    };
    probe.hierarchy.literal_methods.contains(owner)
        && probe.literal_member_is_storage(owner, &member)
}

/// Every literal method uses its proven interface table entry. Retyping a
/// caller from source would bypass the slot's raising, absence and result
/// contract, or specialize a bivariantly narrowed input as an integer.
pub(super) fn uses_dispatch(probe: &FuncBuilder, owner: TypeId, face: TypeId) -> bool {
    owner != face
        && !probe.hierarchy.literal_methods.is_legacy(face)
        && probe.hierarchy.faces.contains(&face)
        && probe.hierarchy.literal_methods.contains(owner)
        && probe
            .hierarchy
            .declares
            .get(&face)
            .is_some_and(|methods| !methods.is_empty())
}

/// The body a row names: a concrete method or the current closure field of
/// this literal's own allocation layout, forwarded at the target slot's ABI.
#[derive(Debug, Clone)]
pub(super) enum TableTarget {
    Direct(String),
    StoredLiteral {
        owner: TypeId,
        root: TypeId,
        field: u32,
        member: String,
    },
}

impl TableTarget {
    pub(super) fn name(&self, probe: &FuncBuilder) -> String {
        match self {
            Self::Direct(name) => name.clone(),
            Self::StoredLiteral {
                owner,
                root,
                member,
                ..
            } => {
                let (plain, suffix) = super::without_the_raising_suffix(member);
                let name = super::nominal_or_stand_in(probe.snapshot, *owner);
                format!(
                    "{name}{}#{plain}@field${}_${}{suffix}",
                    super::instantiation_suffix(probe.snapshot, *owner),
                    owner.0,
                    root.0
                )
            }
        }
    }
}

pub(super) fn target(
    probe: &FuncBuilder,
    owner: TypeId,
    root: TypeId,
    member: &str,
    fields: &[super::Field],
) -> Option<TableTarget> {
    let hierarchy = &probe.hierarchy;
    let (plain, suffix) = super::without_the_raising_suffix(member);
    if hierarchy.faces.contains(&root)
        && !hierarchy.literal_methods.is_legacy(root)
        && hierarchy.literal_methods.contains(owner)
        && probe.literal_member_is_storage(owner, plain)
    {
        let field = fields.iter().position(|field| field.name == plain)?;
        return Some(TableTarget::StoredLiteral {
            owner,
            root,
            field: u32::try_from(field).ok()?,
            member: member.to_owned(),
        });
    }
    if hierarchy
        .literal_methods
        .declares_direct(probe, owner, plain)
    {
        let name = hierarchy.name.get(&owner).cloned().unwrap_or_else(|| {
            format!(
                "{}{}",
                super::nominal_or_stand_in(probe.snapshot, owner),
                super::instantiation_suffix(probe.snapshot, owner)
            )
        });
        return Some(TableTarget::Direct(format!("{name}#{plain}{suffix}")));
    }
    let declared = hierarchy.declaring(owner, plain)?;
    let name = hierarchy.name.get(&declared)?;
    Some(TableTarget::Direct(format!("{name}#{plain}{suffix}")))
}
