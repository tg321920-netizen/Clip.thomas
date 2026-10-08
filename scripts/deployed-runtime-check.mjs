import { mkdir,writeFile } from "node:fs/promises";
const url="https://clipforge-runtime-free.onrender.com/api/health";let evidence;
try{const response=await fetch(url,{signal:AbortSignal.timeout(45000)});const body=await response.json();evidence={checkedAt:new Date().toISOString(),url,status:response.status,health:body,repairDeployed:body.publishing==="OFF"&&Boolean(body.version),authenticatedUploadTest:"NOT_RUN_WITHOUT_OWNER_SESSION",physicalAndroid:"NOT_VERIFIED"};}
catch(error){evidence={checkedAt:new Date().toISOString(),url,reachable:false,error:error.message,repairDeployed:false,authenticatedUploadTest:"NOT_RUN_WITHOUT_OWNER_SESSION",physicalAndroid:"NOT_VERIFIED"};}
await mkdir("artifacts/deployed-runtime",{recursive:true});await writeFile("artifacts/deployed-runtime/evidence.json",JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence,null,2));
