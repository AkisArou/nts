//! Printing a compiled program back to TypeScript, by splicing.
//!
//! Most of a compiled file is what the user wrote: every node of the output
//! that is identical to the original node with the same `_nodeId` is copied as
//! its exact source text, comments and formatting included. Only what the
//! compiler changed -- compiled function bodies, the import of its runtime --
//! is printed, and a type anywhere in printed code is still copied from the
//! source by its span, so the user's own spelling of every type survives.
//!
//! Parentheses are decided by precedence, never by what the source had: a
//! printed node's operands may be copied text, and copied text is exactly a
//! node, so wrapping it is always right.

use std::fmt::Write as _;

use react_compiler_ast::File;
use react_compiler_ast::common::{BaseNode, RawNode};
use react_compiler_ast::declarations::{
    Declaration, ExportDefaultDecl, ExportKind, ExportSpecifier, ImportKind, ImportSpecifier, ModuleExportName,
};
use react_compiler_ast::expressions::{
    ArrowFunctionBody, Expression, Identifier, ObjectExpressionProperty, ObjectMethodKind,
};
use react_compiler_ast::jsx::{
    JSXAttributeItem, JSXAttributeName, JSXAttributeValue, JSXChild, JSXElement, JSXElementName,
    JSXExpressionContainerExpr, JSXFragment, JSXMemberExprObject, JSXMemberExpression,
};
use react_compiler_ast::literals::StringLiteral;
use react_compiler_ast::operators::{AssignmentOperator, BinaryOperator, LogicalOperator, UnaryOperator, UpdateOperator};
use react_compiler_ast::patterns::{ObjectPatternProperty, PatternLike};
use react_compiler_ast::statements::{
    BlockStatement, ClassDeclaration, ForInOfLeft, ForInit, Statement, VariableDeclaration, VariableDeclarationKind,
};
use react_compiler::entrypoint::BindingRenameInfo;
use react_compiler_ast::scope::BindingId;
use rustc_hash::{FxHashMap, FxHashSet};
use serde::Serialize;
use serde_json::Value;

use crate::convert::text::SourceText;

mod cache;
mod class;
mod jsx;

/// The checker, for a compiler temporary's type: the type at the original
/// node the temporary holds, printed as TypeScript written at that node.
pub trait TypeOracle {
    fn type_at(&mut self, node: u32) -> Option<String>;
}

/// No checker: nothing a temporary could be typed from.
#[derive(Debug)]
pub struct NoTypes;

impl TypeOracle for NoTypes {
    fn type_at(&mut self, _node: u32) -> Option<String> {
        None
    }
}

/// How a file is printed.
#[derive(Debug, Default)]
pub struct PrintOptions {
    /// JSX is printed as the calls it stands for ([`jsx`]).
    pub lower_jsx: bool,
    /// Functions, by their original span, printed as the user wrote them
    /// whatever the compiler made of them: the ones whose compiled form did
    /// not typecheck.
    pub as_written: FxHashSet<(u32, u32)>,
    /// The compiler's memo cache written as a typed record ([`cache`]).
    pub typed_cache: bool,
    /// Functions, by their original span, whose cache stays the compiler's
    /// array: their typed cache did not typecheck.
    pub array_cache: FxHashSet<(u32, u32)>,
}

/// A printed file.
#[derive(Debug)]
pub struct Printed {
    pub text: String,
    /// Each function printed from the compiler's output: its original span,
    /// and where it is in `text`, both in UTF-16 units -- what a diagnostic
    /// on `text` is traced back through.
    pub functions: Vec<PrintedFunction>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PrintedFunction {
    pub original: (u32, u32),
    pub output: (u32, u32),
    /// Its memo cache was printed typed.
    pub typed_cache: bool,
}

/// Prints `compiled`, the compiler's output for `original`, whose text is
/// `source`, applying the compiler's `renames` and restoring the types its
/// code generation dropped (see [`Printer`]'s restoration rules).
#[must_use]
pub fn print_file(
    source: &SourceText,
    original: &File,
    compiled: &File,
    renames: &[BindingRenameInfo],
    types: &mut dyn TypeOracle,
    options: &PrintOptions,
) -> Printed {
    let mut originals = FxHashMap::default();
    let mut by_span = FxHashMap::default();
    let mut definite = FxHashSet::default();
    let mut jsx_spans = Vec::new();
    if let Ok(value) = serde_json::to_value(original) {
        index_nodes(&value, &mut originals, &mut jsx_spans);
        index_spans(&value, &mut by_span, &mut definite);
    }
    jsx_spans.sort_unstable();
    let (new_names, renamed_starts) = renamed_references(compiled, renames);
    let mut printer = Printer {
        source,
        originals,
        by_span,
        definite,
        renamed: new_names,
        renamed_starts,
        types,
        typed_locals: FxHashSet::default(),
        restoring: None,
        assigning: false,
        lower_jsx: options.lower_jsx,
        jsx_spans: if options.lower_jsx { jsx_spans } else { Vec::new() },
        jsx_imports: jsx::JsxImports::default(),
        classes: if options.lower_jsx { class::ClassComponents::new(original) } else { class::ClassComponents::default() },
        as_written: &options.as_written,
        functions: Vec::new(),
        caches: Caches {
            callee: options.typed_cache.then(|| cache_callee(compiled)).flatten(),
            forced_array: options.array_cache.clone(),
            ..Caches::default()
        },
        hoists: Vec::new(),
        edits: Vec::new(),
        fresh: 0,
        out: String::new(),
        indent: 0,
    };
    printer.program(original, compiled);
    let mut functions = utf16_ranges(&printer.out, &printer.functions);
    for function in &mut functions {
        function.typed_cache = printer.caches.typed_spans.contains(&function.original);
    }
    Printed { text: printer.out, functions }
}

/// A function printed from the compiler's output: its original span, and its
/// byte range in the output.
type OutputFunction = ((u32, u32), (usize, usize));

/// What the printer knows about the memo caches it types ([`cache`]).
#[derive(Debug, Default)]
struct Caches {
    /// The local name of the compiler runtime's `c`, when caches are typed.
    callee: Option<String>,
    /// The typed cache of each function being printed, innermost last.
    stack: Vec<Option<cache::CachePlan>>,
    /// Some function's cache was typed, so `cacheOf` is imported.
    typed: bool,
    /// Some function kept the compiler's array cache, so `c` stays imported.
    array: bool,
    /// Where the compiler runtime's import was printed, rewritten once it is
    /// known which of the two the file uses.
    runtime_import: Option<(usize, usize)>,
    /// Some shape was hoisted, so `MemoCacheShape` is imported to annotate it.
    shape_type: bool,
    /// Functions to keep on the array cache ([`PrintOptions::array_cache`]).
    forced_array: FxHashSet<(u32, u32)>,
    /// The functions whose cache was typed, by original span.
    typed_spans: FxHashSet<(u32, u32)>,
}

/// A change to the printed text decided after the text it touches was
/// printed: `remove` bytes at `at` replaced by `insert`.
#[derive(Debug)]
struct Edit {
    at: usize,
    remove: usize,
    insert: String,
}

/// The local name the compiled program imports the compiler runtime's `c`
/// under, if it imports it.
fn cache_callee(compiled: &File) -> Option<String> {
    compiled.program.body.iter().find_map(|statement| match statement {
        Statement::ImportDeclaration(import) if import.source.value == "react/compiler-runtime" => import.specifiers.iter().find_map(|specifier| match specifier {
            react_compiler_ast::declarations::ImportSpecifier::ImportSpecifier(named)
                if matches!(&named.imported, ModuleExportName::Identifier(i) if i.name == "c") =>
            {
                Some(named.local.name.clone())
            }
            _ => None,
        }),
        _ => None,
    })
}

/// The class a top-level statement declares, exported or not.
fn class_declaration(statement: &Statement) -> Option<&ClassDeclaration> {
    match statement {
        Statement::ClassDeclaration(class) => Some(class),
        Statement::ExportNamedDeclaration(export) => match export.declaration.as_deref()? {
            Declaration::ClassDeclaration(class) => Some(class),
            _ => None,
        },
        Statement::ExportDefaultDeclaration(export) => match export.declaration.as_ref() {
            ExportDefaultDecl::ClassDeclaration(class) => Some(class),
            _ => None,
        },
        _ => None,
    }
}

/// The printed functions' output ranges, from byte offsets into `text` to
/// UTF-16 units, as tsgo counts them.
fn utf16_ranges(text: &str, functions: &[OutputFunction]) -> Vec<PrintedFunction> {
    let mut offsets: Vec<usize> = functions.iter().flat_map(|(_, (start, end))| [*start, *end]).collect();
    offsets.sort_unstable();
    offsets.dedup();
    let mut units = FxHashMap::default();
    let (mut at, mut counted) = (0usize, 0u32);
    for offset in offsets {
        counted += text.get(at..offset).map_or(0, |part| u32::try_from(part.encode_utf16().count()).unwrap_or(u32::MAX));
        at = offset;
        units.insert(offset, counted);
    }
    functions.iter().map(|(original, (start, end))| PrintedFunction { original: *original, output: (units[start], units[end]), typed_cache: false }).collect()
}

/// Every node of the original program with a span, by that span, outermost
/// first: the compiler's output keeps the spans of what it came from, which
/// is how each of its nodes finds the syntax the user wrote.
fn index_spans(value: &Value, into: &mut FxHashMap<(u32, u32), Vec<Value>>, definite: &mut FxHashSet<(u32, u32)>) {
    match value {
        Value::Object(map) => {
            // `let x!: T`: the definite `!` sits on the declarator, and the
            // output's declarator is found by its id's span.
            if map.get("definite").and_then(Value::as_bool) == Some(true)
                && let Some(span) = map.get("id").and_then(span_of)
            {
                definite.insert(span);
            }
            if let (Some(start), Some(end)) = (map.get("start").and_then(Value::as_u64), map.get("end").and_then(Value::as_u64))
                && let (Ok(start), Ok(end)) = (u32::try_from(start), u32::try_from(end))
            {
                into.entry((start, end)).or_default().push(value.clone());
            }
            for (key, child) in map {
                if key != "loc" {
                    index_spans(child, into, definite);
                }
            }
        }
        Value::Array(items) => items.iter().for_each(|item| index_spans(item, into, definite)),
        _ => {}
    }
}

fn span_of(value: &Value) -> Option<(u32, u32)> {
    let start = u32::try_from(value.get("start")?.as_u64()?).ok()?;
    let end = u32::try_from(value.get("end")?.as_u64()?).ok()?;
    Some((start, end))
}

/// The identifiers a rename applies to: every one that resolves, in the
/// compiled program, to the binding declared at the rename's position under
/// its original name. The Babel plugin applies the compiler's renames the same
/// way, with Babel's `scope.rename` over the compiled program.
fn renamed_references(compiled: &File, renames: &[BindingRenameInfo]) -> (FxHashMap<usize, String>, Vec<u32>) {
    if renames.is_empty() {
        return (FxHashMap::default(), Vec::new());
    }
    let resolution = crate::scope::resolve(compiled);
    let mut new_names: FxHashMap<BindingId, &str> = FxHashMap::default();
    for rename in renames {
        for binding in &resolution.info.bindings {
            if binding.name == rename.original && binding.declaration_start == Some(rename.declaration_start) {
                new_names.insert(binding.id, &rename.renamed);
            }
        }
    }
    let mut by_address = FxHashMap::default();
    let mut starts = Vec::new();
    for (address, (binding, start)) in &resolution.by_address {
        if let Some(name) = new_names.get(binding) {
            by_address.insert(*address, (*name).to_owned());
            starts.extend(*start);
        }
    }
    starts.sort_unstable();
    (by_address, starts)
}

/// Every node of the original program with an id, as JSON, to tell an
/// unchanged node from a changed one; and where each JSX element and
/// fragment is, with its id. Where two nodes share an id -- a self-closing
/// element and its opening element are one tsgo node -- the id names the
/// outer one.
fn index_nodes(value: &Value, into: &mut FxHashMap<u64, Value>, jsx: &mut Vec<(u32, u32, u64)>) {
    match value {
        Value::Object(map) => {
            if let Some(id) = map.get("_nodeId").and_then(Value::as_u64) {
                into.entry(id).or_insert_with(|| value.clone());
                if matches!(map.get("type").and_then(Value::as_str), Some("JSXElement" | "JSXFragment"))
                    && let Some((start, end)) = span_of(value)
                {
                    jsx.push((start, end, id));
                }
            }
            for child in map.values() {
                index_nodes(child, into, jsx);
            }
        }
        Value::Array(items) => items.iter().for_each(|item| index_nodes(item, into, jsx)),
        _ => {}
    }
}

struct Printer<'a> {
    source: &'a SourceText,
    originals: FxHashMap<u64, Value>,
    /// The original program's nodes by span.
    by_span: FxHashMap<(u32, u32), Vec<Value>>,
    /// The ids of the original's definite declarators (`let x!: T`), by span.
    definite: FxHashSet<(u32, u32)>,
    types: &'a mut dyn TypeOracle,
    /// Locals declared with a type (restored or their own), whose cache
    /// reads are cast to it.
    typed_locals: FxHashSet<String>,
    /// The operand whose restored `!` or type arguments are being printed by
    /// its own wrapper, so they are not printed twice.
    restoring: Option<(u32, u32)>,
    /// Printing an assignment target, which declares nothing: its span still
    /// names the original declaration, whose annotation must not follow it.
    assigning: bool,
    /// Identifiers to print under a new name, by node address.
    renamed: FxHashMap<usize, String>,
    /// Where renamed identifiers sit: a copied node must not span one.
    renamed_starts: Vec<u32>,
    /// Whether JSX is printed as calls.
    lower_jsx: bool,
    /// The original's JSX elements and fragments by span, sorted, with their
    /// ids; empty unless lowering. A copied node spanning one is copied
    /// around it, and the JSX printed lowered in its place.
    jsx_spans: Vec<(u32, u32, u64)>,
    /// The runtime functions the lowered JSX calls.
    jsx_imports: jsx::JsxImports,
    /// The file's class components, described as they are printed ([`class`]).
    classes: class::ClassComponents,
    /// Functions to print as the user wrote them; see [`PrintOptions`].
    as_written: &'a FxHashSet<(u32, u32)>,
    /// The functions printed from the compiler's output.
    functions: Vec<OutputFunction>,
    /// The memo caches being typed.
    caches: Caches,
    /// Shapes hoisted out of the top-level statement being printed.
    hoists: Vec<String>,
    /// Text to insert or replace once the whole file is printed.
    edits: Vec<Edit>,
    /// The next number `fresh_name` tries.
    fresh: u32,
    out: String,
    indent: usize,
}

// Precedence, lowest first; an operand printed at a lower level than its
// position needs is wrapped in parentheses.
const SEQUENCE: u8 = 1;
const ASSIGN: u8 = 2;
const CONDITIONAL: u8 = 3;
const NULLISH: u8 = 4;
const OR: u8 = 5;
const AND: u8 = 6;
const BIT_OR: u8 = 7;
const BIT_XOR: u8 = 8;
const BIT_AND: u8 = 9;
const EQUALITY: u8 = 10;
const RELATIONAL: u8 = 11;
const SHIFT: u8 = 12;
const ADDITIVE: u8 = 13;
const MULTIPLICATIVE: u8 = 14;
const EXPONENT: u8 = 15;
const UNARY: u8 = 16;
const POSTFIX: u8 = 17;
const CALL: u8 = 18;
const PRIMARY: u8 = 20;

impl Printer<'_> {
    // ---- splicing --------------------------------------------------------

    /// The node's source text, if it is identical to the original node it
    /// came from.
    fn unchanged<T: Serialize>(&mut self, node: &T, base: &BaseNode) -> Option<String> {
        let (id, start, end) = (base.node_id?, base.start?, base.end?);
        let first_inside = self.renamed_starts.partition_point(|at| *at < start);
        if self.renamed_starts.get(first_inside).is_some_and(|at| *at < end) {
            return None;
        }
        let original = self.originals.get(&u64::from(id))?;
        let value = serde_json::to_value(node).ok()?;
        (&value == original).then(|| self.copy(start, end))
    }

    /// An opaque node -- a type, a class member -- as its source text.
    fn raw(&mut self, raw: &RawNode) -> Option<String> {
        let value = raw.parse_value();
        let start = u32::try_from(value.get("start")?.as_u64()?).ok()?;
        let end = u32::try_from(value.get("end")?.as_u64()?).ok()?;
        Some(self.copy(start, end))
    }

    /// The source between two offsets, with any JSX in it lowered when
    /// lowering: the text around each outermost element is copied, and the
    /// element printed as its call.
    fn copy(&mut self, start: u32, end: u32) -> String {
        let mut at = self.jsx_spans.partition_point(|(s, ..)| *s < start);
        if self.jsx_spans.get(at).is_none_or(|(s, ..)| *s >= end) {
            return self.source.slice(start, end);
        }
        let outer = std::mem::take(&mut self.out);
        let mut cursor = start;
        while let Some(&(jsx_start, jsx_end, id)) = self.jsx_spans.get(at).filter(|(s, ..)| *s < end) {
            self.out.push_str(&self.source.slice(cursor, jsx_start));
            match self.originals.get(&id).cloned().map(serde_json::from_value::<Expression>) {
                Some(Ok(Expression::JSXElement(element))) => self.jsx_lower_element(&element),
                Some(Ok(Expression::JSXFragment(fragment))) => self.jsx_lower_fragment(&fragment),
                _ => self.out.push_str(&self.source.slice(jsx_start, jsx_end)),
            }
            cursor = jsx_end;
            // What is inside was printed with it.
            while self.jsx_spans.get(at).is_some_and(|(s, ..)| *s < jsx_end) {
                at += 1;
            }
        }
        self.out.push_str(&self.source.slice(cursor, end));
        std::mem::replace(&mut self.out, outer)
    }

    /// An identifier's name as printed: its new name if the compiler renamed
    /// the binding it resolves to.
    fn name<'n>(&'n self, base: &BaseNode, name: &'n str) -> &'n str {
        self.renamed.get(&crate::scope::address(base)).map_or(name, String::as_str)
    }

    // ---- restoration ------------------------------------------------------
    //
    // The compiler's code generation drops type syntax attached to
    // declarations and calls. Two kinds of rule put it back:
    //   - what the user wrote is restored verbatim, from the original node the
    //     output node's span names: annotations, `?`, type parameters, return
    //     types and predicates, type arguments, `!`, local type declarations;
    //   - what the compiler introduced -- a `let t1;` temporary -- gets the
    //     checker's type of the original expression it holds.
    // runtime/react/compiler/TYPED-OUTPUT.md measures both.

    /// The original nodes spanning exactly `base`'s span.
    fn originals_at(&self, base: &BaseNode) -> &[Value] {
        span_of_base(base, self.source).and_then(|span| self.by_span.get(&span)).map_or(&[], Vec::as_slice)
    }

    /// The tsgo node `base` is: its own id, or, for a node the compiler
    /// generated from one the user wrote, the id of the original node with
    /// its span -- how a checker question about compiled code is asked.
    fn original_id(&self, base: &BaseNode) -> Option<u32> {
        base.node_id.or_else(|| {
            self.originals_at(base).iter().find_map(|node| node.get("_nodeId").and_then(Value::as_u64)).and_then(|id| u32::try_from(id).ok())
        })
    }

    /// The source text of `key` (an annotation, type parameters, a return
    /// type) on the original node spanning `base`'s span, if it has one.
    fn original_part(&self, base: &BaseNode, key: &str) -> Option<String> {
        if self.assigning && key == "typeAnnotation" {
            return None;
        }
        self.originals_at(base)
            .iter()
            .find_map(|node| node.get(key).and_then(span_of))
            .map(|(start, end)| self.source.slice(start, end))
    }

    /// How the user spelled a JSX text or attribute string whose value is
    /// `value` (decoded), when the spelling matters: the source text of the
    /// original node spanning `base`'s span, if it holds an entity and still
    /// spells `value` -- the compiler keeps the span of a text it trims. An
    /// attribute string's spelling is between its quotes.
    fn jsx_spelling(&self, base: &BaseNode, value: &str) -> Option<String> {
        let (start, end) = span_of_base(base, self.source)?;
        let node = self.by_span.get(&(start, end))?.iter().find_map(|node| node.get("type").and_then(Value::as_str))?;
        let (start, end) = match node {
            "JSXText" => (start, end),
            "StringLiteral" => (start + 1, end.saturating_sub(1)),
            _ => return None,
        };
        let spelling = self.source.slice(start, end);
        (spelling.contains('&') && crate::jsx_text::decode_entities(&spelling) == value).then_some(spelling)
    }

    /// Whether the original binding spanning `base`'s span was optional (`a?`).
    /// Only an identifier: an optional chain's link is `optional` too.
    fn originally_optional(&self, base: &BaseNode) -> bool {
        !self.assigning
            && self.originals_at(base).iter().any(|node| {
            node.get("type").and_then(Value::as_str).is_none_or(|kind| kind == "Identifier")
                && node.get("name").is_some()
                && node.get("optional").and_then(Value::as_bool) == Some(true)
        })
    }

    /// The checker's type for a compiler-introduced binding: the type of the
    /// original node its span names.
    fn checker_type(&mut self, base: &BaseNode) -> Option<String> {
        let node = self.originals_at(base).iter().find_map(|node| node.get("_nodeId").and_then(Value::as_u64))?;
        let node = u32::try_from(node).ok()? & !crate::convert::SECOND_NODE;
        self.types.type_at(node)
    }

    /// What the user wrote around an operand that the output dropped: a
    /// non-null `!`, or an instantiation's type arguments.
    fn dropped_wrapper(&self, base: &BaseNode) -> Option<String> {
        let (start, end) = span_of_base(base, self.source)?;
        if self.restoring == Some((start, end)) {
            return None;
        }
        // The wrapper starts where its operand does and ends later.
        self.by_span.iter().find_map(|((wrapper_start, wrapper_end), nodes)| {
            if *wrapper_start != start || *wrapper_end <= end {
                return None;
            }
            nodes.iter().find_map(|node| {
                let operand = node.get("expression").and_then(span_of)?;
                if operand != (start, end) {
                    return None;
                }
                match node.get("type").and_then(Value::as_str)? {
                    "TSNonNullExpression" => Some("!".to_owned()),
                    "TSInstantiationExpression" => node.get("typeParameters").and_then(span_of).map(|(s, e)| self.source.slice(s, e)),
                    _ => None,
                }
            })
        })
    }

    /// The local `type` and `interface` declarations of the original function
    /// spanning `base`'s span: code generation drops them from a compiled body,
    /// and the body's annotations name them.
    fn dropped_local_types(&self, base: &BaseNode) -> Vec<String> {
        let Some(function) = self.originals_at(base).iter().find(|node| node.get("body").is_some()) else {
            return Vec::new();
        };
        let statements = function.get("body").and_then(|body| body.get("body")).and_then(Value::as_array);
        statements
            .into_iter()
            .flatten()
            .filter(|statement| matches!(statement.get("type").and_then(Value::as_str), Some("TSTypeAliasDeclaration" | "TSInterfaceDeclaration")))
            .filter_map(span_of)
            .map(|(start, end)| self.source.slice(start, end))
            .collect()
    }

    fn write(&mut self, text: &str) {
        self.out.push_str(text);
    }

    fn newline(&mut self) {
        self.out.push('\n');
        for _ in 0..self.indent {
            self.out.push_str("  ");
        }
    }

    // ---- the program -----------------------------------------------------

    /// The compiled program's statements in order: an unchanged one as its
    /// source text with the gap before it (comments, blank lines), a changed
    /// one printed in the original's place, a new one printed where it stands.
    fn program(&mut self, original: &File, compiled: &File) {
        let mut cursor = 0u32;
        let first_start = original.program.body.first().and_then(|s| statement_base(s).start).unwrap_or(0);
        // The file's leading comments (a license, `// @flow`) stay first.
        let header_end = self.source.token_start(0).min(first_start);
        if header_end > 0 {
            self.write(&self.source.slice(0, header_end));
            cursor = header_end;
        }
        for directive in &compiled.program.directives {
            let _ = writeln!(self.out, "\"{}\";", directive.value.value);
        }
        let imports_at = self.out.len();
        for statement in &compiled.program.body {
            let base = statement_base(statement);
            let original_here = base.node_id.is_some() && base.start.is_some_and(|s| s >= cursor);
            if original_here {
                let start = base.start.unwrap_or(cursor);
                self.write(&self.source.slice(cursor, start));
                self.top_level(statement);
                cursor = base.end.unwrap_or(start);
            } else {
                self.top_level(statement);
                self.write("\n");
            }
        }
        self.write(&self.source.slice(cursor, self.source.len()));
        let imports = self.jsx_imports.declarations();
        if !imports.is_empty() {
            self.edits.push(Edit { at: imports_at, remove: 0, insert: imports });
        }
        self.import_cache_runtime(imports_at);
        self.apply_edits();
    }

    /// A top-level statement, with the cache shapes it hoists before it, and
    /// a class component's descriptor as its last member.
    fn top_level(&mut self, statement: &Statement) {
        let at = self.out.len();
        self.statement(statement);
        if let Some(class) = class_declaration(statement)
            && let Some(member) = self.classes.describe(class, "_ClassComponentType")
            && let Some(close) = self.out.rfind('}').filter(|close| *close >= at)
        {
            self.jsx_imports.class_type = true;
            self.edits.push(Edit { at: close, remove: 0, insert: member });
        }
        if !self.hoists.is_empty() {
            let insert = self.hoists.drain(..).map(|hoist| hoist + "\n\n").collect();
            self.edits.push(Edit { at, remove: 0, insert });
        }
    }

    /// The compiler runtime's import, naming what the file's caches use:
    /// `cacheOf` for the typed ones, `c` for any left an array.
    fn import_cache_runtime(&mut self, imports_at: usize) {
        if !self.caches.typed {
            return;
        }
        let callee = self.caches.callee.clone().unwrap_or_default();
        let typed = if self.caches.shape_type { "cacheOf as _cacheOf, type MemoCacheShape as _MemoCacheShape" } else { "cacheOf as _cacheOf" };
        match self.caches.runtime_import {
            Some((start, end)) => {
                let printed = self.out[start..end].to_owned();
                let array = format!("c as {callee}");
                let names = if self.caches.array { format!("{array}, {typed}") } else { typed.to_owned() };
                self.edits.push(Edit { at: start, remove: end - start, insert: printed.replacen(&array, &names, 1) });
            }
            None => self.edits.push(Edit { at: imports_at, remove: 0, insert: format!("import {{ {typed} }} from \"react/compiler-runtime\";\n") }),
        }
    }

    /// Applies the edits, last first, and moves every recorded function range
    /// past each by its change in length. At one position a replacement goes
    /// first, so that an insertion there lands in front of what replaced it
    /// rather than inside the range it replaces.
    fn apply_edits(&mut self) {
        let mut edits = std::mem::take(&mut self.edits);
        edits.sort_by_key(|edit| (std::cmp::Reverse(edit.at), std::cmp::Reverse(edit.remove)));
        for edit in edits {
            self.out.replace_range(edit.at..edit.at + edit.remove, &edit.insert);
            let after = edit.at + edit.remove;
            for (_, (start, end)) in &mut self.functions {
                if *start >= after {
                    *start = *start + edit.insert.len() - edit.remove;
                    *end = *end + edit.insert.len() - edit.remove;
                }
            }
        }
    }

    fn statements(&mut self, statements: &[Statement]) {
        for statement in statements {
            self.newline();
            self.statement(statement);
        }
    }

    fn block(&mut self, block: &BlockStatement) {
        self.block_with(block, &[]);
    }

    /// A block, with `prelude` (restored local type declarations) first.
    fn block_with(&mut self, block: &BlockStatement, prelude: &[String]) {
        if prelude.is_empty()
            && let Some(text) = self.unchanged(block, &block.base)
        {
            self.write(&text);
            return;
        }
        self.write("{");
        self.indent += 1;
        for directive in &block.directives {
            self.newline();
            let _ = write!(self.out, "\"{}\";", directive.value.value);
        }
        for declaration in prelude {
            self.newline();
            self.write(declaration);
        }
        self.statements(&block.body);
        self.indent -= 1;
        if !block.body.is_empty() || !block.directives.is_empty() || !prelude.is_empty() {
            self.newline();
        }
        self.write("}");
    }

    /// A block with `epilogue` as its last statement.
    fn block_with_epilogue(&mut self, block: &BlockStatement, epilogue: &str) {
        self.write("{");
        self.indent += 1;
        self.statements(&block.body);
        self.newline();
        self.write(epilogue);
        self.indent -= 1;
        self.newline();
        self.write("}");
    }

    /// `const $ = _c(n)` in a function whose cache is typed: the call that
    /// makes the typed cache from its shape, in its place.
    fn cache_declaration(&self, id: &PatternLike, init: &Expression) -> Option<String> {
        let plan = self.cache()?;
        let callee = self.caches.callee.as_deref()?;
        let is_cache = matches!(id, PatternLike::Identifier(i) if i.name == plan.name)
            && matches!(init, Expression::CallExpression(call) if matches!(call.callee.as_ref(), Expression::Identifier(c) if c.name == callee));
        is_cache.then(|| format!("_cacheOf{}({})", plan.type_argument(), plan.argument()))
    }

    /// A memo scope's `if`, when the cache is typed: the next bit of the
    /// function's filled words is this scope's.
    fn cache_scope(&mut self, test: &Expression) -> Option<cache::Scope> {
        let name = self.cache()?.name.clone();
        let json = serde_json::to_value(test).ok()?;
        if !cache::reads(&json, &name) {
            return None;
        }
        let plan = self.caches.stack.last_mut()?.as_mut()?;
        Some(plan.scope(cache::is_sentinel_test(&json, &name)))
    }

    /// A compiled function's body, with the local types it lost restored.
    fn function_body(&mut self, function: &BaseNode, body: &BlockStatement) {
        let prelude = self.dropped_local_types(function);
        let plan = self.cache_plan(function, body);
        self.caches.stack.push(plan);
        self.block_with(body, &prelude);
        self.caches.stack.pop();
    }

    /// The typed cache for a compiled function's body, if it has a cache and
    /// every slot's type can be named.
    fn cache_plan(&mut self, function: &BaseNode, body: &BlockStatement) -> Option<cache::CachePlan> {
        let callee = self.caches.callee.clone()?;
        let json = serde_json::to_value(body).ok()?;
        let found = cache::find(&json, &callee)?;
        let span = span_of_base(function, self.source);
        if span.is_some_and(|span| self.caches.forced_array.contains(&span)) {
            self.caches.array = true;
            return None;
        }
        let types = found
            .stored
            .iter()
            .map(|value| self.stored_type(value.as_ref()?))
            .collect();
        let Some(mut plan) = cache::plan(&found, types) else {
            self.caches.array = true;
            return None;
        };
        self.caches.typed = true;
        self.caches.typed_spans.extend(span);
        // The shape goes to module scope, made once, unless its types name
        // something only this function sees, or it is nested in a function
        // whose own cache is being printed.
        let nested = self.caches.stack.iter().any(Option::is_some);
        if !nested && !plan.names_any(&self.local_type_names(function)) {
            let [name, record] = self.fresh_names(["_cache", "_Cache"]);
            self.hoists.push(format!(
                "type {record} = {};\nconst {name}: _MemoCacheShape<{record}> = {};",
                plan.record_type(),
                plan.shape_of(&record)
            ));
            self.caches.shape_type = true;
            plan.hoisted = Some(name);
        }
        Some(plan)
    }

    /// The type of a value stored into a cache slot: the checker's, at the
    /// place it came from. A dependency path the compiler built (`p.items`,
    /// `pair[1]`) has no place of its own, only its object has; its type is
    /// its object's, indexed by the path -- `({ items: string[] })["items"]`.
    fn stored_type(&mut self, value: &Value) -> Option<String> {
        let base: BaseNode = serde_json::from_value(value.clone()).ok()?;
        if let Some(ty) = self.checker_type(&base) {
            return Some(ty);
        }
        if value.get("type").and_then(Value::as_str) != Some("MemberExpression") {
            return None;
        }
        let property = value.get("property")?;
        let key = if value.get("computed").and_then(Value::as_bool) == Some(true) {
            match property.get("type").and_then(Value::as_str)? {
                "NumericLiteral" => number(property.get("value")?.as_f64()?),
                "StringLiteral" => serde_json::to_string(property.get("value")?.as_str()?).ok()?,
                _ => return None,
            }
        } else {
            serde_json::to_string(property.get("name")?.as_str()?).ok()?
        };
        let object = self.stored_type(value.get("object")?)?;
        Some(format!("({object})[{key}]"))
    }

    /// The type parameters and local types of the original function spanning
    /// `function`'s span.
    fn local_type_names(&self, function: &BaseNode) -> Vec<String> {
        let Some(node) = self.originals_at(function).iter().find(|node| node.get("body").is_some()) else {
            return Vec::new();
        };
        let parameters = node.get("typeParameters").and_then(|p| p.get("params")).and_then(Value::as_array);
        let locals = node.get("body").and_then(|body| body.get("body")).and_then(Value::as_array);
        parameters
            .into_iter()
            .flatten()
            .filter_map(|parameter| parameter.get("name").and_then(Value::as_str))
            .chain(locals.into_iter().flatten().filter_map(|statement| statement.get("id").and_then(|id| id.get("name")).and_then(Value::as_str)))
            .map(str::to_owned)
            .collect()
    }

    /// A name the file does not use: `base` numbered.
    /// Names that share one number, none of them in the source: `_cache0` and
    /// the `_Cache0` it is typed with.
    fn fresh_names<const N: usize>(&mut self, bases: [&str; N]) -> [String; N] {
        let text = self.source.slice(0, self.source.len());
        loop {
            let names = bases.map(|base| format!("{base}{}", self.fresh));
            self.fresh += 1;
            if names.iter().all(|name| !text.contains(name.as_str())) {
                return names;
            }
        }
    }

    /// The typed cache of the function being printed.
    fn cache(&self) -> Option<&cache::CachePlan> {
        self.caches.stack.last().and_then(Option::as_ref)
    }

    /// The slot `expression` reads or writes, if it is the typed cache's.
    fn cache_slot(&self, expression: &Expression) -> Option<usize> {
        let plan = self.cache()?;
        let json = serde_json::to_value(expression).ok()?;
        cache::slot_of(&json, &plan.name)
    }

    // ---- statements ------------------------------------------------------

    #[allow(clippy::too_many_lines)]
    fn statement(&mut self, statement: &Statement) {
        if let Some(text) = self.unchanged(statement, statement_base(statement)) {
            self.write(&text);
            return;
        }
        match statement {
            Statement::BlockStatement(block) => self.block(block),
            Statement::EmptyStatement(_) => self.write(";"),
            Statement::DebuggerStatement(_) => self.write("debugger;"),
            Statement::ExpressionStatement(s) => {
                let parenthesise = starts_ambiguously(&s.expression, true);
                if parenthesise {
                    self.write("(");
                }
                self.expression(&s.expression, SEQUENCE);
                if parenthesise {
                    self.write(")");
                }
                self.write(";");
            }
            Statement::ReturnStatement(s) => {
                self.write("return");
                if let Some(argument) = &s.argument {
                    self.write(" ");
                    self.expression(argument, SEQUENCE);
                }
                self.write(";");
            }
            Statement::ThrowStatement(s) => {
                self.write("throw ");
                self.expression(&s.argument, SEQUENCE);
                self.write(";");
            }
            Statement::IfStatement(s) => {
                self.write("if (");
                let scope = self.cache_scope(&s.test);
                match &scope {
                    Some(scope) if scope.sentinel_only => self.write(&scope.unfilled),
                    Some(scope) => {
                        let _ = write!(self.out, "{} || ", scope.unfilled);
                        self.expression(&s.test, OR);
                    }
                    None => self.expression(&s.test, SEQUENCE),
                }
                self.write(") ");
                match (&scope, s.consequent.as_ref()) {
                    (Some(scope), Statement::BlockStatement(block)) => self.block_with_epilogue(block, &scope.fill),
                    _ => self.statement(&s.consequent),
                }
                if let Some(alternate) = &s.alternate {
                    if matches!(s.consequent.as_ref(), Statement::BlockStatement(_)) {
                        self.write(" else ");
                    } else {
                        self.newline();
                        self.write("else ");
                    }
                    self.statement(alternate);
                }
            }
            Statement::WhileStatement(s) => {
                self.write("while (");
                self.expression(&s.test, SEQUENCE);
                self.write(") ");
                self.statement(&s.body);
            }
            Statement::DoWhileStatement(s) => {
                self.write("do ");
                self.statement(&s.body);
                self.write(" while (");
                self.expression(&s.test, SEQUENCE);
                self.write(");");
            }
            Statement::ForStatement(s) => {
                self.write("for (");
                if let Some(init) = &s.init {
                    match init.as_ref() {
                        ForInit::VariableDeclaration(d) => self.variable_declaration(d, true),
                        ForInit::Expression(e) => self.expression_no_in(e),
                    }
                }
                self.write(";");
                if let Some(test) = &s.test {
                    self.write(" ");
                    self.expression(test, SEQUENCE);
                }
                self.write(";");
                if let Some(update) = &s.update {
                    self.write(" ");
                    self.expression(update, SEQUENCE);
                }
                self.write(") ");
                self.statement(&s.body);
            }
            Statement::ForOfStatement(s) => {
                self.write(if s.is_await { "for await (" } else { "for (" });
                self.for_left(&s.left);
                self.write(" of ");
                self.expression(&s.right, ASSIGN);
                self.write(") ");
                self.statement(&s.body);
            }
            Statement::ForInStatement(s) => {
                self.write("for (");
                self.for_left(&s.left);
                self.write(" in ");
                self.expression(&s.right, SEQUENCE);
                self.write(") ");
                self.statement(&s.body);
            }
            Statement::BreakStatement(s) => {
                self.write("break");
                if let Some(label) = &s.label {
                    let _ = write!(self.out, " {}", label.name);
                }
                self.write(";");
            }
            Statement::ContinueStatement(s) => {
                self.write("continue");
                if let Some(label) = &s.label {
                    let _ = write!(self.out, " {}", label.name);
                }
                self.write(";");
            }
            Statement::LabeledStatement(s) => {
                let _ = write!(self.out, "{}: ", s.label.name);
                self.statement(&s.body);
            }
            Statement::SwitchStatement(s) => {
                self.write("switch (");
                self.expression(&s.discriminant, SEQUENCE);
                self.write(") {");
                self.indent += 1;
                for case in &s.cases {
                    self.newline();
                    if let Some(test) = &case.test {
                        self.write("case ");
                        self.expression(test, SEQUENCE);
                        self.write(":");
                    } else {
                        self.write("default:");
                    }
                    self.indent += 1;
                    self.statements(&case.consequent);
                    self.indent -= 1;
                }
                self.indent -= 1;
                self.newline();
                self.write("}");
            }
            Statement::TryStatement(s) => {
                self.write("try ");
                self.block(&s.block);
                if let Some(handler) = &s.handler {
                    self.write(" catch ");
                    if let Some(param) = &handler.param {
                        self.write("(");
                        self.pattern(param);
                        self.write(") ");
                    }
                    self.block(&handler.body);
                }
                if let Some(finalizer) = &s.finalizer {
                    self.write(" finally ");
                    self.block(finalizer);
                }
            }
            Statement::VariableDeclaration(d) => {
                self.variable_declaration(d, false);
                self.write(";");
            }
            Statement::FunctionDeclaration(f) => self.function_declaration(f),
            Statement::ImportDeclaration(import) => self.import(import),
            Statement::ExportNamedDeclaration(export) => {
                self.write("export ");
                if matches!(export.export_kind, Some(ExportKind::Type)) && export.declaration.is_none() {
                    self.write("type ");
                }
                if let Some(declaration) = &export.declaration {
                    self.declaration(declaration);
                } else {
                    self.write("{ ");
                    for (at, specifier) in export.specifiers.iter().enumerate() {
                        if at > 0 {
                            self.write(", ");
                        }
                        self.export_specifier(specifier);
                    }
                    self.write(" }");
                    if let Some(source) = &export.source {
                        self.write(" from ");
                        self.string_literal(source);
                    }
                    self.write(";");
                }
            }
            Statement::ExportDefaultDeclaration(export) => {
                self.write("export default ");
                match export.declaration.as_ref() {
                    ExportDefaultDecl::FunctionDeclaration(f) => self.function_declaration(f),
                    ExportDefaultDecl::ClassDeclaration(c) => self.span(&c.base),
                    ExportDefaultDecl::Expression(e) => {
                        let parenthesise = starts_ambiguously(e, false);
                        if parenthesise {
                            self.write("(");
                        }
                        self.expression(e, ASSIGN);
                        if parenthesise {
                            self.write(")");
                        }
                        self.write(";");
                    }
                    ExportDefaultDecl::EnumDeclaration(d) => self.span(&d.base),
                }
            }
            Statement::ExportAllDeclaration(export) => {
                self.write("export * from ");
                self.string_literal(&export.source);
                self.write(";");
            }
            // Declarations the compiler passes through: their source text.
            other => self.span(statement_base(other)),
        }
    }

    /// A node, whatever it is, as its source text.
    fn span(&mut self, base: &BaseNode) {
        if let (Some(start), Some(end)) = (base.start, base.end) {
            let text = self.copy(start, end);
            self.write(&text);
        }
    }

    fn declaration(&mut self, declaration: &Declaration) {
        match declaration {
            Declaration::FunctionDeclaration(f) => self.function_declaration(f),
            Declaration::ClassDeclaration(c) => self.span(&c.base),
            Declaration::VariableDeclaration(d) => {
                self.variable_declaration(d, false);
                self.write(";");
            }
            Declaration::TSTypeAliasDeclaration(d) => self.span(&d.base),
            Declaration::TSInterfaceDeclaration(d) => self.span(&d.base),
            Declaration::TSEnumDeclaration(d) => self.span(&d.base),
            Declaration::TSModuleDeclaration(d) => self.span(&d.base),
            Declaration::TSDeclareFunction(d) => self.span(&d.base),
            Declaration::TypeAlias(d) => self.span(&d.base),
            Declaration::OpaqueType(d) => self.span(&d.base),
            Declaration::InterfaceDeclaration(d) => self.span(&d.base),
            Declaration::EnumDeclaration(d) => self.span(&d.base),
        }
    }

    /// A variable declaration. `head` is a `for…of` or `for…in` head, whose
    /// bindings have no initialiser and are no temporaries.
    fn variable_declaration(&mut self, declaration: &VariableDeclaration, in_for: bool) {
        self.variable_declaration_in(declaration, in_for, false);
    }

    fn variable_declaration_in(&mut self, declaration: &VariableDeclaration, in_for: bool, head: bool) {
        if let Some(text) = self.unchanged(declaration, &declaration.base) {
            // A copied declaration statement carries its own `;`.
            self.write(text.trim_end_matches(';'));
            return;
        }
        self.write(match declaration.kind {
            VariableDeclarationKind::Var => "var ",
            VariableDeclarationKind::Let => "let ",
            VariableDeclarationKind::Const => "const ",
            VariableDeclarationKind::Using => "using ",
            VariableDeclarationKind::AwaitUsing => "await using ",
        });
        for (at, declarator) in declaration.declarations.iter().enumerate() {
            if at > 0 {
                self.write(", ");
            }
            if let PatternLike::Identifier(identifier) = &declarator.id
                && (identifier.type_annotation.is_some() || self.original_part(&identifier.base, "typeAnnotation").is_some())
            {
                let name = self.name(&identifier.base, &identifier.name).to_owned();
                self.typed_locals.insert(name);
            }
            if let PatternLike::Identifier(identifier) = &declarator.id
                && span_of_base(&identifier.base, self.source).is_some_and(|span| self.definite.contains(&span))
                && self.unchanged(identifier, &identifier.base).is_none()
            {
                // `let x!: T`, whose `!` the output dropped.
                let name = self.name(&identifier.base, &identifier.name).to_owned();
                self.write(&name);
                self.write("!");
                if let Some(text) = self.original_part(&identifier.base, "typeAnnotation") {
                    self.write(&text);
                }
            } else {
                self.pattern(&declarator.id);
            }
            // `let t1;`: a temporary the compiler introduced, whose type is the
            // checker's type of the expression it holds.
            if declarator.init.is_none()
                && !head
                && let PatternLike::Identifier(identifier) = &declarator.id
                && identifier.type_annotation.is_none()
                && self.original_part(&identifier.base, "typeAnnotation").is_none()
                && let Some(text) = self.checker_type(&identifier.base)
            {
                let _ = write!(self.out, ": {text}");
                let name = self.name(&identifier.base, &identifier.name).to_owned();
                self.typed_locals.insert(name);
            }
            if let Some(init) = &declarator.init
                && let Some(call) = self.cache_declaration(&declarator.id, init)
            {
                let _ = write!(self.out, " = {call}");
            } else if let Some(init) = &declarator.init {
                self.write(" = ");
                if in_for {
                    self.expression_no_in(init);
                } else {
                    self.expression(init, ASSIGN);
                }
            }
        }
    }

    fn for_left(&mut self, left: &ForInOfLeft) {
        match left {
            ForInOfLeft::VariableDeclaration(d) => self.variable_declaration_in(d, true, true),
            ForInOfLeft::Pattern(p) => self.assignment_target(p),
        }
    }

    /// The left of an assignment: a pattern that declares nothing, so no
    /// annotation is restored on it.
    fn assignment_target(&mut self, target: &PatternLike) {
        let outer = std::mem::replace(&mut self.assigning, true);
        self.pattern(target);
        self.assigning = outer;
    }

    /// An expression where a bare `in` would read as a `for…in`.
    fn expression_no_in(&mut self, expression: &Expression) {
        if contains_top_level_in(expression) {
            self.write("(");
            self.expression(expression, SEQUENCE);
            self.write(")");
        } else {
            self.expression(expression, SEQUENCE);
        }
    }

    fn import(&mut self, import: &react_compiler_ast::declarations::ImportDeclaration) {
        let started = self.out.len();
        self.import_statement(import);
        if self.caches.callee.is_some() && import.source.value == "react/compiler-runtime" {
            self.caches.runtime_import = Some((started, self.out.len()));
        }
    }

    fn import_statement(&mut self, import: &react_compiler_ast::declarations::ImportDeclaration) {
        self.write("import ");
        if matches!(import.import_kind, Some(ImportKind::Type)) {
            self.write("type ");
        }
        let mut named = Vec::new();
        let mut wrote = false;
        for specifier in &import.specifiers {
            match specifier {
                ImportSpecifier::ImportDefaultSpecifier(s) => {
                    self.write(&s.local.name);
                    wrote = true;
                }
                ImportSpecifier::ImportNamespaceSpecifier(s) => {
                    if wrote {
                        self.write(", ");
                    }
                    let _ = write!(self.out, "* as {}", s.local.name);
                    wrote = true;
                }
                ImportSpecifier::ImportSpecifier(s) => named.push(s),
            }
        }
        if !named.is_empty() {
            if wrote {
                self.write(", ");
            }
            self.write("{ ");
            for (at, s) in named.iter().enumerate() {
                if at > 0 {
                    self.write(", ");
                }
                if matches!(s.import_kind, Some(ImportKind::Type)) {
                    self.write("type ");
                }
                let imported = module_export_name(&s.imported);
                if imported == s.local.name {
                    self.write(&s.local.name);
                } else {
                    let _ = write!(self.out, "{imported} as {}", s.local.name);
                }
            }
            self.write(" }");
            wrote = true;
        }
        if wrote {
            self.write(" from ");
        }
        self.string_literal(&import.source);
        self.write(";");
    }

    fn export_specifier(&mut self, specifier: &ExportSpecifier) {
        match specifier {
            ExportSpecifier::ExportSpecifier(s) => {
                let (local, exported) = (module_export_name(&s.local), module_export_name(&s.exported));
                if matches!(s.export_kind, Some(ExportKind::Type)) {
                    self.write("type ");
                }
                if local == exported {
                    self.write(&local);
                } else {
                    let _ = write!(self.out, "{local} as {exported}");
                }
            }
            ExportSpecifier::ExportDefaultSpecifier(s) => self.write(&s.exported.name),
            ExportSpecifier::ExportNamespaceSpecifier(s) => {
                let _ = write!(self.out, "* as {}", module_export_name(&s.exported));
            }
        }
    }

    // ---- functions -------------------------------------------------------

    fn function_declaration(&mut self, f: &react_compiler_ast::statements::FunctionDeclaration) {
        if let Some(text) = self.unchanged(f, &f.base) {
            self.write(&text);
            return;
        }
        let Some(started) = self.function_start(&f.base) else { return };
        self.function_declaration_compiled(f);
        self.function_end(&f.base, started);
    }

    /// Where a function the compiler changed starts in the output -- or
    /// `None` when it is to be printed as written, which this has done.
    fn function_start(&mut self, base: &BaseNode) -> Option<usize> {
        let span = span_of_base(base, self.source);
        if let Some((start, end)) = span.filter(|span| self.as_written.contains(span)) {
            let text = self.copy(start, end);
            self.write(&text);
            return None;
        }
        Some(self.out.len())
    }

    fn function_end(&mut self, base: &BaseNode, started: usize) {
        if let Some(span) = span_of_base(base, self.source) {
            self.functions.push((span, (started, self.out.len())));
        }
    }

    fn function_declaration_compiled(&mut self, f: &react_compiler_ast::statements::FunctionDeclaration) {
        if f.is_async {
            self.write("async ");
        }
        self.write(if f.generator { "function* " } else { "function " });
        if let Some(id) = &f.id {
            self.write(&id.name);
        }
        self.function_rest(&f.base, f.type_parameters.as_ref(), &f.params, f.return_type.as_ref());
        self.write(" ");
        self.function_body(&f.base, &f.body);
    }

    /// `<T>(params): R`, the part every function form shares. Type parameters
    /// and a return type the output dropped come back from the original.
    fn function_rest(&mut self, function: &BaseNode, type_parameters: Option<&RawNode>, params: &[PatternLike], return_type: Option<&RawNode>) {
        let type_parameters = type_parameters.and_then(|t| self.raw(t)).or_else(|| self.original_part(function, "typeParameters"));
        if let Some(text) = type_parameters {
            self.write(&text);
        }
        self.write("(");
        for (at, param) in params.iter().enumerate() {
            if at > 0 {
                self.write(", ");
            }
            self.parameter(param);
        }
        self.write(")");
        let return_type = return_type.and_then(|t| self.raw(t)).or_else(|| self.original_part(function, "returnType"));
        if let Some(text) = return_type {
            self.write(&text);
        }
    }

    /// A parameter: a renamed one (`t0` for a destructured prop) is typed as
    /// the original parameter it stands for.
    fn parameter(&mut self, param: &PatternLike) {
        // `(a: T = 1)` became `(t1)`, defaulted in the body: the parameter is
        // optional, and typed as the original's left side.
        if let PatternLike::Identifier(identifier) = param
            && identifier.type_annotation.is_none()
            && let Some(defaulted) = self.originals_at(&identifier.base).iter().find(|node| node.get("type").and_then(Value::as_str) == Some("AssignmentPattern"))
        {
            let annotation = defaulted.get("left").and_then(|left| left.get("typeAnnotation")).and_then(span_of).map(|(s, e)| self.source.slice(s, e));
            let left = defaulted.get("left").and_then(|left| left.get("_nodeId")).and_then(Value::as_u64).and_then(|n| u32::try_from(n).ok());
            let name = self.name(&identifier.base, &identifier.name).to_owned();
            self.write(&name);
            self.write("?");
            if let Some(text) = annotation {
                self.write(&text);
            } else if let Some(text) = left.and_then(|node| self.types.type_at(node & !crate::convert::SECOND_NODE)) {
                let _ = write!(self.out, ": {text}");
            }
            return;
        }
        if let PatternLike::Identifier(identifier) = param
            && identifier.type_annotation.is_none()
            && self.unchanged(identifier, &identifier.base).is_none()
            && self.original_part(&identifier.base, "typeAnnotation").is_none()
        {
            // No annotation to copy: a contextually typed parameter takes the
            // checker's type.
            let name = self.name(&identifier.base, &identifier.name).to_owned();
            self.write(&name);
            if self.originally_optional(&identifier.base) {
                self.write("?");
            }
            if let Some(text) = self.checker_type(&identifier.base) {
                let _ = write!(self.out, ": {text}");
            }
            return;
        }
        self.pattern(param);
    }

    // ---- patterns --------------------------------------------------------

    fn annotation(&mut self, annotation: Option<&RawNode>) {
        if let Some(text) = annotation.and_then(|a| self.raw(a)) {
            self.write(&text);
        }
    }

    fn identifier_binding(&mut self, identifier: &Identifier) {
        let name = self.name(&identifier.base, &identifier.name).to_owned();
        self.write(&name);
        if identifier.optional == Some(true) || self.originally_optional(&identifier.base) {
            self.write("?");
        }
        let annotation = identifier.type_annotation.as_ref().and_then(|a| self.raw(a)).or_else(|| self.original_part(&identifier.base, "typeAnnotation"));
        if let Some(text) = annotation {
            self.write(&text);
        }
    }

    fn pattern(&mut self, pattern: &PatternLike) {
        match pattern {
            PatternLike::Identifier(identifier) => {
                if let Some(text) = self.unchanged(identifier, &identifier.base) {
                    self.write(&text);
                } else {
                    self.identifier_binding(identifier);
                }
            }
            PatternLike::ObjectPattern(object) => {
                if let Some(text) = self.unchanged(object, &object.base) {
                    self.write(&text);
                    return;
                }
                self.write("{");
                for (at, property) in object.properties.iter().enumerate() {
                    self.write(if at == 0 { " " } else { ", " });
                    match property {
                        ObjectPatternProperty::ObjectProperty(p) => {
                            // `{ a }` and `{ a = 1 }` stay shorthand only while the
                            // value still prints as the key's name.
                            let shorthand = p.shorthand
                                && match (p.key.as_ref(), p.value.as_ref()) {
                                    (Expression::Identifier(k), PatternLike::Identifier(v)) => {
                                        k.name == self.name(&v.base, &v.name) && v.type_annotation.is_none()
                                    }
                                    (Expression::Identifier(k), PatternLike::AssignmentPattern(a)) => {
                                        matches!(a.left.as_ref(), PatternLike::Identifier(l) if k.name == self.name(&l.base, &l.name))
                                    }
                                    _ => false,
                                };
                            if shorthand {
                                self.pattern(&p.value);
                            } else {
                                self.property_key(&p.key, p.computed);
                                self.write(": ");
                                self.pattern(&p.value);
                            }
                        }
                        ObjectPatternProperty::RestElement(r) => {
                            self.write("...");
                            self.pattern(&r.argument);
                        }
                    }
                }
                self.write(if object.properties.is_empty() { "}" } else { " }" });
                let annotation = object.type_annotation.as_ref().and_then(|a| self.raw(a)).or_else(|| self.original_part(&object.base, "typeAnnotation"));
                if let Some(text) = annotation {
                    self.write(&text);
                }
            }
            PatternLike::ArrayPattern(array) => {
                if let Some(text) = self.unchanged(array, &array.base) {
                    self.write(&text);
                    return;
                }
                self.write("[");
                for (at, element) in array.elements.iter().enumerate() {
                    if at > 0 {
                        self.write(", ");
                    }
                    if let Some(element) = element {
                        self.pattern(element);
                    }
                }
                if array.elements.last().is_some_and(Option::is_none) {
                    self.write(",");
                }
                self.write("]");
                self.annotation(array.type_annotation.as_ref());
            }
            PatternLike::AssignmentPattern(assignment) => {
                self.pattern(&assignment.left);
                self.write(" = ");
                self.expression(&assignment.right, ASSIGN);
            }
            PatternLike::RestElement(rest) => {
                self.write("...");
                self.pattern(&rest.argument);
                self.annotation(rest.type_annotation.as_ref());
            }
            PatternLike::MemberExpression(member) => self.expression(&Expression::MemberExpression(member.clone()), CALL),
            PatternLike::TSAsExpression(e) => self.expression(&Expression::TSAsExpression(e.clone()), CALL),
            PatternLike::TSSatisfiesExpression(e) => self.expression(&Expression::TSSatisfiesExpression(e.clone()), CALL),
            PatternLike::TSNonNullExpression(e) => self.expression(&Expression::TSNonNullExpression(e.clone()), CALL),
            PatternLike::TSTypeAssertion(e) => self.expression(&Expression::TSTypeAssertion(e.clone()), CALL),
            PatternLike::TypeCastExpression(e) => self.expression(&e.expression, CALL),
        }
    }

    // ---- expressions -----------------------------------------------------

    fn property_key(&mut self, key: &Expression, computed: bool) {
        if computed {
            self.write("[");
            self.expression(key, ASSIGN);
            self.write("]");
        } else {
            self.expression(key, PRIMARY);
        }
    }

    fn string_literal(&mut self, literal: &StringLiteral) {
        if let Some(text) = self.unchanged(literal, &literal.base) {
            self.write(&text);
        } else {
            self.write(&quote(&literal.value.code_units()));
        }
    }

    fn expressions(&mut self, items: &[Expression]) {
        for (at, item) in items.iter().enumerate() {
            if at > 0 {
                self.write(", ");
            }
            self.expression(item, ASSIGN);
        }
    }

    /// An expression, parenthesised if its precedence is below `min`, with a
    /// `!` or type arguments the output dropped restored after it.
    fn expression(&mut self, expression: &Expression, min: u8) {
        let base = expression_base(expression);
        let wrapper = self.dropped_wrapper(base);
        // A restored `!` or `<T>` binds like a member access: an operand of
        // lower precedence is parenthesised under it.
        let parenthesise = precedence(expression) < min || (wrapper.is_some() && precedence(expression) < CALL);
        if parenthesise {
            self.write("(");
        }
        // An expression inside an assignment target (a default value, a
        // computed key) declares its own bindings again.
        let assigning = std::mem::replace(&mut self.assigning, false);
        self.expression_inner(expression, min);
        self.assigning = assigning;
        if parenthesise {
            self.write(")");
        }
        if let Some(wrapper) = wrapper {
            self.write(&wrapper);
        }
    }

    #[allow(clippy::too_many_lines)]
    fn expression_inner(&mut self, expression: &Expression, min: u8) {
        if let Some(text) = self.unchanged(expression, expression_base(expression)) {
            self.write(&text);
            return;
        }
        match expression {
            Expression::Identifier(identifier) => {
                let name = self.name(&identifier.base, &identifier.name).to_owned();
                self.write(&name);
            }
            Expression::StringLiteral(literal) => self.write(&quote(&literal.value.code_units())),
            Expression::NumericLiteral(literal) => self.write(&number(literal.value)),
            Expression::BooleanLiteral(literal) => self.write(if literal.value { "true" } else { "false" }),
            Expression::NullLiteral(_) => self.write("null"),
            Expression::BigIntLiteral(literal) => {
                let _ = write!(self.out, "{}n", literal.value);
            }
            Expression::RegExpLiteral(literal) => {
                let _ = write!(self.out, "/{}/{}", literal.pattern, literal.flags);
            }
            Expression::ThisExpression(_) => self.write("this"),
            Expression::Super(_) => self.write("super"),
            Expression::Import(_) => self.write("import"),
            Expression::PrivateName(p) => {
                let _ = write!(self.out, "#{}", p.id.name);
            }
            Expression::MetaProperty(m) => {
                let _ = write!(self.out, "{}.{}", m.meta.name, m.property.name);
            }
            Expression::TemplateLiteral(t) => self.template(t),
            Expression::TaggedTemplateExpression(t) => {
                self.expression(&t.tag, CALL);
                if let Some(text) = t.type_parameters.as_ref().and_then(|p| self.raw(p)) {
                    self.write(&text);
                }
                self.template(&t.quasi);
            }
            Expression::ArrayExpression(array) => {
                self.write("[");
                for (at, element) in array.elements.iter().enumerate() {
                    if at > 0 {
                        self.write(", ");
                    }
                    if let Some(element) = element {
                        self.expression(element, ASSIGN);
                    }
                }
                if array.elements.last().is_some_and(Option::is_none) {
                    self.write(",");
                }
                self.write("]");
            }
            Expression::ObjectExpression(object) => {
                if object.properties.is_empty() {
                    self.write("{}");
                } else {
                    self.write("{");
                    self.indent += 1;
                    for (at, property) in object.properties.iter().enumerate() {
                        if at > 0 {
                            self.write(",");
                        }
                        self.newline();
                        self.object_member(property);
                    }
                    self.indent -= 1;
                    self.newline();
                    self.write("}");
                }
            }
            Expression::SpreadElement(s) => {
                self.write("...");
                self.expression(&s.argument, ASSIGN);
            }
            Expression::MemberExpression(m) => {
                // A slot of the typed cache: its field. A read into a value is
                // cast where it is stored (see the assignment below); a
                // comparison needs no cast.
                if let Some(at) = self.cache_slot(expression) {
                    let name = self.cache().map_or("$", |plan| plan.name.as_str()).to_owned();
                    let _ = write!(self.out, "{name}.s{at}");
                    return;
                }
                self.member_object(&m.object, false);
                self.member_property(&m.property, m.computed, false);
            }
            Expression::OptionalMemberExpression(m) => {
                self.member_object(&m.object, true);
                self.member_property(&m.property, m.computed, m.optional);
            }
            Expression::CallExpression(c) => {
                self.member_object(&c.callee, false);
                let arguments = c.type_parameters.as_ref().and_then(|p| self.raw(p)).or_else(|| self.original_part(&c.base, "typeParameters"));
                if let Some(text) = arguments {
                    self.write(&text);
                }
                self.write("(");
                self.expressions(&c.arguments);
                self.write(")");
            }
            Expression::OptionalCallExpression(c) => {
                self.member_object(&c.callee, true);
                if c.optional {
                    self.write("?.");
                }
                let arguments = c.type_parameters.as_ref().and_then(|p| self.raw(p)).or_else(|| self.original_part(&c.base, "typeParameters"));
                if let Some(text) = arguments {
                    self.write(&text);
                }
                self.write("(");
                self.expressions(&c.arguments);
                self.write(")");
            }
            Expression::NewExpression(n) => {
                self.write("new ");
                // `new a()()` would call the result: a callee that contains a
                // call is parenthesised.
                if contains_call(&n.callee) {
                    self.write("(");
                    self.expression(&n.callee, SEQUENCE);
                    self.write(")");
                } else {
                    self.expression(&n.callee, CALL);
                }
                let arguments = n.type_parameters.as_ref().and_then(|p| self.raw(p)).or_else(|| self.original_part(&n.base, "typeParameters"));
                if let Some(text) = arguments {
                    self.write(&text);
                }
                self.write("(");
                self.expressions(&n.arguments);
                self.write(")");
            }
            Expression::UnaryExpression(u) => {
                let operator = unary_operator(&u.operator);
                self.write(operator);
                let word = operator.chars().all(char::is_alphabetic);
                let argument_start = Self::leading_char(&u.argument);
                if word || (operator.ends_with('-') && argument_start == Some('-')) || (operator.ends_with('+') && argument_start == Some('+')) {
                    self.write(" ");
                }
                self.expression(&u.argument, UNARY);
            }
            Expression::UpdateExpression(u) => {
                let operator = if matches!(u.operator, UpdateOperator::Increment) { "++" } else { "--" };
                if u.prefix {
                    self.write(operator);
                    self.expression(&u.argument, UNARY);
                } else {
                    self.expression(&u.argument, CALL);
                    self.write(operator);
                }
            }
            Expression::AwaitExpression(a) => {
                self.write("await ");
                self.expression(&a.argument, UNARY);
            }
            Expression::YieldExpression(y) => {
                self.write(if y.delegate { "yield*" } else { "yield" });
                if let Some(argument) = &y.argument {
                    self.write(" ");
                    self.expression(argument, ASSIGN);
                }
            }
            Expression::BinaryExpression(b) => {
                let level = binary_precedence(&b.operator);
                let (left_min, right_min) = if matches!(b.operator, BinaryOperator::Exp) { (level + 1, level) } else { (level, level + 1) };
                // `-a ** b` is a syntax error: a unary on the left of `**` is wrapped.
                let left_min = if matches!(b.operator, BinaryOperator::Exp) && matches!(b.left.as_ref(), Expression::UnaryExpression(_) | Expression::AwaitExpression(_)) { PRIMARY } else { left_min };
                self.expression(&b.left, left_min);
                let _ = write!(self.out, " {} ", binary_operator(&b.operator));
                self.expression(&b.right, right_min);
            }
            Expression::LogicalExpression(l) => {
                let level = logical_precedence(&l.operator);
                // `??` cannot sit beside `||` or `&&` without parentheses.
                let mixes = |e: &Expression| {
                    matches!(e, Expression::LogicalExpression(inner) if matches!(l.operator, LogicalOperator::NullishCoalescing) != matches!(inner.operator, LogicalOperator::NullishCoalescing))
                };
                let left_min = if mixes(&l.left) { PRIMARY } else { level };
                let right_min = if mixes(&l.right) { PRIMARY } else { level + 1 };
                self.expression(&l.left, left_min);
                let _ = write!(self.out, " {} ", logical_operator(&l.operator));
                self.expression(&l.right, right_min);
            }
            Expression::ConditionalExpression(c) => {
                self.expression(&c.test, NULLISH);
                self.write(" ? ");
                self.expression(&c.consequent, ASSIGN);
                self.write(" : ");
                self.expression(&c.alternate, ASSIGN);
            }
            Expression::AssignmentExpression(a) => {
                self.assignment_target(&a.left);
                let _ = write!(self.out, " {} ", assignment_operator(&a.operator));
                // `t1 = $[1]`: a read of the typed cache, cast to what the
                // slot was stored from.
                if let Some(at) = self.cache_slot(&a.right) {
                    let read = self.cache().map(|plan| plan.read(at)).unwrap_or_default();
                    self.write(&read);
                    return;
                }
                self.expression(&a.right, ASSIGN);
                // `t1 = $[1]` reads an erased cache slot into a typed
                // temporary. Until the cache is typed (M3.4), the read is cast.
                if let (PatternLike::Identifier(target), Expression::MemberExpression(read)) = (a.left.as_ref(), a.right.as_ref())
                    && self.cache().is_none()
                    && matches!(read.object.as_ref(), Expression::Identifier(cache) if cache.name == "$")
                {
                    let name = self.name(&target.base, &target.name).to_owned();
                    if self.typed_locals.contains(&name) {
                        let _ = write!(self.out, " as typeof {name}");
                    }
                }
            }
            Expression::SequenceExpression(s) => {
                for (at, item) in s.expressions.iter().enumerate() {
                    if at > 0 {
                        self.write(", ");
                    }
                    self.expression(item, ASSIGN);
                }
            }
            Expression::ArrowFunctionExpression(f) => {
                let Some(started) = self.function_start(&f.base) else { return };
                if f.is_async {
                    self.write("async ");
                }
                self.function_rest(&f.base, f.type_parameters.as_ref(), &f.params, f.return_type.as_ref());
                self.write(" => ");
                match f.body.as_ref() {
                    ArrowFunctionBody::BlockStatement(block) => self.function_body(&f.base, block),
                    ArrowFunctionBody::Expression(body) => {
                        let parenthesise = starts_ambiguously(body, false);
                        if parenthesise {
                            self.write("(");
                        }
                        self.expression(body, ASSIGN);
                        if parenthesise {
                            self.write(")");
                        }
                    }
                }
                self.function_end(&f.base, started);
            }
            Expression::FunctionExpression(f) => {
                let Some(started) = self.function_start(&f.base) else { return };
                if f.is_async {
                    self.write("async ");
                }
                self.write(if f.generator { "function*" } else { "function" });
                if let Some(id) = &f.id {
                    let _ = write!(self.out, " {}", id.name);
                }
                self.function_rest(&f.base, f.type_parameters.as_ref(), &f.params, f.return_type.as_ref());
                self.write(" ");
                self.function_body(&f.base, &f.body);
                self.function_end(&f.base, started);
            }
            Expression::ClassExpression(c) => self.span(&c.base),
            Expression::ParenthesizedExpression(p) => {
                self.write("(");
                self.expression(&p.expression, SEQUENCE);
                self.write(")");
            }
            Expression::JSXElement(element) => self.jsx_element(element),
            Expression::JSXFragment(fragment) => self.jsx_fragment(fragment),
            Expression::AssignmentPattern(p) => {
                self.pattern(&p.left);
                self.write(" = ");
                self.expression(&p.right, ASSIGN);
            }
            // `t0 as const`: the literal moved into `t0`, whose restored type is
            // already the const type, and `as const` on a name is not TypeScript.
            Expression::TSAsExpression(e) if matches!(e.expression.as_ref(), Expression::Identifier(_)) && is_const_assertion(&e.type_annotation) => {
                self.expression(&e.expression, min);
            }
            Expression::TSAsExpression(e) => {
                self.expression(&e.expression, RELATIONAL);
                self.write(" as ");
                if let Some(text) = self.raw(&e.type_annotation) {
                    self.write(&text);
                }
            }
            Expression::TSSatisfiesExpression(e) => {
                self.expression(&e.expression, RELATIONAL);
                self.write(" satisfies ");
                if let Some(text) = self.raw(&e.type_annotation) {
                    self.write(&text);
                }
            }
            Expression::TSTypeAssertion(e) => {
                self.write("<");
                if let Some(text) = self.raw(&e.type_annotation) {
                    self.write(&text);
                }
                self.write(">");
                self.expression(&e.expression, UNARY);
            }
            Expression::TSNonNullExpression(e) => {
                self.restoring = span_of_base(expression_base(&e.expression), self.source);
                self.expression(&e.expression, CALL);
                self.write("!");
            }
            Expression::TSInstantiationExpression(e) => {
                self.restoring = span_of_base(expression_base(&e.expression), self.source);
                self.expression(&e.expression, CALL);
                if let Some(text) = self.raw(&e.type_parameters) {
                    self.write(&text);
                }
            }
            Expression::TypeCastExpression(e) => self.expression(&e.expression, min),
        }
    }

    /// The object of a member access or the callee of a call. A number like
    /// `1` needs `(1).x`; an optional chain continued outside its chain needs
    /// `(a?.b).c`.
    fn member_object(&mut self, object: &Expression, in_chain: bool) {
        let chain_ends = !in_chain && matches!(object, Expression::OptionalMemberExpression(_) | Expression::OptionalCallExpression(_));
        let bare_integer = matches!(object, Expression::NumericLiteral(n) if n.value.fract() == 0.0 && self.unchanged(object, expression_base(object)).is_none_or(|t| !t.contains(['.', 'e', 'x', 'o', 'b', 'E', 'X', 'O', 'B'])));
        if chain_ends || bare_integer {
            self.write("(");
            self.expression(object, SEQUENCE);
            self.write(")");
        } else {
            self.expression(object, CALL);
        }
    }

    fn member_property(&mut self, property: &Expression, computed: bool, optional: bool) {
        if computed {
            self.write(if optional { "?.[" } else { "[" });
            self.expression(property, SEQUENCE);
            self.write("]");
        } else {
            self.write(if optional { "?." } else { "." });
            self.expression(property, PRIMARY);
        }
    }

    fn object_member(&mut self, property: &ObjectExpressionProperty) {
        match property {
            ObjectExpressionProperty::ObjectProperty(p) => {
                // Shorthand only while the value still prints as the key's name.
                let shorthand = p.shorthand
                    && matches!((p.key.as_ref(), p.value.as_ref()), (Expression::Identifier(k), Expression::Identifier(v)) if k.name == self.name(&v.base, &v.name));
                if shorthand {
                    self.expression(&p.value, ASSIGN);
                } else {
                    self.property_key(&p.key, p.computed);
                    self.write(": ");
                    self.expression(&p.value, ASSIGN);
                }
            }
            ObjectExpressionProperty::ObjectMethod(m) => {
                if m.is_async {
                    self.write("async ");
                }
                match m.kind {
                    ObjectMethodKind::Get => self.write("get "),
                    ObjectMethodKind::Set => self.write("set "),
                    ObjectMethodKind::Method => {}
                }
                if m.generator {
                    self.write("*");
                }
                self.property_key(&m.key, m.computed);
                self.function_rest(&m.base, m.type_parameters.as_ref(), &m.params, m.return_type.as_ref());
                self.write(" ");
                self.function_body(&m.base, &m.body);
            }
            ObjectExpressionProperty::SpreadElement(s) => {
                self.write("...");
                self.expression(&s.argument, ASSIGN);
            }
        }
    }

    fn template(&mut self, template: &react_compiler_ast::expressions::TemplateLiteral) {
        self.write("`");
        for (at, quasi) in template.quasis.iter().enumerate() {
            self.write(&quasi.value.raw);
            if let Some(expression) = template.expressions.get(at) {
                self.write("${");
                self.expression(expression, SEQUENCE);
                self.write("}");
            }
        }
        self.write("`");
    }

    /// The first character an expression prints as, where that decides spacing.
    fn leading_char(expression: &Expression) -> Option<char> {
        match expression {
            Expression::UnaryExpression(u) => unary_operator(&u.operator).chars().next(),
            Expression::UpdateExpression(u) if u.prefix => Some(if matches!(u.operator, UpdateOperator::Increment) { '+' } else { '-' }),
            Expression::NumericLiteral(n) if n.value < 0.0 => Some('-'),
            _ => None,
        }
    }

    // ---- JSX -------------------------------------------------------------

    fn jsx_element(&mut self, element: &JSXElement) {
        if self.lower_jsx {
            self.jsx_lower_element(element);
            return;
        }
        if let Some(text) = self.unchanged(element, &element.base) {
            self.write(&text);
            return;
        }
        let opening = &element.opening_element;
        self.write("<");
        self.jsx_name(&opening.name);
        if let Some(text) = opening.type_parameters.as_ref().and_then(|p| self.raw(p)) {
            self.write(&text);
        }
        for attribute in &opening.attributes {
            self.write(" ");
            match attribute {
                JSXAttributeItem::JSXAttribute(a) => {
                    match &a.name {
                        JSXAttributeName::JSXIdentifier(i) => self.write(&i.name),
                        JSXAttributeName::JSXNamespacedName(n) => {
                            let _ = write!(self.out, "{}:{}", n.namespace.name, n.name.name);
                        }
                    }
                    if let Some(value) = &a.value {
                        self.write("=");
                        match value {
                            JSXAttributeValue::StringLiteral(s) => {
                                // The value is decoded: its entities are
                                // spelled as the user spelled them, and an
                                // `&` the compiler made goes in a JavaScript
                                // string, where nothing could misread it.
                                let value = s.value.to_string_lossy();
                                let spelling = self.jsx_spelling(&s.base, &value);
                                if spelling.is_none() && value.contains('&') {
                                    self.write("{");
                                    self.write(&quote(&s.value.code_units()));
                                    self.write("}");
                                } else {
                                    // A JSX string has no escapes: the quote
                                    // is whichever one it does not contain.
                                    let text = spelling.unwrap_or(value);
                                    let quote = if text.contains('"') { '\'' } else { '"' };
                                    let _ = write!(self.out, "{quote}{text}{quote}");
                                }
                            }
                            JSXAttributeValue::JSXExpressionContainer(c) => self.jsx_container(&c.expression),
                            JSXAttributeValue::JSXElement(e) => self.jsx_element(e),
                            JSXAttributeValue::JSXFragment(f) => self.jsx_fragment(f),
                        }
                    }
                }
                JSXAttributeItem::JSXSpreadAttribute(s) => {
                    self.write("{...");
                    self.expression(&s.argument, ASSIGN);
                    self.write("}");
                }
            }
        }
        if opening.self_closing {
            self.write(" />");
            return;
        }
        self.write(">");
        self.jsx_children(&element.children);
        self.write("</");
        if let Some(closing) = &element.closing_element {
            self.jsx_name(&closing.name);
        }
        self.write(">");
    }

    fn jsx_fragment(&mut self, fragment: &JSXFragment) {
        if self.lower_jsx {
            self.jsx_lower_fragment(fragment);
            return;
        }
        if let Some(text) = self.unchanged(fragment, &fragment.base) {
            self.write(&text);
            return;
        }
        self.write("<>");
        self.jsx_children(&fragment.children);
        self.write("</>");
    }

    fn jsx_name(&mut self, name: &JSXElementName) {
        match name {
            JSXElementName::JSXIdentifier(i) => {
                let name = self.name(&i.base, &i.name).to_owned();
                self.write(&name);
            }
            JSXElementName::JSXMemberExpression(m) => self.jsx_member(m),
            JSXElementName::JSXNamespacedName(n) => {
                let _ = write!(self.out, "{}:{}", n.namespace.name, n.name.name);
            }
        }
    }

    fn jsx_member(&mut self, member: &JSXMemberExpression) {
        match member.object.as_ref() {
            JSXMemberExprObject::JSXIdentifier(i) => {
                let name = self.name(&i.base, &i.name).to_owned();
                self.write(&name);
            }
            JSXMemberExprObject::JSXMemberExpression(inner) => self.jsx_member(inner),
        }
        let _ = write!(self.out, ".{}", member.property.name);
    }

    fn jsx_container(&mut self, expression: &JSXExpressionContainerExpr) {
        self.write("{");
        if let JSXExpressionContainerExpr::Expression(e) = expression {
            self.expression(e, ASSIGN);
        }
        self.write("}");
    }

    fn jsx_children(&mut self, children: &[JSXChild]) {
        for child in children {
            match child {
                // The value is decoded: its entities are spelled as the user
                // spelled them. Code generation puts a text holding `&<>{}`
                // in a container, so the value is otherwise its own spelling.
                JSXChild::JSXText(t) => match self.jsx_spelling(&t.base, &t.value) {
                    Some(spelling) => self.write(&spelling),
                    None => self.write(&t.value),
                },
                JSXChild::JSXElement(e) => self.jsx_element(e),
                JSXChild::JSXFragment(f) => self.jsx_fragment(f),
                JSXChild::JSXExpressionContainer(c) => self.jsx_container(&c.expression),
                JSXChild::JSXSpreadChild(s) => {
                    self.write("{...");
                    self.expression(&s.expression, ASSIGN);
                    self.write("}");
                }
            }
        }
    }
}

fn module_export_name(name: &ModuleExportName) -> String {
    match name {
        ModuleExportName::Identifier(i) => i.name.clone(),
        ModuleExportName::StringLiteral(s) => quote(&s.value.code_units()),
    }
}

/// A string as a double-quoted JavaScript literal.
fn quote(units: &[u16]) -> String {
    let mut out = String::from("\"");
    for unit in char::decode_utf16(units.iter().copied()) {
        match unit {
            Ok('"') => out.push_str("\\\""),
            Ok('\\') => out.push_str("\\\\"),
            Ok('\n') => out.push_str("\\n"),
            Ok('\r') => out.push_str("\\r"),
            Ok('\t') => out.push_str("\\t"),
            Ok('\u{8}') => out.push_str("\\b"),
            Ok('\u{c}') => out.push_str("\\f"),
            Ok('\u{b}') => out.push_str("\\v"),
            Ok('\u{2028}') => out.push_str("\\u2028"),
            Ok('\u{2029}') => out.push_str("\\u2029"),
            Ok(c) if (c as u32) < 0x20 => {
                let _ = write!(out, "\\x{:02x}", c as u32);
            }
            Ok(c) => out.push(c),
            Err(lone) => {
                let _ = write!(out, "\\u{:04x}", lone.unpaired_surrogate());
            }
        }
    }
    out.push('"');
    out
}

/// A number as JavaScript prints it, for the ones the compiler generates:
/// integers (cache sizes, slot indices) and the occasional fraction.
fn number(value: f64) -> String {
    if value.is_nan() {
        return "NaN".to_owned();
    }
    if value.is_infinite() {
        return if value > 0.0 { "Infinity".to_owned() } else { "-Infinity".to_owned() };
    }
    if value.fract() == 0.0 && value.abs() < 1e21 {
        return format!("{value:.0}");
    }
    format!("{value}")
}

fn precedence(expression: &Expression) -> u8 {
    match expression {
        Expression::SequenceExpression(_) => SEQUENCE,
        Expression::AssignmentExpression(_) | Expression::ArrowFunctionExpression(_) | Expression::YieldExpression(_) | Expression::AssignmentPattern(_) => ASSIGN,
        Expression::ConditionalExpression(_) => CONDITIONAL,
        Expression::LogicalExpression(l) => logical_precedence(&l.operator),
        Expression::BinaryExpression(b) => binary_precedence(&b.operator),
        Expression::TSAsExpression(_) | Expression::TSSatisfiesExpression(_) => RELATIONAL,
        Expression::UnaryExpression(_) | Expression::AwaitExpression(_) | Expression::TSTypeAssertion(_) => UNARY,
        Expression::UpdateExpression(u) => if u.prefix { UNARY } else { POSTFIX },
        Expression::CallExpression(_) | Expression::OptionalCallExpression(_) | Expression::MemberExpression(_) | Expression::OptionalMemberExpression(_) | Expression::NewExpression(_) | Expression::TaggedTemplateExpression(_) | Expression::TSNonNullExpression(_) | Expression::TSInstantiationExpression(_) => CALL,
        _ => PRIMARY,
    }
}

fn binary_precedence(operator: &BinaryOperator) -> u8 {
    use BinaryOperator as B;
    match operator {
        B::BitOr => BIT_OR,
        B::BitXor => BIT_XOR,
        B::BitAnd => BIT_AND,
        B::Eq | B::Neq | B::StrictEq | B::StrictNeq => EQUALITY,
        B::Lt | B::Lte | B::Gt | B::Gte | B::In | B::Instanceof => RELATIONAL,
        B::Shl | B::Shr | B::UShr => SHIFT,
        B::Add | B::Sub => ADDITIVE,
        B::Mul | B::Div | B::Rem => MULTIPLICATIVE,
        B::Exp => EXPONENT,
        B::Pipeline => NULLISH,
    }
}

fn logical_precedence(operator: &LogicalOperator) -> u8 {
    match operator {
        LogicalOperator::NullishCoalescing => NULLISH,
        LogicalOperator::Or => OR,
        LogicalOperator::And => AND,
    }
}

fn binary_operator(operator: &BinaryOperator) -> &'static str {
    use BinaryOperator as B;
    match operator {
        B::Add => "+",
        B::Sub => "-",
        B::Mul => "*",
        B::Div => "/",
        B::Rem => "%",
        B::Exp => "**",
        B::Eq => "==",
        B::StrictEq => "===",
        B::Neq => "!=",
        B::StrictNeq => "!==",
        B::Lt => "<",
        B::Lte => "<=",
        B::Gt => ">",
        B::Gte => ">=",
        B::Shl => "<<",
        B::Shr => ">>",
        B::UShr => ">>>",
        B::BitOr => "|",
        B::BitXor => "^",
        B::BitAnd => "&",
        B::In => "in",
        B::Instanceof => "instanceof",
        B::Pipeline => "|>",
    }
}

fn logical_operator(operator: &LogicalOperator) -> &'static str {
    match operator {
        LogicalOperator::Or => "||",
        LogicalOperator::And => "&&",
        LogicalOperator::NullishCoalescing => "??",
    }
}

fn unary_operator(operator: &UnaryOperator) -> &'static str {
    match operator {
        UnaryOperator::Neg => "-",
        UnaryOperator::Plus => "+",
        UnaryOperator::Not => "!",
        UnaryOperator::BitNot => "~",
        UnaryOperator::TypeOf => "typeof",
        UnaryOperator::Void => "void",
        UnaryOperator::Delete => "delete",
        UnaryOperator::Throw => "throw",
    }
}

fn assignment_operator(operator: &AssignmentOperator) -> &'static str {
    use AssignmentOperator as A;
    match operator {
        A::Assign => "=",
        A::AddAssign => "+=",
        A::SubAssign => "-=",
        A::MulAssign => "*=",
        A::DivAssign => "/=",
        A::RemAssign => "%=",
        A::ExpAssign => "**=",
        A::ShlAssign => "<<=",
        A::ShrAssign => ">>=",
        A::UShrAssign => ">>>=",
        A::BitOrAssign => "|=",
        A::BitXorAssign => "^=",
        A::BitAndAssign => "&=",
        A::OrAssign => "||=",
        A::AndAssign => "&&=",
        A::NullishAssign => "??=",
    }
}

/// Whether an expression at the start of a statement (or an arrow's body)
/// would be read as something else: `{` as a block, `function` and `class` as
/// declarations, `let [` as a declaration. Looks down the leftmost operand.
fn starts_ambiguously(expression: &Expression, statement: bool) -> bool {
    match expression {
        Expression::ObjectExpression(_) => true,
        Expression::FunctionExpression(_) | Expression::ClassExpression(_) => statement,
        Expression::Identifier(i) => statement && i.name == "let",
        Expression::MemberExpression(m) => starts_ambiguously(&m.object, statement),
        Expression::OptionalMemberExpression(m) => starts_ambiguously(&m.object, statement),
        Expression::CallExpression(c) => starts_ambiguously(&c.callee, statement),
        Expression::OptionalCallExpression(c) => starts_ambiguously(&c.callee, statement),
        Expression::TaggedTemplateExpression(t) => starts_ambiguously(&t.tag, statement),
        Expression::BinaryExpression(b) => starts_ambiguously(&b.left, statement),
        Expression::LogicalExpression(l) => starts_ambiguously(&l.left, statement),
        Expression::ConditionalExpression(c) => starts_ambiguously(&c.test, statement),
        Expression::SequenceExpression(s) => s.expressions.first().is_some_and(|e| starts_ambiguously(e, statement)),
        Expression::AssignmentExpression(a) => matches!(a.left.as_ref(), PatternLike::ObjectPattern(_)),
        Expression::UpdateExpression(u) if !u.prefix => starts_ambiguously(&u.argument, statement),
        Expression::TSAsExpression(e) => starts_ambiguously(&e.expression, statement),
        Expression::TSSatisfiesExpression(e) => starts_ambiguously(&e.expression, statement),
        Expression::TSNonNullExpression(e) => starts_ambiguously(&e.expression, statement),
        _ => false,
    }
}

fn contains_call(expression: &Expression) -> bool {
    match expression {
        Expression::CallExpression(_) | Expression::OptionalCallExpression(_) => true,
        Expression::MemberExpression(m) => contains_call(&m.object),
        Expression::OptionalMemberExpression(m) => contains_call(&m.object),
        Expression::TaggedTemplateExpression(t) => contains_call(&t.tag),
        Expression::TSNonNullExpression(e) => contains_call(&e.expression),
        _ => false,
    }
}

fn contains_top_level_in(expression: &Expression) -> bool {
    match expression {
        Expression::BinaryExpression(b) => matches!(b.operator, BinaryOperator::In) || contains_top_level_in(&b.left) || contains_top_level_in(&b.right),
        Expression::LogicalExpression(l) => contains_top_level_in(&l.left) || contains_top_level_in(&l.right),
        Expression::ConditionalExpression(c) => contains_top_level_in(&c.test) || contains_top_level_in(&c.consequent) || contains_top_level_in(&c.alternate),
        Expression::AssignmentExpression(a) => contains_top_level_in(&a.right),
        Expression::SequenceExpression(s) => s.expressions.iter().any(contains_top_level_in),
        _ => false,
    }
}

fn statement_base(statement: &Statement) -> &BaseNode {
    match statement {
        Statement::BlockStatement(s) => &s.base,
        Statement::ReturnStatement(s) => &s.base,
        Statement::IfStatement(s) => &s.base,
        Statement::ForStatement(s) => &s.base,
        Statement::WhileStatement(s) => &s.base,
        Statement::DoWhileStatement(s) => &s.base,
        Statement::ForInStatement(s) => &s.base,
        Statement::ForOfStatement(s) => &s.base,
        Statement::SwitchStatement(s) => &s.base,
        Statement::ThrowStatement(s) => &s.base,
        Statement::TryStatement(s) => &s.base,
        Statement::BreakStatement(s) => &s.base,
        Statement::ContinueStatement(s) => &s.base,
        Statement::LabeledStatement(s) => &s.base,
        Statement::ExpressionStatement(s) => &s.base,
        Statement::EmptyStatement(s) => &s.base,
        Statement::DebuggerStatement(s) => &s.base,
        Statement::WithStatement(s) => &s.base,
        Statement::VariableDeclaration(s) => &s.base,
        Statement::FunctionDeclaration(s) => &s.base,
        Statement::ClassDeclaration(s) => &s.base,
        Statement::ImportDeclaration(s) => &s.base,
        Statement::ExportNamedDeclaration(s) => &s.base,
        Statement::ExportDefaultDeclaration(s) => &s.base,
        Statement::ExportAllDeclaration(s) => &s.base,
        Statement::TSTypeAliasDeclaration(s) => &s.base,
        Statement::TSInterfaceDeclaration(s) => &s.base,
        Statement::TSEnumDeclaration(s) => &s.base,
        Statement::TSModuleDeclaration(s) => &s.base,
        Statement::TSDeclareFunction(s) => &s.base,
        Statement::TypeAlias(s) => &s.base,
        Statement::OpaqueType(s) => &s.base,
        Statement::InterfaceDeclaration(s) => &s.base,
        Statement::DeclareVariable(s) => &s.base,
        Statement::DeclareFunction(s) => &s.base,
        Statement::DeclareClass(s) => &s.base,
        Statement::DeclareModule(s) => &s.base,
        Statement::DeclareModuleExports(s) => &s.base,
        Statement::DeclareExportDeclaration(s) => &s.base,
        Statement::DeclareExportAllDeclaration(s) => &s.base,
        Statement::DeclareInterface(s) => &s.base,
        Statement::DeclareTypeAlias(s) => &s.base,
        Statement::DeclareOpaqueType(s) => &s.base,
        Statement::EnumDeclaration(s) => &s.base,
        Statement::Unknown(s) => s.base(),
    }
}

fn expression_base(expression: &Expression) -> &BaseNode {
    match expression {
        Expression::Identifier(e) => &e.base,
        Expression::StringLiteral(e) => &e.base,
        Expression::NumericLiteral(e) => &e.base,
        Expression::BooleanLiteral(e) => &e.base,
        Expression::NullLiteral(e) => &e.base,
        Expression::BigIntLiteral(e) => &e.base,
        Expression::RegExpLiteral(e) => &e.base,
        Expression::CallExpression(e) => &e.base,
        Expression::MemberExpression(e) => &e.base,
        Expression::OptionalCallExpression(e) => &e.base,
        Expression::OptionalMemberExpression(e) => &e.base,
        Expression::BinaryExpression(e) => &e.base,
        Expression::LogicalExpression(e) => &e.base,
        Expression::UnaryExpression(e) => &e.base,
        Expression::UpdateExpression(e) => &e.base,
        Expression::ConditionalExpression(e) => &e.base,
        Expression::AssignmentExpression(e) => &e.base,
        Expression::SequenceExpression(e) => &e.base,
        Expression::ArrowFunctionExpression(e) => &e.base,
        Expression::FunctionExpression(e) => &e.base,
        Expression::ObjectExpression(e) => &e.base,
        Expression::ArrayExpression(e) => &e.base,
        Expression::NewExpression(e) => &e.base,
        Expression::TemplateLiteral(e) => &e.base,
        Expression::TaggedTemplateExpression(e) => &e.base,
        Expression::AwaitExpression(e) => &e.base,
        Expression::YieldExpression(e) => &e.base,
        Expression::SpreadElement(e) => &e.base,
        Expression::MetaProperty(e) => &e.base,
        Expression::ClassExpression(e) => &e.base,
        Expression::PrivateName(e) => &e.base,
        Expression::Super(e) => &e.base,
        Expression::Import(e) => &e.base,
        Expression::ThisExpression(e) => &e.base,
        Expression::ParenthesizedExpression(e) => &e.base,
        Expression::JSXElement(e) => &e.base,
        Expression::JSXFragment(e) => &e.base,
        Expression::AssignmentPattern(e) => &e.base,
        Expression::TSAsExpression(e) => &e.base,
        Expression::TSSatisfiesExpression(e) => &e.base,
        Expression::TSNonNullExpression(e) => &e.base,
        Expression::TSTypeAssertion(e) => &e.base,
        Expression::TSInstantiationExpression(e) => &e.base,
        Expression::TypeCastExpression(e) => &e.base,
    }
}

/// A node's span: its `start` and `end`, or -- on a node the compiler's code
/// generation made, which keeps only `loc` -- its location's indices, or its
/// lines and columns where it kept no index either.
fn span_of_base(base: &BaseNode, source: &SourceText) -> Option<(u32, u32)> {
    if let (Some(start), Some(end)) = (base.start, base.end) {
        return Some((start, end));
    }
    let loc = base.loc.as_ref()?;
    let at = |position: &react_compiler_ast::common::Position| position.index.or_else(|| source.offset(position.line, position.column));
    Some((at(&loc.start)?, at(&loc.end)?))
}

/// `as const`: a type reference to `const`.
fn is_const_assertion(annotation: &RawNode) -> bool {
    let value = annotation.parse_value();
    value.get("type").and_then(Value::as_str) == Some("TSTypeReference")
        && value.get("typeName").and_then(|name| name.get("name")).and_then(Value::as_str) == Some("const")
}
