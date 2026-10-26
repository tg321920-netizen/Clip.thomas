import {NextResponse} from 'next/server';
import {liveStatus} from '@/services/live/LiveStatusService.mjs';
import {LiveMonitorService} from '@/services/live/LiveMonitorService.mjs';
import {IngestJobStore} from '@/services/ingest/IngestJobStore.mjs';
import {readBoundedJson} from '@/lib/bounded-json.mjs';
export const runtime='nodejs';
export const dynamic='force-dynamic';
export async function GET(){try{return NextResponse.json(await liveStatus(),{headers:{'Cache-Control':'no-store'}});}catch{return NextResponse.json({error:'No se pudo consultar la captura; revisa el estado de los workers.'},{status:503});}}

export async function POST(request:Request){
  try{
    const input=await readBoundedJson(request,1000);if(input.action!=='STOP')return NextResponse.json({error:'Acción no soportada.'},{status:400});
    const monitor=new LiveMonitorService(),state=await monitor.read();await monitor.pause();
    if(state.activeJobId)await new IngestJobStore().cancel(state.activeJobId);
    return NextResponse.json({status:'OWNER_PAUSED',publishing:'OFF'});
  }catch{return NextResponse.json({error:'No se confirmó la detención. Revisa el estado del monitor.'},{status:409});}
}
