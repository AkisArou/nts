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


// Source: https://github.com/WebKit/JetStream/blob/3967678fa8ab98d847ab33cf3728dba726fa854b/bigint/web-crypto-sham.js

// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

interface StreamOptions {
  objectMode?: boolean; readableObjectMode?: boolean; writableObjectMode?: boolean;
  highWaterMark?: number; readableHighWaterMark?: number; writableHighWaterMark?: number;
  emitClose?: boolean; autoDestroy?: boolean; defaultEncoding?: string; decodeStrings?: boolean;
}
type HighWaterKey = 'readableHighWaterMark' | 'writableHighWaterMark';
type EventHandler = (this: Transform) => void;
interface EventTable { prefinish?: EventHandler; newListener?: EventHandler; }
interface TransformState {
  afterTransform: (error?: unknown, data?: Uint8Array) => void;
  needTransform: boolean; transforming: boolean; writecb: null;
  writechunk: null; writeencoding: null;
}

// These callback objects are allocated by the original hash-mode constructors,
// but the benchmark never invokes them. Their general stream execution bodies
// are omitted because they lead to browser process/timer APIs, not HMAC work.
function onwrite(stream: Duplex, error?: unknown): never {
  throw new Error('Stream onwrite execution is outside the benchmark hash path');
}
function onCorkedFinish(request: CorkedRequest, state: WritableState): never {
  throw new Error('Stream cork completion is outside the benchmark hash path');
}
function afterTransform(this: Transform, error?: unknown, data?: Uint8Array): never {
  throw new Error('Stream afterTransform execution is outside the benchmark hash path');
}
function prefinish(this: Transform): never {
  throw new Error('Stream prefinish execution is outside the benchmark hash path');
}

class BufferList {
  declare head: null; declare tail: null; declare length: number;
  constructor() { this.head = null; this.tail = null; this.length = 0; }
}
class CorkedRequest {
  declare next: null; declare entry: null; declare finish: () => void;
  constructor(state: WritableState) {
  var _this = this;

  this.next = null;
  this.entry = null;

  this.finish = function () {
    onCorkedFinish(_this, state);
  };
}
}

function highWaterMarkFrom(options: StreamOptions, isDuplex: boolean, duplexKey: HighWaterKey): number | null | undefined {
  return options.highWaterMark != null ? options.highWaterMark : isDuplex ? options[duplexKey] : null;
}
function getHighWaterMark(state: { objectMode: boolean }, options: StreamOptions, duplexKey: HighWaterKey, isDuplex: boolean): number {
  var hwm = highWaterMarkFrom(options, isDuplex, duplexKey);

  if (hwm != null) {
    if (!(isFinite(hwm) && Math.floor(hwm) === hwm) || hwm < 0) {
      var name = isDuplex ? duplexKey : 'highWaterMark';
      throw new TypeError('The value \"' + hwm + '\" is invalid for option \"' + name + '\"');
    }

    return Math.floor(hwm);
  } // Default value


  return state.objectMode ? 16 : 16 * 1024;
}

class ReadableState {
  declare objectMode: boolean;
  declare highWaterMark: number;
  declare buffer: BufferList;
  declare length: number;
  declare pipes: null;
  declare pipesCount: number;
  declare flowing: boolean | null;
  declare ended: boolean;
  declare endEmitted: boolean;
  declare reading: boolean;
  declare sync: boolean;
  declare needReadable: boolean;
  declare emittedReadable: boolean;
  declare readableListening: boolean;
  declare resumeScheduled: boolean;
  declare paused: boolean;
  declare emitClose: boolean;
  declare autoDestroy: boolean;
  declare destroyed: boolean;
  declare defaultEncoding: string;
  declare awaitDrain: number;
  declare readingMore: boolean;
  declare decoder: null;
  declare encoding: null;
  constructor(options: StreamOptions | undefined, stream: Readable, isDuplex?: boolean) {
  options = options || {}; // Duplex streams are both readable and writable, but share
  // the same options object.
  // However, some cases require setting options to different
  // values for the readable and the writable sides of the duplex stream.
  // These options can be provided separately as readableXXX and writableXXX.

  if (typeof isDuplex !== 'boolean') isDuplex = stream instanceof Duplex; // object stream flag. Used to make read(n) ignore n and to
  // make all the buffer merging and length checks go away

  this.objectMode = !!options.objectMode;
  if (isDuplex) this.objectMode = this.objectMode || !!options.readableObjectMode; // the point at which it stops calling _read() to fill the buffer
  // Note: 0 is a valid value, means "don't call _read preemptively ever"

  this.highWaterMark = getHighWaterMark(this, options, 'readableHighWaterMark', isDuplex); // A linked list is used to store data chunks instead of an array because the
  // linked list can remove elements from the beginning faster than
  // array.shift()

  this.buffer = new BufferList();
  this.length = 0;
  this.pipes = null;
  this.pipesCount = 0;
  this.flowing = null;
  this.ended = false;
  this.endEmitted = false;
  this.reading = false; // a flag to be able to tell if the event 'readable'/'data' is emitted
  // immediately, or on a later tick.  We set this to true at first, because
  // any actions that shouldn't happen until "later" should generally also
  // not happen before the first read call.

  this.sync = true; // whenever we return null, then we set a flag to say
  // that we're awaiting a 'readable' event emission.

  this.needReadable = false;
  this.emittedReadable = false;
  this.readableListening = false;
  this.resumeScheduled = false;
  this.paused = true; // Should close be emitted on destroy. Defaults to true.

  this.emitClose = options.emitClose !== false; // Should .destroy() be called after 'end' (and potentially 'finish')

  this.autoDestroy = !!options.autoDestroy; // has it been destroyed

  this.destroyed = false; // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.

  this.defaultEncoding = options.defaultEncoding || 'utf8'; // the number of writers that are awaiting a drain event in .pipe()s

  this.awaitDrain = 0; // if true, a maybeReadMore has been scheduled

  this.readingMore = false;
  this.decoder = null;
  this.encoding = null;

}
}
class WritableState {
  declare objectMode: boolean;
  declare highWaterMark: number;
  declare finalCalled: boolean;
  declare needDrain: boolean;
  declare ending: boolean;
  declare ended: boolean;
  declare finished: boolean;
  declare destroyed: boolean;
  declare decodeStrings: boolean;
  declare defaultEncoding: string;
  declare length: number;
  declare writing: boolean;
  declare corked: number;
  declare sync: boolean;
  declare bufferProcessing: boolean;
  declare onwrite: (error?: unknown) => void;
  declare writecb: null;
  declare writelen: number;
  declare bufferedRequest: null;
  declare lastBufferedRequest: null;
  declare pendingcb: number;
  declare prefinished: boolean;
  declare errorEmitted: boolean;
  declare emitClose: boolean;
  declare autoDestroy: boolean;
  declare bufferedRequestCount: number;
  declare corkedRequestsFree: CorkedRequest;
  constructor(options: StreamOptions | undefined, stream: Duplex, isDuplex?: boolean) {
  options = options || {}; // Duplex streams are both readable and writable, but share
  // the same options object.
  // However, some cases require setting options to different
  // values for the readable and the writable sides of the duplex stream,
  // e.g. options.readableObjectMode vs. options.writableObjectMode, etc.

  if (typeof isDuplex !== 'boolean') isDuplex = stream instanceof Duplex; // object stream flag to indicate whether or not this stream
  // contains buffers or objects.

  this.objectMode = !!options.objectMode;
  if (isDuplex) this.objectMode = this.objectMode || !!options.writableObjectMode; // the point at which write() starts returning false
  // Note: 0 is a valid value, means that we always return false if
  // the entire buffer is not flushed immediately on write()

  this.highWaterMark = getHighWaterMark(this, options, 'writableHighWaterMark', isDuplex); // if _final has been called

  this.finalCalled = false; // drain event flag.

  this.needDrain = false; // at the start of calling end()

  this.ending = false; // when end() has been called, and returned

  this.ended = false; // when 'finish' is emitted

  this.finished = false; // has it been destroyed

  this.destroyed = false; // should we decode strings into buffers before passing to _write?
  // this is here so that some node-core streams can optimize string
  // handling at a lower level.

  var noDecode = options.decodeStrings === false;
  this.decodeStrings = !noDecode; // Crypto is kind of old and crusty.  Historically, its default string
  // encoding is 'binary' so we have to make this configurable.
  // Everything else in the universe uses 'utf8', though.

  this.defaultEncoding = options.defaultEncoding || 'utf8'; // not an actual buffer we keep track of, but a measurement
  // of how much we're waiting to get pushed to some underlying
  // socket or file.

  this.length = 0; // a flag to see when we're in the middle of a write.

  this.writing = false; // when true all writes will be buffered until .uncork() call

  this.corked = 0; // a flag to be able to tell if the onwrite cb is called immediately,
  // or on a later tick.  We set this to true at first, because any
  // actions that shouldn't happen until "later" should generally also
  // not happen before the first write call.

  this.sync = true; // a flag to know if we're processing previously buffered items, which
  // may call the _write() callback in the same tick, so that we don't
  // end up in an overlapped onwrite situation.

  this.bufferProcessing = false; // the callback that's passed to _write(chunk,cb)

  this.onwrite = function (er?: unknown) {
    onwrite(stream, er);
  }; // the callback that the user supplies to write(chunk,encoding,cb)


  this.writecb = null; // the amount that is being written when _write is called.

  this.writelen = 0;
  this.bufferedRequest = null;
  this.lastBufferedRequest = null; // number of pending user-supplied write callbacks
  // this must be 0 before 'finish' can be emitted

  this.pendingcb = 0; // emit prefinish if the only thing we're waiting for is _write cbs
  // This is relevant for synchronous Transform streams

  this.prefinished = false; // True if the error was already emitted and should not be thrown again

  this.errorEmitted = false; // Should close be emitted on destroy. Defaults to true.

  this.emitClose = options.emitClose !== false; // Should .destroy() be called after 'finish' (and potentially 'end')

  this.autoDestroy = !!options.autoDestroy; // count buffered requests

  this.bufferedRequestCount = 0; // allocate the first CorkedRequest, there is always
  // one allocated and free to use, and we maintain at most two

  this.corkedRequestsFree = new CorkedRequest(this);
}
}

function newEventTable(): EventTable {
  const table: unknown = Object.create(null);
  if (typeof table !== 'object' || table === null) throw new TypeError('Expected an event table');
  return table;
}
function checkListener(listener: EventHandler): void {
  if (typeof listener !== 'function') {
    throw new TypeError('The "listener" argument must be of type Function. Received type ' + typeof listener);
  }
}
function addListener(target: EventEmitter, type: 'prefinish', listener: EventHandler, prepend: boolean): EventEmitter {
  var events;
  var existing;
  checkListener(listener);
  events = target._events;
  if (events === undefined) {
    events = target._events = newEventTable();
    target._eventsCount = 0;
  } else {
    if (events.newListener !== undefined) throw new Error('Stream newListener execution is outside the benchmark hash path');
    existing = events[type];
  }
  if (existing === undefined) {
    existing = events[type] = listener;
    ++target._eventsCount;
  } else {
    throw new Error('Multiple stream listeners are outside the benchmark hash path');
  }
  return target;
}
class EventEmitter {
  declare _events: EventTable | undefined;
  declare _eventsCount: number;
  declare _maxListeners: number | undefined;
  protected initializeEventEmitter(): void { this.initializeEvents(); }
  private initializeEvents(): void {
    // The original prototype slot is permanently undefined for these classes.
    if (this._events === undefined) {
      this._events = newEventTable();
      this._eventsCount = 0;
    }
    this._maxListeners = this._maxListeners || undefined;
  }
  protected addEventListener(type: 'prefinish', listener: EventHandler): EventEmitter {
    return addListener(this, type, listener, false);
  }
}

class Readable extends EventEmitter {
  declare _readableState: ReadableState;
  declare readable: boolean;
  constructor(options?: StreamOptions) {
    super();
    var isDuplex = this instanceof Duplex;
    this._readableState = new ReadableState(options, this, isDuplex);
    this.readable = true;
    this.initializeEventEmitter();
  }
  on(ev: 'prefinish', fn: EventHandler): EventEmitter {
    var res = this.addEventListener(ev, fn);
    var state = this._readableState;
    return res;
  }
}
class Duplex extends Readable {
  declare _writableState: WritableState;
  declare writable: boolean;
  declare allowHalfOpen: boolean;
  constructor(options?: StreamOptions) {
    super(options);
    this.initializeWritable(options);
    this.allowHalfOpen = true;
  }
  private initializeWritable(options?: StreamOptions): void {
    var isDuplex = this instanceof Duplex;
    this._writableState = new WritableState(options, this, isDuplex);
    this.writable = true;
    this.initializeEventEmitter();
  }
}
export class Transform extends Duplex {
  declare _transformState: TransformState;
  constructor(options?: StreamOptions) {
    super(options);
    this._transformState = {
      afterTransform: afterTransform.bind(this),
      needTransform: false,
      transforming: false,
      writecb: null,
      writechunk: null,
      writeencoding: null
    };
    this._readableState.needReadable = true;
    this._readableState.sync = false;
    this.on('prefinish', prefinish);
  }
}
