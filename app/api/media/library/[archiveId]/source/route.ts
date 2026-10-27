import { Readable } from 'node:stream';
import { NextResponse } from 'next/server';
import { ClipLibraryService } from '@/services/storage/ClipLibraryService.mjs';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request, context: { params: Promise<{ archiveId: string }> }) {
  try {
    const { archiveId } = await context.params;
    const range = request.headers.get('range');
    const source = await new ClipLibraryService().source(archiveId, range);
    const download = new URL(request.url).searchParams.get('download') === '1';
    return new Response(Readable.toWeb(source.body) as ReadableStream, { status: source.contentRange ? 206 : 200, headers: {
      'Content-Type': source.record.mediaKind === 'AUDIO' ? 'audio/mp4' : 'video/mp4', 'Content-Length': String(source.size), 'Accept-Ranges': 'bytes', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff',
      ...(source.contentRange ? { 'Content-Range': source.contentRange } : {}),
      ...(download ? { 'Content-Disposition': `attachment; filename="clip-${source.record.clipId}.${source.record.mediaKind==='AUDIO'?'m4a':'mp4'}"` } : {}),
    } });
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : '';
    if (code === 'STORAGE_RANGE') {
      const size = error && typeof error === 'object' && 'size' in error ? error.size : 0;
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}`, 'Accept-Ranges': 'bytes' } });
    }
    return NextResponse.json({ error: code === 'STORAGE_NOT_FOUND' ? 'El clip ya no está disponible.' : 'No se pudo cargar el clip guardado. Reintenta.' }, { status: code === 'STORAGE_NOT_FOUND' ? 404 : 503 });
  }
}
