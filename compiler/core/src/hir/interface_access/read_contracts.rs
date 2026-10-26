//! Read-only final-site projection of the existing source storage authority.
use super::{Family, Plan, storage_proofs};
use crate::hir::small_dispatch::{Answer, ReadIndex, ReadShape};
use crate::hir::{Func, HirType, ManagedType, OpKind, Program, Terminator, TypeId, ValueId};
use rustc_hash::FxHashMap;
use std::collections::{BTreeMap, BTreeSet};
use std::sync::Arc;

#[derive(Debug)]
pub struct ReadContract {
    pub function: usize,
    pub operation: ValueId,
    pub root: ValueId,
    pub receiver: ValueId,
    pub argument: Option<usize>,
    pub face: TypeId,
    pub field: u32,
    pub member: nts_semantic_schema::PropertyKey,
    pub representation: HirType,
    pub owners: Vec<(TypeId, bool)>,
    pub prefix_receivers: Vec<TypeId>,
    pub other_receivers: Vec<TypeId>,
    pub mode: &'static str,
    pub eager: bool,
    pub dependencies: Vec<usize>,
}
struct Calls {
    answer: Arc<Answer>,
    dependencies: Vec<usize>,
}
struct Field {
    owners: Vec<(TypeId, bool)>,
    representation: HirType,
    prefix: Vec<TypeId>,
    other: Vec<TypeId>,
    calls: Option<Calls>,
}
type BodyKey = (String, TypeId, nts_semantic_schema::PropertyKey, HirType);

/// The storage-body registry identifies a candidate, not its safety. Revalidate
/// only the narrow pure final getter: receiver parameter, exact typed field
/// read, return. Extra aliases, calls, fields, blocks or effects grant nothing.
fn stored_body(
    index: &ReadIndex<'_>,
    family: &Family,
    owner: TypeId,
    name: &str,
    representation: &HirType,
    cache: &mut FxHashMap<BodyKey, Option<usize>>,
) -> Option<usize> {
    let key = (
        name.to_owned(),
        owner,
        family.member.clone(),
        representation.clone(),
    );
    *cache.entry(key).or_insert_with(|| {
        let program = index.program;
        let declared = *program.interface_access.storage_bodies.get(name)?;
        let layout = index.layouts.of_class(owner)?;
        if index.layouts.of_class(declared) != Some(layout) { return None; }
        let field = program.layouts[layout].index_of_key(&family.member)?;
        let storage = program.layouts[layout].fields.get(field as usize)?;
        if &storage.ty != representation { return None; }
        let (at, body) = index.function(name)?;
        let [block] = body.blocks.as_slice() else { return None; };
        let [parameter, read] = block.ops.as_slice() else { return None; };
        let receiver = HirType::Managed(ManagedType::Object(declared));
        if body.abstract_declaration || body.params.len() != 1 || body.params[0].ty != receiver
            || body.return_type != storage.ty || !block.params.is_empty()
            || !matches!(body.value(*parameter).kind, OpKind::Param(0))
            || body.value(*parameter).ty != receiver
            || !matches!(body.value(*read).kind, OpKind::FieldGet { object, field: actual } if object == *parameter && actual == field)
            || body.value(*read).ty != storage.ty
            || !matches!(block.terminator, Terminator::Return(Some(value)) if value == *read)
        { return None; }
        Some(at)
    })
}

// Reconcile the complete planned owner population with actual rows and pure
// final storage bodies before a caller can receive a routed proof.
fn calls(
    index: &mut ReadIndex<'_>,
    family: &Family,
    owners: &[(TypeId, bool)],
    representation: &HirType,
    bodies: &mut FxHashMap<BodyKey, Option<usize>>,
) -> Option<Calls> {
    let program = index.program;
    let answer = index.answer(family.face, family.getter.slot)?;
    let mut dependencies = BTreeSet::from([stored_body(
        index,
        family,
        family.face,
        &answer.default,
        representation,
        bodies,
    )?]);
    let mut licensed_layouts = BTreeSet::new();
    // Every licensed owner is reconciled independently of PRESENT rows.
    // Missing non-prefix rows cannot silently become a positional default.
    for (owner, field_prefix) in owners {
        let at = index.layouts.of_class(*owner)?;
        licensed_layouts.insert(at);
        let layout = &program.layouts[at];
        let row = layout
            .methods
            .get(family.getter.slot as usize)
            .and_then(Option::as_deref);
        if !*field_prefix {
            let row = row?;
            if row == answer.default
                || !answer.tested.iter().any(|(classes, body)| {
                    body == row && layout.types.iter().all(|id| classes.contains(id))
                })
            {
                return None;
            }
        }
        if let Some(row) = row.filter(|name| *name != answer.default) {
            dependencies.insert(stored_body(
                index,
                family,
                *owner,
                row,
                representation,
                bodies,
            )?);
        }
    }
    // Conversely, each actual test identity/row must be licensed, with a
    // real final storage body. No arbitrary extra row supplies a proof.
    for (classes, row) in &answer.tested {
        for class in classes {
            let at = index.layouts.of_class(*class)?;
            if !licensed_layouts.contains(&at) {
                return None;
            }
            dependencies.insert(stored_body(
                index,
                family,
                *class,
                row,
                representation,
                bodies,
            )?);
        }
    }
    Some(Calls {
        answer,
        dependencies: dependencies.into_iter().collect(),
    })
}

fn field(
    index: &mut ReadIndex<'_>,
    family: &Family,
    bodies: &mut FxHashMap<BodyKey, Option<usize>>,
) -> Option<Field> {
    let program = index.program;
    let plan = &program.interface_access;
    if family.eager
        || family.pending
        || program.cast_faces.contains(&family.face)
        || family.owners.is_empty()
    {
        return None;
    }
    let at = index.layouts.of_class(family.face)?;
    let position = family.field?;
    let storage = program.layouts[at].fields.get(position as usize)?;
    if storage.name != family.member {
        return None;
    }
    let owners: Option<Vec<_>> = family
        .owners
        .iter()
        .map(|owner| {
            let candidate = index.layouts.of_class(*owner)?;
            Some((
                *owner,
                crate::hir::fields::shares_storage(
                    &program.layouts[at],
                    &program.layouts[candidate],
                    position,
                ),
            ))
        })
        .collect();
    let owners = owners?;
    let prefix = plan.prefix_receivers(family.face)?.to_vec();
    let other = plan.other_receivers(family.face)?.to_vec();
    let calls = calls(index, family, &owners, &storage.ty, bodies);
    Some(Field {
        owners,
        representation: storage.ty.clone(),
        prefix,
        other,
        calls,
    })
}

struct ActiveSites {
    faces: BTreeSet<TypeId>,
    roots: FxHashMap<ValueId, TypeId>,
    reads: FxHashMap<(TypeId, u32), Vec<(ValueId, ValueId)>>,
}

fn active_sites(func: &Func) -> Option<ActiveSites> {
    if !func.blocks.iter().flat_map(|block| &block.ops).any(|id| {
        let op = func.value(*id);
        matches!(
            (&op.kind, &op.ty),
            (
                OpKind::Unerase { .. },
                HirType::Managed(ManagedType::Object(_))
            )
        )
    }) {
        return None;
    }
    let mut faces = BTreeSet::new();
    let mut roots = FxHashMap::default();
    let mut reads: FxHashMap<(TypeId, u32), Vec<(ValueId, ValueId)>> = FxHashMap::default();
    // One indexed active-op scan per relevant function, never per family.
    for id in func.blocks.iter().flat_map(|block| &block.ops) {
        let op = func.value(*id);
        match &op.kind {
            OpKind::Unerase { .. } => {
                if let HirType::Managed(ManagedType::Object(face)) = op.ty {
                    faces.insert(face);
                    roots.insert(*id, face);
                }
            }
            OpKind::FieldGet { object, field } => {
                if let HirType::Managed(ManagedType::Object(face)) = func.value(*object).ty {
                    reads
                        .entry((face, *field))
                        .or_default()
                        .push((*id, *object));
                }
            }
            _ => {}
        }
    }
    if faces.is_empty() {
        return None;
    }
    Some(ActiveSites {
        faces,
        roots,
        reads,
    })
}

fn candidate_families(
    sites: &ActiveSites,
    shape: &ReadShape,
    plan: &Plan,
    by_slot: &BTreeMap<(TypeId, u32), Vec<usize>>,
) -> BTreeSet<usize> {
    let mut candidates = BTreeSet::new();
    for (face, position) in sites
        .reads
        .keys()
        .filter(|(face, _)| sites.faces.contains(face))
    {
        if let Some(at) = plan.by_field.get(&(*face, *position)) {
            candidates.insert(*at);
        }
    }
    for key in shape
        .candidate_slots()
        .filter(|(face, _)| sites.faces.contains(face))
    {
        candidates.extend(by_slot.get(key).into_iter().flatten().copied());
    }
    candidates
}

#[must_use]
pub fn read_contracts(program: &Program) -> Vec<ReadContract> {
    let plan = &program.interface_access;
    if !plan.materialized {
        return Vec::new();
    }
    let mut index = ReadIndex::new(program);
    let direct = storage_proofs::direct_sites(program);
    let mut by_slot: BTreeMap<(TypeId, u32), Vec<usize>> = BTreeMap::new();
    for (at, family) in plan.families.iter().enumerate() {
        by_slot
            .entry((family.face, family.getter.slot))
            .or_default()
            .push(at);
    }
    let mut fields: FxHashMap<usize, Option<Arc<Field>>> = FxHashMap::default();
    let mut bodies = FxHashMap::default();
    let mut out = Vec::new();
    for (at, func) in program.funcs.iter().enumerate() {
        let Some(sites) = active_sites(func) else {
            continue;
        };
        let ActiveSites { roots, reads, .. } = &sites;
        let shape = ReadShape::of(func, &index);
        let candidates = candidate_families(&sites, &shape, plan, &by_slot);
        for family_at in candidates {
            let family = &plan.families[family_at];
            let face = family.face;
            let cached = fields
                .entry(family_at)
                .or_insert_with(|| field(&mut index, family, &mut bodies).map(Arc::new))
                .clone();
            let Some(field) = cached else {
                continue;
            };
            let Some(position) = family.field else {
                continue;
            };
            let mut note = |operation, root, receiver, argument, mode, dependencies| {
                // This projection supports exact active Unerase roots only.
                // Same-face Param/Convert candidates grant no fact and cannot
                // poison independent supported roots in the consumer.
                if roots.get(&root) != Some(&family.face) {
                    return;
                }
                out.push(ReadContract {
                    function: at,
                    operation,
                    root,
                    receiver,
                    argument,
                    face: family.face,
                    field: position,
                    member: family.member.clone(),
                    representation: field.representation.clone(),
                    owners: field.owners.clone(),
                    prefix_receivers: field.prefix.clone(),
                    other_receivers: field.other.clone(),
                    eager: family.eager,
                    mode,
                    dependencies,
                });
            };
            for (id, object) in reads.get(&(face, position)).into_iter().flatten() {
                if func.value(*id).ty != field.representation {
                    continue;
                }
                if direct[at].contains(id) {
                    note(*id, *object, *object, None, "dominating-direct", Vec::new());
                } else if !family.stored_dispatch && field.owners.iter().all(|(_, prefix)| *prefix)
                {
                    note(*id, *object, *object, None, "stored-prefix", Vec::new());
                }
            }
            let Some(coverage) = &field.calls else {
                continue;
            };
            for (operation, receiver, root) in crate::hir::small_dispatch::matching_read_routes(
                &index,
                func,
                family.face,
                family.getter.slot,
                &coverage.answer,
                &shape,
            ) {
                note(
                    operation,
                    root,
                    receiver,
                    Some(0),
                    "validated-small-dispatch",
                    coverage.dependencies.clone(),
                );
            }
        }
    }
    out
}
