//! Calls through a structural callable property use its concrete supplier.
//!
//! A method supplies an invocation, not a data-field offset or a function value.
//! Stored callbacks keep their actual field read. General method-value reads
//! remain refused: binding a fresh closure would change identity and `this`.

use std::sync::Arc;

use super::{
    BinOp, Branch, Diagnostic, FuncBuilder, HirType, ManagedType, MemberKey, NodeId, OpKind,
    PropertyKey, SemanticSnapshot, Terminator, TypeId, TypeKind, ValueId,
};

pub(super) const SUPPLIER_BUDGET: usize = 64;

#[derive(Debug, Clone, Copy)]
pub(super) enum Kind {
    Method(TypeId),
    Stored,
    Missing,
}

#[derive(Debug, Clone)]
pub(super) struct Supplier {
    pub owner: TypeId,
    pub kind: Kind,
}

#[derive(Debug, Clone)]
pub(super) struct Contract {
    pub face: TypeId,
    pub member: PropertyKey,
    pub suppliers: Vec<Supplier>,
    pub methods: Vec<(TypeId, MemberKey)>,
}

pub(super) fn signature(snapshot: &SemanticSnapshot, ty: TypeId) -> Option<TypeId> {
    match &snapshot.types.get(ty.0 as usize)?.kind {
        TypeKind::Function(_) => Some(ty),
        TypeKind::Union(members) => {
            let mut present = members.iter().copied().filter(|member| {
                !matches!(
                    snapshot.types.get(member.0 as usize).map(|ty| &ty.kind),
                    Some(TypeKind::Undefined)
                )
            });
            let only = present.next()?;
            (present.next().is_none()
                && matches!(
                    snapshot.types.get(only.0 as usize)?.kind,
                    TypeKind::Function(_)
                ))
            .then_some(only)
        }
        _ => None,
    }
}

#[derive(Debug, Clone, Copy)]
pub(super) enum Action {
    Call,
    Present,
}

#[derive(Debug, Clone)]
pub(super) struct Projection {
    pub receiver: ValueId,
    pub object: NodeId,
    pub member: NodeId,
    pub contract: Arc<Contract>,
    pub next: usize,
    pub action: Action,
}

impl FuncBuilder<'_> {
    pub(super) fn projected_callable(
        &self,
        face: TypeId,
        member: &PropertyKey,
    ) -> Option<Arc<Contract>> {
        let face = self.substitution.instance_of(face).unwrap_or(face);
        self.hierarchy
            .access_families
            .callable
            .get(&(face, member.clone()))
            .cloned()
    }

    pub(super) fn start_callable(
        &mut self,
        id: NodeId,
        receiver: ValueId,
        object: NodeId,
        member: NodeId,
        contract: Arc<Contract>,
        action: Action,
    ) -> Result<ValueId, Diagnostic> {
        if matches!(action, Action::Call)
            && !self.is_optional_call(id)
            && contract
                .suppliers
                .iter()
                .any(|supplier| !matches!(supplier.kind, Kind::Method(_)))
        {
            return Err(self.unsupported(
                id,
                "a non-optional call through a callable property with a possibly absent supplier",
            ));
        }
        let held = self.values[receiver.0 as usize].ty.clone();
        let erased = if held == HirType::Erased {
            receiver
        } else {
            let absent = self.absence_at_excluding(object, &held, false);
            self.push(
                OpKind::Erase {
                    value: receiver,
                    absent,
                    slots: super::Absent::Impossible,
                },
                HirType::Erased,
                self.origin(object),
            )
        };
        self.project_callable(
            id,
            Projection {
                receiver: erased,
                object,
                member,
                contract,
                next: 0,
                action,
            },
        )
    }

    pub(super) fn project_callable(
        &mut self,
        id: NodeId,
        projection: Projection,
    ) -> Result<ValueId, Diagnostic> {
        let Some(supplier) = projection.contract.suppliers.get(projection.next).cloned() else {
            let origin = self.origin(id);
            let name = self.push(
                OpKind::ConstString(projection.contract.member.to_string().into()),
                HirType::Managed(ManagedType::String),
                origin.clone(),
            );
            self.runtime_call(
                "nts_no_arm_of",
                vec![projection.receiver, name],
                HirType::Void,
                origin.clone(),
            );
            self.terminate(Terminator::Unreachable);
            let dead = self.new_block();
            self.switch_to(dead);
            let ty = match projection.action {
                Action::Present => HirType::Bool,
                Action::Call => self
                    .type_of(id)
                    .ok_or_else(|| self.unrepresentable(id, "a callable result"))?,
            };
            return Ok(self.push(super::super::zero_of(&ty), ty, origin));
        };
        self.layout_of(id, supplier.owner)?;
        let origin = self.origin(id);
        let condition = self.push(
            OpKind::InstanceOf {
                value: projection.receiver,
                classes: vec![supplier.owner],
                by_layout: false,
            },
            HirType::Bool,
            origin,
        );
        let mut rest = projection.clone();
        rest.next += 1;
        let ty = match projection.action {
            Action::Present => HirType::Bool,
            Action::Call => self
                .type_of(id)
                .ok_or_else(|| self.unrepresentable(id, "a callable result"))?,
        };
        self.lower_branching_value_at(
            id,
            ty,
            condition,
            Branch::CallableSupplier(projection),
            Branch::CallableProjection(rest),
        )
    }

    pub(super) fn callable_supplier(
        &mut self,
        id: NodeId,
        projection: &Projection,
    ) -> Result<ValueId, Diagnostic> {
        let supplier = &projection.contract.suppliers[projection.next];
        let origin = self.origin(id);
        if matches!(supplier.kind, Kind::Missing) {
            return match projection.action {
                Action::Present => Ok(self.push(OpKind::ConstBool(false), HirType::Bool, origin)),
                Action::Call => self.evaluate(id, Branch::Absent),
            };
        }
        let object = self.push(
            OpKind::unerase(projection.receiver),
            HirType::Managed(ManagedType::Object(supplier.owner)),
            origin.clone(),
        );
        if let Kind::Method(function_ty) = supplier.kind {
            return match projection.action {
                Action::Present => Ok(self.push(OpKind::ConstBool(true), HirType::Bool, origin)),
                Action::Call => {
                    let arguments = self.arguments_of(id);
                    // This arm calls the actual method. The optional source
                    // expression can also answer undefined, but the method's
                    // call ABI does not acquire that absence. The surrounding
                    // projection joins it with the absent arm afterwards.
                    let outer = self.callee_signature.replace((id, function_ty));
                    let result = self.lower_method_on(
                        id,
                        object,
                        projection.object,
                        projection.member,
                        &arguments,
                    );
                    self.callee_signature = outer;
                    result
                }
            };
        }
        let access = self
            .node(projection.member)
            .parent
            .unwrap_or(projection.member);
        let layout = self.layout_of(access, supplier.owner)?;
        let field = layout
            .index_of_key(&projection.contract.member)
            .ok_or_else(|| {
                self.unsupported(access, "a callable supplier without its declared storage")
            })?;
        let callback = self.push(
            OpKind::FieldGet { object, field },
            layout.fields[field as usize].ty.clone(),
            self.origin(access),
        );
        self.read_from.insert(access, object);
        let absent = self.absence_of(access, callback);
        match projection.action {
            Action::Present => match absent {
                Some(absent) => {
                    let no = self.push(OpKind::ConstBool(false), HirType::Bool, origin.clone());
                    Ok(self.push(
                        OpKind::Binary {
                            op: BinOp::Eq,
                            lhs: absent,
                            rhs: no,
                        },
                        HirType::Bool,
                        origin,
                    ))
                }
                None => Ok(self.push(OpKind::ConstBool(true), HirType::Bool, origin)),
            },
            Action::Call => {
                let present = self.present_of(access, callback);
                if let Some(absent) = absent {
                    self.lower_branching_value(
                        id,
                        absent,
                        Branch::Absent,
                        Branch::Invoke(callback, access, present),
                    )
                } else {
                    let arguments = self.arguments_of(id);
                    self.call_through_closure(id, access, callback, Some(object), &arguments)
                }
            }
        }
    }
}
