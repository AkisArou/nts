//! What a synchronous callback bridge may contain.
//!
//! A bridge is a plain C function pointer. Foreign code calls it, the closure
//! body runs, and a value is returned to a frame that belongs to the foreign
//! caller. There is no point in that sequence where control can be handed to a
//! scheduler: the stack below the bridge is `qsort`'s or `epoll_wait`'s, and
//! nothing on this side owns the loop that would resume it.
//!
//! So a body that suspends cannot be bridged. The interesting part is not the
//! `await` itself but what it implies -- a microtask queued while a foreign
//! library's frames are live, which someone must eventually run. Whether the
//! bridge should drain that queue before returning, or leave it for an
//! embedder's loop, is a decision with consequences in both directions and no
//! consumer yet asking for either. Until one exists this is refused by name, so
//! that the absence is a diagnostic rather than a callback which silently never
//! completes.
//!
//! The rule is deliberately about the *bridged body*, not about the function
//! creating the bridge: `register(async () => ...)` may itself be a perfectly
//! ordinary synchronous function, and an `async` caller handing a synchronous
//! callback to C is fine.
use rustc_hash::FxHashMap;
use super::{OpKind, Program, TypeId, ValueId};

/// Bridges whose closure body suspends, as `(function, value, why)` triples in
/// the shape [`super::native_storage::check`] uses.
pub(super) fn check(program: &Program) -> Vec<(usize, ValueId, &'static str)> {
    let mut problems = Vec::new();
    // Built once and only when something is bridged: the map walks every
    // layout, and most programs bridge nothing at all.
    let mut bodies: Option<FxHashMap<TypeId, &str>> = None;
    for (at, func) in program.funcs.iter().enumerate() {
        for block in &func.blocks {
            for &value in &block.ops {
                let OpKind::NativeBridge { closure, .. } = func.value(value).kind else { continue };
                let bodies = bodies.get_or_insert_with(|| closure_bodies(program));
                // No method means the bridge publishes no function at all,
                // which the emitter refuses with a better message than this
                // one could give -- it can name the layout.
                let super::HirType::Managed(super::ManagedType::Object(id)) =
                    func.values[closure.0 as usize].ty
                else {
                    continue;
                };
                let Some(body) = bodies.get(&id) else { continue };
                if program.funcs.iter().any(|f| f.name == *body && super::native_storage::suspends(f)) {
                    problems.push((at, value, "an `async` callback cannot be bridged to C; a bridge runs to completion"));
                }
            }
        }
    }
    problems
}

/// The function each closure type calls, for the closure types that have one.
fn closure_bodies(program: &Program) -> FxHashMap<TypeId, &str> {
    let mut bodies = FxHashMap::default();
    for layout in &program.layouts {
        let Some(body) = layout.methods.iter().flatten().next() else { continue };
        for ty in &layout.types {
            bodies.insert(*ty, body.as_str());
        }
    }
    bodies
}
