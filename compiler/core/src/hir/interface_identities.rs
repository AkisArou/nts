//! Interface declaration identity survives structural storage sharing.

use std::collections::BTreeMap;

use nts_semantic_schema::{SemanticSnapshot, SymbolFlags, TypeId};
use rustc_hash::FxHashSet;

use super::{InterfaceIdentity, Program};

/// Record used instantiations of the hierarchy's semantic interfaces.
/// A class augmented by an interface remains a class; library interfaces that
/// represent provided classes (notably Error) are not hierarchy faces.
pub(super) fn collect(
    snapshot: &SemanticSnapshot,
    faces: &FxHashSet<TypeId>,
    program: &mut Program,
) {
    let declared: FxHashSet<u32> = faces
        .iter()
        .filter_map(|ty| interface_symbol(snapshot, *ty))
        .collect();
    let mut identities: BTreeMap<u32, InterfaceIdentity> = BTreeMap::new();
    for ty in program.layouts.iter().flat_map(|layout| &layout.types) {
        let Some(symbol) = interface_symbol(snapshot, *ty) else {
            continue;
        };
        if !declared.contains(&symbol) {
            continue;
        }
        identities
            .entry(symbol)
            .or_insert_with(|| InterfaceIdentity {
                symbol,
                name: snapshot.symbols[symbol as usize].name.clone(),
                types: Vec::new(),
            })
            .types
            .push(*ty);
    }
    for identity in identities.values_mut() {
        identity.types.sort_unstable();
        identity.types.dedup();
    }
    program.interface_identities = identities.into_values().collect();
}

fn interface_symbol(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<u32> {
    let symbol = snapshot.types.get(ty.0 as usize)?.symbol?;
    let flags = snapshot.symbols.get(symbol.0 as usize)?.flags;
    (flags.contains(SymbolFlags::INTERFACE) && !flags.contains(SymbolFlags::CLASS))
        .then_some(symbol.0)
}
