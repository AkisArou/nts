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
        let _ = write!(arguments, "{code}{offset}");
        offset += size;
    }
    format!("{}{offset}@?0{arguments}", encoding(&signature.result).0)
}

/// One type's encoding and its size in an argument frame.
fn encoding(ty: &Type) -> (&'static str, usize) {
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
        Type::Record(_) => unreachable!("a function type never holds a record by value: `abi_type` refuses one"),
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
