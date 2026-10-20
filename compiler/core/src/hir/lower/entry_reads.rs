//! A string record's entry, read where the checker says the entry is there.
//!
//! Without `noUncheckedIndexedAccess` the checker types `rec[k]` of a
//! `Record<string, number>` as `number`, and a missing key is `undefined` all
//! the same. `nts_map_get` answers the erased `undefined` honestly; what read
//! it back did not. At a number or a boolean there is no room for an absence,
//! so the unerase read whatever payload `undefined` carries -- 0 on C, LLVM
//! and the JVM, where Wasm stopped by name -- and the checker's `number` folded
//! `rec[k] === undefined` to `false`.
//!
//! Two answers, by what the read is for:
//!
//! * Where its consumer asks only whether the entry is there -- `??`, `||`,
//!   `??=`, `||=`, a truthiness test, `typeof`, a comparison with `null` or
//!   `undefined` -- the read stays erased into that consumer, which answers
//!   from the tag: the language's answer, absence included.
//!   `(counts[w] || 0) + 1` is the idiom.
//! * Anywhere else -- arithmetic, a store, an argument -- the entry is checked
//!   to be the scalar its type says before it is unerased, and a missing key
//!   stops by name, in the words Wasm's own unerase uses, rather than reading
//!   as 0.
//!
//! A string or a reference keeps the null pointer its absence reads as, which
//! a program's own `!v` and `v == null` already test.

use super::{
    BinOp, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind, ValueId, syntax,
};
use crate::hir::tags;

/// The erased `read` a string record's entry access at `at` produced, as its
/// consumer takes it.
pub(super) fn narrowed(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    read: ValueId,
) -> Result<ValueId, Diagnostic> {
    let Some((tag, what)) = scalar(builder, at) else {
        return builder.narrowed(at, read);
    };
    if asks_whether_present(builder, at) {
        return Ok(read);
    }
    let origin = builder.origin(at);
    let unsigned = HirType::Int {
        bits: 32,
        signed: false,
    };
    let held = builder.push(
        OpKind::TagOf { value: read },
        unsigned.clone(),
        origin.clone(),
    );
    let expected = builder.push(OpKind::ConstInt(i128::from(tag)), unsigned, origin.clone());
    let other = builder.push(
        OpKind::Binary {
            op: BinOp::Ne,
            lhs: held,
            rhs: expected,
        },
        HirType::Bool,
        origin,
    );
    builder.stop_when(at, other, what);
    builder.narrowed(at, read)
}

/// Whether `node` reads a string record's entry at a scalar type for a
/// consumer that asks only whether it is there, so that its value arrives
/// erased: what a consumer that would otherwise answer from the checker's
/// type -- `typeof`, `=== undefined` -- asks before it does.
pub(super) fn stays_erased(builder: &FuncBuilder<'_>, node: NodeId) -> bool {
    let mut read = node;
    while builder.kind_of(read) == Some(syntax::PARENTHESIZED_EXPRESSION) {
        let Some(&inner) = builder.children(read).first() else {
            return false;
        };
        read = inner;
    }
    if !matches!(
        builder.kind_of(read),
        Some(syntax::ELEMENT_ACCESS_EXPRESSION | syntax::PROPERTY_ACCESS_EXPRESSION)
    ) {
        return false;
    }
    let parts = builder.children(read);
    let optional = parts
        .iter()
        .any(|part| builder.kind_of(*part) == Some(syntax::QUESTION_DOT_TOKEN));
    let table = parts.first().and_then(|object| builder.type_of(*object));
    !optional
        && matches!(table, Some(HirType::Managed(ManagedType::Table(..))))
        && scalar(builder, read).is_some()
        && asks_whether_present(builder, read)
}

/// The tag a read at `at` must carry and the stop's words, where its type is
/// a scalar with no room for an absence.
fn scalar(builder: &FuncBuilder<'_>, at: NodeId) -> Option<(u32, &'static str)> {
    match builder.type_of(at)? {
        HirType::Float { .. } | HirType::Int { .. } => Some((
            tags::NUMBER,
            "an erased value read as a number, which it is not",
        )),
        HirType::Bool => Some((
            tags::BOOLEAN,
            "an erased value read as a boolean, which it is not",
        )),
        _ => None,
    }
}

/// Whether the expression at `node`, through any parentheses, is asked only
/// whether it is there, by a consumer that answers from an erased value's tag.
fn asks_whether_present(builder: &FuncBuilder<'_>, node: NodeId) -> bool {
    let mut at = node;
    let Some(mut parent) = builder.syntactic_parent(at) else {
        return false;
    };
    while builder.kind_of(parent) == Some(syntax::PARENTHESIZED_EXPRESSION) {
        at = parent;
        let Some(next) = builder.syntactic_parent(at) else {
            return false;
        };
        parent = next;
    }
    let parts = builder.children(parent);
    match builder.kind_of(parent) {
        Some(syntax::BINARY_EXPRESSION) => {
            let [left, operator, right] = parts[..] else {
                return false;
            };
            match builder.kind_of(operator) {
                Some(
                    syntax::QUESTION_QUESTION_TOKEN
                    | syntax::BAR_BAR_TOKEN
                    | syntax::QUESTION_QUESTION_EQUALS_TOKEN
                    | syntax::BAR_BAR_EQUALS_TOKEN,
                ) => left == at,
                Some(
                    syntax::EQUALS_EQUALS_TOKEN
                    | syntax::EQUALS_EQUALS_EQUALS_TOKEN
                    | syntax::EXCLAMATION_EQUALS_TOKEN
                    | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN,
                ) => absent_literal(builder, if left == at { right } else { left }),
                _ => false,
            }
        }
        Some(syntax::TYPE_OF_EXPRESSION) => true,
        Some(syntax::PREFIX_UNARY_EXPRESSION) => matches!(
            builder.node(parent).data,
            nts_semantic_schema::NodeData::Children { small, .. }
                if small & syntax::prefix_operator::MASK == syntax::prefix_operator::EXCLAMATION
        ),
        // The condition, which is tested for truthiness and nothing else.
        Some(syntax::IF_STATEMENT | syntax::WHILE_STATEMENT | syntax::CONDITIONAL_EXPRESSION) => {
            parts.first() == Some(&at)
        }
        _ => false,
    }
}

/// `null` or `undefined`, written.
fn absent_literal(builder: &FuncBuilder<'_>, node: NodeId) -> bool {
    builder.kind_of(node) == Some(syntax::NULL_KEYWORD)
        || builder.node(node).text.as_deref() == Some("undefined")
}
