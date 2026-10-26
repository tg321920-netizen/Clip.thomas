import path from 'node:path';
import {ProjectRecoveryService} from '../services/storage/ProjectRecoveryService.mjs';
const args=process.argv.slice(2),id=args.find(a=>a.startsWith('--project='))?.slice(10),target=args.find(a=>a.startsWith('--target='))?.slice(9);
if(!id||!target||!args.includes('--workers-paused'))throw new Error('Uso: --project=UUID --target=directorio-nuevo --workers-paused. No se arrancan workers.');
const result=await new ProjectRecoveryService().restore(id,{targetRoot:path.resolve(target)});
console.log(JSON.stringify(result));
