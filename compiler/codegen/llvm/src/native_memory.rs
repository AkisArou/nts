//! Address native storage using the shared C layout. Never attach managed
//! TBAA, noalias, or inbounds promises to a caller-owned address.
use super::{Func, OpKind, HirType, Diagnostic, name, refuse, ty_of};
use nts_core::hir::native::Pointee;

pub(super) fn operation(func: &Func, kind: &OpKind, result: &HirType, out: &str) -> Result<String, Diagnostic> {
    match *kind {
        OpKind::NativeLocal { count } => {
            let HirType::NativePointer(element) = result else { return Err(refuse(func, "local needs native layout")); };
            let shape = nts_core::hir::layout::native_shape(element).ok_or_else(|| refuse(func, "local needs native layout"))?;
            let bytes = shape.size * count;
            return Ok(format!("store [{bytes} x i8] zeroinitializer, ptr {out}, align {}", shape.align));
        }
        OpKind::NativeMalloc { bytes } => {
            let HirType::NativePointer(element) = result else { return Err(refuse(func, "malloc needs native layout")); };
            let size = nts_core::hir::layout::native_shape(element).ok_or_else(|| refuse(func, "malloc needs native layout"))?.size;
            return Ok(format!("{out} = call ptr @nts_native_malloc(double {}, i64 {size})", name(bytes)));
        }
        OpKind::NativeFree { pointer } => return Ok(format!("call void @free(ptr {})", name(pointer))),
        _ => {}
    }
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
            let placed = nts_core::hir::layout::native_place(layout).ok_or_else(|| refuse(func, "native struct without a layout"))?;
            let offset = placed.offsets.get(field as usize).ok_or_else(|| refuse(func, "invalid native field index"))?;
            format!("{out} = getelementptr i8, ptr {base}, i64 {offset}")
        }
        OpKind::NativeIndexAddress { index, .. } => {
            let shape = nts_core::hir::layout::native_shape(storage).ok_or_else(|| refuse(func, "native pointer without an element size"))?;
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


pub(super) fn stack_storage(func: &Func) -> Vec<String> {
    func.blocks.iter().flat_map(|b| &b.ops).filter_map(|at| {
        let op = func.value(*at);
        let OpKind::NativeLocal { count } = op.kind else { return None; };
        let HirType::NativePointer(element) = &op.ty else { return None; };
        let shape = nts_core::hir::layout::native_shape(element)?;
        Some(format!("{} = alloca [{} x i8], align {}", name(*at), shape.size * count, shape.align))
    }).collect()
}

pub(super) fn helpers(program: &super::Program) -> String {
    let allocate = program.funcs.iter().any(|f| f.values.iter().any(|op| matches!(op.kind, OpKind::NativeMalloc { .. })));
    let free = program.funcs.iter().any(|f| f.values.iter().any(|op| matches!(op.kind, OpKind::NativeFree { .. })));
    let mut text = String::new();
    if free { text.push_str("declare void @free(ptr)\n"); }
    if allocate { text.push_str(r"declare ptr @malloc(i64)
define internal ptr @nts_native_malloc(double %bytes, i64 %minimum) {
entry:
  %min = uitofp i64 %minimum to double
  %lower = fcmp oge double %bytes, %min
  %upper = fcmp ole double %bytes, 0x433FFFFFFFFFFFFF
  %truncated = call double @llvm.trunc.f64(double %bytes)
  %integral = fcmp oeq double %truncated, %bytes
  %range = and i1 %lower, %upper
  %valid = and i1 %range, %integral
  br i1 %valid, label %allocate, label %invalid
allocate:
  %count = fptoui double %bytes to i64
  %p = call ptr @malloc(i64 %count)
  ret ptr %p
invalid:
  ret ptr null
}
"); }
    text
}
