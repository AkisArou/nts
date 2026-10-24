//! An erased value read where the checker claims a scalar.
//!
//! Two reads hand back an erased value at a type that says it is a number or a
//! boolean. A string record's entry: without `noUncheckedIndexedAccess` the
//! checker types `rec[k]` of a `Record<string, number>` as `number`, and a
//! missing key is `undefined` all the same. And a non-null assertion over an
//! erased value: `m.get(k)!` only asserts a type, so it is `undefined` where
//! `k` is missing. At a number there is no room for an absence, and unerasing
//! blindly read whatever payload the runtime put beside `undefined` -- 0 for a
//! map miss on C, LLVM and the JVM, NaN for an array miss, a stop on Wasm --
//! while the checker's type folded `=== undefined` to `false` and `typeof` to
//! "number".
//!
//! One question decides every such read: what its consumer does with it
//! ([`use_of`]).
//!
//! * It asks whether the value is there -- `??`, `||`, `??=`, `||=`, `!`, an
//!   `if` or `while` condition, a conditional's test, `typeof`, a comparison
//!   with `null` or `undefined`. The read stays erased and the consumer answers
//!   from the tag, absence included. `(counts[w] || 0) + 1` is the idiom.
//! * It applies `ToNumber` -- arithmetic, bitwise and relational operators,
//!   unary `-`, `+` and `~`, `++` and `--`, `+` with a number, a typed array's
//!   element store. `ToNumber`'s own answer is exact there: a number is read,
//!   `undefined` is NaN and `null` is 0.
//! * It compares with a number, where `null` and `undefined` equal no number:
//!   both are NaN there, never `ToNumber`'s 0 for `null`.
//! * Anything else -- a store, a return, an argument, `String(v)` -- would see
//!   `undefined` where a number was read, so the case declines by name, in the
//!   words Wasm's own unerase uses: the program's own promise failed, as an
//!   index its `!` promised was in range does.
//!
//! In every arm a tag other than the claimed one, `undefined` or `null`
//! declines: the types said number, so anything else is a lie the program
//! told, and no conversion reproduces what JavaScript does with it (`+` would
//! concatenate a string). A string or a reference keeps the null pointer its
//! absence reads as, which a program's own `!v` and `v == null` already test.
//!
//! Where a read has a form that answers NaN for its absence -- a number
//! array's `at`, `pop` and `shift`, `codePointAt` -- and its consumer converts
//! or compares, that form is the whole answer ([`read_as_number`]).

use super::{
    BinOp, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind, Terminator, UnOp,
    ValueId, syntax,
};
use crate::hir::tags;

/// What a claimed read's consumer does with it.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Use {
    /// Asks only whether it is there, from the tag.
    Asks,
    /// Applies `ToNumber` to it.
    Numeric,
    /// Compares it with a number.
    Equal,
    /// Anything else, which would see `undefined` as it is.
    Other,
}

/// The erased `read` produced at `at`, where the checker claims `at` is a
/// scalar, as its consumer takes it: a string record's entry, or a non-null
/// assertion's operand.
pub(super) fn narrowed(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    read: ValueId,
) -> Result<ValueId, Diagnostic> {
    let scalar = scalar(builder, at);
    let (Some((tag, what)), HirType::Erased) = (scalar, &builder.values[read.0 as usize].ty) else {
        return builder.narrowed(at, read);
    };
    let null_is = match use_of(builder, at) {
        Use::Asks => return Ok(read),
        Use::Numeric if tag == tags::NUMBER => 0.0,
        Use::Equal if tag == tags::NUMBER => f64::NAN,
        _ => {
            let held = tag_of(builder, at, read);
            let other = compare(builder, at, held, BinOp::Ne, tag);
            super::assertions::decline_when(builder, at, other, what)?;
            return builder.narrowed(at, read);
        }
    };
    let number = to_number(builder, at, read, (null_is, what))?;
    match builder.type_of(at) {
        Some(want @ HirType::Int { .. }) => builder.coerce(number, &want, at),
        _ => Ok(number),
    }
}

/// A cast-family value remains tagged until its consumer needs a native
/// payload. A scalar/string read checks that payload; a container additionally
/// needs the family's uniform source storage contract, not merely object tag.
pub(super) fn family_read(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    read: ValueId,
    face: super::TypeId,
    member: &str,
) -> Result<ValueId, Diagnostic> {
    let Some(schema) = builder.snapshot.node_types.get(&at).copied() else {
        return Ok(read);
    };
    let Some(want) = builder.represent(schema) else {
        return Ok(read);
    };
    if matches!(want, HirType::Erased | HirType::Void | HirType::Never)
        || use_of(builder, at) == Use::Asks
    {
        return Ok(read);
    }
    let what = format!(
        "the field `{member}` read through structural cast {} with a result of a different kind",
        builder.hierarchy.cast_descriptions[&face]
    );
    if want == HirType::NUMBER {
        match use_of(builder, at) {
            Use::Numeric => return to_number(builder, at, read, (0.0, &what)),
            Use::Equal => return to_number(builder, at, read, (f64::NAN, &what)),
            _ => {}
        }
    }
    let simple = matches!(
        want,
        HirType::Bool
            | HirType::Float { .. }
            | HirType::Int { .. }
            | HirType::BigInt
            | HirType::Managed(super::ManagedType::String | super::ManagedType::Symbol)
    );
    let uniform = builder
        .hierarchy
        .access_families
        .get(face, member)
        .and_then(|family| family.read_type)
        .and_then(|ty| builder.represent(ty))
        == Some(want.clone());
    if !(simple || want.is_managed() && uniform) {
        return Err(builder.unsupported(at, &format!("a field `{member}` read through structural cast {} without a uniform native storage contract", builder.hierarchy.cast_descriptions[&face])));
    }
    checked_family_payload(builder, at, read, schema, want, &what)
}

fn checked_family_payload(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    read: ValueId,
    schema: super::TypeId,
    want: HirType,
    what: &str,
) -> Result<ValueId, Diagnostic> {
    let held = tag_of(builder, at, read);
    let wanted_tag = tags::of_representation(&want);
    let mut matches = compare(builder, at, held, BinOp::Eq, wanted_tag);
    // Pointer storage can represent one declared absence. Keep that same
    // source contract at its checked read, never accepting other payload tags.
    if want.is_managed() {
        let members = match &builder.snapshot.types[schema.0 as usize].kind {
            super::TypeKind::Union(members) => members.clone(),
            _ => Vec::new(),
        };
        for member in members {
            if let Some(absence) = super::absence_of_member(builder.snapshot, member) {
                let tag = match absence {
                    super::Absence::Null => tags::NULL,
                    super::Absence::Undefined => tags::UNDEFINED,
                };
                let absent = compare(builder, at, held, BinOp::Eq, tag);
                matches = builder.push(
                    OpKind::Binary {
                        op: BinOp::BitOr,
                        lhs: matches,
                        rhs: absent,
                    },
                    HirType::Bool,
                    builder.origin(at),
                );
            }
        }
    }
    let reject = builder.push(
        OpKind::Unary {
            op: super::UnOp::Not,
            operand: matches,
        },
        HirType::Bool,
        builder.origin(at),
    );
    super::assertions::decline_when(builder, at, reject, what)?;
    builder.materialize(at, &want)?;
    Ok(builder.push(OpKind::unerase(read), want, builder.origin(at)))
}

/// Whether `node` is a claimed read whose consumer asks only whether it is
/// there, so that its value arrives erased: what a consumer that would
/// otherwise answer from the checker's type -- `typeof`, `=== undefined` --
/// asks before it does.
pub(super) fn stays_erased(builder: &FuncBuilder<'_>, node: NodeId) -> bool {
    let mut read = node;
    while builder.kind_of(read) == Some(syntax::PARENTHESIZED_EXPRESSION) {
        let Some(&inner) = builder.children(read).first() else {
            return false;
        };
        read = inner;
    }
    claimed(builder, read) && use_of(builder, read) == Use::Asks
}

/// Whether `read`, which has a form answering NaN where it is absent, is the
/// operand of a claimed `!` whose consumer converts it to a number or compares
/// it with one. NaN is exactly what `undefined` is there, so that form is the
/// whole answer and the read costs nothing: `xs.at(-1)! + 1`,
/// `s.codePointAt(i)! === 65`.
pub(super) fn read_as_number(builder: &FuncBuilder<'_>, read: NodeId) -> bool {
    let mut at = read;
    while let Some(parent) = builder.syntactic_parent(at) {
        match builder.kind_of(parent) {
            Some(syntax::PARENTHESIZED_EXPRESSION) => at = parent,
            Some(syntax::NON_NULL_EXPRESSION) => {
                return claimed(builder, parent)
                    && scalar(builder, parent).is_some_and(|(tag, _)| tag == tags::NUMBER)
                    && matches!(use_of(builder, parent), Use::Numeric | Use::Equal);
            }
            _ => return false,
        }
    }
    false
}

/// Whether `read` is one of the two claimed reads, at a scalar type.
fn claimed(builder: &FuncBuilder<'_>, read: NodeId) -> bool {
    if scalar(builder, read).is_none() {
        return false;
    }
    let parts = builder.children(read);
    let base = parts.first().and_then(|first| builder.type_of(*first));
    match builder.kind_of(read) {
        Some(syntax::NON_NULL_EXPRESSION) => base == Some(HirType::Erased),
        Some(syntax::ELEMENT_ACCESS_EXPRESSION | syntax::PROPERTY_ACCESS_EXPRESSION) => {
            matches!(base, Some(HirType::Managed(ManagedType::Table(..))))
                && !parts
                    .iter()
                    .any(|part| builder.kind_of(*part) == Some(syntax::QUESTION_DOT_TOKEN))
        }
        _ => false,
    }
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

/// What the consumer of the expression at `node`, through any parentheses,
/// does with it.
fn use_of(builder: &FuncBuilder<'_>, node: NodeId) -> Use {
    let mut at = node;
    let Some(mut parent) = builder.syntactic_parent(at) else {
        return Use::Other;
    };
    while builder.kind_of(parent) == Some(syntax::PARENTHESIZED_EXPRESSION) {
        at = parent;
        let Some(next) = builder.syntactic_parent(at) else {
            return Use::Other;
        };
        parent = next;
    }
    let parts = builder.children(parent);
    match builder.kind_of(parent) {
        Some(syntax::BINARY_EXPRESSION) => match parts[..] {
            [left, operator, right] => binary_use(builder, (left, operator, right), at),
            _ => Use::Other,
        },
        Some(syntax::TYPE_OF_EXPRESSION) => Use::Asks,
        Some(syntax::PREFIX_UNARY_EXPRESSION) => match builder.node(parent).data {
            nts_semantic_schema::NodeData::Children { small, .. }
                if small & syntax::prefix_operator::MASK
                    == syntax::prefix_operator::EXCLAMATION =>
            {
                Use::Asks
            }
            _ => Use::Numeric,
        },
        Some(syntax::POSTFIX_UNARY_EXPRESSION) => Use::Numeric,
        // The condition, which is tested for truthiness and nothing else.
        Some(syntax::IF_STATEMENT | syntax::WHILE_STATEMENT | syntax::CONDITIONAL_EXPRESSION)
            if parts.first() == Some(&at) =>
        {
            Use::Asks
        }
        _ => Use::Other,
    }
}

/// [`use_of`] where the consumer is a binary operator and `at` one operand.
fn binary_use(
    builder: &FuncBuilder<'_>,
    (left, operator, right): (NodeId, NodeId, NodeId),
    at: NodeId,
) -> Use {
    let other = if left == at { right } else { left };
    let number = matches!(
        builder.type_of(other),
        Some(HirType::Float { .. } | HirType::Int { .. })
    );
    match builder.kind_of(operator) {
        Some(
            syntax::QUESTION_QUESTION_TOKEN
            | syntax::BAR_BAR_TOKEN
            | syntax::QUESTION_QUESTION_EQUALS_TOKEN
            | syntax::BAR_BAR_EQUALS_TOKEN,
        ) if left == at => Use::Asks,
        Some(
            syntax::EQUALS_EQUALS_TOKEN
            | syntax::EQUALS_EQUALS_EQUALS_TOKEN
            | syntax::EXCLAMATION_EQUALS_TOKEN
            | syntax::EXCLAMATION_EQUALS_EQUALS_TOKEN,
        ) => {
            if absent_literal(builder, other) {
                Use::Asks
            } else if number {
                Use::Equal
            } else {
                Use::Other
            }
        }
        Some(syntax::PLUS_TOKEN | syntax::PLUS_EQUALS_TOKEN) if number => Use::Numeric,
        Some(
            syntax::MINUS_TOKEN
            | syntax::ASTERISK_TOKEN
            | syntax::ASTERISK_ASTERISK_TOKEN
            | syntax::SLASH_TOKEN
            | syntax::PERCENT_TOKEN
            | syntax::AMPERSAND_TOKEN
            | syntax::BAR_TOKEN
            | syntax::CARET_TOKEN
            | syntax::LESS_THAN_LESS_THAN_TOKEN
            | syntax::GREATER_THAN_GREATER_THAN_TOKEN
            | syntax::GREATER_THAN_GREATER_THAN_GREATER_THAN_TOKEN
            | syntax::LESS_THAN_TOKEN
            | syntax::GREATER_THAN_TOKEN
            | syntax::LESS_THAN_EQUALS_TOKEN
            | syntax::GREATER_THAN_EQUALS_TOKEN
            | syntax::MINUS_EQUALS_TOKEN
            | syntax::ASTERISK_EQUALS_TOKEN
            | syntax::ASTERISK_ASTERISK_EQUALS_TOKEN
            | syntax::SLASH_EQUALS_TOKEN
            | syntax::PERCENT_EQUALS_TOKEN
            | syntax::AMPERSAND_EQUALS_TOKEN
            | syntax::BAR_EQUALS_TOKEN
            | syntax::CARET_EQUALS_TOKEN
            | syntax::LESS_THAN_LESS_THAN_EQUALS_TOKEN
            | syntax::GREATER_THAN_GREATER_THAN_EQUALS_TOKEN
            | syntax::GREATER_THAN_GREATER_THAN_GREATER_THAN_EQUALS_TOKEN,
        ) => Use::Numeric,
        // A typed array's element store applies ToNumber to what it stores.
        Some(syntax::EQUALS_TOKEN) if right == at && typed_array_element(builder, left) => {
            Use::Numeric
        }
        _ => Use::Other,
    }
}

fn typed_array_element(builder: &FuncBuilder<'_>, node: NodeId) -> bool {
    builder.kind_of(node) == Some(syntax::ELEMENT_ACCESS_EXPRESSION)
        && builder.children(node).first().is_some_and(|array| {
            matches!(
                builder.type_of(*array),
                Some(HirType::Managed(ManagedType::View(_)))
            )
        })
}

/// `null` or `undefined`, written.
fn absent_literal(builder: &FuncBuilder<'_>, node: NodeId) -> bool {
    builder.kind_of(node) == Some(syntax::NULL_KEYWORD)
        || builder.node(node).text.as_deref() == Some("undefined")
}

/// The number an erased `read` is for a consumer that converts it: its payload
/// where its tag is a number, NaN for `undefined`, `null_is` for `null`; any
/// other tag declines by name with `what`.
fn to_number(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    read: ValueId,
    (null_is, what): (f64, &str),
) -> Result<ValueId, Diagnostic> {
    let origin = builder.origin(at);
    let held = tag_of(builder, at, read);
    let is_number = compare(builder, at, held, BinOp::Eq, tags::NUMBER);
    let merge = builder.new_block();
    let result = builder.push_block_param(merge, HirType::NUMBER, origin.clone());
    let present = builder.new_block();
    let absent = builder.new_block();
    builder.terminate(Terminator::Branch {
        cond: is_number,
        then_target: present,
        then_args: Vec::new(),
        else_target: absent,
        else_args: Vec::new(),
    });
    // The unerase only where the tag says number, which licenses it.
    builder.switch_to(present);
    let number = builder.push(OpKind::unerase(read), HirType::NUMBER, origin.clone());
    builder.terminate(Terminator::Jump {
        target: merge,
        args: vec![number],
    });
    builder.switch_to(absent);
    let undefined = compare(builder, at, held, BinOp::Eq, tags::UNDEFINED);
    let null = compare(builder, at, held, BinOp::Eq, tags::NULL);
    let either = builder.push(
        OpKind::Binary {
            op: BinOp::BitOr,
            lhs: undefined,
            rhs: null,
        },
        HirType::Bool,
        origin.clone(),
    );
    let neither = builder.push(
        OpKind::Unary {
            op: UnOp::Not,
            operand: either,
        },
        HirType::Bool,
        origin.clone(),
    );
    super::assertions::decline_when(builder, at, neither, what)?;
    let when_null = builder.push(OpKind::ConstFloat(null_is), HirType::NUMBER, origin.clone());
    let undefined_block = branch(builder, null, (merge, when_null));
    builder.switch_to(undefined_block);
    let nan = builder.push(OpKind::ConstFloat(f64::NAN), HirType::NUMBER, origin);
    builder.terminate(Terminator::Jump {
        target: merge,
        args: vec![nan],
    });
    builder.switch_to(merge);
    Ok(result)
}

/// Where `cond` holds, jump to `merge` with `value`, a constant; the block
/// where it does not, for the caller to fill.
fn branch(
    builder: &mut FuncBuilder<'_>,
    cond: ValueId,
    (merge, value): (super::BlockId, ValueId),
) -> super::BlockId {
    let taken = builder.new_block();
    let not_taken = builder.new_block();
    builder.terminate(Terminator::Branch {
        cond,
        then_target: taken,
        then_args: Vec::new(),
        else_target: not_taken,
        else_args: Vec::new(),
    });
    builder.switch_to(taken);
    builder.terminate(Terminator::Jump {
        target: merge,
        args: vec![value],
    });
    not_taken
}

fn tag_of(builder: &mut FuncBuilder<'_>, at: NodeId, read: ValueId) -> ValueId {
    let origin = builder.origin(at);
    builder.push(
        OpKind::TagOf { value: read },
        HirType::Int {
            bits: 32,
            signed: false,
        },
        origin,
    )
}

fn compare(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    held: ValueId,
    op: BinOp,
    tag: u32,
) -> ValueId {
    let origin = builder.origin(at);
    let expected = builder.push(
        OpKind::ConstInt(i128::from(tag)),
        HirType::Int {
            bits: 32,
            signed: false,
        },
        origin.clone(),
    );
    builder.push(
        OpKind::Binary {
            op,
            lhs: held,
            rhs: expected,
        },
        HirType::Bool,
        origin,
    )
}
