'use strict';
const fs = require('node:fs');
const zlib = require('node:zlib');

/**
 * ZIP zonder compressie (“stored”), rechtstreeks gestreamd. Video's laten zich nauwelijks verder
 * comprimeren; zonder compressie is de totale grootte vooraf exact te berekenen. Daardoor kan de
 * browser echte voortgang tonen, en is er geen tijdelijk bestand op schijf (dus ook niets op te
 * ruimen en geen extra schijfruimte nodig).
 *
 * - Bestanden worden in stukken gelezen en doorgegeven (nooit in het geheugen geladen).
 * - CRC-32 wordt tijdens het streamen berekend en in een “data descriptor” na elk bestand gezet.
 * - ZIP64 zodra een bestand of positie boven 4 GB uitkomt (of bij te veel bestanden).
 * - Namen in UTF-8 (vlag 11), zodat accenten en andere tekens goed overkomen.
 */
const U32 = 0xffffffff;
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
/** CRC-32; zlib.crc32 als Node die heeft (22.2+), anders een eigen tabel. */
const crc32 = typeof zlib.crc32 === 'function'
  ? (buf, prev = 0) => zlib.crc32(buf, prev)
  : (buf, prev = 0) => {
    let c = ~prev;
    for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
    return ~c >>> 0;
  };

function dosDateTime(date) {
  const d = new Date(date);
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const day = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { time, date: day };
}

/**
 * Plan: per bestand { name, size, path | buffer } → offsets, zip64-keuze en totale grootte.
 * forceZip64 is alleen voor tests (zo is het ZIP64-pad te controleren zonder bestanden van 4 GB).
 */
function planZip(entries, { forceZip64 = false } = {}) {
  let offset = 0;
  const planned = entries.map((e) => {
    const name = Buffer.from(e.name, 'utf8');
    const zip64 = forceZip64 || e.size >= U32 || offset >= U32;
    const local = 30 + name.length + (zip64 ? 20 : 0);
    const descriptor = zip64 ? 24 : 16;
    const p = { ...e, nameBuf: name, zip64, offset, local, descriptor };
    offset += local + e.size + descriptor;
    return p;
  });
  const cdStart = offset;
  let cdSize = 0;
  for (const p of planned) {
    const big = p.zip64 || p.offset >= U32;
    p.cdExtra = big ? 4 + 24 : 0;
    cdSize += 46 + p.nameBuf.length + p.cdExtra;
  }
  const needZip64End = forceZip64 || planned.length >= 0xffff || cdStart >= U32 || cdSize >= U32 || planned.some((p) => p.zip64);
  const end = (needZip64End ? 56 + 20 : 0) + 22;
  return { entries: planned, cdStart, cdSize, zip64End: needZip64End, total: cdStart + cdSize + end };
}

function localHeader(p, when) {
  const b = Buffer.alloc(p.local);
  const { time, date } = dosDateTime(when);
  b.writeUInt32LE(0x04034b50, 0);
  b.writeUInt16LE(p.zip64 ? 45 : 20, 4);
  b.writeUInt16LE(0x0808, 6); // data descriptor + UTF-8
  b.writeUInt16LE(0, 8); // stored
  b.writeUInt16LE(time, 10);
  b.writeUInt16LE(date, 12);
  b.writeUInt32LE(0, 14);
  b.writeUInt32LE(p.zip64 ? U32 : 0, 18);
  b.writeUInt32LE(p.zip64 ? U32 : 0, 22);
  b.writeUInt16LE(p.nameBuf.length, 26);
  b.writeUInt16LE(p.zip64 ? 20 : 0, 28);
  p.nameBuf.copy(b, 30);
  if (p.zip64) {
    const x = 30 + p.nameBuf.length;
    b.writeUInt16LE(0x0001, x);
    b.writeUInt16LE(16, x + 2);
    b.writeBigUInt64LE(0n, x + 4);
    b.writeBigUInt64LE(0n, x + 12);
  }
  return b;
}

function dataDescriptor(p, crc) {
  const b = Buffer.alloc(p.descriptor);
  b.writeUInt32LE(0x08074b50, 0);
  b.writeUInt32LE(crc >>> 0, 4);
  if (p.zip64) {
    b.writeBigUInt64LE(BigInt(p.size), 8);
    b.writeBigUInt64LE(BigInt(p.size), 16);
  } else {
    b.writeUInt32LE(p.size, 8);
    b.writeUInt32LE(p.size, 12);
  }
  return b;
}

function centralHeader(p, crc, when) {
  const b = Buffer.alloc(46 + p.nameBuf.length + p.cdExtra);
  const { time, date } = dosDateTime(when);
  const big = p.cdExtra > 0;
  b.writeUInt32LE(0x02014b50, 0);
  b.writeUInt16LE((3 << 8) | 45, 4); // Unix, 4.5
  b.writeUInt16LE(big ? 45 : 20, 6);
  b.writeUInt16LE(0x0808, 8);
  b.writeUInt16LE(0, 10);
  b.writeUInt16LE(time, 12);
  b.writeUInt16LE(date, 14);
  b.writeUInt32LE(crc >>> 0, 16);
  b.writeUInt32LE(big ? U32 : p.size, 20);
  b.writeUInt32LE(big ? U32 : p.size, 24);
  b.writeUInt16LE(p.nameBuf.length, 28);
  b.writeUInt16LE(p.cdExtra, 30);
  b.writeUInt16LE(0, 32);
  b.writeUInt16LE(0, 34);
  b.writeUInt16LE(0, 36);
  b.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  b.writeUInt32LE(big ? U32 : p.offset, 42);
  p.nameBuf.copy(b, 46);
  if (big) {
    const x = 46 + p.nameBuf.length;
    b.writeUInt16LE(0x0001, x);
    b.writeUInt16LE(24, x + 2);
    b.writeBigUInt64LE(BigInt(p.size), x + 4);
    b.writeBigUInt64LE(BigInt(p.size), x + 12);
    b.writeBigUInt64LE(BigInt(p.offset), x + 20);
  }
  return b;
}

function endRecords(plan) {
  const n = plan.entries.length;
  const parts = [];
  if (plan.zip64End) {
    const z = Buffer.alloc(56);
    z.writeUInt32LE(0x06064b50, 0);
    z.writeBigUInt64LE(44n, 4);
    z.writeUInt16LE((3 << 8) | 45, 12);
    z.writeUInt16LE(45, 14);
    z.writeUInt32LE(0, 16);
    z.writeUInt32LE(0, 20);
    z.writeBigUInt64LE(BigInt(n), 24);
    z.writeBigUInt64LE(BigInt(n), 32);
    z.writeBigUInt64LE(BigInt(plan.cdSize), 40);
    z.writeBigUInt64LE(BigInt(plan.cdStart), 48);
    const loc = Buffer.alloc(20);
    loc.writeUInt32LE(0x07064b50, 0);
    loc.writeUInt32LE(0, 4);
    loc.writeBigUInt64LE(BigInt(plan.cdStart + plan.cdSize), 8);
    loc.writeUInt32LE(1, 16);
    parts.push(z, loc);
  }
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0);
  e.writeUInt16LE(0, 4);
  e.writeUInt16LE(0, 6);
  e.writeUInt16LE(Math.min(n, 0xffff), 8);
  e.writeUInt16LE(Math.min(n, 0xffff), 10);
  e.writeUInt32LE(plan.zip64End ? U32 : plan.cdSize, 12);
  e.writeUInt32LE(plan.zip64End ? U32 : plan.cdStart, 16);
  e.writeUInt16LE(0, 20);
  parts.push(e);
  return Buffer.concat(parts);
}

/** Schrijf met tegendruk: wacht als de verbinding (nog) niet meer aankan. */
function writeOut(out, chunk) {
  if (out.destroyed) return Promise.reject(Object.assign(new Error('verbinding gesloten'), { aborted: true }));
  if (out.write(chunk)) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const done = () => { out.off('drain', done); out.off('close', closed); resolve(); };
    const closed = () => { out.off('drain', done); reject(Object.assign(new Error('verbinding gesloten'), { aborted: true })); };
    out.once('drain', done);
    out.once('close', closed);
  });
}

/**
 * Stream een geplande ZIP naar `out`. beforeEntry(entry) wordt vóór elk bestand aangeroepen en mag
 * een fout gooien (bijv. toegang ingetrokken tijdens het downloaden): de verbinding wordt dan
 * afgebroken, zodat er geen half-geldig pakket ontstaat dat er compleet uitziet.
 */
async function streamZip(out, plan, { when = new Date(), beforeEntry = async () => {}, onProgress = () => {} } = {}) {
  const crcs = [];
  let written = 0;
  for (const p of plan.entries) {
    await beforeEntry(p);
    await writeOut(out, localHeader(p, when));
    let crc = 0;
    let seen = 0;
    if (p.buffer) {
      crc = crc32(p.buffer);
      seen = p.buffer.length;
      await writeOut(out, p.buffer);
    } else {
      const stream = fs.createReadStream(p.path, { highWaterMark: 1024 * 1024 });
      try {
        for await (const chunk of stream) {
          crc = crc32(chunk, crc);
          seen += chunk.length;
          await writeOut(out, chunk);
          written += chunk.length;
          onProgress(written);
        }
      } finally { stream.destroy(); }
    }
    if (seen !== p.size) throw new Error(`Bestand ${p.name} is tijdens het inpakken gewijzigd.`);
    crcs.push(crc);
    await writeOut(out, dataDescriptor(p, crc));
  }
  for (let i = 0; i < plan.entries.length; i++) await writeOut(out, centralHeader(plan.entries[i], crcs[i], when));
  await writeOut(out, endRecords(plan));
}

module.exports = { planZip, streamZip, crc32 };
