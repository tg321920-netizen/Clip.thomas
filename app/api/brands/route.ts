import { NextRequest, NextResponse } from "next/server";
import { BrandService } from "@/services/branding/BrandService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const projectId = request.nextUrl.searchParams.get("projectId") || undefined;
    const records = await new BrandService().list({ projectId });
    return NextResponse.json({ brands: records });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const brand = await new BrandService().create(body);
    return NextResponse.json({ brand }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
