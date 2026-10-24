import { NextResponse } from 'next/server';
import { ClipLibraryService, getClipLibraryStatus, readClipArchiveHealth } from '@/services/storage/ClipLibraryService.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET() {
  const status = getClipLibraryStatus();
  if (!status.configured) return NextResponse.json({ ...status, clips: [] }, { headers: { 'Cache-Control': 'no-store' } });
  try { return NextResponse.json({ ...status, ...await new ClipLibraryService().list(), ...await readClipArchiveHealth() }, { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return NextResponse.json({ error: 'No se pudo consultar el guardado en nube. Los archivos locales se conservan.' }, { status: 503 }); }
}
