import { loadProjectFile } from "../../lib/project-files.mjs";
import { PublicationService } from "../publications/PublicationService.mjs";

export class OwnedContentDuplicateService {
  constructor(options = {}) {
    this.publications = options.publications || new PublicationService();
  }

  async check(channelId, research) {
    const publications = await this.publications.list({ channelId, status: "PUBLISHED" });
    let best = null;
    const currentTokens = tokens(research?.topic || "");

    for (const publication of publications) {
      const project = await loadProjectFile(publication.projectId);
      const previous = project?.ownedContent;
      if (!previous) continue;
      const similarity = Math.max(
        similarity(currentTokens, tokens(previous.topic || "")),
        similarity(currentTokens, tokens(previous.hook || "")),
      );
      if (!best || similarity > best.similarity) {
        best = {
          publicationId: publication.id,
          projectId: publication.projectId,
          previousTopic: previous.topic || null,
          similarity,
        };
      }
    }

    return {
      nearDuplicate: Boolean(best && best.similarity >= 0.82),
      threshold: 0.82,
      bestMatch: best,
      checkedPublished: publications.length,
    };
  }
}

function tokens(value) {
  return [...new Set(String(value || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").match(/[a-z0-9]{4,}/g) || [])].filter((item) => !STOP.has(item));
}
function similarity(a, b) {
  if (!a.length || !b.length) return 0;
  const A = new Set(a), B = new Set(b);
  let common = 0;
  for (const token of A) if (B.has(token)) common += 1;
  return common / Math.max(A.size, B.size);
}
const STOP = new Set(["news", "update", "what", "confirmed", "noticia", "actualizacion", "confirmado", "sobre"]);
