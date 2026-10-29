"""Bootstrap-only GYP generator. GYP owns evaluation; this serializes its graph."""
import hashlib
import json
import os
import re
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile

sys.dont_write_bytecode = True

generator_default_variables = {
    "CONFIGURATION_NAME": "Release", "EXECUTABLE_PREFIX": "", "EXECUTABLE_SUFFIX": "",
    "STATIC_LIB_PREFIX": "lib", "STATIC_LIB_SUFFIX": ".a", "SHARED_LIB_PREFIX": "lib",
    "SHARED_LIB_SUFFIX": ".so", "INTERMEDIATE_DIR": "@intermediate@",
    "SHARED_INTERMEDIATE_DIR": "@intermediate@", "PRODUCT_DIR": "@product@",
    "LIB_DIR": "@product@", "SHARED_LIB_DIR": "@product@",
}
generator_supports_multiple_toolsets = True
generator_wants_static_library_dependencies_adjusted = False

PLANS = [
    ("x86_64-unknown-linux-gnu", "linux", "x64", "elf", True),
    ("aarch64-unknown-linux-gnu", "linux", "arm64", "elf", True),
    ("x86_64-unknown-linux-musl", "linux", "x64", "elf", True),
    ("aarch64-unknown-linux-musl", "linux", "arm64", "elf", True),
    ("x86_64-pc-windows-gnu", "win", "x64", "coff", False),
    ("aarch64-pc-windows-gnu", "win", "arm64", "coff", False),
    ("x86_64-apple-darwin", "mac", "x64", "macho", False),
    ("aarch64-apple-darwin", "mac", "arm64", "macho", False),
    ("x86_64-apple-ios-simulator", "ios", "x64", "macho", False),
]


def notices(source, files):
    roots = {"openssl": "deps/openssl/openssl/LICENSE.txt", "uv": "deps/uv/LICENSE",
             "brotli": "deps/brotli/LICENSE", "zlib": "deps/zlib/LICENSE", "zstd": "deps/zstd/LICENSE"}
    files.update(roots.values())
    result = {name: (source / path).read_text() for name, path in roots.items()}
    extra = {"uv": ["deps/uv/LICENSE-extra", "deps/uv/include/uv/tree.h", "deps/uv/src/inet.c"],
             "zstd": ["deps/zstd/lib/common/xxhash.h"]}
    for name, paths in extra.items():
        for path in paths:
            files.add(path)
            text = (source / path).read_text()
            if text.startswith("/*"):
                text = text[:text.index("*/") + 2]
            result[name] += "\n\n" + path + ":\n" + text
    # The compiled Chromium zlib additions refer to Chromium's BSD terms.
    # Node's own third-party notices reproduce those terms verbatim. Retain
    # the actual compiled additions' copyright lines beside that full notice.
    files.add("LICENSE")
    node_notice = (source / "LICENSE").read_text()
    chromium = node_notice.split("- inspector_protocol, located at deps/inspector_protocol, is licensed as follows:\n  \"\"\"\n", 1)[1].split('  """', 1)[0]
    copyrights = sorted({line.strip(" /*") for path in files if path.startswith("deps/zlib/")
                         for line in (source / path).read_text(errors="strict").splitlines()
                         if "Copyright" in line and "Chromium" in line})
    if not copyrights:
        raise ValueError("missing compiled Chromium zlib copyright notices")
    result["zlib"] += "\n\nChromium additions:\n" + "\n".join(copyrights) + "\n" + chromium
    return result


def GenerateOutput(target_list, target_dicts, data, params):
    import gyp.common
    source = Path(os.environ["NTS_NODE_SOURCE"]).resolve()
    record = json.loads((source / "NTS-SOURCE.json").read_text())
    triple, _, arch, object_format, full = json.loads(os.environ["NTS_NODE_PLAN"])
    openssl_arch = "linux-aarch64" if full and arch == "arm64" else "linux-x86_64"
    roots = {"libuv": "uv", "openssl": "openssl", "brotli": "brotli", "zlib": "zlib", "zstd": "zstd"}
    if not full:
        roots = {"libuv": "uv"}
    selected = {}
    def select(key):
        if key in selected:
            return
        spec = target_dicts[key]
        if spec["toolset"] != "target" or spec["type"] != "static_library":
            raise ValueError("unexpected dependency target " + key)
        selected[key] = spec
        for dependency in spec.get("dependencies", []):
            select(dependency)
    for key in target_list:
        spec = target_dicts[key]
        if spec["target_name"] in roots and spec["toolset"] == "target":
            select(key)

    def path(value, directory):
        p = (directory / value).resolve()
        return p.relative_to(source).as_posix()
    def flags(values):
        return [part for value in values for part in shlex.split(value) if part != "-DNDEBUG"]
    def defines(values):
        # Node exports libuv from its Windows host. These are private static
        # archives, so its host-export macro must not export the dependency.
        return ['MODULESDIR="/dev/null"' if s.startswith('MODULESDIR=') else s
                for s in values if s not in ["NDEBUG", "BUILDING_UV_SHARED=1"]]
    targets = []
    for key, spec in sorted(selected.items(), key=lambda item: item[1]["target_name"]):
        if any(spec.get(name) for name in ["actions", "rules", "copies"]):
            raise ValueError("unhandled build action in " + key)
        directory = Path(gyp.common.ParseQualifiedTarget(key)[0]).parent
        config = spec["configurations"]["Release"]
        compiled = [path(s, directory) for s in spec.get("sources", []) if Path(s).suffix in [".c", ".cc", ".cpp", ".s", ".S", ".asm"]]
        targets.append({
            "name": spec["target_name"], "sources": compiled,
            "includes": [path(s, directory) for s in config.get("include_dirs", [])],
            "defines": defines(config.get("defines", [])),
            "cflags": flags(config.get("cflags", []) + config.get("cflags_c", [])),
            "libraries": flags(spec.get("libraries", []) + config.get("libraries", []) + spec.get("link_settings", {}).get("libraries", [])),
            "ldflags": flags(config.get("ldflags", []) + spec.get("link_settings", {}).get("ldflags", [])),
            "dependencies": [target_dicts[d]["target_name"] for d in spec.get("dependencies", [])],
        })
    files = {s for t in targets for s in t["sources"]}
    for name in record["files"]:
        p = Path(name)
        header = p.suffix in [".h", ".inc", ".inl", ".def"]
        # Some implementation units include C fragments (OpenSSL's LPdir is
        # one). They travel as source, but only GYP's source list is compiled.
        fragment = p.suffix == ".c" and not any(part in ["test", "tests", "fuzz", "fuzzing", "demos", "doc"] for part in p.parts)
        active_arch = "/config/archs/" not in name or f"/config/archs/{openssl_arch}/asm/" in name
        if (header or fragment) and active_arch:
            files.add(name)
    public = {}
    for key in target_list:
        spec = target_dicts[key]
        if not spec["target_name"].startswith("nts_probe_"):
            continue
        config = spec["configurations"]["Release"]
        directory = Path(gyp.common.ParseQualifiedTarget(key)[0]).parent
        public[spec["target_name"][len("nts_probe_"):]] = {
            "includes": [path(s, directory) for s in config.get("include_dirs", [])],
            "defines": defines(config.get("defines", [])),
            "libraries": flags(spec.get("libraries", []) + config.get("libraries", [])),
            "ldflags": flags(config.get("ldflags", [])),
        }
    version_files = {"uv": "deps/uv/include/uv/version.h", "brotli": "deps/brotli/c/common/version.h",
                     "zstd": "deps/zstd/lib/zstd.h", "zlib": "src/zlib_version.h",
                     "openssl": "deps/openssl/config/archs/linux-x86_64/asm/include/openssl/opensslv.h"}
    def define(path, key):
        match = re.search(r"^#\s*define\s+" + key + r"\s+([^\n]+)", (source / path).read_text(), re.M)
        if not match:
            raise ValueError("missing upstream version " + key)
        return match.group(1).strip().strip('"')
    versions = {"node": record["version"], "zlib": define(version_files["zlib"], "ZLIB_VERSION"),
                "openssl": define(version_files["openssl"], "OPENSSL_VERSION_STR")}
    for name, prefix, parts in [("uv", "UV_VERSION_", ["MAJOR", "MINOR", "PATCH"]),
                                ("brotli", "BROTLI_VERSION_", ["MAJOR", "MINOR", "PATCH"]),
                                ("zstd", "ZSTD_VERSION_", ["MAJOR", "MINOR", "RELEASE"])]:
        versions[name] = ".".join(define(version_files[name], prefix + part) for part in parts)
    files.update(version_files.values())
    licenses = notices(source, files)
    file_hashes = {p: hashlib.sha256((source / p).read_bytes()).hexdigest() for p in sorted(files)}
    result = {"generated_by": "Node's bundled GYP evaluator; tooling/bootstrap/node_recipe.py",
              "node": record["version"], "source_sha256": record["archive_sha256"],
              "target": triple, "object_format": object_format,
              "policy": {"assertions": True, "static": True, "pic": True, "private": True},
              "roots": roots, "public": public, "versions": versions, "notices": licenses,
              "targets": targets, "files": file_hashes}
    text = json.dumps(result, indent=2, sort_keys=True) + "\n"
    Path(os.environ["NTS_NODE_RECIPE"]).write_text(text)


def resolve_one(source, output, plan):
    sys.path.insert(0, str(source / "tools/gyp/pylib"))
    sys.path.insert(0, str(source / "tools/v8_gypfiles"))
    import gyp
    with tempfile.TemporaryDirectory(prefix="node-gyp-", dir=output.parent) as temp:
        root = Path(temp) / "nts_deps.gyp"
        deps = [str(source / ("deps/" + name + "/" + file)) + ":" + target
                for name, file, target in [("uv", "uv.gyp", "libuv"), ("openssl", "openssl.gyp", "openssl"),
                                           ("brotli", "brotli.gyp", "brotli"), ("zlib", "zlib.gyp", "zlib"),
                                           ("zstd", "zstd.gyp", "zstd")]]
        names = ["uv", "openssl", "brotli", "zlib", "zstd"]
        if not plan[4]:
            deps, names = deps[:1], names[:1]
        root.write_text(repr({"targets": [{"target_name": "nts_probe_" + name, "type": "executable", "dependencies": [dep]}
                                          for name, dep in zip(names, deps)]}))
        os.environ["NTS_NODE_SOURCE"] = str(source)
        os.environ["NTS_NODE_RECIPE"] = str(output)
        os.environ["NTS_NODE_PLAN"] = json.dumps(plan)
        variables = {"OS": plan[1], "target_arch": plan[2], "host_arch": "x64", "clang": "1",
                     "library": "static_library", "uv_library": "static_library", "node_shared": "false",
                     "node_shared_openssl": "false", "node_shared_brotli": "false", "node_shared_zlib": "false",
                     "node_shared_zstd": "false", "openssl_no_asm": "0", "gas_version": "2.26",
                     "nasm_version": "0.0", "llvm_version": "22.0", "enable_lto": "false", "enable_thin_lto": "false",
                     "openssl_is_fips": "", "node_with_ltcg": "false", "node_byteorder": "little"}
        args = [str(root), "-f", "node_recipe.py", "--depth=" + str(source), "--generator-output=" + temp,
                "-I", str(source / "common.gypi"), "--no-parallel", "--ignore-environment"]
        args += ["-D" + key + "=" + value for key, value in variables.items()]
        os.chdir(Path(__file__).parent)
        return gyp.main(args)


def main():
    source, output = Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve()
    if len(sys.argv) == 4:
        plan = next(p for p in PLANS if p[0] == sys.argv[3])
        return resolve_one(source, output, plan)
    with tempfile.TemporaryDirectory(prefix="node-plans-", dir=output.parent) as temp:
        records = []
        for index, plan in enumerate(PLANS):
            path = Path(temp) / (str(index) + ".json")
            subprocess.run([sys.executable, "-B", str(Path(__file__).resolve()), str(source), str(path), plan[0]], check=True)
            records.append(json.loads(path.read_text()))
        shared = {name: records[0][name] for name in ["generated_by", "node", "source_sha256", "versions", "notices"]}
        shared["files"] = {}
        shared["plans"] = []
        for record in records:
            for name in ["node", "source_sha256", "versions", "notices"]:
                if record[name] != shared[name]:
                    raise ValueError("inconsistent shared Node input: " + name)
            for name, digest in record["files"].items():
                if name in shared["files"] and shared["files"][name] != digest:
                    raise ValueError("conflicting source identity: " + name)
                shared["files"][name] = digest
            shared["plans"].append({name: record[name] for name in ["target", "object_format", "policy", "roots", "public", "targets"]})
        output.write_text(json.dumps(shared, indent=2, sort_keys=True) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
