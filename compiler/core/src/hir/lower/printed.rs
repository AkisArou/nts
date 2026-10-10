//! How an object prints: JavaScript's `ToString` of an object, decided once per
//! layout ([`Program::printed`]) and read by the runtime off the descriptor
//! (`NtsDescriptor.to_string`) for `String(o)`, `${o}` and an array's text.
//!
//! JavaScript asks the prototype chain for `toString`, so the answer is a fact
//! about the type:
//! - a class's own `toString(): string`, the implementation its chain resolves
//!   to;
//! - the `Error` family's `Error.prototype.toString`, which this compiler writes
//!   per layout ([`error_rule_name`]) over that layout's own `name` and
//!   `message` -- per layout and not once, because `Error`, `TypeError` and
//!   `RangeError` can be three layouts with no base relation, and one function
//!   typed to take an `Error` would be a type confusion every backend but the
//!   JVM's verifier lets pass;
//! - `"[object Object]"` for an object whose chain adds nothing, which is not a
//!   fallback but that object's text;
//! - a function's text for a closure or a class token;
//! - and a refusal, by name at run time, where nothing here says how: a tuple,
//!   a frame, an object literal whose own `toString` is a member this compiler
//!   cannot call through the descriptor, and a layout whose types would print
//!   differently from one another.
//!
//! **Per layout, because a descriptor is.** Structurally identical types share
//! a layout, and a value of any of them carries its descriptor; where they
//! would not print alike, which is printed cannot be told from the descriptor,
//! so the layout refuses rather than print one type's text for another's value.

use std::collections::BTreeMap;

use nts_diagnostics::Location;
use nts_semantic_schema::{GeneratedReason, Origin, SemanticSnapshot, TypeId, TypeKind};

use super::{
    BinOp, Block, BlockId, Facts, Func, Hierarchy, HirType, Layout, ManagedType, Op, OpKind, Param,
    ParamShape, Program, Terminator, ValueId,
};
use crate::hir::Printed;

/// Decide [`Program::printed`] for every layout, and write the error rule for
/// each error layout that prints by it.
pub(super) fn decide(snapshot: &SemanticSnapshot, hierarchy: &Hierarchy, program: &mut Program) {
    let mut printed = BTreeMap::new();
    let mut written = Vec::new();
    for layout in &program.layouts {
        let mut answer = printing(snapshot, hierarchy, program, layout);
        if answer == Printed::By(error_rule_name(layout)) {
            match error_to_string(layout) {
                Some(func) => written.push(func),
                None => answer = Printed::Refused,
            }
        }
        printed.insert(layout.name.clone(), answer);
    }
    program.funcs.extend(written);
    program.printed = printed;
}

/// The compiler's `Error.prototype.toString` for one error layout.
fn error_rule_name(layout: &Layout) -> String {
    format!("{}@toString", layout.name)
}

/// How one layout's objects print. See the module documentation.
fn printing(
    snapshot: &SemanticSnapshot,
    hierarchy: &Hierarchy,
    program: &Program,
    layout: &Layout,
) -> Printed {
    if layout
        .types
        .iter()
        .any(|ty| super::super::is_closure_type(*ty))
    {
        return Printed::Function;
    }
    if layout.types.iter().any(|ty| is_a_class_token(*ty)) {
        return Printed::Function;
    }
    if super::super::is_tuple_layout_name(&layout.name) {
        return Printed::Refused;
    }
    let answers: Vec<Printed> = layout
        .types
        .iter()
        .map(|ty| {
            if hierarchy.is_an_error(*ty) {
                return own_to_string(hierarchy, program, *ty)
                    .unwrap_or_else(|| Printed::By(error_rule_name(layout)));
            }
            if ty.0 >= super::super::SYNTHETIC_TYPE_FLOOR {
                // A frame, a boxed record, a foreign class: nothing a program
                // prints, and nothing here says how.
                return Printed::Refused;
            }
            if hierarchy.name.contains_key(ty) {
                return own_to_string(hierarchy, program, *ty).unwrap_or(Printed::Object);
            }
            if declares_how_it_prints(snapshot, *ty) {
                return Printed::Refused;
            }
            Printed::Object
        })
        .collect();
    match answers.split_first() {
        Some((first, rest)) if rest.iter().all(|answer| answer == first) => first.clone(),
        _ => Printed::Refused,
    }
}

/// A class's own `toString`, the implementation its chain resolves to, where it
/// declares one: `Printed::By` it if it is compiled and takes the object and
/// answers a string, and refused otherwise. `None` where the chain declares
/// none.
fn own_to_string(hierarchy: &Hierarchy, program: &Program, ty: TypeId) -> Option<Printed> {
    let declaring = hierarchy.declaring(ty, "toString")?;
    let owner = hierarchy.name.get(&declaring)?;
    let name = format!("{owner}#toString");
    let callable = program.funcs.iter().any(|func| {
        func.name == name
            && func.params.len() == 1
            && func.return_type == HirType::Managed(ManagedType::String)
    });
    Some(if callable {
        Printed::By(name)
    } else {
        Printed::Refused
    })
}

/// Whether an object type says something about how it prints that a
/// descriptor cannot carry: its own `toString` member (an object literal's,
/// which is a field or a table method of that literal and not a function the
/// runtime can name), or a `Symbol.toStringTag`, which changes
/// `"[object Object]"` itself.
fn declares_how_it_prints(snapshot: &SemanticSnapshot, ty: TypeId) -> bool {
    let Some(TypeKind::Object { properties }) =
        snapshot.types.get(ty.0 as usize).map(|record| &record.kind)
    else {
        return false;
    };
    properties
        .iter()
        .any(|property| property.name == "toString" || property.name.contains("@toStringTag"))
}

/// A class used as a value: a program class's token or a provided one's.
const fn is_a_class_token(ty: TypeId) -> bool {
    (ty.0 >= super::super::SYNTHETIC_CLASS_TOKENS && ty.0 < super::super::PROVIDED_ERRORS)
        || ty.0 >= super::super::CONSTRUCTOR_TOKENS
}

/// `Error.prototype.toString`, over one error layout's own fields:
///
/// ```text
/// name === "" ? message : message === "" ? name : name + ": " + message
/// ```
///
/// `name` and `message` are always strings here -- the constructor writes
/// both -- so the specification's `undefined` cases do not arise. `None` where
/// the layout does not lay them out as strings, and those errors refuse.
fn error_to_string(layout: &Layout) -> Option<Func> {
    let string = HirType::Managed(ManagedType::String);
    let field = |named: &str| {
        layout
            .fields
            .iter()
            .position(|field| field.name == named && field.ty == string)
            .and_then(|at| u32::try_from(at).ok())
    };
    let (name_at, message_at) = (field("name")?, field("message")?);
    let this_ty = HirType::Managed(ManagedType::Object(*layout.types.first()?));
    let mut body = Body::new();
    // b0: read both, and test the name.
    let this = body.push(OpKind::Param(0), this_ty.clone());
    let read = |body: &mut Body, field| {
        body.push(
            OpKind::FieldGet {
                object: this,
                field,
            },
            string.clone(),
        )
    };
    let name = read(&mut body, name_at);
    let message = read(&mut body, message_at);
    let zero = body.push(OpKind::ConstFloat(0.0), HirType::NUMBER);
    let unnamed = body.is_empty(name, zero);
    let b0 = span(this, unnamed);
    // b2: test the message.
    let no_message = body.is_empty(message, zero);
    let b2 = span(ValueId(unnamed.0 + 1), no_message);
    // b4: both.
    let colon = body.push(OpKind::ConstString(": ".to_owned()), string.clone());
    let named = body.concat(name, colon);
    let text = body.concat(named, message);
    let b4 = span(colon, text);
    let block = |ops: Vec<ValueId>, terminator: Terminator| Block {
        params: Vec::new(),
        ops,
        terminator,
    };
    let blocks = vec![
        block(b0, branch(unnamed, 1, 2)),
        block(Vec::new(), Terminator::Return(Some(message))),
        block(b2, branch(no_message, 3, 4)),
        block(Vec::new(), Terminator::Return(Some(name))),
        block(b4, Terminator::Return(Some(text))),
    ];
    let origin = body.origin.clone();
    Some(Func {
        name: error_rule_name(layout),
        params: vec![Param {
            name: "this".to_owned(),
            shape: ParamShape::Ordinary,
            ty: this_ty,
            origin: origin.clone(),
            known: Facts::TOP,
            written: None,
        }],
        return_type: string,
        values: body.values,
        blocks,
        origin,
        exported: false,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
        written_return: None,
        written_return_elements: Vec::new(),
    })
}

/// A two-way branch between blocks by index, with no arguments.
const fn branch(cond: ValueId, then: u32, otherwise: u32) -> Terminator {
    Terminator::Branch {
        cond,
        then_target: BlockId(then),
        then_args: Vec::new(),
        else_target: BlockId(otherwise),
        else_args: Vec::new(),
    }
}

/// The values of a function written here rather than lowered from source, in
/// the order they are pushed, all at one generated origin.
struct Body {
    values: Vec<Op>,
    origin: Origin,
}

impl Body {
    fn new() -> Self {
        Self {
            values: Vec::new(),
            origin: Origin::generated(
                Location {
                    file: nts_diagnostics::SourceId(0),
                    span: nts_diagnostics::Span::new(0, 0),
                },
                GeneratedReason::AbiProjection,
            ),
        }
    }

    fn push(&mut self, kind: OpKind, ty: HirType) -> ValueId {
        let id = ValueId(u32::try_from(self.values.len()).unwrap_or(u32::MAX));
        self.values.push(Op {
            kind,
            ty,
            origin: self.origin.clone(),
        });
        id
    }

    /// Whether a string is `""`: its length against a zero already pushed.
    fn is_empty(&mut self, text: ValueId, zero: ValueId) -> ValueId {
        let length = self.push(OpKind::Length(text), HirType::NUMBER);
        self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: length,
                rhs: zero,
            },
            HirType::Bool,
        )
    }

    fn concat(&mut self, lhs: ValueId, rhs: ValueId) -> ValueId {
        self.push(
            OpKind::Binary {
                op: BinOp::Concat,
                lhs,
                rhs,
            },
            HirType::Managed(ManagedType::String),
        )
    }
}

/// The ids from `from` to `to`: a block's ops, when they were pushed in order.
fn span(from: ValueId, to: ValueId) -> Vec<ValueId> {
    (from.0..=to.0).map(ValueId).collect()
}

/// `String(o)` where the type settles how `o` prints: the conversion the
/// lowering routed through the runtime -- `nts_value_to_string` of an `Erase`
/// -- made its direct form.
///
/// - a call of the one function every layout the type can be prints by: a
///   class's `toString`, or an error layout's rule;
/// - the constant text, where that is `"[object Object]"`;
/// - the typed join, for an array of numbers or of strings.
///
/// Only where every layout a value of the static type can be prints alike: a
/// class and everything that extends it. An interface or a literal's type can
/// be any object of its shape, so its conversion stays the runtime's, which
/// asks the object. The table ([`Program::printed`]) is the one authority for
/// both, so the direct form and the runtime's cannot print differently -- and
/// the runtime one is a load, an indirect call and the erasing, where this is
/// a call or nothing.
pub(super) fn devirtualize(
    snapshot: &SemanticSnapshot,
    hierarchy: &Hierarchy,
    program: &mut Program,
) {
    let printed = program.printed.clone();
    let layouts = program.layouts.clone();
    for func in &mut program.funcs {
        let rewrites: Vec<(usize, Direct)> = func
            .values
            .iter()
            .enumerate()
            .filter_map(|(at, op)| {
                direct_form(snapshot, hierarchy, &layouts, &printed, func, op)
                    .map(|form| (at, form))
            })
            .collect();
        for (at, form) in rewrites {
            match form {
                Direct::Call(function, object) => {
                    func.values[at].kind = OpKind::Call {
                        callee: super::Callee::Direct(function),
                        args: vec![object],
                        frame: None,
                    };
                }
                Direct::Text(text) => func.values[at].kind = OpKind::ConstString(text.to_owned()),
                Direct::Join(helper, array) => {
                    let comma = ValueId(u32::try_from(func.values.len()).unwrap_or(u32::MAX));
                    let origin = func.values[at].origin.clone();
                    func.values.push(Op {
                        kind: OpKind::ConstString(",".to_owned()),
                        ty: HirType::Managed(ManagedType::String),
                        origin,
                    });
                    let call = ValueId(u32::try_from(at).unwrap_or(u32::MAX));
                    if let Some(block) = func
                        .blocks
                        .iter_mut()
                        .find(|block| block.ops.contains(&call))
                    {
                        let position = block.ops.iter().position(|op| *op == call).unwrap_or(0);
                        block.ops.insert(position, comma);
                    }
                    func.values[at].kind = OpKind::Call {
                        callee: super::Callee::External(helper.to_owned()),
                        args: vec![array, comma],
                        frame: None,
                    };
                }
            }
        }
    }
}

/// What a conversion becomes where its type settles it.
enum Direct {
    Call(String, ValueId),
    Text(&'static str),
    Join(&'static str, ValueId),
}

/// The direct form of one operation, if it is a conversion the type settles.
fn direct_form(
    snapshot: &SemanticSnapshot,
    hierarchy: &Hierarchy,
    layouts: &[Layout],
    printed: &BTreeMap<String, Printed>,
    func: &Func,
    op: &Op,
) -> Option<Direct> {
    let OpKind::Call {
        callee: super::Callee::External(name),
        args,
        frame: None,
    } = &op.kind
    else {
        return None;
    };
    let [erased] = args.as_slice() else {
        return None;
    };
    if name != "nts_value_to_string" {
        return None;
    }
    let OpKind::Erase { value, .. } = func.values[erased.0 as usize].kind else {
        return None;
    };
    match &func.values[value.0 as usize].ty {
        HirType::Managed(ManagedType::Object(ty)) if is_a_class(snapshot, hierarchy, *ty) => {
            let candidates: Vec<&Layout> = layouts
                .iter()
                .filter(|layout| {
                    layout
                        .types
                        .iter()
                        .any(|candidate| hierarchy.descends(*candidate, *ty))
                })
                .collect();
            let answers: Vec<Option<&Printed>> = candidates
                .iter()
                .map(|layout| printed.get(&layout.name))
                .collect();
            let first = (*answers.first()?)?;
            if answers.iter().all(|answer| *answer == Some(first)) {
                return match first {
                    Printed::By(function) => Some(Direct::Call(function.clone(), value)),
                    Printed::Object => Some(Direct::Text("[object Object]")),
                    Printed::Function | Printed::Refused => None,
                };
            }
            // **An error family, each layout with its own rule.** The rules are
            // one rule over the same two fields, and every candidate extends
            // the static type, so its fields sit where the static type's do:
            // the static type's own rule answers for all of them. Not where
            // any of them declares its own `toString`.
            let own = layouts
                .iter()
                .find(|layout| layout.types.contains(ty))
                .map(error_rule_name)?;
            let every_one_a_rule = candidates
                .iter()
                .zip(&answers)
                .all(|(layout, answer)| *answer == Some(&Printed::By(error_rule_name(layout))));
            (every_one_a_rule
                && printed
                    .values()
                    .any(|answer| *answer == Printed::By(own.clone())))
            .then_some(Direct::Call(own, value))
        }
        HirType::Managed(ManagedType::Array(element)) => match element.as_ref() {
            HirType::Float { bits: 64 } => Some(Direct::Join("nts_array_join_num", value)),
            HirType::Managed(ManagedType::String) => {
                Some(Direct::Join("nts_array_join_str", value))
            }
            _ => None,
        },
        _ => None,
    }
}

/// Whether a type is a class: what a value of it can be is the class and what
/// extends it, which a base chain answers. A provided error is one; an
/// interface or an object literal's type is not, being any object of its shape.
fn is_a_class(snapshot: &SemanticSnapshot, hierarchy: &Hierarchy, ty: TypeId) -> bool {
    if hierarchy.provided_errors.contains_key(&ty) {
        return true;
    }
    snapshot
        .types
        .get(ty.0 as usize)
        .and_then(|record| record.symbol)
        .and_then(|symbol| snapshot.symbols.get(symbol.0 as usize))
        .is_some_and(|record| {
            record
                .flags
                .contains(nts_semantic_schema::SymbolFlags::CLASS)
        })
}
