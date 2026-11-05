//! Fresh shared-context population. This generator is also used by the gated
//! work test, so the instruction experiment cannot drift from its guard.
use std::{fmt::Write as _, io, path::Path};

pub(crate) const COUNTS: [usize; 3] = [64, 256, 1024];

#[derive(Debug, Clone, Copy)]
pub(crate) enum Calls {
    WrittenDirect,
    RuntimeDirect,
}

impl Calls {
    pub(crate) const ALL: [Self; 2] = [Self::WrittenDirect, Self::RuntimeDirect];

    pub(crate) const fn name(self) -> &'static str {
        match self {
            Self::WrittenDirect => "written-direct",
            Self::RuntimeDirect => "runtime-direct",
        }
    }

    pub(crate) fn source(self, count: usize) -> String {
        assert!(count > 0);
        let mut source = String::from("interface SharedContext { value: number }\n");
        for at in 0..count {
            writeln!(source, "const k{at} = {at};").expect("writing to a String");
        }
        for at in 0..count {
            let called = match (self, at) {
                (Self::WrittenDirect, 0) => "n".to_owned(),
                (Self::WrittenDirect, _) => "f0(n)".to_owned(),
                (Self::RuntimeDirect, _) => "Math.sin(n)".to_owned(),
            };
            writeln!(
                source,
                "export function f{at}(n: number): number {{ return {called} + k{at}; }}"
            )
            .expect("writing to a String");
        }
        source
    }

    pub(crate) fn write(self, root: &Path, count: usize, repository: &Path) -> io::Result<()> {
        std::fs::create_dir_all(root)?;
        std::fs::write(root.join("main.ts"), self.source(count))?;
        // serde_json is available in both the example and the unit test.
        let config = serde_json::json!({
            "extends": repository.join("tsconfig.fixtures.json"),
            "files": ["main.ts"],
        });
        std::fs::write(root.join("tsconfig.json"), config.to_string())
    }
}
