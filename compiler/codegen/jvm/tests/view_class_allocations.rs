//! The requested class is the original view allocation, including species.
#![allow(clippy::unwrap_used, clippy::expect_used)]

use camino::Utf8Path;
mod common;

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

fn allocations(body: &str, views: &[String]) -> usize {
    body.lines()
        .filter(|line| {
            line.split_once(':')
                .is_some_and(|(_, op)| op.trim_start().starts_with("new "))
                && line
                    .split_once("// class ")
                    .is_some_and(|(_, class)| views.iter().any(|view| class.trim() == view))
        })
        .count()
}

fn variants<'a>(listing: &'a str, name: &str) -> Vec<&'a str> {
    let found: Vec<_> = listing
        .split("\n\n")
        .filter(|body| {
            body.lines().any(|line| {
                line.starts_with("  ")
                    && !line.starts_with("   ")
                    && line.ends_with(");")
                    && (line.contains(&format!(" {name}(")) || line.contains(&format!(" {name}$")))
            })
        })
        .collect();
    assert!(!found.is_empty(), "missing {name} variants in {listing}");
    found
}

fn method<'a>(listing: &'a str, name: &str) -> &'a str {
    let at = listing
        .find(&format!(" {name}("))
        .unwrap_or_else(|| panic!("missing {name}: {listing}"));
    let rest = &listing[at..];
    let end = rest.find("\n\n").unwrap_or(rest.len());
    &rest[..end]
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
        .map(|view| {
            emitted
                .classes
                .iter()
                .find(|class| class.binary_name.contains(&view.name))
                .unwrap()
                .binary_name
                .clone()
        })
        .collect();
    views.push("nts/rt/NtsViewU8".to_owned());
    let body = listing(&dir, "nts.gen.Program");
    for plain in variants(&body, "plain") {
        assert_eq!(
            allocations(plain, &views),
            0,
            "builtin creation uses its runtime factory"
        );
        assert!(
            plain.contains("NtsViewU8.create:"),
            "the creation must be present: {plain}"
        );
    }
    for name in ["single", "deep"] {
        for body in variants(&body, name) {
            assert_eq!(
                allocations(body, &views),
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
            .find(|class| class.binary_name.contains(&view.name))
            .unwrap();
        let body = listing(&dir, &class.binary_name.replace('/', "."));
        let like = method(&body, "like");
        assert_eq!(
            allocations(like, &views),
            1,
            "exactly the requested species: {like}"
        );
        assert!(
            !like.contains(".like:"),
            "no per-ancestor view allocation: {like}"
        );
        // Two delegating constructors plus one like; neither constructor allocates.
        assert_eq!(
            allocations(&body, &views),
            1,
            "constructors delegate without new: {body}"
        );
    }
    let runtime = root.join("runtime/jvm/nts-runtime.jar");
    let runtime_body = listing(&runtime, "nts.rt.NtsViewU8");
    assert_eq!(allocations(method(&runtime_body, "create"), &views), 1);
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
