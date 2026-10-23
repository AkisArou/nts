//! Replay the same native host observations without constructing a program.

#[cfg(test)]
#[path = "cache_replay_test.rs"]
mod tests;

use crate::{Input, InputKind, InputPath, ProjectSpec, Session};

/// A readable description of an already fingerprinted host answer.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputObservation {
    Missing,
    Present { fingerprint: u128 },
    Fingerprint(u128),
}

impl std::fmt::Display for InputObservation {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Missing => f.write_str("missing"),
            Self::Present { fingerprint } => write!(f, "present ({fingerprint:032x})"),
            Self::Fingerprint(fingerprint) => write!(f, "{fingerprint:032x}"),
        }
    }
}

impl InputObservation {
    fn of(kind: InputKind, path: &InputPath, fingerprint: u128) -> Self {
        if fingerprint == kind.absent_fingerprint()
            && (matches!(path, InputPath::Utf16(_))
                || matches!(
                    kind,
                    InputKind::File
                        | InputKind::FileExists
                        | InputKind::DirectoryExists
                        | InputKind::Metadata
                ))
        {
            Self::Missing
        } else if matches!(
            kind,
            InputKind::File
                | InputKind::FileExists
                | InputKind::DirectoryExists
                | InputKind::Metadata
        ) {
            Self::Present { fingerprint }
        } else {
            Self::Fingerprint(fingerprint)
        }
    }
}

/// The first differing observation, including its recorded and current values.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("native input changed ({kind:?}) {path}: {recorded} → {current}")]
pub struct InputChanged {
    pub kind: InputKind,
    pub path: InputPath,
    pub recorded: InputObservation,
    pub current: InputObservation,
}

impl Session {
    /// Validate one revision's observations against that revision's input spec.
    ///
    /// This constructs only the original native host, with the current overlay
    /// contents. Each observation goes through the same FS method and encoder
    /// that produced it. The first mismatch returns immediately, in input order.
    /// A UTF-16 path with no Unicode spelling remains deterministically absent.
    ///
    /// Preserve every revision group: validating only the final transformed
    /// overlays can conceal a physical source edit observed before a rewrite.
    /// The caller also keys the requested config/roots/settings and
    /// `Session::cache_identity`; observations do not replace that request key.
    pub fn inputs_match(&self, spec: &ProjectSpec, inputs: &[Input]) -> Result<(), InputChanged> {
        crate::environment::initialize();
        let host = crate::host::Host::new(self.options().cwd.as_str(), &spec.overlays);
        for recorded in inputs {
            let current = host.replay(recorded);
            if current != recorded.fingerprint {
                return Err(InputChanged {
                    kind: recorded.kind,
                    path: recorded.path.clone(),
                    recorded: InputObservation::of(
                        recorded.kind,
                        &recorded.path,
                        recorded.fingerprint,
                    ),
                    current: InputObservation::of(recorded.kind, &recorded.path, current),
                });
            }
        }
        Ok(())
    }
}
