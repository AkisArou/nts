/*
 * Copyright (C) 2018-2023 Apple Inc. All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without
 * modification, are permitted provided that the following conditions
 * are met:
 * 1. Redistributions of source code must retain the above copyright
 *    notice, this list of conditions and the following disclaimer.
 * 2. Redistributions in binary form must reproduce the above copyright
 *    notice, this list of conditions and the following disclaimer in the
 *    documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY APPLE INC. AND ITS CONTRIBUTORS ``AS IS''
 * AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO,
 * THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR
 * PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL APPLE INC. OR ITS CONTRIBUTORS
 * BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
 * CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
 * CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
 * ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF
 * THE POSSIBILITY OF SUCH DAMAGE.
*/

// Transcribed from JetStream 3.0 release revision 3967678fa8ab98d847ab33cf3728dba726fa854b:
// https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/generators/async-file-system.js
// All original async generators/awaits, the <= directory bound (2,501 actual
// directories), 800 generated files, byte operations and validation remain.
// The source's missing await in deleted-size arithmetic is deliberately retained
// with Number(Promise), which has the same NaN coercion and pending operation.
// Listing branches make the existing instanceof correlation explicit to types.
// work includes each original prepare step to restore its standalone input;
// JetStream's driver prepared outside timing. Its old filesystem remains live
// until the next complete setup resolves. No generator/Promise is replaced.
// Draft pending awaited harness execution.
interface FileListing { name: string; entry: File; isDirectory: false; }
interface DirectoryListing { name: string; entry: Directory; isDirectory: true; }
type Listing = FileListing | DirectoryListing;

"use strict";

export function computeIsLittleEndian(): boolean {
    let buf = new ArrayBuffer(4);
    let dv = new DataView(buf);
    dv.setUint32(0, 0x11223344, true);
    let view = new Uint8Array(buf);
    return view[0] === 0x44;
}

const isLittleEndian = computeIsLittleEndian();

export async function *randomFileContents(): AsyncGenerator<DataView, void, unknown> {
    let counter = 1;
    while(true) {
        const numBytes = (((counter * 1192.18851371) | 0) % 2056);
        counter++;
        let result = new ArrayBuffer(numBytes);
        let view = new Uint8Array(result);
        for (let i = 0; i < numBytes; ++i)
            view[i] = (i + counter) % 256;
        yield new DataView(result);
    }
}


export class File {
    declare _data: DataView;
    constructor(dataView: DataView, permissions?: unknown) {
        this._data = dataView;
    }

    get data(): DataView { return this._data; }

    set data(dataView: DataView) { this._data = dataView; }

    get byteLength(): number { return this._data.byteLength; }

    swapByteOrder(): number {
        let hash = 0x1a2b3c4d;
        for (let i = 0; i < Math.floor(this.data.byteLength / 8) * 8; i += 8) {
            const data = this.data.getFloat64(i, isLittleEndian);
            this.data.setFloat64(i, data, !isLittleEndian);
            hash ^= data | 0;
        }
        return hash;
    }
}

export class Directory {
    declare structure: Map<string, File | Directory>;
    constructor() {
        this.structure = new Map<string, File | Directory>;
    }

    async addFile(name: string, file: File): Promise<File> {
        let entry = this.structure.get(name);
        if (entry !== undefined) {
            if (entry instanceof File)
                throw new Error("Can't replace file with file.");
            if (entry instanceof Directory)
                throw new Error("Can't replace a file with a new directory.");
            throw new Error("Should not reach this code");
        }

        this.structure.set(name, file);
        return file;
    }

    async addDirectory(name: string, directory = new Directory): Promise<Directory> {
        let entry = this.structure.get(name);
        if (entry !== undefined) {
            if (entry instanceof File)
                throw new Error("Can't replace file with directory.");
            if (entry instanceof Directory)
                throw new Error("Can't replace directory with new directory.");
            throw new Error("Should not reach this code");
        }

        this.structure.set(name, directory);
        return directory;
    }

    async* ls(): AsyncGenerator<Listing, void, unknown> {
        for (let [name, entry] of this.structure) {
            if (entry instanceof Directory)
                yield { name, entry, isDirectory: true };
            else
                yield { name, entry, isDirectory: false };
        }
    }

    async* forEachFile(): AsyncGenerator<FileListing, void, unknown> {
        for await (let item of this.ls()) {
            if (!item.isDirectory)
                yield item;
        }
    }

    async* forEachFileRecursively(): AsyncGenerator<FileListing, void, unknown> {
        for await (let item of this.ls()) {
            if (item.isDirectory) {
                for await (let file of item.entry.forEachFileRecursively())
                    yield file;
            } else {
                yield item;
            }
        }
    }

    async* forEachDirectoryRecursively(): AsyncGenerator<DirectoryListing, void, unknown> {
        for await (let item of this.ls()) {
            if (!item.isDirectory)
                continue;

            for await (let dirItem of item.entry.forEachDirectoryRecursively())
                yield dirItem;

            yield item;
        }
    }

    async fileCount(): Promise<number> {
        let count = 0;
        for await (let item of this.ls()) {
            if (!item.isDirectory)
                ++count;
        }

        return count;
    }

    async totalFileSize(): Promise<number> {
        let size = 0;
        for await (const {entry: file} of this.forEachFileRecursively()) {
            size += file.byteLength;
        }
        return size;
    }

    async rm(name: string): Promise<boolean> {
        return this.structure.delete(name);
    }

    async visit(visitor: FSVisitor): Promise<void> {
        visitor.visitDir(undefined, this);
        for await (const {name, entry, isDirectory} of this.ls()) {
            if (isDirectory)
                await entry.visit(visitor);
            else
                visitor.visitFile(name, entry);
        }
    }

}

export const MAX_DIR_COUNT = 2500;
export const MAX_FILE_COUNT = 800;

export async function setupDirectory(): Promise<Directory> {
    const fs = new Directory;
    let dirs = [fs];
    let counter = 0;
    for (let dir of dirs) {
        for (let i = 0; i < 15; ++i) {
            if (dirs.length <= MAX_DIR_COUNT) {
                dirs.push(await dir.addDirectory(`dir-${i}`));
            }
            counter++;
        }
    }

    let fileCounter = 0;
    for await (const fileContents of randomFileContents()) {
        const dirIndex = fileCounter * 107;
        const dir = dirs[dirIndex % dirs.length];
        await dir.addFile(`file-${fileCounter}`, new File(fileContents));
        fileCounter++
        if (fileCounter >= MAX_FILE_COUNT)
            break;
    }

    return fs;
}

export class FSVisitor {
    visitFile(name: string, file: File): void {
    }

    visitDir(name: string | undefined, dir: Directory): void {
    }
}

export class CountVisitor extends FSVisitor {
    fileCount = 0;
    dirCount = 0;

    visitFile(): void {
        this.fileCount++;
    }

    visitDir(): void {
        this.dirCount++;
    }
}

export class CountDracula extends FSVisitor {
    bytes = 0;
    visitFile(name: string, file: File): void {
        this.bytes += file.byteLength;
    }
}


export class Benchmark {
    EXPECTED_FILE_COUNT = 739;

    totalFileCount = 0;
    totalDirCount = 0;
    lastFileHash: number | undefined = undefined;
    fs: Directory | undefined;

    async prepareForNextIteration(): Promise<void> {
        this.fs = await setupDirectory();
    }

    async runIteration(): Promise<void> {
        if (this.fs === undefined)
            throw new TypeError("Cannot read properties of undefined (reading 'forEachFileRecursively')");
        for await (let { entry: file } of this.fs.forEachFileRecursively()) {
            this.lastFileHash = file.swapByteOrder();
        }

        let bytesDeleted = 0;
        let counter = 0;
        for await (const { name, entry: dir } of this.fs.forEachDirectoryRecursively()) {
            const oldTotalSize = await dir.totalFileSize();
            if (await dir.fileCount() === 0)
                continue;
            counter++;
            if (counter % 13 !== 0)
                continue;
            for await (const { name } of dir.forEachFile()) {
                const result = await dir.rm(name);
                if (!result)
                    throw new Error("rm should have returned true");
            }
            const totalReducedSize = oldTotalSize - Number(dir.totalFileSize());
            bytesDeleted += totalReducedSize;
        }
        if (bytesDeleted === 0)
            throw new Error("Did not delete any files");

        const countVisitor = new CountVisitor();
        await this.fs.visit(countVisitor);

        const countDracula = new CountDracula();
        await this.fs.visit(countDracula);

        let fileCount = 0;
        let fileBytes = 0;
        for await (const {entry: file} of this.fs.forEachFileRecursively()) {
            fileCount++
            fileBytes += file.byteLength;
        }
        this.totalFileCount += fileCount;

        let dirCount = 1;
        for await (let _ of this.fs.forEachDirectoryRecursively()) {
            dirCount++;
        }
        this.totalDirCount += dirCount;

        if (countVisitor.fileCount !== fileCount)
            throw new Error(`Invalid total file count ${countVisitor.fileCount}, expected ${fileCount}.`);
        if (countDracula.bytes !== fileBytes)
            throw new Error(`Invalid total file bytes ${countDracula.bytes}, expected ${fileBytes}.`);
        if (countVisitor.dirCount !== dirCount)
            throw new Error(`Invalid total dir count ${countVisitor.dirCount}, expected ${dirCount}.`);

    }

    validate(iterations: number): void {
        const expectedFileCount = this.EXPECTED_FILE_COUNT * iterations;
        if (this.totalFileCount != expectedFileCount)
            throw new Error(`Invalid total file count ${this.totalFileCount}, expected ${expectedFileCount}.`);
        if (this.lastFileHash === undefined)
            throw new Error(`Invalid file hash: ${this.lastFileHash}`);
    }
}

export const seed = 1;
const benchmark = new Benchmark();
export async function work(n: number): Promise<number> {
    benchmark.totalFileCount = 0;
    benchmark.totalDirCount = 0;
    benchmark.lastFileHash = undefined;
    for (let i = 0; i < n; ++i) {
        await benchmark.prepareForNextIteration();
        await benchmark.runIteration();
    }
    benchmark.validate(n);
    const lastFileHash = benchmark.lastFileHash;
    if (lastFileHash === undefined) throw new Error("Missing validated file hash");
    return ((benchmark.totalFileCount * 31 + benchmark.totalDirCount) * 31 + lastFileHash) >>> 0;
}
export async function state(n: number): Promise<Benchmark> {
    const result = new Benchmark();
    for (let i = 0; i < n; ++i) {
        await result.prepareForNextIteration();
        await result.runIteration();
    }
    result.validate(n);
    return result;
}
export interface FileSnapshot { name: string; kind: "file"; bytes: number[]; }
export interface DirectorySnapshot { name: string; kind: "directory"; entries: EntrySnapshot[]; }
export type EntrySnapshot = FileSnapshot | DirectorySnapshot;
export interface FilesystemSnapshot { totalFileCount: number; totalDirCount: number; lastFileHash: number; entries: EntrySnapshot[]; }
async function snapshotDirectory(directory: Directory): Promise<EntrySnapshot[]> {
    const entries: EntrySnapshot[] = [];
    for await (const {name, entry, isDirectory} of directory.ls()) {
        if (isDirectory) entries.push({name, kind: "directory", entries: await snapshotDirectory(entry)});
        else {
            const bytes: number[] = [];
            for (let i = 0; i < entry.data.byteLength; ++i) bytes.push(entry.data.getUint8(i));
            entries.push({name, kind: "file", bytes});
        }
    }
    return entries;
}
export async function render(n: number = 1): Promise<FilesystemSnapshot> {
    const result = await state(n);
    const fs = result.fs;
    const lastFileHash = result.lastFileHash;
    if (fs === undefined || lastFileHash === undefined) throw new Error("Missing validated filesystem result");
    return {totalFileCount: result.totalFileCount, totalDirCount: result.totalDirCount, lastFileHash, entries: await snapshotDirectory(fs)};
}
