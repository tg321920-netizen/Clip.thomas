import { readdir,rm } from "node:fs/promises";
import path from "node:path";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { isProjectId } from "../../lib/project-id.mjs";
export async function cleanupCompletedMedia(job) {
  if(job.status!=="READY"||!isProjectId(job.projectId))return;
  const kind=job.type==="MEDIA_STORY"?"stories":job.type==="MEDIA_EDIT"?"auto-videos":null;if(!kind)return;
  const directory=path.join(getStorageRoot(),kind,job.projectId);
  const allowed=kind==="stories"?/^(?:(?:voice-\d+\.wav|scene-\d+\.mp4)(?:\.cache\.json)?|joined-\d+\.mp4|narration\.wav|audio\.txt|render\.partial\.mp4)$/:/^(?:part-\d+\.mp4|concat\.txt)$/;
  for(const name of await readdir(directory).catch(()=>[]))if(allowed.test(name))await rm(path.join(directory,name),{force:true});
}
