// A few of `fs`'s 133 native bindings, exercised without compiling `fs`.
//
// `fs` does not build — it is stopped by struct-emitter defects and refusals in
// its TypeScript — so none of its native half has ever run under this profile's
// compiler, let alone been compared to anything. These are the ones whose
// behaviour is checkable without a descriptor or a filesystem mutation.
declare function nts_fs_access(path: string, mode: number): number;
declare function nts_fs_chmod(path: string, mode: number): number;
declare function nts_fs_binding_warns_on_mkdtemp(): boolean;

export function access(path: string, mode: number): number {
  return nts_fs_access(path, mode);
}

export function chmod(path: string, mode: number): number {
  return nts_fs_chmod(path, mode);
}

export function warnsOnMkdtemp(): boolean {
  return nts_fs_binding_warns_on_mkdtemp();
}
