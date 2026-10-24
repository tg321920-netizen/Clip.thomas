import { NextResponse } from 'next/server';
import { readBoundedJson } from '@/lib/bounded-json.mjs';
import { ClipLibraryService } from '@/services/storage/ClipLibraryService.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function POST(request: Request, context: { params: Promise<{ archiveId: string }> }) {
  try {
    const { archiveId } = await context.params;
    const input = await readBoundedJson(request);
    if (typeof input.keep !== 'boolean') return NextResponse.json({ error: 'Indica si deseas conservar el clip.' }, { status: 400 });
    return NextResponse.json({ clip: await new ClipLibraryService().setKeep(archiveId, input.keep) });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    return NextResponse.json({ error: code === 'STORAGE_NOT_FOUND' ? 'El clip ya no está disponible.' : 'No se pudo cambiar la conservación. Reintenta; el cambio no quedó confirmado.' }, { status: code === 'STORAGE_NOT_FOUND' ? 404 : ['STORAGE_BUSY', 'STORAGE_CONFLICT'].includes(String(code)) ? 409 : 503 });
  }
}
