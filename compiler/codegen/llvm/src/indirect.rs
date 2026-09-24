//! The runtime's sixteen-byte values under Win64.
//!
//! An erased value and an `i128` cross a call into C as a pointer to a copy,
//! and come back through a hidden pointer (erased) or as `<2 x i64>` in an SSE
//! register (`i128`), where System V passes and returns both in two
//! registers. `signatures_win64` is clang's word for which helper does which;
//! this is how a call site says it.
//!
//! The copies live in scratch slots that every function declares in its entry
//! block: [`SLOTS`] for arguments and one for a result. Each call reuses them,
//! which is sound because the Win64 ABI gives the callee the copy for the
//! call and no longer -- a guarantee binding on the clang-compiled runtime,
//! not an attribute this module emits -- and a result is read straight after
//! its call. A runtime helper that kept the pointer past its return would
//! break this, and neither the drift check nor `opt -passes=lint` would say
//! so. Slots no call touches are deleted by the
//! optimizer; at `-O0` they are three allocas a function.

use nts_core::hir::native::NativeAbi;
use nts_core::hir::{Func, HirType};

use crate::Platform;

/// The most sixteen-byte arguments one runtime helper takes on Win64.
/// `tests/signatures.rs` holds the generated table to it, so a helper that
/// needs a third slot fails there rather than overwriting the second here.
pub const SLOTS: usize = 2;

/// Whether calls into the C runtime pass sixteen-byte values through memory.
pub(crate) fn applies(platform: Platform) -> bool {
    platform.abi == NativeAbi::Win64
}

/// The entry-block slots of a function emitted for `platform`.
pub(crate) fn scratch(platform: Platform) -> Vec<String> {
    if !applies(platform) {
        return Vec::new();
    }
    (0..SLOTS)
        .map(|at| format!("%win64.a{at} = alloca [16 x i8], align 16"))
        .chain(std::iter::once("%win64.r = alloca [16 x i8], align 16".to_owned()))
        .collect()
}

/// Whether a value of this type crosses into C through memory on Win64.
pub(crate) fn is_indirect(ty: &HirType) -> bool {
    matches!(ty, HirType::Erased | HirType::BigInt)
}

/// An argument passed as a pointer to its copy in slot `at`, which `spelled`
/// (`{ i32, i64 }` or `i128`) is stored into first.
pub(crate) fn argument(spelled: &str, value: &str, at: usize, before: &mut Vec<String>) -> String {
    before.push(format!("store {spelled} {value}, ptr %win64.a{at}, align 16"));
    format!("ptr %win64.a{at}")
}

/// The hidden first argument of a call returning an erased value.
pub(crate) const RESULT: &str = "ptr sret({ i32, i64 }) align 8 %win64.r";

/// Read an erased result back out of the slot its call wrote.
pub(crate) fn erased_result(out: &str) -> String {
    format!("{out} = load {{ i32, i64 }}, ptr %win64.r, align 8")
}

/// A call into C returning sixteen bytes on Win64: an erased value through the
/// hidden pointer, read back from its slot, or an `i128` as `<2 x i64>` in
/// XMM0, which is the same 128 bits.
pub(crate) fn call_returning(out: &str, callable: &str, arguments: Vec<String>, result: &HirType) -> String {
    if *result == HirType::Erased {
        let with_result: Vec<String> = std::iter::once(RESULT.to_owned()).chain(arguments).collect();
        format!("call void {callable}({})\n  {}", with_result.join(", "), erased_result(out))
    } else {
        format!(
            "{out}.v = call <2 x i64> {callable}({})\n  {out} = bitcast <2 x i64> {out}.v to i128",
            arguments.join(", ")
        )
    }
}

/// Why `func` cannot be defined for C to call on `platform`, if it cannot.
///
/// A function C calls by name is defined with this backend's split of a
/// sixteen-byte value, which is System V's: on Win64 C would pass a pointer
/// where the definition reads two registers. A C-convention entry beside it
/// would answer this, and is not written yet.
pub(crate) fn unexportable(func: &Func, platform: Platform) -> Option<&'static str> {
    let crosses = func.params.iter().any(|param| is_indirect(&param.ty)) || is_indirect(&func.return_type);
    (func.exported && applies(platform) && crosses).then_some(
        "an exported function taking or returning an erased value or a bigint under Win64, which C passes through memory there; the C backend builds it",
    )
}
