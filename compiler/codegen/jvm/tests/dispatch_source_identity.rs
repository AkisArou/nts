//! Source identities on the exact corpus materialization that publishes them.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use crate::scratch;

use camino::Utf8PathBuf;
use nts_core::hir::{DispatchRoot, features as identity};
use nts_frontend_ts::Frontend;

use crate::common;

fn fixture(
    case: &str,
) -> (
    scratch::StdScratchDir,
    nts_semantic_schema::SemanticSnapshot,
) {
    let root = common::repository();
    let project = scratch::StdScratchDir::in_std_target("dispatch-source");
    std::fs::create_dir_all(&project).unwrap();
    let materialized = std::process::Command::new("node")
        .current_dir(&root)
        .args([
            "--input-type=module",
            "-e",
            "import {readFileSync} from 'node:fs'; import {workspace, materialise} from './tooling/census/project.ts'; const [dir,file]=process.argv.slice(1); workspace(dir,'ts'); materialise(dir,readFileSync(file,'utf8'),file,'ts');",
        ])
        .arg(&project)
        .arg(root.join(case))
        .output()
        .unwrap();
    assert!(
        materialized.status.success(),
        "{}",
        String::from_utf8_lossy(&materialized.stderr)
    );
    let config = Utf8PathBuf::from_path_buf(project.join("tsconfig.json")).unwrap();
    let snapshot = Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(&config)
        .expect("actual stock materialization");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    (project, snapshot)
}

#[test]
fn an_iterator_library_root_keeps_its_declaration_identity() {
    let (_project, snapshot) =
        fixture("tests/typescript/iterator-routes-controls/exit-break-interface-control.ts");
    let prepared = common::prepare(&snapshot).expect("valid prepared HIR");
    let global = snapshot
        .symbols
        .iter()
        .enumerate()
        .find_map(|(at, _)| {
            identity::global_binding(
                &snapshot.symbols,
                nts_semantic_schema::SymbolId(u32::try_from(at).unwrap()),
                identity::GlobalMeaning::Type,
            )
            .unwrap()
            .filter(|global| global.name() == "IterableIterator")
        })
        .expect("the checked library type global");
    assert_eq!(
        global.record().declarations,
        [] as [nts_semantic_schema::NodeId; 0]
    );
    let declaration = global
        .record()
        .declaration_sites
        .iter()
        .map(|&site| snapshot.declaration_identity(site).unwrap())
        .min_by(|left, right| left.source.path.cmp(&right.source.path))
        .unwrap();
    let roots: std::collections::BTreeSet<_> = snapshot
        .types
        .iter()
        .enumerate()
        .filter(|(_, record)| record.symbol == Some(global.symbol()))
        .map(|(at, _)| nts_semantic_schema::TypeId(u32::try_from(at).unwrap()))
        .collect();
    let mut slots = Vec::new();
    for (&slot, row) in &prepared.program.member_origins.dispatch {
        let DispatchRoot::Named { source, .. } = &row.root else {
            continue;
        };
        if source.symbol == global.symbol().0 {
            assert_eq!(source.module, declaration.source.path.as_str());
            assert_eq!(source.scopes, [global.name()]);
            slots.push(slot);
        }
    }
    assert!(
        !slots.is_empty(),
        "actual library dispatch rows must survive"
    );
    let facts = nts_codegen_jvm::JvmProgram::new(&prepared.program);
    for slot in &slots {
        println!(
            "LIBRARY SLOT {slot}: {}",
            facts.dispatch_name(*slot as usize).unwrap()
        );
    }
    let emitted = nts_codegen_jvm::emit(&prepared.program);
    assert!(
        emitted.is_complete(),
        "an existing library dispatch identity was lost: {:?}",
        emitted.diagnostics
    );
    assert!(
        emitted
            .classes
            .iter()
            .any(|c| c.binary_name == "nts/gen/Program")
    );
    let mut missing = prepared.program.clone();
    let root = *roots.first().unwrap();
    for slot in slots {
        missing.member_origins.dispatch.get_mut(&slot).unwrap().root =
            DispatchRoot::Unavailable(root);
    }
    let refused = nts_codegen_jvm::emit(&missing);
    assert!(
        refused.classes.is_empty(),
        "missing source must prevent publication"
    );
    assert!(refused.diagnostics.iter().any(|d| d.code == "NTS4004"
        && d.message
            == format!(
                "dispatch root {} has no available source declaration identity",
                root.0
            )));
}

#[test]
fn an_async_generator_publishes_its_owned_resume_once() {
    let (_project, snapshot) =
        fixture("tests/typescript/proofs/bounds-exception-await-then-async-generator-yield.ts");
    let prepared = common::prepare(&snapshot).expect("valid async-generator HIR");
    let program = &prepared.program;
    let slot = program
        .member_origins
        .generator_resume
        .expect("the actual generator slot") as usize;
    let facts = nts_codegen_jvm::JvmProgram::new(program);
    let mut owners = std::collections::BTreeMap::new();
    for func in &program.funcs {
        for value in func.blocks.iter().flat_map(|block| &block.ops) {
            let nts_core::hir::OpKind::Suspend { frame, resume, .. } =
                &func.values[value.0 as usize].kind
            else {
                continue;
            };
            let nts_core::hir::HirType::Managed(nts_core::hir::ManagedType::Object(id)) =
                func.values[frame.0 as usize].ty
            else {
                continue;
            };
            let layout = facts.layout(id).unwrap();
            let Some(Some(target)) = layout.methods.get(slot) else {
                continue;
            };
            println!(
                "RESUME_OWNER layout={} slot={slot} dispatched={target:?} suspended={resume:?}",
                layout.name
            );
            assert_eq!(
                target, resume,
                "one actual resume implementation owns both requests"
            );
            owners.insert(id, resume.clone());
        }
    }
    assert!(
        !owners.is_empty(),
        "the fixture must reach both resume producers"
    );
    let emitted = nts_codegen_jvm::emit(program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    for (id, resume) in owners {
        let name = nts_codegen_jvm::types::class_name(
            nts_codegen_jvm::types::DEFAULT_PACKAGE,
            facts.layout(id).unwrap(),
        );
        let class = emitted
            .classes
            .iter()
            .find(|c| c.binary_name == name)
            .expect("actual frame class");
        let parsed = nts_jvm_emitter::read::class_file(&class.bytes).unwrap();
        assert_eq!(
            parsed
                .methods
                .iter()
                .filter(|m| m.name == nts_codegen_jvm::generated_members::RESUME
                    && m.descriptor == "()V")
                .count(),
            1,
            "one physical method for the same owned resume"
        );
        assert_conflicting_resume_is_refused(program, id, &resume, slot);
    }
}

fn assert_conflicting_resume_is_refused(
    program: &nts_core::hir::Program,
    frame: nts_semantic_schema::TypeId,
    resume: &str,
    slot: usize,
) {
    let mut conflict = program.clone();
    let mut other = program
        .funcs
        .iter()
        .find(|f| f.name == resume)
        .unwrap()
        .clone();
    other.name = "counterfactualResume".into();
    assert!(!program.funcs.iter().any(|f| f.name == other.name));
    conflict
        .layouts
        .iter_mut()
        .find(|layout| layout.types.contains(&frame))
        .unwrap()
        .methods[slot] = Some(other.name.clone());
    conflict.funcs.push(other);
    assert_eq!(nts_core::hir::verify::verify(&conflict), Ok(()));
    let facts = nts_codegen_jvm::JvmProgram::new(&conflict);
    let name = nts_codegen_jvm::types::class_name(
        nts_codegen_jvm::types::DEFAULT_PACKAGE,
        facts.layout(frame).unwrap(),
    );
    let emitted = nts_codegen_jvm::emit(&conflict);
    assert!(!emitted.classes.iter().any(|c| c.binary_name == name));
    assert!(
        emitted.diagnostics.iter().any(|d| d.code == "NTS4001"
            && d.message.contains(resume)
            && d.message.contains("counterfactualResume")),
        "a different actual resume owner must conflict: {:?}",
        emitted.diagnostics
    );
}
