#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

use nts_core::hir::{self, Block, Func, HirType, Op, OpKind, Param, Program, Terminator, ValueId};
use nts_diagnostics::{Location, SourceId, Span};
use nts_semantic_schema::Origin;
use std::path::{Path, PathBuf};
use std::process::Command;

pub(crate) const I32: HirType = HirType::Int {
    bits: 32,
    signed: true,
};
pub(crate) const U32: HirType = HirType::Int {
    bits: 32,
    signed: false,
};
pub(crate) const F64: HirType = HirType::Float { bits: 64 };

pub(crate) fn origin() -> Origin {
    Origin::source(Location {
        file: SourceId(0),
        span: Span::new(0, 1),
    })
}

pub(crate) fn function(name: &str, params: &[HirType], result: HirType) -> Func {
    Func {
        name: name.to_owned(),
        params: params
            .iter()
            .enumerate()
            .map(|(at, ty)| Param {
                name: format!("p{at}"),
                ty: ty.clone(),
                origin: origin(),
                shape: hir::ParamShape::Ordinary,
                known: hir::facts::Facts::TOP,
                written: None,
            })
            .collect(),
        return_type: result,
        written_return: None,
        written_return_elements: Vec::new(),
        values: Vec::new(),
        blocks: Vec::new(),
        origin: origin(),
        exported: true,
        initializes_receiver: false,
        abstract_declaration: false,
        async_result: None,
        frame: None,
        obligations: Vec::new(),
    }
}

pub(crate) fn value(func: &mut Func, kind: OpKind, ty: HirType) -> ValueId {
    let id = ValueId(u32::try_from(func.values.len()).unwrap());
    func.values.push(Op {
        kind,
        ty,
        origin: origin(),
    });
    id
}

pub(crate) fn block(params: &[ValueId], ops: &[ValueId], terminator: Terminator) -> Block {
    Block {
        params: params.to_vec(),
        ops: ops.to_vec(),
        terminator,
    }
}

pub(crate) fn program(funcs: Vec<Func>) -> Program {
    Program {
        provider: nts_core::hir::Provider::HostGc,
        public_api: funcs
            .iter()
            .map(|f| (f.name.clone(), f.name.clone()))
            .collect(),
        funcs,
        ..Program::default()
    }
}

pub(crate) fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../..")
        .canonicalize()
        .unwrap()
}

pub(crate) fn run(
    label: &str,
    emitted: &nts_codegen_wasm::Emitted,
    script: &str,
    args: &[&Path],
) -> serde_json::Value {
    let artifact = std::env::temp_dir().join(format!("nts-wasm-{label}-{}", std::process::id()));
    std::fs::create_dir_all(&artifact).unwrap();
    std::fs::write(artifact.join("program.wasm"), &emitted.bytes).unwrap();
    std::fs::write(
        artifact.join("program.json"),
        serde_json::to_vec_pretty(&emitted.manifest).unwrap(),
    )
    .unwrap();
    std::fs::write(artifact.join("node.mjs"), nts_codegen_wasm::NODE_LOADER).unwrap();
    let result = Command::new("node")
        .arg(repository().join(script))
        .arg(&artifact)
        .args(args)
        .output()
        .expect("Node installed");
    assert!(
        result.status.success(),
        "artifact {}\n{}\n{}",
        artifact.display(),
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    );
    let output = serde_json::from_slice(&result.stdout).unwrap();
    std::fs::remove_dir_all(artifact).unwrap();
    output
}
