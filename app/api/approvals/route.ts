import { NextResponse } from "next/server";
import { isProjectId } from "@/lib/project-id.mjs";
import { ApprovalService } from "@/services/approvals/ApprovalService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const approvals = new ApprovalService();

export async function GET(request: Request) {
  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId");
  const status = url.searchParams.get("status");
  const subjectType = url.searchParams.get("subjectType");
  const subjectId = url.searchParams.get("subjectId");

  for (const [label, value] of [
    ["projectId", projectId],
    ["subjectId", subjectId],
  ] as const) {
    if (value && !isProjectId(value)) {
      return NextResponse.json({ error: `${label} inválido.` }, { status: 400 });
    }
  }

  try {
    const records = await approvals.list({
      ...(projectId ? { projectId } : {}),
      ...(status ? { status } : {}),
      ...(subjectType ? { subjectType } : {}),
      ...(subjectId ? { subjectId } : {}),
    });
    return NextResponse.json(
      { approvals: records },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return approvalError(error);
  }
}

export async function POST(request: Request) {
  const body = await safeJson(request);
  try {
    const result = body.contentGenerationId
      ? await approvals.requestForContentGeneration(String(body.contentGenerationId), {
          title: body.title,
          message: body.message,
          details: body.details,
        })
      : await approvals.request({
          projectId: body.projectId,
          subjectType: body.subjectType,
          subjectId: body.subjectId,
          title: body.title,
          message: body.message,
          details: body.details,
        });
    return NextResponse.json(result, { status: result.reused ? 200 : 201 });
  } catch (error) {
    return approvalError(error);
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

function approvalError(error: unknown) {
  const message = error instanceof Error ? error.message : "No se pudo procesar la aprobación.";
  const status = /not found/i.test(message) ? 404 : 422;
  return NextResponse.json({ error: message }, { status });
}
