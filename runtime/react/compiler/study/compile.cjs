// Compiles TS/TSX with the Rust React Compiler, keeping TypeScript syntax.
// usage: node compile.cjs <in> <out>   (prints a JSON status line)
const babel = require("@babel/core");
const fs = require("fs");
const PLUGIN = process.env.HOME + "/.cache/nts-react/upstream/compiler/packages/babel-plugin-react-compiler-rust/dist";
const plugin = require(PLUGIN).default;
const [inp, out] = process.argv.slice(2);
const code = fs.readFileSync(inp, "utf8");
const events = [];
const isTsx = !inp.endsWith(".ts");
try {
  const r = babel.transformSync(code, {
    filename: inp, babelrc: false, configFile: false, retainLines: false,
    parserOpts: { plugins: isTsx ? ["typescript", "jsx"] : ["typescript"] },
    plugins: [[plugin, { panicThreshold: "none", compilationMode: process.env.RC_MODE || "infer", environment: { enableFunctionOutlining: process.env.RC_OUTLINE !== "0" },
      logger: { logEvent: (_f, e) => events.push(e) } }]],
  });
  fs.writeFileSync(out, r.code);
  const kinds = {};
  for (const e of events) kinds[e.kind] = (kinds[e.kind] || 0) + 1;
  console.log(JSON.stringify({ file: inp, ok: true, kinds }));
} catch (e) {
  console.log(JSON.stringify({ file: inp, ok: false, error: String(e.message).slice(0, 300) }));
}
