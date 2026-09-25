//! Objective-C sends: the facts every backend prints, decided once.
//!
//! Which selectors and classes a program sends to, and the symbol each one's
//! cached lookup has. The C backend prints a `static` function and the LLVM
//! backend an `internal` one, but both call it by the same name. A program's
//! IR and its C can then be read side by side, and there is one mangling to
//! keep injective rather than two to keep in step.

use std::fmt::Write as _;

use nts_core::hir::native::{FnPointer, Pointee, Scalar, Type};
use nts_core::hir::{Callee, OpKind, Program};

/// Every distinct selector and class a program sends to, sorted, so both
/// backends emit their lookups in the same order.
#[derive(Debug, Default)]
pub struct Lookups<'p> {
    pub selectors: Vec<&'p str>,
    pub classes: Vec<&'p str>,
    /// Whether any send returns a record by value, which on `x86_64` may have
    /// to go through `objc_msgSend_stret` instead.
    pub returns_records: bool,
    /// Whether any send is `[super m]` (`objc_msgSendSuper`).
    pub supers: bool,
}

#[must_use]
pub fn lookups(program: &Program) -> Lookups<'_> {
    let mut found = Lookups::default();
    for func in &program.funcs {
        for op in &func.values {
            if let OpKind::Call { callee: Callee::Native(target), .. } = &op.kind
                && let Some(send) = &target.send
            {
                found.selectors.push(send.selector.as_str());
                found.classes.extend(send.class.as_deref());
                found.classes.extend(send.super_of.as_deref());
                found.supers |= send.super_of.is_some();
                found.returns_records |= target.destination().is_some();
            }
            if let OpKind::ObjcClass { name, .. } = &op.kind {
                found.classes.push(name.as_str());
            }
        }
    }
    for list in [&mut found.selectors, &mut found.classes] {
        list.sort_unstable();
        list.dedup();
    }
    found
}

/// The lookup that answers a selector's `SEL`: `nts_objc_sel_initWithUTF8String_c`.
#[must_use]
pub fn selector_symbol(selector: &str) -> String {
    format!("nts_objc_sel_{}", mangle(selector))
}

/// The lookup that answers a class object: `nts_objc_class_NSString`.
#[must_use]
pub fn class_symbol(class: &str) -> String {
    format!("nts_objc_class_{}", mangle(class))
}

/// Every distinct block signature a program builds, sorted by its spelled
/// name, so both backends emit one invoke adapter and one descriptor each.
#[must_use]
pub fn block_signatures(program: &Program) -> Vec<&FnPointer> {
    let mut found: Vec<&FnPointer> = Vec::new();
    for func in &program.funcs {
        for op in &func.values {
            if let OpKind::NativeBlock { signature, .. } = &op.kind
                && !found.iter().any(|seen| seen.name == signature.name)
            {
                found.push(signature);
            }
        }
    }
    found.sort_by(|a, b| a.name.cmp(&b.name));
    found
}

/// A signature's invoke adapter, `nts_block_invoke_NtsFn_void_int`.
#[must_use]
pub fn block_invoke_symbol(signature: &FnPointer) -> String {
    format!("nts_block_invoke_{}", signature.name)
}

/// A signature's descriptor, `nts_block_descriptor_NtsFn_void_int`.
#[must_use]
pub fn block_descriptor_symbol(signature: &FnPointer) -> String {
    format!("nts_block_descriptor_{}", signature.name)
}

/// The block's Objective-C type encoding, as clang writes it for the same
/// signature: the result, the frame size, the block itself as `@?0`, then
/// each argument and its offset. `void (^)(int)` is `v12@?0i8`. An argument
/// narrower than `int` is promoted to one, as the calling convention does.
///
/// What `BLOCK_HAS_SIGNATURE` promises is in the descriptor, and runtime
/// paths that introspect a block (`NSInvocation`, a block's description)
/// read it, so it has to be a real encoding, not a placeholder.
#[must_use]
pub fn block_encoding(signature: &FnPointer) -> String {
    let mut offset = 8usize;
    let mut arguments = String::new();
    for parameter in &signature.parameters {
        let (code, size) = encoding(parameter);
        let code = code.as_str();
        let _ = write!(arguments, "{code}{offset}");
        offset += size;
    }
    format!("{}{offset}@?0{arguments}", encoding(&signature.result).0)
}

/// A method's Objective-C type encoding, as clang writes it for the same
/// signature: the result, the frame size, then each argument at its offset --
/// the receiver `@0`, `_cmd` `:8`, and the rest. `-(void)pressed:(id)sender`
/// is `v24@0:8@16`. What `class_addMethod` records, and what `NSInvocation`
/// and forwarding read back.
#[must_use]
pub fn method_encoding(signature: &FnPointer) -> String {
    let mut offset = 0usize;
    let mut arguments = String::new();
    for (at, parameter) in signature.parameters.iter().enumerate() {
        let (code, size) = if at == 1 { (":".to_owned(), 8) } else { encoding(parameter) };
        let code = code.as_str();
        let _ = write!(arguments, "{code}{offset}");
        offset += size;
    }
    format!("{}{offset}{arguments}", encoding(&signature.result).0)
}

/// The entry point the runtime calls for method `at` of class `class`.
#[must_use]
pub fn imp_symbol(class: &str, at: usize) -> String {
    format!("nts_imp_{}_{at}", mangle(class))
}

/// The entry point the runtime calls to make the object holding class
/// `class`'s fields: the compiled `{class}#state`, entered as a callback.
#[must_use]
pub fn state_symbol(class: &str) -> String {
    format!("nts_objc_state_{class}")
}

/// The table of class `class`'s methods, as `nts_objc_register_class` reads it.
#[must_use]
pub fn methods_symbol(class: &str) -> String {
    format!("nts_objc_methods_{}", mangle(class))
}

/// The program's Objective-C classes -- the foreign classes of that family --
/// each after the class it extends where that is one of them too, as the
/// runtime must register them.
#[must_use]
pub fn classes_in_order(program: &Program) -> Vec<&nts_core::hir::ForeignClass> {
    let objc = || program.foreign_classes.iter().filter(|class| class.family == nts_core::hir::native::Family::Objc);
    let mut ordered: Vec<&nts_core::hir::ForeignClass> = Vec::new();
    let mut pending: Vec<&nts_core::hir::ForeignClass> = objc().collect();
    while !pending.is_empty() {
        let before = pending.len();
        pending.retain(|class| {
            let waits = objc().any(|other| other.name == class.superclass)
                && !ordered.iter().any(|done| done.name == class.superclass);
            if !waits {
                ordered.push(class);
            }
            waits
        });
        // A cycle cannot be written in TypeScript; stop rather than spin.
        if pending.len() == before {
            ordered.append(&mut pending);
        }
    }
    ordered
}

/// One type's encoding and its size in an argument frame.
fn encoding(ty: &Type) -> (String, usize) {
    if let Type::Record(record) = ty {
        // `{CGRect={CGPoint=dd}{CGSize=dd}}`, as clang writes a struct by
        // value, and its size, as Apple's LP64 lays it out.
        let size = nts_core::hir::layout::native_place(record, nts_core::hir::native::NativeAbi::SysV).map_or(0, |placed| placed.size);
        return (record_encoding(record), usize::try_from(size).unwrap_or(0));
    }
    let (code, size) = scalar_encoding(ty);
    (code.to_owned(), size)
}

/// A record's encoding: its tag, then each member's.
fn record_encoding(record: &nts_core::hir::native::Record) -> String {
    let members: String = record.fields.iter().map(|field| pointee_encoding(&field.ty)).collect();
    format!("{{{}={members}}}", record.name)
}

/// A member's encoding, as it sits inside a record.
fn pointee_encoding(pointee: &Pointee) -> String {
    match pointee {
        Pointee::Scalar(scalar) => scalar_encoding(&Type::Scalar(*scalar)).0.to_owned(),
        Pointee::Record(record) => record_encoding(record),
        Pointee::Array { element, length } => format!("[{length}{}]", pointee_encoding(element)),
        Pointee::Const(inner) => pointee_encoding(inner),
        _ => "^v".to_owned(),
    }
}

/// A type's one-letter (or pointer) encoding and its size in a frame.
fn scalar_encoding(ty: &Type) -> (&'static str, usize) {
    match ty {
        Type::Void => ("v", 0),
        Type::Bool => ("B", 4),
        Type::Scalar(scalar) => match scalar {
            Scalar::Char | Scalar::Int8 => ("c", 4),
            Scalar::UInt8 => ("C", 4),
            Scalar::Int16 => ("s", 4),
            Scalar::UInt16 => ("S", 4),
            Scalar::Int | Scalar::Int32 => ("i", 4),
            Scalar::UInt | Scalar::UInt32 => ("I", 4),
            // A 32-bit `long` exists only on Win64 and is refused on Apple
            // before a message is encoded; `l`/`L` are its letters.
            Scalar::Long32 => ("l", 4),
            Scalar::ULong32 => ("L", 4),
            Scalar::Int64 | Scalar::Long | Scalar::Ptrdiff => ("q", 8),
            Scalar::UInt64 | Scalar::ULong | Scalar::Size => ("Q", 8),
            Scalar::Float => ("f", 4),
            Scalar::Double => ("d", 8),
        },
        Type::BigInt => ("q", 8),
        Type::Pointer(pointee) if pointee.counting().is_some() => ("@", 8),
        Type::Pointer(Pointee::Const(inner)) if matches!(**inner, Pointee::Scalar(Scalar::Char)) => ("r*", 8),
        Type::FnPointer(_) => ("^?", 8),
        Type::Pointer(_) | Type::Managed(_) | Type::Erased => ("^v", 8),
        // Handled by `encoding`, which builds the record's spelling.
        Type::Record(_) => ("?", 0),
    }
}

/// A selector as C identifier characters, injectively: `_` is `_u` and `:` is
/// `_c`, so `a_b:` and `a:b_` cannot meet. Selectors are checked to hold
/// only identifier characters and colons where they are read.
fn mangle(selector: &str) -> String {
    let mut out = String::with_capacity(selector.len() + 4);
    for character in selector.chars() {
        match character {
            '_' => out.push_str("_u"),
            ':' => out.push_str("_c"),
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::mangle;

    #[test]
    fn block_encodings_are_the_ones_clang_writes() {
        use nts_core::hir::native::{FnPointer, Scalar, Type};
        let block = |parameters: Vec<Type>, result: Type| super::block_encoding(&FnPointer::spell(parameters, result));
        // Each is what clang wrote into the descriptor of the same block,
        // read back with libclosure's `_Block_signature` on the lane's Mac
        // (x86_64-apple-macos13), 2026-09-24.
        assert_eq!(block(vec![], Type::Void), "v8@?0");
        assert_eq!(block(vec![Type::Scalar(Scalar::Int)], Type::Void), "v12@?0i8");
        assert_eq!(block(vec![Type::Scalar(Scalar::Double), Type::Bool], Type::Scalar(Scalar::Int)), "i20@?0d8B16");
    }

    #[test]
    fn mangling_keeps_underscores_and_colons_apart() {
        assert_eq!(mangle("initWithUTF8String:"), "initWithUTF8String_c");
        assert_ne!(mangle("a_b:"), mangle("a:b_"));
        assert_ne!(mangle("a_c"), mangle("a:"));
    }
}

/// How one argument of a block is carried to the thread that owns its
/// closure, when the platform calls the block on another: copied as it is,
/// or an object held across with a count of its own.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Carried {
    Copied,
    Counted(nts_core::hir::native::Counting),
}

/// Each argument's carriage, for a block the platform may call on a thread
/// that is not its closure's -- a completion handler on a background queue
/// -- or `None` where the call cannot be carried: a block that returns a
/// value, whose caller is waiting for it, or one given a pointer into memory
/// the caller owns only for the call (`BOOL *stop`).
#[must_use]
pub fn hop_arguments(signature: &FnPointer) -> Option<Vec<Carried>> {
    if !matches!(*signature.result, nts_core::hir::native::Type::Void) {
        return None;
    }
    signature
        .parameters
        .iter()
        .map(|ty| match ty {
            nts_core::hir::native::Type::Record(_) => Some(Carried::Copied),
            _ => match ty.representation() {
                nts_core::hir::HirType::Int { .. } | nts_core::hir::HirType::Float { .. } | nts_core::hir::HirType::Bool => {
                    Some(Carried::Copied)
                }
                other => other.counting().map(Carried::Counted),
            },
        })
        .collect()
}

/// A signature's carried call, `nts_block_hop_NtsFn_void_id`.
#[must_use]
pub fn block_hop_symbol(signature: &FnPointer) -> String {
    format!("nts_block_hop_{}", signature.name)
}
