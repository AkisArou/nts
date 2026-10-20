// What each binding generator's packages are made of, and its fingerprint:
// shared by `build.rs`, which hashes the inputs when this compiler is built,
// and by the test that checks the build hashed what the tree holds. Plain
// comments rather than inner docs, since `build.rs` includes this file.
//
// A fingerprint was a `const fn` over `include_bytes!` of each file, hashed
// by the const interpreter a byte per step: at 510 KB the GIR generator's
// passed rustc's `long_running_const_eval` budget and stopped the build.
// Hashed natively here, once per change, it has no budget to outgrow. The
// WinMD and Objective-C generators still hash theirs as a `const fn`, below
// that budget; each moves here as an entry in `GENERATORS` when its lane
// next lands with its platform reachable.

use std::path::Path;

/// Each generator's inputs, relative to the crate, by the name of the
/// `NTS_GENERATOR_{name}` the build sets. A directory is read whole, so a file
/// added to one is hashed with no list to keep.
pub(crate) const GENERATORS: &[(&str, &[&str])] = &[(
    "GIR",
    &[
        "src/bind_scratch.rs",
        "src/gir_surface.rs",
        "src/bind_header",
        "src/bind_gir",
    ],
)];

/// Every file `inputs` names under `root`, directories walked, as paths
/// relative to `root` with `/` between components, sorted.
pub(crate) fn files(root: &Path, inputs: &[&str]) -> std::io::Result<Vec<String>> {
    let mut found = Vec::new();
    let mut pending: Vec<String> = inputs.iter().map(|input| (*input).to_owned()).collect();
    while let Some(relative) = pending.pop() {
        let path = root.join(&relative);
        if path.is_dir() {
            for entry in std::fs::read_dir(&path)? {
                let name = entry?.file_name();
                pending.push(format!("{relative}/{}", name.to_string_lossy()));
            }
        } else {
            found.push(relative);
        }
    }
    found.sort();
    found.dedup();
    Ok(found)
}

/// FNV-1a over each file `inputs` names, in [`files`]' order: its relative
/// path, a NUL, its length, then its bytes. A rename or a move changes it as
/// an edit does, and nothing of the machine -- an absolute path, a time --
/// reaches it.
pub(crate) fn fingerprint(root: &Path, inputs: &[&str]) -> std::io::Result<u64> {
    let mut hash = 0xcbf2_9ce4_8422_2325_u64;
    let mut eat = |bytes: &[u8]| {
        for &byte in bytes {
            hash = (hash ^ u64::from(byte)).wrapping_mul(0x0100_0000_01b3);
        }
    };
    for relative in files(root, inputs)? {
        let bytes = std::fs::read(root.join(&relative))?;
        eat(relative.as_bytes());
        eat(&[0]);
        eat(&(bytes.len() as u64).to_le_bytes());
        eat(&bytes);
    }
    Ok(hash)
}

#[cfg(test)]
mod tests {
    use super::{GENERATORS, fingerprint};

    /// The fingerprint each generator was built with is the one its inputs
    /// have now: the build hashed what the tree holds, all of it.
    #[test]
    fn the_build_hashed_what_the_tree_holds() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        let built = [("GIR", env!("NTS_GENERATOR_GIR"))];
        assert_eq!(built.len(), GENERATORS.len());
        for (name, inputs) in GENERATORS {
            let (_, set) = built
                .iter()
                .find(|(built, _)| built == name)
                .expect("a fingerprint the build set");
            let hashed = fingerprint(root, inputs).expect("the generator's inputs");
            assert_eq!(format!("{hashed:016x}"), *set, "{name}");
        }
    }
}
