import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runMedia } from "../services/media-processing/MediaValidationService.mjs";
export function selectSubtitleReviewCue(cues) {
  const words = text => new Set(String(text).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().match(/[a-z]{4,}/g) || []).size;
  const candidates=(cues||[]).filter(c=>c?.text&&Number.isFinite(c.startTime)&&Number.isFinite(c.endTime)&&c.endTime-c.startTime>=.3&&words(c.text)>=2);
  candidates.sort((a,b)=>words(b.text)-words(a.text)||(b.endTime-b.startTime)-(a.endTime-a.startTime));
  assert.ok(candidates[0],"At least two distinct readable words at real subtitle times are required");
  return candidates[0];
}
export async function verifySubtitleFrame({file,cue,width,height,output}) {
  assert.ok(cue?.text&&cue.endTime>cue.startTime,"A real timed subtitle cue is required");
  const time=(cue.startTime+cue.endTime)/2, cropped=Math.floor(height*.4/2)*2;
  await runMedia("ffmpeg",["-v","error","-y","-ss",String(time),"-i",file,"-frames:v","1","-vf",`crop=${width}:${cropped}:0:${height-cropped},scale=iw*3:ih*3`,`${output}.png`]);
  const ocr=await runMedia("tesseract",[`${output}.png`,"stdout","-l","spa","--psm","6"]);
  const normalize=s=>String(s).normalize("NFD").replace(/\p{M}/gu,"").toLowerCase().match(/[a-z]{4,}/g)||[];
  const expected=new Set(normalize(cue.text)), recognized=new Set(normalize(ocr.stdout));
  const matched=[...expected].filter(word=>recognized.has(word));
  assert.ok(matched.length>=Math.min(2,expected.size),`Subtitle is not readable at its measured time. Expected: ${cue.text}; OCR: ${ocr.stdout}`);
  await runMedia("ffmpeg",["-v","error","-y","-ss",String(time),"-i",file,"-frames:v","1","-q:v","8",`${output}.jpg`]);
  // Small original acceptance frames are also available for direct engineering review.
  console.log(`CLIPFORGE_REVIEW_FRAME:${output.split("/").at(-1)}:${(await readFile(`${output}.jpg`)).toString("base64")}`);
  return {passed:true,method:"OCR_OF_BURNED_SUBTITLE_AT_CUE_MIDPOINT",time,expected:cue.text,recognized:ocr.stdout.trim(),matched};
}
