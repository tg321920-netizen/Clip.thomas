import { NextResponse } from "next/server";
import { retitlePublishedPodcastSmoke } from "@/services/publishing/PublishOncePodcastService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const result = await retitlePublishedPodcastSmoke();
    return NextResponse.redirect(result.url, 303);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "No se pudo actualizar el video." },
      { status: 500 },
    );
  }
}
