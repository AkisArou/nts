//! Calls through an interface read the receiver's row.
//!
//! A typed vtable serves one dispatch hierarchy, and a value typed as an
//! interface may hold an object of any class that implements it. So each
//! descriptor also holds a row: one entry per native column the program calls
//! through an interface, as C's `nts_family_row` reads, typed. An entry is a
//! thunk with the column's one function type (the receiver as the object
//! root) that casts the receiver to its class and calls the body.
use crate::{
    body::Body,
    contract,
    error::Failure,
    gc, ir,
    module::{Builder, Func, FuncKey},
    objects,
};
use nts_core::hir::{ClassId, HirType, ManagedType, ValueId};
use wasm_encoder::{BlockType, HeapType, Instruction as I, RefType, ValType};

/// The row slots by native column, and the row length: one past the last
/// column any call through an interface reads.
fn columns(m: &Builder<'_>) -> Result<(Vec<Option<u32>>, u32), Failure> {
    let mut by_column = Vec::new();
    for &slot in m.types.row_signatures.keys() {
        let column = m
            .program
            .native_column(slot)
            .ok_or_else(|| format!("interface slot {slot} has no native column"))?;
        let at = column as usize;
        if by_column.len() <= at {
            by_column.resize(at + 1, None);
        }
        by_column[at] = Some(slot);
    }
    let length = u32::try_from(by_column.len())
        .map_err(|_| Failure::Invariant("too many row columns".into()))?;
    Ok((by_column, length))
}

/// A descriptor's row, pushed onto a constant expression: an array of the
/// class's entries, or null for a descriptor that serves no class.
pub(crate) fn row(
    m: &mut Builder<'_>,
    code: &mut ir::Code,
    class: Option<ClassId>,
) -> Result<(), Failure> {
    let rows = m
        .types
        .root
        .and_then(|root| root.rows)
        .ok_or_else(|| Failure::Invariant("unplanned row array".into()))?;
    let Some(class) = class else {
        code.instruction(&I::RefNull(HeapType::Concrete(rows)));
        return Ok(());
    };
    let layout = m
        .program
        .layout(class)
        .ok_or_else(|| Failure::Invariant(format!("unplanned class {class:?}")))?;
    let methods = m.program.native_methods(layout)?;
    let (by_column, length) = columns(m)?;
    for (column, slot) in by_column.iter().enumerate() {
        let body = methods
            .get(column)
            .copied()
            .flatten()
            .filter(|name| m.hir_func(name).is_none_or(|f| !f.abstract_declaration));
        match (slot, body) {
            (Some(slot), Some(body)) => {
                let entry = entry(m, class, *slot, body)?;
                code.ref_func(entry);
            }
            _ => code.instruction(&I::RefNull(HeapType::FUNC)),
        }
    }
    code.instruction(&I::ArrayNewFixed {
        array_type_index: rows,
        array_size: length,
    });
    Ok(())
}

/// One row entry: the column's function type, the receiver cast to `class`'s
/// storage, then the body. The body must take and answer what the declaration
/// does, or the entry is refused by name rather than adapted by guess.
fn entry(m: &mut Builder<'_>, class: ClassId, slot: u32, body: &str) -> Result<Func, Failure> {
    let signature = m.types.row_signatures[&slot];
    let storage = m
        .types
        .objects
        .object(&HirType::Managed(ManagedType::Object(class)))?;
    let physical = storage.physical;
    let func = m
        .hir_func(body)
        .ok_or_else(|| Failure::Invariant(format!("unresolved row body `{body}`")))?;
    let convention = &m.types.row_conventions[&slot];
    let agrees = func.params.len() == convention.params.len() + 1
        && func
            .params
            .iter()
            .skip(1)
            .zip(&convention.params)
            .all(|(own, ty)| &own.ty == ty)
        && func.return_type == convention.result;
    if !agrees {
        return Err(format!(
            "`{body}` takes or answers other types than its interface column's entries"
        )
        .into());
    }
    let params = func.params.len();
    let target = m.program_func(body)?;
    m.helper_typed(
        FuncKey::RowEntry(physical, slot),
        format!("row.entry<{physical},{slot}>"),
        signature,
        |_| {
            let mut f = ir::Function::default();
            f.instructions(&[
                I::LocalGet(0),
                I::RefCastNonNull(HeapType::Concrete(physical)),
            ]);
            for at in 1..params {
                f.instruction(&I::LocalGet(crate::module::index(at)));
            }
            f.call(target);
            f.instruction(&I::End);
            Ok(f)
        },
    )
}

/// A call through an interface: the receiver's descriptor, its row, the
/// column's entry cast to the column's function type, called with the
/// receiver and the arguments. A receiver whose class has no entry is refused
/// by name.
pub(crate) fn call(
    b: &mut Body<'_, '_>,
    result: ValueId,
    slot: u32,
    declared: &str,
    args: &[ValueId],
) -> Result<(), Failure> {
    let Some((&receiver, params)) = args.split_first() else {
        return Err("interface call has no receiver".into());
    };
    let root = b
        .types()
        .root
        .ok_or_else(|| Failure::Invariant("unplanned object root".into()))?;
    let rows = root
        .rows
        .ok_or_else(|| Failure::Invariant("unplanned row array".into()))?;
    let signature = *b
        .types()
        .row_signatures
        .get(&slot)
        .ok_or_else(|| Failure::Invariant(format!("unplanned row slot {slot}")))?;
    let column =
        b.m.program
            .native_column(slot)
            .ok_or_else(|| format!("interface slot {slot} has no native column"))?;
    // The column's entries all take one convention, read off them; it may be
    // another declaration's than the one this call names. The arguments and
    // the result adapt to it, and a representation that does not adapt is
    // refused by name.
    let convention = b.types().row_conventions[&slot].clone();
    if convention.params.len() != params.len() {
        return Err(format!("interface call `{declared}` argument count mismatch").into());
    }
    contract::nonnull(b, receiver, "calling a method of null")?;
    b.load(receiver)?;
    for (&arg, ty) in params.iter().zip(&convention.params) {
        b.load(arg)?;
        objects::adapt(b, &b.ty(arg).clone(), ty)?;
    }
    let row = RefType {
        nullable: false,
        heap_type: HeapType::Concrete(rows),
    };
    // The entry, inside one block that refuses a missing row or entry: a
    // block cannot read what was pushed before it.
    b.instruction(&I::Block(BlockType::Result(ValType::Ref(RefType {
        nullable: false,
        heap_type: HeapType::FUNC,
    }))));
    b.instruction(&I::Block(BlockType::Result(ValType::Ref(row))));
    b.load(receiver)?;
    b.instruction(&I::StructGet {
        struct_type_index: root.object,
        field_index: 0,
    });
    b.instruction(&I::StructGet {
        struct_type_index: root.descriptor,
        field_index: gc::ROWS_FIELD,
    });
    b.instruction(&I::BrOnNonNull(0));
    contract::refuse(
        b,
        "an object whose class has no row, called through an interface",
    )?;
    b.instruction(&I::End);
    b.instruction(&I::I32Const(column.cast_signed()));
    b.instruction(&I::ArrayGet(rows));
    b.instruction(&I::BrOnNonNull(0));
    contract::refuse(
        b,
        "an object whose class does not implement the method it is called through",
    )?;
    b.instruction(&I::End);
    b.instruction(&I::RefCastNonNull(HeapType::Concrete(signature)));
    b.instruction(&I::CallRef(signature));
    if b.types().slot(&convention.result)?.is_some() {
        objects::adapt(b, &convention.result, &b.ty(result).clone())?;
    }
    Ok(())
}
