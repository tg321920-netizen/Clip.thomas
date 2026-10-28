import {EnvHttpProxyAgent,fetch} from 'undici';
const names=new Set(['clipforge-studio-trial','clipforge-runtime-free','clipforge-development-preview']);
const safeString=value=>typeof value==='string'?value.slice(0,200):null;
const list=value=>Array.isArray(value)?value:[];
/** Operator-only diagnosis. No imports from web/runtime, service mutation,
 * deployment, redirect, credential logging or transfer of the admin key. */
export async function auditRenderReadOnly({env=process.env,request,now=()=>new Date().toISOString()}={}){
  if(!env.RENDER_API_KEY?.trim())return {checkedAt:now(),status:'BLOCKED_MISSING_PRIVATE_BINDING',administrativeRequests:0,mutations:0};
  const dispatcher=request?undefined:new EnvHttpProxyAgent();let count=0;
  const get=async endpoint=>{
    count++;const response=await(request||fetch)(`https://api.render.com/v1/${endpoint}`,{
      method:'GET',headers:{Authorization:`Bearer ${env.RENDER_API_KEY.trim()}`,Accept:'application/json'},
      redirect:'error',signal:AbortSignal.timeout(15000),...(dispatcher?{dispatcher}:{})});
    if(!response.ok){await response.body?.cancel().catch(()=>{});throw Object.assign(new Error('RENDER_ADMIN_GET_FAILED'),{httpStatus:response.status});}
    const parts=[];let bytes=0;
    for await(const chunk of response.body){bytes+=chunk.byteLength;if(bytes>4_000_000)throw new Error('RENDER_ADMIN_RESPONSE_LIMIT');parts.push(chunk);}
    return JSON.parse(Buffer.concat(parts).toString('utf8'));
  };
  const result={checkedAt:now(),status:'NOT_TESTED',administrativeRequests:0,mutations:0,workspaces:[],services:[]};
  try{
    result.workspaces=list(await get('owners?limit=100')).map(item=>item.owner||item)
      .map(item=>({id:safeString(item.id),name:safeString(item.name),type:safeString(item.type)}));
    const services=list(await get('services?limit=100')).map(item=>item.service||item);
    result.serviceListingMayBeTruncated=services.length===100;
    for(const service of services){
      const details=service.serviceDetails||{};
      const row={id:safeString(service.id),name:safeString(service.name),ownerId:safeString(service.ownerId),
        type:safeString(service.type),suspended:safeString(service.suspended),branch:safeString(service.branch),
        autoDeploy:safeString(service.autoDeploy),runtime:safeString(details.runtime||details.env),plan:safeString(details.plan),
        region:safeString(details.region),lastDeploy:null,environmentVariableNames:[]};
      if(names.has(service.name)&&/^srv-[a-z0-9]+$/u.test(service.id)){
        const deploy=list(await get(`services/${service.id}/deploys?limit=1`))[0];const value=deploy?.deploy||deploy;
        if(value)row.lastDeploy={status:safeString(value.status),commit:safeString(value.commit?.id),finishedAt:safeString(value.finishedAt)};
        // Values are never returned, logged or written to a report.
        row.environmentVariableNames=list(await get(`services/${service.id}/env-vars?limit=100`))
          .map(item=>safeString((item.envVar||item).key)).filter(Boolean);
      }
      result.services.push(row);
    }
    result.status='READ_ONLY_DIAGNOSIS_COMPLETED';
    result.accountPlanLimits='NOT_INFERRED_FROM_SERVICE_PLAN';
    result.deploymentApproval='REQUIRED_SEPARATELY';
  }catch(error){result.status='ADMINISTRATIVE_DIAGNOSIS_FAILED';result.httpStatus=error.httpStatus||null;
    result.diagnostic=error.httpStatus===401?'La conexión privada fue rechazada; no se reintentó ni se buscaron otras credenciales.':
      error.httpStatus===403?'La conexión no permite esta consulta; no se infieren permisos de escritura.':'La consulta no terminó correctamente; se omitieron cuerpos y detalles privados.';
  }finally{result.administrativeRequests=count;await dispatcher?.close();}
  return result;
}
