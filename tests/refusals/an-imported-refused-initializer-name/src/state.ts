import "./constant.ts";
function refusedInitializer(): boolean { return /a+/.test("aaa"); }
export const sha256 = refusedInitializer();
