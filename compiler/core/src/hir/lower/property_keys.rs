//! Property keys of string records, distinct from a Map's `SameValueZero` keys.
//!
//! Capture a reference's raw key once, but convert at each read and write:
//! `GetValue` and `PutValue` each apply `ToPropertyKey`. This keeps a simple store's
//! conversion after its RHS and leaves compound/update conversions separate.

use super::{
    Absent, BinOp, Diagnostic, FuncBuilder, HirType, ManagedType, NodeId, OpKind, Terminator,
    ValueId,
};
use crate::hir::tags;

pub(super) const OBJECT_PROTOTYPE_MEMBERS: &[&str] = &[
    "constructor",
    "hasOwnProperty",
    "isPrototypeOf",
    "propertyIsEnumerable",
    "toLocaleString",
    "toString",
    "valueOf",
    "__proto__",
    "__defineGetter__",
    "__defineSetter__",
    "__lookupGetter__",
    "__lookupSetter__",
];

const I32: HirType = HirType::Int {
    bits: 32,
    signed: true,
};

#[derive(Clone, Copy)]
pub(super) enum Action {
    Get,
    Set(ValueId),
    Has,
    In,
    Delete,
}

impl Action {
    const fn helper(self) -> &'static str {
        match self {
            Self::Get => "nts_map_get",
            Self::Set(_) => "nts_map_set",
            Self::Has | Self::In => "nts_map_has",
            Self::Delete => "nts_map_delete",
        }
    }

    const fn result(self) -> HirType {
        match self {
            Self::Get | Self::Set(_) => HirType::Erased,
            Self::Has | Self::In | Self::Delete => HirType::Bool,
        }
    }
}

pub(super) fn string_record(builder: &FuncBuilder<'_>, table: ValueId) -> bool {
    string_record_type(&builder.values[table.0 as usize].ty)
}

pub(super) fn string_record_type(ty: &HirType) -> bool {
    matches!(ty,
        HirType::Managed(ManagedType::Table(key, _))
        if **key == HirType::Managed(ManagedType::String))
}

/// Erasure captures the key's value, including which absence a null string
/// pointer means. It performs no property-key conversion and runs no code.
pub(super) fn capture(
    builder: &mut FuncBuilder<'_>,
    source: NodeId,
    key: ValueId,
) -> Result<ValueId, Diagnostic> {
    builder.coerce(key, &HirType::Erased, source)
}

fn already_string(builder: &FuncBuilder<'_>, key: ValueId) -> bool {
    let OpKind::Erase {
        value,
        absent: Absent::Impossible,
        ..
    } = builder.values[key.0 as usize].kind
    else {
        return false;
    };
    builder.values[value.0 as usize].ty == HirType::Managed(ManagedType::String)
}

/// The string-tagged fast path goes directly to the table operation. Neither
/// a symbol nor an object is ever handed to the string-specialized hash.
pub(super) fn apply(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    table: ValueId,
    key: ValueId,
    action: Action,
) -> ValueId {
    if !string_record(builder, table) || already_string(builder, key) {
        return operate(builder, at, table, key, action);
    }
    let origin = builder.origin(at);
    let tag = builder.push(OpKind::TagOf { value: key }, I32, origin.clone());
    let string = builder.new_block();
    let string_key = builder.push_block_param(string, HirType::Erased, origin.clone());
    let cold = builder.new_block();
    let is_string = is_tag(builder, at, tag, tags::STRING);
    builder.terminate(Terminator::Branch {
        cond: is_string,
        then_target: string,
        then_args: vec![key],
        else_target: cold,
        else_args: Vec::new(),
    });
    builder.switch_to(cold);
    let symbol = builder.new_block();
    let primitive = builder.new_block();
    let is_symbol = is_tag(builder, at, tag, tags::SYMBOL);
    builder.terminate(Terminator::Branch {
        cond: is_symbol,
        then_target: symbol,
        then_args: Vec::new(),
        else_target: primitive,
        else_args: Vec::new(),
    });
    builder.switch_to(primitive);
    let format = builder.new_block();
    for allowed in [
        tags::NUMBER,
        tags::BOOLEAN,
        tags::NULL,
        tags::UNDEFINED,
        tags::BIGINT,
    ] {
        let next = builder.new_block();
        let matches = is_tag(builder, at, tag, allowed);
        builder.terminate(Terminator::Branch {
            cond: matches,
            then_target: format,
            then_args: Vec::new(),
            else_target: next,
            else_args: Vec::new(),
        });
        builder.switch_to(next);
    }
    refuse(
        builder,
        at,
        "an object property key, whose ToPrimitive conversion this compiler does not yet perform",
    );
    builder.switch_to(format);
    let text = builder.runtime_call(
        "nts_value_to_string",
        vec![key],
        HirType::Managed(ManagedType::String),
        origin.clone(),
    );
    // `ToString`'s answer is a string, never absent.
    let formatted = builder.erased(text, Absent::Impossible, &origin);
    builder.terminate(Terminator::Jump {
        target: string,
        args: vec![formatted],
    });

    let merge = builder.new_block();
    let result = builder.push_block_param(merge, action.result(), origin);
    builder.switch_to(string);
    let found = operate(builder, at, table, string_key, action);
    builder.terminate(Terminator::Jump {
        target: merge,
        args: vec![found],
    });
    builder.switch_to(symbol);
    if let Some(missing) = symbol_result(builder, at, action) {
        builder.terminate(Terminator::Jump {
            target: merge,
            args: vec![missing],
        });
    }
    builder.switch_to(merge);
    result
}

fn is_tag(builder: &mut FuncBuilder<'_>, at: NodeId, tag: ValueId, expected: u32) -> ValueId {
    let origin = builder.origin(at);
    let expected = builder.push(OpKind::ConstInt(i128::from(expected)), I32, origin.clone());
    builder.push(
        OpKind::Binary {
            op: BinOp::Eq,
            lhs: tag,
            rhs: expected,
        },
        HirType::Bool,
        origin,
    )
}

fn operate(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    table: ValueId,
    key: ValueId,
    action: Action,
) -> ValueId {
    let origin = builder.origin(at);
    let mut args = vec![table, key];
    let returns = match action {
        Action::Set(value) => {
            args.push(value);
            HirType::Void
        }
        _ => action.result(),
    };
    let table_ty = builder.values[table.0 as usize].ty.clone();
    let call = builder.keyed_call(action.helper(), &table_ty, args, returns, origin.clone());
    match action {
        Action::Set(_) => builder.push(OpKind::ConstUndefined, HirType::Erased, origin),
        // Ordinary property deletion succeeds even if the property was absent.
        Action::Delete => builder.push(OpKind::ConstBool(true), HirType::Bool, origin),
        Action::In => inherited_membership(builder, at, key, call),
        _ => call,
    }
}

fn symbol_result(builder: &mut FuncBuilder<'_>, at: NodeId, action: Action) -> Option<ValueId> {
    let kind = match action {
        // This is the same erased absence nts_map_get returns for a missing
        // string key. Its consumer applies the existing result narrowing.
        Action::Get => OpKind::ConstUndefined,
        Action::Has | Action::In => OpKind::ConstBool(false),
        Action::Delete => OpKind::ConstBool(true),
        Action::Set(_) => {
            refuse(
                builder,
                at,
                "a symbol property stored in a string-keyed record, which this runtime does not hold",
            );
            return None;
        }
    };
    Some(builder.push(kind, action.result(), builder.origin(at)))
}

fn refuse(builder: &mut FuncBuilder<'_>, at: NodeId, reason: &str) {
    let origin = builder.origin(at);
    let text = builder.push(
        OpKind::ConstString(reason.to_owned()),
        HirType::Managed(ManagedType::String),
        origin.clone(),
    );
    builder.runtime_call("nts_refused", vec![text], HirType::Void, origin);
    builder.terminate(Terminator::Unreachable);
}

/// A record stores own properties. A computed `in` must not answer false for
/// an inherited Object.prototype name just because the table has no entry.
/// Its prototype is not represented, so that uncommon missing-key case stops
/// by name; the existing literal-key proof stays in `lower_in`.
fn inherited_membership(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    key: ValueId,
    present: ValueId,
) -> ValueId {
    let origin = builder.origin(at);
    let found = builder.new_block();
    let missing = builder.new_block();
    let merge = builder.new_block();
    let result = builder.push_block_param(merge, HirType::Bool, origin.clone());
    builder.terminate(Terminator::Branch {
        cond: present,
        then_target: found,
        then_args: Vec::new(),
        else_target: missing,
        else_args: Vec::new(),
    });
    builder.switch_to(found);
    builder.terminate(Terminator::Jump {
        target: merge,
        args: vec![present],
    });
    builder.switch_to(missing);
    let text = builder.push(
        OpKind::unerase(key),
        HirType::Managed(ManagedType::String),
        origin.clone(),
    );
    let inherited = builder.new_block();
    for name in OBJECT_PROTOTYPE_MEMBERS {
        let next = builder.new_block();
        let name = builder.push(
            OpKind::ConstString((*name).to_owned()),
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        let matches = builder.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: text,
                rhs: name,
            },
            HirType::Bool,
            origin.clone(),
        );
        builder.terminate(Terminator::Branch {
            cond: matches,
            then_target: inherited,
            then_args: Vec::new(),
            else_target: next,
            else_args: Vec::new(),
        });
        builder.switch_to(next);
    }
    builder.terminate(Terminator::Jump {
        target: merge,
        args: vec![present],
    });
    builder.switch_to(inherited);
    refuse(
        builder,
        at,
        &format!(
            "an inherited record property ({}), whose prototype this runtime does not record",
            OBJECT_PROTOTYPE_MEMBERS.join(", ")
        ),
    );
    builder.switch_to(merge);
    result
}

pub(super) fn delete(
    builder: &mut FuncBuilder<'_>,
    at: NodeId,
    place: &super::Place,
) -> Result<ValueId, Diagnostic> {
    match place {
        super::Place::Checked { place, guard, .. } => {
            super::access::require_delete(builder, at, guard)?;
            delete(builder, at, place)
        }
        super::Place::Entry { table, key } if string_record(builder, *table) => {
            Ok(apply(builder, at, *table, *key, Action::Delete))
        }
        _ => Err(builder.unsupported(at, "deleting a property of this record representation")),
    }
}
