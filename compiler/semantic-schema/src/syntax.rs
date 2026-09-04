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
/// `123n`. Its own kind, because a `bigint` is its own type: TypeScript refuses
/// to mix one with a `number` at all, which is what lets the lowering treat the
/// two as different machine types without guarding every operation.
pub const BIGINT_LITERAL: u16 = 9;
pub const REGULAR_EXPRESSION_LITERAL: u16 = 13;
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
pub const ASTERISK_ASTERISK_EQUALS_TOKEN: u16 = 67;
pub const SLASH_EQUALS_TOKEN: u16 = 68;
pub const PERCENT_EQUALS_TOKEN: u16 = 69;
pub const LESS_THAN_LESS_THAN_EQUALS_TOKEN: u16 = 70;
pub const GREATER_THAN_GREATER_THAN_EQUALS_TOKEN: u16 = 71;
pub const GREATER_THAN_GREATER_THAN_GREATER_THAN_EQUALS_TOKEN: u16 = 72;
pub const AMPERSAND_EQUALS_TOKEN: u16 = 73;
pub const BAR_EQUALS_TOKEN: u16 = 74;
pub const CARET_EQUALS_TOKEN: u16 = 78;

// Logical assignment, which is not compound assignment however much the
// spelling suggests it: `a += b` always writes, `a ||= b` writes only when the
// test says to. That difference is observable -- through a setter, and through
// the release a counted store performs on the value already there -- so they
// are lowered apart rather than folded into `compound_operator`.
//
// The three sit *between* the compound tokens rather than after them, which is
// what the gap between 74 and 78 above always was.
pub const BAR_BAR_EQUALS_TOKEN: u16 = 75;
pub const AMPERSAND_AMPERSAND_EQUALS_TOKEN: u16 = 76;
pub const QUESTION_QUESTION_EQUALS_TOKEN: u16 = 77;
pub const MINUS_TOKEN: u16 = 40;
pub const ASTERISK_TOKEN: u16 = 41;
pub const ASTERISK_ASTERISK_TOKEN: u16 = 42;
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
/// `??`, which differs from `||` in what it treats as absent: only `null` and
/// `undefined`, where `||` takes any falsy value.
pub const QUESTION_QUESTION_TOKEN: u16 = 60;
pub const BAR_BAR_TOKEN: u16 = 56;
pub const QUESTION_TOKEN: u16 = 57;
/// The `?.` of `a?.b`, `a?.[i]` and `a?.()`.
///
/// A real token node between the receiver and the member, which is why an
/// optional access has three children where an ordinary one has two.
pub const QUESTION_DOT_TOKEN: u16 = 28;
/// `...`, on a rest parameter or a spread element.
pub const DOT_DOT_DOT_TOKEN: u16 = 25;
pub const IDENTIFIER: u16 = 79;
/// `#name`, in a declaration or a member access.
///
/// A name like any other as far as this compiler is concerned: the privacy is
/// checked by the typechecker, and what reaches here is a member whose name
/// begins with `#`. It is a *different node kind* rather than an identifier
/// spelled oddly, which is the whole reason it needs saying.
pub const PRIVATE_IDENTIFIER: u16 = 80;
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
/// `function (…) { … }` as a value, named or not.
///
/// Distinct from [`ARROW_FUNCTION`], which lowers: the two differ in `this` and
/// `arguments`, so they are not interchangeable even though most uses of the
/// first could be written as the second.
pub const FUNCTION_EXPRESSION: u16 = 219;
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
pub const TRY_STATEMENT: u16 = 259;
pub const AWAIT_EXPRESSION: u16 = 224;
/// `yield x` and `yield* xs`.
///
/// Sits immediately before `SpreadElement` in the checker's enum, which is how
/// the number is arrived at. `module_evaluation::a_yield_is_refused_by_name`
/// pins it: a wrong value here would leave `yield` reported as "this
/// expression", which is what it was.
pub const YIELD_EXPRESSION: u16 = 230;
/// `typeof value`, the expression rather than the type query.
///
/// Sits between `ArrowFunction` and `AwaitExpression` in the checker's own
/// enum, which is how the number is arrived at; `erasure::tests` pins it
/// against a real program, because a wrong constant here would silently
/// reclassify every type test as something else.
pub const DELETE_EXPRESSION: u16 = 221;
pub const TYPE_OF_EXPRESSION: u16 = 222;
pub const IN_KEYWORD: u16 = 102;
/// 103, not 104. 104 is `new`.
///
/// Found by giving the kinds names and checking the names against the
/// constants: 139 agreed and this one did not. `erasure.rs` reads it to
/// recognise an `instanceof` test as *narrowing* an erased value, so with the
/// wrong number no `instanceof` ever narrowed one and every `new` looked like a
/// test. Not a wrong answer -- a verdict that stayed weaker than the program
/// deserved, silently, which is what this file's own comment says a mis-numbered
/// constant does.
pub const INSTANCEOF_KEYWORD: u16 = 103;
pub const AWAIT_KEYWORD: u16 = 134;
/// `["name"]` in a member position.
///
/// Named for what the grammar allows rather than for what programs put there:
/// the brackets are how a class declares a member whose name is a reserved word
/// (`get ["constructor"]()`), and a string literal inside them is not computed
/// in any run-time sense.
pub const COMPUTED_PROPERTY_NAME: u16 = 168;
/// The `* as ns` of `import * as ns from "./m"`, which binds a name to the
/// module itself rather than to anything in it.
pub const NAMESPACE_IMPORT: u16 = 275;
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
/// `value is string`, the return type of a type guard.
pub const TYPE_PREDICATE: u16 = 183;
/// `...values` in a call or an array literal.
pub const SPREAD_ELEMENT: u16 = 231;
pub const HERITAGE_CLAUSE: u16 = 299;
pub const ENUM_MEMBER: u16 = 306;
pub const SOURCE_FILE: u16 = 307;
/// `import ... from "..."`. Read off real output: a file with exactly two
/// imports has exactly two children of this kind.
pub const IMPORT_DECLARATION: u16 = 273;
/// `export { x } from "..."` and `export * from "..."`, and also a plain
/// `export { x }` with no specifier. Only the forms *with* a specifier name
/// another module; the rest resolve to nothing, which is what distinguishes
/// them without needing a second kind.
pub const EXPORT_DECLARATION: u16 = 279;
/// The token every source file ends with. Read off real output: it is the last
/// child of a `SourceFile`, and it is neither a statement nor a declaration.
pub const END_OF_FILE_TOKEN: u16 = 1;

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

/// What a `SyntaxKind` number is called, for diagnostics.
///
/// A refusal that says "an expression of kind 216" names nothing, and the whole
/// rule for a refusal is to name the thing. It is a *tagged template*, and
/// knowing that is the difference between a number in a report and an item on a
/// queue.
///
/// Transcribed from tsgo's `iota` list -- which the constants above deliberately
/// are not, because a mis-numbered *constant* mis-identifies nodes silently
/// while a mis-numbered *name* only misspells a diagnostic. It is checked
/// against every constant in this file all the same, and that check found the
/// first attempt off by one: two entries carry trailing comments, the parse
/// skipped them, and every name after came out shifted. `216` read as a type
/// assertion when it is a tagged template.
#[must_use]
pub fn name_of(kind: u16) -> Option<&'static str> {
    KIND_NAMES
        .binary_search_by(|(known, _)| known.cmp(&kind))
        .ok()
        .map(|at| KIND_NAMES[at].1)
}

static KIND_NAMES: &[(u16, &str)] = &[
    (0, "unknown"),
    (1, "end of file"),
    (2, "single line comment trivia"),
    (3, "multi line comment trivia"),
    (4, "new line trivia"),
    (5, "whitespace trivia"),
    (6, "conflict marker trivia"),
    (7, "non text file marker trivia"),
    (8, "numeric literal"),
    (9, "big int literal"),
    (10, "string literal"),
    (11, "jsx text"),
    (12, "jsx text all white spaces"),
    (13, "regular expression literal"),
    (14, "no substitution template literal"),
    (15, "template head"),
    (16, "template middle"),
    (17, "template tail"),
    (18, "open brace token"),
    (19, "close brace token"),
    (20, "open paren token"),
    (21, "close paren token"),
    (22, "open bracket token"),
    (23, "close bracket token"),
    (24, "dot token"),
    (25, "dot dot dot token"),
    (26, "semicolon token"),
    (27, "comma token"),
    (28, "question dot token"),
    (29, "less than token"),
    (30, "less than slash token"),
    (31, "greater than token"),
    (32, "less than equals token"),
    (33, "greater than equals token"),
    (34, "equals equals token"),
    (35, "exclamation equals token"),
    (36, "equals equals equals token"),
    (37, "exclamation equals equals token"),
    (38, "equals greater than token"),
    (39, "plus token"),
    (40, "minus token"),
    (41, "asterisk token"),
    (42, "asterisk asterisk token"),
    (43, "slash token"),
    (44, "percent token"),
    (45, "plus plus token"),
    (46, "minus minus token"),
    (47, "less than less than token"),
    (48, "greater than greater than token"),
    (49, "greater than greater than greater than token"),
    (50, "ampersand token"),
    (51, "bar token"),
    (52, "caret token"),
    (53, "exclamation token"),
    (54, "tilde token"),
    (55, "ampersand ampersand token"),
    (56, "bar bar token"),
    (57, "question token"),
    (58, "colon token"),
    (59, "at token"),
    (60, "question question token"),
    (61, "backtick token"),
    (62, "hash token"),
    (63, "equals token"),
    (64, "plus equals token"),
    (65, "minus equals token"),
    (66, "asterisk equals token"),
    (67, "asterisk asterisk equals token"),
    (68, "slash equals token"),
    (69, "percent equals token"),
    (70, "less than less than equals token"),
    (71, "greater than greater than equals token"),
    (72, "greater than greater than greater than equals token"),
    (73, "ampersand equals token"),
    (74, "bar equals token"),
    (75, "bar bar equals token"),
    (76, "ampersand ampersand equals token"),
    (77, "question question equals token"),
    (78, "caret equals token"),
    (79, "identifier"),
    (80, "private identifier"),
    (81, "j s doc comment text token"),
    (82, "break keyword"),
    (83, "case keyword"),
    (84, "catch keyword"),
    (85, "class keyword"),
    (86, "const keyword"),
    (87, "continue keyword"),
    (88, "debugger keyword"),
    (89, "default keyword"),
    (90, "delete keyword"),
    (91, "do keyword"),
    (92, "else keyword"),
    (93, "enum keyword"),
    (94, "export keyword"),
    (95, "extends keyword"),
    (96, "false keyword"),
    (97, "finally keyword"),
    (98, "for keyword"),
    (99, "function keyword"),
    (100, "if keyword"),
    (101, "import keyword"),
    (102, "in keyword"),
    (103, "instance of keyword"),
    (104, "new keyword"),
    (105, "null keyword"),
    (106, "return keyword"),
    (107, "super keyword"),
    (108, "switch keyword"),
    (109, "this keyword"),
    (110, "throw keyword"),
    (111, "true keyword"),
    (112, "try keyword"),
    (113, "type of keyword"),
    (114, "var keyword"),
    (115, "void keyword"),
    (116, "while keyword"),
    (117, "with keyword"),
    (118, "implements keyword"),
    (119, "interface keyword"),
    (120, "let keyword"),
    (121, "package keyword"),
    (122, "private keyword"),
    (123, "protected keyword"),
    (124, "public keyword"),
    (125, "static keyword"),
    (126, "yield keyword"),
    (127, "abstract keyword"),
    (128, "accessor keyword"),
    (129, "as keyword"),
    (130, "asserts keyword"),
    (131, "assert keyword"),
    (132, "any keyword"),
    (133, "async keyword"),
    (134, "await keyword"),
    (135, "boolean keyword"),
    (136, "constructor keyword"),
    (137, "declare keyword"),
    (138, "get keyword"),
    (139, "immediate keyword"),
    (140, "infer keyword"),
    (141, "intrinsic keyword"),
    (142, "is keyword"),
    (143, "key of keyword"),
    (144, "module keyword"),
    (145, "namespace keyword"),
    (146, "never keyword"),
    (147, "out keyword"),
    (148, "readonly keyword"),
    (149, "require keyword"),
    (150, "number keyword"),
    (151, "object keyword"),
    (152, "satisfies keyword"),
    (153, "set keyword"),
    (154, "string keyword"),
    (155, "symbol keyword"),
    (156, "type keyword"),
    (157, "undefined keyword"),
    (158, "unique keyword"),
    (159, "unknown keyword"),
    (160, "using keyword"),
    (161, "from keyword"),
    (162, "global keyword"),
    (163, "big int keyword"),
    (164, "override keyword"),
    (165, "of keyword"),
    (166, "defer keyword"),
    (167, "qualified name"),
    (168, "computed property name"),
    (169, "type parameter"),
    (170, "parameter"),
    (171, "decorator"),
    (172, "property signature"),
    (173, "property declaration"),
    (174, "method signature"),
    (175, "method declaration"),
    (176, "class static block declaration"),
    (177, "constructor"),
    (178, "get accessor"),
    (179, "set accessor"),
    (180, "call signature"),
    (181, "construct signature"),
    (182, "index signature"),
    (183, "type predicate"),
    (184, "type reference"),
    (185, "function type"),
    (186, "constructor type"),
    (187, "type query"),
    (188, "type literal"),
    (189, "array type"),
    (190, "tuple type"),
    (191, "optional type"),
    (192, "rest type"),
    (193, "union type"),
    (194, "intersection type"),
    (195, "conditional type"),
    (196, "infer type"),
    (197, "parenthesized type"),
    (198, "this type"),
    (199, "type operator"),
    (200, "indexed access type"),
    (201, "mapped type"),
    (202, "literal type"),
    (203, "named tuple member"),
    (204, "template literal type"),
    (205, "template literal type span"),
    (206, "import type"),
    (207, "object binding pattern"),
    (208, "array binding pattern"),
    (209, "binding element"),
    (210, "array literal expression"),
    (211, "object literal expression"),
    (212, "property access expression"),
    (213, "element access expression"),
    (214, "call expression"),
    (215, "new expression"),
    (216, "tagged template expression"),
    (217, "type assertion expression"),
    (218, "parenthesized expression"),
    (219, "function expression"),
    (220, "arrow function"),
    (221, "delete expression"),
    (222, "type of expression"),
    (223, "void expression"),
    (224, "await expression"),
    (225, "prefix unary expression"),
    (226, "postfix unary expression"),
    (227, "binary expression"),
    (228, "conditional expression"),
    (229, "template expression"),
    (230, "yield expression"),
    (231, "spread element"),
    (232, "class expression"),
    (233, "omitted expression"),
    (234, "expression with type arguments"),
    (235, "as expression"),
    (236, "non null expression"),
    (237, "meta property"),
    (238, "synthetic expression"),
    (239, "satisfies expression"),
    (240, "template span"),
    (241, "semicolon class element"),
    (242, "block"),
    (243, "empty statement"),
    (244, "variable statement"),
    (245, "expression statement"),
    (246, "if statement"),
    (247, "do statement"),
    (248, "while statement"),
    (249, "for statement"),
    (250, "for in statement"),
    (251, "for of statement"),
    (252, "continue statement"),
    (253, "break statement"),
    (254, "return statement"),
    (255, "with statement"),
    (256, "switch statement"),
    (257, "labeled statement"),
    (258, "throw statement"),
    (259, "try statement"),
    (260, "debugger statement"),
    (261, "variable declaration"),
    (262, "variable declaration list"),
    (263, "function declaration"),
    (264, "class declaration"),
    (265, "interface declaration"),
    (266, "type alias declaration"),
    (267, "enum declaration"),
    (268, "module declaration"),
    (269, "module block"),
    (270, "case block"),
    (271, "namespace export declaration"),
    (272, "import equals declaration"),
    (273, "import declaration"),
    (274, "import clause"),
    (275, "namespace import"),
    (276, "named imports"),
    (277, "import specifier"),
    (278, "export assignment"),
    (279, "export declaration"),
    (280, "named exports"),
    (281, "namespace export"),
    (282, "export specifier"),
    (283, "missing declaration"),
    (284, "external module reference"),
    (285, "jsx element"),
    (286, "jsx self closing element"),
    (287, "jsx opening element"),
    (288, "jsx closing element"),
    (289, "jsx fragment"),
    (290, "jsx opening fragment"),
    (291, "jsx closing fragment"),
    (292, "jsx attribute"),
    (293, "jsx attributes"),
    (294, "jsx spread attribute"),
    (295, "jsx expression"),
    (296, "jsx namespaced name"),
    (297, "case clause"),
    (298, "default clause"),
    (299, "heritage clause"),
    (300, "catch clause"),
    (301, "import attributes"),
    (302, "import attribute"),
    (303, "property assignment"),
    (304, "shorthand property assignment"),
    (305, "spread assignment"),
    (306, "enum member"),
    (307, "source file"),
    (308, "j s doc type expression"),
    (309, "j s doc name reference"),
    (310, "j s doc all type"),
    (311, "j s doc nullable type"),
    (312, "j s doc non nullable type"),
    (313, "j s doc optional type"),
    (314, "j s doc variadic type"),
    (315, "j s doc"),
    (316, "j s doc text"),
    (317, "j s doc type literal"),
    (318, "j s doc signature"),
    (319, "j s doc link"),
    (320, "j s doc link code"),
    (321, "j s doc link plain"),
    (322, "j s doc unknown tag"),
    (323, "j s doc augments tag"),
    (324, "j s doc implements tag"),
    (325, "j s doc deprecated tag"),
    (326, "j s doc public tag"),
    (327, "j s doc private tag"),
    (328, "j s doc protected tag"),
    (329, "j s doc readonly tag"),
    (330, "j s doc override tag"),
    (331, "j s doc callback tag"),
    (332, "j s doc overload tag"),
    (333, "j s doc parameter tag"),
    (334, "j s doc return tag"),
    (335, "j s doc this tag"),
    (336, "j s doc type tag"),
    (337, "j s doc template tag"),
    (338, "j s doc typedef tag"),
    (339, "j s doc see tag"),
    (340, "j s doc property tag"),
    (341, "j s doc throws tag"),
    (342, "j s doc satisfies tag"),
    (343, "j s doc import tag"),
    (344, "syntax list"),
    (345, "j s type alias declaration"),
    (346, "j s import declaration"),
    (347, "not emitted statement"),
    (348, "partially emitted expression"),
    (349, "synthetic reference expression"),
    (350, "not emitted type element"),
    (351, "count"),
];
