import { NextRequest, NextResponse } from "next/server";
import { BrandService } from "@/services/branding/BrandService.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Context = { params: Promise<{ brandId: string }> };

export async function GET(_request: NextRequest, context: Context) {
  try {
    const { brandId } = await context.params;
    const brand = await new BrandService().get(brandId);
    if (!brand) return NextResponse.json({ error: "Brand not found." }, { status: 404 });
    return NextResponse.json({ brand });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}

export async function PATCH(request: NextRequest, context: Context) {
  try {
    const { brandId } = await context.params;
    const body = await request.json();
    const brand = await new BrandService().update(brandId, body);
    return NextResponse.json({ brand });
  } catch (error) {
    return NextResponse.json({ error: message(error) }, { status: 400 });
  }
}

function message(error: unknown) { return error instanceof Error ? error.message : String(error); }
