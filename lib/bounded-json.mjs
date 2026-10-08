export async function readBoundedJson(request, maximum = 24000) {
  if (!request.body) throw new Error("La solicitud está vacía.");
  const declared = Number(request.headers.get("content-length"));
  if (declared > maximum) throw new Error("La solicitud es demasiado grande.");
  const chunks = []; let bytes = 0;
  for await (const chunk of request.body) { bytes += chunk.byteLength; if (bytes > maximum) throw new Error("La solicitud es demasiado grande."); chunks.push(Buffer.from(chunk)); }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
