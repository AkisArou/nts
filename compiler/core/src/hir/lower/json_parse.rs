//! `JSON.parse(text) as T`, with `T` a plain object type: a parser the
//! compiler generates for `T` (`docs/foundations/json.md`, "Reading").
//!
//! # One decision, three readers
//!
//! [`typed_parse`] is the only place that says a node is this boundary: the
//! global `JSON`'s checked `parse`, one argument that is a string, and an
//! assertion to a plain object type. Three things read it, and none decides
//! it again:
//!
//! - **cast faces** (`interfaces.rs`): an ordinary cast of an erased value to
//!   an anonymous object type makes that type a face, read through field
//!   families, because nothing checked what arrived. This cast is checked, so
//!   it makes no face, and `T` keeps its own layout everywhere else -- the
//!   whole of what `startup-builtins` lost (#886);
//! - **assertion lowering** (`coercion.rs`), which lowers it here instead of
//!   as a cast of a `JSON.parse` result, which has no lowering;
//! - **synchronous effects** (`assertions::can_throw`): it throws.
//!
//! # The parser
//!
//! The runtime's scan (`runtime/c/nts_json.c`) checks the whole text first and
//! writes a *tape*; invalid text is a `SyntaxError` before any of `T` is read,
//! in V8's own words. Then one generated reader per type walks the tape and
//! builds the layout directly -- no intermediate tree:
//!
//! - an object reader records, for each declared key, where its **last**
//!   value is (a duplicate key takes the final value, and only that one is
//!   checked), then reads the fields in declaration order and builds the
//!   object; an undeclared key is skipped in one step, however deep;
//! - an array reader allocates its exact length, which the tape counted, and
//!   reads each element;
//! - a scalar is a kind test and a runtime read.
//!
//! A mismatch is a `TypeError` naming the JSON path (`$.rows[3].id: expected
//! a number, found a string`). A reader that meets one writes the message into
//! the parse's `failure` cell and answers null; its callers pass the null up,
//! and the boundary throws. So every throw is the boundary's, in the function
//! the program wrote, where its handlers and raising copies already are, and
//! the readers themselves never raise.
//!
//! The readers are ordinary HIR, so the number fields of `T` see a writer that
//! stores arbitrary doubles, and nothing narrows them on speculation.
//!
//! # What is refused, by name
//!
//! - A class as `T`, a method, an accessor; a literal, enum or union type
//!   other than `X | null` and an optional member; a `Map`, `Date`, `bigint`;
//!   a top-level array; a recursive type, whose depth the type does not bound.
//! - **A `T` whose key order or undeclared keys the program can observe**
//!   ([`Observers`]): the layout keeps neither, and keeping them where they
//!   are observable is the rest of the design (#650, part 5).

use nts_diagnostics::Diagnostic;
use nts_semantic_schema::{
    MemberKind, NodeId, NodeKind, Origin, PropertyKey, SemanticSnapshot, SymbolId, TypeId,
    TypeKind, syntax,
};

use super::{
    Absence, BinOp, Callee, Facts, FuncBuilder, HirType, LayoutCollector, Lowered,
    LoweringSnapshot, ManagedType, NO_FOREIGN, OpKind, Param, ParamShape, Shared, Terminator,
    ValueId,
};
use crate::hir::ArrayFill;

const STRING: HirType = HirType::Managed(ManagedType::String);

/// Where the tape's first value is (`nts_json.c`'s `NTS_JSON_HEAD`), and how
/// wide every entry is.
const HEAD: f64 = 4.0;
const ENTRY: f64 = 3.0;

/// The tape's kinds (`nts_json.c`).
#[derive(Clone, Copy)]
enum Kind {
    Object = 1,
    Array = 2,
    String = 3,
    Number = 4,
    True = 5,
    False = 6,
    Null = 7,
}

/// The typed-parse boundary at one assertion.
#[derive(Debug, Clone, Copy)]
pub(super) struct TypedParse {
    /// The text's argument.
    pub text: NodeId,
    /// The plain object type asserted.
    pub target: TypeId,
}

/// Whether `id` is `JSON.parse(text) as T` (or `<T>JSON.parse(text)`) with
/// `T` a plain object type: the one answer every reader of this boundary
/// takes. A `JSON` the program declares is its own, and a reviver, a second
/// argument or a text that may not be a string is not this boundary.
pub(super) fn typed_parse(probe: &FuncBuilder<'_>, id: NodeId) -> Option<TypedParse> {
    let operand_at = match probe.kind_of(id)? {
        syntax::AS_EXPRESSION => 0,
        syntax::TYPE_ASSERTION_EXPRESSION => 1,
        _ => return None,
    };
    let call = probe.through_parentheses(*probe.children(id).get(operand_at)?);
    if probe.kind_of(call) != Some(syntax::CALL_EXPRESSION) {
        return None;
    }
    let callee = *probe.children(call).first()?;
    let (global, member) = probe.builtin_global_member(callee)?;
    if global.name != "JSON" || member != "parse" {
        return None;
    }
    let [text] = probe.arguments_of(call).as_slice().try_into().ok()?;
    let text_ty = *probe.snapshot.node_types.get(&text)?;
    if probe.represent(text_ty) != Some(STRING) || super::admits_absence(probe.snapshot, text_ty) {
        return None;
    }
    let target = *probe.snapshot.node_types.get(&id)?;
    plain_object(probe, target).then_some(TypedParse { text, target })
}

/// An object type a literal could be, laid out as itself: not a class, not a
/// function, no index signature.
fn plain_object(probe: &FuncBuilder<'_>, ty: TypeId) -> bool {
    matches!(
        probe
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| &record.kind),
        Some(TypeKind::Object { .. })
    ) && probe.represent(ty) == Some(HirType::Managed(ManagedType::Object(ty)))
        && !super::assertions::is_nominal_class(probe, ty)
        && !probe.snapshot.index_signatures.contains_key(&ty)
}

/// How one value is read: what it is, and whether `null` stands for it.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Slot {
    read: Read,
    null: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum Read {
    Number,
    Bool,
    String,
    /// A member whose only value is `null`.
    Null,
    /// By its type's reader.
    Object {
        reader: String,
        ty: TypeId,
    },
    /// By its array reader, whose slots are `have`.
    Array {
        reader: String,
        have: HirType,
    },
}

impl Slot {
    /// What a mismatch says was expected.
    fn expected(&self) -> String {
        let what = match &self.read {
            Read::Number => "a number",
            Read::Bool => "a boolean",
            Read::String => "a string",
            Read::Null => "null",
            Read::Object { .. } => "an object",
            Read::Array { .. } => "an array",
        };
        if self.null && self.read != Read::Null {
            format!("{what} or null")
        } else {
            what.to_owned()
        }
    }

    /// A spelling unique to how it is read, which names an array reader by
    /// its element.
    fn key(&self) -> String {
        let name = match &self.read {
            Read::Number => "number",
            Read::Bool => "boolean",
            Read::String => "string",
            Read::Null => "null",
            Read::Object { reader, .. } | Read::Array { reader, .. } => reader.as_str(),
        };
        if self.null && self.read != Read::Null {
            format!("{name} | null")
        } else {
            name.to_owned()
        }
    }
}

/// One member an object reader fills.
#[derive(Debug, Clone)]
struct Member {
    key: String,
    field: u32,
    ty: HirType,
    slot: Slot,
    required: bool,
}

/// A reader some boundary names: the function, and what it reads.
#[derive(Debug, Clone)]
pub(super) struct Reader {
    pub name: String,
    shape: Shape,
    site: NodeId,
}

#[derive(Debug, Clone)]
enum Shape {
    Object { ty: TypeId, members: Vec<Member> },
    Array { element: Slot, have: HirType },
}

/// What a reader reads from: the text, its tape, the entry, and the cell a
/// mismatch's message goes into.
#[derive(Clone, Copy)]
struct Reading {
    text: ValueId,
    tape: ValueId,
    failure: ValueId,
    /// What the reader answers for a mismatch: its own null.
    returns: ValueId,
}

/// Build every reader the lowered bodies named, once each.
pub(super) fn lower_readers(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    shared: &Shared,
    lowered: &mut Lowered,
    wanted: &mut std::collections::BTreeSet<usize>,
) {
    let mut made = rustc_hash::FxHashSet::default();
    for reader in std::mem::take(&mut lowered.arrivals.json_readers) {
        if !made.insert(reader.name.clone()) {
            continue;
        }
        let mut builder = shared.builder(
            snapshot,
            NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default),
            super::Copy::default(),
        );
        let func = builder.lower_json_reader(&reader);
        lowered.program.funcs.push(func);
        builder.harvest(wanted, &mut lowered.arrivals);
        layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
    }
}

/// Where the program can see an object's own keys: each site's operand type,
/// and whether what it reads is the object's own keys only or everything it
/// holds as well (`JSON.stringify`, a host). Found once for the program.
#[derive(Debug, Default)]
pub(super) struct Observers {
    sites: Vec<Observer>,
}

#[derive(Debug, Clone)]
struct Observer {
    operand: TypeId,
    deep: bool,
    what: &'static str,
}

/// Every site that observes an object's key order or its undeclared keys:
///
/// - `Object.keys`, `values`, `entries`, `getOwnPropertyNames`,
///   `getOwnPropertyDescriptors`, `assign`, `hasOwn`; `Reflect.ownKeys`;
///   `x.hasOwnProperty`; `for...in`; an object spread; `in`; a rest element
///   of an object pattern -- its own keys;
/// - `JSON.stringify`, `console`'s methods, a native call, an exported
///   function's parameters and result, and a store into an `any` or `unknown`
///   place -- everything it holds, since each can reach a key observer this
///   walk cannot see.
pub(super) fn observers(snapshot: &SemanticSnapshot, probe: &FuncBuilder<'_>) -> Observers {
    let mut sites = Vec::new();
    let mut references: rustc_hash::FxHashMap<SymbolId, Vec<NodeId>> =
        rustc_hash::FxHashMap::default();
    for (index, node) in snapshot.nodes.iter().enumerate() {
        if node.kind == NodeKind::Syntax(syntax::IDENTIFIER)
            && let (Some(symbol), Ok(index)) = (node.symbol, u32::try_from(index))
        {
            references.entry(symbol).or_default().push(NodeId(index));
        }
    }
    let mut add = |node: NodeId, deep: bool, what: &'static str| {
        if literal_constant(probe, &references, node) {
            return;
        }
        if let Some(operand) = snapshot.node_types.get(&node).copied() {
            sites.push(Observer {
                operand,
                deep,
                what,
            });
        }
    };
    for (index, node) in snapshot.nodes.iter().enumerate() {
        let NodeKind::Syntax(kind) = node.kind else {
            continue;
        };
        let Ok(index) = u32::try_from(index) else {
            continue;
        };
        let id = NodeId(index);
        match kind {
            syntax::CALL_EXPRESSION => call_observers(snapshot, probe, id, &mut add),
            syntax::FOR_IN_STATEMENT => {
                if let Some([_, _, Some(object), _]) = probe.child_slots::<4>(id) {
                    add(object, false, "`for...in`");
                }
            }
            syntax::SPREAD_ASSIGNMENT => {
                if let Some(object) = probe.children(id).first().copied() {
                    add(object, false, "an object spread");
                }
            }
            syntax::BINARY_EXPRESSION => {
                let children = probe.children(id);
                let [target, operator, value] = children.as_slice() else {
                    continue;
                };
                match probe.kind_of(*operator) {
                    Some(syntax::IN_KEYWORD) => add(*value, false, "`in`"),
                    Some(syntax::EQUALS_TOKEN) if erased_place(snapshot, *target) => {
                        add(*value, true, "a store into an erased place");
                    }
                    _ => {}
                }
            }
            syntax::VARIABLE_DECLARATION => {
                if let Some([Some(name), _, _, Some(value)]) = probe.child_slots::<4>(id)
                    && erased_place(snapshot, name)
                {
                    add(value, true, "a store into an erased place");
                }
            }
            syntax::OBJECT_BINDING_PATTERN => {
                let rest = probe.children(id).into_iter().any(|element| {
                    probe.kind_of(element) == Some(syntax::BINDING_ELEMENT)
                        && matches!(probe.child_slots::<4>(element), Some([Some(_), ..]))
                });
                if rest {
                    add(id, false, "an object pattern's rest element");
                }
            }
            _ => {}
        }
    }
    export_observers(snapshot, &mut sites);
    Observers { sites }
}

/// A call's observers: own-key reflection and `JSON.stringify`/`console` over
/// its arguments, `hasOwnProperty` over its receiver, and a native callee's
/// arguments.
fn call_observers(
    snapshot: &SemanticSnapshot,
    probe: &FuncBuilder<'_>,
    id: NodeId,
    add: &mut impl FnMut(NodeId, bool, &'static str),
) {
    let Some(callee) = probe.children(id).first().copied() else {
        return;
    };
    let arguments = probe.arguments_of(id);
    let named = probe.builtin_global_member(callee);
    let (own, deep, what) = match named.as_ref().map(|(g, m)| (g.name.as_str(), m.as_str())) {
        Some((
            "Object",
            "keys"
            | "values"
            | "entries"
            | "getOwnPropertyNames"
            | "getOwnPropertyDescriptors"
            | "assign"
            | "hasOwn",
        )) => (true, false, "`Object`'s own-key reflection"),
        Some(("Reflect", "ownKeys" | "has" | "getOwnPropertyDescriptor")) => {
            (true, false, "`Reflect`'s own-key reflection")
        }
        Some(("JSON", "stringify")) => (true, true, "`JSON.stringify`"),
        _ if probe.console_method(callee).is_some() => (true, true, "`console`"),
        _ => (false, false, ""),
    };
    if own {
        for argument in arguments {
            add(argument, deep, what);
        }
        return;
    }
    if let Some((receiver, member)) = probe.member_access(callee)
        && matches!(member.as_str(), "hasOwnProperty" | "propertyIsEnumerable")
    {
        add(receiver, false, "`hasOwnProperty`");
    }
    let native = snapshot
        .call_targets
        .get(&id)
        .and_then(|target| target.callee)
        .is_some_and(|declaration| snapshot.nodes[declaration.0 as usize].native.is_some());
    if native {
        for argument in arguments {
            add(argument, true, "a native call");
        }
    }
}

/// What the host sees: every exported binding's value, and a function's
/// result. A parameter is the host's value coming in, not a parse's going out;
/// a callback among them is a function type, whose own parameters `reaches`
/// follows.
fn export_observers(snapshot: &SemanticSnapshot, sites: &mut Vec<Observer>) {
    for module in &snapshot.modules {
        for (_, symbol) in &module.exports {
            let Some(record) = snapshot.symbols.get(symbol.0 as usize) else {
                continue;
            };
            for declaration in &record.declarations {
                let Some(ty) = snapshot.node_types.get(declaration).copied() else {
                    continue;
                };
                let operand = match snapshot.types.get(ty.0 as usize).map(|record| &record.kind) {
                    Some(TypeKind::Function(signature)) => snapshot
                        .signatures
                        .get(signature.0 as usize)
                        .map_or(ty, |signature| signature.return_type),
                    _ => ty,
                };
                sites.push(Observer {
                    operand,
                    deep: true,
                    what: "an export",
                });
            }
        }
    }
}

/// Whether `node` names a `const` whose value is built of literals and which
/// the program never lets go of: every other reference reads a primitive
/// member, or hands it to `JSON.stringify` or `console`, neither of which
/// stores it. Such an object was made by the program, never by a parse, and
/// nothing a parse makes can be put inside it, so seeing its keys sees none of
/// a parse's (`startup-builtins` stringifies one and parses its text back).
fn literal_constant(
    probe: &FuncBuilder<'_>,
    references: &rustc_hash::FxHashMap<SymbolId, Vec<NodeId>>,
    node: NodeId,
) -> bool {
    let node = probe.through_parentheses(node);
    if probe.kind_of(node) != Some(syntax::IDENTIFIER) {
        return false;
    }
    let Some(symbol) = probe.node(node).symbol else {
        return false;
    };
    if !probe.immutable_binding(symbol.0) {
        return false;
    }
    let Some(record) = probe.snapshot.symbols.get(symbol.0 as usize) else {
        return false;
    };
    let [declaration] = record.declarations.as_slice() else {
        return false;
    };
    let Some([Some(name), _, _, Some(initializer)]) = probe.child_slots::<4>(*declaration) else {
        return false;
    };
    if probe.kind_of(*declaration) != Some(syntax::VARIABLE_DECLARATION)
        || probe.kind_of(probe.through_parentheses(initializer))
            != Some(syntax::OBJECT_LITERAL_EXPRESSION)
        || !literal_only(probe, initializer)
    {
        return false;
    }
    let primitive = |at: NodeId| {
        probe
            .snapshot
            .node_types
            .get(&at)
            .and_then(|ty| probe.snapshot.types.get(ty.0 as usize))
            .is_some_and(|record| {
                matches!(
                    record.kind,
                    TypeKind::String
                        | TypeKind::Number
                        | TypeKind::Boolean
                        | TypeKind::Literal(_)
                        | TypeKind::Null
                        | TypeKind::Undefined
                )
            })
    };
    references
        .get(&symbol)
        .into_iter()
        .flatten()
        .all(|reference| {
            if *reference == name {
                return true;
            }
            // An argument's parent is its list's call.
            let mut parent = probe.node(*reference).parent;
            while let Some(list) = parent
                && probe.node(list).kind == NodeKind::List
            {
                parent = probe.node(list).parent;
            }
            let Some(parent) = parent else {
                return false;
            };
            match probe.kind_of(parent) {
                Some(syntax::PROPERTY_ACCESS_EXPRESSION) => {
                    probe.children(parent).first() == Some(reference) && primitive(parent)
                }
                Some(syntax::CALL_EXPRESSION) => {
                    let Some(callee) = probe.children(parent).first().copied() else {
                        return false;
                    };
                    callee != *reference
                        && (probe.console_method(callee).is_some()
                            || probe.builtin_global_member(callee).is_some_and(
                                |(global, member)| global.name == "JSON" && member == "stringify",
                            ))
                }
                _ => false,
            }
        })
}

/// An initializer written entirely of literals: strings, numbers, booleans,
/// `null`, and arrays and object literals of those.
fn literal_only(probe: &FuncBuilder<'_>, node: NodeId) -> bool {
    let node = probe.through_parentheses(node);
    match probe.kind_of(node) {
        Some(
            syntax::STRING_LITERAL
            | syntax::NUMERIC_LITERAL
            | syntax::NO_SUBSTITUTION_TEMPLATE_LITERAL
            | syntax::TRUE_KEYWORD
            | syntax::FALSE_KEYWORD
            | syntax::NULL_KEYWORD,
        ) => true,
        Some(syntax::PREFIX_UNARY_EXPRESSION) => probe
            .children(node)
            .last()
            .is_some_and(|operand| probe.kind_of(*operand) == Some(syntax::NUMERIC_LITERAL)),
        Some(syntax::ARRAY_LITERAL_EXPRESSION) => probe
            .children(node)
            .into_iter()
            .all(|element| literal_only(probe, element)),
        Some(syntax::OBJECT_LITERAL_EXPRESSION) => {
            probe.children(node).into_iter().all(|property| {
                probe.kind_of(property) == Some(syntax::PROPERTY_ASSIGNMENT)
                    && probe
                        .children(property)
                        .last()
                        .is_some_and(|value| literal_only(probe, *value))
            })
        }
        _ => false,
    }
}

/// Whether a node's type is `any`, `unknown` or `object`: a place that keeps
/// no layout.
fn erased_place(snapshot: &SemanticSnapshot, node: NodeId) -> bool {
    snapshot.node_types.get(&node).is_some_and(|ty| {
        matches!(
            snapshot.types.get(ty.0 as usize).map(|record| &record.kind),
            Some(TypeKind::Any | TypeKind::Unknown | TypeKind::NonPrimitive)
        )
    })
}

impl Observers {
    /// The first site that can see the keys of an object of a type in
    /// `produced`, by what it is.
    fn first_over(&self, snapshot: &SemanticSnapshot, produced: &[TypeId]) -> Option<&'static str> {
        self.sites
            .iter()
            .find(|site| {
                reaches(
                    snapshot,
                    site.operand,
                    produced,
                    site.deep,
                    &mut rustc_hash::FxHashSet::default(),
                )
            })
            .map(|site| site.what)
    }
}

/// Whether a value of type `ty` may be, or with `deep` may hold, an object a
/// reader made. Conservative wherever the type does not decide: an erased,
/// generic or indexed type may hold anything, and an object type whose
/// property names are among one produced type's accepts that type's objects.
fn reaches(
    snapshot: &SemanticSnapshot,
    ty: TypeId,
    produced: &[TypeId],
    deep: bool,
    seen: &mut rustc_hash::FxHashSet<TypeId>,
) -> bool {
    if produced.contains(&ty) {
        return true;
    }
    if !seen.insert(ty) {
        return false;
    }
    if snapshot.index_signatures.contains_key(&ty) {
        return true;
    }
    let Some(record) = snapshot.types.get(ty.0 as usize) else {
        return true;
    };
    match &record.kind {
        TypeKind::Any
        | TypeKind::Unknown
        | TypeKind::NonPrimitive
        | TypeKind::TypeParameter { .. }
        | TypeKind::Evolving
        | TypeKind::Conditional { .. }
        | TypeKind::IndexedAccess { .. }
        | TypeKind::Structured
        | TypeKind::Unsupported { .. } => true,
        TypeKind::Union(members) | TypeKind::Intersection(members) => members
            .iter()
            .any(|member| reaches(snapshot, *member, produced, deep, seen)),
        TypeKind::Object { properties } => {
            let accepts = produced.iter().any(|made| {
                let Some(TypeKind::Object { properties: made }) = snapshot
                    .types
                    .get(made.0 as usize)
                    .map(|record| &record.kind)
                else {
                    return false;
                };
                properties
                    .iter()
                    .all(|property| made.iter().any(|other| other.name == property.name))
            });
            accepts
                || (deep
                    && (properties
                        .iter()
                        .any(|property| reaches(snapshot, property.ty, produced, deep, seen))
                        || snapshot.type_arguments.get(&ty).is_some_and(|arguments| {
                            arguments
                                .iter()
                                .any(|argument| reaches(snapshot, *argument, produced, deep, seen))
                        })))
        }
        TypeKind::Array(element) => deep && reaches(snapshot, *element, produced, deep, seen),
        TypeKind::Tuple(tuple) => {
            deep && tuple
                .elements
                .iter()
                .any(|element| reaches(snapshot, *element, produced, deep, seen))
        }
        TypeKind::Function(signature) => {
            deep && snapshot
                .signatures
                .get(signature.0 as usize)
                .is_some_and(|signature| {
                    reaches(snapshot, signature.return_type, produced, deep, seen)
                        || signature
                            .parameters
                            .iter()
                            .any(|parameter| reaches(snapshot, parameter.ty, produced, deep, seen))
                })
        }
        TypeKind::Never
        | TypeKind::Void
        | TypeKind::Undefined
        | TypeKind::Null
        | TypeKind::Boolean
        | TypeKind::Number
        | TypeKind::BigInt
        | TypeKind::String
        | TypeKind::Symbol
        | TypeKind::UniqueSymbol
        | TypeKind::Literal(_)
        | TypeKind::TemplateLiteral { .. } => false,
    }
}

/// The keys of an object reader, as `nts_json_key_index` reads them: each one
/// unit of its length, then its units.
fn key_table(members: &[Member]) -> Vec<u16> {
    let mut table = Vec::new();
    for member in members {
        let units: Vec<u16> = member.key.encode_utf16().collect();
        table.push(u16::try_from(units.len()).unwrap_or(u16::MAX));
        table.extend(units);
    }
    table
}

impl FuncBuilder<'_> {
    /// `JSON.parse(text) as T`: the text scanned whole, `T`'s reader called
    /// on it, and the boundary's two errors thrown here.
    pub(super) fn lower_typed_json_parse(
        &mut self,
        id: NodeId,
        parse: TypedParse,
    ) -> Result<ValueId, Diagnostic> {
        let mut produced = Vec::new();
        let reader = self
            .read_plan_object(id, parse.target, &mut produced, &mut Vec::new())
            .map_err(|why| {
                self.unsupported(id, &format!("`JSON.parse(text) as T` where T is {why}"))
            })?;
        if let Some(what) = self.json_observers.first_over(self.snapshot, &produced) {
            return Err(self.unsupported(
                id,
                &format!(
                    "`JSON.parse(text) as T` whose parsed objects' key order or undeclared keys \
                     the program can observe, through {what}"
                ),
            ));
        }
        let text = self.lower_expression(parse.text)?;
        let text = self.coerce(text, &STRING, parse.text)?;
        let origin = self.origin(id);
        let tape_ty = HirType::Managed(ManagedType::Array(Box::new(HirType::NUMBER)));
        let tape = self.runtime_call("nts_json_tape", vec![text], tape_ty, origin.clone());
        let status = self.tape_at(tape, 0.0, &origin);
        let valid = self.read_is(status, 1.0, &origin);
        let (invalid, scanned) = (self.new_block(), self.new_block());
        self.read_branch(valid, scanned, invalid);

        // Not JSON: V8's message for its first error.
        self.switch_to(invalid);
        let message = self.runtime_call(
            "nts_json_syntax_message",
            vec![text, tape],
            STRING,
            origin.clone(),
        );
        self.throw_provided_error_text(id, "SyntaxError", message)?;

        self.switch_to(scanned);
        let one = self.read_number(1.0, &origin);
        let failure = self.push(
            OpKind::ArrayNew {
                length: one,
                fill: ArrayFill::Filled,
            },
            HirType::Managed(ManagedType::Array(Box::new(STRING))),
            origin.clone(),
        );
        let head = self.read_number(HEAD, &origin);
        let ty = HirType::Managed(ManagedType::Object(parse.target));
        let read = self.push(
            OpKind::Call {
                callee: Callee::Direct(reader),
                args: vec![text, tape, head, failure],
                frame: None,
            },
            ty.clone(),
            origin.clone(),
        );
        let missing = self.read_is_null(read, &origin);
        let (mismatched, matched) = (self.new_block(), self.new_block());
        self.read_branch(missing, mismatched, matched);

        // Valid JSON that is not a `T`: where, and what.
        self.switch_to(mismatched);
        let zero = self.read_number(0.0, &origin);
        let detail = self.push(
            OpKind::ArrayGet {
                array: failure,
                index: zero,
                checked: true,
            },
            STRING,
            origin.clone(),
        );
        let prefix = self.push(
            OpKind::ConstString(
                format!(
                    "JSON.parse as {}: ",
                    self.name_of_type(parse.target).map_or_else(
                        || super::describe(self.snapshot, parse.target),
                        str::to_owned
                    )
                )
                .into(),
            ),
            STRING,
            origin.clone(),
        );
        let message = self.push(
            OpKind::Binary {
                op: BinOp::Concat,
                lhs: prefix,
                rhs: detail,
            },
            STRING,
            origin.clone(),
        );
        self.throw_provided_error_text(id, "TypeError", message)?;

        self.switch_to(matched);
        Ok(read)
    }

    /// The reader of an object of plain type `ty`, planned and named, with
    /// every type it reaches recorded in `produced`. `open` is the object
    /// types being planned, to find a recursive one.
    fn read_plan_object(
        &mut self,
        at: NodeId,
        ty: TypeId,
        produced: &mut Vec<TypeId>,
        open: &mut Vec<TypeId>,
    ) -> Result<String, String> {
        let described = || super::describe(self.snapshot, ty);
        if open.contains(&ty) {
            return Err(format!(
                "a recursive type ({}), whose depth the type does not bound",
                described()
            ));
        }
        if super::assertions::is_nominal_class(self, ty) {
            return Err(format!(
                "a class ({}), which JSON never produces an instance of",
                described()
            ));
        }
        if !plain_object(self, ty) {
            return Err(format!("not a plain object type ({})", described()));
        }
        let layout = self
            .layout_of(at, ty)
            .map_err(|refused| format!("an object whose layout is refused: {}", refused.message))?;
        let Some(TypeKind::Object { properties }) = self
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| record.kind.clone())
        else {
            return Err(format!("not an object type ({})", described()));
        };
        open.push(ty);
        if !produced.contains(&ty) {
            produced.push(ty);
        }
        let mut members = Vec::new();
        for property in &properties {
            let PropertyKey::Name(name) = &property.name else {
                open.pop();
                return Err("an object with a symbol or private member".to_owned());
            };
            if property.kind != MemberKind::Field {
                open.pop();
                return Err(format!("an object with the method or accessor `{name}`"));
            }
            let Some(field) = layout.index_of_key(&property.name) else {
                open.pop();
                return Err(format!("an object whose member `{name}` has no field"));
            };
            let field_ty = layout.fields[field as usize].ty.clone();
            let required = !property.optional && !self.read_admits(property.ty, Absence::Undefined);
            let slot = match self.read_plan(at, property.ty, &field_ty, produced, open) {
                Ok(slot) => slot,
                Err(why) => {
                    open.pop();
                    return Err(format!("{why}, in the member `{name}`"));
                }
            };
            if u16::try_from(name.encode_utf16().count()).is_err() {
                open.pop();
                return Err(format!("an object with a key of {} units", name.len()));
            }
            members.push(Member {
                key: name.clone(),
                field,
                ty: field_ty,
                slot,
                required,
            });
        }
        open.pop();
        let name = format!("{}#jsonRead{}", layout.name, ty.0);
        self.request_json_reader(name.clone(), Shape::Object { ty, members }, at);
        Ok(name)
    }

    /// Whether checker type `ty` admits `absence` as one of its members.
    fn read_admits(&self, ty: TypeId, absence: Absence) -> bool {
        match self
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| &record.kind)
        {
            Some(TypeKind::Union(members)) => members
                .iter()
                .any(|member| super::absence_of_member(self.snapshot, *member) == Some(absence)),
            _ => super::absence_of_member(self.snapshot, ty) == Some(absence),
        }
    }

    /// How a value of checker type `ty`, held in a slot of `have`, is read.
    fn read_plan(
        &mut self,
        at: NodeId,
        ty: TypeId,
        have: &HirType,
        produced: &mut Vec<TypeId>,
        open: &mut Vec<TypeId>,
    ) -> Result<Slot, String> {
        let members = match self
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| &record.kind)
        {
            Some(TypeKind::Union(members)) => members.clone(),
            _ => vec![ty],
        };
        let null = members
            .iter()
            .any(|member| super::absence_of_member(self.snapshot, *member) == Some(Absence::Null));
        let present: Vec<TypeId> = members
            .into_iter()
            .filter(|member| super::absence_of_member(self.snapshot, *member).is_none())
            .collect();
        let kind = |member: TypeId| {
            self.snapshot
                .types
                .get(member.0 as usize)
                .map(|record| record.kind.clone())
        };
        let boolean = |kind: Option<TypeKind>| {
            matches!(
                kind,
                Some(
                    TypeKind::Boolean
                        | TypeKind::Literal(nts_semantic_schema::LiteralValue::Boolean(_))
                )
            )
        };
        if null && !(matches!(have, HirType::Erased | HirType::Managed(_))) {
            return Err(format!("a `null` held as {have:?}, which has no null"));
        }
        let read = match present.as_slice() {
            [] if null => Read::Null,
            [] => return Err("a member JSON cannot write".to_owned()),
            many if many.len() > 1 => {
                if many.iter().all(|member| boolean(kind(*member))) {
                    Read::Bool
                } else {
                    return Err(
                        "a union of several kinds, which this reader does not dispatch".to_owned(),
                    );
                }
            }
            [single] => match kind(*single) {
                Some(TypeKind::Number) => Read::Number,
                Some(TypeKind::String) => Read::String,
                Some(TypeKind::Boolean) => Read::Bool,
                Some(TypeKind::Literal(_)) => {
                    return Err(
                        "a literal type, whose membership this reader does not check".to_owned(),
                    );
                }
                Some(TypeKind::Object { .. }) => match self.represent(*single) {
                    Some(HirType::Managed(ManagedType::Object(object))) => {
                        let reader = self.read_plan_object(at, object, produced, open)?;
                        Read::Object { reader, ty: object }
                    }
                    Some(HirType::Managed(ManagedType::Array(slot))) => {
                        self.read_plan_array(at, *single, &slot, produced, open)?
                    }
                    Some(other) => {
                        return Err(format!("an object held as {other:?}"));
                    }
                    None => return Err("an object with no representation".to_owned()),
                },
                Some(TypeKind::Array(_)) => match self.represent(*single) {
                    Some(HirType::Managed(ManagedType::Array(slot))) => {
                        self.read_plan_array(at, *single, &slot, produced, open)?
                    }
                    _ => return Err("an array with no array representation".to_owned()),
                },
                Some(TypeKind::Tuple(_)) => {
                    return Err("a tuple, whose length this reader does not check".to_owned());
                }
                _ => {
                    return Err(format!(
                        "`{}`, which JSON cannot write",
                        super::describe(self.snapshot, *single)
                    ));
                }
            },
            _ => unreachable!("the arms above cover every length"),
        };
        Ok(Slot { read, null })
    }

    /// The reader of an array of checker type `ty`, whose slots are `have`.
    fn read_plan_array(
        &mut self,
        at: NodeId,
        ty: TypeId,
        have: &HirType,
        produced: &mut Vec<TypeId>,
        open: &mut Vec<TypeId>,
    ) -> Result<Read, String> {
        let element_ty = match self
            .snapshot
            .types
            .get(ty.0 as usize)
            .map(|record| &record.kind)
        {
            Some(TypeKind::Array(element)) => Some(*element),
            _ => self
                .snapshot
                .type_arguments
                .get(&ty)
                .and_then(|arguments| arguments.first())
                .copied(),
        }
        .ok_or_else(|| "an array whose element type the checker did not record".to_owned())?;
        let element = self
            .read_plan(at, element_ty, have, produced, open)
            .map_err(|why| format!("{why}, in an array's element"))?;
        let reader = format!("Array<{}>#jsonRead", element.key());
        self.request_json_reader(
            reader.clone(),
            Shape::Array {
                element,
                have: have.clone(),
            },
            at,
        );
        Ok(Read::Array {
            reader,
            have: have.clone(),
        })
    }

    fn request_json_reader(&mut self, name: String, shape: Shape, site: NodeId) {
        if !self.json_readers.iter().any(|reader| reader.name == name) {
            self.json_readers.push(Reader { name, shape, site });
        }
    }

    /// One reader's function: `(text, tape, at, failure) => value`, or null
    /// with the mismatch's message in `failure[0]`.
    fn lower_json_reader(&mut self, reader: &Reader) -> super::Func {
        let origin = self.origin(reader.site);
        let returns = match &reader.shape {
            Shape::Object { ty, .. } => HirType::Managed(ManagedType::Object(*ty)),
            Shape::Array { have, .. } => {
                HirType::Managed(ManagedType::Array(Box::new(have.clone())))
            }
        };
        let tape_ty = HirType::Managed(ManagedType::Array(Box::new(HirType::NUMBER)));
        let failure_ty = HirType::Managed(ManagedType::Array(Box::new(STRING)));
        let param = |name: &str, ty: &HirType| Param {
            name: name.to_owned(),
            shape: ParamShape::Ordinary,
            ty: ty.clone(),
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        };
        let params = vec![
            param("text", &STRING),
            param("tape", &tape_ty),
            param("at", &HirType::NUMBER),
            param("failure", &failure_ty),
        ];
        let text = self.push(OpKind::Param(0), STRING, origin.clone());
        let tape = self.push(OpKind::Param(1), tape_ty, origin.clone());
        let at = self.push(OpKind::Param(2), HirType::NUMBER, origin.clone());
        let failure = self.push(OpKind::Param(3), failure_ty, origin.clone());
        let returns_null = self.push(OpKind::ConstNull, returns.clone(), origin.clone());
        let context = Reading {
            text,
            tape,
            failure,
            returns: returns_null,
        };
        let value = match &reader.shape {
            Shape::Object { ty, members } => {
                self.read_object_body(context, at, *ty, members, &origin)
            }
            Shape::Array { element, have } => {
                self.read_array_body(context, at, element, have, &returns, &origin)
            }
        };
        self.terminate(Terminator::Return(Some(value)));
        self.finish(reader.name.clone(), params, returns, origin, false)
    }

    /// Find each declared key's last value, then read the members in
    /// declaration order into a new object.
    #[allow(clippy::too_many_lines)]
    fn read_object_body(
        &mut self,
        context: Reading,
        at: ValueId,
        ty: TypeId,
        members: &[Member],
        origin: &Origin,
    ) -> ValueId {
        let kind = self.tape_entry(context.tape, at, 0.0, origin);
        let is_object = self.read_is(kind, f64::from(Kind::Object as i32), origin);
        let (walk, wrong) = (self.new_block(), self.new_block());
        self.read_branch(is_object, walk, wrong);
        self.switch_to(wrong);
        self.read_fail(context, at, "an object", origin);

        self.switch_to(walk);
        let end = self.tape_entry(context.tape, at, 1.0, origin);
        let first = self.read_add(at, ENTRY, origin);
        let minus_one = self.read_number(-1.0, origin);
        let zero = self.read_number(0.0, origin);
        // head(j, expect, where of each member)
        let head = self.new_block();
        let head_j = self.push_block_param(head, HirType::NUMBER, origin.clone());
        let head_expect = self.push_block_param(head, HirType::NUMBER, origin.clone());
        let head_found: Vec<ValueId> = members
            .iter()
            .map(|_| self.push_block_param(head, HirType::NUMBER, origin.clone()))
            .collect();
        let mut args = vec![first, zero];
        args.extend(members.iter().map(|_| minus_one));
        self.read_jump(head, args);

        self.switch_to(head);
        let more = self.read_compare(BinOp::Lt, head_j, end, origin);
        let (member_block, done) = (self.new_block(), self.new_block());
        self.read_branch(more, member_block, done);

        // member: which declared key this is, and its value's entry.
        self.switch_to(member_block);
        let keys = self.push(
            OpKind::ConstString(nts_semantic_schema::JsText::from_utf16(key_table(members))),
            STRING,
            origin.clone(),
        );
        let ordinal = self.runtime_call(
            "nts_json_key_index",
            vec![context.text, context.tape, head_j, keys, head_expect],
            HirType::NUMBER,
            origin.clone(),
        );
        let value_at = self.read_add(head_j, ENTRY, origin);
        let next = self.tape_next(context.tape, value_at, origin);
        for (index, _) in members.iter().enumerate() {
            let ordinal_of = f64::from(u32::try_from(index).unwrap_or(u32::MAX));
            let this = self.read_number(ordinal_of, origin);
            let is = self.read_compare(BinOp::Eq, ordinal, this, origin);
            let (matched, otherwise) = (self.new_block(), self.new_block());
            self.read_branch(is, matched, otherwise);
            self.switch_to(matched);
            let expect = self.read_number(ordinal_of + 1.0, origin);
            let mut args = vec![next, expect];
            args.extend(
                head_found
                    .iter()
                    .enumerate()
                    .map(|(other, found)| if other == index { value_at } else { *found }),
            );
            self.read_jump(head, args);
            self.switch_to(otherwise);
        }
        // An undeclared key: skipped, all of it, in one step.
        let mut args = vec![next, head_expect];
        args.extend(head_found.iter().copied());
        self.read_jump(head, args);

        // done: every required member there, then each read in order.
        self.switch_to(done);
        let found: Vec<ValueId> = head_found;
        for (member, found) in members.iter().zip(&found) {
            if !member.required {
                continue;
            }
            let absent = self.read_compare(BinOp::Lt, *found, zero, origin);
            let (missing, present) = (self.new_block(), self.new_block());
            self.read_branch(absent, missing, present);
            self.switch_to(missing);
            let key = self.push(
                OpKind::ConstString(member.key.clone().into()),
                STRING,
                origin.clone(),
            );
            let message = self.runtime_call(
                "nts_json_missing",
                vec![context.text, context.tape, at, key],
                STRING,
                origin.clone(),
            );
            self.read_store_failure(context, message, origin);
            self.terminate(Terminator::Return(Some(context.returns)));
            self.switch_to(present);
        }
        let object_ty = HirType::Managed(ManagedType::Object(ty));
        let object = self.push(
            OpKind::ObjectNew { frame: false },
            object_ty,
            origin.clone(),
        );
        for (member, found) in members.iter().zip(&found) {
            let after = self.new_block();
            if !member.required {
                let absent = self.read_compare(BinOp::Lt, *found, zero, origin);
                let present = self.new_block();
                self.read_branch(absent, after, present);
                self.switch_to(present);
            }
            let value = self.read_value(context, *found, &member.slot, &member.ty, origin);
            self.field_set(object, member.field, value, origin);
            self.read_jump(after, Vec::new());
            self.switch_to(after);
        }
        object
    }

    /// An array's elements, each read into an array of exactly their count.
    fn read_array_body(
        &mut self,
        context: Reading,
        at: ValueId,
        element: &Slot,
        have: &HirType,
        returns: &HirType,
        origin: &Origin,
    ) -> ValueId {
        let kind = self.tape_entry(context.tape, at, 0.0, origin);
        let is_array = self.read_is(kind, f64::from(Kind::Array as i32), origin);
        let (walk, wrong) = (self.new_block(), self.new_block());
        self.read_branch(is_array, walk, wrong);
        self.switch_to(wrong);
        self.read_fail(context, at, "an array", origin);

        self.switch_to(walk);
        let count = self.tape_entry(context.tape, at, 2.0, origin);
        let array = self.push(
            OpKind::ArrayNew {
                length: count,
                fill: ArrayFill::Filled,
            },
            returns.clone(),
            origin.clone(),
        );
        let zero = self.read_number(0.0, origin);
        let first = self.read_add(at, ENTRY, origin);
        let head = self.new_block();
        let head_i = self.push_block_param(head, HirType::NUMBER, origin.clone());
        let head_j = self.push_block_param(head, HirType::NUMBER, origin.clone());
        self.read_jump(head, vec![zero, first]);
        self.switch_to(head);
        let more = self.read_compare(BinOp::Lt, head_i, count, origin);
        let (body, done) = (self.new_block(), self.new_block());
        self.read_branch(more, body, done);
        self.switch_to(body);
        let value = self.read_value(context, head_j, element, have, origin);
        self.push(
            OpKind::ArraySet {
                array,
                index: head_i,
                value,
                checked: false,
            },
            HirType::Void,
            origin.clone(),
        );
        let next = self.tape_next(context.tape, head_j, origin);
        let after = self.read_add(head_i, 1.0, origin);
        self.read_jump(head, vec![after, next]);
        self.switch_to(done);
        array
    }

    /// The value at entry `at`, read as `slot` says and held as `want`, in
    /// the block the builder is left in; a mismatch returns the reader's null.
    fn read_value(
        &mut self,
        context: Reading,
        at: ValueId,
        slot: &Slot,
        want: &HirType,
        origin: &Origin,
    ) -> ValueId {
        let join = self.new_block();
        let joined = self.push_block_param(join, want.clone(), origin.clone());
        let kind = self.tape_entry(context.tape, at, 0.0, origin);
        if slot.null {
            let is_null = self.read_is(kind, f64::from(Kind::Null as i32), origin);
            let (null, other) = (self.new_block(), self.new_block());
            self.read_branch(is_null, null, other);
            self.switch_to(null);
            let null = self.push(OpKind::ConstNull, want.clone(), origin.clone());
            self.read_jump(join, vec![null]);
            self.switch_to(other);
        }
        let expected = slot.expected();
        let read = match &slot.read {
            Read::Null => {
                self.read_fail(context, at, &expected, origin);
                self.switch_to(join);
                return joined;
            }
            Read::Number | Read::String => {
                let (want_kind, helper, ty) = if slot.read == Read::Number {
                    (Kind::Number, "nts_json_number", HirType::NUMBER)
                } else {
                    (Kind::String, "nts_json_string", STRING)
                };
                let is = self.read_is(kind, f64::from(want_kind as i32), origin);
                let (good, bad) = (self.new_block(), self.new_block());
                self.read_branch(is, good, bad);
                self.switch_to(bad);
                self.read_fail(context, at, &expected, origin);
                self.switch_to(good);
                self.runtime_call(
                    helper,
                    vec![context.text, context.tape, at],
                    ty,
                    origin.clone(),
                )
            }
            Read::Bool => {
                let truth = self.new_block();
                let truth_value = self.push_block_param(truth, HirType::Bool, origin.clone());
                let is_true = self.read_is(kind, f64::from(Kind::True as i32), origin);
                let (yes, not_true) = (self.new_block(), self.new_block());
                self.read_branch(is_true, yes, not_true);
                self.switch_to(yes);
                let t = self.push(OpKind::ConstBool(true), HirType::Bool, origin.clone());
                self.read_jump(truth, vec![t]);
                self.switch_to(not_true);
                let is_false = self.read_is(kind, f64::from(Kind::False as i32), origin);
                let (no, bad) = (self.new_block(), self.new_block());
                self.read_branch(is_false, no, bad);
                self.switch_to(bad);
                self.read_fail(context, at, &expected, origin);
                self.switch_to(no);
                let f = self.push(OpKind::ConstBool(false), HirType::Bool, origin.clone());
                self.read_jump(truth, vec![f]);
                self.switch_to(truth);
                truth_value
            }
            Read::Object { reader, ty } => {
                let ty = HirType::Managed(ManagedType::Object(*ty));
                self.read_nested(context, at, reader, ty, origin)
            }
            Read::Array { reader, have } => {
                let ty = HirType::Managed(ManagedType::Array(Box::new(have.clone())));
                self.read_nested(context, at, reader, ty, origin)
            }
        };
        let held = self.read_hold(read, want, origin);
        self.read_jump(join, vec![held]);
        self.switch_to(join);
        joined
    }

    /// A nested reader's value, or this reader's null where it answered one.
    fn read_nested(
        &mut self,
        context: Reading,
        at: ValueId,
        reader: &str,
        ty: HirType,
        origin: &Origin,
    ) -> ValueId {
        let value = self.push(
            OpKind::Call {
                callee: Callee::Direct(reader.to_owned()),
                args: vec![context.text, context.tape, at, context.failure],
                frame: None,
            },
            ty,
            origin.clone(),
        );
        let failed = self.read_is_null(value, origin);
        let (passed, up) = (self.new_block(), self.new_block());
        self.read_branch(failed, up, passed);
        self.switch_to(up);
        self.terminate(Terminator::Return(Some(context.returns)));
        self.switch_to(passed);
        value
    }

    /// `value` in a slot of `want`: as it is, or erased for an optional or
    /// mixed member.
    fn read_hold(&mut self, value: ValueId, want: &HirType, origin: &Origin) -> ValueId {
        let have = self.values[value.0 as usize].ty.clone();
        if have == *want {
            return value;
        }
        match want {
            HirType::Erased => self.push(
                OpKind::Erase {
                    value,
                    absent: crate::hir::Absent::Impossible,
                    slots: crate::hir::Absent::Impossible,
                },
                HirType::Erased,
                origin.clone(),
            ),
            HirType::Float { .. } | HirType::Int { .. } => {
                self.push(OpKind::Convert(value), want.clone(), origin.clone())
            }
            _ => value,
        }
    }

    /// `message` into the parse's `failure` cell.
    fn read_store_failure(&mut self, context: Reading, message: ValueId, origin: &Origin) {
        let zero = self.read_number(0.0, origin);
        self.push(
            OpKind::ArraySet {
                array: context.failure,
                index: zero,
                value: message,
                checked: true,
            },
            HirType::Void,
            origin.clone(),
        );
    }

    /// A mismatch at entry `at`: the message stored, and the reader's null
    /// returned. Leaves the builder in no block.
    fn read_fail(&mut self, context: Reading, at: ValueId, expected: &str, origin: &Origin) {
        let expected = self.push(
            OpKind::ConstString(expected.to_owned().into()),
            STRING,
            origin.clone(),
        );
        let message = self.runtime_call(
            "nts_json_mismatch",
            vec![context.text, context.tape, at, expected],
            STRING,
            origin.clone(),
        );
        self.read_store_failure(context, message, origin);
        self.terminate(Terminator::Return(Some(context.returns)));
    }

    /// The entry after the value at `at`: a container's end, or the next
    /// three.
    fn tape_next(&mut self, tape: ValueId, at: ValueId, origin: &Origin) -> ValueId {
        let kind = self.tape_entry(tape, at, 0.0, origin);
        // Objects and arrays are the kinds below 2.5.
        let bound = self.read_number(f64::from(Kind::Array as i32) + 0.5, origin);
        let container = self.read_compare(BinOp::Lt, kind, bound, origin);
        let join = self.new_block();
        let joined = self.push_block_param(join, HirType::NUMBER, origin.clone());
        let (skip, step) = (self.new_block(), self.new_block());
        self.read_branch(container, skip, step);
        self.switch_to(skip);
        let end = self.tape_entry(tape, at, 1.0, origin);
        self.read_jump(join, vec![end]);
        self.switch_to(step);
        let after = self.read_add(at, ENTRY, origin);
        self.read_jump(join, vec![after]);
        self.switch_to(join);
        joined
    }

    fn tape_at(&mut self, tape: ValueId, index: f64, origin: &Origin) -> ValueId {
        let index = self.read_number(index, origin);
        self.push(
            OpKind::ArrayGet {
                array: tape,
                index,
                checked: true,
            },
            HirType::NUMBER,
            origin.clone(),
        )
    }

    /// `tape[at + offset]`.
    fn tape_entry(&mut self, tape: ValueId, at: ValueId, offset: f64, origin: &Origin) -> ValueId {
        let index = if offset == 0.0 {
            at
        } else {
            self.read_add(at, offset, origin)
        };
        self.push(
            OpKind::ArrayGet {
                array: tape,
                index,
                checked: true,
            },
            HirType::NUMBER,
            origin.clone(),
        )
    }

    fn read_is(&mut self, value: ValueId, wanted: f64, origin: &Origin) -> ValueId {
        let wanted = self.read_number(wanted, origin);
        self.read_compare(BinOp::Eq, value, wanted, origin)
    }

    fn read_is_null(&mut self, value: ValueId, origin: &Origin) -> ValueId {
        let ty = self.values[value.0 as usize].ty.clone();
        let null = self.push(OpKind::ConstNull, ty, origin.clone());
        self.read_compare(BinOp::Eq, value, null, origin)
    }

    fn read_compare(&mut self, op: BinOp, lhs: ValueId, rhs: ValueId, origin: &Origin) -> ValueId {
        self.push(
            OpKind::Binary { op, lhs, rhs },
            HirType::Bool,
            origin.clone(),
        )
    }

    fn read_number(&mut self, value: f64, origin: &Origin) -> ValueId {
        self.push(OpKind::ConstFloat(value), HirType::NUMBER, origin.clone())
    }

    fn read_add(&mut self, lhs: ValueId, rhs: f64, origin: &Origin) -> ValueId {
        let rhs = self.read_number(rhs, origin);
        self.push(
            OpKind::Binary {
                op: BinOp::Add,
                lhs,
                rhs,
            },
            HirType::NUMBER,
            origin.clone(),
        )
    }

    fn read_branch(
        &mut self,
        cond: ValueId,
        then_target: super::BlockId,
        else_target: super::BlockId,
    ) {
        self.terminate(Terminator::Branch {
            cond,
            then_target,
            then_args: Vec::new(),
            else_target,
            else_args: Vec::new(),
        });
    }

    fn read_jump(&mut self, target: super::BlockId, args: Vec<ValueId>) {
        self.terminate(Terminator::Jump { target, args });
    }
}
