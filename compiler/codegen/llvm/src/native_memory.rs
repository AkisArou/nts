//! Address native storage using the shared C layout. Never attach managed
//! TBAA, noalias, or inbounds promises to a caller-owned address.
use super::{Func, OpKind, HirType, Diagnostic, name, refuse, ty_of};
use nts_core::hir::native::Pointee;

pub(super) fn operation(func: &Func, kind: &OpKind, out: &str) -> Result<String, Diagnostic> {
    let (OpKind::NativeLoad { pointer, .. } | OpKind::NativeStore { pointer, .. }
        | OpKind::NativeIndexAddress { pointer, .. } | OpKind::NativeFieldAddress { pointer, .. }) = *kind
        else { unreachable!("only native memory operations are routed here"); };
    let HirType::NativePointer(storage) = &func.value(pointer).ty else {
        return Err(refuse(func, "native memory without a pointer"));
    };
    let base = name(pointer);
    Ok(match *kind {
        OpKind::NativeFieldAddress { field, .. } => {
            let Pointee::Struct(layout) = storage else { return Err(refuse(func, "field address without a native struct")); };
            let placed = nts_codegen_common::layout::native_place(layout).ok_or_else(|| refuse(func, "native struct without a layout"))?;
            let offset = placed.offsets.get(field as usize).ok_or_else(|| refuse(func, "invalid native field index"))?;
            format!("{out} = getelementptr i8, ptr {base}, i64 {offset}")
        }
        OpKind::NativeIndexAddress { index, .. } => {
            let shape = nts_codegen_common::layout::native_shape(storage).ok_or_else(|| refuse(func, "native pointer without an element size"))?;
            format!("{out}.offset = mul i64 {}, {}\n  {out} = getelementptr i8, ptr {base}, i64 {out}.offset", name(index), shape.size)
        }
        OpKind::NativeLoad { index, .. } | OpKind::NativeStore { index, .. } => {
            let ty = storage.element_type().ok_or_else(|| refuse(func, "native memory without a loadable element"))?;
            let element = ty_of(&ty, func)?;
            let address = format!("{out}.at = getelementptr {element}, ptr {base}, i64 {}", name(index));
            let access = match kind {
                OpKind::NativeStore { value, .. } => format!("store {element} {}, ptr {out}.at", name(*value)),
                _ => format!("{out} = load {element}, ptr {out}.at"),
            };
            format!("{address}\n  {access}")
        }
        _ => unreachable!("only native memory operations are routed here"),
    })
}
