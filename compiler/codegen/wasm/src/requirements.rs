//! Demand-driven instruction resources, classified exhaustively from live HIR.

use crate::{erased, erased_ops, helpers::Helper, host, strings};
use nts_core::hir::{Absent, BinOp, Callee, ClassId, Func, HirType, OpKind, Program, UnOp};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Debug)]
pub(crate) struct ObjectUse {
    pub(crate) function: String,
    pub(crate) origin: nts_semantic_schema::Origin,
}

#[derive(Debug, Default)]
pub(crate) struct Requirements {
    pub(crate) numeric: BTreeSet<Helper>,
    pub(crate) host: BTreeSet<&'static host::Service>,
    pub(crate) strings: BTreeSet<strings::Helper>,
    pub(crate) literals: BTreeSet<String>,
    pub(crate) erased: BTreeSet<erased::Helper>,
    pub(crate) input_contract: bool,
    pub(crate) referenced_objects: BTreeMap<ClassId, ObjectUse>,
    pub(crate) instance_of: bool,
}
impl Requirements {
    fn unit(&mut self, func: &Func, checked: bool) {
        self.contract(func);
        if !checked {
            self.require(strings::Helper::Length);
        }
        self.require(if checked {
            strings::Helper::CharCodeAt
        } else {
            strings::Helper::Unit
        });
    }
    fn conversion(
        &mut self,
        func: &Func,
        result: nts_core::hir::ValueId,
        value: nts_core::hir::ValueId,
    ) {
        if func.value(result).ty == HirType::Bool {
            if strings::is_string(&func.value(value).ty) {
                self.require(strings::Helper::Length);
            } else if func.value(value).ty == HirType::Erased {
                self.require_erased(erased::Helper::Truthy);
            }
        }
    }
    fn unerase(&mut self, ty: &HirType) {
        if matches!(*ty, HirType::Int { .. } | HirType::Float { .. }) {
            self.erased.insert(erased::Helper::Number);
        }
        if matches!(ty, HirType::Managed(_)) {
            self.erased.insert(erased::Helper::Tag);
        }
    }
    fn erase(&mut self, func: &Func, value: nts_core::hir::ValueId, absent: Absent) {
        match func.value(value).ty {
            HirType::Int { .. } | HirType::Float { .. } => {
                self.erased.insert(erased::Helper::BoxNumber);
            }
            HirType::Managed(_) if absent == Absent::Impossible => self.contract(func),
            HirType::Bool
            | HirType::Erased
            | HirType::Void
            | HirType::Never
            | HirType::Managed(_)
            | HirType::BigInt
            | HirType::NativePointer(_) => {}
        }
    }
    fn object_use(&mut self, func: &Func, id: nts_core::hir::ValueId, ty: ClassId) {
        self.referenced_objects
            .entry(ty)
            .or_insert_with(|| ObjectUse {
                function: func.name.clone(),
                origin: func.value(id).origin.clone(),
            });
    }
    fn instance(&mut self, func: &Func, id: nts_core::hir::ValueId, classes: &[ClassId]) {
        self.instance_of = true;
        for ty in classes {
            self.object_use(func, id, *ty);
        }
    }
    fn contract(&mut self, func: &Func) {
        self.input_contract = true;
        self.literals.insert(func.name.clone());
    }
    fn call(&mut self, func: &Func, target: &Callee) {
        match target {
            Callee::External(name) => {
                if let Some(helper) = strings::external(name) {
                    self.require(helper);
                    if !matches!(
                        helper,
                        strings::Helper::Equal | strings::Helper::FromCharCode
                    ) {
                        self.contract(func);
                    }
                } else if let Some(service) = host::external(name) {
                    self.host.insert(service);
                } else if let Some(helper) = erased_ops::external(name) {
                    self.require_erased(helper);
                    if matches!(helper, erased::Helper::Number | erased::Helper::Boolean) {
                        self.contract(func);
                    }
                }
            }
            Callee::Direct(_)
            | Callee::Virtual { .. }
            | Callee::Closure { .. }
            | Callee::Native(_) => {}
        }
    }
    fn require_erased(&mut self, helper: erased::Helper) {
        use erased::Helper as E;
        if !self.erased.insert(helper) {
            return;
        }
        match helper {
            E::Equal | E::Truthy => {
                self.require_erased(E::Tag);
                self.require_erased(E::Number);
                self.require(if helper == E::Equal {
                    strings::Helper::Equal
                } else {
                    strings::Helper::Length
                });
            }
            E::EqualNumber => {
                self.require_erased(E::Tag);
                self.require_erased(E::Number);
            }
            E::EqualBoolean => self.require_erased(E::Tag),
            E::EqualString => {
                self.require_erased(E::Tag);
                self.require(strings::Helper::Equal);
            }
            E::BoxNumber | E::Number | E::Tag | E::BoxBoolean | E::Boolean => {}
        }
    }
    fn require(&mut self, helper: strings::Helper) {
        if !self.strings.insert(helper) {
            return;
        }
        if helper == strings::Helper::CharAt {
            self.literals.insert(String::new());
        }
        for dependency in helper.dependencies() {
            self.require(*dependency);
        }
    }
}

pub(crate) fn build(program: &Program) -> Requirements {
    let mut result = Requirements::default();
    for func in &program.funcs {
        if func.abstract_declaration {
            continue;
        }
        for block in nts_codegen_common::block_order(func) {
            for id in &func.blocks[block.0 as usize].ops {
                if let Some(helper) = helper_for(func, *id, &mut result) {
                    result.numeric.insert(helper);
                }
            }
        }
    }
    if result.strings.contains(&strings::Helper::FromCharCode) {
        result.numeric.insert(Helper::ToInt32);
    }
    result
}

fn helper_for(
    func: &Func,
    id: nts_core::hir::ValueId,
    result: &mut Requirements,
) -> Option<Helper> {
    match func.value(id).kind {
        OpKind::Unary { op, operand } => unary(func, op, operand, result),
        OpKind::Binary { op, lhs, rhs } => binary(func, id, op, lhs, rhs, result),
        OpKind::Erase { value, absent } => {
            result.erase(func, value, absent);
            None
        }
        OpKind::Unerase { .. } => {
            result.unerase(&func.value(id).ty);
            if func.value(id).ty != HirType::Erased {
                result.contract(func);
            }
            None
        }
        OpKind::TagOf { .. } => {
            result.erased.insert(erased::Helper::Tag);
            None
        }
        OpKind::InstanceOf { ref classes, .. } => {
            result.instance(func, id, classes);
            None
        }
        OpKind::FieldGet { .. } | OpKind::FieldSet { .. } => {
            result.contract(func);
            None
        }
        OpKind::ConstString(ref text) => {
            result.literals.insert(text.clone());
            None
        }
        OpKind::Length(value) => {
            if strings::is_string(&func.value(value).ty) {
                result.require(strings::Helper::Length);
                result.contract(func);
            }
            None
        }
        OpKind::StringUnitAt { checked, .. } => {
            result.unit(func, checked);
            None
        }
        OpKind::Call {
            callee: ref target, ..
        } => {
            result.call(func, target);
            None
        }
        OpKind::Convert(value) => {
            result.conversion(func, id, value);
            None
        }
        OpKind::NativeLoad { .. }
        | OpKind::NativeStore { .. }
        | OpKind::NativeLocal { .. }
        | OpKind::ObjcClass { .. }
        | OpKind::ObjcSelector { .. }
        | OpKind::NativeSizeOf(_)
        | OpKind::NativeMalloc { .. }
        | OpKind::NativeFree { .. }
        | OpKind::NativeIndexAddress { .. }
        | OpKind::NativeFieldAddress { .. }
        | OpKind::NativeBitLoad { .. }
        | OpKind::NativeBitStore { .. }
        | OpKind::NativeCopy { .. }
        | OpKind::NativeBridge { .. }
        | OpKind::NativeBlock { .. }
        | OpKind::DelegateInvoke { .. }
        | OpKind::Param(_)
        | OpKind::BlockParam(_)
        | OpKind::ConstInt(_)
        | OpKind::ConstFloat(_)
        | OpKind::DispatchSlot(_)
        | OpKind::ConstBool(_)
        | OpKind::ConstTemplate { .. }
        | OpKind::Return(_)
        | OpKind::ArrayNew { .. }
        | OpKind::ArrayGet { .. }
        | OpKind::Retain(_)
        | OpKind::Release(_)
        | OpKind::GlobalGet(_)
        | OpKind::GlobalSet { .. }
        | OpKind::ConstNull
        | OpKind::ConstUndefined
        | OpKind::ObjectNew { .. }
        | OpKind::CellReady { .. }
        | OpKind::ClosureStatic
        | OpKind::SharedFieldGet { .. }
        | OpKind::OpenFieldGet { .. }
        | OpKind::OpenFieldSet { .. }
        | OpKind::Await { .. }
        | OpKind::Yield { .. }
        | OpKind::Suspend { .. }
        | OpKind::PromiseSubscribe { .. }
        | OpKind::ArraySet { .. } => None,
    }
}

fn unary(
    func: &Func,
    op: UnOp,
    operand: nts_core::hir::ValueId,
    result: &mut Requirements,
) -> Option<Helper> {
    if strings::is_string(&func.value(operand).ty) && matches!(op, UnOp::Truthy | UnOp::Not) {
        result.require(strings::Helper::Length);
    } else if func.value(operand).ty == HirType::Erased && matches!(op, UnOp::Truthy | UnOp::Not) {
        result.require_erased(erased::Helper::Truthy);
    }
    match op {
        UnOp::Round => Some(Helper::Round),
        UnOp::ToInt32 | UnOp::ToUint32 => {
            matches!(func.value(operand).ty, HirType::Float { .. }).then_some(Helper::ToInt32)
        }
        UnOp::Neg
        | UnOp::Not
        | UnOp::Abs
        | UnOp::Floor
        | UnOp::Ceil
        | UnOp::Trunc
        | UnOp::Sqrt
        | UnOp::Truthy => None,
    }
}

fn binary(
    func: &Func,
    id: nts_core::hir::ValueId,
    op: BinOp,
    lhs: nts_core::hir::ValueId,
    rhs: nts_core::hir::ValueId,
    result: &mut Requirements,
) -> Option<Helper> {
    if matches!(op, BinOp::Eq | BinOp::Ne)
        && let Some((helper, _)) =
            erased_ops::equality_helper(&func.value(lhs).ty, &func.value(rhs).ty)
    {
        result.require_erased(helper);
        return None;
    }
    if strings::is_string(&func.value(lhs).ty) && strings::is_string(&func.value(rhs).ty) {
        if let Ok(helper) = strings::binary_helper(op) {
            result.require(helper);
            if !matches!(op, BinOp::Eq | BinOp::Ne) {
                result.contract(func);
            }
        }
        return None;
    }
    match op {
        BinOp::Rem => {
            matches!(func.value(id).ty, HirType::Float { .. }).then_some(Helper::Remainder)
        }
        BinOp::BitAnd | BinOp::BitOr | BinOp::BitXor | BinOp::Shl | BinOp::Shr | BinOp::UShr => {
            (matches!(func.value(lhs).ty, HirType::Float { .. })
                || matches!(func.value(rhs).ty, HirType::Float { .. }))
            .then_some(Helper::ToInt32)
        }
        BinOp::Add
        | BinOp::Sub
        | BinOp::Mul
        | BinOp::Div
        | BinOp::Lt
        | BinOp::Le
        | BinOp::Gt
        | BinOp::Ge
        | BinOp::Eq
        | BinOp::Ne
        | BinOp::Concat
        | BinOp::Min
        | BinOp::Max => None,
    }
}
