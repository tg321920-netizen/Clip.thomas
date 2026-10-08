import path from "node:path";

export function classifyStorageDurability(root, env = process.env) {
  const normalized = path.resolve(root).replaceAll("\\", "/");
  if (normalized === "/tmp" || normalized.startsWith("/tmp/") || normalized === "/var/tmp" || normalized.startsWith("/var/tmp/") || normalized.includes("/.next/")) {
    return { persistence: "EPHEMERAL_PATH", durable: false,
      warning: "El almacenamiento es temporal: al reemplazar la instancia pueden perderse proyectos, trabajos y videos. Descarga los resultados; configura persistencia antes de atender clientes." };
  }
  // Naming a directory does not prove it is a mounted persistent volume.
  if (env.CLIPFORGE_STORAGE_DIR?.trim() && env.CLIPFORGE_STORAGE_PERSISTENT === "true") {
    return { persistence: "PERSISTENT_PATH", durable: true, warning: undefined };
  }
  return { persistence: "UNKNOWN", durable: false,
    warning: "La persistencia no está confirmada. CLIPFORGE_STORAGE_DIR por sí solo no garantiza que los archivos sobrevivan a un reemplazo de instancia." };
}
