// MIT License

// Copyright (c) 2013 Gorgi Kosev

// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to deal
// in the Software without restriction, including without limitation the rights
// to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
// copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:

// The above copyright notice and this permission notice shall be included in all
// copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
// OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
// SOFTWARE.

// Copyright 2018 Google LLC, Benedikt Meurer
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     <https://www.apache.org/licenses/LICENSE-2.0>
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Transcribed from JetStream 3.0 release revision 3967678fa8ab98d847ab33cf3728dba726fa854b:
// https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/simple/doxbee-promise.js
// Browserify's fixed three-module registration becomes static declarations.
// Constructor functions and prototype aliases become classes with the same
// method bodies; empty object instances remain empty. Erased overloads preserve
// the zero-argument implementation arity of the original ignored-argument calls.
// All 10,000 original calls and their complete promise/await chains remain.
// Draft until the maintainers add awaited harness execution. Apache terms are
// reproduced once in ../LICENSE-jetstream; original MIT/Apache credits are above.


interface VersionRecord {
  userAccountId: number;
  blobId: undefined;
  creatorId: number;
  previousId: number | null;
  id?: number;
}
interface FileRecord { id: number | string | undefined; version: number; }

function dummy_1(): Promise<undefined> { return Promise.resolve(undefined); }
function dummy_2(a: unknown): Promise<undefined> { return Promise.resolve(undefined); }

class Queryish {
  all(): Promise<undefined> { return Promise.resolve(undefined); }
  exec(): Promise<undefined> { return Promise.resolve(undefined); }
  execWithin(a: unknown): Promise<undefined> { return Promise.resolve(undefined); }
  get(): Promise<FileRecord | undefined> { return Promise.resolve(undefined); }
}
function queryish(): Queryish { return new Queryish(); }
class Uuid { v1(): undefined {} }
const uuid = new Uuid();
const userAccount = { id: 1 };
const account = {};
class Blob { put(a: number): Promise<undefined> { return Promise.resolve(undefined); } }
class BlobManager {
  create(account: object): Blob;
  create(): Blob { return new Blob(); }
}
const blobManager = new BlobManager();
var cqQueryish = queryish();
class Self {
  byUuidOrPath(path: string): Queryish;
  byUuidOrPath(): Queryish { return new Queryish(); }
  createQuery(x: string, y: object): Promise<Queryish> { return Promise.resolve(cqQueryish); }
}
const self = new Self();
class File {
  static insert(value: object): Queryish;
  static insert(): Queryish { return new Queryish(); }
  static whereUpdate(where: object, value: object): Queryish;
  static whereUpdate(): Queryish { return new Queryish(); }
}
class FileVersion {
  static insert(value: object): Queryish;
  static insert(): Queryish { return new Queryish(); }
}
class Version {
  static createHash(v: VersionRecord): number { return 1; }
  static insert(value: VersionRecord): Queryish;
  static insert(): Queryish { return new Queryish(); }
}
class Transaction {
  commit(): Promise<undefined> { return Promise.resolve(undefined); }
  rollback(): Promise<undefined> { return Promise.resolve(undefined); }
}
class Db { begin(): Transaction { return new Transaction(); } }
const db = new Db();
export const fakes = {uuid, userAccount, account, blobManager, self, File, FileVersion, Version, db};

export function doxbee(stream: number, idOrPath: string): Promise<undefined> {
  const blob = fakes.blobManager.create(fakes.account);
  const tx = fakes.db.begin();
  let version: VersionRecord, blobId: undefined, fileId: number | string | undefined, file: FileRecord | undefined;

  return blob
    .put(stream)
    .then(blobIdV => {
      blobId = blobIdV;
      return fakes.self.byUuidOrPath(idOrPath).get();
    })
    .then(fileV => {
      file = fileV;
      const previousId = file ? file.version : null;
      version = {
        userAccountId: fakes.userAccount.id,
        blobId: blobId,
        creatorId: fakes.userAccount.id,
        previousId: previousId
      };
      version.id = fakes.Version.createHash(version);
      return fakes.Version.insert(version).execWithin(tx);
    })
    .then(_ => {
      if (!file) {
        const splitPath = idOrPath.lastIndexOf("/") + 1;
        const fileName = idOrPath.substring(splitPath);
        const newId = fakes.uuid.v1();
        return fakes.self
          .createQuery(idOrPath, {
            id: newId,
            userAccountId: fakes.userAccount.id,
            name: fileName,
            version: version.id
          })
          .then(q => {
            return q.execWithin(tx);
          })
          .then(_ => {
            return newId;
          });
      } else {
        return file.id;
      }
    })
    .then(fileIdV => {
      fileId = fileIdV;
      return fakes.FileVersion.insert({
        fileId: fileId,
        versionId: version.id
      }).execWithin(tx);
    })
    .then(_ => {
      return fakes.File.whereUpdate(
        { id: fileId },
        { version: version.id }
      ).execWithin(tx);
    })
    .then(_ => {
      return tx.commit();
    })
    .catch(err => {
      return tx.rollback().then(_ => Promise.reject(err));
    });
};


export class Benchmark {
  runIteration(): Promise<undefined[]> {
    const promises = new Array<Promise<undefined>>(10_000);
    for (var i = 0; i < 10_000; i++)
      promises[i] = doxbee(i, "foo");
    return Promise.all(promises);
  }
}
const benchmark = new Benchmark();
export const seed = 1;
export async function work(n: number): Promise<number> {
  let checksum = 0;
  for (let i = 0; i < n; ++i) {
    const results = await benchmark.runIteration();
    let observed = results.length >>> 0;
    for (const result of results)
      observed = (observed * 31 + (result === undefined ? 1 : 0)) >>> 0;
    checksum = (checksum * 31 + observed) >>> 0;
  }
  return checksum;
}
export async function render(n: number = 1): Promise<undefined[][]> {
  const results: undefined[][] = [];
  for (let i = 0; i < n; ++i) results.push(await benchmark.runIteration());
  return results;
}
