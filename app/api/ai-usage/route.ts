import { NextResponse } from "next/server";
import { AIUsageService } from "@/services/usage/AIUsageService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const usage = new AIUsageService();

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const filters = {
      ...(searchParams.get("projectId")
        ? { projectId: searchParams.get("projectId") }
        : {}),
      ...(searchParams.get("provider")
        ? { provider: searchParams.get("provider") }
        : {}),
      ...(searchParams.get("model")
        ? { model: searchParams.get("model") }
        : {}),
      ...(searchParams.get("operation")
        ? { operation: searchParams.get("operation") }
        : {}),
    };

    if (searchParams.get("summary") === "1") {
      return NextResponse.json({ summary: await usage.summarize(filters) });
    }

    return NextResponse.json({ usage: await usage.list(filters) });
  } catch (error) {
    return errorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const record = await usage.record(body);
    return NextResponse.json({ usage: record }, { status: 201 });
  } catch (error) {
    return errorResponse(error);
  }
}

function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "AI usage request failed.";
  return NextResponse.json({ error: message }, { status: 400 });
}
