// The binding generators' fingerprints, hashed natively when the compiler is
// built (`src/generator_inputs.rs` says what each generator is made of): a
// generator's packages in the store are keyed by it, so they change when its
// source does, and only then.

include!("src/generator_inputs.rs");

fn main() {
    let root = std::path::PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("cargo sets CARGO_MANIFEST_DIR"),
    );
    for (name, inputs) in GENERATORS {
        // Watched from the list the hash walks, so the two cannot drift: a
        // directory is rescanned whole when anything in it changes.
        for input in *inputs {
            println!("cargo:rerun-if-changed={input}");
        }
        let hash = fingerprint(&root, inputs)
            .unwrap_or_else(|error| panic!("hashing the {name} generator's inputs: {error}"));
        println!("cargo:rustc-env=NTS_GENERATOR_{name}={hash:016x}");
    }
}
