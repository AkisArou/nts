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
    /// The uniform closure entries the program calls (the erased entry and its
    /// raising twin), by slot, each with the program-wide number of erased
    /// arguments after `this`. Every callable fills them, so they belong to
    /// the callable root rather than to any one closure's group. Empty for
    /// the virtual plan.
    pub(crate) uniform: BTreeMap<u32, usize>,
}

/// Whether `slot` is one of the program's uniform closure entries.
pub(crate) fn is_uniform(program: &Program, slot: u32) -> bool {
    [program.erased_call_slot, program.raising_call_slot].contains(&Some(slot))
}

/// Whether a layout's values are function values: it fills a uniform entry,
/// or names a closure body or a signature. The JVM backend's
/// `is_callable_storage` asks the same question.
pub(crate) fn is_callable_storage(program: &Program, layout: &nts_core::hir::Layout) -> bool {
    [program.erased_call_slot, program.raising_call_slot]
        .into_iter()
        .flatten()
        .any(|slot| {
            layout
                .methods
                .get(slot as usize)
                .is_some_and(Option::is_some)
        })
        || layout.types.iter().any(|ty| {
            nts_core::hir::has_a_closure_body(*ty) || program.signature_faces.contains_key(ty)
        })
}

/// Whether a layout is a signature: callable storage that is no closure's own
/// class. A value of it is whichever closure the program stored there, so its
/// storage is the callable root itself.
pub(crate) fn is_signature(program: &Program, layout: &nts_core::hir::Layout) -> bool {
    is_callable_storage(program, layout)
        && !layout
            .types
            .iter()
            .any(|ty| nts_core::hir::is_closure_type(*ty))
}

/// The number of erased arguments after `this` a uniform entry takes, read off
/// the functions that fill it: lowering builds every one at one program-wide
/// width, and anything else is refused rather than guessed.
fn uniform_width(program: &Program, slot: u32) -> Result<usize, Failure> {
    let widths = program
        .layouts
        .iter()
        .filter_map(|layout| layout.methods.get(slot as usize)?.as_ref())
        .filter_map(|name| program.funcs.iter().find(|f| &f.name == name))
        .map(|func| func.params.len().saturating_sub(1))
        .collect::<BTreeSet<_>>();
    match widths.len() {
        1 => Ok(widths.into_iter().next().unwrap_or_default()),
        0 => Err(Failure::Invariant(format!(
            "no callable fills uniform slot {slot}"
        ))),
        _ => Err(format!("uniform closure slot {slot} has entries of {widths:?} arguments").into()),
    }
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
    /// The plan for closure calls (`closures`) or virtual calls. Only a
    /// closure plan has uniform slots: a class's virtual slot may share their
    /// index without being one.
    pub(crate) fn build(
        program: &Program,
        uses: &BTreeMap<(ClassId, u32), ObjectUse>,
        closures: bool,
    ) -> Result<Self, EmitError> {
        let mut plan = Self::default();
        for (&(ty, slot), use_) in uses {
            if closures && is_uniform(program, slot) {
                let width = uniform_width(program, slot)
                    .map_err(|error| error.at(&use_.function, &use_.origin))?;
                plan.uniform.insert(slot, width);
                continue;
            }
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
