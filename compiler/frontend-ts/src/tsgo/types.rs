//! Turning tsgo's `TypeResponse` into schema type records.
//!
//! # Addressing a node
//!
//! Type queries take a `NodeHandle`, which tsgo formats as `"{index}.{kind}.{path}"`
//! (`session.go`'s `nodeHandleFrom`). Only index and path are read back — the
//! resolver treats kind as informational — and `index` is an index into the same
//! table the AST encoder numbers, so a decoded node's position maps straight onto
//! a handle.
//!
//! Two facts make that sharper than it sounds:
//!
//! - Index 0 is the nil sentinel, so a decoded node at position `i` is encoder
//!   index `i + 1`.
//! - **`NodeList`s occupy a `nil` slot** in that table, because a list is not an
//!   `*ast.Node`. A handle naming one fails to resolve, and
//!   `handleGetTypeAtLocations` returns on the first failure — so one list in a
//!   batch loses every type in it. Lists are filtered out before the request.

use nts_semantic_schema::{LiteralValue, SymbolId, TypeKind, TypeRecord};

use super::proto::TypeResponse;

/// `checker.TypeFlags`, from `internal/checker/types.go`.
///
/// Only the bits this classifier reads are named. They are a bitmask rather than
/// an enum because the checker genuinely combines them — an enum literal type
/// carries `EnumLiteral` alongside `StringLiteral` or `NumberLiteral`.
pub mod flags {
    pub const ANY: u32 = 1 << 0;
    pub const UNKNOWN: u32 = 1 << 1;
    pub const UNDEFINED: u32 = 1 << 2;
    pub const NULL: u32 = 1 << 3;
    pub const VOID: u32 = 1 << 4;
    pub const STRING: u32 = 1 << 5;
    pub const NUMBER: u32 = 1 << 6;
    pub const BIGINT: u32 = 1 << 7;
    pub const BOOLEAN: u32 = 1 << 8;
    pub const ES_SYMBOL: u32 = 1 << 9;
    pub const STRING_LITERAL: u32 = 1 << 10;
    pub const NUMBER_LITERAL: u32 = 1 << 11;
    pub const BIGINT_LITERAL: u32 = 1 << 12;
    pub const BOOLEAN_LITERAL: u32 = 1 << 13;
    pub const NEVER: u32 = 1 << 18;
    pub const TYPE_PARAMETER: u32 = 1 << 19;
    pub const OBJECT: u32 = 1 << 20;
    pub const UNION: u32 = 1 << 27;
    pub const INTERSECTION: u32 = 1 << 28;
}

/// Classify one type response into a schema record.
///
/// Primitives and literals are decided by flags alone, which costs nothing.
/// Everything structured becomes [`TypeKind::Structured`] carrying its flags,
/// because deciding its members would take another round trip per type.
#[must_use]
pub fn classify(response: &TypeResponse) -> TypeRecord {
    let f = response.flags;

    // Order matters: a literal type carries both its literal bit and, for enum
    // members, `EnumLiteral`. Testing literals before the wide primitives keeps
    // `"ok"` from being reported as `string`.
    let kind = if f & flags::STRING_LITERAL != 0 {
        literal_or_structured(response, |v| {
            v.as_str().map(|s| LiteralValue::String(s.to_owned()))
        })
    } else if f & flags::NUMBER_LITERAL != 0 {
        literal_or_structured(response, |v| v.as_f64().map(LiteralValue::Number))
    } else if f & flags::BOOLEAN_LITERAL != 0 {
        literal_or_structured(response, |v| v.as_bool().map(LiteralValue::Boolean))
    } else if f & flags::BIGINT_LITERAL != 0 {
        // A pseudo-bigint arrives as an object, not a JSON number; JSON has no
        // integer wide enough to carry one faithfully.
        literal_or_structured(response, |v| Some(LiteralValue::BigInt(v.to_string())))
    } else if f & flags::ANY != 0 {
        TypeKind::Any
    } else if f & flags::UNKNOWN != 0 {
        TypeKind::Unknown
    } else if f & flags::NEVER != 0 {
        TypeKind::Never
    } else if f & flags::VOID != 0 {
        TypeKind::Void
    } else if f & flags::UNDEFINED != 0 {
        TypeKind::Undefined
    } else if f & flags::NULL != 0 {
        TypeKind::Null
    } else if f & flags::BOOLEAN != 0 {
        TypeKind::Boolean
    } else if f & flags::STRING != 0 {
        TypeKind::String
    } else if f & flags::NUMBER != 0 {
        TypeKind::Number
    } else if f & flags::BIGINT != 0 {
        TypeKind::BigInt
    } else if f & flags::ES_SYMBOL != 0 {
        TypeKind::Symbol
    } else if f == 0 {
        // No flags at all is not a type the checker produces.
        TypeKind::Unsupported {
            rendered: "<no type flags>".to_owned(),
        }
    } else {
        TypeKind::Structured { flags: f }
    };

    TypeRecord {
        kind,
        symbol: (response.symbol != 0).then_some(SymbolId(response.symbol)),
    }
}

/// Build a literal kind, or fall back if the value did not arrive as expected.
///
/// A literal whose `value` is missing is a protocol disagreement, not a literal
/// with no value — so it degrades to [`TypeKind::Structured`] rather than
/// inventing a default that would compile into the wrong constant.
fn literal_or_structured(
    response: &TypeResponse,
    extract: impl FnOnce(&serde_json::Value) -> Option<LiteralValue>,
) -> TypeKind {
    response.value.as_ref().and_then(extract).map_or(
        TypeKind::Structured {
            flags: response.flags,
        },
        TypeKind::Literal,
    )
}

/// Format a node handle the way `session.go`'s `nodeHandleFrom` does.
///
/// `encoder_index` is the index in tsgo's node table, which is one greater than
/// the decoded node's position because of the nil sentinel.
#[must_use]
pub fn node_handle(encoder_index: u32, kind: u16, path: &str) -> String {
    format!("{encoder_index}.{kind}.{path}")
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use serde_json::json;

    fn response(flags: u32, value: Option<serde_json::Value>) -> TypeResponse {
        TypeResponse {
            id: 1,
            flags,
            value,
            symbol: 0,
        }
    }

    #[test]
    fn primitives_classify_from_flags() {
        for (bit, expected) in [
            (flags::STRING, TypeKind::String),
            (flags::NUMBER, TypeKind::Number),
            (flags::BOOLEAN, TypeKind::Boolean),
            (flags::VOID, TypeKind::Void),
            (flags::NEVER, TypeKind::Never),
            (flags::ANY, TypeKind::Any),
        ] {
            assert_eq!(classify(&response(bit, None)).kind, expected);
        }
    }

    #[test]
    fn a_string_literal_beats_the_string_flag() {
        // The regression this guards: testing `STRING` first would report the
        // literal `"ok"` as the whole `string` type, silently widening a constant.
        let both = flags::STRING_LITERAL | flags::STRING;
        let kind = classify(&response(both, Some(json!("ok")))).kind;
        assert_eq!(kind, TypeKind::Literal(LiteralValue::String("ok".into())));
    }

    #[test]
    fn a_number_literal_keeps_its_value() {
        let kind = classify(&response(flags::NUMBER_LITERAL, Some(json!(42)))).kind;
        assert_eq!(kind, TypeKind::Literal(LiteralValue::Number(42.0)));
    }

    #[test]
    fn a_literal_without_a_value_does_not_invent_one() {
        // Degrading to Structured is recoverable; defaulting to 0 or "" would
        // compile into a wrong constant with nothing left to notice it.
        let kind = classify(&response(flags::NUMBER_LITERAL, None)).kind;
        assert!(matches!(kind, TypeKind::Structured { .. }));
    }

    #[test]
    fn structured_types_carry_their_flags() {
        const OBJECT: u32 = 1 << 20;
        let kind = classify(&response(OBJECT, None)).kind;
        assert_eq!(kind, TypeKind::Structured { flags: OBJECT });
    }

    #[test]
    fn a_symbol_id_of_zero_means_absent() {
        // tsgo marks the field `omitzero`, so 0 is "no symbol" rather than symbol 0.
        assert_eq!(classify(&response(flags::STRING, None)).symbol, None);
    }

    #[test]
    fn node_handles_match_the_go_format() {
        assert_eq!(node_handle(12, 79, "/w/a.ts"), "12.79./w/a.ts");
    }
}
