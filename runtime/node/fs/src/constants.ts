// `fs.constants`, node `src/node_constants.cc`.
//
// POSIX fixes these numbers in the standard rather than leaving them to the
// platform, unlike the signal numbers in `os.constants` -- `O_RDONLY` is 0 and
// `S_IFDIR` is 0o040000 everywhere `node:fs` runs. The ones that are *not*
// fixed are the `O_*` flags above `O_TRUNC`, which is why those are read from
// the platform through a binding rather than written here.

/** File type bits of `Stats.mode`. */
export const S_IFMT = 0o170000;
export const S_IFREG = 0o100000;
export const S_IFDIR = 0o040000;
export const S_IFCHR = 0o020000;
export const S_IFBLK = 0o060000;
export const S_IFIFO = 0o010000;
export const S_IFLNK = 0o120000;
export const S_IFSOCK = 0o140000;

/** Permission bits. */
export const S_IRWXU = 0o700;
export const S_IRUSR = 0o400;
export const S_IWUSR = 0o200;
export const S_IXUSR = 0o100;
export const S_IRWXG = 0o070;
export const S_IRGRP = 0o040;
export const S_IWGRP = 0o020;
export const S_IXGRP = 0o010;
export const S_IRWXO = 0o007;
export const S_IROTH = 0o004;
export const S_IWOTH = 0o002;
export const S_IXOTH = 0o001;

/** `accessSync` modes. */
export const F_OK = 0;
export const X_OK = 1;
export const W_OK = 2;
export const R_OK = 4;

/** `copyFileSync` flags. */
export const COPYFILE_EXCL = 1;
export const COPYFILE_FICLONE = 2;
export const COPYFILE_FICLONE_FORCE = 4;
export const UV_FS_COPYFILE_EXCL = COPYFILE_EXCL;
export const UV_FS_COPYFILE_FICLONE = COPYFILE_FICLONE;
export const UV_FS_COPYFILE_FICLONE_FORCE = COPYFILE_FICLONE_FORCE;

/** libuv directory-entry and symlink flags exposed by Node beside fs flags. */
export const UV_DIRENT_UNKNOWN = 0;
export const UV_DIRENT_FILE = 1;
export const UV_DIRENT_DIR = 2;
export const UV_DIRENT_LINK = 3;
export const UV_DIRENT_FIFO = 4;
export const UV_DIRENT_SOCKET = 5;
export const UV_DIRENT_CHAR = 6;
export const UV_DIRENT_BLOCK = 7;
export const UV_FS_SYMLINK_DIR = 1;
export const UV_FS_SYMLINK_JUNCTION = 2;

/** The `O_*` flags whose values POSIX fixes. */
export const O_RDONLY = 0;
export const O_WRONLY = 1;
export const O_RDWR = 2;

declare function nts_fs_o_creat(): number;
declare function nts_fs_o_excl(): number;
declare function nts_fs_o_trunc(): number;
declare function nts_fs_o_append(): number;
declare function nts_fs_o_sync(): number;

/** Platform-defined open flags, obtained from the same C constants libuv uses. */
export const O_CREAT = nts_fs_o_creat();
export const O_EXCL = nts_fs_o_excl();
export const O_TRUNC = nts_fs_o_trunc();
export const O_APPEND = nts_fs_o_append();
export const O_SYNC = nts_fs_o_sync();
