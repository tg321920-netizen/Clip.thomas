import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { isProjectId } from "./project-id.mjs";
import { getStorageRoot } from "./storage-paths.mjs";
import { withLocalStateLock } from "./atomic-local-state.mjs";

/** Merge one service's update with the latest project, after acquiring the
 * single-host lock. Long transcriptions and encodes must stay outside it. */
export async function updateProjectFile(projectId, mutate) {
  assertProjectId(projectId);
  return withLocalStateLock(getProjectFilePath(projectId), async () => {
    const project = await loadProjectFile(projectId);
    if (!project) throw new Error('Project not found.');
    const result = await mutate(project);
    await replaceProjectFile(projectId, project);
    return result;
  });
}

export async function loadProjectFile(projectId) {
  assertProjectId(projectId);
  try {
    return JSON.parse(await readFile(getProjectFilePath(projectId), "utf8"));
  } catch (error) {
    if (getErrorCode(error) === "ENOENT") return null;
    throw error;
  }
}

export async function listProjectFiles(limit = 100, {mapProject = project => project} = {}) {
  const projectsDir = path.join(getStorageRoot(), "projects");
  await mkdir(projectsDir, { recursive: true });

  const entries = await readdir(projectsDir, { withFileTypes: true });
  const projectIds = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => entry.name.slice(0, -5))
    .filter((projectId) => isProjectId(projectId));

  const records = [];
  for(let offset=0;offset<projectIds.length;offset+=2){
    const batch=await Promise.all(projectIds.slice(offset,offset+2).map(async (projectId) => {
      try {
        const project=await loadProjectFile(projectId);return project ? mapProject(project) : null;
      } catch {
        return null;
      }
    }));
    records.push(...batch);
  }

  return records
    .filter(Boolean)
    .sort((a, b) => Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0))
    .slice(0, Math.max(1, Math.min(Number(limit) || 100, 1000)));
}

export async function replaceProjectFile(projectId, project) {
  assertProjectId(projectId);
  const projectsDir = path.join(getStorageRoot(), "projects");
  await mkdir(projectsDir, { recursive: true });

  const target = getProjectFilePath(projectId);
  const temp = path.join(
    projectsDir,
    `.${projectId}.${process.pid}.${Date.now()}.tmp`,
  );

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
