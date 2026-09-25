// Parity: our crate and upstream's napi addon, on identical input bytes.
//
// Runs upstream's Babel plugin (Rust backend) over each file, intercepts every
// call it makes into the compiler, and replays the exact serialized input
// through `nts-react compile-json`. The two result strings must be identical:
// that is what says our crate compiles what upstream compiles, at the pin.
//
// usage: node parity.cjs <nts-react binary> <file>...   (RC_MODE, RC_OUTLINE as in compile.cjs;
//        PARITY_CONTROL=1 runs the control arm, which must differ)
// prints one JSON line per file: {file, calls, identical, differ}
const babel = require("@babel/core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const PLUGIN = process.env.HOME + "/.cache/nts-react/upstream/compiler/packages/babel-plugin-react-compiler-rust";
const bridge = require(PLUGIN + "/dist/bridge");
const napi = require(PLUGIN + "/native");
const plugin = require(PLUGIN + "/dist").default;

const [binary, ...files] = process.argv.slice(2);
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "nts-react-parity-"));

// The same encoding bridge.compileWithRust applies before calling the addon.
function sanitize(json) {
  return json
    .replace(/(?<!\\)\\u([dD][89aAbB][0-9a-fA-F]{2})(?!\\u[dD][c-fC-F][0-9a-fA-F]{2})/g, (_, h) => `__SURROGATE_${h.toUpperCase()}__`)
    .replace(/(?<!\\u[dD][89aAbB][0-9a-fA-F]{2})(?<!\\)\\u([dD][c-fC-F][0-9a-fA-F]{2})/g, (_, h) => `__SURROGATE_${h.toUpperCase()}__`);
}

let calls = 0, identical = 0;
const differ = [];
const original = bridge.compileWithRust;
bridge.compileWithRust = (ast, scopeInfo, options, code) => {
  const input = {
    ast: sanitize(JSON.stringify(ast)),
    scope: JSON.stringify(scopeInfo),
    options: JSON.stringify(code != null ? { ...options, __sourceCode: code } : options),
  };
  const theirs = napi.compile(input.ast, input.scope, input.options);
  // The control arm: PARITY_CONTROL=1 gives our side different options, so a
  // harness that cannot tell two results apart shows up as zero differences.
  const ourInput = { ...input };
  if (process.env.PARITY_CONTROL === "1") {
    const flipped = JSON.parse(input.options);
    flipped.environment = { ...flipped.environment, enableFunctionOutlining: !flipped.environment?.enableFunctionOutlining };
    ourInput.options = JSON.stringify(flipped);
  }
  for (const [name, text] of Object.entries(ourInput)) fs.writeFileSync(path.join(scratch, name + ".json"), text);
  const ours = execFileSync(binary, ["compile-json", ...["ast", "scope", "options"].map((n) => path.join(scratch, n + ".json"))], {
    encoding: "utf8", maxBuffer: 1 << 30,
  }).replace(/\n$/, "");
  calls++;
  if (ours === theirs) identical++;
  else differ.push({ call: calls, oursLength: ours.length, theirsLength: theirs.length });
  return original(ast, scopeInfo, options, code);
};

for (const file of files) {
  calls = 0; identical = 0; differ.length = 0;
  const code = fs.readFileSync(file, "utf8");
  try {
    babel.transformSync(code, {
      filename: file, babelrc: false, configFile: false,
      parserOpts: { plugins: file.endsWith(".ts") ? ["typescript"] : ["typescript", "jsx"] },
      plugins: [[plugin, { panicThreshold: "none", compilationMode: process.env.RC_MODE || "infer",
        environment: { enableFunctionOutlining: process.env.RC_OUTLINE !== "0" } }]],
    });
    console.log(JSON.stringify({ file: path.basename(file), calls, identical, differ }));
  } catch (error) {
    console.log(JSON.stringify({ file: path.basename(file), error: String(error.message).slice(0, 200) }));
  }
}
fs.rmSync(scratch, { recursive: true, force: true });
