//! Hand-built representation tests, independent of source lowering's later L4
//! producers. C, LLVM and JVM must transport the same logical values.
#![allow(dead_code)]
use nts_core::hir::{
    self, Absent, Block, BlockId, Callee, Func, HirType, Op, OpKind, Param, Program, Terminator,
    ValueId,
};
use nts_semantic_schema::Origin;

pub(crate) fn origin() -> Origin {
    Origin::source(nts_diagnostics::Location {
        file: nts_diagnostics::SourceId(0),
        span: nts_diagnostics::Span::new(0, 1),
    })
}

pub(crate) fn optional(payload: &HirType) -> HirType {
    HirType::PossiblyUndefined(Box::new(payload.clone()))
}
pub(crate) fn op(kind: OpKind, ty: HirType) -> Op {
    Op {
        kind,
        ty,
        origin: origin(),
    }
}

fn function(
    name: String,
    parameters: &[HirType],
    returns: HirType,
    mut values: Vec<Op>,
    blocks: Vec<Block>,
) -> Func {
    let params = parameters
        .iter()
        .enumerate()
        .map(|(i, ty)| Param {
            name: format!("p{i}"),
            ty: ty.clone(),
            origin: origin(),
            shape: hir::ParamShape::Ordinary,
            known: hir::facts::Facts::TOP,
            written: None,
        })
        .collect();
    for (i, ty) in parameters.iter().enumerate().rev() {
        values.insert(
            0,
            op(
                OpKind::Param(u32::try_from(i).expect("small fixture")),
                ty.clone(),
            ),
        );
    }
    Func {
        name,
        params,
        return_type: returns,
        values,
        blocks,
        origin: origin(),
        exported: true,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: vec![],
        exact: std::iter::empty().collect(),
        written_return: None,
        result_absent: Absent::Impossible,
        validation: None,
        written_return_elements: vec![],
    }
}
fn block(ops: &[u32], terminator: Terminator) -> Block {
    Block {
        params: vec![],
        ops: ops.iter().map(|id| ValueId(*id)).collect(),
        terminator,
    }
}
fn returned(id: u32) -> Terminator {
    Terminator::Return(Some(ValueId(id)))
}

pub(crate) fn payloads() -> Vec<(&'static str, HirType)> {
    let mut result = vec![
        ("Bool", HirType::Bool),
        ("F32", HirType::Float { bits: 32 }),
        ("F64", HirType::NUMBER),
        ("BigInt", HirType::BigInt),
        (
            "Pointer",
            HirType::NativePointer(hir::native::Pointee::Void),
        ),
    ];
    for (name, bits, signed) in [
        ("I8", 8, true),
        ("U8", 8, false),
        ("I16", 16, true),
        ("U16", 16, false),
        ("I32", 32, true),
        ("U32", 32, false),
        ("I64", 64, true),
        ("U64", 64, false),
    ] {
        result.push((name, HirType::Int { bits, signed }));
    }
    result
}

pub(crate) fn program() -> Program {
    let mut program = Program::default();
    for (name, payload) in payloads()
        .into_iter()
        .chain([("Reference", HirType::Managed(hir::ManagedType::String))])
    {
        append_basics(&mut program, name, &payload);
        append_reads(&mut program, name, payload.clone());
        append_swap(&mut program, name, &payload);
    }
    append_recursive(&mut program);
    append_allocated_reference(&mut program);
    program.public_api = program
        .funcs
        .iter()
        .map(|f| (f.name.clone(), f.name.clone()))
        .collect();
    program
}

fn append_basics(program: &mut Program, name: &str, payload: &HirType) {
    let pair = optional(payload);
    let mut exhausted_params = vec![
        HirType::Int {
            bits: 64,
            signed: true
        };
        6
    ];
    exhausted_params.push(pair.clone());
    program.funcs.push(function(
        format!("exhausted{name}"),
        &exhausted_params,
        pair.clone(),
        vec![],
        vec![block(&[0, 1, 2, 3, 4, 5, 6], returned(6))],
    ));
    program.funcs.push(function(
        format!("make{name}"),
        &[HirType::Bool, payload.clone()],
        pair.clone(),
        vec![op(
            OpKind::Optional {
                defined: ValueId(0),
                payload: ValueId(1),
            },
            pair.clone(),
        )],
        vec![block(&[0, 1, 2], returned(2))],
    ));
    program.funcs.push(function(
        format!("identity{name}"),
        std::slice::from_ref(&pair),
        pair.clone(),
        vec![],
        vec![block(&[0], returned(0))],
    ));
    program.funcs.push(function(
        format!("defined{name}"),
        std::slice::from_ref(&pair),
        HirType::Bool,
        vec![op(OpKind::OptionalDefined(ValueId(0)), HirType::Bool)],
        vec![block(&[0, 1], returned(1))],
    ));
}

fn append_reads(program: &mut Program, name: &str, payload: HirType) {
    let pair = optional(&payload);
    program.funcs.push(function(
        format!("read{name}"),
        &[pair.clone(), payload.clone()],
        payload.clone(),
        vec![
            op(OpKind::OptionalDefined(ValueId(0)), HirType::Bool),
            op(OpKind::OptionalPayload(ValueId(0)), payload.clone()),
        ],
        vec![
            block(
                &[0, 1, 2],
                Terminator::Branch {
                    cond: ValueId(2),
                    then_target: BlockId(1),
                    then_args: vec![],
                    else_target: BlockId(2),
                    else_args: vec![],
                },
            ),
            block(&[3], returned(3)),
            block(&[], returned(1)),
        ],
    ));
    program.funcs.push(function(
        format!("roundtrip{name}"),
        &[HirType::Bool, payload.clone(), payload.clone()],
        payload.clone(),
        vec![
            op(
                OpKind::Call {
                    callee: Callee::Direct(format!("make{name}")),
                    args: vec![ValueId(0), ValueId(1)],
                    frame: None,
                },
                pair.clone(),
            ),
            op(
                OpKind::Call {
                    callee: Callee::Direct(format!("identity{name}")),
                    args: vec![ValueId(3)],
                    frame: None,
                },
                pair,
            ),
            op(
                OpKind::Call {
                    callee: Callee::Direct(format!("read{name}")),
                    args: vec![ValueId(4), ValueId(2)],
                    frame: None,
                },
                payload,
            ),
        ],
        vec![block(&[0, 1, 2, 3, 4, 5], returned(5))],
    ));
}

fn append_swap(program: &mut Program, name: &str, payload: &HirType) {
    let pair = optional(payload);
    // Entry values are distinct SSA roots; the backedge swaps both complete
    // values and forces a parallel-copy cycle in a split-local backend.
    program.funcs.push(function(
        format!("swap{name}"),
        &[HirType::Bool, pair.clone(), pair.clone()],
        pair.clone(),
        vec![
            op(OpKind::BlockParam(0), HirType::Bool),
            op(OpKind::BlockParam(1), pair.clone()),
            op(OpKind::BlockParam(2), pair),
            op(OpKind::ConstBool(false), HirType::Bool),
        ],
        vec![
            block(
                &[0, 1, 2],
                Terminator::Jump {
                    target: BlockId(1),
                    args: vec![ValueId(0), ValueId(1), ValueId(2)],
                },
            ),
            Block {
                params: vec![ValueId(3), ValueId(4), ValueId(5)],
                ops: vec![],
                terminator: Terminator::Branch {
                    cond: ValueId(3),
                    then_target: BlockId(2),
                    then_args: vec![],
                    else_target: BlockId(3),
                    else_args: vec![],
                },
            },
            block(
                &[6],
                Terminator::Jump {
                    target: BlockId(1),
                    args: vec![ValueId(6), ValueId(5), ValueId(4)],
                },
            ),
            block(&[], returned(4)),
        ],
    ));
}

fn append_recursive(program: &mut Program) {
    let int = HirType::Int {
        bits: 32,
        signed: true,
    };
    let pair = optional(&HirType::NUMBER);
    program.funcs.push(function(
        "recursiveF64".into(),
        &[int.clone(), pair.clone()],
        pair.clone(),
        vec![
            op(OpKind::ConstInt(0), int.clone()),
            op(
                OpKind::Binary {
                    op: hir::BinOp::Le,
                    lhs: ValueId(0),
                    rhs: ValueId(2),
                },
                HirType::Bool,
            ),
            op(OpKind::ConstInt(1), int.clone()),
            op(
                OpKind::Binary {
                    op: hir::BinOp::Sub,
                    lhs: ValueId(0),
                    rhs: ValueId(4),
                },
                int.clone(),
            ),
            op(
                OpKind::Call {
                    callee: Callee::Direct("recursiveF64".into()),
                    args: vec![ValueId(5), ValueId(1)],
                    frame: None,
                },
                pair.clone(),
            ),
            op(
                OpKind::Call {
                    callee: Callee::Direct("identityF64".into()),
                    args: vec![ValueId(6)],
                    frame: None,
                },
                pair,
            ),
        ],
        vec![
            block(
                &[0, 1, 2, 3],
                Terminator::Branch {
                    cond: ValueId(3),
                    then_target: BlockId(1),
                    then_args: vec![],
                    else_target: BlockId(2),
                    else_args: vec![],
                },
            ),
            block(&[], returned(1)),
            block(&[4, 5, 6, 7], returned(7)),
        ],
    ));
}

fn append_allocated_reference(program: &mut Program) {
    let string = HirType::Managed(hir::ManagedType::String);
    program.funcs.push(function(
        "allocatedReference".to_owned(),
        &[HirType::Bool],
        optional(&string),
        vec![
            op(OpKind::ConstString("a".into()), string.clone()),
            op(OpKind::ConstString("b".into()), string.clone()),
            op(
                OpKind::Binary {
                    op: hir::BinOp::Concat,
                    lhs: ValueId(1),
                    rhs: ValueId(2),
                },
                string.clone(),
            ),
            op(
                OpKind::Optional {
                    defined: ValueId(0),
                    payload: ValueId(3),
                },
                optional(&string),
            ),
        ],
        vec![block(&[0, 1, 2, 3, 4], returned(4))],
    ));
}

pub(crate) const NATIVE_DRIVER: &str = r#"
#include "program.h"
#include <stdio.h>
#define CHECK(Name, Type, A, B) do { \
  Type a=(A); Type b=(B); \
  for (int d=0;d<2;d++) { \
    NtsOptional##Name p=identity##Name(make##Name(d,a)); \
    p=exhausted##Name(0,1,2,3,4,5,p); \
    NtsOptional##Name other=make##Name(!d,b); \
    if(defined##Name(swap##Name(false,p,other))!=(d!=0) || defined##Name(swap##Name(true,p,other))!=(d==0)) return __LINE__; \
    if(read##Name(swap##Name(false,p,other),b)!=(d?a:b) || read##Name(swap##Name(true,p,other),a)!=(!d?b:a)) return __LINE__; \
    if (defined##Name(p)!=(d!=0) || read##Name(p,b)!=(d?a:b) || roundtrip##Name(d,a,b)!=(d?a:b)) return __LINE__; \
  } \
} while(0)
int main(void) {
  CHECK(Bool,bool,true,false);
  CHECK(I8,int8_t,INT8_MIN,INT8_MAX); CHECK(U8,uint8_t,UINT8_MAX,0);
  CHECK(I16,int16_t,INT16_MIN,INT16_MAX); CHECK(U16,uint16_t,UINT16_MAX,0);
  CHECK(I32,int32_t,INT32_MIN,INT32_MAX); CHECK(U32,uint32_t,UINT32_MAX,0);
  CHECK(I64,int64_t,INT64_MIN,INT64_MAX); CHECK(U64,uint64_t,UINT64_MAX,0);
  CHECK(BigInt,__int128,((__int128)INT64_MIN)*2,((__int128)UINT64_MAX)*2);
  CHECK(F32,float,-0.0f,9.5f);
  NtsOptionalF64 recursive = recursiveF64(12, makeF64(true, -0.0));
  if(!definedF64(recursive) || !signbit(readF64(recursive, 1.0))) return __LINE__;
  if(definedF64(recursiveF64(12,makeF64(false,4.0)))) return __LINE__;
  int slot; CHECK(Pointer,void *,&slot,NULL);
  const uint32_t fbits[]={0,UINT32_C(0x80000000),UINT32_C(0x7f800000),UINT32_C(0xff800000),UINT32_C(0x7fc00001),UINT32_C(0x7fffffff),UINT32_C(0xffc12345),1,UINT32_C(0x3f800000)};
  for(size_t i=0;i<sizeof fbits/sizeof fbits[0];i++) for(int d=0;d<2;d++) {
    float x; memcpy(&x,&fbits[i],4);
    NtsOptionalF32 p=swapF32(true,makeF32(!d,-99.0f),identityF32(makeF32(d,x)));
    float read=readF32(p,-99.0f), through=roundtripF32(d,x,-99.0f), fallback=-99.0f;
    uint32_t a,b,f; memcpy(&a,&read,4); memcpy(&b,&through,4); memcpy(&f,&fallback,4);
    uint32_t want=d?fbits[i]:f;
    if(definedF32(p)!=(d!=0) || a!=want || b!=want) return 29;
  }
  const uint64_t bits[]={0,UINT64_C(0x8000000000000000),UINT64_C(0x7ff0000000000000),UINT64_C(0xfff0000000000000),UINT64_C(0x7ff8000000000001),UINT64_C(0x7fffffffffffffff),UINT64_C(0xfff8123456789abc),UINT64_C(1),UINT64_C(0x3ff0000000000000)};
  for (size_t i=0;i<sizeof bits/sizeof bits[0];i++) for(int d=0;d<2;d++) {
    double x; memcpy(&x,&bits[i],8);
    NtsOptionalF64 p=swapF64(true,makeF64(!d,-99.0),identityF64(makeF64(d,x)));
    double read=readF64(p,-99.0), through=roundtripF64(d,x,-99.0);
    uint64_t a,b,fallback; double f=-99.0;
    memcpy(&a,&read,8); memcpy(&b,&through,8); memcpy(&fallback,&f,8);
    uint64_t want=d?bits[i]:fallback;
    if (definedF64(p)!=(d!=0) || a!=want || b!=want) return 30;
  }
  for(int repeat=0;repeat<100;repeat++) for(int d=0;d<2;d++) {
    NtsHeader *null=identityReference(makeReference(d,NULL));
    if (definedReference(null)!=(d!=0) || null!=(d?NULL:NTS_UNDEFINED_REFERENCE)) return 31;
    nts_release(null);
    NtsHeader *owned=allocatedReference(d);
    if (definedReference(owned)!=(d!=0)) return 32;
    if (d && ((NtsString *)owned)->length!=2) return 33;
    nts_release(owned); nts_collect_cycles();
#ifdef NTS_PROVIDER_RC
    if(nts_live_count()!=0 || nts_live_bytes()!=0) return 34;
#endif
  }
  puts("optional transport and ownership passed");
  return 0;
}
"#;
