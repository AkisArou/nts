//! `nts_array_element`: an erased read that answers `undefined` where node
//! does, for every element kind, at every kind of index.
#![allow(clippy::unwrap_used, clippy::expect_used)]
mod common;
use common::hir::{F64, U32, block, function, program, value};
use nts_core::hir::{Absent, Callee, Func, HirType, ManagedType, OpKind, Terminator, ValueId};

fn array(element: HirType) -> HirType {
    HirType::Managed(ManagedType::Array(Box::new(element)))
}
fn string() -> HirType {
    HirType::Managed(ManagedType::String)
}
struct Build {
    f: Func,
    ops: Vec<ValueId>,
}
impl Build {
    fn new(name: &str, result: HirType) -> Self {
        Self {
            f: function(name, &[F64], result),
            ops: vec![],
        }
    }
    fn op(&mut self, kind: OpKind, ty: HirType) -> ValueId {
        let id = value(&mut self.f, kind, ty);
        self.ops.push(id);
        id
    }
    fn array(&mut self, element: HirType, items: &[ValueId]) -> ValueId {
        let length = self.op(OpKind::ConstInt(items.len() as i128), U32);
        let a = self.op(
            OpKind::ArrayNew {
                length,
                zeroed: true,
            },
            array(element),
        );
        for (at, &item) in items.iter().enumerate() {
            let index = self.op(OpKind::ConstInt(at as i128), U32);
            self.op(
                OpKind::ArraySet {
                    array: a,
                    index,
                    value: item,
                    checked: true,
                },
                HirType::Void,
            );
        }
        a
    }
    fn element(&mut self, erased: ValueId) -> ValueId {
        let at = self.op(OpKind::Param(0), F64);
        let null_slot = self.op(OpKind::ConstInt(0), U32);
        self.op(
            OpKind::Call {
                callee: Callee::External("nts_array_element".into()),
                args: vec![erased, at, null_slot],
                frame: None,
            },
            HirType::Erased,
        )
    }
    /// The tag of `array[at]`, read through its erasure as the lowering emits it.
    fn tag_of_element(mut self, a: ValueId) -> Func {
        let erased = self.erase(a);
        let read = self.element(erased);
        let tag = self.op(OpKind::TagOf { value: read }, U32);
        self.finish(tag)
    }
    fn erase(&mut self, value: ValueId) -> ValueId {
        self.op(
            OpKind::Erase {
                value,
                absent: Absent::Impossible,
            },
            HirType::Erased,
        )
    }
    fn finish(mut self, result: ValueId) -> Func {
        self.f
            .blocks
            .push(block(&[], &self.ops, Terminator::Return(Some(result))));
        self.f
    }
}

/// A reference array with a null in its second slot, which the read refuses:
/// its storage does not say whether that null was `null` or `undefined`.
fn strings() -> Func {
    let mut b = Build::new("stringElement", U32);
    let s = b.op(OpKind::ConstString("s".into()), string());
    let null = b.op(OpKind::ConstNull, string());
    let a = b.array(string(), &[s, null]);
    b.tag_of_element(a)
}
fn nested() -> Func {
    let mut b = Build::new("nestedElement", U32);
    let inner = b.array(F64, &[]);
    let null = b.op(OpKind::ConstNull, array(F64));
    let a = b.array(array(F64), &[inner, null]);
    b.tag_of_element(a)
}
fn numbers() -> Func {
    let mut b = Build::new("numberElement", U32);
    let ten = b.op(OpKind::ConstFloat(10.0), F64);
    let twenty = b.op(OpKind::ConstFloat(20.0), F64);
    let a = b.array(F64, &[ten, twenty]);
    b.tag_of_element(a)
}
fn booleans() -> Func {
    let mut b = Build::new("booleanElement", U32);
    let yes = b.op(OpKind::ConstBool(true), HirType::Bool);
    let a = b.array(HirType::Bool, &[yes]);
    b.tag_of_element(a)
}
fn erased() -> Func {
    let mut b = Build::new("erasedElement", U32);
    let s = b.op(OpKind::ConstString("s".into()), string());
    let item = b.erase(s);
    let undefined = b.op(OpKind::ConstUndefined, HirType::Erased);
    let a = b.array(HirType::Erased, &[item, undefined]);
    b.tag_of_element(a)
}
/// The value read, not only its kind: the index selects the slot.
fn number_value() -> Func {
    let mut b = Build::new("numberValue", F64);
    let ten = b.op(OpKind::ConstFloat(10.0), F64);
    let twenty = b.op(OpKind::ConstFloat(20.0), F64);
    let a = b.array(F64, &[ten, twenty]);
    let erased = b.erase(a);
    let read = b.element(erased);
    let number = b.op(OpKind::Unerase { value: read }, F64);
    b.finish(number)
}

#[test]
fn element_reads_answer_what_node_answers() {
    let funcs = vec![
        strings(),
        nested(),
        numbers(),
        booleans(),
        erased(),
        number_value(),
    ];
    let emitted = nts_codegen_wasm::emit(&program(funcs)).unwrap();
    let output = common::run(
        "array-element",
        &emitted,
        "tooling/wasm/check-array-element.mjs",
        &[],
    );
    assert_eq!(output["cases"], 56, "{output}");
    assert_eq!(output["named_declines"], 2, "{output}");
}

/// The read goes to the array an erasure was made from where the call can see
/// it. An erased operand with no array behind it here, such as an `unknown[]`
/// slot that holds one, is read through whichever array storage it has
/// (`array.elementOf`), as C asks the descriptor: the module emits and
/// validates. The array-element fixture's `openAt` checks the answers.
#[test]
fn an_erased_operand_with_no_visible_array_is_read_through_its_storage() {
    let mut b = Build::new("opaque", U32);
    let inner = b.array(F64, &[]);
    let item = b.erase(inner);
    let outer = b.array(HirType::Erased, &[item]);
    let zero = b.op(OpKind::ConstInt(0), U32);
    let slot = b.op(
        OpKind::ArrayGet {
            array: outer,
            index: zero,
            checked: true,
        },
        HirType::Erased,
    );
    let read = b.element(slot);
    let tag = b.op(OpKind::TagOf { value: read }, U32);
    let f = b.finish(tag);
    nts_codegen_wasm::emit(&program(vec![f])).expect("an open element read emits");
}
