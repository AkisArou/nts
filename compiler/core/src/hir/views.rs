//! Which typed-array kinds own their buffers.
//!
//! A view reads its element out of its buffer's bytes. A backend whose memory is
//! bytes (C, LLVM) loads any width at any offset, so the question never arises.
//! One whose arrays are typed (Wasm GC) stores the buffer as a byte array and
//! assembles a `Float64Array` element from eight bytes, three to eight times
//! node's cost per read -- unless it knows nothing else ever sees those bytes,
//! in which case it can store the elements as an array of their own type.
//!
//! [`owned_view_kinds`] answers that per element kind, program-wide: the kinds
//! whose every view owns its buffer outright. It is the same shape of answer
//! `hir::elements` gives for `number[]` storage, coarse and correct rather than
//! convenient: one exposed `Float64Array` anywhere costs every `Float64Array` in
//! the program the typed storage.
//!
//! # What exposes a kind
//!
//! A view of kind K is private when nothing but views of kind K can reach its
//! bytes. The ways out are all visible in a whole program:
//!
//! - its buffer came from anywhere but an `ArrayBuffer` allocated right there
//!   whose only other uses read its length or compare it with `null`: a buffer
//!   passed in, stored, returned, sliced, resized or transferred is reachable as
//!   bytes;
//! - one buffer with views of two kinds;
//! - `.buffer`, or the bytes of a view handed to native code;
//! - a view produced by a helper this does not know to allocate privately;
//! - a view erased (anything can ask an erased value for its `.buffer`), or a
//!   parameter or result of an exported function (the host holds the other end);
//! - a view used anywhere a wider type is expected. `bytesIn(view:
//!   ArrayBufferView)` called with a `Uint8Array` is a call with no conversion
//!   in it, and the callee's `.buffer` is then asked of a type with no kind.
//!   So every use is judged: it must touch the view's elements or geometry,
//!   compare it, or move it somewhere typed exactly as a view of its kind.
//!
//! `slice` copies into a fresh buffer and `subarray` shares the buffer at the
//! same kind, so neither exposes anything.

use rustc_hash::{FxHashMap, FxHashSet};

use super::{
    Callee, Func, HirType, ManagedType, OpKind, Program, ValueId, operands_of,
    operands_of_terminator,
};

/// Helpers that take a view and touch only its elements or its own geometry.
const ELEMENTWISE: &[&str] = &[
    "nts_view_length",
    "nts_view_byte_length",
    "nts_view_byte_offset",
    "nts_view_get",
    "nts_view_set",
    "nts_view_fill",
    "nts_view_copy_within",
    "nts_view_join",
    "nts_view_slice",
    "nts_view_subarray",
];

/// Helpers that take an `ArrayBuffer` and read only what it is, never its bytes.
const BUFFER_QUERIES: &[&str] = &[
    "nts_buffer_byte_length",
    "nts_buffer_max_byte_length",
    "nts_buffer_detached",
    "nts_buffer_resizable",
];

/// Helpers that return a view over a buffer nothing else holds.
const PRIVATE_VIEWS: &[&str] = &["nts_view_slice", "nts_view_subarray"];

/// The element kinds whose every view owns its buffer: no other kind, no
/// `.buffer`, no erasure and no host can reach its bytes.
#[must_use]
pub fn owned_view_kinds(program: &Program) -> FxHashSet<HirType> {
    let mut seen: FxHashSet<HirType> = FxHashSet::default();
    let mut exposed: FxHashSet<HirType> = FxHashSet::default();
    let funcs: FxHashMap<&str, &Func> = program
        .funcs
        .iter()
        .map(|func| (func.name.as_str(), func))
        .collect();
    for func in &program.funcs {
        exposes(program, &funcs, func, &mut seen, &mut exposed);
    }
    seen.retain(|kind| !exposed.contains(kind));
    seen
}

/// The element type of a view, or `None` for anything else.
fn kind(ty: &HirType) -> Option<&HirType> {
    match ty {
        HirType::Managed(ManagedType::View(element)) => Some(element),
        _ => None,
    }
}

fn exposes(
    program: &Program,
    funcs: &FxHashMap<&str, &Func>,
    func: &Func,
    seen: &mut FxHashSet<HirType>,
    exposed: &mut FxHashSet<HirType>,
) {
    let kind_of = |value: ValueId| kind(&func.values[value.0 as usize].ty).cloned();
    if func.exported {
        for param in &func.params {
            exposed.extend(kind(&param.ty).cloned());
        }
        exposed.extend(kind(&func.return_type).cloned());
    }
    let readers = uses_of(func);
    for op in &func.values {
        let produced = kind(&op.ty).cloned();
        seen.extend(produced.clone());
        // Where a view comes from: its buffer must be its own.
        if let Some(k) = &produced
            && let OpKind::Call {
                callee: Callee::External(name),
                args,
                ..
            } = &op.kind
        {
            let private = if name == "nts_view_new" {
                args.first()
                    .is_some_and(|&buffer| private_buffer(func, &readers, buffer, k))
            } else {
                PRIVATE_VIEWS.contains(&name.as_str())
            };
            if !private {
                exposed.insert(k.clone());
            }
        }
    }
    // Where a view goes: every use must keep it a view of its own kind.
    for block in &func.blocks {
        for &at in &block.ops {
            let user = &func.values[at.0 as usize].kind;
            for operand in operands_of(user) {
                if let Some(k) = kind_of(operand)
                    && !keeps(program, funcs, func, user, operand, &k)
                {
                    exposed.insert(k);
                }
            }
        }
        for (at, operand) in flows(&block.terminator) {
            if let Some(k) = kind_of(operand) {
                let expected = match at {
                    Flow::Return => func.return_type.clone(),
                    Flow::Into(target, position) => func.blocks[target]
                        .params
                        .get(position)
                        .map_or(HirType::Void, |param| {
                            func.values[param.0 as usize].ty.clone()
                        }),
                };
                if kind(&expected) != Some(&k) {
                    exposed.insert(k);
                }
            }
        }
    }
}

/// Whether `user` keeps `view`, a view of kind `k`, a view of its own kind:
/// it reads or writes its elements, asks its geometry, compares it, or moves
/// it somewhere typed exactly so. A view used where a wider type is wanted --
/// an `ArrayBufferView` parameter, a field of `unknown` -- leaves no op behind
/// to judge, and its `.buffer` is then asked of a type with no kind.
fn keeps(
    program: &Program,
    funcs: &FxHashMap<&str, &Func>,
    func: &Func,
    user: &OpKind,
    view: ValueId,
    k: &HirType,
) -> bool {
    let typed = |ty: &HirType| kind(ty) == Some(k);
    match user {
        OpKind::ArrayGet { array, .. } => *array == view,
        OpKind::ArraySet { array, value, .. } => {
            *array == view && *value != view
                || *value == view
                    && matches!(&func.values[array.0 as usize].ty,
                        HirType::Managed(ManagedType::Array(element)) if typed(element))
        }
        OpKind::Binary { op, .. } => matches!(op, super::BinOp::Eq | super::BinOp::Ne),
        OpKind::Call {
            callee: Callee::External(name),
            ..
        } => ELEMENTWISE.contains(&name.as_str()),
        OpKind::Call {
            callee: Callee::Direct(name),
            args,
            ..
        } => funcs.get(name.as_str()).is_some_and(|callee| {
            args.iter()
                .enumerate()
                .filter(|(_, a)| **a == view)
                .all(|(at, _)| callee.params.get(at).is_some_and(|param| typed(&param.ty)))
        }),
        OpKind::FieldSet {
            object,
            field,
            value,
        } => {
            *value == view
                && *object != view
                && match &func.values[object.0 as usize].ty {
                    HirType::Managed(ManagedType::Object(ty)) => program
                        .layout(*ty)
                        .and_then(|layout| layout.fields.get(*field as usize))
                        .is_some_and(|slot| typed(&slot.ty)),
                    _ => false,
                }
        }
        OpKind::GlobalSet { global, .. } => program
            .globals
            .get(*global as usize)
            .is_some_and(|slot| typed(&slot.ty)),
        _ => false,
    }
}

/// Where a terminator sends a value: back to the caller, or into a block's
/// parameter at a position.
#[derive(Clone, Copy)]
enum Flow {
    Return,
    Into(usize, usize),
}

fn flows(terminator: &super::Terminator) -> Vec<(Flow, ValueId)> {
    use super::Terminator;
    let into = |target: &super::BlockId, args: &[ValueId]| {
        args.iter()
            .enumerate()
            .map(|(at, value)| (Flow::Into(target.0 as usize, at), *value))
            .collect::<Vec<_>>()
    };
    match terminator {
        Terminator::Return(Some(value)) => vec![(Flow::Return, *value)],
        Terminator::Jump { target, args } => into(target, args),
        Terminator::Branch {
            then_target,
            then_args,
            else_target,
            else_args,
            ..
        } => {
            let mut out = into(then_target, then_args);
            out.extend(into(else_target, else_args));
            out
        }
        _ => Vec::new(),
    }
}

/// Every use of every value: the ops and terminators that name it.
fn uses_of(func: &Func) -> FxHashMap<ValueId, Vec<Use>> {
    let mut map: FxHashMap<ValueId, Vec<Use>> = FxHashMap::default();
    for block in &func.blocks {
        for &op in &block.ops {
            for operand in operands_of(&func.values[op.0 as usize].kind) {
                map.entry(operand).or_default().push(Use::Op(op));
            }
        }
        for operand in operands_of_terminator(&block.terminator) {
            map.entry(operand).or_default().push(Use::Terminator);
        }
    }
    map
}

/// Where a value is used: by an op, or by a block's terminator (a jump's
/// argument, a return), which this never counts as private.
#[derive(Clone, Copy)]
enum Use {
    Op(ValueId),
    Terminator,
}

/// `buffer` is an `ArrayBuffer` allocated in this function, used only to build
/// views of kind `k` and to ask its length or whether it is `null`.
fn private_buffer(
    func: &Func,
    readers: &FxHashMap<ValueId, Vec<Use>>,
    buffer: ValueId,
    k: &HirType,
) -> bool {
    let allocated = matches!(
        &func.values[buffer.0 as usize].kind,
        OpKind::Call { callee: Callee::External(name), .. } if name == "nts_buffer_new"
    );
    allocated
        && readers.get(&buffer).into_iter().flatten().all(|used| match used {
            Use::Terminator => false,
            Use::Op(op) => match &func.values[op.0 as usize] {
                user if matches!(&user.kind, OpKind::Call { callee: Callee::External(name), args, .. }
                    if name == "nts_view_new" && args.first() == Some(&buffer)) =>
                {
                    kind(&user.ty) == Some(k)
                }
                user => match &user.kind {
                    OpKind::Call { callee: Callee::External(name), .. } => {
                        BUFFER_QUERIES.contains(&name.as_str())
                    }
                    OpKind::Binary { op, .. } => {
                        matches!(op, super::BinOp::Eq | super::BinOp::Ne)
                    }
                    _ => false,
                },
            },
        })
}
