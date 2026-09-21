import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "./project-id.mjs";
import { getStorageRoot } from "./storage-paths.mjs";

export async function loadProjectFile(projectId) {
  assertProjectId(projectId);
  try {
    return JSON.parse(await readFile(getProjectFilePath(projectId), "utf8"));
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") return null;
    throw error;
  }
}

export async function replaceProjectFile(projectId, project) {
  assertProjectId(projectId);
  const projectsDir = path.join(getStorageRoot(), "projects");
  await mkdir(projectsDir, { recursive: true });

  const target = getProjectFilePath(projectId);
  const temp = path.join(projectsDir, `.${projectId}.${process.pid}.${Date.now()}.tmp`);

  await writeFile(temp, JSON.stringify(project, null, 2), {
    encoding: "utf8",
    flag: "wx",
  });

  try {
    await rename(temp, target);
  } catch (error) {
    await rm(temp, { force: true }).catch(() => undefined);
    throw error;
  }
}

function getProjectFilePath(projectId) {
  return path.join(getStorageRoot(), "projects", `${projectId}.json`);
}

function assertProjectId(projectId) {
  if (!isProjectId(projectId)) throw new Error("Invalid project id.");
}

function getErrorCode(error) {
  return error instanceof Error && "code" in error ? error.code : undefined;
}
