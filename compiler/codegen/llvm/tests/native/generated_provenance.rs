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
    execute_producer_linked(binding, source, header, library, expected, &[]);
}

fn execute_producer_linked(
    binding: &str,
    source: &str,
    header: &str,
    library: &str,
    expected: u32,
    libraries: &[&str],
) {
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
    let again = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
    assert_eq!(c.writer.text(), again.writer.text(), "repeat C bytes");
    for file in c.support_files() {
        file.write(dir.as_std_path()).unwrap();
    }
    std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
    let llvm = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
    let again = nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
    assert_eq!(llvm.text, again.text, "repeat LLVM bytes");
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
            .args(libraries)
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

/// One generated getter and one authored C function can have the same semantic
/// name. Only the former's producer tag grants a private emitted symbol.
#[test]
fn generated_and_authored_native_names_remain_distinct() {
    let header = "void *object(void); int nts_gobject_propget_i__value(void *);\n";
    let library = r"#include <stdarg.h>
static int data;
void *object(void) { return &data; }
int nts_gobject_propget_i__value(void *object) { (void)object; return 7; }
void g_object_get(void *object, const char *name, ...) {
    (void)object; (void)name;
    va_list arguments; va_start(arguments, name);
    *va_arg(arguments, int *) = 17; va_end(arguments);
}
";
    for tagged in [false, true] {
        // The intrinsic tag is the sole source difference.
        let tag = if tagged {
            " * @ntsIntrinsic gobject.get-by-name i value\n"
        } else {
            ""
        };
        let binding = format!(
            "/** @ntsHeader witness-labels.h */ declare module 'c:witness-labels' {{ import type {{c_int}} from '@nts/scalars'; import type {{Ptr}} from 'c:types'; export function object():Ptr<void>;\n/** @ntsSymbol nts_gobject_propget_i__value\n{tag} */ export function read(object:Ptr<void>):c_int;\n/** @ntsSymbol nts_gobject_propget_i__value */ export function decoy(object:Ptr<void>):c_int; }}"
        );
        execute_producer(
            &binding,
            "import {read,decoy,object} from 'c:witness-labels';export function run():number{return read(object())*10+decoy(object());}",
            header,
            library,
            if tagged { 177 } else { 77 },
        );
    }
}

#[test]
fn equivalent_property_spellings_share_a_real_gobject_helper() {
    let flags = Command::new("pkg-config")
        .args(["--cflags", "--libs", "gobject-2.0"])
        .output()
        .unwrap();
    assert!(
        flags.status.success(),
        "gobject-2.0 is required for this native test"
    );
    let flags = String::from_utf8(flags.stdout).unwrap();
    let flags: Vec<_> = flags.split_whitespace().collect();
    let header = "void *object(void);\n";
    let library = r#"#include <glib-object.h>
typedef struct { GObject parent; } NtsProbe;
typedef struct { GObjectClass parent; } NtsProbeClass;
G_DEFINE_TYPE(NtsProbe, nts_probe, G_TYPE_OBJECT)
static void get_property(GObject *object,guint id,GValue *value,GParamSpec *spec){
    (void)object;
    if(id==1) g_value_set_int(value,17);
    else G_OBJECT_WARN_INVALID_PROPERTY_ID(object,id,spec);
}
static void nts_probe_init(NtsProbe *self){(void)self;}
static void nts_probe_class_init(NtsProbeClass *klass){
    GObjectClass *object=G_OBJECT_CLASS(klass);
    object->get_property=get_property;
    g_object_class_install_property(object,1,
        g_param_spec_int("a-b","a-b","a-b",0,100,17,G_PARAM_READABLE));
}
void *object(void){
    static GObject *object;
    if(!object) object=g_object_new(nts_probe_get_type(),NULL);
    GObjectClass *klass=G_OBJECT_GET_CLASS(object);
    GParamSpec *dash=g_object_class_find_property(klass,"a-b");
    GParamSpec *underscore=g_object_class_find_property(klass,"a_b");
    g_assert(dash==underscore);
    g_assert_cmpstr(g_param_spec_get_name(underscore),==,"a-b");
    return object;
}
"#;
    for control in [true, false] {
        // GLib accepts '_' and '-' as equivalent property separators. Change
        // only the second spelling; both real-library executions must give 34.
        let second = if control { "a-b" } else { "a_b" };
        let binding = format!(
            "/** @ntsHeader witness-labels.h */ declare module 'c:witness-labels' {{ import type {{c_int}} from '@nts/scalars'; import type {{Ptr}} from 'c:types'; export function object():Ptr<void>;\n/** @ntsIntrinsic gobject.get-by-name i a-b */ export function first(object:Ptr<void>):c_int;\n/** @ntsIntrinsic gobject.get-by-name i {second} */ export function second(object:Ptr<void>):c_int; }}"
        );
        let source = "import {object,first,second} from 'c:witness-labels';export function run():number{return first(object())+second(object());}";
        execute_producer_linked(&binding, source, header, library, 34, &flags);
        let (_dir, prepared) = prepare_with_files(
            "canonical-property-symbols",
            source,
            hir::Memory::NoGc,
            &[("witness-labels.d.ts", &binding)],
        );
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        let symbols = nts_codegen_common::native_symbols::NativeSymbols::new(&prepared.program);
        let names: Vec<_> = nts_codegen_common::gobject::thunks(&prepared.program)
            .map(|(target, _)| symbols.function(target))
            .collect();
        assert!(names.len() >= 2);
        assert!(names.iter().all(|name| *name == names[0]), "{names:?}");
    }
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one data/identifier guard covers both emitters and providers"
)]
fn inventory_words_remain_authored_data_and_native_members() {
    // These words name roles in the emission inventories. In source data and
    // authored C declarations they retain their literal spelling.
    let words = [
        "type",
        "value",
        "propget",
        "prop",
        "with",
        "new",
        "child",
        "notify",
        "emit",
        "chain",
        "signal",
        "property",
        "get",
        "set",
        "construct",
        "object",
        "self",
        "visit",
        "slot",
        "bytes",
        "minimum",
        "a",
        "out",
    ];
    let sentence = words.join(" ");
    let fields = words
        .iter()
        .map(|word| format!("{word}:c_int"))
        .collect::<Vec<_>>()
        .join(";");
    let binding = format!(
        "/** @ntsHeader prefix-words.h */declare module 'c:prefix-words'{{import type{{c_int}}from '@nts/scalars';import type{{Ptr,Struct}}from 'c:types';type Words=Struct<{{{fields}}},\"prefix_words\">;export function propget():Ptr<Words>;}}"
    );
    let reads = words
        .iter()
        .map(|word| format!("data.{word}"))
        .collect::<Vec<_>>()
        .join("+");
    let source = format!(
        "// authored comment: {sentence}\nimport{{propget}}from 'c:prefix-words';export function probe_words():number{{const data=propget();return {reads};}}export function probe_text():string{{return {sentence:?};}}"
    );
    let members = words
        .iter()
        .map(|word| format!("int {word};"))
        .collect::<Vec<_>>()
        .join(" ");
    let header = format!(
        "/* authored comment: {sentence} */\nstruct prefix_words{{{members}}};\nstruct prefix_words *propget(void);\n"
    );
    let initial = (1..=words.len())
        .map(|n| n.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let expected = words.len() * (words.len() + 1) / 2;
    for provider in [hir::Memory::NoGc, hir::Memory::ReferenceCounting] {
        let (dir, prepared) = prepare_with_files(
            "native-inventory-words",
            &source,
            provider,
            &[("prefix-words.d.ts", &binding)],
        );
        assert!(
            prepared.diagnostics.is_empty(),
            "{:?}",
            prepared.diagnostics
        );
        std::fs::write(dir.join("prefix-words.h"), &header).unwrap();
        let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
        assert!(c.is_complete(), "{:?}", c.diagnostics);
        for word in &words {
            assert!(
                c.writer.text().contains(&format!("->{word}")),
                "authored field {word} was rewritten: {}",
                c.writer.text()
            );
        }
        for file in c.support_files() {
            file.write(dir.as_std_path()).unwrap();
        }
        assert_eq!(
            std::fs::read_to_string(dir.join("prefix-words.h")).unwrap(),
            header,
            "authored C comments/declarations changed"
        );
        std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
        let llvm =
            nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
        assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
        std::fs::write(dir.join("program.ll"), llvm.text).unwrap();
        std::fs::write(dir.join("library.c"),format!("#include \"prefix-words.h\"\nstatic struct prefix_words value={{{initial}}};struct prefix_words *propget(void){{return &value;}}\n")).unwrap();
        std::fs::write(dir.join("caller.c"),format!("#include \"program.h\"\nint main(void){{if(probe_words()!={expected})return 1;NtsString *text=probe_text();const char *expected={sentence:?};if(text->length!={})return 2;for(unsigned i=0;i<{};i++)if(nts_str_char_code_at(text,(double)i)!=(unsigned char)expected[i])return 3;return 0;}}\n",sentence.len(),sentence.len())).unwrap();
        for input in ["program.c", "program.ll"] {
            let mut command = Command::new("clang");
            command.current_dir(&dir).args([
                "-I.",
                input,
                "library.c",
                "caller.c",
                "nts_runtime.c",
                "-lm",
                "-o",
                "run",
            ]);
            if provider == hir::Memory::ReferenceCounting {
                command.arg("-DNTS_PROVIDER_RC");
            }
            let linked = command.output().unwrap();
            assert!(
                linked.status.success(),
                "{input}: {}",
                String::from_utf8_lossy(&linked.stderr)
            );
            assert!(
                Command::new(dir.join("run")).status().unwrap().success(),
                "{input}: authored words/data changed"
            );
        }
    }
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "one namespace property includes real header macros and both providers"
)]
fn source_names_cannot_impersonate_private_inventory_roles() {
    for control in [false, true] {
        let (class, global, function, parameter) = if control {
            (
                "SourceBox",
                "sourceGlobal",
                "sourceFunction",
                "sourceParameter",
            )
        } else {
            (
                "__nts_type",
                "__nts_value_propget",
                "__nts_gobject_propget_i__value_0",
                "__nts_type",
            )
        };
        let libc = ["errno", "stdout", "main", "printf", "register"];
        let functions = libc.iter().map(|name|format!("function {name}(n:number):number{{let value=n;for(let i=0;i<3;i++)value+=i;return value;}}" )).collect::<Vec<_>>().join("\n");
        let calls = libc
            .iter()
            .map(|name| format!("{name}(n)"))
            .collect::<Vec<_>>()
            .join("+");
        let binding = "/** @ntsHeader witness-labels.h */declare module 'c:witness-labels'{import type{c_int}from '@nts/scalars';import type{Ptr}from 'c:types';export function object():Ptr<void>;\n/** @ntsIntrinsic gobject.get-by-name i value */\nexport function header_get(object:Ptr<void>):c_int;}";
        let source = format!(
            "import{{object,header_get}}from 'c:witness-labels';let {global}=3;class {class}{{constructor(public value:number){{}}}}function {function}({parameter}:number):number{{{global}+=1;let value={parameter};for(let i=0;i<3;i++)value+=i;return value+{global};}}\n{functions}\nexport function make(n:number):{class}{{return new {class}(n);}}export function probe(n:number):number{{return {function}(new {class}(n).value)+{calls}+header_get(object());}}"
        );
        for provider in [hir::Memory::NoGc, hir::Memory::ReferenceCounting] {
            let (dir, prepared) = prepare_with_files(
                "source-inventory-names",
                &source,
                provider,
                &[("witness-labels.d.ts", binding)],
            );
            assert!(
                prepared.diagnostics.is_empty(),
                "{:?}",
                prepared.diagnostics
            );
            let c = nts_codegen_c::emit(&prepared.program, hir::native::NativeAbi::LP64);
            assert!(c.is_complete(), "{:?}", c.diagnostics);
            let mut names = std::collections::BTreeSet::new();
            for name in libc.iter().copied().chain([function]) {
                let symbol = super::function_symbol(c.writer.text(), name);
                assert!(
                    symbol.starts_with("__nts_fn_"),
                    "{name} escaped its source inventory: {symbol}"
                );
                assert!(names.insert(symbol.clone()));
                let declaration = c
                    .writer
                    .text()
                    .lines()
                    .find(|line| line.contains(&format!(" {symbol}(")) && line.ends_with('{'))
                    .unwrap();
                eprintln!("SOURCE_NAMESPACE_C {name}: {declaration}");
            }
            eprintln!(
                "SOURCE_NAMESPACE_C global: {}",
                c.writer
                    .text()
                    .lines()
                    .find(|line| line.contains("__nts_global_") && line.ends_with(';'))
                    .unwrap()
            );
            assert!(
                c.writer.text().contains("__nts_global_"),
                "private global missing"
            );
            for file in c.support_files() {
                file.write(dir.as_std_path()).unwrap();
            }
            let header = std::fs::read_to_string(dir.join("program.h")).unwrap();
            assert!(
                header.contains(&format!("NtsObj_{class}")),
                "source class must keep a real public carrier"
            );
            eprintln!(
                "SOURCE_NAMESPACE_C class: {}",
                header
                    .lines()
                    .find(|line| line.contains(&format!("NtsObj_{class}")))
                    .unwrap()
            );
            std::fs::write(dir.join("witness-labels.h"), PROPERTY_HEADER).unwrap();
            std::fs::write(dir.join("library.c"), PROPERTY_LIBRARY).unwrap();
            let symbols = nts_codegen_common::native_symbols::NativeSymbols::new(&prepared.program);
            let thunks: Vec<_> = nts_codegen_common::gobject::thunks(&prepared.program).collect();
            assert_eq!(
                thunks.len(),
                1,
                "the generated-role producer must be exercised"
            );
            for (target, _) in thunks {
                assert!(
                    !names.contains(symbols.function(target)),
                    "source body stole a generated role"
                );
            }
            std::fs::write(dir.join("program.c"), c.writer.text()).unwrap();
            let llvm =
                nts_codegen_llvm::emit(&prepared.program, nts_codegen_llvm::Platform::SYSV_X86_64);
            assert!(llvm.diagnostics.is_empty(), "{:?}", llvm.diagnostics);
            std::fs::write(dir.join("program.ll"), llvm.text).unwrap();
            std::fs::write(
                dir.join("caller.c"),
                "#include \"program.h\"\n#include <stdio.h>\nint main(void){module__init();double a=probe(4),b=probe(4);printf(\"%.17g %.17g\\n\",a,b);return a!=63||b!=64;}\n",
            )
            .unwrap();
            for input in ["program.c", "program.ll"] {
                let mut command = Command::new("clang");
                command.current_dir(&dir).args([
                    "-include",
                    "errno.h",
                    "-include",
                    "stdio.h",
                    "-I.",
                    input,
                    "library.c",
                    "caller.c",
                    "nts_runtime.c",
                    "-lm",
                    "-o",
                    "run",
                ]);
                if provider == hir::Memory::ReferenceCounting {
                    command.arg("-DNTS_PROVIDER_RC");
                }
                let linked = command.output().unwrap();
                assert!(
                    linked.status.success(),
                    "{input}: {}",
                    String::from_utf8_lossy(&linked.stderr)
                );
                let ran = Command::new(dir.join("run")).output().unwrap();
                assert!(
                    ran.status.success(),
                    "{input}: expected63/64, status={:?}, stdout={}, stderr={}",
                    ran.status,
                    String::from_utf8_lossy(&ran.stdout),
                    String::from_utf8_lossy(&ran.stderr)
                );
            }
        }
    }
}
