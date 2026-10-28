//! Optional system libraries for a hand-written C++ reference, never for nts.
use anyhow::{Context, Result, bail};
use camino::{Utf8Path, Utf8PathBuf};

#[derive(Debug, Default)]
pub(super) struct Libraries(Vec<String>);

impl Libraries {
    pub(super) fn read(case: &Utf8Path) -> Result<Self> {
        let file = case.join("ref.link");
        match std::fs::read_to_string(&file) {
            Ok(text) => Self::parse(&text).with_context(|| format!("reading {file}")),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(Self::default()),
            Err(error) => Err(error).with_context(|| format!("reading {file}")),
        }
    }

    fn parse(text: &str) -> Result<Self> {
        let mut names = Vec::new();
        for line in text.lines() {
            for name in line
                .split('#')
                .next()
                .unwrap_or_default()
                .split_whitespace()
            {
                if !name.starts_with(|c: char| c.is_ascii_alphanumeric())
                    || !name
                        .bytes()
                        .all(|c| c.is_ascii_alphanumeric() || b"_+.-".contains(&c))
                {
                    bail!("expected a library name, without -l or other flags: {name}");
                }
                names.push(name.to_owned());
            }
        }
        Ok(Self(names))
    }

    pub(super) fn flags(&self) -> impl Iterator<Item = String> + '_ {
        self.0.iter().map(|name| format!("-l{name}"))
    }

    /// A tiny link separates an unavailable optional dependency from errors in
    /// the reference. Only the linker's explicit missing-library diagnostic for
    /// a declared name is optional. Broken tools and other link errors fail.
    pub(super) fn probe(&self, binary: &Utf8Path) -> Result<Option<String>> {
        if self.0.is_empty() {
            return Ok(None);
        }
        let source = Utf8PathBuf::from(format!("{binary}.cpp"));
        std::fs::write(&source, "int main() { return 0; }\n")?;
        let output = std::process::Command::new("clang++")
            .arg(&source)
            .args(nts_codegen_common::compile_flags::LTO)
            .args(self.flags())
            .arg("-o")
            .arg(binary)
            .output()
            .context("probing C++ reference libraries with clang++")?;
        std::fs::write(format!("{binary}.stdout"), &output.stdout)?;
        std::fs::write(format!("{binary}.stderr"), &output.stderr)?;
        if output.status.success() {
            return Ok(None);
        }
        let diagnostics = String::from_utf8_lossy(&output.stderr);
        let missing = self.missing(&diagnostics);
        if missing.is_empty() {
            bail!("C++ reference library probe: {diagnostics}");
        }
        Ok(Some(format!(
            "optional C++ libraries unavailable: {}; C++ column is --",
            missing.join(", ")
        )))
    }

    fn missing(&self, diagnostics: &str) -> Vec<String> {
        let named = |line: &str, name: &str| {
            [
                format!("unable to find library -l{name}"),
                format!("cannot find -l{name}:"),
                format!("library not found for -l{name}"),
            ]
            .iter()
            .any(|message| {
                line.split_once(message).is_some_and(|(_, tail)| {
                    tail.chars().next().is_none_or(|c| {
                        c.is_ascii_whitespace() || c == ':' || c == '\'' || c == '"'
                    })
                })
            })
        };
        // Do not turn a second, unrelated error into an optional absence.
        if diagnostics.lines().any(|line| {
            (line.contains("error:")
                || line.contains("cannot find")
                || line.contains("undefined reference"))
                && !line.contains("linker command failed with exit code")
                && !self.0.iter().any(|name| named(line, name))
        }) {
            return Vec::new();
        }
        self.0
            .iter()
            .filter(|name| diagnostics.lines().any(|line| named(line, name)))
            .cloned()
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::Libraries;
    use camino::Utf8PathBuf;

    #[test]
    fn libraries_keep_order_and_allow_comments_but_not_flags() {
        let libraries = Libraries::parse("gmpxx gmp # C++ before C\nre2\n")
            .expect("valid reference-link control");
        assert_eq!(
            libraries.flags().collect::<Vec<_>>(),
            ["-lgmpxx", "-lgmp", "-lre2"]
        );
        for invalid in ["-lgmp", "-Wl,anything", "foo/bar", "$(id)", "gmp;id"] {
            assert!(Libraries::parse(invalid).is_err(), "{invalid}");
        }
    }

    #[test]
    fn only_declared_missing_libraries_are_optional() {
        let libraries = Libraries::parse("gmp re2").expect("valid reference-link control");
        assert_eq!(
            libraries.missing("ld.lld: error: unable to find library -lre2\n"),
            ["re2"]
        );
        assert_eq!(
            libraries.missing("ld: cannot find -lgmp: No such file or directory"),
            ["gmp"]
        );
        assert_eq!(
            libraries.missing("ld: library not found for -lre2"),
            ["re2"]
        );
        for error in [
            "undefined reference to work",
            "no such file: ref.cpp",
            "unable to find library -lother",
            "unable to find library -lre2_extra",
            "unable to find library -lre2more",
            "ld.lld: error: unable to find library -lre2\nld.lld: error: undefined symbol: broken",
        ] {
            assert!(libraries.missing(error).is_empty(), "{error}");
        }
    }

    #[test]
    fn actual_link_accepts_available_and_reports_missing_without_a_build_error() {
        let dir = Utf8PathBuf::from_path_buf(std::env::temp_dir())
            .expect("valid reference-link control")
            .join(format!("nts-reference-link-{}", std::process::id()));
        std::fs::create_dir(&dir).expect("valid reference-link control");
        let result = (|| -> anyhow::Result<()> {
            assert!(Libraries::read(&dir)?.flags().next().is_none());
            std::fs::write(dir.join("ref.link"), "m\n")?;
            assert!(
                Libraries::read(&dir)?
                    .probe(&dir.join("available"))?
                    .is_none()
            );
            std::fs::write(
                dir.join("ref.link"),
                "nts_reference_library_deliberately_missing_781\n",
            )?;
            assert!(
                Libraries::read(&dir)?
                    .probe(&dir.join("missing"))?
                    .expect("valid reference-link control")
                    .contains("nts_reference_library_deliberately_missing_781")
            );
            Ok(())
        })();
        std::fs::remove_dir_all(dir).expect("valid reference-link control");
        result.expect("valid reference-link control");
    }
}
