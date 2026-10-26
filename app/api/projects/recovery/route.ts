import {NextResponse} from 'next/server';
import {projectRecoveryEnabled,ProjectRecoveryService,readProjectRecoveryRequests,requestProjectRecovery} from '@/services/storage/ProjectRecoveryService.mjs';
import {readBoundedJson} from '@/lib/bounded-json.mjs';

export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){
  try{
    if(!projectRecoveryEnabled())return NextResponse.json({enabled:false,projects:[],requests:[]});
    const [projects,requests]=await Promise.all([new ProjectRecoveryService().list(),readProjectRecoveryRequests()]);
    return NextResponse.json({enabled:true,projects,requests},{headers:{'Cache-Control':'no-store'}});
  }catch{return NextResponse.json({error:'No se pudo consultar el respaldo privado. Los archivos locales se conservan.'},{status:503});}
}
export async function POST(request:Request){
  try{
    if(!projectRecoveryEnabled())return NextResponse.json({error:'El respaldo de proyectos todavía no está habilitado en este servidor.'},{status:409});
    const body=await readBoundedJson(request,2048);
    return NextResponse.json({request:await requestProjectRecovery(body.projectId,body.action)},{status:202});
  }catch{return NextResponse.json({error:'No se pudo solicitar la recuperación. Comprueba el proyecto e inténtalo de nuevo.'},{status:422});}
}
