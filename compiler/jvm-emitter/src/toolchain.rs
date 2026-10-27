//! JVM launches used by tests and build/gate tools share one flag policy.
//! No test attaches jstat. Perfdata's shared /tmp files can collide under load
//! and put VM warnings into the program output a test is comparing.
use std::ffi::OsStr;
use std::path::Path;
use std::process::Command;

const VM_FLAGS: &str = include_str!("../../../runtime/jvm/test-vm-flags.txt");

/// Flags for a JVM application, including a JVM behind a resource wrapper.
pub fn vm_flags() -> impl Iterator<Item = &'static str> {
    VM_FLAGS.split_whitespace()
}

/// Construct a JDK/Android tool command without shared performance-data files.
/// Non-JVM tools pass through unchanged, so test helpers can use one builder.
pub fn command(program: impl AsRef<OsStr>) -> Command {
    let program = program.as_ref();
    let name = Path::new(program)
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or_default();
    let name = name.trim_end_matches(".exe").trim_end_matches(".bat");
    let mut command = Command::new(program);
    match name {
        "java" => {
            command.args(vm_flags());
        }
        "javac" | "javap" | "jar" | "jmod" | "jdeps" | "javadoc" | "jlink" | "keytool" => {
            command.args(vm_flags().map(|flag| format!("-J{flag}")));
        }
        "d8" | "r8" | "apksigner" => {
            // Android shell launchers prepend the JVM dash themselves.
            command.args(vm_flags().map(|flag| format!("-J{}", flag.trim_start_matches('-'))));
        }
        _ => {}
    }
    command
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn every_jvm_launcher_suppresses_shared_perfdata() {
        for tool in [
            "java",
            "javac",
            "javap",
            "jar",
            "jmod",
            "d8",
            "r8",
            "apksigner",
        ] {
            let command = command(tool);
            let expected = if tool == "java" {
                "-XX:-UsePerfData"
            } else if matches!(tool, "d8" | "r8" | "apksigner") {
                "-JXX:-UsePerfData"
            } else {
                "-J-XX:-UsePerfData"
            };
            assert_eq!(
                command.get_args().collect::<Vec<_>>(),
                [OsStr::new(expected)]
            );
        }
        assert_eq!(
            command("clang").get_args().collect::<Vec<_>>(),
            Vec::<&OsStr>::new()
        );
    }
}
