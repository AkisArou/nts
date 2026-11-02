import { createRequire } from "node:module";
const addon = createRequire(import.meta.url)(process.env.NTS_COMPRESSION_TEST_ADDON);
export const {
  nts_web_compression_open,
  nts_web_compression_process,
  nts_web_compression_status,
  nts_web_compression_consumed,
  nts_web_compression_reset,
  nts_web_compression_close,
} = addon;
