//! A dispatch slot answers in one representation.
//!
//! A virtual call reads a function pointer out of the receiver's table and calls
//! it at the signature its `declared` names (see `dispatch`). TypeScript lets an
//! override **narrow** its result -- `read(): unknown` overridden by
//! `read(): string | undefined` -- and the two are different representations
//! here: an `NtsValue` and an `NtsString *`. With the override in the table as
//! itself, a caller through the root reads sixteen bytes of `NtsValue` out of a
//! function that returned a pointer: deterministic wrong answers on C and LLVM,
//! and `NTS4009` on the JVM, whose descriptors cannot spell the mistake.
//! `examples/a-nullable-virtual-return-keeps-its-absence` and
//! `a-virtual-return-is-erased-with-its-actual-storage` are the witnesses.
//!
//! The answer is Java's covariant-return **bridge**, made once in the IR rather
//! than once per backend: where a slot's results disagree and one of them is
//! erased, the slot's representation is `Erased`, and every entry that answers
//! something else is replaced in the tables by `{entry}@erased` -- the same
//! parameters, a direct call to the entry, and an `Erase` of what it returned.
//! The JVM then writes that bridge's forwarder under the slot's member name with
//! an `NtsValue` descriptor, which *is* an override of the root's method, so it
//! needs no bridge of its own.
//!
//! # The two places a slot's signature was decided wrongly
//!
//! - **An interface's declaration was its first implementer's.**
//!   `declare_interface_methods` copies a body's signature, return included, so
//!   `interface Producer { read(): unknown }` answered `managed<str>` whenever
//!   `Optional` happened to be lowered before `Fallback`, and the C call site
//!   assigned an `NtsString *` to an `NtsValue`: clang refused the program. The
//!   declaration of a bridged slot returns `Erased` whichever body it came from.
//! - **A class chain is one slot entered through two signatures.** `Base#read():
//!   unknown` and `Sub#read(): string | undefined` share the root's slot, and a
//!   call through a `Sub` names `Sub#read`. Once every entry in the slot answers
//!   erased, that call is retargeted to the root's declaration and its result is
//!   unerased back to what the checker said it was -- `Unerase` of an absent
//!   value reads a zero payload, which is the null pointer `string | undefined`
//!   is represented by.
//!
//! # What it leaves alone
//!
//! Records against records (`dispatch::check` decides those by layout prefix),
//! two object pointers (a covariant `this` is a pointer either way), and a slot
//! where some answer has no erased form: no bridge can be built there, and the
//! slot keeps the representation it had.
use std::collections::BTreeMap;

use rustc_hash::FxHashMap;

use nts_semantic_schema::{GeneratedReason, Origin, SemanticSnapshot, TypeId, TypeKind};

use super::{Hierarchy, without_the_raising_suffix};
use crate::hir::{
    Absent, Block, Callee, Func, HirType, Op, OpKind, Program, Terminator, ValueId,
};

/// The suffix a bridge takes after the entry it answers for.
const ERASED_SUFFIX: &str = "@erased";

/// Bridge every member slot whose results disagree with an erased one.
///
/// **Linear in the program, by construction.** A runtime module has tens of
/// thousands of functions and hundreds of slots, so every lookup goes through
/// one of two indexes built once: function by name (`index`, kept current as
/// bridges are added) and, per slot, each entry with the layouts holding it
/// (`slot_tables`).
pub(super) fn bridge(snapshot: &SemanticSnapshot, hierarchy: &Hierarchy, program: &mut Program) {
    let calls = virtual_calls(program);
    let owners = owners_by_name(hierarchy);
    let tables = slot_tables(program);
    let mut index: FxHashMap<String, usize> =
        program.funcs.iter().enumerate().map(|(at, func)| (func.name.clone(), at)).collect();
    // Sorted, so one compiler on one input makes its bridges in one order.
    let mut slots: Vec<(&(TypeId, String), &u32)> = hierarchy.slots.iter().collect();
    slots.sort_by_key(|(_, slot)| **slot);
    for ((root, member), &slot) in slots {
        let Some(owner) = hierarchy.name.get(root) else { continue };
        let root_declaration = format!("{owner}#{member}");
        let through = calls.get(&slot).map(Vec::as_slice).unwrap_or_default();
        let empty = BTreeMap::new();
        let table = tables.get(&slot).unwrap_or(&empty);
        if !disagrees_with_an_erased_answer(program, &index, table, through) {
            continue;
        }
        // The declarations first: an abstract one is a signature, and its result
        // is the slot's.
        for name in table.keys() {
            if let Some(&at) = index.get(name)
                && program.funcs[at].abstract_declaration
            {
                program.funcs[at].return_type = HirType::Erased;
            }
        }
        for (name, holders) in table {
            let Some(&at) = index.get(name) else { continue };
            let func = &program.funcs[at];
            if func.abstract_declaration || func.return_type == HirType::Erased {
                continue;
            }
            let bridge = format!("{name}{ERASED_SUFFIX}");
            if !index.contains_key(&bridge) {
                let absent = result_absent(snapshot, &owners, name, &func.return_type);
                let made = erasing_bridge(bridge.clone(), func, absent);
                index.insert(bridge.clone(), program.funcs.len());
                program.funcs.push(made);
            }
            for &layout in holders {
                program.layouts[layout].methods[slot as usize] = Some(bridge.clone());
            }
        }
        for &(at, value) in through {
            retarget(program, &index, at, value, &root_declaration);
        }
    }
}

/// Every `Callee::Virtual` call in the program, by slot.
fn virtual_calls(program: &Program) -> FxHashMap<u32, Vec<(usize, ValueId)>> {
    let mut calls: FxHashMap<u32, Vec<(usize, ValueId)>> = FxHashMap::default();
    for (at, func) in program.funcs.iter().enumerate() {
        for block in &func.blocks {
            for &value in &block.ops {
                if let OpKind::Call { callee: Callee::Virtual { slot, .. }, .. } = &func.value(value).kind {
                    calls.entry(*slot).or_default().push((at, value));
                }
            }
        }
    }
    calls
}

/// Each slot's entries, in name order, each with the layouts whose table holds
/// it there: one pass over the tables.
fn slot_tables(program: &Program) -> FxHashMap<u32, BTreeMap<String, Vec<usize>>> {
    let mut tables: FxHashMap<u32, BTreeMap<String, Vec<usize>>> = FxHashMap::default();
    for (at, layout) in program.layouts.iter().enumerate() {
        for (slot, entry) in layout.methods.iter().enumerate() {
            let (Some(entry), Ok(slot)) = (entry, u32::try_from(slot)) else { continue };
            tables.entry(slot).or_default().entry(entry.clone()).or_default().push(at);
        }
    }
    tables
}

/// Whether the answers through a slot -- what its entries return, what each
/// call's declaration returns, and what each call's result is typed -- include
/// an erased one and something else, every one of which can be erased.
fn disagrees_with_an_erased_answer(
    program: &Program,
    index: &FxHashMap<String, usize>,
    table: &BTreeMap<String, Vec<usize>>,
    calls: &[(usize, ValueId)],
) -> bool {
    let by_name = |name: &str| index.get(name).map(|&at| &program.funcs[at]);
    let mut answers: Vec<&HirType> =
        table.keys().filter_map(|name| by_name(name)).map(|func| &func.return_type).collect();
    for &(at, value) in calls {
        let op = program.funcs[at].value(value);
        answers.push(&op.ty);
        if let OpKind::Call { callee: Callee::Virtual { declared, .. }, .. } = &op.kind
            && let Some(func) = by_name(declared)
        {
            answers.push(&func.return_type);
        }
    }
    answers.contains(&&HirType::Erased)
        && answers.iter().any(|answer| **answer != HirType::Erased)
        && answers.iter().all(|answer| crosses(answer))
}

/// Whether an answer can be handed back erased: already erased, nothing at
/// all, or something with an erased form.
fn crosses(answer: &HirType) -> bool {
    matches!(answer, HirType::Erased | HirType::Void | HirType::Never) || super::erasable(answer)
}

/// `{entry}@erased`: the entry's own parameters, a direct call to it, and its
/// answer erased -- `undefined` where it answers nothing, as JavaScript says a
/// call to such a function does.
fn erasing_bridge(name: String, target: &Func, absent: Absent) -> Func {
    let origin = Origin::generated(target.origin.location, GeneratedReason::AbiProjection);
    // A `Param` op *is* the signature in this IR, and value `i` is parameter `i`.
    let mut values: Vec<Op> = target
        .params
        .iter()
        .enumerate()
        .map(|(at, param)| Op {
            kind: OpKind::Param(u32::try_from(at).unwrap_or(u32::MAX)),
            ty: param.ty.clone(),
            origin: origin.clone(),
        })
        .collect();
    let args: Vec<ValueId> = (0..values.len()).map(|at| ValueId(u32::try_from(at).unwrap_or(u32::MAX))).collect();
    let push = |values: &mut Vec<Op>, kind: OpKind, ty: HirType| {
        values.push(Op { kind, ty, origin: origin.clone() });
        ValueId(u32::try_from(values.len() - 1).unwrap_or(u32::MAX))
    };
    let answered = push(
        &mut values,
        OpKind::Call { callee: Callee::Direct(target.name.clone()), args, frame: None },
        target.return_type.clone(),
    );
    let answer = if matches!(target.return_type, HirType::Void | HirType::Never) {
        push(&mut values, OpKind::ConstUndefined, HirType::Erased)
    } else {
        push(&mut values, OpKind::Erase { value: answered, absent }, HirType::Erased)
    };
    let ops = (target.params.len()..values.len())
        .map(|at| ValueId(u32::try_from(at).unwrap_or(u32::MAX)))
        .collect();
    Func {
        name,
        params: target.params.clone(),
        return_type: HirType::Erased,
        values,
        blocks: vec![Block { params: Vec::new(), ops, terminator: Terminator::Return(Some(answer)) }],
        origin,
        exported: false,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        written_return: None,
        written_return_elements: Vec::new(),
    }
}

/// Point a call through a bridged slot at a declaration that answers erased,
/// and read its answer back as what the call was typed.
///
/// An interface's declaration already answers erased by now; a class chain's
/// call through a narrower class names that class's own body, and is pointed at
/// the slot's root -- whose parameters it must agree with, or it is left as it
/// was. The call keeps its value id by moving: the call goes to a fresh id typed
/// `Erased`, and the old id becomes the `Unerase` of it, so every use of the old
/// id reads the value it always did.
fn retarget(program: &mut Program, index: &FxHashMap<String, usize>, at: usize, value: ValueId, root: &str) {
    let by_name = |name: &str| index.get(name).map(|&at| &program.funcs[at]);
    let erased_declaration = |name: &str| by_name(name).filter(|func| func.return_type == HirType::Erased);
    let OpKind::Call { callee: Callee::Virtual { declared, .. }, .. } = &program.funcs[at].value(value).kind else {
        return;
    };
    let target = if erased_declaration(declared).is_some() {
        None
    } else {
        let (Some(through), Some(root_func)) =
            (by_name(declared), erased_declaration(root))
        else {
            return;
        };
        let agree = through.params.len() == root_func.params.len()
            && through.params.iter().zip(&root_func.params).skip(1).all(|(a, b)| a.ty == b.ty);
        if !agree {
            return;
        }
        Some(root.to_owned())
    };
    let func = &mut program.funcs[at];
    let op = &mut func.values[value.0 as usize];
    if let (Some(target), OpKind::Call { callee: Callee::Virtual { declared, .. }, .. }) = (target, &mut op.kind) {
        *declared = target;
    }
    if matches!(op.ty, HirType::Erased | HirType::Void | HirType::Never) {
        op.ty = HirType::Erased;
        return;
    }
    let mut call = op.clone();
    call.ty = HirType::Erased;
    let moved = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
    func.values.push(call);
    func.values[value.0 as usize].kind = OpKind::Unerase { value: moved };
    for block in &mut func.blocks {
        if let Some(position) = block.ops.iter().position(|op| *op == value) {
            block.ops.insert(position, moved);
            break;
        }
    }
}

/// Each class's instance types, by the name its functions are spelled with.
fn owners_by_name(hierarchy: &Hierarchy) -> FxHashMap<&str, Vec<TypeId>> {
    let mut owners: FxHashMap<&str, Vec<TypeId>> = FxHashMap::default();
    for (ty, name) in &hierarchy.name {
        owners.entry(name.as_str()).or_default().push(*ty);
    }
    for types in owners.values_mut() {
        types.sort_by_key(|ty| ty.0);
    }
    owners
}

/// What a null pointer `entry` returns means, from the checker's type for its
/// member: the same rule `closure_result_absent` applies to a closure's
/// signature, asked of a method's.
fn result_absent(
    snapshot: &SemanticSnapshot,
    owners: &FxHashMap<&str, Vec<TypeId>>,
    entry: &str,
    returns: &HirType,
) -> Absent {
    if !crate::hir::tags::payload_is_a_reference(returns) {
        return Absent::Impossible;
    }
    let Some((owner, member)) = entry.split_once('#') else { return Absent::Impossible };
    let member = without_the_raising_suffix(member).0;
    let result = owners.get(owner).into_iter().flatten().find_map(|ty| member_result(snapshot, *ty, member));
    result.map_or(Absent::Impossible, |result| super::absent_of_result(snapshot, result))
}

/// The checker's result type for `member` of `owner`: a getter's property type,
/// or a method's signature's return.
fn member_result(snapshot: &SemanticSnapshot, owner: TypeId, member: &str) -> Option<TypeId> {
    let TypeKind::Object { properties } = &snapshot.types.get(owner.0 as usize)?.kind else { return None };
    if let Some(getter) = member.strip_prefix("get ") {
        return properties.iter().find(|property| property.name == getter).map(|property| property.ty);
    }
    let property = properties.iter().find(|property| property.name == member)?;
    let TypeKind::Function(signature) = snapshot.types.get(property.ty.0 as usize)?.kind else { return None };
    snapshot.signatures.get(signature.0 as usize).map(|signature| signature.return_type)
}

