//! What both backends derive the same way for the Windows Runtime's delegates.

use nts_core::hir::native::FnPointer;
use nts_core::hir::{OpKind, Program};

/// Every distinct delegate signature a program makes an object for, sorted by
/// its spelled name, so both backends emit one `Invoke` adapter each.
#[must_use]
pub fn delegate_signatures(program: &Program) -> Vec<&FnPointer> {
    let mut found: Vec<&FnPointer> = Vec::new();
    for func in &program.funcs {
        for op in &func.values {
            if let OpKind::DelegateInvoke { signature } = &op.kind
                && !found.iter().any(|seen| seen.name == signature.name)
            {
                found.push(signature);
            }
        }
    }
    found.sort_by(|a, b| a.name.cmp(&b.name));
    found
}

/// A signature's carried `Invoke`, `nts_com_hop_NtsFn_void_ptr_ptr`: the
/// arguments' type and the `run` that unpacks them on the owning thread.
#[must_use]
pub fn delegate_hop_symbol(signature: &FnPointer) -> String {
    format!("nts_com_hop_{}", signature.name)
}

/// A signature's `Invoke` adapter, `nts_com_invoke_NtsFn_void_ptr_ptr`.
#[must_use]
pub fn delegate_invoke_symbol(signature: &FnPointer) -> String {
    format!("nts_com_invoke_{}", signature.name)
}

/// The classes the program writes over composable Windows Runtime classes
/// (`class App extends Application`), as the runtime composes them.
#[must_use]
pub fn classes(program: &Program) -> Vec<&nts_core::hir::ForeignClass> {
    program
        .foreign_classes
        .iter()
        .filter(|class| class.family == nts_core::hir::native::Family::Com)
        .collect()
}

/// One interface a composed class answers itself: its IID's two words and
/// what answers each slot from 6 up, in slot order. Lowering has checked that
/// the slots are every method the base declares for the interface, each an
/// override or forwarded, so they run without a gap.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Interface {
    pub iid: String,
    pub low: u64,
    pub high: u64,
    pub slots: Vec<(u32, Answer)>,
}

/// What answers a slot: an override (an index into the class's methods), or
/// the base's own implementation (into its composition's `forwarded`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Answer {
    Override(usize),
    Forward(usize),
}

/// A composed class's interfaces, in the order its methods first name them.
#[must_use]
pub fn interfaces(class: &nts_core::hir::ForeignClass) -> Vec<Interface> {
    let mut found: Vec<Interface> = Vec::new();
    let mut answer = |iid: &String, slot: u32, answer: Answer| {
        let index = found.iter().position(|interface| interface.iid == *iid).unwrap_or_else(|| {
            let (low, high) = nts_core::hir::native::iid_words(iid).unwrap_or_default();
            found.push(Interface { iid: iid.clone(), low, high, slots: Vec::new() });
            found.len() - 1
        });
        found[index].slots.push((slot, answer));
    };
    for (at, method) in class.methods.iter().enumerate() {
        if let nts_core::hir::Dispatch::Slot { iid, slot } = &method.dispatch {
            answer(iid, *slot, Answer::Override(at));
        }
    }
    let forwarded = class.composition.iter().flat_map(|composition| composition.forwarded.iter());
    for (at, forward) in forwarded.enumerate() {
        answer(&forward.iid, forward.slot, Answer::Forward(at));
    }
    for interface in &mut found {
        interface.slots.sort_unstable();
    }
    found
}

/// A forwarded slot's adapter, `nts_com_forward_App_0`: the base's
/// implementation called with the same arguments.
#[must_use]
pub fn forward_symbol(class: &str, at: usize) -> String {
    format!("nts_com_forward_{class}_{at}")
}

/// An override's adapter, `nts_com_adapter_App_0`: what the interface's
/// table calls.
#[must_use]
pub fn adapter_symbol(class: &str, at: usize) -> String {
    format!("nts_com_adapter_{class}_{at}")
}

/// An interface's table, `nts_com_table_App_0`.
#[must_use]
pub fn table_symbol(class: &str, interface: usize) -> String {
    format!("nts_com_table_{class}_{interface}")
}

/// A class's interfaces, `nts_com_interfaces_App`.
#[must_use]
pub fn interfaces_symbol(class: &str) -> String {
    format!("nts_com_interfaces_{class}")
}

/// A class's descriptor, `nts_com_class_App`, which the runtime composes it
/// from.
#[must_use]
pub fn class_symbol(class: &str) -> String {
    format!("nts_com_class_{class}")
}

/// Slots 0 to 5 of every table: `IUnknown`'s and `IInspectable`'s, the
/// outer object's.
pub const OUTER_SLOTS: [&str; 6] = [
    "nts_com_outer_query",
    "nts_com_outer_addref",
    "nts_com_outer_release",
    "nts_com_outer_iids",
    "nts_com_outer_name",
    "nts_com_outer_trust",
];
