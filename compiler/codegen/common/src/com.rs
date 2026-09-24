//! What both backends derive the same way for the Windows Runtime's delegates.

use nts_core::hir::native::FnPointer;
use nts_core::hir::{OpKind, Program};

/// Every distinct delegate signature a program makes an object for, sorted by
/// its spelled name, so both backends emit one `Invoke` adapter each.
#[must_use]
pub fn delegate_signatures(program: &Program) -> Vec<&FnPointer> {
    let mut found: Vec<&FnPointer> = Vec::new();
    for func in &program.funcs {
        for op in &func.values {
            if let OpKind::DelegateInvoke { signature } = &op.kind
                && !found.iter().any(|seen| seen.name == signature.name)
            {
                found.push(signature);
            }
        }
    }
    found.sort_by(|a, b| a.name.cmp(&b.name));
    found
}

/// A signature's `Invoke` adapter, `nts_com_invoke_NtsFn_void_ptr_ptr`.
#[must_use]
pub fn delegate_invoke_symbol(signature: &FnPointer) -> String {
    format!("nts_com_invoke_{}", signature.name)
}
