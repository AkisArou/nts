/*
 * Copyright (C) 2023 Apple Inc. All rights reserved.
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

// Transcribed from WebKit/JetStream generators/sync-file-system.js:
// https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/generators/sync-file-system.js
// Revision: 3967678fa8ab98d847ab33cf3728dba726fa854b.
//
// Preserve all 5,000 directories, 1,200 generated files, byte-order operations,
// recursive generators, visitor passes, deletions, and source validation.
// n controls complete original outer iterations only. No source input is scaled.
// The original listing object is split by its existing instanceof condition so
// TypeScript can track the correlated entry and isDirectory types truthfully.
// Typed-only declarations are erased; original class-field initializers remain.

interface FileListing {
    name: string;
    entry: File;
    isDirectory: false;
}

interface DirectoryListing {
    name: string;
    entry: Directory;
    isDirectory: true;
}

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

export function *randomFileContents(): Generator<DataView, void, unknown> {
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
};


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

    addFile(name: string, file: File): File {
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

    addDirectory(name: string, directory = new Directory): Directory {
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

    * ls(): Generator<Listing, void, unknown> {
        for (let [name, entry] of this.structure) {
            if (entry instanceof Directory)
                yield { name, entry, isDirectory: true };
            else
                yield { name, entry, isDirectory: false };
        }
    }

    * forEachFile(): Generator<FileListing, void, unknown> {
        for (let item of this.ls()) {
            if (!item.isDirectory)
                yield item;
        }
    }

    * forEachFileRecursively(): Generator<FileListing, void, unknown> {
        for (let item of this.ls()) {
            if (item.isDirectory)
                yield* item.entry.forEachFileRecursively();
            else
                yield item;
        } 
    }

    * forEachDirectoryRecursively(): Generator<DirectoryListing, void, unknown> {
        for (let item of this.ls()) {
            if (!item.isDirectory)
                continue;

            yield* item.entry.forEachDirectoryRecursively();
            yield item;
        } 
    }

    fileCount(): number {
        let count = 0;
        for (let item of this.ls()) {
            if (!item.isDirectory)
                ++count;
        }

        return count;
    }

    totalFileSize(): number {
        let size = 0;
        for (const { entry:file } of this.forEachFileRecursively()) {
            size += file.byteLength;
        }
        return size;
    }

    rm(name: string): boolean {
        return this.structure.delete(name);
    }

    visit(visitor: FSVisitor): void {
        visitor.visitDir(undefined, this);
        for (const {name, entry, isDirectory} of this.ls()) {
            if (isDirectory)
                entry.visit(visitor);
            else
                visitor.visitFile(name, entry);
        }
    }

}

export const MAX_DIR_COUNT = 5000;
export const MAX_FILE_COUNT = 1200;

export function setupDirectory(): Directory {
    const fs = new Directory;
    let dirs = [fs];
    for (let dir of dirs) {
        for (let i = 0; i < 15; ++i) {
            if (dirs.length < MAX_DIR_COUNT) {
                dirs.push(dir.addDirectory(`dir-${dirs.length}`));
            }
        }
    }

    let fileCounter = 0;
    for (const fileContents of randomFileContents()) {
        const dirIndex = fileCounter * 107;
        const dir = dirs[dirIndex % dirs.length];
        dir.addFile(`file-${fileCounter}`, new File(fileContents));
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
    fileCount: number = 0;
    dirCount: number = 0;

    visitFile(): void {
        this.fileCount++;
    }

    visitDir(): void {
        this.dirCount++;
    }
}

export class CountDracula extends FSVisitor {
    bytes: number = 0;
    visitFile(name: string, file: File): void {
        this.bytes += file.byteLength;
    }
}

export class Benchmark {
    EXPECTED_FILE_COUNT: number = 1108;

    totalFileCount: number = 0;
    totalDirCount: number = 0;
    lastFileHash: number | undefined = undefined;
    fs: Directory | undefined;

    prepareForNextIteration(): void {
    }

    runIteration(): void {
        this.fs = setupDirectory();

        for (let { entry: file } of this.fs.forEachFileRecursively()) {
            this.lastFileHash = file.swapByteOrder();
        }

        let bytesDeleted = 0;
        let counter = 0;
        for (const { name, entry: dir } of this.fs.forEachDirectoryRecursively()) {
            const oldTotalSize = dir.totalFileSize();
            if (dir.fileCount() === 0)
                continue;
            counter++;
            if (counter % 13 !== 0)
                continue;
            for (const { name } of dir.forEachFile()) {
                const result = dir.rm(name);
                if (!result)
                    throw new Error("rm should have returned true");
            }
            const totalReducedSize = oldTotalSize - dir.totalFileSize();
            bytesDeleted += totalReducedSize;
        }
        if (bytesDeleted === 0)
            throw new Error("Did not delete any files");

        const countVisitor = new CountVisitor();
        this.fs.visit(countVisitor);

        const countDracula = new CountDracula();
        this.fs.visit(countDracula);

        let fileCount: number = 0;
        let fileBytes = 0;
        for (const {entry: file} of this.fs.forEachFileRecursively()) {
            fileCount++
            fileBytes += file.byteLength;
        }
        this.totalFileCount += fileCount;

        let dirCount = 1;
        for (let _ of this.fs.forEachDirectoryRecursively()) {
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

// JetStream registers 80 original outer iterations; each is independently complete.
export const originalIterations = 80;
export const seed = 1;

export function state(n: number): Benchmark {
    const benchmark = new Benchmark();
    for (let i = 0; i < n; ++i) {
        benchmark.prepareForNextIteration();
        benchmark.runIteration();
    }
    benchmark.validate(n);
    return benchmark;
}

export function work(n: number): number {
    const benchmark = state(n);
    // The source validator establishes lastFileHash before this numeric checksum.
    return ((benchmark.totalFileCount * 31 + benchmark.totalDirCount) * 31
        + benchmark.lastFileHash!) >>> 0;
}

export interface FileSnapshot {
    name: string;
    kind: "file";
    bytes: number[];
}

export interface DirectorySnapshot {
    name: string;
    kind: "directory";
    entries: EntrySnapshot[];
}

export type EntrySnapshot = FileSnapshot | DirectorySnapshot;

export interface FilesystemSnapshot {
    totalFileCount: number;
    totalDirCount: number;
    lastFileHash: number;
    entries: EntrySnapshot[];
}

function snapshotDirectory(directory: Directory): EntrySnapshot[] {
    const entries: EntrySnapshot[] = [];
    for (const {name, entry, isDirectory} of directory.ls()) {
        if (isDirectory)
            entries.push({name, kind: "directory", entries: snapshotDirectory(entry)});
        else {
            const bytes: number[] = [];
            for (let i = 0; i < entry.data.byteLength; ++i)
                bytes.push(entry.data.getUint8(i));
            entries.push({name, kind: "file", bytes});
        }
    }
    return entries;
}

// Test-only observation. Byte serialization is outside work's timed path.
export function render(n: number): FilesystemSnapshot {
    const benchmark = state(n);
    return {
        totalFileCount: benchmark.totalFileCount,
        totalDirCount: benchmark.totalDirCount,
        lastFileHash: benchmark.lastFileHash!,
        entries: snapshotDirectory(benchmark.fs!),
    };
}
