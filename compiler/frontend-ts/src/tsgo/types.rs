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
use rustc_hash::FxHashMap;

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
    pub const INDEX: u32 = 1 << 21;
    pub const TEMPLATE_LITERAL: u32 = 1 << 22;
    pub const INDEXED_ACCESS: u32 = 1 << 25;
    pub const CONDITIONAL: u32 = 1 << 26;
    pub const UNION: u32 = 1 << 27;
    pub const INTERSECTION: u32 = 1 << 28;
}

/// Classify one type response into a schema record.
///
/// Primitives and literals are decided by flags alone, which costs nothing.
/// Everything structured becomes [`TypeKind::Structured`] carrying its flags,
/// because deciding its members would take another round trip per type.
///
/// `symbols` maps tsgo's symbol ids onto this compiler's arena. It is required
/// rather than optional because [`TypeRecord::symbol`] is an arena index: storing
/// tsgo's raw id there would make any lookup read a different symbol entirely.
#[must_use]
// FxHashMap concretely: this map is consulted once per type in a program, and
// letting a caller substitute a cryptographic hasher defeats the reason for it.
#[allow(clippy::implicit_hasher)]
pub fn classify(response: &TypeResponse, symbols: &FxHashMap<u32, SymbolId>) -> TypeRecord {
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
    } else if f & flags::TEMPLATE_LITERAL != 0 {
        // Captured here because the literal segments arrive on the response and
        // no endpoint answers them again. Decomposition fills in the placeholder
        // types later; the texts must survive until then.
        TypeKind::TemplateLiteral {
            texts: response.texts.clone(),
            types: Vec::new(),
        }
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
        // Mapped through the interning table, not passed through. `omitzero` on
        // the wire makes 0 mean "no symbol", and a symbol tsgo names but this
        // compiler never interned — anything declared outside the decoded files —
        // has no arena index to give.
        symbol: (response.symbol != 0)
            .then(|| symbols.get(&response.symbol).copied())
            .flatten(),
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

pub use nts_semantic_schema::syntax;

/// Format a node handle the way `session.go`'s `nodeHandleFrom` does.
///
/// `encoder_index` is the index in tsgo's node table, which is one greater than
/// the decoded node's position because of the nil sentinel.
#[must_use]
pub fn node_handle(encoder_index: u32, kind: u16, path: &str) -> String {
    format!("{encoder_index}.{kind}.{path}")
}

/// Whether tsgo will answer about this node rather than panicking.
///
/// A second filter beside the `NodeList` one, and for the same reason: a batch
/// is lost as a whole. This one is worse than lost --- the process **dies**.
///
/// `import.defer(...)` is the case. Upstream asserts, in `checkMetaProperty`,
/// that nothing asks for the type of the `import.defer` node when it is the
/// callee of a call:
///
/// ```go
/// debug.Assert(!ast.IsCallExpression(node.Parent) || node.Parent.Expression() != node,
///     "Trying to get the type of `import.defer` in `import.defer(...)`")
/// ```
///
/// which is right --- a deferred dynamic import is typed as a whole by the
/// call, and the callee has no type of its own --- and our batches ask about
/// *every* node, so they walk straight into it. `getSymbolsAtLocations` reaches
/// it through `getSymbolAtLocation` -> `checkExpression`, and the panic crosses
/// the transport as a failed request, which ends the compile with no
/// diagnostic and no file named. 18 test262 files did exactly that.
///
/// The condition is upstream's, restated rather than widened, so `import.meta`
/// is untouched: it cannot be a callee, and it already refuses cleanly at
/// lowering as *"a meta property"*. Which is what `import.defer` now does too.
#[must_use]
pub fn tsgo_will_answer(nodes: &[nts_semantic_schema::NodeRecord], index: usize) -> bool {
    use nts_semantic_schema::{NodeId, NodeKind};

    let Some(node) = nodes.get(index) else {
        return true;
    };
    if node.kind != NodeKind::Syntax(syntax::META_PROPERTY) {
        return true;
    }
    let Some(parent) = node.parent.and_then(|id| nodes.get(id.0 as usize)) else {
        return true;
    };
    if parent.kind != NodeKind::Syntax(syntax::CALL_EXPRESSION) {
        return true;
    }
    let Ok(arena) = u32::try_from(index) else {
        return true;
    };
    parent.children.first() != Some(&NodeId(arena))
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;
    use serde_json::json;

    mod asking_tsgo {
        use nts_diagnostics::{Location, SourceId, Span};
        use nts_semantic_schema::{
            DeclarationModifiers, NodeData, NodeId, NodeKind, NodeRecord, Origin, syntax,
        };

        use super::super::tsgo_will_answer;

        fn node(kind: u16, parent: Option<NodeId>, children: Vec<NodeId>) -> NodeRecord {
            NodeRecord {
                kind: NodeKind::Syntax(kind),
                origin: Origin::source(Location {
                    file: SourceId(0),
                    span: Span::new(0, 1),
                }),
                parent,
                children,
                symbol: None,
                flags: 0,
                modifiers: DeclarationModifiers::default(),
                native: None,
                data: NodeData::Children {
                    present: 0,
                    small: 0,
                },
                text: None,
            }
        }

        /// `import.defer('x')` --- node 1 is the meta property, and it is the
        /// callee. This is the shape upstream asserts against.
        fn a_deferred_import() -> Vec<NodeRecord> {
            vec![
                node(syntax::CALL_EXPRESSION, None, vec![NodeId(1), NodeId(2)]),
                node(syntax::META_PROPERTY, Some(NodeId(0)), Vec::new()),
                node(syntax::STRING_LITERAL, Some(NodeId(0)), Vec::new()),
            ]
        }

        #[test]
        fn a_deferred_imports_callee_is_not_asked_about() {
            assert!(!tsgo_will_answer(&a_deferred_import(), 1));
        }

        #[test]
        fn every_other_node_of_that_call_still_is() {
            let nodes = a_deferred_import();
            assert!(tsgo_will_answer(&nodes, 0), "the call itself");
            assert!(tsgo_will_answer(&nodes, 2), "the specifier");
        }

        /// The control that matters: `import.meta` cannot be a callee, so it
        /// keeps its symbol and its existing clean refusal at lowering. A guard
        /// that excluded every meta property would pass the test above and
        /// change this one.
        #[test]
        fn a_meta_property_that_is_not_a_callee_is_asked_about() {
            let argument = vec![
                node(syntax::CALL_EXPRESSION, None, vec![NodeId(1), NodeId(2)]),
                node(syntax::IDENTIFIER, Some(NodeId(0)), Vec::new()),
                node(syntax::META_PROPERTY, Some(NodeId(0)), Vec::new()),
            ];
            assert!(tsgo_will_answer(&argument, 2));

            let alone = vec![node(syntax::META_PROPERTY, None, Vec::new())];
            assert!(tsgo_will_answer(&alone, 0));
        }

        #[test]
        fn a_meta_property_under_something_that_is_not_a_call_is_asked_about() {
            let nodes = vec![
                node(
                    syntax::PROPERTY_ACCESS_EXPRESSION,
                    None,
                    vec![NodeId(1), NodeId(2)],
                ),
                node(syntax::META_PROPERTY, Some(NodeId(0)), Vec::new()),
                node(syntax::IDENTIFIER, Some(NodeId(0)), Vec::new()),
            ];
            assert!(tsgo_will_answer(&nodes, 1), "`import.meta.url`");
        }

        #[test]
        fn an_index_past_the_table_is_answerable() {
            assert!(tsgo_will_answer(&a_deferred_import(), 99));
        }
    }

    fn response(flags: u32, value: Option<serde_json::Value>) -> TypeResponse {
        TypeResponse {
            id: 1,
            texts: Vec::new(),
            flags,
            value,
            symbol: 0,
        }
    }

    fn classify(response: &TypeResponse) -> TypeRecord {
        super::classify(response, &FxHashMap::default())
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
    fn an_uninterned_symbol_yields_no_arena_index() {
        // A symbol declared outside the decoded files is named by tsgo but has no
        // index here. Passing its raw id through would point at an unrelated
        // symbol — the arena is dense and any id is in range.
        let mut response = response(flags::OBJECT, None);
        response.symbol = 9_999;
        assert_eq!(classify(&response).symbol, None);
    }

    #[test]
    fn an_interned_symbol_is_mapped_not_passed_through() {
        let mut response = response(flags::OBJECT, None);
        response.symbol = 42;
        let mut symbols = FxHashMap::default();
        symbols.insert(42u32, SymbolId(7));
        assert_eq!(
            super::classify(&response, &symbols).symbol,
            Some(SymbolId(7))
        );
    }

    #[test]
    fn node_handles_match_the_go_format() {
        assert_eq!(node_handle(12, 79, "/w/a.ts"), "12.79./w/a.ts");
    }
}
