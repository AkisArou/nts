/*
 *  Licensed to the Apache Software Foundation (ASF) under one or more
 *  contributor license agreements.  See the NOTICE below for additional
 *  information regarding copyright ownership.
 *  The ASF licenses this file to You under the Apache License, Version 2.0
 *  (the "License"); you may not use this file except in compliance with
 *  the License.  You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */

/******* NOTICE *********

Apache Harmony
Copyright 2006, 2010 The Apache Software Foundation.

This product includes software developed at
The Apache Software Foundation (http://www.apache.org/).

Portions of Apache Harmony were originally developed by
Intel Corporation and are licensed to the Apache Software
Foundation under the "Software Grant and Corporate Contribution
License Agreement" and for which the following copyright notices
apply
         (C) Copyright 2005 Intel Corporation
         (C) Copyright 2005-2006 Intel Corporation
         (C) Copyright 2006 Intel Corporation


The following copyright notice(s) were affixed to portions of the code
with which this file is now or was at one time distributed
and are placed here unaltered.

(C) Copyright 1997,2004 International Business Machines Corporation.
All rights reserved.

(C) Copyright IBM Corp. 2003. 


This software contains code derived from UNIX V7, Copyright(C)
Caldera International Inc.

************************/

// This code is a manual translation of Apache Harmony's HashMap class to
// JavaScript.

// Transcribed from JetStream 3.0, revision 3967678fa8ab98d847ab33cf3728dba726fa854b:
// https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/simple/hash-map.js
// The Apache-2.0 grant and complete original NOTICE are retained above.
// See ../LICENSE-jetstream for the companion licence text and README.md for
// explicit type adaptations and preserved original failure behavior.

export interface Equatable {
    equals(other: HashValue): boolean;
}

export interface Hashable extends Equatable {
    hashCode(): number;
}

type Primitive = undefined | null | boolean | number | string;
export type HashKey = Primitive | Hashable;
export type HashValue = Primitive | Equatable;

interface EntryView<K extends HashKey, V extends HashValue> {
    key: K;
    value: V | null;
}

const DEFAULT_SIZE = 16;

function requireEntry<K extends HashKey, V extends HashValue>(
    entry: Entry<K, V> | null | undefined,
    property: string
): Entry<K, V> {
    if (entry === null || entry === undefined)
        throw new TypeError("Cannot read properties of " + entry + " (reading '" + property + "')");
    return entry;
}

function calculateCapacity(x: number): number
{
        if (x >= 1 << 30)
            return 1 << 30;
        if (x == 0)
            return 16;
        x = x - 1;
        x |= x >> 1;
        x |= x >> 2;
        x |= x >> 4;
        x |= x >> 8;
        x |= x >> 16;
        return x + 1;
    }

function computeHashCode(key: HashKey): number
{
        switch (typeof key) {
        case "undefined":
            return 0;
        case "object":
            if (!key)
                return 0;
        case "function":
            return key.hashCode();
        case "boolean":
            return Number(key) | 0;
        case "number":
            if ((key | 0) == key)
                return key;
            key = "" + key; // Compute string hash of the double. It's the best we can do.
        case "string":
            // source: http://en.wikipedia.org/wiki/Java_hashCode()#Sample_implementations_of_the_java.lang.String_algorithm
            var h = 0;
            var len = key.length;
            for (var index = 0; index < len; index++) {
                h = (((31 * h) | 0) + key.charCodeAt(index)) | 0;
            }
            return h;
        default:
            throw new Error("Internal error: Bad JavaScript value type");
        }
    }

function equals(a: HashValue, b: HashValue): boolean
{
        if (typeof a != typeof b)
            return false;
        switch (typeof a) {
        case "object":
            if (!a)
                return !b;
        case "function":
            switch (typeof b) {
            case "object":
            case "function":
                return a.equals(b);
            default:
                return false;
            }
        default:
            return a == b;
        }
    }

class Entry<K extends HashKey, V extends HashValue> {
    declare _key: K;
    declare _value: V | null;
    declare _origKeyHash: number | undefined;
    declare _next: Entry<K, V> | null | undefined;
    declare _hash: number | undefined;

    constructor(key: K, hash: number | undefined, value: V | null)
    {
        this._key = key;
        this._value = value;
        this._origKeyHash = hash;
        this._next = null;
    }

    clone(): Entry<K, V>
        {
            var result = new Entry<K, V>(this._key, this._hash, this._value);
            if (this._next)
                result._next = this._next.clone();
            return result;
        }

    toString(): string
        {
            return this._key + "=" + this._value;
        }

    get key(): K
        {
            return this._key;
        }

    get value(): V | null
        {
            return this._value;
        }

}

class AbstractMapIterator<K extends HashKey, V extends HashValue> {
    declare _associatedMap: HashMap<K, V>;
    declare _expectedModCount: number;
    declare _futureEntry: Entry<K, V> | null | undefined;
    declare _currentEntry: Entry<K, V> | null | undefined;
    declare _prevEntry: Entry<K, V> | null | undefined;
    declare _position: number;
    declare makeNext: (() => void) | undefined;

    constructor(map: HashMap<K, V>)
    {
        this._associatedMap = map;
        this._expectedModCount = map._modCount;
        this._futureEntry = null;
        this._currentEntry = null;
        this._prevEntry = null;
        this._position = 0;
    }

    hasNext(): boolean
        {
            if (this._futureEntry)
                return true;
            while (this._position < this._associatedMap._elementData.length) {
                if (!this._associatedMap._elementData[this._position])
                    this._position++;
                else
                    return true;
            }
            return false;
        }

    _checkConcurrentMod(): void
        {
            if (this._expectedModCount != this._associatedMap._modCount)
                throw new Error("Concurrent HashMap modification detected");
        }

    _makeNext(): void
        {
            this._checkConcurrentMod();
            if (!this.hasNext())
                throw new Error("No such element");
            if (!this._futureEntry) {
                this._currentEntry = this._associatedMap._elementData[this._position++];
                this._futureEntry = requireEntry(this._currentEntry, "_next")._next;
                this._prevEntry = null;
                return;
            }
            if (this._currentEntry)
                this._prevEntry = this._currentEntry;
            this._currentEntry = this._futureEntry;
            this._futureEntry = this._futureEntry._next;
        }

    remove(): void
        {
            this._checkConcurrentMod();
            if (!this._currentEntry)
                throw new Error("Illegal state");
            if (!this._prevEntry) {
                var index = (this._currentEntry._origKeyHash ?? 0) & (this._associatedMap._elementData.length - 1);
                this._associatedMap._elementData[index] = requireEntry(this._associatedMap._elementData[index], "_next")._next;
            } else
                this._prevEntry._next = this._currentEntry._next;
            this._currentEntry = null;
            this._expectedModCount++;
            this._associatedMap._modCount++;
            this._associatedMap._elementCount--;
        }

}

class EntryIterator<K extends HashKey, V extends HashValue> extends AbstractMapIterator<K, V> {
    constructor(map: HashMap<K, V>)
    {
        super(map);
    }

    next(): Entry<K, V> | null | undefined
        {
            this._makeNext();
            return this._currentEntry;
        }

}

class KeyIterator<K extends HashKey, V extends HashValue> extends AbstractMapIterator<K, V> {
    constructor(map: HashMap<K, V>)
    {
        super(map);
    }

    next(): K
        {
            if (this.makeNext === undefined)
                throw new TypeError("this.makeNext is not a function");
            this.makeNext();
            return requireEntry(this._currentEntry, "_key")._key;
        }

}

class ValueIterator<K extends HashKey, V extends HashValue> extends AbstractMapIterator<K, V> {
    constructor(map: HashMap<K, V>)
    {
        super(map);
    }

    next(): V | null
        {
            if (this.makeNext === undefined)
                throw new TypeError("this.makeNext is not a function");
            this.makeNext();
            return requireEntry(this._currentEntry, "_value")._value;
        }

}

class EntrySet<K extends HashKey, V extends HashValue> {
    declare _associatedMap: HashMap<K, V>;

    constructor(map: HashMap<K, V>)
    {
        this._associatedMap = map;
    }

    size(): number
        {
            return this._associatedMap._elementCount;
        }

    clear(): void
        {
            this._associatedMap.clear();
        }

    remove(object: EntryView<K, V>): boolean
        {
            var entry = this._associatedMap._getEntry(object.key);
            if (!entry)
                return false;
            if (!equals(entry._value, object.value))
                return false;
            this._associatedMap._removeEntry(entry);
            return true;
        }

    contains(object: EntryView<K, V>): boolean
        {
            var entry = this._associatedMap._getEntry(object.key);
            if (!entry)
                return false;
            return equals(entry._value, object.value);
        }

    iterator(): EntryIterator<K, V>
        {
            return new EntryIterator(this._associatedMap);
        }

}

class KeySet<K extends HashKey, V extends HashValue> {
    declare _associatedMap: HashMap<K, V>;

    constructor(map: HashMap<K, V>)
    {
        this._associatedMap = map;
    }

    contains(object: K): boolean
        {
            if (this._associatedMap.contains === undefined)
                throw new TypeError("this._associatedMap.contains is not a function");
            return this._associatedMap.contains(object);
        }

    size(): number
        {
            return this._associatedMap._elementCount;
        }

    clear(): void
        {
            this._associatedMap.clear();
        }

    remove(key: K): boolean
        {
            return !!this._associatedMap.remove(key);
        }

    iterator(): KeyIterator<K, V>
        {
            return new KeyIterator(this._associatedMap);
        }

}

class ValueCollection<K extends HashKey, V extends HashValue> {
    declare _associatedMap: HashMap<K, V>;

    constructor(map: HashMap<K, V>)
    {
        this._associatedMap = map;
    }

    contains(object: V | null): boolean
        {
            return this._associatedMap.containsValue(object);
        }

    size(): number
        {
            return this._associatedMap._elementCount;
        }

    clear(): void
        {
            this._associatedMap.clear();
        }

    iterator(): ValueIterator<K, V>
        {
            return new ValueIterator(this._associatedMap);
        }

}

export class HashMap<K extends HashKey, V extends HashValue> {
    declare _capacity: number;
    declare capacity: undefined;
    declare _elementCount: number;
    declare _elementData: Array<Entry<K, V> | null | undefined>;
    declare _loadFactor: number;
    declare _modCount: number;
    declare _threshold: number;
    declare contains: ((key: K) => boolean) | undefined;

    constructor(capacity?: number | null, loadFactor?: number | null)
    {
        if (capacity == null)
            capacity = DEFAULT_SIZE;
        if (loadFactor == null)
            loadFactor = 0.75;
        
        if (capacity < 0)
            throw new Error("Invalid argument to HashMap constructor: capacity is negative");
        if (loadFactor <= 0)
            throw new Error("Invalid argument to HashMap constructor: loadFactor is not positive");
        
        this._capacity = calculateCapacity(capacity);
        this._elementCount = 0;
        this._elementData = new Array<Entry<K, V> | null | undefined>(this.capacity);
        this._loadFactor = loadFactor;
        this._modCount = 0;
        this._computeThreshold();
    }

    _computeThreshold(): void
        {
            this._threshold = (this._elementData.length * this._loadFactor) | 0;
        }

    clear(): void
        {
            if (!this._elementCount)
                return;
            
            this._elementCount = 0;
            for (var i = this._elementData.length; i--;)
                this._elementData[i] = null;
            this._modCount++;
        }

    clone(): HashMap<K, V>
        {
            var result = new HashMap<K, V>(this._elementData.length, this._loadFactor);
            result.putAll(this);
            return result;
        }

    containsKey(key: K): boolean
        {
            return !!this._getEntry(key);
        }

    containsValue(value: V | null): boolean
        {
            for (var i = this._elementData.length; i--;) {
                for (var entry = this._elementData[i]; entry; entry = entry._next) {
                    if (equals(value, entry._value))
                        return true;
                }
            }
            return false;
        }

    entrySet(): EntrySet<K, V>
        {
            return new EntrySet(this);
        }

    get(key: K): V | null
        {
            var entry = this._getEntry(key);
            if (entry)
                return entry._value;
            return null;
        }

    _getEntry(key: K): Entry<K, V> | null | undefined
        {
            var hash = computeHashCode(key);
            var index = hash & (this._elementData.length - 1);
            return this._findKeyEntry(key, index, hash);
        }

    _findKeyEntry(key: K, index: number, keyHash: number): Entry<K, V> | null | undefined
        {
            var entry = this._elementData[index];
            while (entry && (entry._origKeyHash != keyHash || !equals(key, entry._key)))
                entry = entry._next;
            return entry;
        }

    isEmpty(): boolean
        {
            return !this._elementCount;
        }

    keySet(): KeySet<K, V>
        {
            return new KeySet(this);
        }

    put(key: K, value: V | null): V | null
        {
            var hash = computeHashCode(key);
            var index = hash & (this._elementData.length - 1);
            var entry = this._findKeyEntry(key, index, hash);
            if (!entry) {
                this._modCount++;
                entry = this._createHashedEntry(key, index, hash);
                if (++this._elementCount > this._threshold)
                    this._rehash();
            }
            
            var result = entry._value;
            entry._value = value;
            return result;
        }

    _createHashedEntry(key: K, index: number, hash: number): Entry<K, V>
        {
            var entry = new Entry<K, V>(key, hash, null);
            entry._next = this._elementData[index];
            this._elementData[index] = entry;
            return entry;
        }

    putAll(map: HashMap<K, V>): void
        {
            if (map.isEmpty())
                return;
            for (var iter = map.entrySet().iterator(); iter.hasNext();) {
                var entry = iter.next();
                throw new ReferenceError("put is not defined");
            }
        }

    _rehash(capacity?: number | null): void
        {
            if (capacity == null)
                capacity = this._elementData.length;
            
            var length = calculateCapacity(!capacity ? 1 : capacity << 1);
            var newData = new Array<Entry<K, V> | null | undefined>(length);
            for (var i = 0; i < this._elementData.length; ++i) {
                var entry = this._elementData[i];
                this._elementData[i] = null;
                while (entry) {
                    var index = (entry._origKeyHash ?? 0) & (length - 1);
                    var next: Entry<K, V> | null | undefined = entry._next;
                    entry._next = newData[index];
                    newData[index] = entry;
                    entry = next;
                }
            }
            this._elementData = newData;
            this._computeThreshold();
        }

    remove(key: K): V | null
        {
            var entry = this._removeEntryForKey(key);
            if (!entry)
                return null;
            return entry._value;
        }

    _removeEntry(entry: Entry<K, V>): void
        {
            var index = (entry._origKeyHash ?? 0) & (this._elementData.length - 1);
            var current = this._elementData[index];
            if (current == entry)
                this._elementData[index] = entry._next;
            else {
                while (requireEntry(current, "_next")._next != entry)
                    current = requireEntry(current, "_next")._next;
                requireEntry(current, "_next")._next = entry._next;
            }
            this._modCount++;
            this._elementCount--;
        }

    _removeEntryForKey(key: K): Entry<K, V> | null
        {
            var hash = computeHashCode(key);
            var index = hash & (this._elementData.length - 1);
            var entry = this._elementData[index];
            var last: Entry<K, V> | null = null;
            while (entry != null && !(entry._origKeyHash == hash && equals(key, entry._key))) {
                last = entry;
                entry = entry._next;
            }
            if (!entry)
                return null;
            if (!last)
                this._elementData[index] = entry._next;
            else
                last._next = entry._next;
            this._modCount++;
            this._elementCount--;
            return entry;
        }

    size(): number
        {
            return this._elementCount;
        }

    values(): ValueCollection<K, V>
        {
            return new ValueCollection(this);
        }

}

export interface HashMapObservation {
    lookupSum: number;
    keySum: number;
    valueSum: number;
}

let lastLookupSum = 0;
let lastKeySum = 0;
let lastValueSum = 0;

function run(): void {
    var map = new HashMap<number, number>();
    var COUNT = 90000;

    for (var i = 0; i < COUNT; ++i)
        map.put(i, 42);

    var result = 0;
    for (var j = 0; j < 5; ++j) {
        for (var i = 0; i < COUNT; ++i)
            result += map.get(i) ?? 0;
    }

    var keySum = 0;
    var valueSum = 0;
    for (var iterator = map.entrySet().iterator(); iterator.hasNext();) {
        var entry = requireEntry(iterator.next(), "key");
        keySum += entry.key;
        valueSum += entry.value ?? 0;
    }

    if (result !== 42 * COUNT * 5)
        throw "Error: result = " + result;
    if (keySum !== ((COUNT * (COUNT + 1) / 2) - COUNT))
        throw "Error: keySum = " + keySum;
    if (valueSum !== 42 * COUNT)
        throw "Error: valueSum = " + valueSum;

    // Adapter observation: retain only the three original validated sums.
    lastLookupSum = result;
    lastKeySum = keySum;
    lastValueSum = valueSum;
}

export class Benchmark {
    runIteration(): void {
        run();
    }
}

const benchmark = new Benchmark();

export function observation(): HashMapObservation {
    return { lookupSum: lastLookupSum, keySum: lastKeySum, valueSum: lastValueSum };
}

export function render(n: number = 1): HashMapObservation {
    for (let i = 0; i < n; i++) benchmark.runIteration();
    return observation();
}

export function work(n: number): number {
    let checksum = 0;
    for (let i = 0; i < n; i++) {
        benchmark.runIteration();
        checksum = (checksum * 31 + lastLookupSum) >>> 0;
        checksum = (checksum * 31 + lastKeySum) >>> 0;
        checksum = (checksum * 31 + lastValueSum) >>> 0;
    }
    return checksum;
}

// Opaque count of complete original 90,000-key iterations.
export const seed = 1;
