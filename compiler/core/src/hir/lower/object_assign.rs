//! Assign dictionary entries to a fixed object's declared storage.
//!
//! Argument evaluation precedes copying; keys are walked in the source's own
//! order. Every entry either reaches its declared slot or declines by name.
//! Nothing outside a fixed layout is silently discarded.

use super::{
    Absent, BinOp, Diagnostic, FuncBuilder, HirType, Layout, ManagedType, NodeId, OpKind, Place,
    Terminator, ValueId,
};
use crate::hir::tags;

impl FuncBuilder<'_> {
    pub(super) fn assign_to_fields(
        &mut self,
        id: NodeId,
        target_node: NodeId,
        target: ValueId,
        sources: &[(NodeId, ValueId)],
    ) -> Result<ValueId, Diagnostic> {
        let HirType::Managed(ManagedType::Object(owner)) = self.values[target.0 as usize].ty else {
            return Err(self.unsupported(
                id,
                "`Object.assign` onto a value without dictionary or field storage",
            ));
        };
        if self
            .absences_of(target_node)
            .is_none_or(|absent| !absent.is_empty())
        {
            return Err(self.unsupported(
                id,
                "`Object.assign` onto a structured target that may be null or undefined",
            ));
        }
        if self.hierarchy.access_families.changes_transport(owner)
            && !self.hierarchy.access_families.permits_spread(owner)
        {
            return Err(self.unsupported(
                id,
                "`Object.assign` through an interface without a uniform target layout",
            ));
        }
        let layout = self.layout_of(id, owner)?;
        // Only storage is admitted here. A setter is an implicit call and must
        // be selected by the shared call/effect plan before it can run here.
        let mut fields: Vec<_> = layout
            .fields
            .iter()
            .enumerate()
            .filter_map(|(index, field)| {
                field
                    .name
                    .public_name()
                    .map(|name| (name.to_owned(), index))
            })
            .collect();
        fields.sort_by(|a, b| a.0.encode_utf16().cmp(b.0.encode_utf16()));
        for (node, source) in sources {
            if !super::property_keys::string_record(self, *source) {
                return Err(self.unsupported(
                    *node,
                    "`Object.assign` into fields from a source without string-record storage",
                ));
            }
            self.assign_record_to_fields(id, target, &layout, *node, *source, &fields)?;
        }
        Ok(target)
    }

    fn assign_record_to_fields(
        &mut self,
        id: NodeId,
        target: ValueId,
        layout: &Layout,
        source_node: NodeId,
        source: ValueId,
        fields: &[(String, usize)],
    ) -> Result<(), Diagnostic> {
        let origin = self.origin(id);
        let keys = self.call_runtime(
            "nts_map_keys_str",
            vec![source],
            HirType::Managed(ManagedType::Array(Box::new(HirType::Managed(
                ManagedType::String,
            )))),
            &origin,
        );
        let count = self.push(OpKind::Length(keys), HirType::NUMBER, origin.clone());
        let zero = self.push(OpKind::ConstFloat(0.0), HirType::NUMBER, origin.clone());
        let head = self.new_block();
        let body = self.new_block();
        let done = self.new_block();
        let index = self.push_block_param(head, HirType::NUMBER, origin.clone());
        self.terminate(Terminator::Jump {
            target: head,
            args: vec![zero],
        });
        self.switch_to(head);
        let more = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: index,
                rhs: count,
            },
            HirType::Bool,
            origin.clone(),
        );
        self.terminate(Terminator::Branch {
            cond: more,
            then_target: body,
            then_args: Vec::new(),
            else_target: done,
            else_args: Vec::new(),
        });
        self.switch_to(body);
        let key = self.push(
            OpKind::ArrayGet {
                array: keys,
                index,
                checked: true,
            },
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        let erased_key = self.erased(key, Absent::Impossible, &origin);
        let value = super::property_keys::apply(
            self,
            source_node,
            source,
            erased_key,
            super::property_keys::Action::Get,
        );
        let next = self.new_block();
        self.assign_record_entry(id, target, layout, (key, value), fields, next)?;
        self.switch_to(next);
        let one = self.push(OpKind::ConstFloat(1.0), HirType::NUMBER, origin.clone());
        let advanced = self.push(
            OpKind::Binary {
                op: BinOp::Add,
                lhs: index,
                rhs: one,
            },
            HirType::NUMBER,
            origin,
        );
        self.terminate(Terminator::Jump {
            target: head,
            args: vec![advanced],
        });
        self.switch_to(done);
        Ok(())
    }

    // A balanced name dispatch keeps each runtime source key logarithmic in
    // the target's field count, including unknown-key rejection.
    fn assign_record_entry(
        &mut self,
        id: NodeId,
        target: ValueId,
        layout: &Layout,
        entry: (ValueId, ValueId),
        fields: &[(String, usize)],
        next: super::BlockId,
    ) -> Result<(), Diagnostic> {
        let (key, value) = entry;
        let origin = self.origin(id);
        if fields.is_empty() {
            let always = self.push(OpKind::ConstBool(true), HirType::Bool, origin);
            super::assertions::decline_when(
                self,
                id,
                always,
                "an Object.assign source key outside the target's fixed layout",
            )?;
            self.terminate(Terminator::Jump {
                target: next,
                args: Vec::new(),
            });
            return Ok(());
        }
        let middle = fields.len() / 2;
        let (name, index) = &fields[middle];
        let wanted = self.push(
            OpKind::ConstString(name.clone().into()),
            HirType::Managed(ManagedType::String),
            origin.clone(),
        );
        let equal = self.push(
            OpKind::Binary {
                op: BinOp::Eq,
                lhs: key,
                rhs: wanted,
            },
            HirType::Bool,
            origin.clone(),
        );
        let store = self.new_block();
        let otherwise = self.new_block();
        self.terminate(Terminator::Branch {
            cond: equal,
            then_target: store,
            then_args: Vec::new(),
            else_target: otherwise,
            else_args: Vec::new(),
        });
        self.switch_to(store);
        let field = &layout.fields[*index];
        if field.readonly {
            return Err(self.unsupported(
                id,
                "`Object.assign` into field storage published as immutable",
            ));
        }
        let field_index = u32::try_from(*index)
            .map_err(|_| self.unsupported(id, "an Object.assign target with too many fields"))?;
        let payload = self.assign_field_payload(id, value, &field.ty)?;
        self.write_place(
            id,
            &Place::Field {
                object: target,
                field: field_index,
            },
            payload,
        )?;
        self.terminate(Terminator::Jump {
            target: next,
            args: Vec::new(),
        });
        self.switch_to(otherwise);
        let less = self.push(
            OpKind::Binary {
                op: BinOp::Lt,
                lhs: key,
                rhs: wanted,
            },
            HirType::Bool,
            origin,
        );
        let lower = self.new_block();
        let higher = self.new_block();
        self.terminate(Terminator::Branch {
            cond: less,
            then_target: lower,
            then_args: Vec::new(),
            else_target: higher,
            else_args: Vec::new(),
        });
        self.switch_to(lower);
        self.assign_record_entry(id, target, layout, (key, value), &fields[..middle], next)?;
        self.switch_to(higher);
        self.assign_record_entry(
            id,
            target,
            layout,
            (key, value),
            &fields[middle + 1..],
            next,
        )
    }

    fn assign_field_payload(
        &mut self,
        id: NodeId,
        value: ValueId,
        want: &HirType,
    ) -> Result<ValueId, Diagnostic> {
        if *want == HirType::Erased {
            return Ok(value);
        }
        let expected =
            match want {
                HirType::Bool => tags::BOOLEAN,
                HirType::Float { bits: 64 } => tags::NUMBER,
                HirType::BigInt => tags::BIGINT,
                HirType::Managed(ManagedType::String) => tags::STRING,
                HirType::Managed(ManagedType::Symbol) => tags::SYMBOL,
                _ => return Err(self.unsupported(
                    id,
                    "`Object.assign` into native field storage without a checked payload contract",
                )),
            };
        let origin = self.origin(id);
        let tag_ty = HirType::Int {
            bits: 32,
            signed: false,
        };
        let tag = self.push(OpKind::TagOf { value }, tag_ty.clone(), origin.clone());
        let expected = self.push(
            OpKind::ConstInt(i128::from(expected)),
            tag_ty,
            origin.clone(),
        );
        let rejected = self.push(
            OpKind::Binary {
                op: BinOp::Ne,
                lhs: tag,
                rhs: expected,
            },
            HirType::Bool,
            origin.clone(),
        );
        super::assertions::decline_when(
            self,
            id,
            rejected,
            "an Object.assign value outside the target field's native representation",
        )?;
        Ok(self.push(OpKind::unerase(value), want.clone(), origin))
    }
}
