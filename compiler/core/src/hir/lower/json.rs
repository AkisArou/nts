//! `JSON.stringify(x)` where the program states `x`'s type: a writer the
//! compiler generates for that type, as ordinary HIR, so every backend gets it
//! without a backend change (the JSON design, `~/.cache/nts-scratch/json/`,
//! section 5.1).
//!
//! The specification's `SerializeJSONProperty` asks of each value what it is,
//! at run time. A typed program has already answered: a `number` field is
//! written as digits, a `string` field is quoted, an object field is its own
//! type's writer. So each type gets one function, `(out, value) => out`, that
//! appends the value's text to `out` -- the keys as constants the compiler
//! quoted, `{"id":` and `,"name":`, and each member by its type's rule. A
//! nested object is a call to its type's writer, an array a loop over its
//! element's. `rc` and `destinations` then make each concatenation an append
//! in place (`nts_str_append_number`, `nts_str_append_json_quoted`), so the
//! output is one string written once.
//!
//! - **A number** is its shortest digits (`Number::toString`, which already
//!   writes `-0` as `0`), and `null` where it is not finite.
//! - **A string** is quoted by [`QUOTE`]: the runtime's escape kernel where the
//!   backend provides one (`nts_json_quote` on C and LLVM), and a generated
//!   loop over its code units where it does not -- the JVM and Wasm, until
//!   their kernels exist.
//! - **A reference that may be `null`** writes `null` for one.
//! - **An object's members** are its own enumerable string keys, in the order
//!   `Object.keys` answers them ([`FuncBuilder::enumerable_fields`] and
//!   `property_order`): array-index keys ascending, then the layout's order,
//!   which is the order the program's literals write. A method is a function,
//!   which JSON omits, and so is a function-typed field.
//!
//! **Refused by name, each because its answer is not a fact of the type:**
//!
//! - a type whose literals write its keys in more than one order
//!   (`WrittenOrders::disputed`): an object's keys are in insertion order, and
//!   the layout holds one order;
//! - an optional property, which an object gains where it is assigned and so
//!   in the order it is assigned;
//! - a value that may be `undefined`, which JSON omits in an object and writes
//!   as `null` in an array -- and a `string | undefined`'s null pointer cannot
//!   be told from a `string | null`'s by its representation;
//! - a recursive type, whose cycles `JSON.stringify` must detect;
//! - `toJSON` and a getter, which are calls; an erased value; a replacer or an
//!   indent; `Map`, `Set`, `Date` and the other builtins with a JSON form of
//!   their own.
//!
//! **One writer per checker type**, not per layout: two types sharing a layout
//! can differ in what a null pointer in a field means (`string | null` against
//! `string`), and the writer's null tests come from its own type's properties.
//!
//! **Known gap, shared with `Object.keys`:** a literal with a spread or a
//! computed key says nothing about its order (`literal_field_names`), so an
//! object built that way in a different order than the layout's is written in
//! the layout's, as `Object.keys` answers it.

use std::fmt::Write as _;

use nts_diagnostics::Diagnostic;
use nts_semantic_schema::{Library, MemberKind, NodeId, Origin, TypeId, TypeKind, syntax};

use super::{
    Absent, BinOp, Callee, Enumerated, Facts, FuncBuilder, HirType, Layout, LayoutCollector,
    Lowered, LoweringSnapshot, ManagedType, NO_FOREIGN, OpKind, Param, ParamShape, Shared,
    Terminator, ValueId,
};

const STRING: HirType = HirType::Managed(ManagedType::String);

/// The writer that quotes a string: `"` + its units, escaped + `"`.
const QUOTE: &str = "String#json";

/// How a value that is there is written.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Value {
    /// Its shortest digits, or `null` where it is not finite.
    Number,
    /// `true` or `false`.
    Bool,
    /// Quoted, by [`QUOTE`].
    String,
    /// By the dispatcher for its static type, which takes it erased and calls
    /// the writer of whichever owner its layout is.
    Object { dispatcher: String },
    /// By its array writer.
    Array { writer: String },
}

/// How a value is held, which says what its absences are: what decides
/// whether it is written as itself, as `null`, or -- in an object -- not at all.
#[derive(Debug, Clone, PartialEq, Eq)]
enum Held {
    /// As itself, never absent.
    Present,
    /// A reference whose null pointer is `null`, written `null`.
    OrNull,
    /// A reference whose null pointer is `undefined`: omitted from an object,
    /// `null` in an array.
    OrUndefined,
    /// Erased, as an optional property is: the tag `undefined` is as
    /// [`Held::OrUndefined`]'s null, `null` (where the type admits it) is
    /// written `null`, and any other is the value, unerased to `have`.
    Erased { have: HirType, nullable: bool },
}

/// How one value is written: what it is, and how it is held.
#[derive(Debug, Clone, PartialEq, Eq)]
struct Plan {
    value: Value,
    held: Held,
}

impl Plan {
    const fn present(value: Value) -> Self {
        Self {
            value,
            held: Held::Present,
        }
    }

    /// Whether the value may be `undefined`, which an object omits.
    const fn omittable(&self) -> bool {
        matches!(self.held, Held::OrUndefined | Held::Erased { .. })
    }

    /// A spelling unique to the value's writing, which names an array writer
    /// by its element.
    fn key(&self) -> String {
        let name = match &self.value {
            Value::Number => "number",
            Value::Bool => "boolean",
            Value::String => "string",
            Value::Object { dispatcher: writer } | Value::Array { writer } => writer.as_str(),
        };
        match &self.held {
            Held::Present => name.to_owned(),
            Held::OrNull => format!("{name} | null"),
            Held::OrUndefined => format!("{name} | undefined"),
            Held::Erased { nullable: true, .. } => format!("{name} | null | undefined?"),
            Held::Erased {
                nullable: false, ..
            } => format!("{name} | undefined?"),
        }
    }
}

/// Whether an `undefined` value can still reach a write: an array's element,
/// which writes it `null`, or a member, which tested it and omitted it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Undefined {
    WritesNull,
    Tested,
}

/// Whether a member has been written yet, where the writer knows.
#[derive(Debug, Clone, Copy)]
enum Wrote {
    No,
    Yes,
    /// Decided at run time, by an omittable member before: this `Bool`.
    Flag(ValueId),
}

/// A writer some call names: the function, and what it writes.
#[derive(Debug, Clone)]
pub(super) struct Writer {
    pub name: String,
    shape: Shape,
    /// The call whose planning asked, for the origin the function carries.
    site: NodeId,
}

#[derive(Debug, Clone)]
enum Shape {
    /// `{` each member `}`, of an object laid out as owner `ty`.
    Object { ty: TypeId, members: Vec<Member> },
    /// An erased object of a static type: its layout tested against each
    /// owner that reaches the type, and that owner's writer called.
    Dispatch { owners: Vec<(TypeId, String)> },
    /// `[` each element `,`-separated `]`, of an array whose slots are `have`.
    Array { element: Plan, have: HirType },
    /// A string, quoted.
    Quote,
}

/// One member an object writer writes.
#[derive(Debug, Clone)]
struct Member {
    /// `"name":`, quoted here once.
    key: String,
    /// The slot it is read from, and the slot's type.
    field: u32,
    ty: HirType,
    plan: Plan,
}

/// Build every writer the lowered bodies named, once each.
///
/// Planning a call names every writer its type reaches, so building one never
/// names another that is not already here.
pub(super) fn lower_writers(
    layout_collector: &mut LayoutCollector,
    snapshot: &LoweringSnapshot<'_>,
    shared: &Shared,
    lowered: &mut Lowered,
    wanted: &mut std::collections::BTreeSet<usize>,
) {
    let mut made = rustc_hash::FxHashSet::default();
    for writer in std::mem::take(&mut lowered.arrivals.json_writers) {
        if !made.insert(writer.name.clone()) {
            continue;
        }
        let mut builder = shared.builder(
            snapshot,
            NO_FOREIGN.get_or_init(rustc_hash::FxHashMap::default),
            super::Copy::default(),
        );
        let func = builder.lower_json_writer(&writer);
        lowered.program.funcs.push(func);
        builder.harvest(wanted, &mut lowered.arrivals);
        layout_collector.collect(&mut lowered.program, builder.layouts.into_layouts());
    }
}

/// `name` as a JSON string: `QuoteJSONString` over a Rust string, which has no
/// unpaired surrogate to escape.
fn quoted(name: &str) -> String {
    let mut out = String::with_capacity(name.len() + 2);
    out.push('"');
    for c in name.chars() {
        match c {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\t' => out.push_str("\\t"),
            '\n' => out.push_str("\\n"),
            '\u{c}' => out.push_str("\\f"),
            '\r' => out.push_str("\\r"),
            c if u32::from(c) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", u32::from(c));
            }
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

/// What each ASCII unit is escaped as, by its code: `0` where it is written as
/// itself, `u` where it is `\u00XX`, else the letter after the backslash.
fn ascii_escapes() -> String {
    (0u8..128)
        .map(|unit| match unit {
            0x08 => 'b',
            0x09 => 't',
            0x0a => 'n',
            0x0c => 'f',
            0x0d => 'r',
            0x22 => '"',
            0x5c => '\\',
            unit if unit < 0x20 => 'u',
            _ => '0',
        })
        .collect()
}

/// Whether two owners' writers write alike: the same keys, slots and plans.
fn same_members(a: &[Member], b: &[Member]) -> bool {
    a.len() == b.len()
        && a.iter()
            .zip(b)
            .all(|(a, b)| a.key == b.key && a.field == b.field && a.plan == b.plan)
}

impl FuncBuilder<'_> {
    /// Whether `callee` is `JSON.stringify` of the global the language's own
    /// library declares; a `JSON` the program declares is its own.
    pub(super) fn is_json_stringify(&self, callee: NodeId) -> bool {
        let Some((object, member)) = self.member_access(callee) else {
            return false;
        };
        member == "stringify"
            && self.kind_of(object) == Some(syntax::IDENTIFIER)
            && self
                .node(object)
                .symbol
                .and_then(|symbol| self.snapshot.symbols.get(symbol.0 as usize))
                .is_some_and(|record| record.name == "JSON" && record.library == Some(Library::Es))
    }

    /// `JSON.stringify(value)`: the value's writer, appending onto `""`.
    pub(super) fn lower_json_stringify(
        &mut self,
        id: NodeId,
        arguments: &[NodeId],
    ) -> Result<ValueId, Diagnostic> {
        let [argument] = arguments else {
            return Err(self.unsupported(id, "`JSON.stringify` with a replacer or an indent"));
        };
        let value = self.lower_expression(*argument)?;
        let have = self.values[value.0 as usize].ty.clone();
        let plan = match self.snapshot.node_types.get(argument).copied() {
            Some(ty) => self.json_value(id, &have, ty, &mut Vec::new()),
            None => Err("a value the checker gave no type".to_owned()),
        };
        let plan = plan
            .and_then(|plan| {
                if plan.omittable() {
                    Err(
                        "a value that may be `undefined`, for which `JSON.stringify` answers \
                         `undefined` rather than a string"
                            .to_owned(),
                    )
                } else {
                    Ok(plan)
                }
            })
            .map_err(|why| self.unsupported(id, &format!("`JSON.stringify` of {why}")))?;
        let origin = self.origin(id);
        let empty = self.push(OpKind::ConstString(String::new()), STRING, origin.clone());
        Ok(self.json_write_held(empty, value, &plan, Undefined::WritesNull, &origin))
    }

    /// How a value of checker type `ty`, held as `have`, is written, naming
    /// the writers that takes; or the noun phrase for why it cannot be.
    /// `open` is the object types being planned, to find a recursive one.
    fn json_value(
        &mut self,
        at: NodeId,
        have: &HirType,
        ty: TypeId,
        open: &mut Vec<TypeId>,
    ) -> Result<Plan, String> {
        match have {
            // A number held as an integer is converted where it is written.
            HirType::Float { bits: 64 } | HirType::Int { .. } => Ok(Plan::present(Value::Number)),
            HirType::Bool => Ok(Plan::present(Value::Bool)),
            HirType::Managed(ManagedType::String) => {
                let held = self.json_reference(ty)?;
                self.request_json_writer(QUOTE.to_owned(), Shape::Quote, at);
                Ok(Plan {
                    value: Value::String,
                    held,
                })
            }
            HirType::Managed(ManagedType::Object(object)) => {
                let held = self.json_reference(ty)?;
                let dispatcher = self.json_dispatch(at, *object, open)?;
                Ok(Plan {
                    value: Value::Object { dispatcher },
                    held,
                })
            }
            HirType::Managed(ManagedType::Array(slot)) => {
                let held = self.json_reference(ty)?;
                let Some(element_ty) = self.json_element_type(ty) else {
                    return Err("an array whose element type the checker did not record".to_owned());
                };
                let element = self.json_value(at, slot, element_ty, open)?;
                let writer = format!("Array<{}>#json", element.key());
                self.request_json_writer(
                    writer.clone(),
                    Shape::Array {
                        element,
                        have: (**slot).clone(),
                    },
                    at,
                );
                Ok(Plan {
                    value: Value::Array { writer },
                    held,
                })
            }
            HirType::Erased => self.json_erased(at, ty, open),
            HirType::Managed(ManagedType::Map(..) | ManagedType::Table(..)) => {
                Err("a `Map`".to_owned())
            }
            HirType::Managed(ManagedType::Set(_)) => Err("a `Set`".to_owned()),
            HirType::Managed(ManagedType::Date) => {
                Err("a `Date`, which `JSON.stringify` writes through its `toJSON`".to_owned())
            }
            HirType::BigInt | HirType::Managed(ManagedType::BoxedBigInt) => {
                Err("a `bigint`, which `JSON.stringify` throws on".to_owned())
            }
            _ => Err(format!("a value held as {have:?}")),
        }
    }

    /// What a null pointer of checker type `ty` means: `null`, `undefined`,
    /// or nothing. A reference that may be both is held erased, so a null
    /// pointer that could be either does not arise; refused where it would.
    fn json_reference(&self, ty: TypeId) -> Result<Held, String> {
        match super::absent_of_result(self.snapshot, ty) {
            Absent::Null => Ok(Held::OrNull),
            Absent::Undefined => Ok(Held::OrUndefined),
            Absent::Impossible if super::admits_absence(self.snapshot, ty) => Err(
                "a reference that may be `null` or `undefined`, which one null pointer cannot \
                 tell apart"
                    .to_owned(),
            ),
            Absent::Impossible => Ok(Held::Present),
        }
    }

    /// An erased value of checker type `ty`: `T`, `T | null`, `T | undefined`
    /// or all three, where every `T` is held alike -- an optional property,
    /// or a union of absences with one kind. Its tag says which it is.
    fn json_erased(
        &mut self,
        at: NodeId,
        ty: TypeId,
        open: &mut Vec<TypeId>,
    ) -> Result<Plan, String> {
        let members = match self.snapshot.types.get(ty.0 as usize).map(|r| &r.kind) {
            Some(TypeKind::Union(members)) => members.clone(),
            _ => vec![ty],
        };
        let nullable = members.iter().any(|member| {
            super::absence_of_member(self.snapshot, *member) == Some(super::Absence::Null)
        });
        let present: Vec<TypeId> = members
            .into_iter()
            .filter(|member| super::absence_of_member(self.snapshot, *member).is_none())
            .collect();
        let several = || {
            "an erased value -- `unknown`, `any`, or a union of several kinds -- which needs the \
             writer for erased values"
                .to_owned()
        };
        let (&first, rest) = present.split_first().ok_or_else(several)?;
        let have = self.represent(first).ok_or_else(several)?;
        if have == HirType::Erased
            || rest
                .iter()
                .any(|member| self.represent(*member) != Some(have.clone()))
        {
            return Err(several());
        }
        let inner = self.json_value(at, &have, first, open)?;
        if inner.held != Held::Present {
            return Err(several());
        }
        Ok(Plan {
            value: inner.value,
            held: Held::Erased { have, nullable },
        })
    }

    /// The element type of an array type, or of the array a `T[] | null` holds.
    fn json_element_type(&self, ty: TypeId) -> Option<TypeId> {
        let kind = |ty: TypeId| self.snapshot.types.get(ty.0 as usize).map(|r| &r.kind);
        let array = match kind(ty)? {
            TypeKind::Union(members) => *members
                .iter()
                .find(|member| super::absence_of_member(self.snapshot, **member).is_none())?,
            _ => ty,
        };
        match kind(array)? {
            TypeKind::Array(element) => Some(*element),
            _ => self
                .snapshot
                .type_arguments
                .get(&array)
                .and_then(|arguments| arguments.first())
                .copied(),
        }
    }

    /// The dispatcher for a value of static object type `face`, planned and
    /// named: one arm per owner the source flow proves reaches the type
    /// (`Families::structural_owners`), each the writer of that owner's own
    /// layout -- an object's own properties are its layout's, whatever the
    /// static type says, which is a lower bound. An object no arm matches
    /// stops by name rather than be read at a layout it does not have.
    fn json_dispatch(
        &mut self,
        at: NodeId,
        face: TypeId,
        open: &mut Vec<TypeId>,
    ) -> Result<String, String> {
        let is_object = matches!(
            self.snapshot.types.get(face.0 as usize).map(|r| &r.kind),
            Some(TypeKind::Object { .. })
        );
        if !is_object {
            return Err("a function or a value with no object type".to_owned());
        }
        // The type's own layout first: a literal written where the type is
        // wanted is laid out as the type, interface or not.
        let mut owners = vec![face];
        let mut reaching = self.hierarchy.access_families.structural_owners(self, face);
        reaching.sort_unstable();
        owners.extend(reaching.into_iter().filter(|owner| *owner != face));
        let mut arms: Vec<(TypeId, String, Layout, Vec<Member>)> = Vec::new();
        for owner in owners {
            let (writer, layout, members) = self.json_owner(at, owner, open)?;
            // Two owners laid out alike are one layout once objects merge, and
            // a layout test cannot tell them apart; they must write alike.
            if let Some((other, ..)) = arms.iter().find(|(_, _, laid, written)| {
                laid.same_shape(&layout.fields, &layout.methods, layout.base)
                    && !same_members(written, &members)
            }) {
                return Err(format!(
                    "objects of two types laid out alike that write differently ({} and {})",
                    super::describe(self.snapshot, *other),
                    super::describe(self.snapshot, owner)
                ));
            }
            arms.push((owner, writer, layout, members));
        }
        let name = format!(
            "{}#jsonOf{}",
            self.layout_of(at, face)
                .map_or_else(|_| "Object".to_owned(), |l| l.name),
            face.0
        );
        self.request_json_writer(
            name.clone(),
            Shape::Dispatch {
                owners: arms
                    .into_iter()
                    .map(|(owner, writer, ..)| (owner, writer))
                    .collect(),
            },
            at,
        );
        Ok(name)
    }

    /// The writer of an object laid out as `owner`, planned and named, with
    /// the layout and members it writes.
    fn json_owner(
        &mut self,
        at: NodeId,
        owner: TypeId,
        open: &mut Vec<TypeId>,
    ) -> Result<(String, Layout, Vec<Member>), String> {
        if open.contains(&owner) {
            return Err("a recursive type, whose cycles `JSON.stringify` must detect".to_owned());
        }
        let layout = self
            .layout_of(at, owner)
            .map_err(|refused| format!("an object whose layout is refused: {}", refused.message))?;
        if crate::hir::is_tuple_layout_name(&layout.name) {
            return Err("a tuple, which JSON writes as an array".to_owned());
        }
        open.push(owner);
        let members = self.json_members(at, owner, &layout, open);
        open.pop();
        let members = members?;
        let writer = format!("{}#json{}", layout.name, owner.0);
        self.request_json_writer(
            writer.clone(),
            Shape::Object {
                ty: owner,
                members: members.clone(),
            },
            at,
        );
        Ok((writer, layout, members))
    }

    /// An object's members in the order `JSON.stringify` writes them.
    fn json_members(
        &mut self,
        at: NodeId,
        object: TypeId,
        layout: &Layout,
        open: &mut Vec<TypeId>,
    ) -> Result<Vec<Member>, String> {
        if super::interfaces::property(self.snapshot, object, "toJSON").is_some() {
            return Err(
                "an object with a `toJSON` member, which `JSON.stringify` calls".to_owned(),
            );
        }
        let mut names: Vec<String> = layout.fields.iter().map(|f| f.name.clone()).collect();
        names.sort();
        if self.written_order.disputed.contains(&names) {
            return Err(format!(
                "an object whose literals write its keys `{}` in more than one order, where one \
                 writer has one",
                names.join("`, `")
            ));
        }
        let enumerable = self.enumerable_fields(object, layout);
        // Literals agreeing on the whole set is enough for a type whose every
        // property is always there. One with an optional property is also
        // built by literals that omit it, each a subset in its own order.
        let mut literal_order_checked = false;
        let mut members = Vec::new();
        for (index, _) in super::property_order(enumerable.iter().map(|(_, name)| name.as_str())) {
            let (enumerated, name) = &enumerable[index];
            let slot = match enumerated {
                Enumerated::Slot(slot) => *slot,
                // A function, which JSON omits.
                Enumerated::Method => continue,
                Enumerated::Getter => {
                    return Err(format!(
                        "an object with a getter `{name}`, which `JSON.stringify` calls"
                    ));
                }
            };
            let Some(property) = super::interfaces::property(self.snapshot, object, name) else {
                return Err(format!("the member `{name}`, which has no property type"));
            };
            if property.kind != MemberKind::Field {
                return Err(format!("the member `{name}`, which is not a field"));
            }
            if self.added_keys.deleted.contains(name) {
                return Err(format!(
                    "the property `{name}`, which the program deletes, and a write after that \
                     puts last"
                ));
            }
            let constructed = self.defined_at_construction(property)
                || property.declaration.is_some_and(|declaration| {
                    self.kind_of(declaration) == Some(syntax::PARAMETER)
                });
            if property.optional && !constructed {
                if self.added_keys.unknown {
                    return Err(format!(
                        "the optional property `{name}`, where the program adds properties it does \
                         not name (`Object.defineProperty`, `Reflect.set`)"
                    ));
                }
                if self.added_keys.assigned.contains(name) {
                    return Err(format!(
                        "the optional property `{name}`, which the program assigns where it may \
                         be absent, and JavaScript then puts it last"
                    ));
                }
                if !literal_order_checked {
                    self.json_literal_orders(layout)?;
                    literal_order_checked = true;
                }
            }
            let property_ty = property.ty;
            let is_function = matches!(
                self.snapshot
                    .types
                    .get(property_ty.0 as usize)
                    .map(|r| &r.kind),
                Some(TypeKind::Function(_))
            );
            if is_function {
                continue;
            }
            let field = &layout.fields[slot];
            let ty = field.ty.clone();
            let plan = self
                .json_value(at, &ty, property_ty, open)
                .map_err(|why| format!("{why}, in the member `{name}`"))?;
            members.push(Member {
                key: format!("{}:", quoted(name)),
                field: u32::try_from(slot).unwrap_or(u32::MAX),
                ty,
                plan,
            });
        }
        Ok(members)
    }

    /// Every literal writing a subset of the layout's keys writes them in the
    /// layout's order, so an object a literal made without its optional
    /// properties holds the rest as the writer writes them. By name, over
    /// every literal in the program: a literal of another type with the same
    /// names counts too, which refuses more than it must and never less.
    fn json_literal_orders(&self, layout: &Layout) -> Result<(), String> {
        let position = |name: &str| layout.fields.iter().position(|field| field.name == name);
        let within = |names: &[String]| names.iter().all(|name| position(name).is_some());
        if let Some(disputed) = self
            .written_order
            .disputed
            .iter()
            .find(|names| within(names))
        {
            return Err(format!(
                "an object whose literals write its keys `{}` in more than one order",
                disputed.join("`, `")
            ));
        }
        for (names, written) in &self.written_order.agreed {
            if !within(names) {
                continue;
            }
            // Array-index keys come first whatever the order, so only the
            // others have one to keep.
            let order: Vec<usize> = super::property_order(written.iter().map(String::as_str))
                .into_iter()
                .filter(|(_, name)| name.parse::<u32>().map_or(true, |i| i.to_string() != *name))
                .filter_map(|(_, name)| position(&name))
                .collect();
            if order.windows(2).any(|pair| pair[0] > pair[1]) {
                return Err(format!(
                    "an object some literal writes as `{}`, in an order other than its layout's",
                    written.join("`, `")
                ));
            }
        }
        Ok(())
    }

    fn request_json_writer(&mut self, name: String, shape: Shape, site: NodeId) {
        if !self.json_writers.iter().any(|writer| writer.name == name) {
            self.json_writers.push(Writer { name, shape, site });
        }
    }

    /// Append `value`, which is there, written as `how` says, onto `out`: the
    /// string that follows, in the block the builder is left in.
    fn json_write(
        &mut self,
        out: ValueId,
        value: ValueId,
        how: &Value,
        origin: &Origin,
    ) -> ValueId {
        match how {
            Value::Number => {
                let value = if matches!(self.values[value.0 as usize].ty, HirType::Int { .. }) {
                    self.push(OpKind::Convert(value), HirType::NUMBER, origin.clone())
                } else {
                    value
                };
                let finite =
                    self.runtime_call("nts_is_finite", vec![value], HirType::Bool, origin.clone());
                self.json_either(
                    out,
                    finite,
                    origin,
                    |this, out| {
                        let digits = this.runtime_call(
                            "nts_number_to_string",
                            vec![value],
                            STRING,
                            origin.clone(),
                        );
                        this.json_concat(out, digits, origin)
                    },
                    |this, out| this.json_text(out, "null", origin),
                )
            }
            Value::Bool => self.json_either(
                out,
                value,
                origin,
                |this, out| this.json_text(out, "true", origin),
                |this, out| this.json_text(out, "false", origin),
            ),
            Value::String => self.json_call(QUOTE, out, value, origin),
            Value::Object { dispatcher } => {
                let erased = if self.values[value.0 as usize].ty == HirType::Erased {
                    value
                } else {
                    self.push(
                        OpKind::Erase {
                            value,
                            absent: Absent::Impossible,
                            slots: Absent::Impossible,
                        },
                        HirType::Erased,
                        origin.clone(),
                    )
                };
                self.json_call(dispatcher, out, erased, origin)
            }
            Value::Array { writer } => self.json_call(writer, out, value, origin),
        }
    }

    /// Append `value`, held as `plan` says, onto `out`: `null` for an
    /// absence it writes, else the value. `undefined` says whether an
    /// `undefined` is still possible here -- an array's element, written
    /// `null` -- or was tested before, by a member that omits it.
    fn json_write_held(
        &mut self,
        out: ValueId,
        value: ValueId,
        plan: &Plan,
        undefined: Undefined,
        origin: &Origin,
    ) -> ValueId {
        let null_writes = |this: &mut Self, out: ValueId| this.json_text(out, "null", origin);
        match &plan.held {
            Held::Present => self.json_write(out, value, &plan.value, origin),
            Held::OrUndefined if undefined == Undefined::Tested => {
                self.json_write(out, value, &plan.value, origin)
            }
            Held::OrNull | Held::OrUndefined => {
                let absent = self.json_is_null(value, origin);
                self.json_either(out, absent, origin, null_writes, |this, out| {
                    this.json_write(out, value, &plan.value, origin)
                })
            }
            Held::Erased { have, nullable } => {
                let present = |this: &mut Self, out: ValueId| {
                    // An object's dispatcher takes it erased, as it is held.
                    let read = if matches!(plan.value, Value::Object { .. }) {
                        value
                    } else {
                        this.push(OpKind::unerase(value), have.clone(), origin.clone())
                    };
                    this.json_write(out, read, &plan.value, origin)
                };
                let unwritten = |this: &mut Self, out: ValueId| {
                    if *nullable {
                        let null = this.json_has_tag(value, super::super::tags::NULL, origin);
                        this.json_either(out, null, origin, null_writes, present)
                    } else {
                        present(this, out)
                    }
                };
                if undefined == Undefined::Tested {
                    unwritten(self, out)
                } else {
                    let missing = self.json_has_tag(value, super::super::tags::UNDEFINED, origin);
                    self.json_either(out, missing, origin, null_writes, unwritten)
                }
            }
        }
    }

    /// One member: its key and value, after a `,` where one was written
    /// before; nothing at all where it is omittable and `undefined`. `pending`
    /// is constant text not yet appended, so a key joins the punctuation
    /// before it.
    fn json_member(
        &mut self,
        out: ValueId,
        pending: &mut String,
        wrote: Wrote,
        object: ValueId,
        member: &Member,
        origin: &Origin,
    ) -> (ValueId, Wrote) {
        let field = self.push(
            OpKind::FieldGet {
                object,
                field: member.field,
            },
            member.ty.clone(),
            origin.clone(),
        );
        let keyed = |this: &mut Self, out: ValueId, pending: &mut String, wrote: Wrote| {
            let out = match wrote {
                Wrote::No => out,
                Wrote::Yes => {
                    pending.push(',');
                    out
                }
                Wrote::Flag(flag) => {
                    let out = this.json_flush(out, pending, origin);
                    this.json_either(
                        out,
                        flag,
                        origin,
                        |this, out| this.json_text(out, ",", origin),
                        |_, out| out,
                    )
                }
            };
            pending.push_str(&member.key);
            let out = this.json_flush(out, pending, origin);
            this.json_write_held(out, field, &member.plan, Undefined::Tested, origin)
        };
        if !member.plan.omittable() {
            let out = keyed(self, out, pending, wrote);
            return (out, Wrote::Yes);
        }
        let out = self.json_flush(out, pending, origin);
        let missing = match &member.plan.held {
            Held::Erased { .. } => self.json_has_tag(field, super::super::tags::UNDEFINED, origin),
            _ => self.json_is_null(field, origin),
        };
        let (written, omitted, join) = (self.new_block(), self.new_block(), self.new_block());
        let joined = self.push_block_param(join, STRING, origin.clone());
        let flag = (!matches!(wrote, Wrote::Yes))
            .then(|| self.push_block_param(join, HirType::Bool, origin.clone()));
        self.json_branch(missing, (omitted, Vec::new()), (written, Vec::new()));
        self.switch_to(written);
        let out_written = keyed(self, out, &mut String::new(), wrote);
        let mut args = vec![out_written];
        if flag.is_some() {
            args.push(self.push(OpKind::ConstBool(true), HirType::Bool, origin.clone()));
        }
        self.json_jump(join, args);
        self.switch_to(omitted);
        let mut args = vec![out];
        match wrote {
            Wrote::Yes => {}
            Wrote::No => {
                args.push(self.push(OpKind::ConstBool(false), HirType::Bool, origin.clone()));
            }
            Wrote::Flag(flag) => args.push(flag),
        }
        self.json_jump(join, args);
        self.switch_to(join);
        (joined, flag.map_or(Wrote::Yes, Wrote::Flag))
    }

    /// `out` with the pending constant text appended, which is then empty.
    fn json_flush(&mut self, out: ValueId, pending: &mut String, origin: &Origin) -> ValueId {
        if pending.is_empty() {
            return out;
        }
        let text = std::mem::take(pending);
        self.json_text(out, &text, origin)
    }

    /// Whether a reference is its null pointer.
    fn json_is_null(&mut self, value: ValueId, origin: &Origin) -> ValueId {
        let ty = self.values[value.0 as usize].ty.clone();
        let null = self.push(OpKind::ConstNull, ty, origin.clone());
        self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: value,
                rhs: null,
            },
            HirType::Bool,
            origin.clone(),
        )
    }

    /// Whether an erased value carries `tag`.
    fn json_has_tag(&mut self, value: ValueId, tag: u32, origin: &Origin) -> ValueId {
        let unsigned = HirType::Int {
            bits: 32,
            signed: false,
        };
        let held = self.push(OpKind::TagOf { value }, unsigned.clone(), origin.clone());
        let wanted = self.push(OpKind::ConstInt(i128::from(tag)), unsigned, origin.clone());
        self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: held,
                rhs: wanted,
            },
            HirType::Bool,
            origin.clone(),
        )
    }

    /// `cond ? then(out) : otherwise(out)`, joined: the string either wrote.
    fn json_either(
        &mut self,
        out: ValueId,
        cond: ValueId,
        origin: &Origin,
        then: impl FnOnce(&mut Self, ValueId) -> ValueId,
        otherwise: impl FnOnce(&mut Self, ValueId) -> ValueId,
    ) -> ValueId {
        let (yes, no, join) = (self.new_block(), self.new_block(), self.new_block());
        let joined = self.push_block_param(join, STRING, origin.clone());
        self.json_branch(cond, (yes, Vec::new()), (no, Vec::new()));
        self.switch_to(yes);
        let written = then(self, out);
        self.json_jump(join, vec![written]);
        self.switch_to(no);
        let written = otherwise(self, out);
        self.json_jump(join, vec![written]);
        self.switch_to(join);
        joined
    }

    fn json_branch(
        &mut self,
        cond: ValueId,
        (then_target, then_args): (super::BlockId, Vec<ValueId>),
        (else_target, else_args): (super::BlockId, Vec<ValueId>),
    ) {
        self.terminate(Terminator::Branch {
            cond,
            then_target,
            then_args,
            else_target,
            else_args,
        });
    }

    fn json_jump(&mut self, target: super::BlockId, args: Vec<ValueId>) {
        self.terminate(Terminator::Jump { target, args });
    }

    fn json_call(
        &mut self,
        writer: &str,
        out: ValueId,
        value: ValueId,
        origin: &Origin,
    ) -> ValueId {
        self.push(
            OpKind::Call {
                callee: Callee::Direct(writer.to_owned()),
                args: vec![out, value],
                frame: None,
            },
            STRING,
            origin.clone(),
        )
    }

    fn json_concat(&mut self, lhs: ValueId, rhs: ValueId, origin: &Origin) -> ValueId {
        self.push(
            OpKind::Binary {
                op: BinOp::Concat,
                lhs,
                rhs,
            },
            STRING,
            origin.clone(),
        )
    }

    fn json_text(&mut self, out: ValueId, text: &str, origin: &Origin) -> ValueId {
        let text = self.push(OpKind::ConstString(text.to_owned()), STRING, origin.clone());
        self.json_concat(out, text, origin)
    }

    fn json_number(&mut self, value: f64, origin: &Origin) -> ValueId {
        self.push(OpKind::ConstFloat(value), HirType::NUMBER, origin.clone())
    }

    fn json_compare(&mut self, op: BinOp, lhs: ValueId, rhs: f64, origin: &Origin) -> ValueId {
        let rhs = self.json_number(rhs, origin);
        self.push(
            OpKind::Binary { op, lhs, rhs },
            HirType::Bool,
            origin.clone(),
        )
    }

    fn json_add(&mut self, lhs: ValueId, rhs: f64, origin: &Origin) -> ValueId {
        let rhs = self.json_number(rhs, origin);
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

    fn json_unit(&mut self, string: ValueId, index: ValueId, origin: &Origin) -> ValueId {
        self.push(
            OpKind::StringUnitAt {
                string,
                index,
                checked: true,
            },
            HirType::NUMBER,
            origin.clone(),
        )
    }

    /// One writer's function: `(out, value) => out`, with `value` written.
    fn lower_json_writer(&mut self, writer: &Writer) -> super::Func {
        let origin = self.origin(writer.site);
        let value_ty = match &writer.shape {
            Shape::Object { ty, .. } => HirType::Managed(ManagedType::Object(*ty)),
            Shape::Array { have, .. } => {
                HirType::Managed(ManagedType::Array(Box::new(have.clone())))
            }
            Shape::Dispatch { .. } => HirType::Erased,
            Shape::Quote => STRING,
        };
        let param = |name: &str, ty: &HirType| Param {
            name: name.to_owned(),
            shape: ParamShape::Ordinary,
            ty: ty.clone(),
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        };
        let params = vec![param("out", &STRING), param("value", &value_ty)];
        let out = self.push(OpKind::Param(0), STRING, origin.clone());
        let value = self.push(OpKind::Param(1), value_ty, origin.clone());
        let written = match &writer.shape {
            Shape::Object { members, .. } => self.json_object_body(out, value, members, &origin),
            Shape::Array { element, have } => {
                self.json_array_body(out, value, element, have, &origin)
            }
            Shape::Dispatch { owners } => self.json_dispatch_body(out, value, owners, &origin),
            Shape::Quote => self.json_quote_body(out, value, &origin),
        };
        self.terminate(Terminator::Return(Some(written)));
        self.finish(writer.name.clone(), params, STRING, origin, false)
    }

    fn json_object_body(
        &mut self,
        out: ValueId,
        object: ValueId,
        members: &[Member],
        origin: &Origin,
    ) -> ValueId {
        let mut pending = String::from("{");
        let (mut out, mut wrote) = (out, Wrote::No);
        for member in members {
            (out, wrote) = self.json_member(out, &mut pending, wrote, object, member, origin);
        }
        pending.push('}');
        self.json_flush(out, &mut pending, origin)
    }

    /// Each owner's layout tested in turn, and the first that matches written
    /// by its own writer; none matching stops by name.
    fn json_dispatch_body(
        &mut self,
        out: ValueId,
        erased: ValueId,
        owners: &[(TypeId, String)],
        origin: &Origin,
    ) -> ValueId {
        let end = self.new_block();
        let ended = self.push_block_param(end, STRING, origin.clone());
        for (owner, writer) in owners {
            let is = self.push(
                OpKind::InstanceOf {
                    value: erased,
                    classes: vec![*owner],
                    by_layout: true,
                },
                HirType::Bool,
                origin.clone(),
            );
            let (arm, next) = (self.new_block(), self.new_block());
            self.json_branch(is, (arm, Vec::new()), (next, Vec::new()));
            self.switch_to(arm);
            let object = self.push(
                OpKind::unerase(erased),
                HirType::Managed(ManagedType::Object(*owner)),
                origin.clone(),
            );
            let written = self.json_call(writer, out, object, origin);
            self.json_jump(end, vec![written]);
            self.switch_to(next);
        }
        let what = self.push(
            OpKind::ConstString(
                "`JSON.stringify` of an object whose layout none of its type's writers is for"
                    .to_owned(),
            ),
            STRING,
            origin.clone(),
        );
        self.runtime_call("nts_refused", vec![what], HirType::Void, origin.clone());
        self.terminate(Terminator::Unreachable);
        self.switch_to(end);
        ended
    }

    /// `[`, each element with a `,` before all but the first, `]`.
    fn json_array_body(
        &mut self,
        out: ValueId,
        array: ValueId,
        element: &Plan,
        have: &HirType,
        origin: &Origin,
    ) -> ValueId {
        let opened = self.json_text(out, "[", origin);
        let length = self.push(OpKind::Length(array), HirType::NUMBER, origin.clone());
        let zero = self.json_number(0.0, origin);
        let (head, body, comma, item, done) = (
            self.new_block(),
            self.new_block(),
            self.new_block(),
            self.new_block(),
            self.new_block(),
        );
        let string_and_index = |this: &mut Self, block| {
            (
                this.push_block_param(block, STRING, origin.clone()),
                this.push_block_param(block, HirType::NUMBER, origin.clone()),
            )
        };
        let (head_out, head_at) = string_and_index(self, head);
        let (body_out, body_at) = string_and_index(self, body);
        let (comma_out, comma_at) = string_and_index(self, comma);
        let (item_out, item_at) = string_and_index(self, item);
        let done_out = self.push_block_param(done, STRING, origin.clone());
        self.json_jump(head, vec![opened, zero]);

        self.switch_to(head);
        let more = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: head_at,
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.json_branch(
            more,
            (body, vec![head_out, head_at]),
            (done, vec![head_out]),
        );

        self.switch_to(body);
        let first = self.json_compare(BinOp::Eq, body_at, 0.0, origin);
        self.json_branch(
            first,
            (item, vec![body_out, body_at]),
            (comma, vec![body_out, body_at]),
        );

        self.switch_to(comma);
        let separated = self.json_text(comma_out, ",", origin);
        self.json_jump(item, vec![separated, comma_at]);

        self.switch_to(item);
        let slot = self.push(
            OpKind::ArrayGet {
                array,
                index: item_at,
                checked: true,
            },
            have.clone(),
            origin.clone(),
        );
        let written = self.json_write_held(item_out, slot, element, Undefined::WritesNull, origin);
        let next = self.json_add(item_at, 1.0, origin);
        self.json_jump(head, vec![written, next]);

        self.switch_to(done);
        self.json_text(done_out, "]", origin)
    }

    /// `QuoteJSONString`: the runtime's kernel where the backend provides
    /// one, else a loop over the code units that copies each one that needs
    /// no escape and escapes the rest -- `\"`, `\\`, the five short forms,
    /// `\u00XX` for another control, `\uXXXX` for a surrogate with no
    /// partner. The test is `Provided`, which each backend's preparation
    /// answers, so the arm a backend cannot run is pruned before it emits.
    #[allow(clippy::too_many_lines)]
    fn json_quote_body(&mut self, out: ValueId, string: ValueId, origin: &Origin) -> ValueId {
        // Every block but the first, named by what it does with the unit
        // `u` at `i - 1` (`j` is the index after it).
        let kernel = self.new_block();
        let fallback = self.new_block();
        let end = self.new_block();
        let ended = self.push_block_param(end, STRING, origin.clone());

        let provided = self.push(
            OpKind::Provided("nts_json_quote".to_owned()),
            STRING,
            origin.clone(),
        );
        let function = self.push(
            OpKind::ConstString("function".to_owned()),
            STRING,
            origin.clone(),
        );
        let has = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: provided,
                rhs: function,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.json_branch(has, (kernel, Vec::new()), (fallback, Vec::new()));

        self.switch_to(kernel);
        let text = self.runtime_call("nts_json_quote", vec![string], STRING, origin.clone());
        let quoted = self.json_concat(out, text, origin);
        self.json_jump(end, vec![quoted]);

        // The fallback's blocks, each with its parameters: the output so far
        // `o`, the index after the unit `j`, the unit `u`, and in `pair` the
        // unit after it `v`; `head` and `ascii` also start the walk.
        self.switch_to(fallback);
        let opened = self.json_text(out, "\"", origin);
        let length = self.push(OpKind::Length(string), HirType::NUMBER, origin.clone());
        let zero = self.json_number(0.0, origin);
        let table = self.push(OpKind::ConstString(ascii_escapes()), STRING, origin.clone());
        let block = |this: &mut Self, count: usize| {
            let block = this.new_block();
            let mut params = vec![this.push_block_param(block, STRING, origin.clone())];
            for _ in 1..count {
                params.push(this.push_block_param(block, HirType::NUMBER, origin.clone()));
            }
            (block, params)
        };
        let (head, head_p) = block(self, 2);
        let (unit, unit_p) = block(self, 2);
        let (ascii, ascii_p) = block(self, 3);
        let (plain, plain_p) = block(self, 3);
        let (escaped, escaped_p) = block(self, 4);
        let (short, short_p) = block(self, 3);
        let (control, control_p) = block(self, 3);
        let (wide, wide_p) = block(self, 3);
        let (surrogate, surrogate_p) = block(self, 3);
        let (high, high_p) = block(self, 3);
        let (next, next_p) = block(self, 3);
        let (pair, pair_p) = block(self, 4);
        let (lone, lone_p) = block(self, 3);
        let (hex, hex_p) = block(self, 3);
        let (closed, closed_p) = block(self, 1);
        self.json_jump(head, vec![opened, zero]);

        // head(o, i): more units, or close.
        self.switch_to(head);
        let more = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: head_p[1],
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.json_branch(more, (unit, head_p.clone()), (closed, vec![head_p[0]]));

        // unit(o, i): read it; ASCII is decided by the table.
        self.switch_to(unit);
        let u = self.json_unit(string, unit_p[1], origin);
        let j = self.json_add(unit_p[1], 1.0, origin);
        let is_ascii = self.json_compare(BinOp::Lt, u, 128.0, origin);
        let args = vec![unit_p[0], j, u];
        self.json_branch(is_ascii, (ascii, args.clone()), (wide, args));

        // ascii(o, j, u): `0` in the table is the unit itself.
        self.switch_to(ascii);
        let k = self.json_unit(table, ascii_p[2], origin);
        let is_plain = self.json_compare(BinOp::Eq, k, f64::from(b'0'), origin);
        let mut with_k = ascii_p.clone();
        with_k.push(k);
        self.json_branch(is_plain, (plain, ascii_p), (escaped, with_k));

        // plain(o, j, u): the unit as it is.
        self.switch_to(plain);
        let copied = self.runtime_call(
            "nts_string_from_char_code",
            vec![plain_p[2]],
            STRING,
            origin.clone(),
        );
        let written = self.json_concat(plain_p[0], copied, origin);
        self.json_jump(head, vec![written, plain_p[1]]);

        // escaped(o, j, u, k): `u` in the table is `\u00XX`.
        self.switch_to(escaped);
        let is_hex = self.json_compare(BinOp::Eq, escaped_p[3], f64::from(b'u'), origin);
        self.json_branch(
            is_hex,
            (control, escaped_p[..3].to_vec()),
            (short, vec![escaped_p[0], escaped_p[1], escaped_p[3]]),
        );

        // short(o, j, k): `\` and the table's letter.
        self.switch_to(short);
        let slashed = self.json_text(short_p[0], "\\", origin);
        let letter = self.runtime_call(
            "nts_string_from_char_code",
            vec![short_p[2]],
            STRING,
            origin.clone(),
        );
        let written = self.json_concat(slashed, letter, origin);
        self.json_jump(head, vec![written, short_p[1]]);

        // control(o, j, u): `\u00` and two digits, one of them a `0` below 16.
        self.switch_to(control);
        let below_sixteen = self.json_compare(BinOp::Lt, control_p[2], 16.0, origin);
        let (one_digit, two_digits) = (self.new_block(), self.new_block());
        self.json_branch(
            below_sixteen,
            (one_digit, Vec::new()),
            (two_digits, Vec::new()),
        );
        self.switch_to(one_digit);
        let padded = self.json_text(control_p[0], "\\u000", origin);
        self.json_jump(hex, vec![padded, control_p[1], control_p[2]]);
        self.switch_to(two_digits);
        let padded = self.json_text(control_p[0], "\\u00", origin);
        self.json_jump(hex, vec![padded, control_p[1], control_p[2]]);

        // wide(o, j, u): only a surrogate can need an escape.
        self.switch_to(wide);
        let below = self.json_compare(BinOp::Lt, wide_p[2], 55296.0, origin);
        let in_range = self.new_block();
        self.json_branch(below, (plain, wide_p.clone()), (in_range, Vec::new()));
        self.switch_to(in_range);
        let above = self.json_compare(BinOp::Gt, wide_p[2], 57343.0, origin);
        self.json_branch(above, (plain, wide_p.clone()), (surrogate, wide_p));

        // surrogate(o, j, u): a low one here has no high one before it.
        self.switch_to(surrogate);
        let is_high = self.json_compare(BinOp::Lt, surrogate_p[2], 56320.0, origin);
        self.json_branch(is_high, (high, surrogate_p.clone()), (lone, surrogate_p));

        // high(o, j, u): a partner needs a next unit.
        self.switch_to(high);
        let has_next = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: high_p[1],
                rhs: length,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.json_branch(has_next, (next, high_p.clone()), (lone, high_p));

        // next(o, j, u): the next unit is the partner when it is a low one.
        self.switch_to(next);
        let v = self.json_unit(string, next_p[1], origin);
        let low_enough = self.json_compare(BinOp::Ge, v, 56320.0, origin);
        let at_most = self.new_block();
        self.json_branch(low_enough, (at_most, Vec::new()), (lone, next_p.clone()));
        self.switch_to(at_most);
        let is_low = self.json_compare(BinOp::Le, v, 57343.0, origin);
        let mut with_v = next_p.clone();
        with_v.push(v);
        self.json_branch(is_low, (pair, with_v), (lone, next_p));

        // pair(o, j, u, v): both units as they are, and past the second.
        self.switch_to(pair);
        let first = self.runtime_call(
            "nts_string_from_char_code",
            vec![pair_p[2]],
            STRING,
            origin.clone(),
        );
        let written = self.json_concat(pair_p[0], first, origin);
        let second = self.runtime_call(
            "nts_string_from_char_code",
            vec![pair_p[3]],
            STRING,
            origin.clone(),
        );
        let written = self.json_concat(written, second, origin);
        let after = self.json_add(pair_p[1], 1.0, origin);
        self.json_jump(head, vec![written, after]);

        // lone(o, j, u): `\u` and four digits, which a surrogate always has.
        self.switch_to(lone);
        let slashed = self.json_text(lone_p[0], "\\u", origin);
        self.json_jump(hex, vec![slashed, lone_p[1], lone_p[2]]);

        // hex(o, j, u): the unit's lowercase hexadecimal digits.
        self.switch_to(hex);
        let sixteen = self.json_number(16.0, origin);
        let digits = self.runtime_call(
            "nts_number_to_string_radix",
            vec![hex_p[2], sixteen],
            STRING,
            origin.clone(),
        );
        let written = self.json_concat(hex_p[0], digits, origin);
        self.json_jump(head, vec![written, hex_p[1]]);

        // closed(o): the closing quote.
        self.switch_to(closed);
        let written = self.json_text(closed_p[0], "\"", origin);
        self.json_jump(end, vec![written]);

        self.switch_to(end);
        ended
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_key_is_quoted_as_json_quotes_it() {
        assert_eq!(quoted("id"), "\"id\"");
        assert_eq!(quoted("a\"b\\c"), "\"a\\\"b\\\\c\"");
        assert_eq!(quoted("\n\u{1}é"), "\"\\n\\u0001é\"");
    }

    #[test]
    fn the_ascii_table_marks_what_needs_an_escape() {
        let table: Vec<char> = ascii_escapes().chars().collect();
        assert_eq!(table.len(), 128);
        assert_eq!(table[0x0a], 'n');
        assert_eq!(table[0x01], 'u');
        assert_eq!(table[0x0b], 'u');
        assert_eq!(table[usize::from(b'"')], '"');
        assert_eq!(table[usize::from(b'\\')], '\\');
        assert_eq!(table[usize::from(b'a')], '0');
        assert_eq!(table[0x7f], '0');
    }
}
