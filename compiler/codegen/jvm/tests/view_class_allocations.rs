//! The requested class is the original view allocation, including species.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use crate::common;
use camino::Utf8Path;

fn listing(dir: &std::path::Path, class: &str) -> String {
    let javap = common::tool("javap").expect("view allocation guard requires the pinned JDK");
    let output = nts_codegen_jvm::toolchain::command(javap)
        .args(["-c", "-p", "-cp"])
        .arg(dir)
        .arg(class)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    String::from_utf8(output.stdout).unwrap()
}

fn allocation_count(method: &nts_jvm_emitter::read::MethodAllocations, views: &[String]) -> usize {
    method
        .classes
        .iter()
        .filter(|class| views.contains(class))
        .count()
}

fn variants<'a>(
    listing: &'a str,
    program: &nts_core::hir::Program,
    name: &str,
) -> Vec<(&'a str, String)> {
    common::implementation_names(program, name)
        .into_iter()
        .map(|actual| (common::method_listing(listing, &actual), actual))
        .collect()
}

#[test]
#[expect(
    clippy::too_many_lines,
    reason = "checks original allocation, species emission and execution together"
)]
fn plain_single_and_deep_views_allocate_the_requested_class_once() {
    let dir = std::env::temp_dir().join(format!("nts-view-allocations-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let root = common::repository().canonicalize().unwrap();
    std::fs::write(
        dir.join("tsconfig.json"),
        format!(
            "{{\"extends\":\"{}/tsconfig.fixtures.json\",\"files\":[\"main.ts\"]}}",
            root.display()
        ),
    )
    .unwrap();
    std::fs::write(dir.join("main.ts"), r"
class Single extends Uint8Array {}
class Middle extends Single {}
class Deep extends Middle {}
export function plain(n: number): number { return new Uint8Array((n & 3) + 4).slice(1).length; }
export function single(n: number): number {
  const value = new Single((n & 3) + 4);
  return value.length + (value.subarray(1) instanceof Single ? 10 : 0) + (value.slice(1) instanceof Single ? 100 : 0);
}
export function deep(n: number): number {
  const value = new Deep((n & 3) + 4);
  return value.length + (value.subarray(1) instanceof Deep ? 10 : 0) + (value.slice(1) instanceof Deep ? 100 : 0);
}
").unwrap();
    let config = dir.join("tsconfig.json");
    let snapshot = nts_frontend_ts::Frontend::new(env!("CARGO_MANIFEST_DIR"))
        .with_checkers(std::num::NonZeroU16::MIN)
        .snapshot(Utf8Path::from_path(&config).unwrap())
        .unwrap();
    let program = common::prepare(&snapshot)
        .expect("view allocation source must prepare")
        .program;
    assert!(program.uncompiled.is_empty(), "{:?}", program.uncompiled);
    // Middle is not itself directly named by any source operation.
    assert_eq!(program.view_classes.iter().count(), 3);
    let emitted = nts_codegen_jvm::emit(&program);
    assert!(emitted.diagnostics.is_empty(), "{:?}", emitted.diagnostics);
    for class in &emitted.classes {
        let path = dir.join(class.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, &class.bytes).unwrap();
    }
    let mut views: Vec<_> = program
        .view_classes
        .iter()
        .map(|view| nts_codegen_jvm::types::view_class_name(nts_codegen_jvm::DEFAULT_PACKAGE, view))
        .collect();
    views.push("nts/rt/NtsViewU8".to_owned());
    let program_class = emitted
        .classes
        .iter()
        .find(|class| class.binary_name == "nts/gen/Program")
        .expect("actual Program class");
    let allocations = nts_jvm_emitter::read::allocations(&program_class.bytes).unwrap();
    let allocated = |name: &str| {
        allocations
            .iter()
            .find(|method| method.name == name)
            .unwrap_or_else(|| panic!("missing Code for actual method {name}"))
    };
    let body = listing(&dir, "nts.gen.Program");
    for (plain, name) in variants(&body, &program, "plain") {
        assert_eq!(
            allocation_count(allocated(&name), &views),
            0,
            "builtin creation uses its runtime factory"
        );
        assert!(
            plain.contains("NtsViewU8.create:"),
            "the creation must be present: {plain}"
        );
    }
    for name in ["single", "deep"] {
        for (body, actual) in variants(&body, &program, name) {
            assert_eq!(
                allocation_count(allocated(&actual), &views),
                1,
                "one original requested view allocation: {body}"
            );
            assert!(
                !body.contains("NtsViewU8.create:"),
                "no discarded base view: {body}"
            );
            assert!(body.contains("(Lnts/rt/NtsBuffer;DDDZ)V"));
        }
    }
    for view in &program.view_classes {
        let class = emitted
            .classes
            .iter()
            .find(|class| {
                class.binary_name
                    == nts_codegen_jvm::types::view_class_name(
                        nts_codegen_jvm::DEFAULT_PACKAGE,
                        view,
                    )
            })
            .unwrap();
        let allocations = nts_jvm_emitter::read::allocations(&class.bytes).unwrap();
        let species = allocations
            .iter()
            .find(|method| method.name == "like")
            .expect("explicit runtime like contract");
        let body = listing(&dir, &class.binary_name.replace('/', "."));
        let like = common::method_listing(&body, "like");
        assert_eq!(
            allocation_count(species, &views),
            1,
            "exactly the requested species: {like}"
        );
        assert!(
            !like.contains(".like:"),
            "no per-ancestor view allocation: {like}"
        );
        // Two delegating constructors plus one like; neither constructor allocates.
        assert_eq!(
            allocations
                .iter()
                .map(|method| allocation_count(method, &views))
                .sum::<usize>(),
            1,
            "constructors delegate without new: {body}"
        );
    }
    let runtime = root.join("runtime/jvm/nts-runtime.jar");
    let output = nts_codegen_jvm::toolchain::command(common::tool("unzip").unwrap())
        .args(["-p"])
        .arg(&runtime)
        .arg("nts/rt/NtsViewU8.class")
        .output()
        .unwrap();
    assert!(output.status.success());
    let runtime_allocations = nts_jvm_emitter::read::allocations(&output.stdout).unwrap();
    let create = runtime_allocations
        .iter()
        .find(|method| method.name == "create")
        .expect("runtime factory Code");
    assert_eq!(allocation_count(create, &views), 1);
    let driver = dir.join("ViewAllocationDriver.java");
    std::fs::write(&driver, r#"
public class ViewAllocationDriver {
  public static void main(String[] args) {
    double[] inputs = {0, 1, 2, 3, 0.5, -0.5, 3.5, Double.NaN, Double.POSITIVE_INFINITY, -1.5};
    int[] low = {0, 1, 2, 3, 0, 0, 3, 0, 0, 3};
    for (int at = 0; at < inputs.length; at++) {
      double n = inputs[at];
      if (nts.gen.Program.plain(n) != low[at] + 3 || nts.gen.Program.single(n) != low[at] + 114 || nts.gen.Program.deep(n) != low[at] + 114)
        throw new AssertionError(n);
    }
    System.out.println("view allocations and species values checked");
  }
}"#).unwrap();
    let classpath = format!("{}:{}", dir.display(), runtime.display());
    let built = nts_codegen_jvm::toolchain::command(common::tool("javac").unwrap())
        .args(["--release", "8", "-cp", &classpath, "-d"])
        .arg(&dir)
        .arg(driver)
        .output()
        .unwrap();
    assert!(
        built.status.success(),
        "{}",
        String::from_utf8_lossy(&built.stderr)
    );
    let ran = nts_codegen_jvm::toolchain::command(common::tool("java").unwrap())
        .args(["-Xverify:all", "-cp", &classpath, "ViewAllocationDriver"])
        .output()
        .unwrap();
    assert!(
        ran.status.success(),
        "{}",
        String::from_utf8_lossy(&ran.stderr)
    );
    assert!(String::from_utf8_lossy(&ran.stdout).contains("species values checked"));
    std::fs::remove_dir_all(dir).unwrap();
}
