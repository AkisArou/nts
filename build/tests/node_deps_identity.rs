//! Real compiler controls for the bundled native source location contract.
#![cfg(all(target_os = "linux", target_arch = "x86_64"))]
use crate::scratch;

use nts_build::node_deps::{self, Artifacts, Request};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    time::{Duration, SystemTime},
};

fn request(cache: PathBuf, compiler: &[&str]) -> Request {
    Request {
        target: node_deps::recipe().target.clone(),
        compiler: compiler.iter().map(|s| (*s).to_owned()).collect(),
        archiver: vec!["llvm-ar".into()],
        flags: vec!["-g".into()],
        libraries: vec!["uv".into()],
        cache,
        jobs: 2,
    }
}

fn read(path: impl AsRef<Path>) -> Vec<u8> {
    std::fs::read(path).expect("owned native artifact")
}
fn json(path: impl AsRef<Path>) -> Value {
    serde_json::from_slice(&read(path)).expect("native JSON record")
}
fn source(artifacts: &Artifacts) -> &Path {
    Path::new(
        artifacts.include_flags[0]
            .strip_prefix("-I")
            .expect("source include"),
    )
}
fn contains(bytes: &[u8], needle: &[u8]) -> bool {
    bytes.windows(needle.len()).any(|part| part == needle)
}

fn objects(directory: &Path) -> Vec<PathBuf> {
    let mut result = std::fs::read_dir(directory)
        .expect("object directory")
        .map(|entry| entry.expect("object entry").path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "o"))
        .collect::<Vec<_>>();
    result.sort();
    result
}

fn deterministic_members(bytes: &[u8]) -> Vec<String> {
    assert_eq!(&bytes[..8], b"!<arch>\n");
    let mut at = 8;
    let mut names = &[][..];
    let mut members = Vec::new();
    while at < bytes.len() {
        let header = &bytes[at..at + 60];
        assert_eq!(&header[58..], b"`\n");
        let number = |start, end| {
            std::str::from_utf8(&header[start..end])
                .expect("ar field")
                .trim()
        };
        for (start, end) in [(16, 28), (28, 34), (34, 40)] {
            assert!(
                matches!(number(start, end), "" | "0"),
                "non-deterministic archive metadata: {}",
                number(start, end)
            );
        }
        let size = number(48, 58).parse::<usize>().expect("ar member size");
        let body = &bytes[at + 60..at + 60 + size];
        let name = number(0, 16);
        if name == "//" {
            names = body;
        } else if let Some(offset) = name
            .strip_prefix('/')
            .and_then(|offset| offset.parse::<usize>().ok())
        {
            let rest = &names[offset..];
            let end = rest
                .windows(2)
                .position(|part| part == b"/\n")
                .expect("long ar name");
            members.push(
                std::str::from_utf8(&rest[..end])
                    .expect("member name")
                    .to_owned(),
            );
        } else if !name.starts_with('/') {
            members.push(name.trim_end_matches('/').to_owned());
        }
        at += 60 + size + (size % 2);
    }
    assert_eq!(at, bytes.len());
    let mut ordered = members.clone();
    ordered.sort();
    assert_eq!(members, ordered);
    assert_ne!(members, [] as [String; 0]);
    members
}

fn allocated_virtual_path(bytes: &[u8], prefix: &[u8]) -> bool {
    assert_eq!(&bytes[..6], b"\x7fELF\x02\x01");
    let n64 = |at| u64::from_le_bytes(bytes[at..at + 8].try_into().expect("ELF u64"));
    let n16 = |at| u16::from_le_bytes(bytes[at..at + 2].try_into().expect("ELF u16"));
    let start = usize::try_from(n64(40)).expect("section offset");
    (0..usize::from(n16(60))).any(|index| {
        let header = start + index * usize::from(n16(58));
        if n64(header + 8) & 2 == 0 {
            return false;
        }
        let offset = usize::try_from(n64(header + 24)).expect("section bytes");
        let size = usize::try_from(n64(header + 32)).expect("section size");
        // SHT_NOBITS has no payload in the object file.
        let kind = u32::from_le_bytes(
            bytes[header + 4..header + 8]
                .try_into()
                .expect("section type"),
        );
        kind != 8 && contains(&bytes[offset..offset + size], prefix)
    })
}

#[test]
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn libuv_bytes_identity_and_observations_survive_two_roots_and_relocation() {
    for compiler in ["clang", "gcc"] {
        let own = scratch::StdScratchDir::in_std_target("native-root-identity");
        let first_request = request(own.join("a"), &[compiler]);
        let first = node_deps::ensure(&first_request).expect("first root libuv");
        let second_request = request(
            own.join("a-deliberately-much-longer-extraction-root"),
            &[compiler],
        );
        let second = node_deps::ensure(&second_request).expect("second root libuv");
        let bytes = assert_root_parity(&first, &second, compiler);
        let first_dir = first.archives[0].parent().expect("first entry");
        // Relocate the complete private cache, then ask from its new extraction
        // root. An epoch stamp proves no object compilation ran on this hit.
        let object = objects(first_dir).remove(0);
        let relative_object = object
            .strip_prefix(&first_request.cache)
            .expect("cache object")
            .to_owned();
        let stamp = SystemTime::UNIX_EPOCH + Duration::from_secs(1);
        std::fs::File::options()
            .write(true)
            .open(&object)
            .expect("object stamp")
            .set_times(std::fs::FileTimes::new().set_modified(stamp))
            .expect("set sentinel time");
        let relocated = own.join("relocated-cache");
        std::fs::rename(&first_request.cache, &relocated).expect("move only our private cache");
        let moved = node_deps::ensure(&Request {
            cache: relocated.clone(),
            ..first_request
        })
        .expect("root-independent warm hit");
        assert_eq!(
            std::fs::metadata(relocated.join(relative_object))
                .expect("reused object")
                .modified()
                .expect("mtime"),
            stamp
        );
        assert_eq!(read(&moved.archives[0]), bytes);
        // Every call still validates the actual extracted bundle before reuse.
        std::fs::write(
            source(&moved).join("deps/uv/include/uv/version.h"),
            "changed header\n",
        )
        .expect("private source mutation");
        assert!(
            node_deps::ensure(&Request {
                cache: relocated,
                ..second_request
            })
            .expect_err("changed bundle cannot hit")
            .to_string()
            .contains("input changed")
        );
    }
}

fn assert_root_parity(first: &Artifacts, second: &Artifacts, compiler: &str) -> Vec<u8> {
    let first_archive = &first.archives[0];
    let second_archive = &second.archives[0];
    let bytes = read(first_archive);
    assert!(
        bytes == read(second_archive),
        "full archive parity with {compiler}"
    );
    let first_dir = first_archive.parent().expect("first entry");
    let second_dir = second_archive.parent().expect("second entry");
    let before = json(first_dir.join("invocation.json"));
    let after = json(second_dir.join("invocation.json"));
    let fields = before
        .as_array()
        .expect("invocation tuple")
        .iter()
        .zip(after.as_array().expect("invocation tuple"))
        .enumerate()
        .filter_map(|(index, (a, b))| (a != b).then_some(index))
        .collect::<Vec<_>>();
    assert!(
        before == after,
        "{compiler} invocation identity differs at fields {fields:?}"
    );
    assert_eq!(
        deterministic_members(&bytes).len(),
        objects(first_dir).len()
    );
    for root in [source(first), source(second)] {
        assert!(
            !contains(&bytes, root.as_os_str().as_encoded_bytes()),
            "physical source root in archive"
        );
    }
    let virtual_prefix = format!("/nts/node-deps/{}/", node_deps::SOURCE_BUNDLE);
    assert!(
        objects(first_dir)
            .iter()
            .any(|path| allocated_virtual_path(&read(path), virtual_prefix.as_bytes())),
        "an assertion's runtime path has the virtual prefix"
    );
    assert!(
        objects(first_dir)
            .iter()
            .any(|path| contains(&read(path), b".debug_info")),
        "the parity comparison includes actual debug information"
    );
    let manifest = json(first_dir.join("complete.json"));
    assert_eq!(manifest["version"], 2);
    let inputs = manifest["inputs"].as_array().expect("typed observations");
    assert!(inputs.iter().any(|row| row["path"]["kind"] == "bundle"));
    assert!(inputs.iter().any(|row| row["path"]["kind"] == "external"));
    assert!(!contains(
        &read(first_dir.join("complete.json")),
        source(first).as_os_str().as_encoded_bytes()
    ));
    bytes
}

#[test]
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn native_source_maps_refuse_caller_flags_leading_args_and_configs_before_compilation() {
    let own = scratch::StdScratchDir::in_std_target("native-map-authority");
    for compiler in [vec!["clang"], vec!["gcc"], vec!["zig", "cc"]] {
        for flag in [
            "-ffile-prefix-map",
            "-fdebug-prefix-map",
            "-fmacro-prefix-map",
        ] {
            for place in ["flags", "leading", "config"] {
                let mut request = request(
                    own.join(format!("{}-{}-{place}", compiler[0], flag)),
                    &compiler,
                );
                let mapping = format!("{flag}=/=/caller-prefix");
                match place {
                    "flags" => request.flags.push(mapping),
                    "leading" => request.compiler.push(mapping),
                    "config" => {
                        let config = own.join(format!("{}-{flag}.cfg", compiler[0]));
                        std::fs::write(&config, mapping + "\n").expect("private competing config");
                        request.flags.push(format!("--config={}", config.display()));
                    }
                    _ => unreachable!(),
                }
                let error = node_deps::ensure(&request)
                    .expect_err("caller cannot override the source owner")
                    .to_string();
                assert!(
                    error.contains("owner-controlled") && error.contains(flag),
                    "{error}"
                );
                assert!(
                    !request.cache.join("archives").exists(),
                    "refused before object compilation"
                );
            }
        }
    }
}

#[test]
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn all_zig_target_routes_accept_the_same_mapping_contract() {
    let own = scratch::StdScratchDir::in_std_target("native-cross-mapping");
    for plan in &node_deps::bundle().plans {
        let mut request = request(
            own.join(&plan.target),
            &["zig", "cc", "-target", zig_target(&plan.target)],
        );
        request.target = plan.target.clone();
        request.libraries.clear();
        let output = node_deps::ensure(&request)
            .unwrap_or_else(|error| panic!("{} cross mapping: {error}", plan.target));
        assert_eq!(output.archives, [] as [PathBuf; 0]);
    }
}

fn zig_target(target: &str) -> &str {
    match target {
        "x86_64-unknown-linux-gnu" => "x86_64-linux-gnu",
        "aarch64-unknown-linux-gnu" => "aarch64-linux-gnu",
        "x86_64-unknown-linux-musl" => "x86_64-linux-musl",
        "aarch64-unknown-linux-musl" => "aarch64-linux-musl",
        "x86_64-pc-windows-gnu" => "x86_64-windows-gnu",
        "aarch64-pc-windows-gnu" => "aarch64-windows-gnu",
        "x86_64-apple-darwin" => "x86_64-macos",
        "aarch64-apple-darwin" => "aarch64-macos",
        "x86_64-apple-ios-simulator" => "x86_64-ios-simulator",
        _ => panic!("uncontrolled cross target {target}"),
    }
}

#[test]
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn changed_external_header_flag_and_compiler_cannot_reuse_stale_archive_inputs() {
    let own = scratch::StdScratchDir::in_std_target("native-input-invalidation");
    let headers = own.join("headers");
    std::fs::create_dir(&headers).expect("private header input directory");
    let (header, child) = (headers.join("forced.h"), headers.join("external.h"));
    std::fs::write(&header, "#include \"external.h\"\n").expect("forced include");
    std::fs::write(&child, "#define NTS_NATIVE_CONTROL 1\n").expect("external header");
    let mut request = request(own.join("cache"), &["clang"]);
    request
        .flags
        .extend(["-include".into(), header.to_string_lossy().into_owned()]);
    let first = node_deps::ensure(&request).expect("first external header");
    let directory = first.archives[0].parent().expect("entry");
    let before = json(directory.join("complete.json"));
    let object = objects(directory).remove(0);
    let stamp = SystemTime::UNIX_EPOCH + Duration::from_secs(1);
    std::fs::File::options()
        .write(true)
        .open(&object)
        .expect("object stamp")
        .set_times(std::fs::FileTimes::new().set_modified(stamp))
        .expect("sentinel");
    std::fs::write(&child, "#define NTS_NATIVE_CONTROL 2\n")
        .expect("changed transitive external header");
    let changed = node_deps::ensure(&request).expect("rebuild after external header mutation");
    assert_eq!(
        changed.archives, first.archives,
        "the forced header and search identity stayed unchanged"
    );
    assert_ne!(
        std::fs::metadata(&object)
            .expect("rebuilt object")
            .modified()
            .expect("mtime"),
        stamp
    );
    assert_ne!(
        before["inputs"],
        json(directory.join("complete.json"))["inputs"]
    );
    request.flags.push("-DNTS_FLAG_CHANGED=1".into());
    assert_ne!(
        node_deps::ensure(&request).expect("changed flag").archives,
        first.archives
    );
    request.compiler = vec!["gcc".into()];
    assert_ne!(
        node_deps::ensure(&request)
            .expect("changed compiler")
            .archives,
        changed.archives
    );
    let old = own.join("cache/archives/old-generation/keep");
    std::fs::create_dir_all(old.parent().expect("old generation")).expect("private old generation");
    std::fs::write(&old, "retained").expect("old bytes");
    let warm = node_deps::ensure(&request).expect("existing generation hit");
    assert_eq!(read(old), b"retained");
    future_manifest_is_read_only(&request, &warm.archives[0]);
}

fn future_manifest_is_read_only(request: &Request, archive: &Path) {
    let directory = archive.parent().expect("future entry");
    let manifest = directory.join("complete.json");
    let mut value = json(&manifest);
    value["version"] = Value::from(3);
    // The new schema's fields must not even be decoded by this reader.
    value["inputs"] = serde_json::json!({"future":"different observation format"});
    let future = serde_json::to_vec(&value).expect("future manifest");
    std::fs::write(&manifest, &future).expect("private future manifest");
    let invocation = directory.join("invocation.json");
    std::fs::write(&invocation, "future invocation retained\n").expect("private future diagnostic");
    let archive_bytes = read(archive);
    let error = node_deps::ensure(request)
        .expect_err("future cache state is read-only")
        .to_string();
    assert!(error.contains("manifest version 3; expected 2"), "{error}");
    assert_eq!(read(manifest), future);
    assert_eq!(read(invocation), b"future invocation retained\n");
    assert_eq!(read(archive).cmp(&archive_bytes), std::cmp::Ordering::Equal);
}

#[test]
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn unrelated_cached_source_generation_does_not_change_gcc_search_identity() {
    let own = scratch::StdScratchDir::in_std_target("gcc-source-parent");
    let request = request(own.join("cache"), &["gcc"]);
    let first = node_deps::ensure(&request).expect("first GCC archive");
    let object = objects(first.archives[0].parent().expect("entry")).remove(0);
    let stamp = SystemTime::UNIX_EPOCH + Duration::from_secs(1);
    std::fs::File::options()
        .write(true)
        .open(&object)
        .expect("object stamp")
        .set_times(std::fs::FileTimes::new().set_modified(stamp))
        .expect("sentinel");
    let unrelated = request.cache.join("sources/unrelated-generation");
    std::fs::create_dir(&unrelated).expect("another source generation");
    std::fs::write(unrelated.join("unrelated.h"), "not a compiler input\n")
        .expect("unrelated source");
    let second =
        node_deps::ensure(&request).expect("unrelated generation is not a header-search input");
    assert_eq!(first.archives, second.archives);
    assert_eq!(
        std::fs::metadata(object)
            .expect("reused object")
            .modified()
            .expect("mtime"),
        stamp
    );
}

#[test]
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn an_unmapped_file_macro_refuses_at_the_owner_support_probe() {
    let own = scratch::StdScratchDir::in_std_target("native-map-probe");
    let mut request = request(own.join("cache"), &["clang"]);
    request.flags.push("-D__FILE__=\"unmapped\"".into());
    let error = node_deps::ensure(&request)
        .expect_err("the actual macro fails the mapping contract")
        .to_string();
    assert!(error.contains("cannot map source paths"), "{error}");
    assert!(!request.cache.join("archives").exists());
}
