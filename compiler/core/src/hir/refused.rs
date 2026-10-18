//! A body refused by the compiler cannot become an empty dispatch slot.

use rustc_hash::{FxHashMap, FxHashSet};

use super::{
    Block, Callee, Func, HirType, ManagedType, Op, OpKind, Origin, Program, Terminator, ValueId,
};

/// The same named stop for guarded interface fields and refused virtual bodies.
pub(super) fn stop(func: &mut Func, message: String, origin: &Origin) -> Block {
    let what = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
    func.values.push(Op {
        kind: OpKind::ConstString(message),
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

/// A virtual call needs its declared ABI even when another receiver supplies
/// the body. Only a *recorded refusal* makes an absent virtual declaration a
/// dependency; abstract/interface declarations are not missing direct calls.
/// Shared by the cascade and initializer excision, so they cannot disagree.
pub(super) fn missing_callee<'a>(
    callee: &'a Callee,
    present: &FxHashSet<String>,
    refused: &FxHashSet<String>,
) -> Option<&'a str> {
    let name = match callee {
        Callee::Direct(name) => name,
        Callee::Virtual { declared, .. } if refused.contains(declared) => declared,
        _ => return None,
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
    // Slots are program-wide (lower::number_slots). The same declared contract
    // that dispatch::check uses, with source-order fallback for a row no call
    // currently enters, is enough to type a body that never returns.
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
    let mut names: FxHashSet<String> = program.funcs.iter().map(|func| func.name.clone()).collect();
    names.extend(program.uncompiled.iter().map(|(name, _)| name.clone()));
    let mut added = Vec::new();
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
            let Some(contract) = contracts.get(&slot).map(|at| &program.funcs[*at]) else {
                continue;
            };
            if contract.params.is_empty() {
                continue;
            }
            let mut name = format!("{}#nts$refused${slot}", layout.name);
            while !names.insert(name.clone()) {
                name.push('$');
            }
            let func = stopped_entry(
                name.clone(),
                contract,
                *receiver,
                format!("`{method}` was refused: {reason}"),
            );
            added.push((owner, slot, name, func));
        }
    }
    for (owner, slot, name, func) in added {
        program.layouts[owner].methods[slot] = Some(name);
        program.funcs.push(func);
    }
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
    };
    let block = stop(&mut func, message, &contract.origin);
    func.blocks.push(block);
    func
}
