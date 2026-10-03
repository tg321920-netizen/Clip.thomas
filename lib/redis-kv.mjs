import net from "node:net";
import tls from "node:tls";

export function createRedisKvFromEnv(env = process.env) {
  const value = String(
    env.CLIPFORGE_REDIS_URL ||
    env.REDIS_URL ||
    "",
  ).trim();
  if (!value) return null;
  return new RedisKvStore(value);
}

export class RedisKvStore {
  constructor(connectionUrl) {
    const parsed = new URL(connectionUrl);
    if (!["redis:", "rediss:"].includes(parsed.protocol)) {
      throw new Error("Redis URL must use redis:// or rediss://.");
    }
    this.url = parsed;
  }

  async get(key) {
    return runCommand(this.url, ["GET", key]);
  }

  async set(key, value) {
    const result = await runCommand(this.url, ["SET", key, value]);
    if (result !== "OK") {
      throw new Error("Redis SET did not return OK.");
    }
    return true;
  }

  async delete(key) {
    return Number(await runCommand(this.url, ["DEL", key])) > 0;
  }
}

async function runCommand(url, command) {
  const socket = await connect(url);
  try {
    if (url.password) {
      const auth = url.username
        ? ["AUTH", decodeURIComponent(url.username), decodeURIComponent(url.password)]
        : ["AUTH", decodeURIComponent(url.password)];
      socket.write(encodeCommand(auth));
      const authResult = await readResponse(socket);
      if (authResult !== "OK") throw new Error("Redis authentication failed.");
    }

    const database = Number(url.pathname?.replace(/^\//, "") || 0);
    if (Number.isInteger(database) && database > 0) {
      socket.write(encodeCommand(["SELECT", String(database)]));
      const selected = await readResponse(socket);
      if (selected !== "OK") throw new Error("Redis database selection failed.");
    }

    socket.write(encodeCommand(command));
    return await readResponse(socket);
  } finally {
    socket.end();
    socket.destroy();
  }
}

function connect(url) {
  const port = Number(url.port || 6379);
  const host = url.hostname;
  const options = { host, port };

  return new Promise((resolve, reject) => {
    const socket =
      url.protocol === "rediss:"
        ? tls.connect({ ...options, servername: host })
        : net.createConnection(options);

    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error("Redis connection timed out."));
    }, 5000);
    timer.unref?.();

    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function encodeCommand(parts) {
  const chunks = [`*${parts.length}\r\n`];
  for (const part of parts) {
    const value = String(part);
    const length = Buffer.byteLength(value);
    chunks.push(`$${length}\r\n${value}\r\n`);
  }
  return chunks.join("");
}

function readResponse(socket) {
  return new Promise((resolve, reject) => {
    let buffer = Buffer.alloc(0);

    function cleanup() {
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("close", onClose);
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    function onClose() {
      cleanup();
      reject(new Error("Redis connection closed before a response was received."));
    }

    function onData(chunk) {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const parsed = parseResp(buffer);
        if (!parsed.complete) return;
        cleanup();
        if (parsed.error) reject(parsed.error);
        else resolve(parsed.value);
      } catch (error) {
        cleanup();
        reject(error);
      }
    }

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

function parseResp(buffer) {
  if (!buffer.length) return { complete: false };
  const prefix = String.fromCharCode(buffer[0]);
  const lineEnd = buffer.indexOf("\r\n");
  if (lineEnd < 0) return { complete: false };

  const line = buffer.subarray(1, lineEnd).toString("utf8");

  if (prefix === "+") return { complete: true, value: line };
  if (prefix === "-") return { complete: true, error: new Error(`Redis error: ${line}`) };
  if (prefix === ":") return { complete: true, value: Number(line) };

  if (prefix === "$") {
    const length = Number(line);
    if (length === -1) return { complete: true, value: null };
    if (!Number.isInteger(length) || length < 0) {
      throw new Error("Invalid Redis bulk response.");
    }
    const start = lineEnd + 2;
    const end = start + length;
    if (buffer.length < end + 2) return { complete: false };
    return {
      complete: true,
      value: buffer.subarray(start, end).toString("utf8"),
    };
  }

  throw new Error("Unsupported Redis response type.");
}
