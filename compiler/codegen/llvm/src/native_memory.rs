//! Address native storage using the shared C layout. Never attach managed
//! TBAA, noalias, or inbounds promises to a caller-owned address.
use super::{Func, OpKind, HirType, Diagnostic, Platform, name, refuse, ty_of, widening};
use nts_core::hir::native::Pointee;

pub(super) fn operation(func: &Func, kind: &OpKind, result: &HirType, out: &str, platform: Platform) -> Result<String, Diagnostic> {
    match *kind {
        OpKind::NativeLocal { count } => {
            let HirType::NativePointer(element) = result else { return Err(refuse(func, "local needs native layout")); };
            let shape = nts_core::hir::layout::native_shape(element, platform.abi).ok_or_else(|| refuse(func, "local needs native layout"))?;
            let bytes = shape.size * count;
            return Ok(format!("store [{bytes} x i8] zeroinitializer, ptr {out}, align {}", shape.align));
        }
        OpKind::NativeMalloc { bytes } => {
            let HirType::NativePointer(element) = result else { return Err(refuse(func, "malloc needs native layout")); };
            let size = nts_core::hir::layout::native_shape(element, platform.abi).ok_or_else(|| refuse(func, "malloc needs native layout"))?.size;
            return Ok(format!("{out} = call ptr @nts_native_malloc(double {}, i64 {size})", name(bytes)));
        }
        OpKind::NativeFree { pointer } => return Ok(format!("call void @free(ptr {})", name(pointer))),
        // `llvm.memcpy` rather than a load and a store of an aggregate: this
        // backend never names a struct type -- every address here is a byte
        // GEP -- so there is no aggregate value to move through a register.
        //
        // The alignment is the type's, which is what the destination and the
        // source both have: `copy` refuses two different pointees, so there is
        // one alignment and not a smaller of two.
        OpKind::NativeCopy { destination, source } => {
            let HirType::NativePointer(element) = &func.value(destination).ty else {
                return Err(refuse(func, "a copy without a native pointer"));
            };
            let shape = nts_core::hir::layout::native_shape(element, platform.abi)
                .ok_or_else(|| refuse(func, "a copy of a native type with no size"))?;
            return Ok(format!(
                "call void @llvm.memcpy.p0.p0.i64(ptr align {} {}, ptr align {} {}, i64 {}, i1 false)",
                shape.align,
                name(destination),
                shape.align,
                name(source),
                shape.size
            ));
        }
        _ => {}
    }
    let (OpKind::NativeLoad { pointer, .. } | OpKind::NativeStore { pointer, .. }
        | OpKind::NativeIndexAddress { pointer, .. } | OpKind::NativeFieldAddress { pointer, .. }
        | OpKind::NativeBitLoad { pointer, .. } | OpKind::NativeBitStore { pointer, .. }) = *kind
    else { unreachable!("only native memory operations are routed here"); };
    let HirType::NativePointer(storage) = &func.value(pointer).ty else {
        return Err(refuse(func, "native memory without a pointer"));
    };
    let base = name(pointer);
    Ok(match *kind {
        OpKind::NativeBitLoad { field, .. } | OpKind::NativeBitStore { field, .. } => {
            bit_field(func, kind, storage, field, &base, out, platform)?
        }
        OpKind::NativeFieldAddress { field, .. } => {
            let Pointee::Record(layout) = storage else { return Err(refuse(func, "field address without a native struct")); };
            let placed = nts_core::hir::layout::native_place(layout, platform.abi).ok_or_else(|| refuse(func, "native struct without a layout"))?;
            let offset = placed.offsets.get(field as usize).ok_or_else(|| refuse(func, "invalid native field index"))?;
            format!("{out} = getelementptr i8, ptr {base}, i64 {offset}")
        }
        OpKind::NativeIndexAddress { index, .. } => {
            let shape = nts_core::hir::layout::native_shape(storage, platform.abi).ok_or_else(|| refuse(func, "native pointer without an element size"))?;
            format!("{out}.offset = mul i64 {}, {}\n  {out} = getelementptr i8, ptr {base}, i64 {out}.offset", name(index), shape.size)
        }
        OpKind::NativeLoad { index, .. } | OpKind::NativeStore { index, .. } => {
            // The slot C laid out, which a `c_long` under Win64 makes
            // narrower than the value: stored truncated and loaded widened,
            // with the address arithmetic on the slot's own width.
            let slot = storage.abi_element_type(platform.abi).ok_or_else(|| refuse(func, "native memory without a loadable element"))?;
            let value = storage.element_type().ok_or_else(|| refuse(func, "native memory without a loadable element"))?;
            let widen = widening(&slot, &value);
            let element = ty_of(&slot, func)?;
            let address = format!("{out}.at = getelementptr {element}, ptr {base}, i64 {}", name(index));
            // An omitted `align` means the ABI alignment of the type, which for
            // a member of a packed record is a promise nothing made: `data` sits
            // at offset 4 of `struct epoll_event` and LLVM would assume 8. The
            // suffix is spelled only where it is not the default, so ordinary
            // native memory keeps the IR it had.
            let aligned = if matches!(storage, Pointee::Unaligned(_)) { ", align 1" } else { "" };
            let access = match kind {
                OpKind::NativeStore { value: stored, .. } if widen.is_some() => format!(
                    "{out}.narrow = trunc {} {} to {element}\n  store {element} {out}.narrow, ptr {out}.at{aligned}",
                    ty_of(&value, func)?,
                    name(*stored)
                ),
                OpKind::NativeStore { value, .. } => {
                    format!("store {element} {}, ptr {out}.at{aligned}", name(*value))
                }
                _ => match widen {
                    Some(widen) => format!(
                        "{out}.narrow = load {element}, ptr {out}.at{aligned}\n  {out} = {widen} {element} {out}.narrow to {}",
                        ty_of(&value, func)?
                    ),
                    None => format!("{out} = load {element}, ptr {out}.at{aligned}"),
                },
            };
            format!("{address}\n  {access}")
        }
        _ => unreachable!("only native memory operations are routed here"),
    })
}


pub(super) fn stack_storage(func: &Func, platform: Platform) -> Vec<String> {
    func.blocks.iter().flat_map(|b| &b.ops).filter_map(|at| {
        let op = func.value(*at);
        let OpKind::NativeLocal { count } = op.kind else { return None; };
        let HirType::NativePointer(element) = &op.ty else { return None; };
        let shape = nts_core::hir::layout::native_shape(element, platform.abi)?;
        Some(format!("{} = alloca [{} x i8], align {}", name(*at), shape.size * count, shape.align))
    }).collect()
}

pub(super) fn helpers(program: &super::Program) -> String {
    let allocate = program.funcs.iter().any(|f| f.values.iter().any(|op| matches!(op.kind, OpKind::NativeMalloc { .. })));
    let free = program.funcs.iter().any(|f| f.values.iter().any(|op| matches!(op.kind, OpKind::NativeFree { .. })));
    // The intrinsic is declared only where it is used, like the two above. An
    // unused `declare` is harmless and an undeclared use is not, so the
    // condition is the same shape either way -- this one exists so the IR of a
    // program that copies nothing is unchanged.
    let copies = program
        .funcs
        .iter()
        .any(|f| f.values.iter().any(|op| matches!(op.kind, OpKind::NativeCopy { .. })));
    let mut text = String::new();
    if copies {
        text.push_str("declare void @llvm.memcpy.p0.p0.i64(ptr, ptr, i64, i1)\n");
    }
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

/// A bit-field, which C reaches with a mask and a shift its own compiler
/// writes. Here there is no C compiler to do it, so the same arithmetic
/// is spelled out -- and that is the point rather than a cost: the C
/// backend emits `p->ihl` and lets the *header* decide where the bits
/// are, so a width this binding gets wrong is invisible there. It is
/// visible here, and `agrees_with_c` is then two independent derivations
/// of one answer rather than one derivation checked against itself.
        fn bit_field(
    func: &Func,
    kind: &OpKind,
    storage: &Pointee,
    field: u32,
    base: &str,
    out: &str,
    platform: Platform,
) -> Result<String, Diagnostic> {
    let Pointee::Record(layout) = storage else {
        return Err(refuse(func, "a bit-field through a pointer to something else"));
    };
    let placed = nts_core::hir::layout::native_place(layout, platform.abi)
        .ok_or_else(|| refuse(func, "a bit-field in a record with no layout"))?;
    let Some(Pointee::Bits { unit, width }) =
        layout.fields.get(field as usize).map(|member| &member.ty)
    else {
        return Err(refuse(func, "a bit-field index naming something else"));
    };
    let Some(Some(place)) = placed.bits.get(field as usize).copied() else {
        return Err(refuse(func, "a bit-field with no bit position"));
    };
    let byte = u64::from(
        *placed
            .offsets
            .get(field as usize)
            .ok_or_else(|| refuse(func, "a bit-field with no offset"))?,
    );
    let unit_ty = unit.abi(platform.abi);
    let signed = matches!(unit_ty, HirType::Int { signed: true, .. });
    let unit_bits = u64::from(
        nts_core::hir::layout::shape_of(&unit_ty)
            .ok_or_else(|| refuse(func, "a bit-field unit with no shape"))?
            .size,
    ) * 8;
    let width = u64::from(*width);

    // **Exactly the bytes the field occupies**, rather than the storage unit it
    // was declared in. The unit is the wrong span for a packed record: clang
    // puts `unsigned char p : 6; unsigned int q : 30;` packed at `0:0-5` and
    // `0:6-35`, so `q` ends four bits past the 32-bit unit it is declared in and
    // a unit-sized load returns 26 of its 30 bits. It is also the wrong span at
    // the end of a record, where a unit-sized load reads bytes the record does
    // not have.
    //
    // `align 1` because a packed record promises nothing, and because a field
    // that begins mid-byte has no alignment of its own to state. LLVM narrows
    // the load itself where the pointer is better aligned than that.
    let at = byte * 8 + u64::from(place.lo);
    let first = at / 8;
    let last = (at + width - 1) / 8;
    let span = (last - first + 1) * 8;
    let shift = at - first * 8;
    let ones = |bits: u64| if bits >= 64 { u64::MAX } else { (1u64 << bits) - 1 };
    let mask = ones(width);
    let held = format!("i{span}");
    let ty = ty_of(&unit_ty, func)?;
    let mut lines = vec![format!("{out}.at = getelementptr i8, ptr {base}, i64 {first}")];

    if let OpKind::NativeBitStore { value, .. } = *kind {
        // Read, clear, place, write back. The clear mask is kept inside the
        // span's own width: `!(mask << shift)` is computed at 64 bits, and
        // LLVM would truncate the constant silently rather than complain.
        let value = name(value);
        let widened = match span.cmp(&unit_bits) {
            std::cmp::Ordering::Equal => format!("{out}.wide = add {held} {value}, 0"),
            std::cmp::Ordering::Greater => format!("{out}.wide = zext {ty} {value} to {held}"),
            std::cmp::Ordering::Less => format!("{out}.wide = trunc {ty} {value} to {held}"),
        };
        lines.extend([
            format!("{out}.old = load {held}, ptr {out}.at, align 1"),
            format!("{out}.clear = and {held} {out}.old, {}", !(mask << shift) & ones(span)),
            widened,
            format!("{out}.keep = and {held} {out}.wide, {mask}"),
            format!("{out}.put = shl {held} {out}.keep, {shift}"),
            format!("{out}.new = or {held} {out}.clear, {out}.put"),
            format!("store {held} {out}.new, ptr {out}.at, align 1"),
        ]);
        return Ok(lines.join("\n  "));
    }

    lines.extend([
        format!("{out}.raw = load {held}, ptr {out}.at, align 1"),
        format!("{out}.sh = lshr {held} {out}.raw, {shift}"),
        format!("{out}.cut = and {held} {out}.sh, {mask}"),
    ]);
    // Back to the unit the member is declared as, then sign-extended from its
    // own width if that unit is signed -- `int x : 4` holding `0b1111` is -1,
    // and the mask above made it 15.
    let narrowed = match span.cmp(&unit_bits) {
        std::cmp::Ordering::Equal => format!("{out}.val = add {held} {out}.cut, 0"),
        std::cmp::Ordering::Greater => format!("{out}.val = trunc {held} {out}.cut to {ty}"),
        std::cmp::Ordering::Less => format!("{out}.val = zext {held} {out}.cut to {ty}"),
    };
    lines.push(narrowed);
    if signed && width < unit_bits {
        lines.push(format!("{out}.top = shl {ty} {out}.val, {}", unit_bits - width));
        lines.push(format!("{out} = ashr {ty} {out}.top, {}", unit_bits - width));
    } else {
        lines.push(format!("{out} = add {ty} {out}.val, 0"));
    }
    Ok(lines.join("\n  "))
}
