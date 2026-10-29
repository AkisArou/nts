use nts_build::node_deps::{self, Request};
use std::{path::PathBuf, process::Command};

struct Scratch(PathBuf);
impl Scratch {
    fn new(name: &str) -> Self {
        let directory = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
            .join(format!("node-deps-{name}-{}", std::process::id()));
        if directory.exists() {
            std::fs::remove_dir_all(&directory).expect("old private fixture");
        }
        std::fs::create_dir_all(&directory).expect("fixture directory");
        Self(directory)
    }
}
impl Drop for Scratch {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn owned_library_names_cover_elf_macho_and_coff_without_claiming_other_libraries() {
    for (flag, component) in [
        ("-luv", "uv"),
        ("/usr/lib/libcrypto.so.3", "openssl"),
        ("/sdk/lib/libcrypto.3.dylib", "openssl"),
        ("/sdk/lib/libuv.dylib", "uv"),
        ("C:/sdk/lib/crypto.lib", "openssl"),
        ("C:/sdk/lib/libssl-3-x64.dll.a", "openssl"),
        ("libcrypto-1_1-x64.dll", "openssl"),
        ("libssl-3-arm64.lib", "openssl"),
        ("-l:libzstd.dll.a", "zstd"),
        ("brotlicommon.lib", "brotli"),
        ("uv.lib", "uv"),
        ("zlib1.dll", "zlib"),
    ] {
        assert_eq!(node_deps::library_for(flag), Some(component), "{flag}");
    }
    for flag in [
        "-lm",
        "-luserenv",
        "libuuid.dll.a",
        "libzebra.dylib",
        "libcryptohelper.a",
        "libuv.telemetry.dylib",
        "libz-backup.lib",
        "libcrypto-other.dll",
        "libcrypto-3-telemetry.dll",
        "libz.so.telemetry",
        "libssl.3.other.dylib",
    ] {
        assert_eq!(node_deps::library_for(flag), None, "{flag}");
    }
}

#[test]
fn graph_keeps_simd_dependencies_assertions_and_pinned_versions() {
    let recipe = node_deps::recipe();
    let bundle = node_deps::bundle();
    assert_eq!(bundle.versions["node"], bundle.node);
    assert_eq!(bundle.versions["openssl"], "3.5.7");
    let target = |name| {
        recipe
            .targets
            .iter()
            .find(|t| t.name == name)
            .expect("upstream target")
    };
    assert_eq!(target("openssl").dependencies, ["zlib", "brotli", "zstd"]);
    assert_eq!(
        target("zlib").dependencies,
        ["zlib_data_chunk_simd", "zlib_adler32_simd"]
    );
    assert!(
        target("zlib_adler32_simd")
            .cflags
            .iter()
            .any(|f| f == "-mssse3")
    );
    assert!(
        recipe
            .targets
            .iter()
            .all(|t| t.defines.iter().all(|d| d != "NDEBUG"))
    );
    assert!(
        bundle
            .files
            .contains_key("deps/openssl/openssl/crypto/LPdir_unix.c")
    );
}

#[test]
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn real_uv_archive_is_static_reused_and_invalidated_by_flags_or_input_changes() {
    let dir = Scratch::new("uv");
    let request = Request {
        target: node_deps::recipe().target.clone(),
        compiler: vec!["clang".into()],
        archiver: vec!["llvm-ar".into()],
        flags: vec![],
        libraries: vec!["uv".into()],
        cache: dir.0.join("cache"),
        jobs: 2,
    };
    let first = node_deps::ensure(&request).expect("first static libuv");
    assert_eq!(first.archives.len(), 1);
    assert!(first.archives[0].ends_with("liblibuv.a"));
    assert!(
        first
            .link_flags
            .iter()
            .all(|f| !node_deps::owned_library(f))
    );
    let modified = std::fs::metadata(&first.archives[0])
        .expect("archive")
        .modified()
        .expect("mtime");
    let second = node_deps::ensure(&request).expect("warm reuse");
    assert_eq!(
        std::fs::metadata(&second.archives[0])
            .expect("archive")
            .modified()
            .expect("mtime"),
        modified
    );
    let mut changed = request.clone();
    changed.flags.push("-DNTS_CACHE_CONTROL=1".into());
    let third = node_deps::ensure(&changed).expect("flag cache miss");
    assert_ne!(first.archives, third.archives);
    let source = dir.0.join("probe.c");
    std::fs::write(
        &source,
        "#include <uv.h>\nint main(void){return uv_version()==0;}\n",
    )
    .expect("probe");
    let output = dir.0.join("probe");
    let result = Command::new("clang")
        .args(&first.include_flags)
        .arg(&source)
        .args(&first.link_flags)
        .arg("-o")
        .arg(&output)
        .output()
        .expect("link probe");
    assert!(
        result.status.success(),
        "{}",
        String::from_utf8_lossy(&result.stderr)
    );
    assert!(Command::new(&output).status().expect("run probe").success());
    let dynamic = Command::new("readelf")
        .args(["-dW"])
        .arg(&output)
        .output()
        .expect("ELF dynamic section");
    assert!(!String::from_utf8_lossy(&dynamic.stdout).contains("libuv.so"));
    let include = first.include_flags[0]
        .strip_prefix("-I")
        .expect("source directory");
    let header = PathBuf::from(include).join("deps/uv/include/uv/version.h");
    std::fs::write(header, "modified input\n").expect("mutation");
    assert!(
        node_deps::ensure(&request)
            .expect_err("modified source must refuse")
            .to_string()
            .contains("input changed")
    );
}

#[test]
#[cfg(all(target_os = "linux", target_arch = "x86_64"))]
fn config_contents_invalidate_both_spellings_and_nested_inputs_refuse() {
    let dir = Scratch::new("config");
    let config = dir.0.join("compiler.cfg");
    let mut request = Request {
        target: node_deps::recipe().target.clone(),
        compiler: vec!["clang".into()],
        archiver: vec!["llvm-ar".into()],
        flags: vec![],
        libraries: vec!["uv".into()],
        cache: dir.0.join("cache"),
        jobs: 2,
    };
    for joined in [true, false] {
        request.flags = if joined {
            vec![format!("--config={}", config.display())]
        } else {
            vec!["--config".into(), config.to_string_lossy().into_owned()]
        };
        std::fs::write(&config, "-DNTS_CONFIG_CONTROL=1\n").expect("first config");
        let before = node_deps::ensure(&request).expect("first config archive");
        let same = node_deps::ensure(&request).expect("unchanged config hit");
        assert_eq!(before.archives, same.archives);
        std::fs::write(&config, "-DNTS_CONFIG_CONTROL=2\n").expect("content-only change");
        let after = node_deps::ensure(&request).expect("changed config archive");
        assert_ne!(before.archives, after.archives);
    }
    for content in [
        "@nested.rsp\n",
        "--config=another.cfg\n",
        "-fplugin=plugin.so\n",
    ] {
        std::fs::write(&config, content).expect("unadmitted hidden input");
        assert!(
            node_deps::ensure(&request)
                .expect_err("hidden input must refuse")
                .to_string()
                .contains("unsupported or nested")
        );
    }
    request.flags = vec!["@response.rsp".into()];
    assert!(
        node_deps::ensure(&request)
            .expect_err("response input must refuse")
            .to_string()
            .contains("response files")
    );
    let implicit = dir.0.join("implicit");
    std::fs::create_dir(&implicit).expect("default config search");
    request.flags = vec![
        format!("--config-user-dir={}", implicit.display()),
        format!("--config-system-dir={}", implicit.display()),
    ];
    let absent = node_deps::ensure(&request).expect("no implicit config yet");
    let config = implicit.join("clang.cfg");
    std::fs::write(&config, "-DNTS_IMPLICIT_CONFIG=1\n").expect("default config");
    let before = node_deps::ensure(&request).expect("new implicit config");
    assert_ne!(absent.archives, before.archives);
    std::fs::write(&config, "-DNTS_IMPLICIT_CONFIG=2\n").expect("same-path implicit mutation");
    let after = node_deps::ensure(&request).expect("changed implicit config");
    assert_ne!(before.archives, after.archives);
}
