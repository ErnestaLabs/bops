/** Synthetic vision handshake: no customer screenshots, metadata or files.
 * Minimal 8-bit truecolor PNG, filter 0 and standard zlib/CRC32 chunks.
 * Format reference: https://www.w3.org/TR/png-3/
 */
import { randomInt } from 'node:crypto';
import { deflateSync } from 'node:zlib';
const COLORS = {
  red: [255, 0, 0], green: [0, 170, 0], blue: [0, 0, 255],
  yellow: [255, 255, 0], black: [0, 0, 0], white: [255, 255, 255],
};
function crc32(buffer) {
  let value = 0xffffffff;
  for (const byte of buffer) {
    value ^= byte;
    for (let i = 0; i < 8; i++) value = value >>> 1 ^ (value & 1 ? 0xedb88320 : 0);
  }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(name, bytes) {
  const type = Buffer.from(name, 'ascii');
  const length = Buffer.alloc(4); length.writeUInt32BE(bytes.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(Buffer.concat([type, bytes])));
  return Buffer.concat([length, type, bytes, crc]);
}
export function visionProbe(order) {
  const names = order ? [...order] : Object.keys(COLORS);
  if (names.length !== 6 || new Set(names).size !== 6 || names.some(name => !Object.hasOwn(COLORS, name))) throw new Error('Invalid probe palette.');
  if (!order) for (let i = names.length - 1; i > 0; i--) { const j = randomInt(i + 1); [names[i], names[j]] = [names[j], names[i]]; }
  const width = 360, height = 240, stride = 1 + width * 3;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const cell = Math.floor(y / 120) * 3 + Math.floor(x / 120);
    const margin = x % 120 < 10 || x % 120 >= 110 || y % 120 < 10 || y % 120 >= 110;
    const color = margin ? [128, 128, 128] : COLORS[names[cell]];
    for (let k = 0; k < 3; k++) raw[y * stride + 1 + x * 3 + k] = color[k];
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  return {
    expected: names,
    input: [{ role: 'user', content: [
      { type: 'input_text', text: 'Read the six colored squares in this image, left to right across the top row, then left to right across the bottom row. Ignore the gray borders. Return ONLY a JSON array of six lowercase color names chosen from: black, blue, green, red, white, yellow. Do not guess from this text; use the actual image.' },
      { type: 'input_image', image_url: `data:image/png;base64,${png.toString('base64')}` },
    ] }],
  };
}
