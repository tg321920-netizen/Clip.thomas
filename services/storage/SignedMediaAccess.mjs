import { createHash,createHmac } from "node:crypto";
import { SignatureV4 } from "@smithy/signature-v4";
import { readR2Config } from "./R2ObjectStore.mjs";
class Sha256{constructor(key){this.hash=key===undefined?createHash("sha256"):createHmac("sha256",key);}update(bytes){this.hash.update(bytes);}async digest(){return this.hash.digest();}}
/** Temporary bearer links are returned only to the authenticated owner, never
 * persisted in manifests, logs or Git. Renewing one does not render a video. */
export async function signPrivateClip(id,{env=process.env,expiresIn=900,now=Date.now}={}){
  if(!/^[a-f0-9]{64}$/u.test(id))throw new Error("Clip no válido.");
  const config=readR2Config(env);if(!config)throw new Error("R2 no está configurado.");
  const seconds=Math.max(60,Math.min(21600,Math.round(Number(expiresIn)||900))),hostname=`${config.accountId}.r2.cloudflarestorage.com`;
  const signer=new SignatureV4({service:"s3",region:"auto",sha256:Sha256,credentials:{accessKeyId:config.accessKeyId,secretAccessKey:config.secretAccessKey}});
  const signed=await signer.presign({method:"GET",protocol:"https:",hostname,path:`/${config.bucket}/clipforge-managed/v1/media/${id}.mp4`,headers:{host:hostname,"x-amz-content-sha256":"UNSIGNED-PAYLOAD"},query:{"response-content-disposition":`attachment; filename="clip-${id.slice(0,12)}.mp4"`}},{expiresIn:seconds,signingDate:new Date(now())});
  const url=new URL(`https://${hostname}${signed.path}`);for(const[k,v]of Object.entries(signed.query))for(const item of Array.isArray(v)?v:[v])url.searchParams.append(k,item);
  return{url:url.toString(),expiresAt:new Date(now()+seconds*1000).toISOString(),expiresInSeconds:seconds};
}
