//! A COM method call: a cast of the receiver's table slot, which is how C
//! calls through a vtable and what a `lpVtbl->Method(...)` macro expands to.

use nts_core::hir::native::{Function, Type, Vtable};

/// A pointer is `void *` in the cast, the receiver first: every COM method
/// takes its instance as `This`, and one it writes through -- a result slot --
/// is not `const`.
fn spelled(ty: &Type) -> String {
    match ty {
        Type::Pointer(_) => "void *".to_owned(),
        other => other.c_type().into_owned(),
    }
}

/// `((R (*)(void *, A...))(*(void ***)r)[slot])(r, a...)`: the function in
/// slot `slot` of the table the receiver's first word points at, called with
/// the receiver and the rest.
pub(super) fn vtable_expression(target: &Function, vtable: &Vtable, arguments: &[String]) -> String {
    let receiver = arguments.first().cloned().unwrap_or_else(|| "0".to_owned());
    let types: Vec<String> = target.parameters.iter().map(spelled).collect();
    format!(
        "(({} (*)({}))(*(void ***){receiver})[{}])({})",
        spelled(&target.result),
        types.join(", "),
        vtable.slot,
        arguments.join(", ")
    )
}
