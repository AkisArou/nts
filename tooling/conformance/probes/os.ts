declare function nts_os_hostname(): string;
declare function nts_os_tmpdir(): string;

export function hostname(): string {
  return nts_os_hostname();
}
export function tmpdir(): string {
  return nts_os_tmpdir();
}
