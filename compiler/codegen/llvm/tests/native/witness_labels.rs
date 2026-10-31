//! Private generated identifiers leave ordinary C header identifiers available.

use super::{Command, hir, prepare_with_files};

const BINDING: &str = r#"/** @ntsHeader witness-labels.h */
declare module 'c:witness-labels' {
import type {c_int} from '@nts/scalars';
import type {Ptr,Struct} from 'c:types';
type F=(value:c_int)=>c_int;
export type Table=Ptr<Struct<{callback:F,value:c_int},"callback_table">>;
export function get_table():Table;
}"#;
const SOURCE: &str = "import {get_table} from 'c:witness-labels'; export function run():number {return get_table().value;}";
const HEADER: &str = "struct callback_table {int (*callback)(int); int value;};\nstruct callback_table *get_table(void);\n";

fn check_header_namespace(program: bool) {
    let (dir, prepared) = prepare_with_files(
        "native-private-label-namespace",
        SOURCE,
        hir::Memory::NoGc,
        &[("witness-labels.d.ts", BINDING)],
    );
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let emitted = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics);
    let text = if program {
        emitted.writer.text().to_owned()
    } else {
        emitted.witness.clone()
    };
    let generated = text.lines().find_map(|line| {
        let line = line.strip_prefix("typedef ")?;
        let (_, pointer) = line.split_once("(*")?;
        pointer.split_once(')').map(|(name, _)| name.to_owned())
    });
    // If the compiler uses an ordinary identifier, exercise that exact name;
    // an implementation-reserved identifier belongs to the compiler, so the
    // header instead supplies an unrelated ordinary name. Older anonymous
    // witnesses have no generated callback alias and use that same control.
    let ordinary = generated
        .filter(|name| !name.starts_with('_'))
        .unwrap_or_else(|| "HeaderCallbackDecoy".to_owned());
    for file in emitted.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(dir.join("program.c"), emitted.writer.text()).unwrap();
    let input = if program {
        "program.c"
    } else {
        nts_codegen_c::NATIVE_WITNESS_NAME
    };
    let mut failed = Vec::new();
    for control in [false, true] {
        // The sole changed token is the name of this unrelated header typedef.
        let name = if control {
            format!("{ordinary}_user")
        } else {
            ordinary.clone()
        };
        std::fs::write(
            dir.join("witness-labels.h"),
            format!("{HEADER}typedef int {name};\n"),
        )
        .unwrap();
        let result = Command::new("clang")
            .args(["-I.", "-Werror", "-fsyntax-only", input])
            .current_dir(&dir)
            .output()
            .unwrap();
        println!(
            "NATIVE_PRIVATE_LABEL program={program} control={control} success={}",
            result.status.success()
        );
        if !result.status.success() {
            failed.push(format!(
                "program={program} control={control}: {}",
                String::from_utf8_lossy(&result.stderr)
            ));
        }
    }
    assert!(failed.is_empty(), "{}", failed.join("\n"));
}

#[test]
fn private_witness_aliases_preserve_the_header_namespace() {
    check_header_namespace(false);
}

#[test]
fn private_callback_aliases_preserve_the_header_namespace() {
    check_header_namespace(true);
}

#[test]
fn private_source_names_do_not_redeclare_header_functions() {
    for provider in [hir::Memory::NoGc, hir::Memory::ReferenceCounting] {
        for control in [false, true] {
            let name = if control { "open_user" } else { "open" };
            let source = format!(
                "import {{get_table}} from 'c:witness-labels'; function {name}(value:number):number {{ let result=value; for(let i=0;i<3;i++) result+=i; return result; }} export function run():number {{return {name}(get_table().value);}}"
            );
            let (dir, prepared) = prepare_with_files(
                "private-source-header-name",
                &source,
                provider,
                &[("witness-labels.d.ts", BINDING)],
            );
            assert!(
                prepared.diagnostics.is_empty(),
                "{:?}",
                prepared.diagnostics
            );
            let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
            let again = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
            assert!(c.is_complete(), "{:?}", c.diagnostics);
            assert_eq!(c.writer.text(), again.writer.text());
            assert_eq!(c.header, again.header);
            assert!(
                c.writer.text().contains(&format!("__nts_fn_{name}_")),
                "{}",
                c.writer.text()
            );
            for file in c.support_files() {
                file.write(dir.as_std_path()).unwrap();
            }
            std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
            std::fs::write(
                dir.join("witness-labels.h"),
                format!(
                    "{HEADER}int open(const char *,int,...);\nint open_(const char *,int,...);\n"
                ),
            )
            .unwrap();
            std::fs::write(dir.join("library.c"), "#include \"witness-labels.h\"\nstatic struct callback_table table={0,17}; struct callback_table *get_table(void){return &table;}\n").unwrap();
            std::fs::write(
                dir.join("caller.c"),
                "#include \"program.h\"\nint main(void){return run()!=20;}\n",
            )
            .unwrap();
            let llvm =
                nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
            assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
            let repeated =
                nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
            assert_eq!(
                llvm.text, repeated.text,
                "source identity labels changed between emissions"
            );
            std::fs::write(dir.join("program.ll"), llvm.text).unwrap();
            for input in [nts_codegen_c::NATIVE_WITNESS_NAME, "program.c"] {
                let result = Command::new("clang")
                    .args(["-I.", "-Werror", "-fsyntax-only", input])
                    .current_dir(&dir)
                    .output()
                    .unwrap();
                assert!(
                    result.status.success(),
                    "{}",
                    String::from_utf8_lossy(&result.stderr)
                );
            }
            for input in ["program.c", "program.ll"] {
                let mut cc = Command::new("clang");
                cc.current_dir(&dir).args([
                    "-I.",
                    "-O0",
                    input,
                    "library.c",
                    "caller.c",
                    "nts_runtime.c",
                    "-lm",
                    "-o",
                    "run",
                ]);
                if provider == hir::Memory::ReferenceCounting {
                    cc.arg("-DNTS_PROVIDER_RC");
                }
                let result = cc.output().unwrap();
                assert!(
                    result.status.success(),
                    "{}",
                    String::from_utf8_lossy(&result.stderr)
                );
                let result = Command::new(dir.join("run")).output().unwrap();
                assert!(
                    result.status.success(),
                    "{input} {provider:?} control={control}: {:?} {}",
                    result.status,
                    String::from_utf8_lossy(&result.stderr)
                );
            }
        }
    }
}

const HELPER_SCOPE_CALLER: &str = r#"#include "program.h"
static unsigned visits;
static void visited(NtsHeader *object){if(object)++visits;}
int main(void){
    if(run()!=5)return 1;
    NtsHeader *box=(NtsHeader *)make();
    if(!box || !box->descriptor->release_fields)return 2;
#ifdef NTS_PROVIDER_RC
    if(!box->descriptor->trace_fields)return 3;
    box->descriptor->trace_fields(box,visited);
    if(visits!=2)return 4;
    nts_release(box);
#else
    (void)visited;
    box->descriptor->release_fields(box);
#endif
    return 0;
}
"#;

#[test]
fn helper_parameter_declarations_and_uses_share_their_scope() {
    let source = r#"
export class Box {
    text: string;
    erased: unknown;
    constructor(text: string, erased: unknown) { this.text=text; this.erased=erased; }
}
export function make(): Box { return new Box("kept", "erased"); }
export function run(): number {
    const box=make();
    return box.text.length+(typeof box.erased==="string" ? 1 : 0);
}
"#;
    let oracle = source
        .replace(": string", "")
        .replace(": unknown", "")
        .replace(": number", "")
        .replace(": Box", "");
    let expected = Command::new("node")
        .args([
            "--input-type=module",
            "-e",
            &format!("{oracle}\nconsole.log(run());"),
        ])
        .output()
        .unwrap();
    assert!(
        expected.status.success(),
        "{}",
        String::from_utf8_lossy(&expected.stderr)
    );
    assert_eq!(String::from_utf8_lossy(&expected.stdout).trim(), "5");
    for provider in [hir::Memory::NoGc, hir::Memory::ReferenceCounting] {
        let (dir, prepared) = prepare_with_files("private-helper-scope", source, provider, &[]);
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        assert!(
            c.writer.text().contains("__nts_release_fields_"),
            "{}",
            c.writer.text()
        );
        if provider == hir::Memory::ReferenceCounting {
            assert!(
                c.writer.text().contains("__nts_trace_fields_"),
                "{}",
                c.writer.text()
            );
        }
        for file in c.support_files() {
            file.write(dir.as_std_path()).unwrap();
        }
        std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
        let llvm =
            nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
        assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
        std::fs::write(dir.join("program.ll"), llvm.text).unwrap();
        std::fs::write(dir.join("caller.c"), HELPER_SCOPE_CALLER).unwrap();
        for input in ["program.c", "program.ll"] {
            let mut cc = Command::new("clang");
            cc.current_dir(&dir).args([
                "-I.",
                "-O0",
                input,
                "caller.c",
                "nts_runtime.c",
                "-lm",
                "-o",
                "run",
            ]);
            if provider == hir::Memory::ReferenceCounting {
                cc.arg("-DNTS_PROVIDER_RC");
            }
            let result = cc.output().unwrap();
            assert!(
                result.status.success(),
                "{}",
                String::from_utf8_lossy(&result.stderr)
            );
            let result = Command::new(dir.join("run")).output().unwrap();
            assert!(
                result.status.success(),
                "{input} {provider:?}: {:?} {}",
                result.status,
                String::from_utf8_lossy(&result.stderr)
            );
        }
    }
}
