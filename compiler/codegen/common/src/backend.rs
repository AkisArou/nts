//! Which backend renders a program.
//!
//! # Why a type, for what was a boolean
//!
//! Backend selection was `std::env::var("NTS_BACKEND").is_ok_and(|which| which
//! == "llvm")`, which has one failure mode and it is quiet: `NTS_BACKEND=llvmm`
//! runs the **C** backend, the gate's `llvm` step reports its floor, and the
//! floor is green because it measured the wrong lane. With two backends that is
//! a trap nobody has stepped in. With three it is the first bug, because the
//! two spellings that matter -- `llvm` and `jvm` -- differ by one character.
//!
//! So an unrecognised name is an error rather than a fallback, and the name is
//! parsed in exactly one place.

use std::str::FromStr;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Backend {
    /// The first backend, and the oracle: its match is exhaustive, so a new
    /// `OpKind` breaks its build rather than silently falling through.
    #[default]
    C,
    /// Textual LLVM IR, fed to `clang -x ir`.
    Llvm,
    /// JVM class files, written directly.
    Jvm,
}

impl Backend {
    /// Whether this backend's tables answer a key's entry (`hir::entries`),
    /// so a key read and then written is looked up once: `Some` where the
    /// backend says so over its provider's answer, `None` to take the
    /// provider's. The JVM's tables do not, which is a host heap's answer;
    /// C's and LLVM's are the C
    /// runtime's, which do. Every driver that prepares for a backend --
    /// the CLI, the differential, the benchmarks, the tests -- sets
    /// `hir::Options::table_entries` from here, so none prepares one
    /// backend's program as another's.
    #[must_use]
    pub const fn table_entries(self) -> Option<bool> {
        match self {
            Self::C | Self::Llvm | Self::Jvm => None,
        }
    }

    /// The spelling `NTS_BACKEND` takes, and the one a gate step prints.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::C => "c",
            Self::Llvm => "llvm",
            Self::Jvm => "jvm",
        }
    }

    /// The stable, gated backends.
    pub const ALL: [Self; 3] = [Self::C, Self::Llvm, Self::Jvm];

    /// Names users can select, including experimental backends.
    pub const RECOGNIZED: [Self; 3] = Self::ALL;

    /// The backend `NTS_BACKEND` names, or [`Backend::C`] when it is unset.
    ///
    /// An unset variable is the default and an unparseable one is an error:
    /// the first is how the gate's C steps run and the second is a typo whose
    /// only honest answer is to stop.
    pub fn from_environment() -> Result<Self, UnknownBackend> {
        match std::env::var("NTS_BACKEND") {
            Err(_) => Ok(Self::default()),
            Ok(name) => name.parse(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct UnknownBackend(pub String);

impl std::fmt::Display for UnknownBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let known: Vec<&str> = Backend::RECOGNIZED
            .iter()
            .map(|backend| backend.name())
            .collect();
        write!(
            f,
            "unknown backend `{}`; NTS_BACKEND takes one of {}",
            self.0,
            known.join(", ")
        )
    }
}

impl std::error::Error for UnknownBackend {}

impl FromStr for Backend {
    type Err = UnknownBackend;

    fn from_str(name: &str) -> Result<Self, Self::Err> {
        Self::RECOGNIZED
            .into_iter()
            .find(|backend| backend.name() == name)
            .ok_or_else(|| UnknownBackend(name.to_owned()))
    }
}

impl std::fmt::Display for Backend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.name())
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used)]

    use super::*;

    #[test]
    fn every_backend_round_trips_through_its_name() {
        for backend in Backend::RECOGNIZED {
            assert_eq!(backend.name().parse::<Backend>().unwrap(), backend);
        }
    }

    #[test]
    fn a_near_miss_is_an_error_and_not_the_default() {
        // The whole reason this type exists. `llvmm` used to select C.
        assert!("llvmm".parse::<Backend>().is_err());
        assert!("jvmm".parse::<Backend>().is_err());
        assert!("LLVM".parse::<Backend>().is_err());
        assert!("".parse::<Backend>().is_err());
    }

    #[test]
    fn the_message_names_what_it_would_have_accepted() {
        let error = "jmv".parse::<Backend>().unwrap_err().to_string();
        assert!(error.contains("jmv"), "{error}");
        for backend in Backend::RECOGNIZED {
            assert!(error.contains(backend.name()), "{error}");
        }
    }

    #[test]
    fn the_retired_backend_is_not_a_silent_native_fallback() {
        assert!("wasm".parse::<Backend>().is_err());
        assert_eq!(Backend::ALL, [Backend::C, Backend::Llvm, Backend::Jvm]);
    }
}
