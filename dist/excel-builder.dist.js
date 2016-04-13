(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
(function (global){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

'use strict'

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('isarray')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Safari 5-7 lacks support for changing the `Object.prototype.constructor` property
 *     on objects.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = global.TYPED_ARRAY_SUPPORT !== undefined
  ? global.TYPED_ARRAY_SUPPORT
  : typedArraySupport()

function typedArraySupport () {
  function Bar () {}
  try {
    var arr = new Uint8Array(1)
    arr.foo = function () { return 42 }
    arr.constructor = Bar
    return arr.foo() === 42 && // typed array instances can be augmented
        arr.constructor === Bar && // constructor can be set
        typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
        arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
  } catch (e) {
    return false
  }
}

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (arg) {
  if (!(this instanceof Buffer)) {
    // Avoid going through an ArgumentsAdaptorTrampoline in the common case.
    if (arguments.length > 1) return new Buffer(arg, arguments[1])
    return new Buffer(arg)
  }

  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    this.length = 0
    this.parent = undefined
  }

  // Common case.
  if (typeof arg === 'number') {
    return fromNumber(this, arg)
  }

  // Slightly less common case.
  if (typeof arg === 'string') {
    return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8')
  }

  // Unusual.
  return fromObject(this, arg)
}

function fromNumber (that, length) {
  that = allocate(that, length < 0 ? 0 : checked(length) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < length; i++) {
      that[i] = 0
    }
  }
  return that
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'

  // Assumption: byteLength() return value is always < kMaxLength.
  var length = byteLength(string, encoding) | 0
  that = allocate(that, length)

  that.write(string, encoding)
  return that
}

function fromObject (that, object) {
  if (Buffer.isBuffer(object)) return fromBuffer(that, object)

  if (isArray(object)) return fromArray(that, object)

  if (object == null) {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (typeof ArrayBuffer !== 'undefined') {
    if (object.buffer instanceof ArrayBuffer) {
      return fromTypedArray(that, object)
    }
    if (object instanceof ArrayBuffer) {
      return fromArrayBuffer(that, object)
    }
  }

  if (object.length) return fromArrayLike(that, object)

  return fromJsonObject(that, object)
}

function fromBuffer (that, buffer) {
  var length = checked(buffer.length) | 0
  that = allocate(that, length)
  buffer.copy(that, 0, 0, length)
  return that
}

function fromArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Duplicate of fromArray() to keep fromArray() monomorphic.
function fromTypedArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  // Truncating the elements is probably not what people expect from typed
  // arrays with BYTES_PER_ELEMENT > 1 but it's compatible with the behavior
  // of the old Buffer constructor.
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayBuffer (that, array) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    array.byteLength
    that = Buffer._augment(new Uint8Array(array))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromTypedArray(that, new Uint8Array(array))
  }
  return that
}

function fromArrayLike (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Deserialize { type: 'Buffer', data: [1,2,3,...] } into a Buffer object.
// Returns a zero-length buffer for inputs that don't conform to the spec.
function fromJsonObject (that, object) {
  var array
  var length = 0

  if (object.type === 'Buffer' && isArray(object.data)) {
    array = object.data
    length = checked(array.length) | 0
  }
  that = allocate(that, length)

  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

if (Buffer.TYPED_ARRAY_SUPPORT) {
  Buffer.prototype.__proto__ = Uint8Array.prototype
  Buffer.__proto__ = Uint8Array
} else {
  // pre-set for values that may exist in the future
  Buffer.prototype.length = undefined
  Buffer.prototype.parent = undefined
}

function allocate (that, length) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = Buffer._augment(new Uint8Array(length))
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    that.length = length
    that._isBuffer = true
  }

  var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1
  if (fromPool) that.parent = rootParent

  return that
}

function checked (length) {
  // Note: cannot use `length < kMaxLength` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  var i = 0
  var len = Math.min(x, y)
  while (i < len) {
    if (a[i] !== b[i]) break

    ++i
  }

  if (i !== len) {
    x = a[i]
    y = b[i]
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; i++) {
      length += list[i].length
    }
  }

  var buf = new Buffer(length)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

function byteLength (string, encoding) {
  if (typeof string !== 'string') string = '' + string

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'binary':
      // Deprecated
      case 'raw':
      case 'raws':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

function slowToString (encoding, start, end) {
  var loweredCase = false

  start = start | 0
  end = end === undefined || end === Infinity ? this.length : end | 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` is deprecated
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` is deprecated
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    var swap = encoding
    encoding = offset
    offset = length | 0
    length = swap
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'binary':
        return binaryWrite(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
      : (firstByte > 0xBF) ? 2
      : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = (value & 0xff)
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = (value & 0xff)
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = (value & 0xff)
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; i--) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; i++) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), targetStart)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = (leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00) + 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"base64-js":2,"ieee754":3,"isarray":4}],2:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],3:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],4:[function(require,module,exports){
var toString = {}.toString;

module.exports = Array.isArray || function (arr) {
  return toString.call(arr) == '[object Array]';
};

},{}],5:[function(require,module,exports){
/**
 * Node.js module for Forge.
 *
 * @author Dave Longley
 *
 * Copyright 2011-2014 Digital Bazaar, Inc.
 */
(function() {
var name = 'forge';
if(typeof define !== 'function') {
  // NodeJS -> AMD
  if(typeof module === 'object' && module.exports) {
    var nodeJS = true;
    define = function(ids, factory) {
      factory(require, module);
    };
  } else {
    // <script>
    if(typeof forge === 'undefined') {
      // set to true to disable native code if even it's available
      forge = {disableNativeCode: false};
    }
    return;
  }
}
// AMD
var deps;
var defineFunc = function(require, module) {
  module.exports = function(forge) {
    var mods = deps.map(function(dep) {
      return require(dep);
    });
    // handle circular dependencies
    forge = forge || {};
    forge.defined = forge.defined || {};
    if(forge.defined[name]) {
      return forge[name];
    }
    forge.defined[name] = true;
    for(var i = 0; i < mods.length; ++i) {
      mods[i](forge);
    }
    return forge;
  };
  // set to true to disable native code if even it's available
  module.exports.disableNativeCode = false;
  module.exports(module.exports);
};
var tmpDefine = define;
define = function(ids, factory) {
  deps = (typeof ids === 'string') ? factory.slice(2) : ids.slice(2);
  if(nodeJS) {
    delete define;
    return tmpDefine.apply(null, Array.prototype.slice.call(arguments, 0));
  }
  define = tmpDefine;
  return define.apply(null, Array.prototype.slice.call(arguments, 0));
};
define([
  'require',
  'module',
  './aes',
  './aesCipherSuites',
  './asn1',
  './cipher',
  './cipherModes',
  './debug',
  './des',
  './hmac',
  './kem',
  './log',
  './md',
  './mgf1',
  './pbkdf2',
  './pem',
  './pkcs7',
  './pkcs1',
  './pkcs12',
  './pki',
  './prime',
  './prng',
  './pss',
  './random',
  './rc2',
  './ssh',
  './task',
  './tls',
  './util'
], function() {
  defineFunc.apply(null, Array.prototype.slice.call(arguments, 0));
});
})();

},{}],6:[function(require,module,exports){
var bundleFn = arguments[3];
var sources = arguments[4];
var cache = arguments[5];

var stringify = JSON.stringify;

module.exports = function (fn) {
    var keys = [];
    var wkey;
    var cacheKeys = Object.keys(cache);

    for (var i = 0, l = cacheKeys.length; i < l; i++) {
        var key = cacheKeys[i];
        var exp = cache[key].exports;
        // Using babel as a transpiler to use esmodule, the export will always
        // be an object with the default export as a property of it. To ensure
        // the existing api and babel esmodule exports are both supported we
        // check for both
        if (exp === fn || exp.default === fn) {
            wkey = key;
            break;
        }
    }

    if (!wkey) {
        wkey = Math.floor(Math.pow(16, 8) * Math.random()).toString(16);
        var wcache = {};
        for (var i = 0, l = cacheKeys.length; i < l; i++) {
            var key = cacheKeys[i];
            wcache[key] = key;
        }
        sources[wkey] = [
            Function(['require','module','exports'], '(' + fn + ')(self)'),
            wcache
        ];
    }
    var skey = Math.floor(Math.pow(16, 8) * Math.random()).toString(16);

    var scache = {}; scache[wkey] = wkey;
    sources[skey] = [
        Function(['require'], (
            // try to call default if defined to also support babel esmodule
            // exports
            'var f = require(' + stringify(wkey) + ');' +
            '(f.default ? f.default : f)(self);'
        )),
        scache
    ];

    var src = '(' + bundleFn + ')({'
        + Object.keys(sources).map(function (key) {
            return stringify(key) + ':['
                + sources[key][0]
                + ',' + stringify(sources[key][1]) + ']'
            ;
        }).join(',')
        + '},{},[' + stringify(skey) + '])'
    ;

    var URL = window.URL || window.webkitURL || window.mozURL || window.msURL;

    return new Worker(URL.createObjectURL(
        new Blob([src], { type: 'text/javascript' })
    ));
};

},{}],7:[function(require,module,exports){
(function (global){
"use strict";
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
var util = require('../util');

/**
 *
 * @param {Object} config
 * @param {Number} config.x X offset in EMU's
 * @param {Number} config.y Y offset in EMU's
 * @param {Number} config.width Width in EMU's
 * @param {Number} config.height Height in EMU's
 * @constructor
 */
var AbsoluteAnchor = function (config) {
    this.x = null;
    this.y = null;
    this.width = null;
    this.height = null;
    if(config) {
        this.setPos(config.x, config.y);
        this.setDimensions(config.width, config.height);
    }
};
_.extend(AbsoluteAnchor.prototype, {
    /**
     * Sets the X and Y offsets.
     *
     * @param {Number} x
     * @param {Number} y
     * @returns {undefined}
     */
    setPos: function (x, y) {
        this.x = x;
        this.y = y;
    },
    /**
     * Sets the width and height of the image.
     *
     * @param {Number} width
     * @param {Number} height
     * @returns {undefined}
     */
    setDimensions: function (width, height) {
        this.width = width;
        this.height = height;
    },
    toXML: function (xmlDoc, content) {
        var root = util.createElement(xmlDoc, 'xdr:absoluteAnchor');
        var pos = util.createElement(xmlDoc, 'xdr:pos');
        pos.setAttribute('x', this.x);
        pos.setAttribute('y', this.y);
        root.appendChild(pos);

        var dimensions = util.createElement(xmlDoc, 'xdr:ext');
        dimensions.setAttribute('cx', this.width);
        dimensions.setAttribute('cy', this.height);
        root.appendChild(dimensions);

        root.appendChild(content);

        root.appendChild(util.createElement(xmlDoc, 'xdr:clientData'));
        return root;
    }
});
module.exports = AbsoluteAnchor;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"../util":28}],8:[function(require,module,exports){
(function (global){
"use strict";
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
//var util = require('../util');
var Chart = function () {

};
_.extend(Chart.prototype, {

});
module.exports = Chart;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],9:[function(require,module,exports){
(function (global){
"use strict";
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
var util = require('../util');

/**
 *
 * @param {Object} config
 * @param {Number} config.x The cell column number that the top left of the picture will start in
 * @param {Number} config.y The cell row number that the top left of the picture will start in
 * @param {Number} config.width Width in EMU's
 * @param {Number} config.height Height in EMU's
 * @constructor
 */
var OneCellAnchor = function (config) {
    this.x = null;
    this.y = null;
    this.xOff = null;
    this.yOff = null;
    this.width = null;
    this.height = null;
    if(config) {
        this.setPos(config.x, config.y, config.xOff, config.yOff);
        this.setDimensions(config.width, config.height);
    }
};
_.extend(OneCellAnchor.prototype, {
    setPos: function (x, y, xOff, yOff) {
        this.x = x;
        this.y = y;
        if(xOff !== undefined) {
            this.xOff = xOff;
        }
        if(yOff !== undefined) {
            this.yOff = yOff;
        }
    },
    setDimensions: function (width, height) {
        this.width = width;
        this.height = height;
    },
    toXML: function (xmlDoc, content) {
        var root = util.createElement(xmlDoc, 'xdr:oneCellAnchor');
        var from = util.createElement(xmlDoc, 'xdr:from');
        var fromCol = util.createElement(xmlDoc, 'xdr:col');
        fromCol.appendChild(xmlDoc.createTextNode(this.x));
        var fromColOff = util.createElement(xmlDoc, 'xdr:colOff');
        fromColOff.appendChild(xmlDoc.createTextNode(this.xOff || 0));
        var fromRow = util.createElement(xmlDoc, 'xdr:row');
        fromRow.appendChild(xmlDoc.createTextNode(this.y));
        var fromRowOff = util.createElement(xmlDoc, 'xdr:rowOff');
        fromRowOff.appendChild(xmlDoc.createTextNode(this.yOff || 0));
        from.appendChild(fromCol);
        from.appendChild(fromColOff);
        from.appendChild(fromRow);
        from.appendChild(fromRowOff);

        root.appendChild(from);

        var dimensions = util.createElement(xmlDoc, 'xdr:ext');
        dimensions.setAttribute('cx', this.width);
        dimensions.setAttribute('cy', this.height);
        root.appendChild(dimensions);

        root.appendChild(content);

        root.appendChild(util.createElement(xmlDoc, 'xdr:clientData'));
        return root;
    }
});
module.exports = OneCellAnchor;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"../util":28}],10:[function(require,module,exports){
(function (global){
"use strict";
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
var util = require('../util');
var Drawing = require('./index');

var Picture = function () {
    this.media = null;
    this.id = _.uniqueId('Picture');
    this.pictureId = util.uniqueId('Picture');
    this.fill = {};
    this.mediaData = null;
};

Picture.prototype = new Drawing();

_.extend(Picture.prototype, {
    setMedia: function (mediaRef) {
        this.mediaData = mediaRef;
    },
    setDescription: function (description) {
        this.description = description;
    },
    setFillType: function (type) {
        this.fill.type = type;
    },
    setFillConfig: function (config) {
        _.extend(this.fill, config);
    },
    getMediaType: function () {
        return 'image';
    },
    getMediaData: function () {
        return this.mediaData;
    },
    setRelationshipId: function (rId) {
        this.mediaData.rId = rId;
    },
    toXML: function (xmlDoc) {
        var pictureNode = util.createElement(xmlDoc, 'xdr:pic');

        var nonVisibleProperties = util.createElement(xmlDoc, 'xdr:nvPicPr');

        var nameProperties = util.createElement(xmlDoc, 'xdr:cNvPr', [
            ['id', this.pictureId],
            ['name', this.mediaData.fileName],
            ['descr', this.description || ""]
        ]);
        nonVisibleProperties.appendChild(nameProperties);
        var nvPicProperties = util.createElement(xmlDoc, 'xdr:cNvPicPr');
        nvPicProperties.appendChild(util.createElement(xmlDoc, 'a:picLocks', [
            ['noChangeAspect', '1'],
            ['noChangeArrowheads', '1']
        ]));
        nonVisibleProperties.appendChild(nvPicProperties);
        pictureNode.appendChild(nonVisibleProperties);
        var pictureFill = util.createElement(xmlDoc, 'xdr:blipFill');
        pictureFill.appendChild(util.createElement(xmlDoc, 'a:blip', [
            ['xmlns:r', util.schemas.relationships],
            ['r:embed', this.mediaData.rId]
        ]));
        pictureFill.appendChild(util.createElement(xmlDoc, 'a:srcRect'));
        var stretch = util.createElement(xmlDoc, 'a:stretch');
        stretch.appendChild(util.createElement(xmlDoc, 'a:fillRect'));
        pictureFill.appendChild(stretch);
        pictureNode.appendChild(pictureFill);

        var shapeProperties = util.createElement(xmlDoc, 'xdr:spPr', [
            ['bwMode', 'auto']
        ]);

        var transform2d = util.createElement(xmlDoc, 'a:xfrm');
        shapeProperties.appendChild(transform2d);

        var presetGeometry = util.createElement(xmlDoc, 'a:prstGeom', [
            ['prst', 'rect']
        ]);
        shapeProperties.appendChild(presetGeometry);



        pictureNode.appendChild(shapeProperties);
//            <xdr:spPr bwMode="auto">
//                <a:xfrm>
//                    <a:off x="1" y="1"/>
//                    <a:ext cx="1640253" cy="1885949"/>
//                </a:xfrm>
//                <a:prstGeom prst="rect">
//                    <a:avLst/>
//                </a:prstGeom>
//                <a:noFill/>
//                <a:extLst>
//                    <a:ext uri="{909E8E84-426E-40DD-AFC4-6F175D3DCCD1}">
//                        <a14:hiddenFill xmlns:a14="http://schemas.microsoft.com/office/drawing/2010/main">
//                            <a:solidFill>
//                                <a:srgbClr val="FFFFFF"/>
//                            </a:solidFill>
//                        </a14:hiddenFill>
//                    </a:ext>
//                </a:extLst>
//            </xdr:spPr>
//
        return this.anchor.toXML(xmlDoc, pictureNode);
    }
});

module.exports = Picture;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"../util":28,"./index":12}],11:[function(require,module,exports){
(function (global){
"use strict";
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
var util = require('../util');

var TwoCellAnchor = function (config) {
    this.from = {xOff: 0, yOff: 0};
    this.to = {xOff: 0, yOff: 0};
    if(config) {
        this.setFrom(config.from.x, config.from.y, config.to.xOff, config.to.yOff);
        this.setTo(config.to.x, config.to.y, config.to.xOff, config.to.yOff);
    }
};
_.extend(TwoCellAnchor.prototype, {
    setFrom: function (x, y, xOff, yOff) {
        this.from.x = x;
        this.from.y = y;
        if(xOff !== undefined) {
            this.from.xOff = xOff;
        }
        if(yOff !== undefined) {
            this.from.yOff = xOff;
        }
    },
    setTo: function (x, y, xOff, yOff) {
        this.to.x = x;
        this.to.y = y;
        if(xOff !== undefined) {
            this.to.xOff = xOff;
        }
        if(yOff !== undefined) {
            this.to.yOff = xOff;
        }
    },
    toXML: function (xmlDoc, content) {
        var root = util.createElement(xmlDoc, 'xdr:twoCellAnchor');

        var from = util.createElement(xmlDoc, 'xdr:from');
        var fromCol = util.createElement(xmlDoc, 'xdr:col');
        fromCol.appendChild(xmlDoc.createTextNode(this.from.x));
        var fromColOff = util.createElement(xmlDoc, 'xdr:colOff');
        fromColOff.appendChild(xmlDoc.createTextNode(this.from.xOff));
        var fromRow = util.createElement(xmlDoc, 'xdr:row');
        fromRow.appendChild(xmlDoc.createTextNode(this.from.y));
        var fromRowOff = util.createElement(xmlDoc, 'xdr:rowOff');
        fromRowOff.appendChild(xmlDoc.createTextNode(this.from.yOff));

        from.appendChild(fromCol);
        from.appendChild(fromColOff);
        from.appendChild(fromRow);
        from.appendChild(fromRowOff);

        var to = util.createElement(xmlDoc, 'xdr:to');
        var toCol = util.createElement(xmlDoc, 'xdr:col');
        toCol.appendChild(xmlDoc.createTextNode(this.to.x));
        var toColOff = util.createElement(xmlDoc, 'xdr:colOff');
        toColOff.appendChild(xmlDoc.createTextNode(this.from.xOff));
        var toRow = util.createElement(xmlDoc, 'xdr:row');
        toRow.appendChild(xmlDoc.createTextNode(this.to.y));
        var toRowOff = util.createElement(xmlDoc, 'xdr:rowOff');
        toRowOff.appendChild(xmlDoc.createTextNode(this.from.yOff));

        to.appendChild(toCol);
        to.appendChild(toColOff);
        to.appendChild(toRow);
        to.appendChild(toRowOff);


        root.appendChild(from);
        root.appendChild(to);

        root.appendChild(content);

        root.appendChild(util.createElement(xmlDoc, 'xdr:clientData'));
        return root;
    }
});
module.exports = TwoCellAnchor;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"../util":28}],12:[function(require,module,exports){
(function (global){
"use strict";
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
var AbsoluteAnchor = require('./AbsoluteAnchor');
var OneCellAnchor = require('./OneCellAnchor');
var TwoCellAnchor = require('./TwoCellAnchor');

/**
 * This is mostly a global spot where all of the relationship managers can get and set
 * path information from/to. 
 * @module Excel/Drawing
 */
var Drawing = function () {
    this.id = _.uniqueId('Drawing');
};

_.extend(Drawing.prototype, {
    /**
     *
     * @param {String} type Can be 'absoluteAnchor', 'oneCellAnchor', or 'twoCellAnchor'.
     * @param {Object} config Shorthand - pass the created anchor coords that can normally be used to construct it.
     * @returns {Anchor}
     */
    createAnchor: function (type, config) {
        config = config || {};
        config.drawing = this;
        switch(type) {
            case 'absoluteAnchor':
                this.anchor = new AbsoluteAnchor(config);
                break;
            case 'oneCellAnchor':
                this.anchor = new OneCellAnchor(config);
                break;
            case 'twoCellAnchor':
                this.anchor = new TwoCellAnchor(config);
                break;
        }
        return this.anchor;
    }
});

Object.defineProperties(Drawing, {
    AbsoluteAnchor: {get: function () { return require('./AbsoluteAnchor'); }},
    Chart: {get: function () { return require('./Chart'); }},
    OneCellAnchor: {get: function () { return require('./OneCellAnchor'); }},
    Picture: {get: function () { return require('./Picture'); }},
    TwoCellAnchor: {get: function () { return require('./TwoCellAnchor'); }}
});

module.exports = Drawing;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./AbsoluteAnchor":7,"./Chart":8,"./OneCellAnchor":9,"./Picture":10,"./TwoCellAnchor":11}],13:[function(require,module,exports){
(function (global){
/**
 * @module Excel/Drawings
 */
"use strict";
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
var util = require('./util');
var RelationshipManager = require('./RelationshipManager');

var Drawings = function () {
    this.drawings = [];
    this.relations = new RelationshipManager();
    this.id = _.uniqueId('Drawings');
};

_.extend(Drawings.prototype, {
    /**
     * Adds a drawing (more likely a subclass of a Drawing) to the 'Drawings' for a particular worksheet.
     *
     * @param {Drawing} drawing
     * @returns {undefined}
     */
    addDrawing: function (drawing) {
        this.drawings.push(drawing);
    },
    getCount: function () {
        return this.drawings.length;
    },
    toXML: function () {
        var doc = util.createXmlDoc(util.schemas.spreadsheetDrawing, 'xdr:wsDr');
        var drawings = doc.documentElement;
        drawings.setAttribute('xmlns:a', util.schemas.drawing);
        drawings.setAttribute('xmlns:r', util.schemas.relationships);
        drawings.setAttribute('xmlns:xdr', util.schemas.spreadsheetDrawing);

        for(var i = 0, l = this.drawings.length; i < l; i++) {

            var rId = this.relations.getRelationshipId(this.drawings[i].getMediaData());
            if(!rId) {
                rId = this.relations.addRelation(this.drawings[i].getMediaData(), this.drawings[i].getMediaType()); //chart
            }
            this.drawings[i].setRelationshipId(rId);
            drawings.appendChild(this.drawings[i].toXML(doc));
        }
        return doc;
    }
});

module.exports = Drawings;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./RelationshipManager":17,"./util":28}],14:[function(require,module,exports){
(function (global){
"use strict";

/**
 * @module Excel/Pane
 *
 * https://msdn.microsoft.com/en-us/library/documentformat.openxml.spreadsheet.pane%28v=office.14%29.aspx
 */
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);

var Pane = function () {

    /*
    Possible Values:
     null
     split	Split
     frozen	Frozen
     frozenSplit	Frozen Split
     http://www.datypic.com/sc/ooxml/t-ssml_ST_PaneState.html
     */
    this.state = null;
    this.xSplit = null;
    this.ySplit = null;
    this.activePane = 'bottomRight';
    this.topLeftCell = null;

};

_.extend(Pane.prototype, {

    freezePane: function(column, row, cell) {
        this._freezePane = {xSplit: column, ySplit: row, cell: cell};
    },

    exportXML: function (doc) {
        var pane = doc.createElement('pane');

        if(this.state !== null) {
            pane.setAttribute('xSplit', this._freezePane.xSplit);
            pane.setAttribute('ySplit', this._freezePane.ySplit);
            pane.setAttribute('topLeftCell', this._freezePane.cell);
            pane.setAttribute('activePane', 'bottomRight');
            pane.setAttribute('state', 'frozen');
        }
        return pane;
    }
});

module.exports = Pane;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],15:[function(require,module,exports){
/**
 * This is mostly a global spot where all of the relationship managers can get and set
 * path information from/to. 
 * @module Excel/Paths
 */
module.exports = {};
},{}],16:[function(require,module,exports){
"use strict";

module.exports = {
    /**
     * Converts pixel sizes to 'EMU's, which is what Open XML uses.
     *
     * @todo clean this up. Code borrowed from http://polymathprogrammer.com/2009/10/22/english-metric-units-and-open-xml/,
     * but not sure that it's going to be as accurate as it needs to be.
     *
     * @param int pixels
     * @returns int
     */
    pixelsToEMUs: function (pixels) {
        return Math.round(pixels * 914400 / 96);
    }
};

},{}],17:[function(require,module,exports){
(function (global){
"use strict";
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
var util = require('./util');
var Paths = require('./Paths');


/**
 * @module Excel/RelationshipManager
 */
var RelationshipManager = function () {
    this.relations = {};
    this.lastId = 1;
};

_.uniqueId('rId'); //priming

_.extend(RelationshipManager.prototype, {

    importData: function (data) {
        this.relations = data.relations;
        this.lastId = data.lastId;
    },
    exportData: function () {
        return {
            relations: this.relations,
            lastId: this.lastId
        };
    },

    addRelation: function (object, type) {
        this.relations[object.id] = {
            id: _.uniqueId('rId'),
            schema: util.schemas[type],
            object: object
        };
        return this.relations[object.id].id;
    },

    getRelationshipId: function (object) {
        return this.relations[object.id] ? this.relations[object.id].id : null;
    },

    toXML: function () {
        var doc = util.createXmlDoc(util.schemas.relationshipPackage, 'Relationships');
        var relationships = doc.documentElement;

        _.each(this.relations, function (data, id) {
            var relationship = util.createElement(doc, 'Relationship', [
                ['Id', data.id],
                ['Type', data.schema],
                ['Target', data.object.target || Paths[id]]
            ]);
            data.object.targetMode && relationship.setAttribute('TargetMode', data.object.targetMode);
            relationships.appendChild(relationship);
        });
        return doc;
    }
});
    
module.exports = RelationshipManager;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./Paths":15,"./util":28}],18:[function(require,module,exports){
(function (global){
"use strict";
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
var util = require('./util');


/**
 * @module Excel/SharedStrings
 */
var sharedStrings = function () {
    this.strings = {};
    this.stringArray = [];
    this.id = _.uniqueId('SharedStrings');
};
_.extend(sharedStrings.prototype, {
    /**
     * Adds a string to the shared string file, and returns the ID of the
     * string which can be used to reference it in worksheets.
     *
     * @param string {String}
     * @return int
     */
    addString: function (string) {
        this.strings[string] = this.stringArray.length;
        this.stringArray[this.stringArray.length] = string;
        return this.strings[string];
    },

    exportData: function () {
        return this.strings;
    },

    toXML: function () {
        var doc = util.createXmlDoc(util.schemas.spreadsheetml, 'sst');
        var sharedStringTable = doc.documentElement;
        this.stringArray.reverse();
        var l = this.stringArray.length;
        sharedStringTable.setAttribute('count', l);
        sharedStringTable.setAttribute('uniqueCount', l);

        var template = doc.createElement('si');
        var templateValue = doc.createElement('t');
        templateValue.appendChild(doc.createTextNode('--placeholder--'));
        template.appendChild(templateValue);
        var strings = this.stringArray;

        while (l--) {
            var clone = template.cloneNode(true);
            clone.firstChild.firstChild.nodeValue = strings[l];
            sharedStringTable.appendChild(clone);
        }

        return doc;
    }
});
module.exports = sharedStrings;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./util":28}],19:[function(require,module,exports){
(function (global,Buffer){
"use strict";

/**
 * @module Excel/SheetProtection
 *
 * https://msdn.microsoft.com/en-us/library/documentformat.openxml.spreadsheet.pane%28v=office.14%29.aspx
 */
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
var util = require('./util');

var SheetProtection = function () {
    this.algorithmName = null;
    this.autoFilter = null;
    this.deleteColumns = null;
    this.deleteRows = null;
    this.formatCells = null;
    this.formatColumns = null;
    this.formatRows = null;
    this.unhashedValue = null;
    this.hashValue = null;
    this.insertColumns = null;
    this.insertHyperlinks = null;
    this.insertRows = null;
    this.objects = null;
    this.pivotTables = null;
    this.saltValue = null;
    this.scenarios = null;
    this.selectLockedCells = null;
    this.selectUnlockedCells = null;
    this.sheet = true; //Otherwise this is a bit pointless, don't you think?
    this.sort = null;
    this.spinCount = null;
};

_.extend(SheetProtection.prototype, {

    exportXML: function (doc) {
        var attrs = {};
        var sheetProtection = doc.createElement('sheetProtection', attrs);

        if(this.sheet === true) {

            if(this.unhashedValue) {
                var forge = require('node-forge');
                var md = forge.md[this.algorithmName].create();
                if(!this.saltValue) {
                    //Bad human! Bad!
                    this.saltValue = Math.random().toString(36).substr(2, 5);
                }
                var spinCount = this.spinCount = this.spinCount || 1000;
                var pass = this.saltValue + '' + this.unhashedValue;

                this.saltValue = new Buffer(this.saltValue).toString('base64')

                while(spinCount--) {
                    md.update(pass);
                    pass=md.digest().toHex();
                }

                this.hashValue = new Buffer(pass).toString('base64');

            }

            util.setAttributesOnDoc(sheetProtection, {
                algorithmName: this.algorithmName,
                autoFilter: {v: this.autoFilter, type: Boolean},
                deleteColumns: {v: this.deleteColumns, type: Boolean},
                deleteRows: {v: this.deleteRows, type: Boolean},
                formatCells: {v: this.formatCells, type: Boolean},
                formatColumns: {v: this.formatColumns, type: Boolean},
                formatRows: {v: this.formatRows, type: Boolean},
                hashValue: this.hashValue,
                insertColumns: {v: this.insertColumns, type: Boolean},
                insertHyperlinks: {v: this.insertHyperlinks, type: Boolean},
                insertRows: {v: this.insertRows, type: Boolean},
                objects: {v: this.objects, type: Boolean},
                pivotTables: {v: this.pivotTables, type: Boolean},
                saltValue: this.saltValue,
                scenarios: {v: this.scenarios, type: Boolean},
                selectLockedCells: {v: this.selectLockedCells, type: Boolean},
                selectUnlockedCells: {v: this.selectUnlockedCells, type: Boolean},
                sheet: {v: this.sheet, type: Boolean},
                spinCount: this.spinCount
            });
        }

        return sheetProtection;
    }
});

SheetProtection.algorithms = {MD5: 'md5', SHA1: 'sha1', SHA256: 'sha256', SHA384: 'sha384', SHA512: 'sha512'};


module.exports = SheetProtection;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {},require("buffer").Buffer)
},{"./util":28,"buffer":1,"node-forge":5}],20:[function(require,module,exports){
(function (global){
/**
 * @module Excel/SheetView
 *
 * https://msdn.microsoft.com/en-us/library/documentformat.openxml.spreadsheet.sheetview%28v=office.14%29.aspx
 *
 */
"use strict";
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
var Pane = require('./Pane');
var util = require('./util')

var SheetView = function (config) {
    config = config || {};

    this.pane = config.pane || new Pane();
    this.showZeros = null; //Default
    this.defaultGridColor = null;
    this.colorId = null;
    this.rightToLeft = null;
    this.showFormulas = null;
    this.showGridLines = null;
    this.showOutlineSymbols = null;
    this.showRowColHeaders = null;
    this.showRuler = null;
    this.showWhiteSpace = null;
    this.tabSelected = null;
    this.topLeftCell = null;
    this.viewType = null; //http://www.datypic.com/sc/ooxml/t-ssml_ST_SheetViewType.html
    this.windowProtection = null;
    this.zoomScale = null;
    this.zoomScaleNormal = null;
    this.zoomScalePageLayoutView = null;
    this.zoomScaleSheetLayoutView = null;
};

_.extend(SheetView.prototype, {

    /**
     * Added froze pane
     * @param column - column number: 0, 1, 2 ...
     * @param row - row number: 0, 1, 2 ...
     * @param cell - 'A1'
     * @deprecated
     */
    freezePane: function(column, row, cell) {
        this.pane.state = 'frozen';
        this.pane.xSplit = column;
        this.pane.ySplit = row;
        this.pane.topLeftCell = cell;
    },

    exportXML: function (doc) {
        var sheetViews = doc.createElement('sheetViews'),
            sheetView = doc.createElement('sheetView');

        util.setAttributesOnDoc(sheetView, {
            //TODO apparent you can add 'book views'.. investigate what these are
            workbookViewId: 0,
            showZeros: {v: this.showZeros, type: Boolean},
            defaultGridColor:  {v: this.defaultGridColor, type: Boolean},
            //TODO: I have no idea what this even is :\
            colorId: this.colorId,
            rightToLeft:  {v: this.rightToLeft, type: Boolean},
            showFormulas:  {v: this.showFormulas, type: Boolean},
            showGridLines:  {v: this.showGridLines, type: Boolean},
            showOutlineSymbols:  {v: this.showOutlineSymbols, type: Boolean},
            showRowColHeaders:  {v: this.showRowColHeaders, type: Boolean},
            showRuler:  {v: this.showRuler, type: Boolean},
            showWhiteSpace:  {v: this.showWhiteSpace, type: Boolean},
            tabSelected:  {v: this.tabSelected, type: Boolean},
            viewType: this.viewType,
            windowProtection:  {v: this.windowProtection, type: Boolean},
            zoomScale:  {v: this.zoomScale, type: Boolean},
            zoomScaleNormal: this.zoomScaleNormal,
            zoomScalePageLayoutView: this.zoomScalePageLayoutView,
            zoomScaleSheetLayoutView: this.zoomScaleSheetLayoutView
        });

        sheetView.appendChild(this.pane.exportXML(doc));

        sheetViews.appendChild(sheetView);
        return sheetViews;
    }
});

module.exports = SheetView;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./Pane":14,"./util":28}],21:[function(require,module,exports){
(function (global){
/**
 * @module Excel/StyleSheet
 */
"use strict";
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
var util = require('./util');

var StyleSheet = function () {
    this.id = _.uniqueId('StyleSheet');
    this.cellStyles = [{
        name:"Normal",
        xfId:"0",
        builtinId:"0"
    }];
    this.defaultTableStyle = false;
    this.differentialStyles = [{}];
    this.masterCellFormats = [{
        numFmtId: 0,
        fontId: 0,
        fillId: 0,
        borderId: 0,
        xfid: 0
    }];
    this.masterCellStyles = [{
        numFmtId: 0,
        fontId: 0,
        fillId: 0,
        borderId: 0
    }];
    this.fonts = [{}];
    this.numberFormatters = [];
    this.fills = [{}, {
        type: 'pattern',
        patternType: 'gray125',
        fgColor: 'FF333333',
        bgColor: 'FF333333'
    }];
    this.borders = [{
        top: {},
        left: {},
        right: {},
        bottom: {},
        diagonal: {}
    }];
    this.tableStyles = [];
};
_.extend(StyleSheet.prototype, {
    createSimpleFormatter: function (type) {
        var sid = this.masterCellFormats.length;
        var style = {
            id: sid
        };
        switch(type) {
            case 'date':
                style.numFmtId = 14;
                break;
        }
        this.masterCellFormats.push(style);
        return style;
    },

    createFill: function (fillInstructions) {
        var id = this.fills.length;
        var fill = fillInstructions;
        fill.id = id;
        this.fills.push(fill);
        return fill;
    },

    createNumberFormatter: function (formatInstructions) {
        var id = this.numberFormatters.length + 100;
        var format = {
            id: id,
            formatCode: formatInstructions
        };
        this.numberFormatters.push(format);
        return format;
    },

    /**
    * alignment: {
    *  horizontal: http://www.schemacentral.com/sc/ooxml/t-ssml_ST_HorizontalAlignment.html
    *  vertical: http://www.schemacentral.com/sc/ooxml/t-ssml_ST_VerticalAlignment.html
    *  @param {Object} styleInstructions
    */
    createFormat: function (styleInstructions) {
        var sid = this.masterCellFormats.length;
        var style = {
            id: sid
        };
        if (styleInstructions.protection) {
            style.protection = styleInstructions.protection;
        }
        if(styleInstructions.font && _.isObject(styleInstructions.font)) {
            style.fontId = this.createFontStyle(styleInstructions.font).id;
        } else if(styleInstructions.font) {
            if(_.isNaN(parseInt(styleInstructions.font, 10))) {
                throw "Passing a non-numeric font id is not supported";
            }
            style.fontId = styleInstructions.font;
        }

        if (styleInstructions.format && _.isString(styleInstructions.format)) {
            style.numFmtId = this.createNumberFormatter(styleInstructions.format).id;
        } else if(styleInstructions.format) {
            if(_.isNaN(parseInt(styleInstructions.format, 10))) {
                throw "Invalid number formatter id";
            }
            style.numFmtId = styleInstructions.format;
        }

        if (styleInstructions.border && _.isObject(styleInstructions.border)) {
            style.borderId = this.createBorderFormatter(styleInstructions.border).id;
        } else if (styleInstructions.border) {
            if(_.isNaN(parseInt(styleInstructions.border, 10))) {
                throw "Passing a non-numeric border id is not supported";
            }
            style.borderId = styleInstructions.border;
        }

        if (styleInstructions.fill && _.isObject(styleInstructions.fill)) {
            style.fillId = this.createFill(styleInstructions.fill).id;
        } else if (styleInstructions.fill) {
            if(_.isNaN(parseInt(styleInstructions.fill, 10))) {
                throw "Passing a non-numeric fill id is not supported";
            }
            style.fillId = styleInstructions.fill;
        }

        if (styleInstructions.alignment && _.isObject(styleInstructions.alignment)) {
            style.alignment = _.pick(
                styleInstructions.alignment,
                'horizontal',
                'justifyLastLine',
                'readingOrder',
                'relativeIndent',
                'shrinkToFit',
                'textRotation',
                'vertical',
                'wrapText'
                );
        }

        this.masterCellFormats.push(style);
        return style;
    },

    createDifferentialStyle: function (styleInstructions) {
        var id = this.differentialStyles.length;
        var style = {
            id: id
        };
        if(styleInstructions.font && _.isObject(styleInstructions.font)) {
            style.font = styleInstructions.font;
        }
        if (styleInstructions.border && _.isObject(styleInstructions.border)) {
            style.border = _.defaults(styleInstructions.border, {
                top: {},
                left: {},
                right: {},
                bottom: {},
                diagonal: {}
    });
        }
        if (styleInstructions.fill && _.isObject(styleInstructions.fill)) {
            style.fill = styleInstructions.fill;
        }
        if (styleInstructions.alignment && _.isObject(styleInstructions.alignment)) {
            style.alignment = styleInstructions.alignment;
        }
        if (styleInstructions.format && _.isString(styleInstructions.format)) {
            style.numFmt = styleInstructions.format;
        }
        this.differentialStyles[id] = style;
        return style;
    },

    /**
     * Should be an object containing keys that match with one of the keys from this list:
     * http://www.schemacentral.com/sc/ooxml/t-ssml_ST_TableStyleType.html
     *
     * The value should be a reference to a differential format (dxf)
     * @param {Object} instructions
     */
    createTableStyle: function (instructions) {
        this.tableStyles.push(instructions);
    },

    /**
    * All params optional
    * Expects: {
    * top: {},
    * left: {},
    * right: {},
    * bottom: {},
    * diagonal: {},
    * outline: boolean,
    * diagonalUp: boolean,
    * diagonalDown: boolean
    * }
    * Each border should follow:
    * {
    * style: styleString, http://www.schemacentral.com/sc/ooxml/t-ssml_ST_BorderStyle.html
    * color: ARBG color (requires the A, so for example FF006666)
    * }
    * @param {Object} border
    */
    createBorderFormatter: function (border) {
        _.defaults(border, {
            top: {},
            left: {},
            right: {},
            bottom: {},
            diagonal: {},
            id: this.borders.length
        });
        this.borders.push(border);
        return border;
    },

    /**
    * Supported font styles:
    * bold
    * italic
    * underline (single, double, singleAccounting, doubleAccounting)
    * size
    * color
    * fontName
    * strike (strikethrough)
    * outline (does this actually do anything?)
    * shadow (does this actually do anything?)
    * superscript
    * subscript
    *
    * Color is a future goal - at the moment it's looking a bit complicated
    * @param {Object} instructions
    */
    createFontStyle: function (instructions) {
        var fontId = this.fonts.length;
        var fontStyle = {
            id: fontId
        };
        if(instructions.bold) {
            fontStyle.bold = true;
        }
        if(instructions.italic) {
            fontStyle.italic = true;
        }
        if(instructions.superscript) {
            fontStyle.vertAlign = 'superscript';
        }
        if(instructions.subscript) {
            fontStyle.vertAlign = 'subscript';
        }
        if(instructions.underline) {
            if(_.indexOf([
                'double',
                'singleAccounting',
                'doubleAccounting'
                ], instructions.underline) !== -1) {
                fontStyle.underline = instructions.underline;
            } else {
                fontStyle.underline = true;
            }
        }
        if(instructions.strike) {
            fontStyle.strike = true;
        }
        if(instructions.outline) {
            fontStyle.outline = true;
        }
        if(instructions.shadow) {
            fontStyle.shadow = true;
        }
        if(instructions.size) {
            fontStyle.size = instructions.size;
        }
        if(instructions.color) {
            fontStyle.color = instructions.color;
        }
        if(instructions.fontName) {
            fontStyle.fontName = instructions.fontName;
        }
        this.fonts.push(fontStyle);
        return fontStyle;
    },

    exportBorders: function (doc) {
        var borders = doc.createElement('borders');
        borders.setAttribute('count', this.borders.length);

        for(var i = 0, l = this.borders.length; i < l; i++) {
            borders.appendChild(this.exportBorder(doc, this.borders[i]));
        }
        return borders;
    },

    exportBorder: function (doc, data) {
        var border = doc.createElement('border');
        var self = this;
        var borderGenerator = function (name) {
            var b = doc.createElement(name);
            if(data[name].style) {
                b.setAttribute('style', data[name].style);
            }
            if(data[name].color) {
                b.appendChild(self.exportColor(doc, data[name].color));
            }
            return b;
        };
        border.appendChild(borderGenerator('left'));
        border.appendChild(borderGenerator('right'));
        border.appendChild(borderGenerator('top'));
        border.appendChild(borderGenerator('bottom'));
        border.appendChild(borderGenerator('diagonal'));
        return border;
    },

    exportColor: function (doc, color) {
        var colorEl = doc.createElement('color');
        if(_.isString(color)) {
            colorEl.setAttribute('rgb', color);
            return colorEl;
        }

        if (!_.isUndefined(color.tint)) {
            colorEl.setAttribute('tint', color.tint);
        }
        if (!_.isUndefined(color.auto)) {
            colorEl.setAttribute('auto', !!color.auto);
        }
        if (!_.isUndefined(color.theme)) {
            colorEl.setAttribute('theme', color.theme);
        }

        return colorEl;
    },

    exportMasterCellFormats: function (doc) {
        var cellFormats = util.createElement(doc, 'cellXfs', [
            ['count', this.masterCellFormats.length]
            ]);
        for(var i = 0, l = this.masterCellFormats.length; i < l; i++) {
            var mformat = this.masterCellFormats[i];
            cellFormats.appendChild(this.exportCellFormatElement(doc, mformat));
        }
        return cellFormats;
    },

    exportMasterCellStyles: function (doc) {
        var records = util.createElement(doc, 'cellStyleXfs', [
            ['count', this.masterCellStyles.length]
            ]);
        for(var i = 0, l = this.masterCellStyles.length; i < l; i++) {
            var mstyle = this.masterCellStyles[i];
            records.appendChild(this.exportCellFormatElement(doc, mstyle));
        }
        return records;
    },

    exportCellFormatElement: function (doc, styleInstructions) {
        var xf = doc.createElement('xf');
        var allowed = ['applyAlignment', 'applyBorder', 'applyFill', 'applyFont', 'applyNumberFormat',
        'applyProtection', 'borderId', 'fillId', 'fontId', 'numFmtId', 'pivotButton', 'quotePrefix', 'xfId'];
        var attributes = _.filter(_.keys(styleInstructions), function (key) {
            if(_.indexOf(allowed, key) !== -1) {
                return true;
            }
        });
        if(styleInstructions.alignment) {
            var alignmentData = styleInstructions.alignment;
            xf.appendChild(this.exportAlignment(doc, alignmentData));
        }
        if (styleInstructions.protection) {
            xf.appendChild(this.exportProtection(doc, styleInstructions.protection));
            xf.setAttribute('applyProtection', '1');
        }
        var a = attributes.length;
        while(a--) {
            xf.setAttribute(attributes[a], styleInstructions[attributes[a]]);
        }
        if (styleInstructions.fillId) {
            xf.setAttribute('applyFill', '1');
        }
        if (styleInstructions.fontId) {
            xf.setAttribute('applyFont', '1');
        }
        if (styleInstructions.borderId) {
            xf.setAttribute('applyBorder', '1');
        }
        if (styleInstructions.alignment) {
            xf.setAttribute('applyAlignment', '1');
        }
        if (styleInstructions.numFmtId) {
            xf.setAttribute('applyNumberFormat', '1');
        }
        if((styleInstructions.numFmtId !== undefined) && (styleInstructions.xfId === undefined)) {
            xf.setAttribute('xfId', '0');
        }
        return xf;
    },

    exportAlignment: function (doc, alignmentData) {
        var alignment = doc.createElement('alignment');
        var keys = _.keys(alignmentData);
        for(var i = 0, l = keys.length; i < l; i++) {
            alignment.setAttribute(keys[i], alignmentData[keys[i]]);
        }
        return alignment;
    },

    exportFonts: function (doc) {
        var fonts = doc.createElement('fonts');
        fonts.setAttribute('count', this.fonts.length);
        for(var i = 0, l = this.fonts.length; i < l; i++) {
            var fd = this.fonts[i];
            fonts.appendChild(this.exportFont(doc, fd));
        }
        return fonts;
    },

    exportFont: function (doc, fd) {
        var font = doc.createElement('font');
        if(fd.size) {
            var size = doc.createElement('sz');
            size.setAttribute('val', fd.size);
            font.appendChild(size);
        }

        if(fd.fontName) {
            var fontName = doc.createElement('name');
            fontName.setAttribute('val', fd.fontName);
            font.appendChild(fontName);
        }

        if(fd.bold) {
            font.appendChild(doc.createElement('b'));
        }
        if(fd.italic) {
            font.appendChild(doc.createElement('i'));
        }
        if(fd.vertAlign) {
            var vertAlign = doc.createElement('vertAlign');
            vertAlign.setAttribute('val', fd.vertAlign);
            font.appendChild(vertAlign);
        }
        if(fd.underline) {
            var u = doc.createElement('u');
            if(fd.underline !== true) {
                u.setAttribute('val', fd.underline);
            }
            font.appendChild(u);
        }
        if(fd.strike) {
            font.appendChild(doc.createElement('strike'));
        }
        if(fd.shadow) {
            font.appendChild(doc.createElement('shadow'));
        }
        if(fd.outline) {
            font.appendChild(doc.createElement('outline'));
        }
        if(fd.color) {
            font.appendChild(this.exportColor(doc, fd.color));
        }
        return font;
    },

    exportFills: function (doc) {
        var fills = doc.createElement('fills');
        fills.setAttribute('count', this.fills.length);
        for(var i = 0, l = this.fills.length; i < l; i++) {
            var fd = this.fills[i];
            fills.appendChild(this.exportFill(doc, fd));
        }
        return fills;
    },

    exportFill: function (doc, fd) {
        var fillDef;
        var fill = doc.createElement('fill');
        if (fd.type === 'pattern') {
            fillDef = this.exportPatternFill(doc, fd);
            fill.appendChild(fillDef);
        } else if (fd.type === 'gradient') {
            fillDef = this.exportGradientFill(doc, fd);
            fill.appendChild(fillDef);
        }
        return fill;
    },

    exportGradientFill: function (doc, data) {
        var fillDef = doc.createElement('gradientFill');
        if(data.degree) {
            fillDef.setAttribute('degree', data.degree);
        } else if (data.left) {
            fillDef.setAttribute('left', data.left);
            fillDef.setAttribute('right', data.right);
            fillDef.setAttribute('top', data.top);
            fillDef.setAttribute('bottom', data.bottom);
        }
        var start = doc.createElement('stop');
        start.setAttribute('position', data.start.pureAt || 0);
        var startColor = doc.createElement('color');
        if (typeof data.start === 'string' || data.start.color) {
            startColor.setAttribute('rgb', data.start.color || data.start);
        } else if (typeof data.start.theme) {
            startColor.setAttribute('theme', data.start.theme);
        }

        var end = doc.createElement('stop');
        var endColor = doc.createElement('color');
        end.setAttribute('position', data.end.pureAt || 1);
        if (typeof data.start === 'string' || data.end.color) {
            endColor.setAttribute('rgb', data.end.color || data.end);
        } else if (typeof data.end.theme) {
            endColor.setAttribute('theme', data.end.theme);
        }
        start.appendChild(startColor);
        end.appendChild(endColor);
        fillDef.appendChild(start);
        fillDef.appendChild(end);
        return fillDef;
    },

    /**
    * Pattern types: http://www.schemacentral.com/sc/ooxml/t-ssml_ST_PatternType.html
    * @param {XMLDoc} doc
    * @param {Object} data
    */
    exportPatternFill: function (doc, data) {
        var fillDef = util.createElement(doc, 'patternFill', [
            ['patternType', data.patternType]
            ]);
        if(!data.bgColor) {
            data.bgColor = 'FFFFFFFF';
        }
        if(!data.fgColor) {
            data.fgColor = 'FFFFFFFF';
        }

        var bgColor = doc.createElement('bgColor');
        if(_.isString(data.bgColor)) {
            bgColor.setAttribute('rgb', data.bgColor);
        } else {
            if(data.bgColor.theme) {
                bgColor.setAttribute('theme', data.bgColor.theme);
            } else {
                bgColor.setAttribute('rgb', data.bgColor.rbg);
            }
        }

        var fgColor = doc.createElement('fgColor');
        if(_.isString(data.fgColor)) {
            fgColor.setAttribute('rgb', data.fgColor);
        } else {
            if(data.fgColor.theme) {
                fgColor.setAttribute('theme', data.fgColor.theme);
            } else {
                fgColor.setAttribute('rgb', data.fgColor.rbg);
            }
        }
        fillDef.appendChild(fgColor);
        fillDef.appendChild(bgColor);
        return fillDef;
    },

    exportNumberFormatters: function (doc) {
        var formatters = doc.createElement('numFmts');
        formatters.setAttribute('count', this.numberFormatters.length);
        for(var i = 0, l = this.numberFormatters.length; i < l; i++) {
            var fd = this.numberFormatters[i];
            formatters.appendChild(this.exportNumberFormatter(doc, fd));
        }
        return formatters;
    },

    exportNumberFormatter: function (doc, fd) {
        var numFmt = doc.createElement('numFmt');
        numFmt.setAttribute('numFmtId', fd.id);
        numFmt.setAttribute('formatCode', fd.formatCode);
        return numFmt;
    },

    exportCellStyles: function (doc) {
        var cellStyles = doc.createElement('cellStyles');
        cellStyles.setAttribute('count', this.cellStyles.length);

        for(var i = 0, l = this.cellStyles.length; i < l; i++) {
            var style = this.cellStyles[i];
            delete style.id; //Remove internal id
            var record = util.createElement(doc, 'cellStyle');
            cellStyles.appendChild(record);
            var attributes = _.keys(style);
            var a = attributes.length;
            while(a--) {
                record.setAttribute(attributes[a], style[attributes[a]]);
            }
        }

        return cellStyles;
    },

    exportDifferentialStyles: function (doc) {
        var dxfs = doc.createElement('dxfs');
        dxfs.setAttribute('count', this.differentialStyles.length);

        for(var i = 0, l = this.differentialStyles.length; i < l; i++) {
            var style = this.differentialStyles[i];
            dxfs.appendChild(this.exportDFX(doc, style));
        }

        return dxfs;
    },

    exportDFX: function (doc, style) {
        var dxf = doc.createElement('dxf');
        if(style.font) {
            dxf.appendChild(this.exportFont(doc, style.font));
        }
        if(style.fill) {
            dxf.appendChild(this.exportFill(doc, style.fill));
        }
    if(style.border) {
            dxf.appendChild(this.exportBorder(doc, style.border));
        }
        if(style.numFmt) {
            dxf.appendChild(this.exportNumberFormatter(doc, style.numFmt));
        }
        if(style.alignment) {
            dxf.appendChild(this.exportAlignment(doc, style.alignment));
        }
        return dxf;
    },

    exportTableStyles: function (doc) {
        var tableStyles = doc.createElement('tableStyles');
        tableStyles.setAttribute('count', this.tableStyles.length);
        if(this.defaultTableStyle) {
            tableStyles.setAttribute('defaultTableStyle', this.defaultTableStyle);
        }
        for(var i = 0, l = this.tableStyles.length; i < l; i++) {
            tableStyles.appendChild(this.exportTableStyle(doc, this.tableStyles[i]));
        }
        return tableStyles;
    },

    exportTableStyle: function (doc, style) {
        var tableStyle = doc.createElement('tableStyle');
        tableStyle.setAttribute('name', style.name);
        tableStyle.setAttribute('pivot', 0);
        var i = 0;

        _.each(style, function (value, key) {
            if(key === 'name') {return;}
            i++;
            var styleEl = doc.createElement('tableStyleElement');
            styleEl.setAttribute('type', key);
            styleEl.setAttribute('dxfId', value);
            tableStyle.appendChild(styleEl);
        });
        tableStyle.setAttribute('count', i);
        return tableStyle;
    },

    exportProtection: function (doc, protectionData) {
        var node = doc.createElement('protection');
        for (var k in protectionData) {
            if(protectionData.hasOwnProperty(k)) {
                node.setAttribute(k, protectionData[k]);
            }
        }
        return node;
    },

    toXML: function () {
        var doc = util.createXmlDoc(util.schemas.spreadsheetml, 'styleSheet');
        var styleSheet = doc.documentElement;
        styleSheet.appendChild(this.exportNumberFormatters(doc));
        styleSheet.appendChild(this.exportFonts(doc));
        styleSheet.appendChild(this.exportFills(doc));
        styleSheet.appendChild(this.exportBorders(doc));
        styleSheet.appendChild(this.exportMasterCellStyles(doc));
        styleSheet.appendChild(this.exportMasterCellFormats(doc));
        styleSheet.appendChild(this.exportCellStyles(doc));
        styleSheet.appendChild(this.exportDifferentialStyles(doc));
        if(this.tableStyles.length) {
            styleSheet.appendChild(this.exportTableStyles(doc));
        }
        return doc;
    }
});
module.exports = StyleSheet;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./util":28}],22:[function(require,module,exports){
(function (global){
"use strict";
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
var util = require('./util');

/**
 * @module Excel/Table
 */

var Table = function (config) {
    _.defaults(this, {
        name: "",
        displayName: "",
        dataCellStyle: null,
        dataDfxId: null,
        headerRowBorderDxfId: null,
        headerRowCellStyle: null,
        headerRowCount: 1,
        headerRowDxfId: null,
        insertRow: false,
        insertRowShift: false,
        ref: null,
        tableBorderDxfId: null,
        totalsRowBorderDxfId: null,
        totalsRowCellStyle: null,
        totalsRowCount: 0,
        totalsRowDxfId: null,
        tableColumns: [],
        autoFilter: null,
        sortState: null,
        styleInfo: {}
    });
    this.initialize(config);
};
_.extend(Table.prototype, {

    initialize: function (config) {
        this.displayName = _.uniqueId("Table");
        this.name = this.displayName;
        this.id = this.name;
        this.tableId = this.id.replace('Table', '');
        _.extend(this, config);
    },

    setReferenceRange: function (start, end) {
        this.ref = [start, end];
    },

    setTableColumns: function (columns) {
        _.each(columns, function (column) {
            this.addTableColumn(column);
        }, this);
    },

    /**
    * Expects an object with the following optional properties:
    * name (required)
    * dataCellStyle
    * dataDxfId
    * headerRowCellStyle
    * headerRowDxfId
    * totalsRowCellStyle
    * totalsRowDxfId
    * totalsRowFunction
    * totalsRowLabel
    * columnFormula
    * columnFormulaIsArrayType (boolean)
    * totalFormula
    * totalFormulaIsArrayType (boolean)
    */
    addTableColumn: function (column) {
        if(_.isString(column)) {
            column = {
                name: column
            };
        }
        if(!column.name) {
            throw "Invalid argument for addTableColumn - minimum requirement is a name property";
        }
        this.tableColumns.push(column);
    },

    /**
    * Expects an object with the following properties:
    * caseSensitive (boolean)
    * dataRange
    * columnSort (assumes true)
    * sortDirection
    * sortRange (defaults to dataRange)
    */
    setSortState: function (state) {
        this.sortState = state;
    },

    toXML: function () {
        var doc = util.createXmlDoc(util.schemas.spreadsheetml, 'table');
        var table = doc.documentElement;
        table.setAttribute('id', this.tableId);
        table.setAttribute('name', this.name);
        table.setAttribute('displayName', this.displayName);
        var s = this.ref[0];
        var e = this.ref[1];
        table.setAttribute('ref', util.positionToLetterRef(s[0], s[1]) + ":" + util.positionToLetterRef(e[0], e[1]));

        /** TOTALS **/
        table.setAttribute('totalsRowCount', this.totalsRowCount);

        /** HEADER **/
        table.setAttribute('headerRowCount', this.headerRowCount);
        if(this.headerRowDxfId) {
            table.setAttribute('headerRowDxfId', this.headerRowDxfId);
        }
        if(this.headerRowBorderDxfId) {
            table.setAttribute('headerRowBorderDxfId', this.headerRowBorderDxfId);
        }

        if(!this.ref) {
            throw "Needs at least a reference range";
        }
        if(!this.autoFilter) {
            this.addAutoFilter(this.ref[0], this.ref[1]);
        }

        table.appendChild(this.exportAutoFilter(doc));

        table.appendChild(this.exportTableColumns(doc));
        table.appendChild(this.exportTableStyleInfo(doc));
        return doc;
    },

    exportTableColumns: function (doc) {
        var tableColumns = doc.createElement('tableColumns');
        tableColumns.setAttribute('count', this.tableColumns.length);
        var tcs = this.tableColumns;
        for(var i = 0, l = tcs.length; i < l; i++) {
            var tc = tcs[i];
            var tableColumn = doc.createElement('tableColumn');
            tableColumn.setAttribute('id', i + 1);
            tableColumn.setAttribute('name', tc.name);
            tableColumns.appendChild(tableColumn);

            if(tc.totalsRowFunction) {
                tableColumn.setAttribute('totalsRowFunction', tc.totalsRowFunction);
            }
            if(tc.totalsRowLabel) {
                tableColumn.setAttribute('totalsRowLabel', tc.totalsRowLabel);
            }
        }
        return tableColumns;
    },

    exportAutoFilter: function (doc) {
        var autoFilter = doc.createElement('autoFilter');
        var s = this.autoFilter[0];
        var e = this.autoFilter[1];
        autoFilter.setAttribute('ref', util.positionToLetterRef(s[0], s[1]) + ":" + util.positionToLetterRef(e[0], e[1]  - this.totalsRowCount));
        return autoFilter;
    },

    exportTableStyleInfo: function (doc) {
        var ts = this.styleInfo;
        var tableStyle = doc.createElement('tableStyleInfo');
        tableStyle.setAttribute('name', ts.themeStyle);
        tableStyle.setAttribute('showFirstColumn', ts.showFirstColumn ? "1" : "0");
        tableStyle.setAttribute('showLastColumn', ts.showLastColumn ? "1" : "0");
        tableStyle.setAttribute('showColumnStripes', ts.showColumnStripes ? "1" : "0");
        tableStyle.setAttribute('showRowStripes', ts.showRowStripes ? "1" : "0");
        return tableStyle;
    },

    addAutoFilter: function (startRef, endRef) {
        this.autoFilter = [startRef, endRef];
    }
});
module.exports = Table;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./util":28}],23:[function(require,module,exports){
(function (global){
"use strict";
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
var util = require('./util');
var StyleSheet = require('./StyleSheet');
var Worksheet = require('./Worksheet');
var SharedStrings = require('./SharedStrings');
var RelationshipManager = require('./RelationshipManager');
var Paths = require('./Paths');
var XMLDOM = require('./XMLDOM');
var work = require('webworkify');

/**
 * @module Excel/Workbook
 */
/* globals console: true */

var Workbook = function (config) {
    this.worksheets = [];
    this.tables = [];
    this.drawings = [];
    this.media = {};
    this.initialize(config);
};
_.extend(Workbook.prototype, {

    initialize: function () {
        this.id = _.uniqueId('Workbook');
        this.styleSheet = new StyleSheet();
        this.sharedStrings = new SharedStrings();
        this.relations = new RelationshipManager();
        this.relations.addRelation(this.styleSheet, 'stylesheet');
        this.relations.addRelation(this.sharedStrings, 'sharedStrings');
    },

    createWorksheet: function (config) {
        config = config || {};
        _.defaults(config, {
            name: 'Sheet '.concat(this.worksheets.length + 1)
        });
        return new Worksheet(config);
    },

    getStyleSheet: function () {
        return this.styleSheet;
    },

    addTable: function (table) {
        this.tables.push(table);
    },

    addDrawings: function (drawings) {
        this.drawings.push(drawings);
    },

    addMedia: function (type, fileName, fileData, contentType) {
        var fileNamePieces = fileName.split('.');
        var extension = fileNamePieces[fileNamePieces.length - 1];
        if(!contentType) {
            switch(extension.toLowerCase()) {
                case 'jpeg':
                case 'jpg':
                    contentType = "image/jpeg";
                    break;
                case 'png':
                    contentType = "image/png";
                    break;
                case 'gif':
                    contentType = "image/gif";
                    break;
                default:
                    contentType = null;
                    break;
            }
        }
        if(!this.media[fileName]) {
            this.media[fileName] = {
                id: fileName,
                data: fileData,
                fileName: fileName,
                contentType: contentType,
                extension: extension
            };
        }
        return this.media[fileName];
    },

    addWorksheet: function (worksheet) {
        this.relations.addRelation(worksheet, 'worksheet');
        worksheet.setSharedStringCollection(this.sharedStrings);
        this.worksheets.push(worksheet);
    },

    createContentTypes: function () {
        var doc = util.createXmlDoc(util.schemas.contentTypes, 'Types');
        var types = doc.documentElement;
        var i, l;

        types.appendChild(util.createElement(doc, 'Default', [
            ['Extension', "rels"],
            ['ContentType', "application/vnd.openxmlformats-package.relationships+xml"]
        ]));
        types.appendChild(util.createElement(doc, 'Default', [
            ['Extension', "xml"],
            ['ContentType', "application/xml"]
        ]));

        var extensions = {};
        for(var filename in this.media) {
            if(this.media.hasOwnProperty(filename)) {
                extensions[this.media[filename].extension] = this.media[filename].contentType;
            }
        }
        for(var extension in extensions) {
            if(extensions.hasOwnProperty(extension)) {
                types.appendChild(util.createElement(doc, 'Default', [
                    ['Extension', extension],
                    ['ContentType', extensions[extension]]
                ]));
            }
        }

        types.appendChild(util.createElement(doc, 'Override', [
            ['PartName', "/xl/workbook.xml"],
            ['ContentType', "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"]
        ]));
        types.appendChild(util.createElement(doc, 'Override', [
            ['PartName', "/xl/sharedStrings.xml"],
            ['ContentType', "application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"]
        ]));
        types.appendChild(util.createElement(doc, 'Override', [
            ['PartName', "/xl/styles.xml"],
            ['ContentType', "application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"]
        ]));

        for(i = 0, l = this.worksheets.length; i < l; i++) {
            types.appendChild(util.createElement(doc, 'Override', [
                ['PartName', "/xl/worksheets/sheet" + (i + 1) + ".xml"],
                ['ContentType', "application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"]
            ]));
        }
        for(i = 0, l = this.tables.length; i < l; i++) {
            types.appendChild(util.createElement(doc, 'Override', [
                ['PartName', "/xl/tables/table" + (i + 1) + ".xml"],
                ['ContentType', "application/vnd.openxmlformats-officedocument.spreadsheetml.table+xml"]
            ]));
        }

        for(i = 0, l = this.drawings.length; i < l; i++) {
            types.appendChild(util.createElement(doc, 'Override', [
                ['PartName', '/xl/drawings/drawing' + (i + 1) + '.xml'],
                ['ContentType', 'application/vnd.openxmlformats-officedocument.drawing+xml']
            ]));
        }

        return doc;
    },

    toXML: function () {
        var doc = util.createXmlDoc(util.schemas.spreadsheetml, 'workbook');
        var wb = doc.documentElement;
        wb.setAttribute('xmlns:r', util.schemas.relationships);

        var maxWorksheetNameLength = 31;
        var sheets = util.createElement(doc, 'sheets');
        for(var i = 0, l = this.worksheets.length; i < l; i++) {
            var sheet = doc.createElement('sheet');
            // Microsoft Excel (2007, 2013) do not allow worksheet names longer than 31 characters
            // if the worksheet name is longer, Excel displays an "Excel found unreadable content..." popup when opening the file
            if(typeof console !== "undefined" && this.worksheets[i].name.length > maxWorksheetNameLength) {
                console.log('Microsoft Excel requires work sheet names to be less than ' + (maxWorksheetNameLength+1) +
                        ' characters long, work sheet name "' + this.worksheets[i].name +
                        '" is ' + this.worksheets[i].name.length + ' characters long');
            }
            sheet.setAttribute('name', this.worksheets[i].name);
            sheet.setAttribute('sheetId', i + 1);
            sheet.setAttribute('r:id', this.relations.getRelationshipId(this.worksheets[i]));
            sheets.appendChild(sheet);
        }
        wb.appendChild(sheets);
        return doc;
    },

    createWorkbookRelationship: function () {
        var doc = util.createXmlDoc(util.schemas.relationshipPackage, 'Relationships');
        var relationships = doc.documentElement;
        relationships.appendChild(util.createElement(doc, 'Relationship', [
            ['Id', 'rId1'],
            ['Type', util.schemas.officeDocument],
            ['Target', 'xl/workbook.xml']
            ]));
        return doc;
    },

    _generateCorePaths: function (files) {
        var i, l;
        Paths[this.styleSheet.id] = 'styles.xml';
        Paths[this.sharedStrings.id] = 'sharedStrings.xml';
        Paths[this.id] = '/xl/workbook.xml';

        for(i = 0, l = this.tables.length; i < l; i++) {
            files['/xl/tables/table' + (i + 1) + '.xml'] = this.tables[i].toXML();
            Paths[this.tables[i].id] = '/xl/tables/table' + (i + 1) + '.xml';
        }

        for(var fileName in this.media) {
            if(this.media.hasOwnProperty(fileName)) {
                var media = this.media[fileName];
                files['/xl/media/' + fileName] = media.data;
                Paths[fileName] = '/xl/media/' + fileName;
            }
        }

        for(i = 0, l = this.drawings.length; i < l; i++) {
            files['/xl/drawings/drawing' + (i + 1) + '.xml'] = this.drawings[i].toXML();
            Paths[this.drawings[i].id] = '/xl/drawings/drawing' + (i + 1) + '.xml';
            files['/xl/drawings/_rels/drawing' + (i + 1) + '.xml.rels'] = this.drawings[i].relations.toXML();
        }


    },

    _prepareFilesForPackaging: function (files) {

        _.extend(files, {
            '/[Content_Types].xml': this.createContentTypes(),
            '/_rels/.rels': this.createWorkbookRelationship(),
            '/xl/styles.xml': this.styleSheet.toXML(),
            '/xl/workbook.xml': this.toXML(),
            '/xl/sharedStrings.xml': this.sharedStrings.toXML(),
            '/xl/_rels/workbook.xml.rels': this.relations.toXML()
        });

        _.each(files, function (value, key) {
            if(key.indexOf('.xml') !== -1 || key.indexOf('.rels') !== -1) {
                if (value instanceof XMLDOM){
                    files[key] = value.toString();
                } else {
                    files[key] = value.xml || new window.XMLSerializer().serializeToString(value);
                }
                var content = files[key].replace(/xmlns=""/g, '');
                content = content.replace(/NS[\d]+:/g, '');
                content = content.replace(/xmlns:NS[\d]+=""/g, '');
                files[key] = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' + "\n" + content;
            }
        });
    },
    generateFilesAsync: function (options) {
        var self = this;
        var files = {},
            doneCount = this.worksheets.length,
            stringsCollectedCount = this.worksheets.length,
            workingIndex = 0,
            workers = [];

        var result = {
            status: "Not Started",
            terminate: function () {
                for(var i = 0; i < workers.length; i++) {
                    workers[i].terminate();
                }
            }
        };
        this._generateCorePaths(files);

        var done = function (workerIndex) {
            if(--doneCount === 0) {
                self._prepareFilesForPackaging(files);
                for(var i = 0; i < workers.length; i++) {
                    workers[i].terminate();
                }
                options.success(files);
            }
            else{
                //Post next export
                if( self.worksheets.length > 8 && workingIndex < self.worksheets.length ){
                  var i = workingIndex;
                  ++workingIndex;
                  workers[workerIndex].postMessage({
                      instruction: 'export',
                      sharedStrings: self.sharedStrings.exportData(),
                      worksheetIndex: i,
                      data: self.worksheets[i].exportData()
                  });
                }
            }
        };
        var stringsCollected = function (workerIndex) {
            if(--stringsCollectedCount === 0) {
                //Start post export
                workingIndex = workers.length;
                for(var i = 0; i < workers.length; i++) {
                    workers[i].postMessage({
                        instruction: 'export',
                        sharedStrings: self.sharedStrings.exportData(),
                        worksheetIndex: i,
                        data: self.worksheets[i].exportData()
                    });
                }
            }
            else{
                //Post next start
                if( self.worksheets.length > 8 && workingIndex < self.worksheets.length ){
                  var i = workingIndex;
                  ++workingIndex;
                  workers[workerIndex].postMessage({
                      instruction: 'start',
                      data: self.worksheets[i].exportData()
                  });
                }
            }
        };

        var worksheetWorker = {
            error: function () {
                for(var i = 0; i < workers.length; i++) {
                    workers[i].terminate();
                }
                //message, filename, lineno
                options.error.apply(this, arguments);
            },
            stringsCollected: function (workerIndex) {
                stringsCollected(workerIndex);
            },
            finished: function (workerIndex, worksheetIndex, data) {
                files['/xl/worksheets/sheet' + (worksheetIndex + 1) + '.xml'] = {xml: data};
                Paths[self.worksheets[worksheetIndex].id] = 'worksheets/sheet' + (worksheetIndex + 1) + '.xml';
                files['/xl/worksheets/_rels/sheet' + (worksheetIndex + 1) + '.xml.rels'] = self.worksheets[worksheetIndex].relations.toXML();
                done(workerIndex);
            }
        };

        var workerCount = Math.min( this.worksheets.length, 8);
        for(var i = 0; i < workerCount; i++) {
            workers.push(
                this._createWorker(i, worksheetWorker )
            );
        }
        for(var i = 0; i < workers.length; ++i) {
            ++workingIndex;
            workers[i].postMessage({
                instruction: 'start',
                data: self.worksheets[i].exportData()
            });
        }

        return result;
    },
    _createWorker: function (index, callbacks){
      var self = this;
      var w = work(require('./WorksheetExportWorker.js'));
      w.index = index;
      w.addEventListener('error', callbacks.error);
      w.addEventListener('message', function (event) {
          switch(event.data.status) {
              case "sharedStrings":
                  for(var i = 0; i < event.data.data.length; i++) {
                      self.sharedStrings.addString(event.data.data[i]);
                  }
                  callbacks.stringsCollected(this.index);
                  break;
              case "finished":
                  callbacks.finished(this.index, event.data.worksheetIndex, event.data.data);
                  break;
          }
      }, false);
      return w;
    },
    generateFiles: function () {
        var files = {};
        this._generateCorePaths(files);

        for(var i = 0, l = this.worksheets.length; i < l; i++) {
            files['/xl/worksheets/sheet' + (i + 1) + '.xml'] = this.worksheets[i].toXML();
            Paths[this.worksheets[i].id] = 'worksheets/sheet' + (i + 1) + '.xml';
            files['/xl/worksheets/_rels/sheet' + (i + 1) + '.xml.rels'] = this.worksheets[i].relations.toXML();
        }

        this._prepareFilesForPackaging(files);

        return files;
    }
});
module.exports = Workbook;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./Paths":15,"./RelationshipManager":17,"./SharedStrings":18,"./StyleSheet":21,"./Worksheet":24,"./WorksheetExportWorker.js":25,"./XMLDOM":26,"./util":28,"webworkify":6}],24:[function(require,module,exports){
(function (global){
"use strict";
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
var util = require('./util');
var RelationshipManager = require('./RelationshipManager');
var SheetView = require('./SheetView');

/**
 * This module represents an excel worksheet in its basic form - no tables, charts, etc. Its purpose is
 * to hold data, the data's link to how it should be styled, and any links to other outside resources.
 *
 * @module Excel/Worksheet
 */
    var Worksheet = function (config) {
        this.relations = null;
        this.columnFormats = [];
        this.data = [];
        this.mergedCells = [];
        this.columns = [];
        this.sheetProtection = false;
        this._headers = [];
        this._footers = [];
        this._tables = [];
        this._drawings = [];
        this._rowInstructions = {};
        this._freezePane = {};

        this.hyperlinks = [];
        this.sheetView = config.sheetView || new SheetView();

        this.showZeros = null;
        this.initialize(config);
    };
    _.extend(Worksheet.prototype, {

        initialize: function (config) {
            config = config || {};
            this.name = config.name;
            this.id = _.uniqueId('Worksheet');
            this._timezoneOffset = new Date().getTimezoneOffset() * 60 * 1000;
            if(config.columns) {
                this.setColumns(config.columns);
            }

            this.relations = new RelationshipManager();
        },

        /**
         * Returns an object that can be consumed by a WorksheetExportWorker
         * @returns {Object}
         */
        exportData: function () {
            return {
                relations: this.relations.exportData(),
                columnFormats: this.columnFormats,
                data: this.data,
                columns: this.columns,
                mergedCells: this.mergedCells,
                _headers: this._headers,
                _footers: this._footers,
                _tables: this._tables,
                _drawings: this._drawings,
                _rowInstructions: this._rowInstructions,
                _freezePane: this._freezePane,
                hyperlinks: this.hyperlinks,
                showZeros: this.showZeros,
                name: this.name,
                id: this.id
            };
        },

        /**
         * Imports data - to be used while inside of a WorksheetExportWorker.
         * @param {Object} data
         */
        importData: function (data) {
            this.relations.importData(data.relations);
            delete data.relations;
            _.extend(this, data);
        },

        setSharedStringCollection: function (stringCollection) {
            this.sharedStrings = stringCollection;
        },

        addTable: function (table) {
            this._tables.push(table);
            this.relations.addRelation(table, 'table');
        },

        addDrawings: function (table) {
            this._drawings.push(table);
            this.relations.addRelation(table, 'drawingRelationship');
        },

        setRowInstructions: function (rowIndex, instructions) {
            this._rowInstructions[rowIndex] = instructions;
        },

        /**
        * Expects an array length of three.
        *
        * @see Excel/Worksheet compilePageDetailPiece
        * @see <a href='/cookbook/addingHeadersAndFooters.html'>Adding headers and footers to a worksheet</a>
        *
        * @param {Array} headers [left, center, right]
        */
        setHeader: function (headers) {
            if(!_.isArray(headers)) {
                throw "Invalid argument type - setHeader expects an array of three instructions";
            }
            this._headers = headers;
        },

        /**
        * Expects an array length of three.
        *
        * @see Excel/Worksheet compilePageDetailPiece
        * @see <a href='/cookbook/addingHeadersAndFooters.html'>Adding headers and footers to a worksheet</a>
        *
        * @param {Array} footers [left, center, right]
        */
        setFooter: function (footers) {
            if(!_.isArray(footers)) {
                throw "Invalid argument type - setFooter expects an array of three instructions";
            }
            this._footers = footers;
        },

        /**
         * Turns page header/footer details into the proper format for Excel.
         * @param {type} data
         * @returns {String}
         */
        compilePageDetailPackage: function (data) {
            data = data || "";
            return [
            "&L", this.compilePageDetailPiece(data[0] || ""),
            "&C", this.compilePageDetailPiece(data[1] || ""),
            "&R", this.compilePageDetailPiece(data[2] || "")
            ].join('');
        },

        /**
         * Turns instructions on page header/footer details into something
         * usable by Excel.
         *
         * @param {type} data
         * @returns {String|@exp;_@call;reduce}
         */
        compilePageDetailPiece: function (data) {
            if(_.isString(data)) {
                return '&"-,Regular"'.concat(data);
            }
            if(_.isObject(data) && !_.isArray(data)) {
                var string = "";
                if(data.font || data.bold) {
                    var weighting = data.bold ? "Bold" : "Regular";
                    string += '&"' + (data.font || '-');
                    string += ',' + weighting + '"';
                } else {
                    string += '&"-,Regular"';
                }
                if(data.underline) {
                    string += "&U";
                }
                if(data.fontSize) {
                    string += "&"+data.fontSize;
                }
                string += data.text;

                return string;
            }

            if(_.isArray(data)) {
                var self = this;
                return _.reduce(data, function (m, v) {
                    return m.concat(self.compilePageDetailPiece(v));
                }, "");
            }
        },

        /**
         * Creates the header node.
         *
         * @todo implement the ability to do even/odd headers
         * @param {XML Doc} doc
         * @returns {XML Node}
         */
        exportHeader: function (doc) {
            var oddHeader = doc.createElement('oddHeader');
            oddHeader.appendChild(doc.createTextNode(this.compilePageDetailPackage(this._headers)));
            return oddHeader;
        },

        /**
         * Creates the footer node.
         *
         * @todo implement the ability to do even/odd footers
         * @param {XML Doc} doc
         * @returns {XML Node}
         */
        exportFooter: function (doc) {
            var oddFooter = doc.createElement('oddFooter');
            oddFooter.appendChild(doc.createTextNode(this.compilePageDetailPackage(this._footers)));
            return oddFooter;
        },

        /**
         * This creates some nodes ahead of time, which cuts down on generation time due to
         * most cell definitions being essentially the same, but having multiple nodes that need
         * to be created. Cloning takes less time than creation.
         *
         * @private
         * @param {XML Doc} doc
         * @returns {_L8.Anonym$0._buildCache.Anonym$2}
         */
        _buildCache: function (doc) {
            var numberNode = doc.createElement('c');
            var value = doc.createElement('v');
            value.appendChild(doc.createTextNode("--temp--"));
            numberNode.appendChild(value);

            var formulaNode = doc.createElement('c');
            var formulaValue = doc.createElement('f');
            formulaValue.appendChild(doc.createTextNode("--temp--"));
            formulaNode.appendChild(formulaValue);

            var stringNode = doc.createElement('c');
            stringNode.setAttribute('t', 's');
            var stringValue = doc.createElement('v');
            stringValue.appendChild(doc.createTextNode("--temp--"));
            stringNode.appendChild(stringValue);


            return {
                number: numberNode,
                date: numberNode,
                string: stringNode,
                formula: formulaNode
            };
        },

        /**
         * Runs through the XML document and grabs all of the strings that will
         * be sent to the 'shared strings' document.
         *
         * @returns {Array}
         */
        collectSharedStrings: function () {
            var data = this.data;
            var maxX = 0;
            var strings = {};
            for(var row = 0, l = data.length; row < l; row++) {
                var dataRow = data[row];
                var cellCount = dataRow.length;
                maxX = cellCount > maxX ? cellCount : maxX;
                for(var c = 0; c < cellCount; c++) {
                    var cellValue = dataRow[c];
                    var metadata = cellValue && cellValue.metadata || {};
                    if (cellValue && typeof cellValue === 'object') {
                        cellValue = cellValue.value;
                    }

                    if(!metadata.type) {
                        if(typeof cellValue === 'number') {
                            metadata.type = 'number';
                        }
                    }
                    if(metadata.type === "text" || !metadata.type) {
                        if(typeof strings[cellValue] === 'undefined') {
                            strings[cellValue] = true;
                        }
                    }
                }
            }
            return _.keys(strings);
        },

        toXML: function () {
            var data = this.data;
            var columns = this.columns || [];
            var doc = util.createXmlDoc(util.schemas.spreadsheetml, 'worksheet');
            var worksheet = doc.documentElement;
            var i, l, row;
            worksheet.setAttribute('xmlns:r', util.schemas.relationships);
            worksheet.setAttribute('xmlns:mc', util.schemas.markupCompat);

            var maxX = 0;
            var sheetData = util.createElement(doc, 'sheetData');

            var cellCache = this._buildCache(doc);

            for(row = 0, l = data.length; row < l; row++) {
                var dataRow = data[row];
                var cellCount = dataRow.length;
                maxX = cellCount > maxX ? cellCount : maxX;
                var rowNode = doc.createElement('row');

                for(var c = 0; c < cellCount; c++) {
                    columns[c] = columns[c] || {};
                    var cellValue = dataRow[c];
                    var cell, metadata = cellValue && cellValue.metadata || {};

                    if (cellValue && typeof cellValue === 'object') {
                        cellValue = cellValue.value;
                    }

                    if(!metadata.type) {
                        if(typeof cellValue === 'number') {
                            metadata.type = 'number';
                        }
                    }

                    switch(metadata.type) {
                        case "number":
                            cell = cellCache.number.cloneNode(true);
                            cell.firstChild.firstChild.nodeValue = cellValue;
                            break;
                        case "date":
                            cell = cellCache.date.cloneNode(true);
                            cell.firstChild.firstChild.nodeValue = 25569.0 + ((cellValue - this._timezoneOffset)  / (60 * 60 * 24 * 1000));
                            break;
                        case "formula":
                            cell = cellCache.formula.cloneNode(true);
                            cell.firstChild.firstChild.nodeValue = cellValue;
                            break;
                        case "text":
                            /*falls through*/
                        default:
                            var id;
                            if(typeof this.sharedStrings.strings[cellValue] !== 'undefined') {
                                id = this.sharedStrings.strings[cellValue];
                            } else {
                                id = this.sharedStrings.addString(cellValue);
                            }
                            cell = cellCache.string.cloneNode(true);
                            cell.firstChild.firstChild.nodeValue = id;
                            break;
                    }
                    if(metadata.style) {
                        cell.setAttribute('s', metadata.style);
                    } else if (this._rowInstructions[row] && this._rowInstructions[row].style !== undefined) {
                        cell.setAttribute('s', this._rowInstructions[row].style);
                    }
                    cell.setAttribute('r', util.positionToLetterRef(c + 1, row + 1));
                    rowNode.appendChild(cell);
                }
                rowNode.setAttribute('r', row + 1);

                if (this._rowInstructions[row]) {
                    var rowInst = this._rowInstructions[row];

                    if (rowInst.height !== undefined) {
                        rowNode.setAttribute('customHeight', '1');
                        rowNode.setAttribute('ht', rowInst.height);
                    }

                    if (rowInst.style !== undefined) {
                      rowNode.setAttribute('customFormat', '1');
                      rowNode.setAttribute('s', rowInst.style);
                    }
                }

                sheetData.appendChild(rowNode);
            }

            if(maxX !== 0) {
                worksheet.appendChild(util.createElement(doc, 'dimension', [
                    ['ref',  util.positionToLetterRef(1, 1) + ':' + util.positionToLetterRef(maxX, data.length)]
                ]));
            } else {
                worksheet.appendChild(util.createElement(doc, 'dimension', [
                    ['ref',  util.positionToLetterRef(1, 1)]
                ]));
            }

            worksheet.appendChild(this.sheetView.exportXML(doc));

            if(this.columns.length) {
                worksheet.appendChild(this.exportColumns(doc));
            }
            worksheet.appendChild(sheetData);

            // The spec doesn't say anything about this, but Excel 2013 requires sheetProtection immediately after sheetData
            if (this.sheetProtection) {
                worksheet.appendChild(this.sheetProtection.exportXML(doc));
            }

            /**
             * Doing this a bit differently, as hyperlinks could be as populous as rows. Looping twice would be bad.
             */
            if(this.hyperlinks.length > 0) {
                var hyperlinksEl = doc.createElement('hyperlinks');
                var hyperlinks = this.hyperlinks;
                for(var i = 0, l = hyperlinks.length; i < l; i++) {
                    var hyperlinkEl = doc.createElement('hyperlink'),
                        hyperlink = hyperlinks[i];
                    hyperlinkEl.setAttribute('ref', hyperlink.cell);
                    hyperlink.id = util.uniqueId('hyperlink');
                    this.relations.addRelation({
                        id: hyperlink.id,
                        target: hyperlink.location,
                        targetMode: hyperlink.targetMode || 'External'
                    }, 'hyperlink');
                    hyperlinkEl.setAttribute('r:id', this.relations.getRelationshipId(hyperlink));
                    hyperlinksEl.appendChild(hyperlinkEl);
                }
                worksheet.appendChild(hyperlinksEl);
            }

            // 'mergeCells' should be written before 'headerFoot' and 'drawing' due to issue
            // with Microsoft Excel (2007, 2013)
            if (this.mergedCells.length > 0) {
                var mergeCells = doc.createElement('mergeCells');
                for (i = 0, l = this.mergedCells.length; i < l; i++) {
                    var mergeCell = doc.createElement('mergeCell');
                    mergeCell.setAttribute('ref', this.mergedCells[i][0] + ':' + this.mergedCells[i][1]);
                    mergeCells.appendChild(mergeCell);
                }
                worksheet.appendChild(mergeCells);
            }

            this.exportPageSettings(doc, worksheet);

            if(this._headers.length > 0 || this._footers.length > 0) {
                var headerFooter = doc.createElement('headerFooter');
                if(this._headers.length > 0) {
                    headerFooter.appendChild(this.exportHeader(doc));
                }
                if(this._footers.length > 0) {
                    headerFooter.appendChild(this.exportFooter(doc));
                }
                worksheet.appendChild(headerFooter);
            }

            // the 'drawing' element should be written last, after 'headerFooter', 'mergeCells', etc. due
            // to issue with Microsoft Excel (2007, 2013)
            for(i = 0, l = this._drawings.length; i < l; i++) {
                var drawing = doc.createElement('drawing');
                drawing.setAttribute('r:id', this.relations.getRelationshipId(this._drawings[i]));
                worksheet.appendChild(drawing);
            }

            if(this._tables.length > 0) {
                var tables = doc.createElement('tableParts');
                tables.setAttribute('count', this._tables.length);
                for(i = 0, l = this._tables.length; i < l; i++) {
                    var table = doc.createElement('tablePart');
                    table.setAttribute('r:id', this.relations.getRelationshipId(this._tables[i]));
                    tables.appendChild(table);
                }
                worksheet.appendChild(tables);
            }
            return doc;
        },

        /**
         *
         * @param {XML Doc} doc
         * @returns {XML Node}
         */
        exportColumns: function (doc) {
            var cols = util.createElement(doc, 'cols');
            for(var i = 0, l = this.columns.length; i < l; i++) {
                var cd = this.columns[i];
                var col = util.createElement(doc, 'col', [
                    ['min', cd.min || i + 1],
                    ['max', cd.max || i + 1]
                ]);
                if (cd.hidden) {
                    col.setAttribute('hidden', 1);
                }
                if(cd.bestFit) {
                    col.setAttribute('bestFit', 1);
                }
                if(cd.customWidth || cd.width) {
                    col.setAttribute('customWidth', 1);
                }
                if(cd.width) {
                    col.setAttribute('width', cd.width);
                } else {
                    col.setAttribute('width', 9.140625);
                }

                cols.appendChild(col);
            }
            return cols;
        },

        /**
         * Sets the page settings on a worksheet node.
         *
         * @param {XML Doc} doc
         * @param {XML Node} worksheet
         * @returns {undefined}
         */
        exportPageSettings: function (doc, worksheet) {

            if(this._orientation) {
                worksheet.appendChild(util.createElement(doc, 'pageSetup', [
                    ['orientation', this._orientation]
                ]));
            }
        },

        /**
         * http://www.schemacentral.com/sc/ooxml/t-ssml_ST_Orientation.html
         *
         * Can be one of 'portrait' or 'landscape'.
         *
         * @param {String} orientation
         * @returns {undefined}
         */
        setPageOrientation: function (orientation) {
            this._orientation = orientation;
        },

        /**
         * Expects an array of column definitions. Each column definition needs to have a width assigned to it.
         *
         * @param {Array} columns
         */
        setColumns: function (columns) {
            this.columns = columns;
        },

        /**
         * Expects an array of data to be translated into cells.
         *
         * @param {Array} data Two dimensional array - [ [A1, A2], [B1, B2] ]
         * @see <a href='/cookbook/addingDataToAWorksheet.html'>Adding data to a worksheet</a>
         */
        setData: function (data) {
            this.data = data;
        },

        /**
         * Merge cells in given range
         *
         * @param cell1 - A1, A2...
         * @param cell2 - A2, A3...
         */
        mergeCells: function(cell1, cell2) {
            this.mergedCells.push([cell1, cell2]);
        },

        /**
         * Added froze pane
         * @param column - column number: 0, 1, 2 ...
         * @param row - row number: 0, 1, 2 ...
         * @param cell - 'A1'
         * @deprecated
         */
        freezePane: function(column, row, cell) {
            this.sheetView.freezePane(column, row, cell);
        },

        /**
         * Expects an array containing an object full of column format definitions.
         * http://msdn.microsoft.com/en-us/library/documentformat.openxml.spreadsheet.column.aspx
         * bestFit
         * collapsed
         * customWidth
         * hidden
         * max
         * min
         * outlineLevel
         * phonetic
         * style
         * width
         * @param {Array} columnFormats
         */
        setColumnFormats: function (columnFormats) {
            this.columnFormats = columnFormats;
        }
    });
    module.exports = Worksheet;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./RelationshipManager":17,"./SheetView":20,"./util":28}],25:[function(require,module,exports){
(function (global){
/* jshint strict: false, node: true */
/* globals  onmessage: true, importScripts, postMessage */
"use strict";
var Worksheet = require('./Worksheet');
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
module.exports = function (self) {
    var requireConfig;
    var worksheet;
    var start = function(data) {
        worksheet = new Worksheet({name: 'Temp'});
        worksheet.importData(data);
    };
    self.addEventListener('message',function (event){
        var data = event.data;
        if (typeof data === 'object') {
            switch (data.instruction) {
                case "start":
                    start(data.data);
                    postMessage({status: 'sharedStrings', data: worksheet.collectSharedStrings()});
                    break;
                case "export":
                    start(data.data);
                    worksheet.setSharedStringCollection({
                        strings: data.sharedStrings
                    });
                    postMessage({status: "finished", data: worksheet.toXML().toString(), worksheetIndex: data.worksheetIndex});
                    break;
            }
        }
    });
};

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./Worksheet":24}],26:[function(require,module,exports){
(function (global){
'use strict';
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);

var XMLDOM = function (ns, rootNodeName) {
    this.documentElement = this.createElement(rootNodeName);
    this.documentElement.setAttribute('xmlns', ns);
};

_.extend(XMLDOM.prototype, {
    createElement: function (name) {
        return new XMLDOM.XMLNode({
            nodeName: name
        });
    },
    createTextNode: function (text) {
        return new XMLDOM.TextNode(text);
    },
    toString: function () {
        return this.documentElement.toString();
    }
});

XMLDOM.Node = function () {};
XMLDOM.Node.Create = function (config) {
    switch(config.type) {
        case "XML":
            return new XMLDOM.XMLNode(config);
        case "TEXT":
            return new XMLDOM.TextNode(config.nodeValue);
    }
};

XMLDOM.TextNode = function (text) {
    this.nodeValue = text;
};
 _.extend(XMLDOM.TextNode.prototype, {
     toJSON: function () {
         return {
             nodeValue: this.nodeValue,
             type: 'TEXT'
         };
     },
    toString: function () {
        return _.escape(this.nodeValue);
    }
 });

XMLDOM.XMLNode = function (config) {
    this.nodeName = config.nodeName;
    this.children = [];
    this.nodeValue = config.nodeValue || "";
    this.attributes = {};

    if(config.children) {
        for(var i = 0, l = config.children.length; i < l; i++) {
            this.appendChild(XMLDOM.Node.Create(config.children[i]));
        }
    }

    if(config.attributes) {
        for(var attr in config.attributes) {
            if(config.attributes.hasOwnProperty(attr)) {
                this.setAttribute(attr, config.attributes[attr]);
            }
        }
    }
};
_.extend(XMLDOM.XMLNode.prototype, {

    toString: function () {
        var string = "<" + this.nodeName;
        for(var attr in this.attributes) {
            if(this.attributes.hasOwnProperty(attr)) {
                string = string + " " + attr + "=\""+_.escape(this.attributes[attr])+"\"";
            }
        }

        var childContent = "";
        for(var i = 0, l = this.children.length; i < l; i++) {
            childContent += this.children[i].toString();
        }

        if (childContent){
            string +=  ">" + childContent + "</" + this.nodeName + ">";
        } else {
            string += "/>";
        }

        return string;
    },

    toJSON: function () {
        var children = [];
        for(var i = 0, l = this.children.length; i < l; i++) {
            children.push(this.children[i].toJSON());
        }
        return {
            nodeName: this.nodeName,
            children: children,
            nodeValue: this.nodeValue,
            attributes: this.attributes,
            type: "XML"
        };
    },

    setAttribute: function (name, val) {
        if(val === null) {
            delete this.attributes[name];
            delete this[name];
            return;
        }
        this.attributes[name] = val;
        this[name] = val;
    },
    appendChild: function (child) {
        this.children.push(child);
        this.firstChild = this.children[0];
    },
    cloneNode: function () {
        return new XMLDOM.XMLNode(this.toJSON());
    }
});

module.exports = XMLDOM;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],27:[function(require,module,exports){
(function (global){
/* jshint unused: false */
/* globals  importScripts, JSZip, postMessage */
var JSZip = (typeof window !== "undefined" ? window['JSZip'] : typeof global !== "undefined" ? global['JSZip'] : null);
module.exports = function (self) {
    self.addEventListener('message',function (event){
      "use strict";
      if (!event.data) { return; }
      var zip = new JSZip();
      var files = event.data.files;
      for(var path in files) {
          if(files.hasOwnProperty(path)) {
              var content = files[path];
              path = path.substr(1);
              if(path.indexOf('.xml') !== -1 || path.indexOf('.rel') !== -1) {
                  zip.file(path, content, {base64: false});
              } else {
                  zip.file(path, content, {base64: true, binary: true});
              }
          }
      }
      self.postMessage({
          base64: !!event.data.base64
      });
      self.postMessage({
          status: 'done',
          data: zip.generate({
              base64: !!event.data.base64
          })
      });
    });
};
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{}],28:[function(require,module,exports){
(function (global){
"use strict";
var XMLDOM = require('./XMLDOM');
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
/**
 * @module Excel/util
 */

var util = {

    _idSpaces: {},

    /**
     * Returns a number based on a namespace. So, running with 'Picture' will return 1. Run again, you will get 2. Run with 'Foo', you'll get 1.
     * @param {String} space
     * @returns {Number}
     */
    uniqueId: function (space) {
        if(!this._idSpaces[space]) {
            this._idSpaces[space] = 1;
        }
        return this._idSpaces[space]++;
    },

    /**
     * Attempts to create an XML document. After some investigation, using the 'fake' document
     * is significantly faster than creating an actual XML document, so we're going to go with
     * that. Besides, it just makes it easier to port to node.
     *
     * Takes a namespace to start the xml file in, as well as the root element
     * of the xml file.
     *
     * @param {type} ns
     * @param {type} base
     * @returns {@new;XMLDOM}
     */
    createXmlDoc: function (ns, base) {
        return new XMLDOM(ns || null, base, null);
    },

    /**
     * Creates an xml node (element). Used to simplify some calls, as IE is
     * very particular about namespaces and such.
     *
     * @param {XMLDOM} doc An xml document (actual DOM or fake DOM, not a string)
     * @param {type} name The name of the element
     * @param {type} attributes
     * @returns {XML Node}
     */
    createElement: function (doc, name, attributes) {
        var el = doc.createElement(name);
        attributes = attributes || [];
        var i = attributes.length;
        while (i--) {
            el.setAttribute(attributes[i][0], attributes[i][1]);
        }
        return el;
    },

    /**
     * This is sort of slow, but it's a huge convenience method for the code. It probably shouldn't be used
     * in high repetition areas.
     *
     * @param {XMLDoc} doc
     * @param {Object} attrs
     */
    setAttributesOnDoc: function (doc, attrs) {
        _.forEach(attrs, function (v, k) {
            if(_.isPlainObject(v)) {
                if(v.v !== null && v.v !== undefined) {
                    switch(v.type) {
                        case Boolean:
                            v = v.v ? '1' : '0';
                            break;
                    }
                } else {
                    v = null;
                }
            }
            if(v !== null && v !== undefined) {
                doc.setAttribute(k, v);
            }
        })
    },

    LETTER_REFS: {},

    positionToLetterRef: function (x, y) {
        var digit = 1, index, num = x, string = "", alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
        if(this.LETTER_REFS[x]) {
            return this.LETTER_REFS[x].concat(y);
        }
        while (num > 0) {
            num -= Math.pow(26, digit -1);
            index = num % Math.pow(26, digit);
            num -= index;
            index = index / Math.pow(26, digit - 1);
            string = alphabet.charAt(index) + string;
            digit += 1;
        }
        this.LETTER_REFS[x] = string;
        return string.concat(y);
    },

    schemas: {
        'worksheet': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet',
        'sharedStrings': "http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings",
        'stylesheet': "http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles",
        'relationships': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
        'relationshipPackage': "http://schemas.openxmlformats.org/package/2006/relationships",
        'contentTypes': "http://schemas.openxmlformats.org/package/2006/content-types",
        'spreadsheetml': "http://schemas.openxmlformats.org/spreadsheetml/2006/main",
        'markupCompat': "http://schemas.openxmlformats.org/markup-compatibility/2006",
        'x14ac': "http://schemas.microsoft.com/office/spreadsheetml/2009/9/ac",
        'officeDocument': "http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument",
        'package': "http://schemas.openxmlformats.org/package/2006/relationships",
        'table': "http://schemas.openxmlformats.org/officeDocument/2006/relationships/table",
        'spreadsheetDrawing': 'http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing',
        'drawing': 'http://schemas.openxmlformats.org/drawingml/2006/main',
        'drawingRelationship': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing',
        'image': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image',
        'chart': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/chart',
        'hyperlink': "http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink"
    }
};

module.exports = util;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./XMLDOM":26}],29:[function(require,module,exports){
(function (global){
'use strict';

var Workbook = require('../Excel/Workbook');
var Table = require('../Excel/Table');
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);

var Template = function (worksheetConstructorSettings) {
    this.workbook = new Workbook();
    this.stylesheet = this.workbook.getStyleSheet();

    this.columns = {};

    this.predefinedStyles = {

    };

    this.predefinedFormatters = {
        date: this.stylesheet.createSimpleFormatter('date'),
        currency: this.stylesheet.createFormat({format: "$ #,##0.00;$ #,##0.00;-", font: {color: "FFE9F50A"}}),
        header: this.stylesheet.createFormat({
            font: { bold: true, underline: true, color: {theme: 3}},
            alignment: {horizontal: 'center'}
        })
    };

    if(worksheetConstructorSettings != null) {
        this.worksheet = this.workbook.createWorksheet(worksheetConstructorSettings);
    }
    else {
        this.worksheet = this.workbook.createWorksheet();
    }
    this.workbook.addWorksheet(this.worksheet);
    this.worksheet.setPageOrientation('landscape');
    this.table = new Table();
    this.table.styleInfo.themeStyle = "TableStyleLight1";
    this.worksheet.addTable(this.table);
    this.workbook.addTable(this.table);
};

_.extend(Template.prototype, {
    setHeader: function () {
        this.worksheet.setHeader.apply(this.worksheet, arguments);
    },
    setFooter: function () {
        this.worksheet.setFooter.apply(this.worksheet, arguments);
    },
    prepare: function () {
        return this.workbook;
    },

    setData: function (worksheetData) {
        this.worksheet.setData(worksheetData);
        this.data = worksheetData;
        this.table.setReferenceRange([1, 1], [this.columns.length, worksheetData.length]);
    },

    setColumns: function (columns) {
        this.columns = columns;
        this.worksheet.setColumns(columns);
        this.table.setTableColumns(columns);
        this.table.setReferenceRange([1, 1], [this.columns.length, this.data.length]);
    },

    getWorksheet: function () {
        return this.worksheet;
    }
});

module.exports = Template;

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"../Excel/Table":22,"../Excel/Workbook":23}],30:[function(require,module,exports){
module.exports = {
    BasicReport: require('./BasicReport')
};
},{"./BasicReport":29}],31:[function(require,module,exports){
(function (global){
"use strict";
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
var Workbook = require('./Excel/Workbook');
var JSZip = (typeof window !== "undefined" ? window['JSZip'] : typeof global !== "undefined" ? global['JSZip'] : null);
var work = require('webworkify');

/**
 * @name Excel
 * @public
 * @author Stephen Liberty
 * @requires underscore
 * @requires Excel/Workbook
 * @requires JSZIP
 * @exports excel-builder
 */
var Factory = {
    /**
     * Creates a new workbook.
     */
    createWorkbook: function () {
        return new Workbook();
    },

    config: {
        forceUIThread: false
    },

    /**
     * Turns a workbook into a downloadable file.
     * @param {Excel/Workbook} workbook The workbook that is being converted
     * @param {Object} options
     * @param {Boolean} options.base64 Whether to 'return' the generated file as a base64 string
     * @param {Function} options.success The callback function to run after workbook creation is successful.
     * @param {Function} options.error The callback function to run if there is an error creating the workbook.
     * @param {String} options.requireJsPath (Optional) The path to requirejs. Will use the id 'requirejs' to look up the script if not specified.
     */
    createFileAsync: function (workbook, options) {
        workbook.generateFilesAsync({
            success: function (files) {
                var w = work(require('./Excel/ZipWorker.js'));
                w.addEventListener('message', function (event) {
                    if(event.data.status === 'done') {
                        options.success(event.data.data);
                    }
                });
                w.postMessage({
                    files: files,
                    base64: (!options || options.base64 !== false)
                });
            },
            error: function () {
                options.error();
            }
        });
    },

    /**
     * Turns a workbook into a downloadable file.
     * @param {Excel/Workbook} workbook The workbook that is being converted
     * @param {Object} options - options to modify how the zip is created. See http://stuk.github.io/jszip/#doc_generate_options
     * @returns {Promise}
     */
    createFile: function (workbook, options) {
        var zip = new JSZip();
        var files = workbook.generateFiles();
        _.each(files, function (content, path) {
            path = path.substr(1);
            if(path.indexOf('.xml') !== -1 || path.indexOf('.rel') !== -1) {
                zip.file(path, content, {base64: false});
            } else {
                zip.file(path, content, {base64: true, binary: true});
            }
        });
        return zip.generate(_.defaults(options || {}, {
            type: "base64"
        }));
    }
};


module.exports = Factory;
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./Excel/Workbook":23,"./Excel/ZipWorker.js":27,"webworkify":6}],32:[function(require,module,exports){
(function (global){
var _ = (typeof window !== "undefined" ? window['_'] : typeof global !== "undefined" ? global['_'] : null);
var EBExport = module.exports = {
    Drawings: require('./Excel/Drawings'),
    Drawing: require('./Excel/Drawing/index'),
    Pane: require('./Excel/Pane'),
    Paths: require('./Excel/Paths'),
    Positioning: require('./Excel/Positioning'),
    RelationshipManager: require('./Excel/RelationshipManager'),
    SharedStrings: require('./Excel/SharedStrings'),
    SheetProtection: require('./Excel/SheetProtection'),
    SheetView: require('./Excel/SheetView'),
    StyleSheet: require('./Excel/StyleSheet'),
    Table: require('./Excel/Table'),
    util: require('./Excel/util'),
    Workbook: require('./Excel/Workbook'),
    Worksheet: require('./Excel/Worksheet'),
    WorksheetExportWorker: require('./Excel/WorksheetExportWorker'),
    XMLDOM: require('./Excel/XMLDOM'),
    ZipWorker: require('./Excel/ZipWorker'),
    Builder: require('./excel-builder'),
    Template: require('./Template')
};

try {
    if(typeof window !== 'undefined!') {
        window.ExcelBuilder = EBExport;
    }
} catch (e) {
    //Silently ignore?
    console.info("Not attaching EB to window");
}
}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})
},{"./Excel/Drawing/index":12,"./Excel/Drawings":13,"./Excel/Pane":14,"./Excel/Paths":15,"./Excel/Positioning":16,"./Excel/RelationshipManager":17,"./Excel/SharedStrings":18,"./Excel/SheetProtection":19,"./Excel/SheetView":20,"./Excel/StyleSheet":21,"./Excel/Table":22,"./Excel/Workbook":23,"./Excel/Worksheet":24,"./Excel/WorksheetExportWorker":25,"./Excel/XMLDOM":26,"./Excel/ZipWorker":27,"./Excel/util":28,"./Template":30,"./excel-builder":31}]},{},[7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32]);
