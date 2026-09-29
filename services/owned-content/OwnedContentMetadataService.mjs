import { loadProjectFile, replaceProjectFile } from "../../lib/project-files.mjs";

export async function enrichOwnedContentProject(projectId, metadata = {}) {
  const project = await loadProjectFile(projectId);
  if (!project) throw new Error("Owned-content project not found after render.");
  project.ownedContent = {
    ...(project.ownedContent || {}),
    topic: clean(metadata.topic, 240) || project.ownedContent?.topic || null,
    category: clean(metadata.category, 100) || project.ownedContent?.category || null,
    hook: clean(metadata.hook, 240) || project.ownedContent?.hook || null,
    format: clean(metadata.format, 40) || project.ownedContent?.format || null,
    language: clean(metadata.language, 40) || project.ownedContent?.language || null,
    voiceProfile: clean(metadata.voiceProfile, 80) || project.ownedContent?.voiceProfile || null,
    editStyle: clean(metadata.editStyle, 80) || project.ownedContent?.editStyle || null,
    trendId: clean(metadata.trendId, 80) || project.ownedContent?.trendId || null,
    topicFingerprint: clean(metadata.topicFingerprint, 128) || project.ownedContent?.topicFingerprint || null,
    updatedAt: new Date().toISOString(),
  };
  await replaceProjectFile(projectId, project);
  return project;
}

function clean(value, maxLength) {
  return String(value || "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}
