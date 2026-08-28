// The native half of `node:diagnostics_channel`, for the node-side run only.
import process from "node:process";

globalThis.nts_next_tick = (callback) => { process.nextTick(callback); };
