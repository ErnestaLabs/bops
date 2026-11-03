import test from 'node:test';
import assert from 'node:assert/strict';
import { inflateSync } from 'node:zlib';
import { visionProbe } from '../probes.mjs';

test('synthetic PNG has valid signature, headers, chunk CRCs and known pixel colors', () => {
  const probe = visionProbe(['red', 'green', 'blue', 'yellow', 'black', 'white']);
  const png = Buffer.from(probe.input[0].content[1].image_url.split(',')[1], 'base64');
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const chunks = new Map(); let offset = 8;
  while (offset < png.length) {
    const length = png.readUInt32BE(offset), type = png.subarray(offset + 4, offset + 8).toString();
    const bytes = png.subarray(offset + 8, offset + 8 + length);
    // Independent bit-at-a-time reference check of every critical chunk.
    let crc = 0xffffffff;
    for (const byte of png.subarray(offset + 4, offset + 8 + length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc & 1) === 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    assert.equal(png.readUInt32BE(offset + 8 + length), (crc ^ 0xffffffff) >>> 0);
    chunks.set(type, bytes); offset += length + 12;
  }
  assert.equal(offset, png.length); assert.deepEqual([...chunks.keys()], ['IHDR', 'IDAT', 'IEND']);
  const header = chunks.get('IHDR'); assert.equal(header.readUInt32BE(0), 360); assert.equal(header.readUInt32BE(4), 240);
  assert.equal(header[8], 8); assert.equal(header[9], 2);
  const raw = inflateSync(chunks.get('IDAT')), stride = 1081;
  assert.equal(raw.length, stride * 240);
  for (let y = 0; y < 240; y++) assert.equal(raw[y * stride], 0);
  assert.deepEqual([...raw.subarray(60 * stride + 181, 60 * stride + 184)], [255, 0, 0]);
  assert.deepEqual([...raw.subarray(1, 4)], [128, 128, 128]);
});
test('probe rejects ambiguous or invalid palettes', () => {
  for (const order of [[], ['red'], Array(6).fill('red'), ['red', 'green', 'blue', 'yellow', 'black', 'invisible']]) assert.throws(() => visionProbe(order));
  const generated = visionProbe(); assert.equal(generated.expected.length, 6); assert.equal(new Set(generated.expected).size, 6);
});
