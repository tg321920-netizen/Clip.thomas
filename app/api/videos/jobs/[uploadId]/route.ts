import { NextResponse } from "next/server";
import { IngestJobStore } from "@/services/ingest/IngestJobStore.mjs";
export const runtime = "nodejs";
export async function POST(_request:Request,context:{params:Promise<{uploadId:string}>}) {
  try { const {uploadId}=await context.params;const store=new IngestJobStore();const job=await store.get(uploadId);
    if(job?.type!=="INGEST_UPLOAD"||job.status!=="FAILED")return NextResponse.json({error:"No hay una subida fallida para reintentar."},{status:409});
    return NextResponse.json({job:await store.retry(uploadId)},{status:202});
  }catch{return NextResponse.json({error:"No se pudo reintentar el análisis."},{status:400});}
}
