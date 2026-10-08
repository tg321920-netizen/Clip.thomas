/** Write every byte, including when the OS completes only part of a write. */
export async function writeAll(handle, buffer) {
  let offset = 0;
  while (offset < buffer.byteLength) {
    const { bytesWritten } = await handle.write(buffer.subarray(offset));
    if (!Number.isInteger(bytesWritten) || bytesWritten <= 0) {
      throw new Error("El almacenamiento no pudo completar la escritura.");
    }
    offset += bytesWritten;
  }
  return offset;
}
