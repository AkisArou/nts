//! One rule for every place HIR moves a reference between two types.
//!
//! The HIR verifier's `compatible` lets any non-erased reference flow into any
//! other reference slot: a direct-call argument or result, a block edge, a
//! return, a global, a field or an array element. A native backend sees one
//! pointer either way. Wasm types the slot, so each move is one of three:
//!
//! - **an upcast**, which costs nothing;
//! - **a downcast**, which gets a checked `ref.cast`. The types came from the
//!   typechecker, so the cast holds in a correct program, and a compiler
//!   defect that broke it traps instead of reading the wrong object's field,
//!   as the JVM's checkcast does;
//! - **anything else** (sibling classes, a string where an object is wanted)
//!   is refused by name, because no Wasm cast between them can succeed.
//!
//! Scalars never change here: the verifier admits a scalar only into a slot
//! of its own type, and `Convert` is the one operation that changes one.

use crate::{error::Failure, gc, ir::Code, types::Physical};
use nts_core::hir::{HirType, ManagedType};
use wasm_encoder::Instruction as I;

/// Move the value on top of the stack from `found` to the slot type `wanted`.
pub(crate) fn transfer(
    code: &mut Code,
    types: &gc::Plan,
    found: &HirType,
    wanted: &HirType,
) -> Result<(), Failure> {
    if found == wanted {
        return Ok(());
    }
    let refuse = |why: &str| -> Failure {
        format!(
            "{} where {} is wanted: {why}",
            describe(types, found),
            describe(types, wanted)
        )
        .into()
    };
    // An erased value is a different representation, not a wider reference:
    // only `Erase` and `Unerase` cross between them.
    if *found == HirType::Erased || *wanted == HirType::Erased {
        return Err(refuse("only an erasure changes representation"));
    }
    match (types.value_slot(found)?, types.value_slot(wanted)?) {
        (Physical::Reference(from), Physical::Reference(to)) => {
            if types.ref_subtype(from, to) {
                return Ok(());
            }
            if types.heap_subtype(to.heap_type, from.heap_type) {
                code.instruction(&if to.nullable {
                    I::RefCastNullable(to.heap_type)
                } else {
                    I::RefCastNonNull(to.heap_type)
                });
                return Ok(());
            }
            Err(refuse("no Wasm cast relates their storage"))
        }
        _ => Err(refuse("a scalar changes type only through a conversion")),
    }
}

fn describe(types: &gc::Plan, ty: &HirType) -> String {
    match ty {
        HirType::Managed(ManagedType::Object(_)) => types.objects.object(ty).map_or_else(
            |_| format!("an unplanned object {ty:?}"),
            |object| format!("a `{}`", object.name),
        ),
        _ => format!("a {ty:?}"),
    }
}
