// Test-only capability substitution. The shared package and WPT files stay intact.
import { registerHooks } from "node:module";
registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "c:nts_web_compression") {
      return { url: new URL("./provider-binding.mjs", import.meta.url).href, shortCircuit: true };
    }
    const resolved = next(specifier, context);
    if (resolved.url.endsWith("/runtime/web-platform/test/node-compression-provider.ts")) {
      return { url: new URL("./provider-replacement.ts", import.meta.url).href, shortCircuit: true };
    }
    return resolved;
  },
});
