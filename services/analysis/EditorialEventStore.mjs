import path from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { getStorageRoot } from "../../lib/storage-paths.mjs";
import { withLocalStateLock, writeAtomicJson } from "../../lib/atomic-local-state.mjs";
import { leaseOwner, ownerIsAlive } from "../../lib/process-lease.mjs";

function tokens(text) { return [...new Set(String(text || "").normalize("NFKD").toLowerCase().replace(/\p{M}/gu,"").match(/[\p{L}\p{N}]{3,}/gu)||[])].map(t=>createHash("sha256").update(t).digest("hex")); }
function similarity(a,b) { const union=new Set([...a,...b]); return union.size ? a.filter(x=>b.includes(x)).length/union.size : 0; }
/** Cross-window event ownership. Only numeric times and token hashes persist.
 * No chat text, participant IDs, provider response or signed URL is stored. */
export class EditorialEventStore {
  constructor({root=getStorageRoot(),now=Date.now}={}) { this.root=root;this.now=now; }
  file(source) { if(!source?.sourceId || !source.channelId)return null; const key=createHash("sha256").update(`${source.channelId}/${source.sourceId}`).digest("hex");return path.join(this.root,"editorial-events",`${key}.json`); }
  async mutate(source, action) {
    const file=this.file(source);if(!file)return action([]);
    return withLocalStateLock(file,async()=>{let rows;try{rows=JSON.parse(await readFile(file,"utf8"));if(!Array.isArray(rows)||rows.length>2000)throw new Error("invalid");}catch(e){if(e.code!=="ENOENT")throw new Error("No se pudo recuperar la deduplicación editorial.");rows=[];}
      const result=await action(rows);if(rows.length>2000)throw new Error("El registro editorial alcanzó su límite; conserva los datos antes de continuar.");await writeAtomicJson(file,rows);return result;});
  }
  async reserve(source, candidate, owner) {
    return this.mutate(source, rows=>{
      const peak=Date.parse(candidate.chatEvidence?.peakUtc), hashes=tokens(candidate.text);
      const existing=rows.find(r=>r.owner===owner && r.candidateId===candidate.id);if(existing)return true;
      const duplicate=rows.some(r=>{
        if(r.status==="RESERVED" && !ownerIsAlive(r.lease) && this.now()-r.at>120000)return false;
        const close=Number.isFinite(peak)&&Number.isFinite(r.peak)&&Math.abs(peak-r.peak)<30000;
        const sameText=hashes.length>=8 && r.tokens.length>=8 && similarity(hashes,r.tokens)>=0.8 && (!Number.isFinite(peak)||!Number.isFinite(r.peak)||Math.abs(peak-r.peak)<120000);
        const visualMatch=/^[a-f0-9]{16}$/.test(candidate.visualFingerprint||'')&&/^[a-f0-9]{16}$/.test(r.visualFingerprint||'')&&
          (BigInt('0x'+candidate.visualFingerprint)^BigInt('0x'+r.visualFingerprint)).toString(2).replaceAll('0','').length<=4;
        const sameVisualContext=visualMatch&&hashes.length>=8&&similarity(hashes,r.tokens)>=0.55&&Number.isFinite(peak)&&Number.isFinite(r.peak)&&Math.abs(peak-r.peak)<120000;
        return close||sameText||sameVisualContext;
      });
      if(duplicate)return false;
      rows.push({owner,candidateId:candidate.id,peak:Number.isFinite(peak)?peak:null,tokens:hashes,visualFingerprint:candidate.visualFingerprint||null,status:"RESERVED",lease:leaseOwner(),at:this.now()});return true;
    });
  }
  async confirm(source,candidateId,owner) { return this.mutate(source,rows=>{const row=rows.find(r=>r.owner===owner&&r.candidateId===candidateId);if(row)row.status="RENDERED";}); }
  async release(source,owner) { return this.mutate(source,rows=>{for(let i=rows.length-1;i>=0;i--)if(rows[i].owner===owner&&rows[i].status==="RESERVED")rows.splice(i,1);}); }
}
