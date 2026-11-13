// Syntax adapters produce these same rows for module code and other readers.
// A data directory is an explicit input, separate from module-owned bytes.
export type InputKind='module'|'data'|'file';
export type ReaderInput={path:string;kind:InputKind};
export type ModuleDeclarations={imports:string[];assets:ReaderInput[]};
export type DirectoryDeclaration={reader:string;directory:string;files:readonly string[];kind:InputKind};
export type InputSnapshot={files:string[];ownedFiles:string[];moduleFiles:string[];directories:DirectoryDeclaration[]};

declare const DATA_DIRECTORY:unique symbol;
export type DataDirectory=URL&{readonly [DATA_DIRECTORY]:true};
/** A pure identity brand. The graph recognizes calls to this owner through
 * lexical bindings; the caller uses the same URL to read its production data. */
export function dataDirectory(url:URL):DataDirectory{return url as DataDirectory;}

declare const FILE_INPUT:unique symbol;
export type FileInput=URL&{readonly [FILE_INPUT]:true};
/** Immutable bytes read as text or data, without entering their imports or
 * launches. A file input never grants a substitutable data namespace. */
export function fileInput(url:URL):FileInput{return url as FileInput;}
