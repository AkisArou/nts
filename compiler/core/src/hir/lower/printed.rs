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
