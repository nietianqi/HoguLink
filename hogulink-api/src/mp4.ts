// Minimal ISO-BMFF (MP4) reader: enough to check an uploaded introduction video and to
// blank camera metadata. It never decodes or re-encodes media samples.
type Box = { type: string; start: number; payload: number; end: number };
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'mvex']);
/** Boxes that carry camera, location or editing metadata rather than playable media. */
const METADATA = new Set(['udta', 'meta', 'uuid']);

function children(buf: Buffer, start: number, end: number): Box[] {
  const result: Box[] = [];
  let at = start;
  while (at + 8 <= end) {
    let size = buf.readUInt32BE(at),
      header = 8;
    const type = buf.toString('latin1', at + 4, at + 8);
    if (size === 1) {
      if (at + 16 > end) throw new Error('Truncated box');
      size = Number(buf.readBigUInt64BE(at + 8));
      header = 16;
    } else if (size === 0) size = end - at;
    if (size < header || at + size > end) throw new Error('Invalid box size');
    result.push({ type, start: at, payload: at + header, end: at + size });
    at += size;
  }
  return result;
}
const child = (buf: Buffer, box: Box, type: string) =>
  children(buf, box.payload, box.end).find((x) => x.type === type);

export type Mp4Info = {
  brand: string;
  /** From the movie header, or the fragment header for fragmented files; absent when neither records it. */
  durationSeconds?: number;
  videoCodecs: string[];
  audioCodecs: string[];
};
export function inspectMp4(buf: Buffer): Mp4Info {
  const top = children(buf, 0, buf.length);
  const ftyp = top.find((b) => b.type === 'ftyp');
  const moov = top.find((b) => b.type === 'moov');
  if (!ftyp || !moov || top[0].type !== 'ftyp') throw new Error('Not an MP4 file');
  const info: Mp4Info = {
    brand: buf.toString('latin1', ftyp.payload, ftyp.payload + 4),
    videoCodecs: [],
    audioCodecs: [],
  };
  const mvhd = child(buf, moov, 'mvhd');
  let timescale = 0;
  if (mvhd) {
    const v = buf[mvhd.payload];
    timescale = buf.readUInt32BE(mvhd.payload + (v === 1 ? 20 : 12));
    const duration =
      v === 1
        ? Number(buf.readBigUInt64BE(mvhd.payload + 24))
        : buf.readUInt32BE(mvhd.payload + 16);
    if (timescale && duration) info.durationSeconds = duration / timescale;
  }
  const mehd = (() => {
    const mvex = child(buf, moov, 'mvex');
    return mvex && child(buf, mvex, 'mehd');
  })();
  if (!info.durationSeconds && mehd && timescale) {
    const v = buf[mehd.payload];
    const duration =
      v === 1 ? Number(buf.readBigUInt64BE(mehd.payload + 4)) : buf.readUInt32BE(mehd.payload + 4);
    if (duration) info.durationSeconds = duration / timescale;
  }
  for (const trak of children(buf, moov.payload, moov.end).filter((b) => b.type === 'trak')) {
    const mdia = child(buf, trak, 'mdia');
    const hdlr = mdia && child(buf, mdia, 'hdlr');
    const minf = mdia && child(buf, mdia, 'minf');
    const stbl = minf && child(buf, minf, 'stbl');
    const stsd = stbl && child(buf, stbl, 'stsd');
    if (!hdlr || !stsd || stsd.payload + 16 > stsd.end) continue;
    const handler = buf.toString('latin1', hdlr.payload + 8, hdlr.payload + 12);
    const codec = buf.toString('latin1', stsd.payload + 12, stsd.payload + 16);
    if (handler === 'vide') info.videoCodecs.push(codec);
    if (handler === 'soun') info.audioCodecs.push(codec);
  }
  return info;
}
/**
 * Returns a copy whose metadata boxes are renamed to `free` and zero-filled. Sizes and
 * offsets stay identical, so sample tables that point into `mdat` remain valid.
 */
export function stripMp4Metadata(input: Buffer) {
  const buf = Buffer.from(input);
  const blank = (box: Box) => {
    buf.write('free', box.start + 4, 'latin1');
    buf.fill(0, box.payload, box.end);
  };
  const walk = (start: number, end: number, depth: number) => {
    for (const box of children(buf, start, end)) {
      if (METADATA.has(box.type)) blank(box);
      else if (depth < 8 && CONTAINERS.has(box.type)) walk(box.payload, box.end, depth + 1);
    }
  };
  walk(0, buf.length, 0);
  return buf;
}
