import { NextResponse } from 'next/server';
import { ClipLibraryService } from '@/services/storage/ClipLibraryService.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
// Owner authentication is enforced by the application proxy on hosted runtimes.
export async function POST(_request:Request,context:{params:Promise<{archiveId:string}>}){
  try { const {archiveId}=await context.params;return NextResponse.json(await new ClipLibraryService().temporaryAccess(archiveId),{headers:{'Cache-Control':'no-store'}}); }
  catch { return NextResponse.json({error:'No se pudo renovar el acceso privado. El MP4 no se vuelve a renderizar.'},{status:503}); }
}
