//! Which function counts a value, decided once for every backend.
//!
//! A `Retain` or `Release` is abstract in the HIR; what it calls depends on
//! the type of what it counts. A managed object goes to the runtime's
//! `nts_retain`, a tagged value to `nts_value_retain`, and a handle into a
//! foreign object system to that system's own pair (`objc_retain`). A C
//! handle is counted by nothing: the program never owns one, so a count on
//! it is a compiler bug, and refusing it here is the only thing that stops
//! `nts_retain((NtsHeader *)handle)` compiling and corrupting the object.

use nts_core::hir::native::Counting;
use nts_core::hir::{HirType, OpKind, Program};

/// What a `Retain`/`Release` of a value of some type calls.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Counter {
    /// `nts_retain`/`nts_release`, on the object's header.
    Runtime,
    /// `nts_value_retain`/`nts_value_release`, which read the tag.
    Tagged,
    /// A foreign object system's own pair.
    Foreign(Counting),
}

/// The counter for a value of `ty`, or why none applies.
///
/// # Errors
///
/// A type nothing counts: a C handle, or a scalar. The reference-counting
/// pass never emits either, so reaching this is a compiler bug, reported
/// rather than printed as a call on the wrong object.
pub fn counter(ty: &HirType) -> Result<Counter, &'static str> {
    if let Some(counting) = ty.counting() {
        return Ok(Counter::Foreign(counting));
    }
    match ty {
        HirType::Erased => Ok(Counter::Tagged),
        HirType::Managed(_) => Ok(Counter::Runtime),
        HirType::NativePointer(_) => Err("a retain or release of a C handle, which the program does not count"),
        _ => Err("a retain or release of a value with no count"),
    }
}

/// What an array's elements are, as `nts_runtime.h` numbers `NTS_ARRAY_*`, for
/// a backend that writes descriptors as numbers. Zero is `NTS_ARRAY_UNKNOWN`,
/// which the runtime refuses to read rather than guess. The C backend spells the
/// same answer by name from the element's C type, and a test there holds the
/// two together.
#[must_use]
pub const fn array_element(ty: &HirType) -> u32 {
    match ty {
        HirType::Managed(_) => 1,
        HirType::Erased => 2,
        HirType::Float { .. } => 3,
        HirType::Int { signed: true, .. } => 4,
        HirType::Int { signed: false, .. } => 5,
        HirType::Bool => 6,
        _ => 0,
    }
}

/// Every foreign pair the program calls, in a stable order, so each backend
/// declares exactly the functions it will call: from its `Retain`/`Release`
/// ops, and from the fields a descriptor releases when an object dies.
#[must_use]
pub fn foreign(program: &Program) -> Vec<Counting> {
    let mut found: Vec<Counting> = Vec::new();
    for field in program.layouts.iter().flat_map(|layout| &layout.fields) {
        if let Some(counting) = field.ty.counting()
            && !found.contains(&counting)
        {
            found.push(counting);
        }
    }
    for func in &program.funcs {
        for op in &func.values {
            if let OpKind::Retain(object) | OpKind::Release(object) = op.kind
                && let Ok(Counter::Foreign(counting)) = counter(&func.values[object.0 as usize].ty)
                && !found.contains(&counting)
            {
                found.push(counting);
            }
        }
    }
    found.sort_by_key(|counting| counting.retain);
    found
}
