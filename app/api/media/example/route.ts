import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "@/lib/storage-paths.mjs";
export const runtime = "nodejs";
export async function POST() {
  const directory = path.join(getStorageRoot(), "story-assets"); await mkdir(directory, { recursive: true });
  const images = [];
  for (let i=1;i<=6;i++) { const name = `${randomUUID()}.jpg`; await copyFile(path.join(process.cwd(),"tests","fixtures","maya-story",`scene-${i}.jpg`),path.join(directory,name)); images.push(`story-assets/${name}`); }
  return NextResponse.json({images, provenance:"Original images created for ClipForge's fictional Maya story acceptance example."});
}
