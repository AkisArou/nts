//! `ast.SyntaxKind` values, for tsgo 7.0.2.
//!
//! Lives with the schema rather than with the transport because
//! [`crate::NodeKind::Syntax`] stores one of these numbers: without the table
//! the snapshot's node kinds are opaque, so any consumer needs it and none
//! should have to depend on the frontend to get it.
//!
//! Read off a real encoded program rather than transcribed from the Go `iota`
//! list, and pinned by a test against a checked-in fixture — a tsgo bump that
//! renumbers a kind should fail loudly rather than silently mis-identify nodes.
pub const NUMERIC_LITERAL: u16 = 8;
pub const STRING_LITERAL: u16 = 10;

// Operator tokens. Note 42 is absent: it is `**`, not `*`.
pub const LESS_THAN_TOKEN: u16 = 29;
pub const LESS_THAN_EQUALS_TOKEN: u16 = 32;
pub const GREATER_THAN_EQUALS_TOKEN: u16 = 33;
pub const EQUALS_EQUALS_TOKEN: u16 = 34;
pub const EXCLAMATION_EQUALS_TOKEN: u16 = 35;
pub const EQUALS_EQUALS_EQUALS_TOKEN: u16 = 36;
pub const EXCLAMATION_EQUALS_EQUALS_TOKEN: u16 = 37;
pub const GREATER_THAN_TOKEN: u16 = 31;
pub const PLUS_TOKEN: u16 = 39;
pub const EQUALS_TOKEN: u16 = 63;

// Compound assignment. Each is its operator plus a rebinding of the target.
pub const PLUS_EQUALS_TOKEN: u16 = 64;
pub const MINUS_EQUALS_TOKEN: u16 = 65;
pub const ASTERISK_EQUALS_TOKEN: u16 = 66;
pub const SLASH_EQUALS_TOKEN: u16 = 68;
pub const PERCENT_EQUALS_TOKEN: u16 = 69;
pub const LESS_THAN_LESS_THAN_EQUALS_TOKEN: u16 = 70;
pub const GREATER_THAN_GREATER_THAN_EQUALS_TOKEN: u16 = 71;
pub const GREATER_THAN_GREATER_THAN_GREATER_THAN_EQUALS_TOKEN: u16 = 72;
pub const AMPERSAND_EQUALS_TOKEN: u16 = 73;
pub const BAR_EQUALS_TOKEN: u16 = 74;
pub const CARET_EQUALS_TOKEN: u16 = 78;
pub const MINUS_TOKEN: u16 = 40;
pub const ASTERISK_TOKEN: u16 = 41;
pub const SLASH_TOKEN: u16 = 43;
pub const PERCENT_TOKEN: u16 = 44;
pub const LESS_THAN_LESS_THAN_TOKEN: u16 = 47;
pub const GREATER_THAN_GREATER_THAN_TOKEN: u16 = 48;
pub const GREATER_THAN_GREATER_THAN_GREATER_THAN_TOKEN: u16 = 49;
pub const AMPERSAND_TOKEN: u16 = 50;
pub const BAR_TOKEN: u16 = 51;
pub const CARET_TOKEN: u16 = 52;
pub const EXCLAMATION_TOKEN: u16 = 53;
pub const AMPERSAND_AMPERSAND_TOKEN: u16 = 55;
pub const BAR_BAR_TOKEN: u16 = 56;
pub const QUESTION_TOKEN: u16 = 57;
/// `...`, on a rest parameter or a spread element.
pub const DOT_DOT_DOT_TOKEN: u16 = 25;
pub const IDENTIFIER: u16 = 79;
pub const FALSE_KEYWORD: u16 = 96;
pub const TRUE_KEYWORD: u16 = 111;
pub const CONST_KEYWORD: u16 = 86;
pub const DEFAULT_KEYWORD: u16 = 89;
pub const EXPORT_KEYWORD: u16 = 94;
/// Determined empirically, like everything else here: the encoder's own
/// documentation gives a different number.
pub const NULL_KEYWORD: u16 = 105;
pub const SUPER_KEYWORD: u16 = 107;
/// Also determined empirically.
pub const ARROW_FUNCTION: u16 = 220;
pub const THIS_KEYWORD: u16 = 109;
pub const PRIVATE_KEYWORD: u16 = 122;
pub const PROTECTED_KEYWORD: u16 = 123;
pub const PUBLIC_KEYWORD: u16 = 124;
pub const VOID_KEYWORD: u16 = 115;
pub const STATIC_KEYWORD: u16 = 125;
pub const ABSTRACT_KEYWORD: u16 = 127;
pub const ASYNC_KEYWORD: u16 = 133;
pub const DECLARE_KEYWORD: u16 = 137;
pub const OVERRIDE_KEYWORD: u16 = 164;
pub const READONLY_KEYWORD: u16 = 148;
pub const NUMBER_KEYWORD: u16 = 150;
pub const DO_STATEMENT: u16 = 247;
pub const CONTINUE_STATEMENT: u16 = 252;
pub const BREAK_STATEMENT: u16 = 253;
pub const SWITCH_STATEMENT: u16 = 256;
pub const LABELED_STATEMENT: u16 = 257;
pub const CASE_BLOCK: u16 = 270;
pub const CASE_CLAUSE: u16 = 297;
pub const DEFAULT_CLAUSE: u16 = 298;
pub const EMPTY_STATEMENT: u16 = 243;
pub const FOR_STATEMENT: u16 = 249;
pub const FOR_OF_STATEMENT: u16 = 251;
pub const PARAMETER: u16 = 170;
pub const PROPERTY_DECLARATION: u16 = 173;
pub const METHOD_DECLARATION: u16 = 175;
/// `` `abc` `` with no `${}` in it. Its text is the whole of the string.
pub const NO_SUBSTITUTION_TEMPLATE_LITERAL: u16 = 14;
/// The literal text before the first `${` of a template.
pub const TEMPLATE_HEAD: u16 = 15;
/// The literal text between two substitutions.
pub const TEMPLATE_MIDDLE: u16 = 16;
/// The literal text after the last substitution.
pub const TEMPLATE_TAIL: u16 = 17;

pub const CONSTRUCTOR: u16 = 177;
/// `get x() { … }`. Immediately after [`CONSTRUCTOR`] in tsgo's enumeration,
/// which is where TypeScript's own `SyntaxKind` puts it.
pub const GET_ACCESSOR: u16 = 178;
/// `set x(v) { … }`.
pub const SET_ACCESSOR: u16 = 179;
pub const NEW_EXPRESSION: u16 = 215;
pub const CLASS_DECLARATION: u16 = 264;
pub const PROPERTY_ASSIGNMENT: u16 = 303;
pub const SHORTHAND_PROPERTY_ASSIGNMENT: u16 = 304;
pub const ARRAY_LITERAL_EXPRESSION: u16 = 210;
/// `const { a, b } = o`. Its children are [`BINDING_ELEMENT`]s.
pub const OBJECT_BINDING_PATTERN: u16 = 207;
/// `const [a, b] = xs`. Its children are [`BINDING_ELEMENT`]s, in order.
pub const ARRAY_BINDING_PATTERN: u16 = 208;
/// One name bound by a pattern. One identifier for `{ a }` or `[a]`; two for
/// `{ a: renamed }`, the property first and the new name second.
pub const BINDING_ELEMENT: u16 = 209;

pub const OBJECT_LITERAL_EXPRESSION: u16 = 211;
/// `` `a${x}b` ``: a head, then one span per substitution.
pub const TEMPLATE_EXPRESSION: u16 = 229;
/// One substitution and the literal text that follows it.
pub const TEMPLATE_SPAN: u16 = 240;
pub const PROPERTY_ACCESS_EXPRESSION: u16 = 212;
pub const ELEMENT_ACCESS_EXPRESSION: u16 = 213;
pub const PARENTHESIZED_EXPRESSION: u16 = 218;
pub const AS_EXPRESSION: u16 = 235;
pub const NON_NULL_EXPRESSION: u16 = 236;
pub const SATISFIES_EXPRESSION: u16 = 239;
pub const CONDITIONAL_EXPRESSION: u16 = 228;
pub const PREFIX_UNARY_EXPRESSION: u16 = 225;
pub const POSTFIX_UNARY_EXPRESSION: u16 = 226;
pub const PROPERTY_SIGNATURE: u16 = 172;
pub const METHOD_SIGNATURE: u16 = 174;
pub const BINARY_EXPRESSION: u16 = 227;
pub const CALL_EXPRESSION: u16 = 214;
pub const BLOCK: u16 = 242;
pub const EXPRESSION_STATEMENT: u16 = 245;
pub const VARIABLE_STATEMENT: u16 = 244;
pub const IF_STATEMENT: u16 = 246;
pub const WHILE_STATEMENT: u16 = 248;
pub const RETURN_STATEMENT: u16 = 254;
pub const THROW_STATEMENT: u16 = 258;
pub const VARIABLE_DECLARATION: u16 = 261;
pub const VARIABLE_DECLARATION_LIST: u16 = 262;
pub const FUNCTION_DECLARATION: u16 = 263;
pub const INTERFACE_DECLARATION: u16 = 265;
pub const ENUM_DECLARATION: u16 = 267;
pub const EXPRESSION_WITH_TYPE_ARGUMENTS: u16 = 234;
pub const HERITAGE_CLAUSE: u16 = 299;
pub const ENUM_MEMBER: u16 = 306;
pub const SOURCE_FILE: u16 = 307;

/// The operator of a prefix unary expression, as the encoder actually writes it.
///
/// # Not a `SyntaxKind`
///
/// The encoder's own documentation says these six bits "encode the operator's
/// `SyntaxKind` value (e.g. `PlusPlusToken=45`, `TildeToken=54`)". They do not.
/// `encoder_generated.go` writes a dense index, and `decoder_generated.go` reads
/// it back with `commonData & 7` — three bits, not six. A `-` is `1`, not `40`.
///
/// Believing the prose gives a lowering that rejects every unary expression, or
/// worse, one that reads `~` as `!`. Read off real output; see
/// `docs/records/0003-typescript-feature-coverage.md`.
pub mod prefix_operator {
    /// The decoder's own mask. The upper three bits of `small` are not part of
    /// the operator.
    pub const MASK: u8 = 7;

    pub const PLUS: u8 = 0;
    pub const MINUS: u8 = 1;
    pub const TILDE: u8 = 2;
    pub const EXCLAMATION: u8 = 3;
    pub const PLUS_PLUS: u8 = 4;
    pub const MINUS_MINUS: u8 = 5;
}

/// The operator of a *postfix* unary expression.
///
/// A different encoding again: one bit, because `++` and `--` are the only
/// postfix operators. Reading it with [`prefix_operator`]'s table would turn
/// `i--` into `i++`, which compiles and counts the wrong way.
pub mod postfix_operator {
    pub const MASK: u8 = 1;
    pub const PLUS_PLUS: u8 = 0;
    pub const MINUS_MINUS: u8 = 1;
}

/// Whether a syntax kind is a *type* rather than an expression.
///
/// A transcription of tsgo's `ast.IsTypeNodeKind`, and it has to be one rather
/// than an approximation: a call's children arrive flattened, so
/// `new Box<number>([1, 2, 3])` reaches a lowering as
/// `[Box, number, [1, 2, 3]]` with nothing structural to say that the middle one
/// is a type argument. Guessing wrong in one direction lowers a type as an
/// expression; guessing wrong in the other drops a real argument, which
/// compiles and calls the wrong thing.
///
/// The keywords are listed rather than ranged because they are not contiguous
/// and are not inside the type-node range. `void` is here and is safe: `void x`
/// is a `VoidExpression` whose child is the operand, so the keyword is never a
/// call's child. `null`, `true` and `false` are *not* here, because in a type
/// position they arrive wrapped in a `LiteralType` while as expressions they are
/// bare.
#[must_use]
pub fn is_type_node(kind: u16) -> bool {
    /// `KindTypePredicate`, tsgo's `KindFirstTypeNode`.
    const FIRST_TYPE_NODE: u16 = 183;
    /// `KindImportType`, tsgo's `KindLastTypeNode`.
    const LAST_TYPE_NODE: u16 = 206;

    matches!(
        kind,
        115 // void
        | 132 // any
        | 135 // boolean
        | 141 // intrinsic
        | 146 // never
        | 150 // number
        | 151 // object
        | 154 // string
        | 155 // symbol
        | 157 // undefined
        | 159 // unknown
        | 163 // bigint
        | 234 // an expression with type arguments
    ) || (FIRST_TYPE_NODE..=LAST_TYPE_NODE).contains(&kind)
}
