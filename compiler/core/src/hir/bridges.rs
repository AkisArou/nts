//! What a callback bridge may hand the closure behind it.
//!
//! A closure passed to C -- `Closure<(event: Event) => void>` -- is called
//! through a bridge the backend writes: C calls it with what the binding
//! declares, and it calls the closure's `call` with each argument cast to what
//! the closure declares. A cast between two handles is a C cast, which checks
//! nothing; so this decides, before any backend, which pairs can be the same
//! object.
//!
//! - **The same handle, or the closure takes a base** of what C passes: an
//!   upcast, always sound.
//! - **The closure takes a kind of what C passes**, along that handle's own
//!   chain: [`trusted_downcast`]. lib.dom.d.ts's event maps are the reason it
//!   exists -- `addEventListener("click", (ev: MouseEvent) => ...)` is typed by
//!   the map, and the binding passes the `Event` the DOM dispatches, which for
//!   `"click"` *is* a `MouseEvent`, exactly as in a browser.
//! - **Anything else** is two unrelated handles, which no cast makes one
//!   object: refused at the call, in the shape `dispatch::check` uses.
use rustc_hash::FxHashMap;

use super::native::{Handle, Pointee, Type};
use super::{Func, HirType, ManagedType, OpKind, Program, ValueId};

/// Bridges whose closure takes a handle the binding cannot be passing, as
/// `(function, value, why)`.
pub(super) fn check(program: &Program) -> Vec<(usize, ValueId, String)> {
    let by_name: FxHashMap<&str, &Func> = program
        .funcs
        .iter()
        .map(|func| (func.name.as_str(), func))
        .collect();
    let mut problems = Vec::new();
    for (at, func) in program.funcs.iter().enumerate() {
        for block in &func.blocks {
            for &value in &block.ops {
                let OpKind::NativeBridge {
                    closure,
                    signature,
                    bridging,
                    ..
                } = &func.value(value).kind
                else {
                    continue;
                };
                let HirType::Managed(ManagedType::Object(ty)) = func.value(*closure).ty else {
                    continue;
                };
                let Some(body) = program
                    .layout(ty)
                    .and_then(super::Layout::closure_call)
                    .and_then(|call| by_name.get(call))
                else {
                    continue;
                };
                // What a function lowering made converts -- which has to be
                // there to be called.
                for converted in &bridging.converted {
                    if !by_name.contains_key(converted.function.as_str()) {
                        problems.push((
                            at,
                            value,
                            format!(
                                "a callback whose argument {} is converted by `{}`, which did not compile",
                                converted.at, converted.function
                            ),
                        ));
                    }
                }
                // Each of C's arguments where the closure takes it -- after its
                // receiver, and past an array's length, which rides with the
                // array -- except what the bridge itself converts: an array of
                // handles, a boxed record, a sequence.
                for (c_at, foreign) in signature.parameters.iter().enumerate() {
                    let Type::Pointer(Pointee::Opaque(passed)) = foreign else {
                        continue;
                    };
                    if bridging.array(c_at).is_some()
                        || bridging.boxed(c_at).is_some()
                        || bridging.converted(c_at).is_some()
                    {
                        continue;
                    }
                    let Some(taken) = bridging
                        .parameter(c_at)
                        .and_then(|parameter| body.params.get(parameter + 1))
                    else {
                        continue;
                    };
                    // And a string the bridge copies in: an `NSString` a block
                    // is given, as the program's string -- asked of the
                    // predicate the backends' bridges ask, so the check and the
                    // conversion are one rule.
                    if super::native::lent_string(foreign, &taken.ty)
                        || super::native::lent_ns_string(foreign, &taken.ty)
                    {
                        continue;
                    }
                    let why = match &taken.ty {
                        HirType::NativePointer(Pointee::Opaque(taken)) if admits(passed, taken) => {
                            continue;
                        }
                        HirType::NativePointer(Pointee::Opaque(taken)) => format!(
                            "a callback taking a `{}` where its binding passes a `{}`, which is not one of its kinds",
                            taken.tag, passed.tag
                        ),
                        // **A handle is never a managed value.** lib.dom's
                        // `MutationObserver` callback takes `MutationRecord[]`
                        // where nts:dom passes a `MutationRecordSequence`, and
                        // this let the bridge cast the sequence to an array.
                        HirType::Managed(ManagedType::Array(_)) => format!(
                            "a callback taking an array where its binding passes a `{}`, which the bridge does not make one of",
                            passed.tag
                        ),
                        HirType::Managed(_) => format!(
                            "a callback taking a managed value where its binding passes a `{}` handle",
                            passed.tag
                        ),
                        _ => continue,
                    };
                    problems.push((at, value, why));
                }
            }
        }
    }
    problems
}

/// Whether a callback taking `taken` can be handed what its binding passes.
fn admits(passed: &Handle, taken: &Handle) -> bool {
    passed == taken || passed.upcasts_to(taken) || trusted_downcast(passed, taken)
}

/// Whether a callback may take `taken` where its binding passes `passed`:
/// `taken` is a kind of `passed`, along `passed`'s own chain.
///
/// Trusted, not tested: the program's types say which kind arrives -- an event
/// map's `"click"` is a `MouseEvent` -- and they are the types page script is
/// checked against. A test under a debug flag (`nts_dom_is`) is the open half.
fn trusted_downcast(passed: &Handle, taken: &Handle) -> bool {
    taken.upcasts_to(passed)
}

#[cfg(test)]
mod tests {
    use super::{Handle, admits};
    use crate::hir::native::{Family, HostFamily};

    fn handle(chain: &[&str]) -> Handle {
        let (tag, ancestors) = chain.split_last().expect("a chain names its handle");
        Handle {
            tag: (*tag).to_owned(),
            ancestors: ancestors.iter().map(|name| (*name).to_owned()).collect(),
            family: Family::Host(HostFamily::of("nts_dom_retain", "nts_dom_release")),
            interface: false,
        }
    }

    #[test]
    fn a_callback_takes_its_handle_a_base_or_a_kind_and_nothing_else() {
        let event = handle(&["NtsDomEventTarget", "NtsDomEvent"]);
        let mouse = handle(&[
            "NtsDomEventTarget",
            "NtsDomEvent",
            "NtsDomUIEvent",
            "NtsDomMouseEvent",
        ]);
        let text = handle(&[
            "NtsDomEventTarget",
            "NtsDomNode",
            "NtsDomCharacterData",
            "NtsDomText",
        ]);
        assert!(admits(&event, &event), "the same handle");
        assert!(
            admits(&mouse, &event),
            "an upcast: the callback takes a base"
        );
        assert!(
            admits(&event, &mouse),
            "the trusted downcast: an event map's kind"
        );
        assert!(
            !admits(&event, &text),
            "another chain is no kind of an event"
        );
    }
}
