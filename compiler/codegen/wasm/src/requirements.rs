//! Demand-driven instruction resources, classified exhaustively from live HIR.

use crate::{helpers::Helper, host, strings};
use nts_core::hir::{BinOp, Callee, Func, HirType, OpKind, Program, UnOp};
use std::collections::BTreeSet;

#[derive(Debug, Default)]
pub(crate) struct Requirements {
    pub(crate) numeric: BTreeSet<Helper>,
    pub(crate) host: BTreeSet<&'static host::Service>,
    pub(crate) strings: BTreeSet<strings::Helper>,
    pub(crate) literals: BTreeSet<String>,
}
impl Requirements {
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
        OpKind::ConstString(ref text) => {
            result.literals.insert(text.clone());
            None
        }
        OpKind::Length(value) => {
            if strings::is_string(&func.value(value).ty) {
                result.require(strings::Helper::Length);
            }
            None
        }
        OpKind::StringUnitAt { checked, .. } => {
            result.require(if checked {
                strings::Helper::CharCodeAt
            } else {
                strings::Helper::Unit
            });
            None
        }
        OpKind::Call {
            callee: ref target, ..
        } => {
            match target {
                Callee::External(name) => {
                    if let Some(helper) = strings::external(name) {
                        result.require(helper);
                    } else if let Some(service) = host::external(name) {
                        result.host.insert(service);
                    }
                }
                Callee::Direct(_)
                | Callee::Virtual { .. }
                | Callee::Closure { .. }
                | Callee::Native(_) => {}
            }
            None
        }
        OpKind::Convert(value) => {
            if strings::is_string(&func.value(value).ty) && func.value(id).ty == HirType::Bool {
                result.require(strings::Helper::Length);
            }
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
        | OpKind::Erase { .. }
        | OpKind::TagOf { .. }
        | OpKind::Unerase { .. }
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
        | OpKind::InstanceOf { .. }
        | OpKind::FieldGet { .. }
        | OpKind::SharedFieldGet { .. }
        | OpKind::OpenFieldGet { .. }
        | OpKind::OpenFieldSet { .. }
        | OpKind::FieldSet { .. }
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
    if strings::is_string(&func.value(lhs).ty) && strings::is_string(&func.value(rhs).ty) {
        if let Ok(helper) = strings::binary_helper(op) {
            result.require(helper);
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
