//! What a target's C ABI refuses that HIR cannot know about.
//!
//! A `c_long` is an exact `i64` value in HIR on every target, and under Win64
//! the slot C reads it from is 32 bits. A value that does not fit is truncated
//! at the boundary, as C truncates. For a runtime value that is the stated
//! behaviour (`c_long`'s documentation in `runtime/native/libc.d.ts`). For a
//! constant the compiler can see the loss, and a silent wrap there would be
//! inexcusable, so it is refused.
//!
//! One check, called by both backends, so C's and LLVM's answers cannot differ.
use nts_core::hir::native::{NativeAbi, Pointee, Scalar, Type};
use nts_core::hir::{Callee, Func, HirType, OpKind, Program, UnOp, ValueId};
use nts_diagnostics::Diagnostic;

/// Every constant this program passes or stores into a native slot too narrow
/// for it on `abi`.
#[must_use]
pub fn unrepresentable_constants(program: &Program, abi: NativeAbi) -> Vec<Diagnostic> {
    let mut refusals = Vec::new();
    for func in &program.funcs {
        for op in func.blocks.iter().flat_map(|block| &block.ops).map(|v| func.value(*v)) {
            let crossings: Vec<(ValueId, HirType, HirType)> = match &op.kind {
                OpKind::Call { callee: Callee::Native(target), args, .. } if target.send.is_none() => args
                    .iter()
                    .enumerate()
                    .filter_map(|(at, arg)| {
                        // `argument`, the one accessor that knows the layout:
                        // parameters, a record result's destination, then the tail.
                        let Type::Scalar(scalar) = target.argument(at)? else {
                            return None;
                        };
                        Some((*arg, scalar.representation(), scalar.abi(abi)))
                    })
                    .collect(),
                OpKind::NativeStore { pointer, value, .. } => match &func.value(*pointer).ty {
                    HirType::NativePointer(pointee) => scalar_slot(pointee, abi)
                        .map(|(value_ty, slot)| vec![(*value, value_ty, slot)])
                        .unwrap_or_default(),
                    _ => Vec::new(),
                },
                _ => Vec::new(),
            };
            for (value, representation, slot) in crossings {
                if representation == slot {
                    continue;
                }
                let HirType::Int { bits, signed } = slot else { continue };
                let Some(constant) = constant(func, value) else { continue };
                let (low, high) = if signed {
                    (-(1_i128 << (bits - 1)), (1_i128 << (bits - 1)) - 1)
                } else {
                    (0, (1_i128 << bits) - 1)
                };
                if !(low..=high).contains(&constant) {
                    refusals.push(Diagnostic::error(
                        "NTS2007",
                        format!(
                            "the constant {constant} does not fit a {bits}-bit {} C `long` on this \
                             target (Win64 is LLP64), and would be truncated; use `c_int64` or \
                             `c_uint64` for a value this wide",
                            if signed { "signed" } else { "unsigned" }
                        ),
                        op.origin.location,
                    ));
                }
            }
        }
    }
    refusals
}

/// The value type and the slot type of a scalar a pointer's store writes, where
/// it is one.
fn scalar_slot(pointee: &Pointee, abi: NativeAbi) -> Option<(HirType, HirType)> {
    match pointee {
        Pointee::Scalar(scalar) => Some((scalar.representation(), scalar.abi(abi))),
        Pointee::Const(inner) | Pointee::Unaligned(inner) => scalar_slot(inner, abi),
        _ => None,
    }
}

/// The integer `value` is, where it is one the compiler knows: a constant,
/// possibly negated and possibly behind conversions between integer widths.
///
/// **The negation is how a negative literal arrives.** `-1n` lowers as `neg`
/// of `1`, not as a constant `-1`, so without it `-1n as c_ulong` would
/// reach a 32-bit unsigned slot unrefused.
fn constant(func: &Func, value: ValueId) -> Option<i128> {
    match &func.value(value).kind {
        OpKind::ConstInt(n) => Some(*n),
        OpKind::Convert(inner) => constant(func, *inner),
        OpKind::Unary { op: UnOp::Neg, operand } => constant(func, *operand).and_then(i128::checked_neg),
        _ => None,
    }
}

/// Every native function whose signature holds a 32-bit `long`
/// (`c_long32`/`c_ulong32`) on a target whose `long` is 64 bits.
///
/// That scalar is Windows' `LONG` and `DWORD`, and a binding written with it
/// is a Windows binding. Elsewhere C's `long` is another width, so the program
/// would call through a type C does not have: refused, naming the function.
#[must_use]
pub fn unavailable_scalars(program: &Program, abi: NativeAbi) -> Vec<Diagnostic> {
    if abi == NativeAbi::Win64 {
        return Vec::new();
    }
    let mut refusals = Vec::new();
    let mut named = std::collections::BTreeSet::new();
    for func in &program.funcs {
        for op in func.blocks.iter().flat_map(|block| &block.ops).map(|v| func.value(*v)) {
            let OpKind::Call { callee: Callee::Native(target), .. } = &op.kind else { continue };
            let mentions = target
                .parameters
                .iter()
                .chain(std::iter::once(&target.result))
                .chain(target.variadic.iter())
                .any(|ty| type_holds_long32(ty, &mut Vec::new()));
            if mentions && named.insert(target.name.clone()) {
                refusals.push(Diagnostic::error(
                    "NTS2007",
                    format!(
                        "`{}` takes or returns a 32-bit C `long` (`c_long32`/`c_ulong32`), which exists only \
                         on Windows (LLP64); this target's `long` is 64 bits. It is a Windows binding",
                        target.name
                    ),
                    op.origin.location,
                ));
            }
        }
    }
    refusals
}

fn type_holds_long32(ty: &Type, seen: &mut Vec<String>) -> bool {
    match ty {
        Type::Scalar(scalar) => matches!(scalar, Scalar::Long32 | Scalar::ULong32),
        Type::Pointer(pointee) => pointee_holds_long32(pointee, seen),
        Type::Record(record) => pointee_holds_long32(&Pointee::Record(record.clone()), seen),
        Type::FnPointer(signature) => {
            signature.parameters.iter().chain(std::iter::once(&*signature.result)).any(|t| type_holds_long32(t, seen))
        }
        _ => false,
    }
}

fn pointee_holds_long32(pointee: &Pointee, seen: &mut Vec<String>) -> bool {
    match pointee {
        Pointee::Scalar(scalar) => matches!(scalar, Scalar::Long32 | Scalar::ULong32),
        Pointee::Bits { unit, .. } => matches!(unit, Scalar::Long32 | Scalar::ULong32),
        Pointee::Record(record) => {
            // A record reached twice (a linked structure) is answered once.
            if seen.contains(&record.name) {
                return false;
            }
            seen.push(record.name.clone());
            record.fields.iter().any(|field| pointee_holds_long32(&field.ty, seen))
        }
        Pointee::Pointer(inner) | Pointee::Const(inner) | Pointee::Flexible(inner) | Pointee::Unaligned(inner) => {
            pointee_holds_long32(inner, seen)
        }
        Pointee::Array { element, .. } => pointee_holds_long32(element, seen),
        Pointee::FnPointer(signature) => {
            signature.parameters.iter().chain(std::iter::once(&*signature.result)).any(|t| type_holds_long32(t, seen))
        }
        Pointee::Opaque(_) | Pointee::Void => false,
    }
}
