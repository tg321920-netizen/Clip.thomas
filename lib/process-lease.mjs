import { readFileSync } from "node:fs";
import os from "node:os";
const host = os.hostname();
export function processKey(pid = process.pid) {
  try { const fields=readFileSync(`/proc/${pid}/stat`,"utf8").split(") ").at(-1).split(" ");return `${host}:${readFileSync("/proc/sys/kernel/random/boot_id","utf8").trim()}:${fields[19]}`; }
  catch { return `${host}:${pid}`; }
}
export function leaseOwner() { return {pid:process.pid,key:processKey(),at:new Date().toISOString()}; }
export function ownerIsAlive(owner) {
  if(!Number.isSafeInteger(owner?.pid)||owner.pid<=0)return false;
  try{process.kill(owner.pid,0);return !owner.key||owner.key===processKey(owner.pid);}catch(error){return error.code!=="ESRCH";}
}
