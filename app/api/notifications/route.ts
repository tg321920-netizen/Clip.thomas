import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { InternalNotificationService } from "@/services/notifications/InternalNotificationService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notifications = new InternalNotificationService();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const type = url.searchParams.get("type");
  const unreadParam = url.searchParams.get("unread");

  if (projectId && !isProjectId(projectId)) {
    return NextResponse.json({ error: "projectId inválido." }, { status: 400 });
  }
  if (unreadParam !== null && !new Set(["true", "false"]).has(unreadParam)) {
    return NextResponse.json({ error: "unread debe ser true o false." }, { status: 400 });
  }

  try {
    const records = await notifications.list({
      ...(projectId ? { projectId } : {}),
      ...(type ? { type: type.toUpperCase() } : {}),
      ...(unreadParam === "true" ? { unread: true } : {}),
    });
    return NextResponse.json(
      { notifications: records },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudieron cargar las notificaciones.";
    return NextResponse.json({ error: message }, { status: 422 });
  }
}
