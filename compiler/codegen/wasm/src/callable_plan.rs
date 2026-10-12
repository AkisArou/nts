//! Callable sharing follows declared HIR ancestry, never matching capture shapes.

use crate::{EmitError, demand::ObjectUse, error::Failure};
use nts_core::hir::{ClassId, HirType, Program};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug, Clone)]
pub(crate) struct Entry {
    pub(crate) slot: u32,
    pub(crate) params: Vec<HirType>,
    pub(crate) result: HirType,
}
#[derive(Debug, Default)]
pub(crate) struct Plan {
    pub(crate) groups: BTreeMap<usize, BTreeMap<u32, Entry>>,
    pub(crate) members: BTreeMap<usize, usize>,
}

fn layout(program: &Program, ty: ClassId) -> Result<usize, Failure> {
    program
        .layouts
        .iter()
        .position(|l| l.types.contains(&ty))
        .ok_or_else(|| format!("callable {ty:?} has no layout").into())
}
fn root(program: &Program, mut at: usize) -> Result<usize, Failure> {
    let mut seen = BTreeSet::new();
    loop {
        if !seen.insert(at) {
            return Err(
                format!("cyclic callable ancestry of `{}`", program.layouts[at].name).into(),
            );
        }
        let Some(parent) = program.layouts[at].base else {
            return Ok(at);
        };
        at = layout(program, parent)?;
    }
}
fn entry(program: &Program, at: usize, slot: u32) -> Result<Entry, Failure> {
    let owner = &program.layouts[at];
    let name = owner
        .methods
        .get(slot as usize)
        .and_then(Option::as_ref)
        .ok_or_else(|| format!("callable `{}` declares no entry at slot {slot}", owner.name))?;
    let func = program
        .funcs
        .iter()
        .find(|f| &f.name == name)
        .ok_or_else(|| Failure::Invariant(format!("unresolved callable declaration `{name}`")))?;
    if func.params.is_empty() {
        return Err(Failure::Invariant(format!(
            "callable `{name}` has no receiver"
        )));
    }
    Ok(Entry {
        slot,
        params: func.params.iter().skip(1).map(|p| p.ty.clone()).collect(),
        result: func.return_type.clone(),
    })
}
impl Plan {
    pub(crate) fn build(
        program: &Program,
        uses: &BTreeMap<(ClassId, u32), ObjectUse>,
    ) -> Result<Self, EmitError> {
        let mut plan = Self::default();
        for (&(ty, slot), use_) in uses {
            let at = layout(program, ty)
                .and_then(|at| root(program, at))
                .map_err(|error| error.at(&use_.function, &use_.origin))?;
            let signature =
                entry(program, at, slot).map_err(|error| error.at(&use_.function, &use_.origin))?;
            plan.groups.entry(at).or_default().insert(slot, signature);
        }
        for at in 0..program.layouts.len() {
            if let Ok(root) = root(program, at)
                && plan.groups.contains_key(&root)
            {
                plan.members.insert(at, root);
            }
        }
        Ok(plan)
    }
}

pub(crate) fn check_virtual(
    program: &Program,
    types: &crate::gc::Plan,
    declarations: &BTreeMap<(ClassId, u32, String), ObjectUse>,
) -> Result<(), EmitError> {
    for ((ty, slot, declared), use_) in declarations {
        let check = || -> Result<(), Failure> {
            let storage = types
                .objects
                .object(&HirType::Managed(nts_core::hir::ManagedType::Object(*ty)))?;
            let root = storage
                .virtual_
                .ok_or_else(|| Failure::Invariant("unplanned virtual receiver".into()))?;
            let entry = types.virtuals[&root]
                .entries
                .get(slot)
                .ok_or_else(|| Failure::Invariant(format!("unplanned class slot {slot}")))?;
            let func = program
                .funcs
                .iter()
                .find(|f| &f.name == declared)
                .ok_or_else(|| {
                    Failure::Invariant(format!("unresolved virtual declaration `{declared}`"))
                })?;
            let receiver = func.params.first().ok_or_else(|| {
                Failure::Invariant(format!("virtual declaration `{declared}` has no receiver"))
            })?;
            let target = types.objects.object(&receiver.ty)?;
            if !types.objects.subtype(storage.physical, target.physical)
                || !func
                    .params
                    .iter()
                    .skip(1)
                    .map(|p| &p.ty)
                    .eq(entry.params.iter())
                || func.return_type != entry.result
            {
                return Err(format!("virtual declaration `{declared}` does not share the supported common signature of slot {slot} on `{}`", storage.name).into());
            }
            Ok(())
        };
        check().map_err(|error| error.at(&use_.function, &use_.origin))?;
    }
    Ok(())
}

#[derive(Debug)]
pub(crate) struct ResolvedEntry {
    pub(crate) slot: u32,
    pub(crate) field: u32,
    pub(crate) signature: u32,
    pub(crate) params: Vec<HirType>,
    pub(crate) result: HirType,
}
#[derive(Debug)]
pub(crate) struct Resolved {
    pub(crate) base: u32,
    pub(crate) entries: BTreeMap<u32, ResolvedEntry>,
}
