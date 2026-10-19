//! Table-only default getters can share a native body without reading a record.
//!
//! Their explicit source role only admits a candidate. Prepared IR must prove
//! a single unused managed-object argument and a constant undefined result.
//! All object arguments have the same native pointer ABI; their layout is
//! irrelevant only because the body reads none of it. JVM identities remain.

use crate::hir::{Callee, Func, HirType, ManagedType, OpKind, Program, Terminator};
use rustc_hash::FxHashSet;
use std::collections::BTreeMap;

pub(super) fn aliases(program: &Program, columns: &[Option<u32>]) -> BTreeMap<String, String> {
    let forbidden = referenced_outside_tables(program);
    let live: FxHashSet<_> = program
        .layouts
        .iter()
        .flat_map(|layout| {
            layout
                .methods
                .iter()
                .enumerate()
                .filter(|(slot, _)| columns.get(*slot).is_some_and(Option::is_some))
                .filter_map(|(_, name)| name.as_deref())
        })
        .collect();
    let mut groups: BTreeMap<bool, Vec<&str>> = BTreeMap::new();
    for func in &program.funcs {
        if live.contains(func.name.as_str())
            && !forbidden.contains(func.name.as_str())
            && pure(func)
            && let Some(raising) = program.interface_access.default_bodies.get(&func.name)
        {
            groups.entry(*raising).or_default().push(&func.name);
        }
    }
    let mut aliases = BTreeMap::new();
    for names in groups.values_mut() {
        names.sort_unstable();
        let Some((first, rest)) = names.split_first() else {
            continue;
        };
        for name in rest {
            aliases.insert((*name).to_owned(), (*first).to_owned());
        }
    }
    aliases
}

fn pure(func: &Func) -> bool {
    if func.abstract_declaration
        || func.initializes_receiver
        || func.async_result.is_some()
        || func.frame.is_some()
        || func.params.len() != 1
        || func.return_type != HirType::Erased
        || !matches!(func.params[0].ty, HirType::Managed(ManagedType::Object(_)))
        || func.blocks.len() != 1
    {
        return false;
    }
    let Terminator::Return(Some(value)) = func.blocks[0].terminator else {
        return false;
    };
    func.values
        .get(value.0 as usize)
        .is_some_and(|op| matches!(op.kind, OpKind::ConstUndefined))
        && func
            .values
            .iter()
            .all(|op| matches!(op.kind, OpKind::Param(0) | OpKind::ConstUndefined))
}

fn referenced_outside_tables(program: &Program) -> FxHashSet<&str> {
    let mut names: FxHashSet<_> =
        crate::hir::reachable::root_names(program, crate::hir::reachable::Roots::EveryExport)
            .into_iter()
            .collect();
    names.extend(program.public_api.iter().map(|(name, _)| name.as_str()));
    let published: FxHashSet<_> = program
        .public_api
        .iter()
        .map(|(name, _)| name.as_str())
        .collect();
    names.extend(program.funcs.iter().filter_map(|func| {
        func.name
            .split_once('#')
            .is_some_and(|(owner, _)| published.contains(owner))
            .then_some(func.name.as_str())
    }));
    names.extend(
        program
            .public_namespaces
            .iter()
            .flat_map(|(_, properties)| properties.iter().map(|(_, name)| name.as_str())),
    );
    names.extend(program.printing_functions());
    for func in &program.funcs {
        for op in &func.values {
            match &op.kind {
                OpKind::Call {
                    callee: Callee::Direct(name),
                    ..
                }
                | OpKind::Suspend { resume: name, .. } => {
                    names.insert(name);
                }
                OpKind::NativeBridge {
                    closure, bridging, ..
                } => {
                    names.extend(
                        bridging
                            .converted
                            .iter()
                            .map(|entry| entry.function.as_str()),
                    );
                    if let Some(HirType::Managed(ManagedType::Object(ty))) =
                        func.values.get(closure.0 as usize).map(|op| &op.ty)
                        && let Some(layout) = program
                            .layouts
                            .iter()
                            .find(|layout| layout.types.contains(ty))
                        && let Some(entry) = layout.closure_call()
                    {
                        names.insert(entry);
                    }
                }
                _ => {}
            }
        }
    }
    names
}
