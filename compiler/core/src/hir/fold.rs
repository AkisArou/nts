//! Replacing computations whose answer is already known.
//!
//! # Why the analysis should do this rather than the C compiler
//!
//! Because it knows things the C compiler cannot. `ToInt32(0.0)` is the
//! coercion half of `x | 0`, and it lowers to a call that reduces modulo 2^32
//! with `fmod` — total, correct, and expensive. Clang will not fold it away,
//! because from clang's side it is an opaque function of a runtime value.
//!
//! The analysis already proved the answer is exactly `0`. Saying so turns a
//! library call in a loop body into a constant.

use super::facts::Facts;
use super::flow::Analysis;
use super::{Func, OpKind, ValueId};

/// Replace pure operations of known result with constants, and report how many.
pub fn fold(func: &mut Func, analysis: &Analysis) -> usize {
    let mut folded = 0;
    for index in 0..func.values.len() {
        let id = ValueId(u32::try_from(index).unwrap_or(0));

        // A parameter is an input and a call may have effects; neither is a
        // computation whose result can simply be written down. Constants are
        // already what they would be folded to.
        if matches!(
            func.values[index].kind,
            OpKind::Param(_)
                | OpKind::BlockParam(_)
                | OpKind::Call { .. }
                | OpKind::ConstInt(_)
                | OpKind::ConstFloat(_)
                | OpKind::ConstBool(_)
                | OpKind::ConstString(_)
                | OpKind::Return(_)
        ) {
            continue;
        }

        let facts = analysis.get(id);
        if !exactly_one_value(facts) {
            continue;
        }
        func.values[index].kind = OpKind::ConstFloat(facts.lo);
        folded += 1;
    }
    folded
}

/// Whether a set is one value that can be written as a literal.
///
/// A singleton at zero that may be negative zero is *two* values as far as
/// anything observable goes — `1 / -0` and `1 / 0` differ — and the interval
/// cannot say which. Refusing to fold it is the only safe reading.
fn exactly_one_value(facts: Facts) -> bool {
    facts.is_singleton()
        && !facts.maybe_nan
        && facts.lo.is_finite()
        && !(facts.lo == 0.0 && facts.maybe_negative_zero)
}
