export const ENCODER_QUALITY={
  FAST:{preset:'ultrafast',crf:'28'},
  EFFICIENT:{preset:'veryfast',crf:'23'},
  BALANCED:{preset:'medium',crf:'23'},
  HIGH:{preset:'slow',crf:'20'},
};
/** Resolution is an explicit editing choice, never an automatic downgrade
 * after a slow request. Existing clips retain their recorded dimensions. */
export function manualOutputOptions(input={},env=process.env){
  const aspectRatio=input.aspectRatio===undefined?'9:16':input.aspectRatio;
  if(!['9:16','16:9'].includes(aspectRatio))throw new Error('Elige formato vertical 9:16 u horizontal 16:9.');
  const fallback=Number(env.CLIPFORGE_MEDIA_WIDTH)===720?'720p':'1080p';
  const resolution=input.resolution===undefined?fallback:input.resolution;
  if(!['720p','1080p'].includes(resolution))throw new Error('Elige resolución 720p o 1080p.');
  const short=resolution==='720p'?720:1080,long=resolution==='720p'?1280:1920;
  return {width:aspectRatio==='9:16'?short:long,height:aspectRatio==='9:16'?long:short,aspectRatio,resolution};
}
/** Automatic clipping shares the owner's explicit format/resolution choices.
 * Constructor dimensions remain supported for existing internal QA callers. */
export function automaticOutputOptions(input={}, {width=1080,height=1920,env=process.env}={}) {
  if(input.format!==undefined&&input.aspectRatio!==undefined&&input.format!==input.aspectRatio)throw new Error('La solicitud contiene dos formatos distintos. Elige 9:16 o 16:9.');
  if(input.format===undefined&&input.aspectRatio===undefined&&input.resolution===undefined)return {width,height};
  return manualOutputOptions({aspectRatio:input.aspectRatio??input.format??'9:16',resolution:input.resolution},
    {...env,CLIPFORGE_MEDIA_WIDTH:String(Math.min(width,height))});
}
export function renderThreads(env=process.env){
  const value=Number(env.CLIPFORGE_RENDER_THREADS||2);
  return Number.isSafeInteger(value)&&value>=1&&value<=8?value:2;
}
