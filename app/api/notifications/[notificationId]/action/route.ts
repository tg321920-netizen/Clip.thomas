import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { InternalNotificationService } from "@/services/notifications/InternalNotificationService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const notifications = new InternalNotificationService();
type RouteContext = { params: Promise<{ notificationId: string }> };

export async function POST(request: Request, context: RouteContext) {
  const { notificationId } = await context.params;
  if (!isProjectId(notificationId)) {
    return NextResponse.json({ error: "notificationId inválido." }, { status: 400 });
  }

  const body = await safeJson(request);
  const action = typeof body.action === "string" ? body.action.trim().toLowerCase() : "";

  try {
    const notification = action === "read"
      ? await notifications.markRead(notificationId)
      : action === "unread"
        ? await notifications.markUnread(notificationId)
        : null;
    if (!notification) {
      return NextResponse.json(
        { error: "Acción inválida. Usa read o unread." },
        { status: 400 },
      );
    }
    return NextResponse.json({ notification });
  } catch (error) {
    const message = error instanceof Error ? error.message : "No se pudo actualizar la notificación.";
    const status = /not found/i.test(message) ? 404 : 422;
    return NextResponse.json({ error: message }, { status });
  }
}

async function safeJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const value = await request.json();
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}
