import { S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { FetchHttpHandler } from '@smithy/fetch-http-handler';
import { EnvHttpProxyAgent, fetch } from 'undici';
import { Readable } from 'node:stream';
import { createHash } from 'node:crypto';

export function readR2Config(env = process.env) {
  if (env.CLIPFORGE_MEDIA_STORAGE_PROVIDER !== 'r2') return null;
  const accountId = env.CLIPFORGE_R2_ACCOUNT_ID?.trim();
  const bucket = env.CLIPFORGE_R2_BUCKET?.trim();
  const accessKeyId = env.CLIPFORGE_R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = env.CLIPFORGE_R2_SECRET_ACCESS_KEY?.trim();
  if (!accountId || !bucket || !accessKeyId || !secretAccessKey) throw storageError('STORAGE_UNCONFIGURED', 'Faltan las credenciales del almacenamiento privado.');
  if (!/^[a-f0-9]{32}$/i.test(accountId) || !/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw storageError('STORAGE_UNCONFIGURED', 'La cuenta o el nombre del bucket R2 no son válidos.');
  return { accountId, bucket, accessKeyId, secretAccessKey };
}

export function storageError(code, message) { return Object.assign(new Error(message), { code }); }

/** Only the server holds S3 credentials. Private media never needs a public bucket. */
export class R2ObjectStore {
  #client;
  #bucket;
  constructor({ config = readR2Config(), client, customFetch } = {}) {
    if (!config) throw storageError('STORAGE_UNCONFIGURED', 'El guardado en nube todavía no está activado.');
    this.#bucket = config.bucket;
    const dispatcher = customFetch ? null : new EnvHttpProxyAgent();
    const transport = customFetch || (request => fetch(request.url, { method: request.method, headers: request.headers,
      body: request.body || undefined, duplex: 'half', signal: request.signal, dispatcher, redirect: 'error' }));
    this.#client = client || new S3Client({
      region: 'auto', endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`, forcePathStyle: true,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey }, maxAttempts: 1,
      requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED',
      requestHandler: new FetchHttpHandler({ customFetch: request => {
        // Compression turns R2 JSON ETags into weak validators. Those cannot be
        // used with If-Match to protect manifests and the writer lease.
        request.headers.set('accept-encoding', 'identity');
        return transport(request);
      } }),
    });
  }
  async #send(Command, input, signal) {
    try { return await this.#client.send(new Command({ Bucket: this.#bucket, ...input }), { abortSignal: signal || AbortSignal.timeout(180000) }); }
    catch (error) {
      const status = error?.$metadata?.httpStatusCode;
      if ([GetObjectCommand, HeadObjectCommand].includes(Command) && error?.name !== 'NoSuchBucket'
        && (status === 404 || ['NoSuchKey', 'NotFound'].includes(error?.name))) return null;
      if (status === 412 || status === 409) throw storageError('STORAGE_CONFLICT', 'El archivo cambió o hay otra operación en curso. Reintenta.');
      // SDK errors may include signed URLs, headers and account information.
      throw storageError('STORAGE_UNAVAILABLE', 'No se pudo completar la operación con el almacenamiento privado. El archivo local se conserva.');
    }
  }
  async put(key, body, { length, type = 'application/octet-stream', md5, metadata, ifMatch, ifAbsent, signal } = {}) {
    if (ifMatch?.startsWith('W/')) throw storageError('STORAGE_INVALID', 'No se confirmó una versión verificable del registro. Se conservan los archivos.');
    const result = await this.#send(PutObjectCommand, { Key: key, Body: body, ContentLength: length, ContentType: type,
      ContentMD5: md5, Metadata: metadata, IfMatch: ifMatch, IfNoneMatch: ifAbsent ? '*' : undefined }, signal);
    if (!result?.ETag) throw storageError('STORAGE_UNAVAILABLE', 'El almacenamiento no confirmó la escritura.');
    return { etag: result.ETag };
  }
  async putJson(key, value, conditions = {}) {
    const bytes = Buffer.from(JSON.stringify(value));
    return this.put(key, bytes, { length: bytes.length, type: 'application/json', md5: createHash('md5').update(bytes).digest('base64'), ...conditions });
  }
  async get(key, { range, signal, ifMatch } = {}) {
    const result = await this.#send(GetObjectCommand, { Key: key, Range: range, IfMatch: ifMatch }, signal);
    if (!result) return null;
    const body = result.Body?.getReader ? Readable.fromWeb(result.Body) : result.Body;
    return { body, etag: result.ETag, size: result.ContentLength, contentRange: result.ContentRange, metadata: result.Metadata };
  }
  async getJson(key, { signal } = {}) {
    const result = await this.get(key, { signal });
    if (!result) return null;
    if (!result.etag || result.etag.startsWith('W/')) {
      result.body?.destroy?.();
      throw storageError('STORAGE_UNAVAILABLE', 'El almacenamiento no devolvió una versión verificable del registro. Se conservan los archivos.');
    }
    const chunks = []; let size = 0;
    for await (const chunk of result.body) {
      size += chunk.length;
      if (size > 2_000_000) { result.body.destroy(); throw storageError('STORAGE_INVALID', 'El registro del almacenamiento supera el tamaño permitido.'); }
      chunks.push(Buffer.from(chunk));
    }
    try { return { value: JSON.parse(Buffer.concat(chunks).toString('utf8')), etag: result.etag }; }
    catch { throw storageError('STORAGE_INVALID', 'No se pudo leer un registro del almacenamiento.'); }
  }
  async head(key, { signal } = {}) {
    const result = await this.#send(HeadObjectCommand, { Key: key }, signal);
    return result ? { size: result.ContentLength, etag: result.ETag, metadata: result.Metadata } : null;
  }
  async list(prefix = '', { signal } = {}) {
    const objects = []; let token;
    do {
      const result = await this.#send(ListObjectsV2Command, { Prefix: prefix, ContinuationToken: token, MaxKeys: 1000 }, signal);
      for (const item of result?.Contents || []) objects.push({ key: item.Key, size: item.Size, modified: item.LastModified });
      if (objects.length > 10000) throw storageError('STORAGE_LIMIT', 'Hay demasiados objetos para comprobar el cupo de forma segura.');
      token = result?.IsTruncated ? result.NextContinuationToken : undefined;
      if (result?.IsTruncated && !token) throw storageError('STORAGE_INVALID', 'El listado del almacenamiento quedó incompleto.');
    } while (token);
    return objects;
  }
  async delete(key, { signal } = {}) { await this.#send(DeleteObjectCommand, { Key: key }, signal); }
}
