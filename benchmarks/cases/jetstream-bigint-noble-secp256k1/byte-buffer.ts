// The MIT License

// Copyright (c) 2013 Dominic Tarr

// Permission is hereby granted, free of charge, 
// to any person obtaining a copy of this software and 
// associated documentation files (the "Software"), to 
// deal in the Software without restriction, including 
// without limitation the rights to use, copy, modify, 
// merge, publish, distribute, sublicense, and/or sell 
// copies of the Software, and to permit persons to whom 
// the Software is furnished to do so, 
// subject to the following conditions:

// The above copyright notice and this permission notice 
// shall be included in all copies or substantial portions of the Software.

// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, 
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES 
// OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. 
// IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR 
// ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, 
// TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE 
// SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.


// Source: WebKit/JetStream bigint/web-crypto-sham.js
// Revision: 3967678fa8ab98d847ab33cf3728dba726fa854b
// https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/bigint/web-crypto-sham.js

/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <https://feross.org>
 * @license  MIT
 */

// Typed class for the numeric Buffer paths called by the bundled SHA routines.
// No native Buffer is used. Uint8Array subclassing replaces setup-only prototype mutation.
const K_MAX_LENGTH = 0x7fffffff;

function assertSize(size: number): void {
  if (typeof size !== 'number') {
    throw new TypeError('"size" argument must be of type number')
  } else if (size < 0) {
    throw new RangeError('The value "' + size + '" is invalid for option "size"')
  }
}
function checked(length: number): number {
  // Note: cannot use `length < K_MAX_LENGTH` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= K_MAX_LENGTH) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + K_MAX_LENGTH.toString(16) + ' bytes')
  }
  return length | 0
}
function createBuffer(length: number): ByteBuffer {
  if (length > K_MAX_LENGTH) {
    throw new RangeError('The value "' + length + '" is invalid for option "size"')
  }
  // Return an augmented `Uint8Array` instance
  var buf = new ByteBuffer(length)
  return buf
}
function checkOffset(offset: number, ext: number, length: number): void {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}
function checkInt(buf: ByteBuffer, value: number, offset: number, ext: number, max: number, min: number): void {
  if (!(buf instanceof ByteBuffer)) throw new TypeError('"buffer" argument must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('"value" argument is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('Index out of range')
}
function alloc(size: number): ByteBuffer {
  assertSize(size)
  if (size <= 0) return createBuffer(size)
  return createBuffer(size)
}
function allocUnsafe(size: number): ByteBuffer {
  assertSize(size)
  return createBuffer(size < 0 ? 0 : checked(size) | 0)
}


function fromArrayLike(array: Uint8Array): ByteBuffer {
  var length = array.length < 0 ? 0 : checked(array.length) | 0
  var buf = createBuffer(length)
  for (var i = 0; i < length; i += 1) {
    buf[i] = array[i] & 255
  }
  return buf
}
function from(value: Uint8Array): ByteBuffer {
  if (ArrayBuffer.isView(value)) return fromArrayLike(value)
  throw new TypeError('Expected a typed byte array in the benchmark hash path')
}

export class ByteBuffer extends Uint8Array {
  static get [Symbol.species](): Uint8ArrayConstructor { return Uint8Array; }
  static isBuffer(value: unknown): value is ByteBuffer { return value instanceof ByteBuffer; }
  static fromValue(value: Uint8Array): ByteBuffer { return from(value); }
  static concat(list: Uint8Array[], length?: number): ByteBuffer {
  if (!Array.isArray(list)) {
    throw new TypeError('"list" argument must be an Array of Buffers')
  }

  if (list.length === 0) {
    return ByteBuffer.alloc(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; ++i) {
      length += list[i].length
    }
  }

  var buffer = ByteBuffer.allocUnsafe(length)
  var pos = 0
  for (i = 0; i < list.length; ++i) {
    var buf = list[i]
    if (buf instanceof Uint8Array) {
      buf = ByteBuffer.fromValue(buf)
    }
    if (!ByteBuffer.isBuffer(buf)) {
      throw new TypeError('"list" argument must be an Array of Buffers')
    }
    buf.copy(buffer, pos)
    pos += buf.length
  }
  return buffer
}
  copy(target: ByteBuffer, targetStart?: number, start?: number, end?: number): number {
  if (!ByteBuffer.isBuffer(target)) throw new TypeError('argument should be a Buffer')
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (Number(targetStart) >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('Index out of range')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start

  if (this === target && typeof this.copyWithin === 'function') {
    // Use built-in when available, missing from IE11
    this.copyWithin(targetStart, start, end)
  } else if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (var i = len - 1; i >= 0; --i) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    target.set(this.subarray(start, end), targetStart)
  }

  return len
}

  static alloc(size: number): ByteBuffer { return alloc(size) }
  static allocUnsafe(size: number): ByteBuffer { return allocUnsafe(size) }
  readInt32BE(offset: number, noAssert?: boolean): number {
  offset = offset >>> 0
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}
  writeUInt32BE(value: number, offset: number, noAssert?: boolean): number {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}
  writeInt32BE(value: number, offset: number, noAssert?: boolean): number {
  value = +value
  offset = offset >>> 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  this[offset] = (value >>> 24)
  this[offset + 1] = (value >>> 16)
  this[offset + 2] = (value >>> 8)
  this[offset + 3] = (value & 0xff)
  return offset + 4
}
  // The original fill number branch, including its explicit loops and range checks.
  fill(val: number, start?: number, end?: number): this {
    if (typeof val === 'number') val = val & 255
    if (Number(start) < 0 || this.length < Number(start) || this.length < Number(end)) {
      throw new RangeError('Out of range index')
    }
    if (Number(end) <= Number(start)) return this
    start = Number(start) >>> 0
    end = end === undefined ? this.length : end >>> 0
    if (!val) val = 0
    var i
    for (i = start; i < end; ++i) this[i] = val
    return this
  }
}
