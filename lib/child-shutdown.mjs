/** ChildProcess.killed only means a signal was sent; it does not mean the child
 * exited. Supervisors must still escalate a worker that ignored SIGTERM. */
export const childIsRunning = child => child && child.exitCode === null && child.signalCode === null;

function waitBounded(promise, ms) {
  return new Promise(resolve=>{const timer=setTimeout(resolve,ms);promise.then(()=>{clearTimeout(timer);resolve();});});
}

export async function stopChildProcesses(input, {signal='SIGTERM',graceMs=10000}={}) {
  const children=[...new Set(input.filter(Boolean))].filter(childIsRunning);
  const exited=Promise.all(children.map(child=>new Promise(resolve=>{if(!childIsRunning(child))resolve();else child.once('exit',resolve);}))); 
  for(const child of children)if(childIsRunning(child))child.kill(signal);
  await waitBounded(exited,graceMs);
  let forced=0;
  for(const child of children)if(childIsRunning(child)){child.kill('SIGKILL');forced++;}
  await waitBounded(exited,2000);
  return {forced,remaining:children.filter(childIsRunning).length};
}
