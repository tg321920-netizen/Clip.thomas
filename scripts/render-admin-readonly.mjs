import {auditRenderReadOnly} from '../services/deployment/RenderReadOnlyAudit.mjs';
const result=await auditRenderReadOnly();
console.log(JSON.stringify(result,null,2));
if(result.status!=='READ_ONLY_DIAGNOSIS_COMPLETED')process.exitCode=2;
