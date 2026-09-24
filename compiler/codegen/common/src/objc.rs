//! Objective-C sends: the facts every backend prints, decided once.
//!
//! Which selectors and classes a program sends to, and the symbol each one's
//! cached lookup has. The C backend prints a `static` function and the LLVM
//! backend an `internal` one, but both call it by the same name. A program's
//! IR and its C can then be read side by side, and there is one mangling to
//! keep injective rather than two to keep in step.

use nts_core::hir::{Callee, OpKind, Program};

/// Every distinct selector and class a program sends to, sorted, so both
/// backends emit their lookups in the same order.
#[derive(Debug, Default)]
pub struct Lookups<'p> {
    pub selectors: Vec<&'p str>,
    pub classes: Vec<&'p str>,
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
    fn mangling_keeps_underscores_and_colons_apart() {
        assert_eq!(mangle("initWithUTF8String:"), "initWithUTF8String_c");
        assert_ne!(mangle("a_b:"), mangle("a:b_"));
        assert_ne!(mangle("a_c"), mangle("a:"));
    }
}
