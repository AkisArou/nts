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
pub const GREATER_THAN_TOKEN: u16 = 31;
pub const PLUS_TOKEN: u16 = 39;
pub const MINUS_TOKEN: u16 = 40;
pub const ASTERISK_TOKEN: u16 = 41;
pub const SLASH_TOKEN: u16 = 43;
pub const PERCENT_TOKEN: u16 = 44;
pub const QUESTION_TOKEN: u16 = 57;
pub const IDENTIFIER: u16 = 79;
pub const CONST_KEYWORD: u16 = 86;
pub const DEFAULT_KEYWORD: u16 = 89;
pub const EXPORT_KEYWORD: u16 = 94;
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
pub const PARAMETER: u16 = 170;
pub const PROPERTY_SIGNATURE: u16 = 172;
pub const PROPERTY_DECLARATION: u16 = 173;
pub const METHOD_SIGNATURE: u16 = 174;
pub const METHOD_DECLARATION: u16 = 175;
pub const PROPERTY_ACCESS_EXPRESSION: u16 = 212;
pub const BINARY_EXPRESSION: u16 = 227;
pub const CALL_EXPRESSION: u16 = 214;
pub const NEW_EXPRESSION: u16 = 215;
pub const BLOCK: u16 = 242;
pub const VARIABLE_STATEMENT: u16 = 244;
pub const RETURN_STATEMENT: u16 = 254;
pub const VARIABLE_DECLARATION: u16 = 261;
pub const VARIABLE_DECLARATION_LIST: u16 = 262;
pub const FUNCTION_DECLARATION: u16 = 263;
pub const CLASS_DECLARATION: u16 = 264;
pub const INTERFACE_DECLARATION: u16 = 265;
pub const ENUM_DECLARATION: u16 = 267;
pub const EXPRESSION_WITH_TYPE_ARGUMENTS: u16 = 234;
pub const HERITAGE_CLAUSE: u16 = 299;
pub const ENUM_MEMBER: u16 = 306;
pub const SOURCE_FILE: u16 = 307;
