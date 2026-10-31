use super::{Command, hir, prepare_with_files};

#[test]
fn authored_native_symbols_are_not_generated_thunks_by_prefix() {
    let mut failures = Vec::new();
    for control in [true, false] {
        // Only the authored C function name changes; neither program creates
        // a GObject class or a compiler-generated native thunk.
        let name = if control {
            "header_type_probe"
        } else {
            "nts_gobject_type_probe"
        };
        let binding = format!(
            "/** @ntsHeader witness-labels.h */ declare module 'c:witness-labels' {{ import type {{c_int}} from '@nts/scalars'; export function {name}():c_int; }}"
        );
        let source = format!(
            "import {{{name}}} from 'c:witness-labels'; export function run():number {{ return {name}(); }}"
        );
        let (dir, prepared) = prepare_with_files(
            "authored-native-thunk-prefix",
            &source,
            hir::Memory::NoGc,
            &[("witness-labels.d.ts", &binding)],
        );
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        for file in c.support_files() {
            file.write(dir.as_std_path()).unwrap();
        }
        std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
        let llvm =
            nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
        assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
        std::fs::write(dir.join("program.ll"), llvm.text).unwrap();
        std::fs::write(dir.join("witness-labels.h"), format!("int {name}(void);\n")).unwrap();
        std::fs::write(
            dir.join("library.c"),
            format!("#include \"witness-labels.h\"\nint {name}(void){{return 7;}}\n"),
        )
        .unwrap();
        std::fs::write(
            dir.join("caller.c"),
            "#include \"program.h\"\nint main(void){return run()!=7;}\n",
        )
        .unwrap();
        for input in ["program.ll", "program.c"] {
            let result = Command::new("clang")
                .current_dir(&dir)
                .args([
                    "-I.",
                    input,
                    "library.c",
                    "caller.c",
                    "nts_runtime.c",
                    "-lm",
                    "-o",
                    "run",
                ])
                .output()
                .unwrap();
            if !result.status.success() {
                failures.push(format!(
                    "{input} control={control}: {}",
                    String::from_utf8_lossy(&result.stderr)
                ));
                continue;
            }
            if !Command::new(dir.join("run")).status().unwrap().success() {
                failures.push(format!("{input} control={control}: execution failed"));
            }
        }
    }
    assert!(failures.is_empty(), "{}", failures.join("\n"));
}

const PROPERTY_HEADER: &str = "void *object(void); int current(void); int header_get(void *); void header_set(void *,int); void header_construct(void *,int);\n";
const PROPERTY_LIBRARY: &str = r#"#include <stdarg.h>
#include "witness-labels.h"
static int value;
void *object(void){return &value;}
int current(void){return value;}
int header_get(void *object){(void)object;return 7;}
void header_set(void *object,int given){(void)given;*(int *)object=7;}
void header_construct(void *object,int given){(void)given;*(int *)object=7;}
void g_object_get(void *object,const char *property,...){(void)object;(void)property;va_list args;va_start(args,property);*va_arg(args,int *)=17;va_end(args);}
void g_object_set(void *object,const char *property,...){(void)property;va_list args;va_start(args,property);*(int *)object=va_arg(args,int);va_end(args);}
void nts_gobject_with_builder_add(void *object,const char *property,...){(void)property;va_list args;va_start(args,property);*(int *)object=va_arg(args,int);va_end(args);}
"#;

fn execute_producer(binding: &str, source: &str, header: &str, library: &str, expected: u32) {
    let (dir, prepared) = prepare_with_files(
        "native-producer-control",
        source,
        hir::Memory::NoGc,
        &[("witness-labels.d.ts", binding)],
    );
    assert!(
        prepared.diagnostics.is_empty(),
        "{:?}",
        prepared.diagnostics
    );
    let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    assert!(c.is_complete(), "{:?}", c.diagnostics);
    for file in c.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    std::fs::write(dir.join("program.ll"), llvm.text).unwrap();
    std::fs::write(dir.join("witness-labels.h"), header).unwrap();
    std::fs::write(dir.join("library.c"), library).unwrap();
    std::fs::write(
        dir.join("caller.c"),
        format!("#include \"program.h\"\n#include <stdio.h>\nint main(void){{double value=run();printf(\"%.17g\\n\",value);return value!={expected};}}\n"),
    )
    .unwrap();
    for input in ["program.c", "program.ll"] {
        let linked = Command::new("clang")
            .current_dir(&dir)
            .args([
                "-I.",
                input,
                "library.c",
                "caller.c",
                "nts_runtime.c",
                "-lm",
                "-o",
                "run",
            ])
            .output()
            .unwrap();
        assert!(
            linked.status.success(),
            "{input}: {}",
            String::from_utf8_lossy(&linked.stderr)
        );
        let executed = Command::new(dir.join("run")).output().unwrap();
        assert!(
            executed.status.success(),
            "{input}: expected {expected}, {:?}, stdout={}, stderr={}",
            executed.status,
            String::from_utf8_lossy(&executed.stdout),
            String::from_utf8_lossy(&executed.stderr)
        );
    }
}

#[test]
fn each_by_name_operation_dispatches_on_its_intrinsic_tag() {
    for (operation, symbol, parameters, result) in [
        ("get", "header_get", "object:Ptr<void>", "c_int"),
        ("set", "header_set", "object:Ptr<void>,value:c_int", "void"),
        (
            "construct",
            "header_construct",
            "object:Ptr<void>,value:c_int",
            "void",
        ),
    ] {
        for tagged in [false, true] {
            // This one declaration tag is the only difference in each pair.
            let tag = if tagged {
                format!("@ntsIntrinsic gobject.{operation}-by-name i value")
            } else {
                String::new()
            };
            let binding = format!(
                "/** @ntsHeader witness-labels.h */ declare module 'c:witness-labels' {{ import type {{c_int}} from '@nts/scalars'; import type {{Ptr}} from 'c:types'; export function object():Ptr<void>; export function current():c_int;\n/** @ntsSymbol {symbol}\n * {tag}\n */ export function action({parameters}):{result}; }}"
            );
            let body = if operation == "get" {
                "return action(object());"
            } else {
                "action(object(),9 as c_int);return current();"
            };
            let source = format!(
                "import {{action,object,current}} from 'c:witness-labels';import type {{c_int}} from '@nts/scalars';export function run():number{{{body}}}"
            );
            let expected = if !tagged {
                7
            } else if operation == "get" {
                17
            } else {
                9
            };
            execute_producer(
                &binding,
                &source,
                PROPERTY_HEADER,
                PROPERTY_LIBRARY,
                expected,
            );
        }
    }
}

#[test]
fn authored_gtype_tags_keep_declared_function_provenance() {
    for control in [true, false] {
        let name = if control {
            "header_type_probe"
        } else {
            "nts_gobject_type_probe"
        };
        let binding = format!(
            "/** @ntsHeader witness-labels.h */ declare module 'c:witness-labels' {{ import type {{c_size_t}} from '@nts/scalars'; export function {name}():c_size_t; export const Probe:{{\n/** @ntsGType {name} */\nreadonly __c_gtype:c_size_t;\nreadonly $gtype:c_size_t;\n}}; }}"
        );
        let source = "import {Probe} from 'c:witness-labels';export function run():number{return Number(Probe.$gtype);}";
        let header = format!("#include <stddef.h>\nsize_t {name}(void);\n");
        let library = format!("#include \"witness-labels.h\"\nsize_t {name}(void){{return 7;}}\n");
        execute_producer(&binding, source, &header, &library, 7);
    }
}
