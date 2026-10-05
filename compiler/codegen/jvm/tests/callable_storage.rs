//! A callback's shared reference ABI survives pruning its unused entry.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use std::process::Command;
use camino::Utf8PathBuf;
use nts_core::hir;
use nts_frontend_ts::{SemanticSource, TsgoApi};

mod common;

fn run(name: &str, source: &str, drive: &str, expected: &str, unused: bool) {
    let Ok(tsgo) = std::env::var("NTS_TSGO").map(Utf8PathBuf::from) else {
        eprintln!("SKIP callable_storage: NTS_TSGO is not set");
        return;
    };
    let (Some(javac), Some(java)) = (common::tool("javac"), common::tool("java")) else {
        eprintln!("SKIP callable_storage: no JDK");
        return;
    };
    let dir = std::env::temp_dir().join(format!("nts-callable-storage-{name}-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("main.ts"), source).unwrap();
    std::fs::write(dir.join("tsconfig.json"),
        "{\"compilerOptions\": {\"target\": \"ESNext\", \"module\": \"ESNext\", \"strict\": true}, \"files\": [\"main.ts\"]}\n").unwrap();
    let config = Utf8PathBuf::from_path_buf(dir.join("tsconfig.json")).unwrap();
    let snapshot = TsgoApi::for_compilation(tsgo).snapshot(&config).expect("snapshot");
    assert!(!snapshot.has_errors(), "{:?}", snapshot.diagnostics);
    let program = hir::prepare(&snapshot).expect("prepared").program;
    assert!(program.layouts.iter().any(|layout|
        layout.types.iter().any(|ty| hir::has_a_closure_body(*ty))), "actual closure storage");
    if unused {
        assert!(program.layouts.iter().filter(|layout|
            layout.types.iter().any(|ty| hir::has_a_closure_body(*ty)))
            .all(|layout| layout.methods.iter().all(Option::is_none)),
            "unused callback bodies must remain pruned");
    }
    let emitted = nts_codegen_jvm::emit(&program);
    assert!(emitted.is_complete(), "{:?}", emitted.diagnostics.iter().map(|d| &d.message).collect::<Vec<_>>());
    assert!(emitted.classes.iter().any(|class| class.path() == "nts/gen/erased/Callable.class"),
        "the common storage root must exist");
    let out = dir.join("out");
    for class in &emitted.classes {
        let path = out.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, &class.bytes).unwrap();
    }
    let jar = out.join(nts_codegen_jvm::RUNTIME_JAR_NAME);
    std::fs::write(&jar, nts_codegen_jvm::runtime_jar().as_ref()).unwrap();
    let closures = program.layouts.iter().filter(|layout|
        layout.types.iter().any(|ty| hir::has_a_closure_body(*ty)))
        .map(|layout| format!("\"nts.gen.{}\"", layout.name)).collect::<Vec<_>>().join(",");
    let mut missing = Vec::new();
    for slot in [program.erased_call_slot, program.raising_call_slot].into_iter().flatten() {
        let member = program.layouts.iter().find_map(|layout|
            layout.methods.get(slot as usize).and_then(Option::as_ref))
            .map(|name| name.rsplit('#').next().unwrap().replace('@', "$"));
        let Some(member) = member else { continue; };
        for layout in program.layouts.iter().filter(|layout|
            layout.types.iter().any(|ty| hir::has_a_closure_body(*ty))) {
            if layout.methods.get(slot as usize).is_none_or(Option::is_none) {
                missing.push(format!("new String[] {{\"nts.gen.{}\", \"{member}\"}}", layout.name));
            }
        }
    }
    if !unused { assert!(!missing.is_empty(), "the mixed witness must exercise a genuinely missing arm"); }
    let missing = missing.join(",");
    std::fs::write(out.join("Drive.java"), format!(
        "public class Drive {{ public static void main(String[] a) throws Exception {{\n\
          Class<?> root = Class.forName(\"nts.gen.erased.Callable\");\n\
          for (String name : new String[] {{{closures}}}) {{\n\
            for (java.lang.reflect.Method method : root.getDeclaredMethods()) {{\n\
              java.lang.reflect.Method actual = Class.forName(name).getMethod(method.getName(), method.getParameterTypes());\n\
              if (java.lang.reflect.Modifier.isAbstract(actual.getModifiers())) throw new AssertionError(name + \" has an unfilled uniform entry\");\n\
            }}\n\
          }}\n\
          for (String[] arm : new String[][] {{{missing}}}) {{\n\
            for (java.lang.reflect.Method method : root.getDeclaredMethods()) {{\n\
              if (!method.getName().equals(arm[1])) continue;\n\
              Object receiver = Class.forName(arm[0]).getConstructor().newInstance();\n\
              Object[] inputs = new Object[method.getParameterCount()];\n\
              java.util.Arrays.fill(inputs, nts.rt.NtsValue.UNDEFINED_VALUE);\n\
              try {{ method.invoke(receiver, inputs); throw new AssertionError(\"missing arm ran\"); }}\n\
              catch (java.lang.reflect.InvocationTargetException refused) {{\n\
                if (!(refused.getCause() instanceof nts.rt.NtsRefusal) || !refused.getCause().getMessage().contains(\"has no\")) throw refused;\n\
              }}\n\
            }}\n\
          }}\n\
          {drive}\n\
        }} }}\n")).unwrap();
    let cp = format!("{}:{}", out.display(), jar.display());
    let compiled = Command::new(&javac).args(["-cp", &cp, "-d"]).arg(&out).arg(out.join("Drive.java")).output().unwrap();
    assert!(compiled.status.success(), "{}", String::from_utf8_lossy(&compiled.stderr));
    let ran = Command::new(&java).args(["-Xverify:all", "-cp", &cp, "Drive"]).output().unwrap();
    assert!(ran.status.success(), "{}{}", String::from_utf8_lossy(&ran.stdout), String::from_utf8_lossy(&ran.stderr));
    assert_eq!(String::from_utf8_lossy(&ran.stdout).trim(), expected);
    std::fs::remove_dir_all(&dir).unwrap();
}

#[test]
fn unused_callbacks_keep_the_root_without_retaining_entries() {
    run("unused", "function ignore(_callback: () => unknown): number { return 19; }\n\
        export function direct(): number { return ignore(() => 7); }\n\
        export function captured(): number { const n = 11; return ignore(() => n); }\n\
        function factory(): () => unknown { return () => 13; }\n\
        export function returned(): number { return ignore(factory()); }\n\
        export function joined(n: number): number {\n\
            const callback = n === 0 ? () => 1 : () => 2; return ignore(callback);\n\
        }\n",
        "System.out.println((long) nts.gen.Program.direct() + \" \" + (long) nts.gen.Program.captured() + \" \" + (long) nts.gen.Program.returned() + \" \" + (long) nts.gen.Program.joined(0) + \" \" + (long) nts.gen.Program.joined(1));",
        "19 19 19 19 19", true);
}

#[test]
fn live_entries_and_ignored_storage_share_one_root() {
    run("mixed", "function ignore(_callback: () => unknown): number { return 19; }\n\
        function invoke(callback: () => number): number { return callback(); }\n\
        export function mixed(n: number): number {\n\
            return invoke(() => n) + ignore(() => n + 100);\n\
        }\n\
        export function caught(): number {\n\
            try { return invoke(() => { throw new Error('failure'); }); } catch { return 47; }\n\
        }\n",
        "System.out.println((long) nts.gen.Program.mixed(11) + \" \" + (long) nts.gen.Program.caught());",
        "30 47", false);
}
