//! A body refused by the compiler cannot become an empty dispatch slot.

use rustc_hash::{FxHashMap, FxHashSet};

use super::{
    Block, Callee, Func, HirType, ManagedType, Op, OpKind, Origin, Program, Terminator, ValueId,
};

/// The same named stop for guarded interface fields and refused virtual bodies.
pub(super) fn stop(func: &mut Func, message: String, origin: &Origin) -> Block {
    let what = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
    func.values.push(Op {
        kind: OpKind::ConstString(message.into()),
        ty: HirType::Managed(ManagedType::String),
        origin: origin.clone(),
    });
    let stop = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
    func.values.push(Op {
        kind: OpKind::Call {
            callee: Callee::External("nts_refused".to_owned()),
            args: vec![what],
            frame: None,
        },
        ty: HirType::Void,
        origin: origin.clone(),
    });
    Block {
        params: Vec::new(),
        ops: vec![what, stop],
        terminator: Terminator::Unreachable,
    }
}

/// The existing direct-call dependency rule, shared by cascade and initializer
/// excision. Missing virtual declarations keep their backend refusal: changing
/// that frontier also changes which callers are pruned.
pub(super) fn missing_callee<'a>(
    callee: &'a Callee,
    present: &FxHashSet<String>,
) -> Option<&'a str> {
    let Callee::Direct(name) = callee else {
        return None;
    };
    (!present.contains(name)).then_some(name)
}

/// Fill each refused ordinary receiver's slot at the slot's declared ABI.
/// Run before pruning clears missing names. The original name stays absent:
/// a direct call or closure still takes the existing refusal cascade.
pub(super) fn guard_slots(program: &mut Program) {
    if program.uncompiled.is_empty() {
        return;
    }
    let by_name: FxHashMap<&str, usize> = program
        .funcs
        .iter()
        .enumerate()
        .map(|(at, func)| (func.name.as_str(), at))
        .collect();
    let mut reasons = FxHashMap::default();
    for (name, reason) in &program.uncompiled {
        reasons.entry(name.as_str()).or_insert(reason.as_str());
    }
    // Slots are program-wide (lower::number_slots), but a subclass can drop
    // parameters. Keep a fallback contract for chains with no surviving entry;
    // prefer each receiver's actual inherited ABI below.
    let contracts = fallback_contracts(program, &by_name);
    let mut names: FxHashSet<String> = program.funcs.iter().map(|func| func.name.clone()).collect();
    names.extend(program.uncompiled.iter().map(|(name, _)| name.clone()));
    let layouts = super::fields::LayoutIndex::build(program);
    let mut chain_contracts = FxHashMap::default();
    let mut added = Vec::new();
    let mut guarded = GuardedEntries {
        names,
        chosen: FxHashMap::default(),
        bodies: Vec::new(),
        proofs: std::collections::BTreeMap::new(),
    };
    for (owner, layout) in program.layouts.iter().enumerate() {
        // A closure with a refused body is rejected when it is constructed,
        // not repaired by making an otherwise uncallable closure constructible.
        if layout
            .types
            .iter()
            .any(|ty| super::has_a_closure_body(*ty) || program.signature_faces.contains_key(ty))
        {
            continue;
        }
        let Some(receiver) = layout.types.first() else {
            continue;
        };
        for (slot, entry) in layout.methods.iter().enumerate() {
            let Some(method) = entry.as_deref() else {
                continue;
            };
            let Some(reason) = reasons.get(method) else {
                continue;
            };
            if by_name
                .get(method)
                .is_some_and(|at| !program.funcs[*at].abstract_declaration)
            {
                continue;
            }
            let inherited = layout
                .base
                .and_then(|base| layouts.of_class(base))
                .and_then(|base| {
                    contract_in_chain(
                        program,
                        &layouts,
                        &by_name,
                        &mut chain_contracts,
                        base,
                        slot,
                    )
                });
            let Some(contract_at) = inherited.or_else(|| contracts.get(&slot).copied()) else {
                // No live virtual call declares this slot and no layout has a
                // surviving signature/body for it. An emitter rejects a call
                // without its declared ABI before dispatch; keep that existing
                // refusal frontier. Prune removes the missing name as before.
                continue;
            };
            let contract = &program.funcs[contract_at];
            if contract.params.is_empty() {
                continue;
            }
            let func = guarded.entry(
                (owner, method, contract_at),
                (*receiver, &layout.name),
                slot,
                contract,
                reason,
            );
            added.push((owner, slot, func.name.clone()));
        }
    }
    let GuardedEntries { bodies, proofs, .. } = guarded;
    for (owner, slot, name) in added {
        program.layouts[owner].methods[slot] = Some(name);
    }
    program.funcs.extend(bodies);
    program.guarded_dispatch.extend(proofs);
}

/// Reuse is a repeated original entry, not equivalence between stopped bodies.
/// The original name chooses the same first reason; the exact live contract
/// index includes every signature/origin/absence obligation without re-keying.
struct GuardedEntries<'a> {
    names: FxHashSet<String>,
    chosen: FxHashMap<(usize, &'a str, usize), usize>,
    bodies: Vec<Func>,
    proofs: std::collections::BTreeMap<String, super::GuardedDispatch>,
}

impl<'a> GuardedEntries<'a> {
    fn entry(
        &mut self,
        key: (usize, &'a str, usize),
        receiver: (super::TypeId, &str),
        slot: usize,
        contract: &Func,
        reason: &str,
    ) -> &Func {
        let (receiver, owner_name) = receiver;
        let at = if let Some(&at) = self.chosen.get(&key) {
            at
        } else {
            // A dispatch entry is not a source member. published_classes
            // must not mistake a stop for a surviving source Class#member.
            let mut name = format!("nts$refused${owner_name}${slot}");
            while !self.names.insert(name.clone()) {
                name.push('$');
            }
            let at = self.bodies.len();
            self.bodies.push(stopped_entry(
                name,
                contract,
                receiver,
                format!("`{}` was refused: {reason}", key.1),
            ));
            self.chosen.insert(key, at);
            at
        };
        let func = &self.bodies[at];
        if let Ok(slot) = u32::try_from(slot) {
            self.proofs
                .entry(func.name.clone())
                .or_insert_with(|| super::GuardedDispatch {
                    original: key.1.to_owned(),
                    contract: contract.name.clone(),
                    receiver,
                    slots: std::collections::BTreeSet::new(),
                })
                .slots
                .insert(slot);
        }
        func
    }
}

/// A removed/retargeted entry loses its optional provenance, never its reason.
/// One table scan, only in programs with guarded entries.
pub(super) fn retain_guarded(program: &mut Program) {
    if program.guarded_dispatch.is_empty() {
        return;
    }
    let live: FxHashSet<&str> = program
        .funcs
        .iter()
        .map(|func| func.name.as_str())
        .collect();
    let mut slots: FxHashMap<&str, FxHashSet<u32>> = FxHashMap::default();
    for layout in &program.layouts {
        for (slot, name) in layout.methods.iter().enumerate() {
            if let Some(name) = name.as_deref()
                && program.guarded_dispatch.contains_key(name)
                && let Ok(slot) = u32::try_from(slot)
            {
                slots.entry(name).or_default().insert(slot);
            }
        }
    }
    program.guarded_dispatch.retain(|name, proof| {
        proof.slots.retain(|slot| {
            slots
                .get(name.as_str())
                .is_some_and(|live| live.contains(slot))
        });
        live.contains(name.as_str())
            && live.contains(proof.contract.as_str())
            && !proof.slots.is_empty()
    });
}

#[cfg(test)]
mod entry_reuse_tests;

/// A declared contract for a slot with no surviving ancestor signature. Keep
/// virtual-call declarations first, followed by source-order layout entries.
fn fallback_contracts(
    program: &Program,
    by_name: &FxHashMap<&str, usize>,
) -> FxHashMap<usize, usize> {
    let mut contracts = FxHashMap::default();
    for func in &program.funcs {
        for op in func
            .blocks
            .iter()
            .flat_map(|block| &block.ops)
            .map(|id| func.value(*id))
        {
            if let OpKind::Call {
                callee: Callee::Virtual { slot, declared },
                ..
            } = &op.kind
                && let Some(at) = by_name.get(declared.as_str())
            {
                contracts.entry(*slot as usize).or_insert(*at);
            }
        }
    }
    for layout in &program.layouts {
        for (slot, entry) in layout.methods.iter().enumerate() {
            if let Some(at) = entry.as_deref().and_then(|name| by_name.get(name)) {
                contracts.entry(slot).or_insert(*at);
            }
        }
    }
    contracts
}

/// First surviving signature in this inheritance chain. Cache intermediate
/// rows too: many refused descendants can share the same missing ancestors.
fn contract_in_chain(
    program: &Program,
    layouts: &super::fields::LayoutIndex,
    by_name: &FxHashMap<&str, usize>,
    contracts: &mut FxHashMap<(usize, usize), Option<usize>>,
    start: usize,
    slot: usize,
) -> Option<usize> {
    let mut at = Some(start);
    let mut path = Vec::new();
    let answer = loop {
        let Some(owner) = at else { break None };
        if let Some(answer) = contracts.get(&(owner, slot)) {
            break *answer;
        }
        // Also terminates a malformed cyclic base chain without recursion.
        contracts.insert((owner, slot), None);
        path.push(owner);
        let layout = &program.layouts[owner];
        if let Some(at) = layout
            .methods
            .get(slot)
            .and_then(Option::as_deref)
            .and_then(|name| by_name.get(name))
        {
            break Some(*at);
        }
        at = layout.base.and_then(|base| layouts.of_class(base));
    };
    for owner in path {
        contracts.insert((owner, slot), answer);
    }
    answer
}

/// Only the signature survives; a refused entry never executes the original body.
fn stopped_entry(name: String, contract: &Func, receiver: super::TypeId, message: String) -> Func {
    let mut params = contract.params.clone();
    params[0].ty = HirType::Managed(ManagedType::Object(receiver));
    let values = params
        .iter()
        .enumerate()
        .map(|(at, param)| Op {
            kind: OpKind::Param(u32::try_from(at).unwrap_or(u32::MAX)),
            ty: param.ty.clone(),
            origin: param.origin.clone(),
        })
        .collect();
    // Copy only the signature, never the contract's whole body.
    let mut func = Func {
        name,
        params,
        return_type: contract.return_type.clone(),
        written_return: contract.written_return,
        written_return_elements: contract.written_return_elements.clone(),
        result_absent: contract.result_absent,
        values,
        blocks: Vec::new(),
        origin: contract.origin.clone(),
        exported: false,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        exact: rustc_hash::FxHashMap::default(),
    };
    let block = stop(&mut func, message, &contract.origin);
    func.blocks.push(block);
    func
}
