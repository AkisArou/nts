//! A child libtest invocation must run exactly the named test.
use std::process::{Command, Output};

pub(crate) fn run(name: &str, configure: impl FnOnce(&mut Command)) -> Output {
    run_through(name, |mut command| {
        configure(&mut command);
        command
    })
}

/// A wrapper may change affinity or install the command in a gate fixture.
/// It must return the child's libtest output, so the count is still checked here.
pub(crate) fn run_through(name: &str, wrap: impl FnOnce(Command) -> Command) -> Output {
    assert!(
        name.contains("::") && !name.chars().any(char::is_whitespace),
        "self test needs its full module path: {name}"
    );
    let binary = std::env::current_exe()
        .unwrap_or_else(|error| panic!("self test {name}: locate binary: {error}"));
    let mut child = Command::new(binary);
    child.args(["--exact", name, "--nocapture"]);
    let output = wrap(child)
        .output()
        .unwrap_or_else(|error| panic!("self test {name}: spawn: {error}"));
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let summary = stdout
        .lines()
        .rev()
        .find(|line| line.starts_with("test result:"));
    assert!(
        output.status.success()
            && summary.is_some_and(
                |line| line.starts_with("test result: ok. 1 passed; 0 failed; 0 ignored;")
            ),
        "self test {name} must run exactly one passing test: {}\n{stdout}\n{stderr}",
        output.status
    );
    output
}
