use std::path::Path;
use std::process::Command;

fn git(root: &Path, args: &[&str]) -> String {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .expect("git build identity");
    assert!(output.status.success(), "git build identity failed");
    String::from_utf8(output.stdout)
        .expect("UTF-8 git identity")
        .trim()
        .to_owned()
}

fn main() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let commit = git(&root, &["rev-parse", "HEAD"]);
    println!("cargo:rustc-env=NTS_BENCH_SOURCE_COMMIT={commit}");
    let dirty = git(
        &root,
        &[
            "status",
            "--porcelain",
            "--untracked-files=no",
            "--",
            "compiler",
            "runtime",
            "build",
            "tooling/bench",
        ],
    );
    println!(
        "cargo:rustc-env=NTS_BENCH_SOURCE_DIRTY={}",
        !dirty.is_empty()
    );
    for path in ["HEAD", "packed-refs"] {
        let path = git(&root, &["rev-parse", "--git-path", path]);
        println!("cargo:rerun-if-changed={}", root.join(path).display());
    }
    let reference = Command::new("git")
        .args(["symbolic-ref", "-q", "HEAD"])
        .current_dir(&root)
        .output()
        .expect("git branch identity");
    if reference.status.success() {
        let name = String::from_utf8(reference.stdout).expect("UTF-8 branch");
        let path = git(&root, &["rev-parse", "--git-path", name.trim()]);
        println!("cargo:rerun-if-changed={}", root.join(path).display());
    }
}
