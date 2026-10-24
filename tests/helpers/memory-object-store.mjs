import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';
export class MemoryObjectStore {
  objects = new Map(); deletes = []; uploads = 0; sequence = 0;
  async put(key, body, options = {}) {
    if (this.failPut?.(key)) throw new Error('fixture storage outage');
    const previous = this.objects.get(key);
    if ((options.ifAbsent && previous) || (options.ifMatch && previous?.etag !== options.ifMatch)) throw Object.assign(new Error('conflict'), { code: 'STORAGE_CONFLICT' });
    const chunks = [];
    if (Buffer.isBuffer(body)) chunks.push(body); else for await (const chunk of body) chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    if (options.md5 && options.md5 !== createHash('md5').update(bytes).digest('base64')) throw new Error('checksum mismatch');
    const value = { body: bytes, size: bytes.length, etag: `"version-${++this.sequence}"`, metadata: options.metadata || {} };
    this.objects.set(key, value);
    if (key.endsWith('.mp4')) this.uploads++;
    return { etag: value.etag };
  }
  async putJson(key, value, options = {}) { return this.put(key, Buffer.from(JSON.stringify(value)), options); }
  async get(key, { range, ifMatch } = {}) {
    const value = this.objects.get(key); if (!value) return null;
    if (ifMatch && value.etag !== ifMatch) throw Object.assign(new Error('conflict'), { code: 'STORAGE_CONFLICT' });
    let bytes = value.body, contentRange;
    if (range) { const [start, end] = range.slice(6).split('-').map(Number); bytes = bytes.subarray(start, end + 1); contentRange = `bytes ${start}-${end}/${value.size}`; }
    return { body: Readable.from([bytes]), size: bytes.length, etag: value.etag, metadata: value.metadata, contentRange };
  }
  async getJson(key) { const value = this.objects.get(key); return value ? { value: JSON.parse(value.body), etag: value.etag } : null; }
  async head(key) { const value = this.objects.get(key); return value ? { size: value.size, etag: value.etag, metadata: value.metadata } : null; }
  async list(prefix = '') { return [...this.objects].filter(([key]) => key.startsWith(prefix)).map(([key, value]) => ({ key, size: value.size })); }
  async delete(key) { if (this.failDelete) throw new Error('fixture delete outage'); this.deletes.push(key); this.objects.delete(key); }
}
