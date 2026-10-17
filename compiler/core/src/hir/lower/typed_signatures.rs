//! Calls through a signature that take its typed entry.
//!
//! A call through a value typed only as a function type cannot know which
//! closure arrives, so 519195e49 sent every such call to the erased (uniform)
//! entry: the cure for the misread where the arriving closures disagree about
//! the ABI, and a box per call where they do not. `closure-merge` went from
//! `invokevirtual call:(D)D` to an `NtsValue` allocated per call on the JVM,
//! 2,262 ns to 32,426 ns, and doubled C's row.
//!
//! **The decision is per signature layout**, because a layout is what every
//! backend dispatches through: the signature `S` (`Fn{params}__{ret}`, keyed
//! by the checker's types, so identical function types are one layout) is the
//! base of each closure class made at it, and its typed entry is the slot
//! `closure_slot` declares on it. Wasm stores the entry on `S`'s own struct and
//! has single inheritance, which is why a class reaching a second signature
//! cannot take part, and why the rule is one rule for every backend rather
//! than one each backend degrades on its own.
//!
//! `S` is typed ([`Program::typed_signatures`]) where:
//! - every layout extending `S` is a closure class whose `#call` takes exactly
//!   `S`'s parameter representations and returns `S`'s, or an object of a
//!   class descending from `S`'s result class (the one widening every backend
//!   bridges for nothing: the JVM's covariant bridge, Wasm's ref upcast), and
//!   does not read its own `this`;
//! - every closure recorded arriving at `S` is one of those;
//! - and nothing reaches `S` without a record: no unerase into it, no exported
//!   parameter of it, no conversion from another signature, no object that is
//!   not a closure of it.
//!
//! Then each non-raising call through `S` that passes exactly `S`'s parameter
//! representations becomes `Callee::Closure { slot: closure_slot }` with the
//! written arguments: no erase, no padding, and no unerase of the answer.
//!
//! **A limit, stated:** one closure that disagrees anywhere keeps its
//! signature uniform everywhere, since the decision is the layout's. Telling
//! apart the values that can only hold agreeing closures is a flow question
//! this does not ask yet.

use super::{
    Arrivals, ClosureInfo, ClosureSource, Hierarchy, SemanticSnapshot, TypeId, UniformSite,
    closure_index, closure_names, is_signature_name, representation, signature_key,
};
use crate::hir::typed_signatures::{descends, entries_from_elsewhere, layout_of};
use crate::hir::{
    Callee, Func, HirType, ManagedType, Op, OpKind, Program, ValueId, operands_of,
    operands_of_terminator,
};

/// A signature's written ABI: its parameters' representations, then its
/// result's.
struct Abi {
    params: Vec<HirType>,
    returns: HirType,
    defaulted: Vec<bool>,
}

/// Make the calls through every signature that can take its typed entry take
/// it, and say which signatures those are ([`Program::typed_signatures`]).
pub(super) fn type_signature_calls(
    snapshot: &SemanticSnapshot,
    closures: &[ClosureInfo],
    hierarchy: &Hierarchy,
    arrivals: &Arrivals,
    program: &mut Program,
) {
    let Some(slot) = hierarchy.closure_slot else {
        return;
    };
    let typed = typed_layouts(snapshot, closures, arrivals, program, slot as usize);
    let mut called = std::collections::BTreeSet::new();
    for site in &arrivals.uniform_sites {
        if let Some(at) = layout_of(program, site.signature)
            && let Some(abi) = typed.get(&at)
            && rewrite(program, site, abi, slot)
        {
            called.insert(at);
        }
    }
    // Only a signature something now calls typed is published: the set is
    // what changes a backend's representation of the signature's values, and
    // one no site reads would change it for nothing.
    for at in called {
        let abi = &typed[&at];
        if let Some(name) = program.layouts[at]
            .methods
            .get(slot as usize)
            .cloned()
            .flatten()
            && let Some(entry) = program.funcs.iter_mut().find(|func| func.name == name)
        {
            entry.return_type = abi.returns.clone();
        }
        let name = program.layouts[at].name.clone();
        program.typed_signatures.insert(name);
    }
}

/// Each signature layout whose calls can be typed, with its ABI.
fn typed_layouts(
    snapshot: &SemanticSnapshot,
    closures: &[ClosureInfo],
    arrivals: &Arrivals,
    program: &Program,
    slot: usize,
) -> rustc_hash::FxHashMap<usize, Abi> {
    let unknown = entered_without_a_record(program, arrivals);
    let mut typed = rustc_hash::FxHashMap::default();
    for (at, layout) in program.layouts.iter().enumerate() {
        if !is_signature_name(&layout.name) || unknown.contains(&at) {
            continue;
        }
        let Some(mut abi) = abi_of(snapshot, layout.types.first().copied()) else {
            continue;
        };
        if declared_at(program, at, &abi, slot)
            && agrees_everywhere(closures, arrivals, program, at, &abi)
        {
            // A signature may contain both defaulted and ordinary closures.
            // Every defaulted position must keep its entry unless this site
            // proves the default cannot run.
            for from in 0..program.layouts.len() {
                if from != at
                    && descends(program, from, at)
                    && let Some(index) = closure_of(program, closures, from)
                    && let Some(body) = program
                        .funcs
                        .iter()
                        .find(|func| func.name == closure_names(index).1)
                {
                    for (position, parameter) in body.params.iter().skip(1).enumerate() {
                        if parameter.shape == crate::hir::ParamShape::Defaulted {
                            abi.defaulted[position] = true;
                        }
                    }
                }
            }
            typed.insert(at, abi);
        }
    }
    typed
}

/// A signature's ABI from its checker type, the same representation every
/// call through it spells; none where a part has no representation.
fn abi_of(snapshot: &SemanticSnapshot, ty: Option<TypeId>) -> Option<Abi> {
    let (params, returns) = signature_key(snapshot, ty?)?;
    Some(Abi {
        defaulted: vec![false; params.len()],
        params: params
            .iter()
            .map(|param| representation(snapshot, *param))
            .collect::<Option<_>>()?,
        returns: representation(snapshot, returns)?,
    })
}

/// Whether the signature's typed entry is declared, at its own parameters.
///
/// The declaration is cloned from a closure related to the signature
/// (`relate_closures_to_signatures`), which [`agrees_everywhere`] then
/// requires to take exactly these: so a mismatch here is a declaration made
/// from something else, and the signature stays uniform.
fn declared_at(program: &Program, at: usize, abi: &Abi, slot: usize) -> bool {
    let Some(name) = program.layouts[at].methods.get(slot).cloned().flatten() else {
        return false;
    };
    program
        .funcs
        .iter()
        .find(|func| func.name == name)
        .is_some_and(|entry| takes(entry, abi))
}

/// Whether a function's parameters after its receiver are exactly the ABI's.
fn takes(func: &Func, abi: &Abi) -> bool {
    let params = func.params.get(1..).unwrap_or_default();
    params.len() == abi.params.len()
        && params
            .iter()
            .zip(&abi.params)
            .all(|(param, want)| param.ty == *want)
}

/// Every layout extending the signature agrees with it, and every closure
/// recorded arriving at it is one of them.
fn agrees_everywhere(
    closures: &[ClosureInfo],
    arrivals: &Arrivals,
    program: &Program,
    at: usize,
    abi: &Abi,
) -> bool {
    let extending: Vec<usize> = (0..program.layouts.len())
        .filter(|&layout| layout != at && descends(program, layout, at))
        .collect();
    if extending.is_empty() {
        return false;
    }
    let every_one_agrees = extending.iter().all(|&layout| {
        closure_of(program, closures, layout)
            .is_some_and(|index| closure_agrees(closures, program, index, abi))
    });
    every_one_agrees
        && arrivals
            .at_signature
            .iter()
            .filter(|arrival| layout_of(program, arrival.signature) == Some(at))
            .all(|arrival| {
                layout_of(program, arrival.closure).is_some_and(|from| extending.contains(&from))
            })
}

/// The closure a layout is the class of, by index; none for any other layout
/// (a class token, a constructor value, a bound function), which no `#call`
/// of the signature's shape is guaranteed to fill.
fn closure_of(program: &Program, closures: &[ClosureInfo], layout: usize) -> Option<usize> {
    let layout = &program.layouts[layout];
    layout.types.iter().find_map(|ty| {
        let index = closure_index(*ty);
        (index < closures.len() && closure_names(index).0 == layout.name).then_some(index)
    })
}

/// Whether a closure's written `#call` is the signature's typed entry as it
/// stands. A closure with no `#call` in the program -- its body was refused --
/// is an unfilled entry each backend stubs by name, and agrees.
fn closure_agrees(closures: &[ClosureInfo], program: &Program, index: usize, abi: &Abi) -> bool {
    let info = &closures[index];
    if info.reads_this || matches!(info.source, ClosureSource::Job { .. }) {
        return false;
    }
    let call = closure_names(index).1;
    let Some(written) = program.funcs.iter().find(|func| func.name == call) else {
        return true;
    };
    takes(written, abi) && result_fits(program, &written.return_type, &abi.returns)
}

/// A result the typed entry can hand back as the signature's: the same, or an
/// object of a class descending from the signature's result class.
fn result_fits(program: &Program, found: &HirType, want: &HirType) -> bool {
    if found == want {
        return true;
    }
    let (HirType::Managed(ManagedType::Object(found)), HirType::Managed(ManagedType::Object(want))) =
        (found, want)
    else {
        return false;
    };
    match (layout_of(program, *found), layout_of(program, *want)) {
        (Some(found), Some(want)) => descends(program, found, want),
        _ => false,
    }
}

/// The signature layouts something can reach without a record of what it is.
fn entered_without_a_record(
    program: &Program,
    arrivals: &Arrivals,
) -> rustc_hash::FxHashSet<usize> {
    // Every way a value enters a signature that the program itself shows
    // (`hir::typed_signatures`), whoever produced it.
    let mut unknown: rustc_hash::FxHashSet<usize> = entries_from_elsewhere(program)
        .into_iter()
        .map(|(signature, _)| signature)
        .collect();
    // A conversion from another signature carries whatever reaches that one,
    // and an object that is not a closure carries no `#call` at all.
    for (from, to) in &arrivals.signature_flows {
        if layout_of(program, *from) != layout_of(program, *to)
            && let Some(at) = layout_of(program, *to)
        {
            unknown.insert(at);
        }
    }
    for to in &arrivals.opaque_arrivals {
        if let Some(at) = layout_of(program, *to) {
            unknown.insert(at);
        }
    }
    unknown
}

/// Make one recorded site a typed call, if it passes the ABI's parameters and
/// reads the answer at the ABI's result. Whether it did.
fn rewrite(program: &mut Program, site: &UniformSite, abi: &Abi, slot: u32) -> bool {
    let Some(at) = program
        .funcs
        .iter()
        .position(|func| func.name == site.function)
    else {
        return false;
    };
    let func = &mut program.funcs[at];
    let passed = site.args.get(1..).unwrap_or_default();
    if passed.len() != abi.params.len()
        || passed
            .iter()
            .zip(&abi.params)
            .any(|(arg, want)| func.values[arg.0 as usize].ty != *want)
    {
        return false;
    }
    let OpKind::Call { args: uniform, .. } = &func.values[site.answered.0 as usize].kind else {
        return false;
    };
    for (position, defaulted) in abi.defaulted.iter().enumerate() {
        if !defaulted {
            continue;
        }
        let Some(raw) = uniform.get(position + crate::hir::UNIFORM_ARGUMENTS) else {
            return false;
        };
        let OpKind::Erase { value, absent, .. } = &func.values[raw.0 as usize].kind else {
            return false;
        };
        if *absent == crate::hir::Absent::Undefined
            || func.values[value.0 as usize].ty == HirType::Erased
            || matches!(func.values[value.0 as usize].kind, OpKind::ConstUndefined)
        {
            return false;
        }
    }
    let origin = func.values[site.answered.0 as usize].origin.clone();
    let typed = |ty: HirType| Op {
        kind: OpKind::Call {
            callee: Callee::Closure { slot },
            args: site.args.clone(),
            frame: None,
        },
        ty,
        origin: origin.clone(),
    };
    if site.value != site.answered {
        // The site unerased the answer at the checker's type: the typed call
        // takes the unerase's place, and the erased call, now read by nothing,
        // is a constant dead-code removal drops with every erasure that fed it.
        if site.ty != abi.returns || read_elsewhere(func, site.answered, site.value) {
            return false;
        }
        func.values[site.value.0 as usize] = typed(abi.returns.clone());
        func.values[site.answered.0 as usize].kind = OpKind::ConstUndefined;
        return true;
    }
    // Nothing unerased: a `void` call whose answer nothing reads is the typed
    // call itself. One whose erased answer is read stays as it is.
    if abi.returns != HirType::Void || read_elsewhere(func, site.answered, site.answered) {
        return false;
    }
    func.values[site.answered.0 as usize] = typed(HirType::Void);
    true
}

/// Whether any live op or terminator other than `except` reads `value`.
fn read_elsewhere(func: &Func, value: ValueId, except: ValueId) -> bool {
    func.blocks.iter().any(|block| {
        block
            .ops
            .iter()
            .filter(|op| **op != except)
            .any(|op| operands_of(&func.values[op.0 as usize].kind).contains(&value))
            || operands_of_terminator(&block.terminator).contains(&value)
    })
}
