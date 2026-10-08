import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir,writeFile,copyFile,readFile } from "node:fs/promises";
import path from "node:path";
import { EspeakNewsTtsProvider } from "../services/news/EspeakNewsTtsProvider.mjs";
import { BestClipsService } from "../services/analysis/BestClipsService.mjs";
import { runMedia,probeMediaFile } from "../services/media-processing/MediaValidationService.mjs";
import { replaceProjectFile,loadProjectFile } from "../lib/project-files.mjs";
const output=path.resolve("artifacts/best-clips"),root=path.join(output,"storage");process.env.CLIPFORGE_STORAGE_DIR=root;
const id=randomUUID(),directory=path.join(root,"uploads",id);await mkdir(directory,{recursive:true});
const topics=[
  ["el huerto comunitario","Lucía","semillas, suelo y riego","una cosecha compartida"],
  ["el taller de bicicletas","Mateo","ruedas, frenos y herramientas","un transporte seguro"],
  ["la biblioteca del barrio","Ana","libros, lectores y relatos","un club de lectura"],
  ["la limpieza del río","Carlos","agua, residuos y peces","una ribera recuperada"],
  ["la escuela de música","Sofía","instrumentos, ritmo y ensayos","un concierto público"],
  ["el refugio de animales","Diego","alimento, cuidados y adopciones","una familia responsable"],
  ["el mercado local","Elena","precios, productores y alimentos","un intercambio justo"],
  ["la ruta accesible","Pablo","rampas, aceras y señalización","una ciudad inclusiva"],
  ["el observatorio nocturno","Julia","estrellas, telescopios y órbitas","una noche de aprendizaje"],
  ["el museo de memoria","Andrés","fotografías, testimonios y archivos","una exposición respetuosa"],
  ["la cooperativa solar","Marina","paneles, energía y baterías","una factura más sencilla"],
  ["el comedor vecinal","Luis","recetas, cocinas y voluntarios","una mesa abierta"],
  ["la brigada forestal","Valeria","árboles, senderos y prevención","un bosque protegido"],
  ["el taller de cerámica","Tomás","arcilla, hornos y esmaltes","una pieza original"],
  ["el equipo deportivo","Camila","entrenamientos, esfuerzo y compañeros","una competencia amistosa"],
  ["el laboratorio escolar","Daniel","experimentos, preguntas y mediciones","un descubrimiento verificable"],
  ["la radio independiente","Isabel","micrófonos, noticias y entrevistas","una conversación informada"],
  ["la feria de ciencias","Gabriel","prototipos, pruebas y resultados","una presentación clara"],
  ["la red de costura","Paula","telas, diseños y reparación","una prenda duradera"],
  ["el jardín de mariposas","Samuel","flores, insectos y estaciones","un espacio de biodiversidad"],
];
const paragraphs=topics.map(([topic,name,details,outcome],i)=>`¿Cómo empezó ${topic}? ${name} recuerda que la primera reunión tuvo apenas cinco participantes. Nadie sabía si la propuesta funcionaría, pero decidieron escuchar antes de comprar materiales. Esta historia es ficticia y fue escrita para comprobar nuestro sistema audiovisual. En el capítulo ${i+1}, hablamos de ${details}. La primera dificultad apareció cuando faltaron recursos y el grupo tuvo que cambiar el calendario. Una persona quería avanzar rápidamente y otra pedía revisar cada paso. En lugar de discutir sin información, hicieron una prueba pequeña y registraron lo que sucedió. El resultado fue sorprendente: una idea que parecía complicada podía resolverse con paciencia y cooperación. ${name} explica que el cambio más importante fue aprender a compartir las decisiones. Después de varias semanas, consiguieron ${outcome}. Hubo errores, preguntas y momentos de humor durante el proceso. ¿Qué consejo darían a quien empieza? Primero, definir un objetivo comprensible. Segundo, conservar las evidencias de cada intento. Tercero, pedir ayuda cuando falte experiencia. Al terminar, el equipo celebró sus avances y reconoció también lo que todavía debía mejorar. El desenlace no fue una promesa milagrosa, sino una solución concreta que el barrio podía revisar. Cerramos este capítulo recordando que ${topic} pertenece a quienes participan y cuidan su continuidad.`);
await writeFile(path.join(output,"authored-narration.txt"),paragraphs.join("\n\n"));
await new EspeakNewsTtsProvider({voice:"es-419",speed:150}).synthesize({text:paragraphs.join(" "),outputPath:path.join(directory,"voice.wav")});
const voice=await probeMediaFile(path.join(directory,"voice.wav"));const tempo=voice.duration/1200;assert.ok(tempo>.5&&tempo<2,"Fixture speech must fit naturally into twenty minutes");
await runMedia("ffmpeg",["-v","error","-y","-i",path.join(directory,"voice.wav"),"-af",`atempo=${tempo},loudnorm=I=-16:TP=-1.5:LRA=11,apad`,"-t","1200","-ar","48000",path.join(directory,"narration.wav")]);
const filename=path.join(directory,"source.mp4");await runMedia("ffmpeg",["-v","error","-y","-f","lavfi","-i","testsrc2=size=320x180:rate=10","-i",path.join(directory,"narration.wav"),"-t","1200","-c:v","libx264","-threads","2","-preset","ultrafast","-crf","30","-pix_fmt","yuv420p","-c:a","aac","-movflags","+faststart",filename]);
const probe=await probeMediaFile(filename);assert.ok(probe.duration>=1200);
await replaceProjectFile(id,{id,createdAt:new Date().toISOString(),source:{projectId:id,originalName:"original-fictional-spanish-podcast-20m.mp4",storedName:"source.mp4",relativePath:`uploads/${id}/source.mp4`,sizeBytes:(await readFile(filename)).length,durationSeconds:probe.duration,width:320,height:180,fps:10,hasAudio:true,codec:"h264",container:"mp4",aspectRatio:"16:9"},clips:[]});
// No transcript is supplied. The real installed Whisper model must transcribe the recording.
const result=await new BestClipsService({width:360,height:640}).render(randomUUID(),{projectId:id,count:3,minDuration:90,maxDuration:180,intensity:"NORMAL",subtitles:true},async(status,stage,progress)=>console.log(`${status} ${stage} ${progress}`));
assert.equal(result.clips.length,3);assert.equal(result.validation.valid,true);
const original=await loadProjectFile(id);assert.equal(original.transcript.provider,"whisper.cpp");assert.equal(original.transcript.status,"COMPLETED");assert.ok(original.transcript.segments.length>20);
const project=await loadProjectFile(result.projectId);
for(let i=0;i<3;i++){
  const clip=result.clips[i];assert.ok(clip.duration>=90&&clip.duration<=180);assert.equal(clip.validation.audioCodec,"aac");assert.equal(clip.validation.videoCodec,"h264");assert.deepEqual(clip.validation.blackIntervals,[]);
  assert.ok(project.clips[i].subtitles.cues.length>0);assert.ok(project.clips[i].subtitles.cues.every(c=>c.startTime>=0&&c.endTime<=clip.duration+.2));
  for(const other of result.clips.slice(0,i))assert.ok(Math.min(other.endTime,clip.endTime)<=Math.max(other.startTime,clip.startTime));
  await copyFile(path.join(root,clip.relativePath),path.join(output,`clip-${i+1}.mp4`));
  await runMedia("ffmpeg",["-v","error","-y","-ss","2","-i",path.join(root,clip.relativePath),"-frames:v","1",path.join(output,`clip-${i+1}.jpg`)]);
}
await copyFile(filename,path.join(output,"podcast-20m.mp4"));
await writeFile(path.join(output,"evidence.json"),JSON.stringify({fixture:"Original fictional interview narration synthesized locally; actual 20-minute MP4 and real Whisper transcription, no mocked transcript.",originalProjectId:id,originalDuration:probe.duration,transcriptProvider:original.transcript.provider,transcriptSegments:original.transcript.segments.length,result},null,2));
console.log(JSON.stringify({passed:true,...result},null,2));
