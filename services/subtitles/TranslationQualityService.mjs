import { createHash } from 'node:crypto';

export const TRANSLATION_PIPELINE_VERSION = 'local-context-glossary-v1';

export function normalizeGlossary(value = []) {
  if (!Array.isArray(value) || value.length > 80) throw new Error('El glosario admite hasta 80 términos.');
  const seen = new Set();
  return value.map(entry => {
    const source = normalizeText(entry?.source), target = normalizeText(entry?.target);
    if (!source || !target || source.length > 100 || target.length > 140 || /ZXQ\d+ZXQ/u.test(source + target)) throw new Error('Cada término necesita original y traducción válidos, sin marcadores internos.');
    const key = source.toLocaleLowerCase('en');
    if (seen.has(key)) throw new Error('El glosario contiene términos repetidos.');
    seen.add(key); return { source, target };
  });
}

export function normalizeText(value) {
  return String(value ?? '').normalize('NFC').replace(/[\u0000-\u0008\u000b-\u001f\u007f]/gu, '').replace(/\s+/gu, ' ').replace(/\s+([,.;:!?])/gu, '$1').trim();
}

const escape = text => text.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
const termPattern = text => new RegExp(`(?<![\\p{L}\\p{N}])${escape(text)}(?![\\p{L}\\p{N}])`, 'giu');

/** Glossary entries are explicit owner choices. Automatic protection is limited
 * to literal numbers and acronyms, never guessed identity or an idiom rewrite. */
export function prepareTranslationInput(source, context = {}, glossary = []) {
  source = normalizeText(source);
  const before = normalizeText(context.before).slice(-150), after = normalizeText(context.after).slice(0, 150);
  const entries = [...normalizeGlossary(glossary)];
  for (const term of source.match(/\b[A-Z][A-Z0-9-]{1,}\b|\b\d+(?:[.,]\d+)*\b/gu) || []) {
    if (!entries.some(e => e.source.toLowerCase() === term.toLowerCase())) entries.push({ source: term, target: term });
  }
  entries.sort((a,b) => b.source.length-a.source.length);
  const substitutions = [];
  const mask = text => {
    let result = text;
    for (const entry of entries) {
      if (!termPattern(entry.source).test(result)) continue;
      let item = substitutions.find(e => e.source === entry.source);
      if (!item) { item = { ...entry, marker: `ZXQ${substitutions.length}ZXQ` }; substitutions.push(item); }
      result = result.replace(termPattern(entry.source), item.marker);
    }
    return result;
  };
  if (/ZXQ\d+ZXQ/u.test(source + before + after)) throw new Error('El texto contiene un marcador reservado del traductor.');
  const direct = mask(source), prefix = mask(before), suffix = mask(after);
  let nonce = BigInt('0x'+createHash('sha256').update(source+before+after).digest('hex').slice(0,12)).toString().padStart(15,'9');
  while ((source+before+after).includes(nonce)) nonce += '9';
  const begin = nonce + '1', end = nonce + '2';
  const contextual = before || after ? `${prefix} ${begin} ${direct} ${end} ${suffix}`.trim() : null;
  return { source, direct, contextual: contextual?.length <= 1000 ? contextual : null, begin, end, substitutions,
    protectedTerms: entries.filter(e=>termPattern(e.source).test(source)) };
}

export function recoverTranslation(prepared, directRaw, contextualRaw) {
  let text = directRaw, contextUsed = false;
  const issues = [];
  if (prepared.contextual) {
    const first = String(contextualRaw || '').indexOf(prepared.begin), last = String(contextualRaw || '').indexOf(prepared.end);
    if (first >= 0 && last > first && String(contextualRaw).lastIndexOf(prepared.begin) === first && String(contextualRaw).lastIndexOf(prepared.end) === last) {
      text = contextualRaw.slice(first+prepared.begin.length, last).trim(); contextUsed = true;
    } else issues.push('CONTEXT_ALIGNMENT_UNAVAILABLE');
  }
  const restore = raw => {
    let value = normalizeText(raw);
    for (const item of prepared.substitutions) value = value.replaceAll(item.marker, item.target);
    return value;
  };
  text = restore(text);
  if (!text || /ZXQ\d*|\d*ZXQ/u.test(text) || text.includes(prepared.begin) || text.includes(prepared.end)) {
    throw Object.assign(new Error('No se pudieron recuperar términos protegidos. Conserva el original y revisa el glosario.'), { code: 'TRANSLATION_ALIGNMENT_INVALID' });
  }
  const direct = restore(directRaw);
  for (const term of prepared.protectedTerms) if (!termPattern(term.target).test(text)) issues.push('PROTECTED_TERM_MISSING');
  if (contextUsed && direct !== text) issues.push('CONTEXT_VARIANT_REVIEW');
  return { text, direct, contextUsed, issues: [...new Set(issues)] };
}

/** These checks identify risks, not semantic equivalence or model confidence. */
export function assessTranslation(source, target, { glossary = [], duration, issues = [] } = {}) {
  source = normalizeText(source); target = normalizeText(target);
  const flags = [...issues];
  const sourceNegative = /\b(?:no|not|never|neither|nobody|nothing|without|cannot|can't|won't|isn't|wasn't|don't|didn't)\b/iu.test(source.replaceAll('’',"'"));
  const targetNegative = /\b(?:no|nunca|jamás|jamas|ni|nadie|nada|sin|tampoco)\b/iu.test(target);
  if (sourceNegative !== targetNegative) flags.push('NEGATION_REVIEW');
  if (/\b(?:may|might|could)\b/iu.test(source) && /\b(?:no puede|no podrá|no podra|imposible)\b/iu.test(target)) flags.push('MODALITY_REVIEW');
  if (JSON.stringify(numberClaims(source,'en')) !== JSON.stringify(numberClaims(target,'es'))) flags.push('NUMBER_REVIEW');
  for (const term of normalizeGlossary(glossary)) if (termPattern(term.source).test(source) && !termPattern(term.target).test(target)) flags.push('GLOSSARY_REVIEW');
  if (target.length < source.length * .35 || target.length > source.length * 2.8) flags.push('POSSIBLE_OMISSION_OR_EXPANSION');
  if (!/[.!?…]["'”)]?$/u.test(source)) flags.push('INCOMPLETE_SOURCE_SEGMENT');
  // Perception + object + event is ambiguous in small models (e.g. felt the
  // ground shake). Flag the construction instead of substituting a fixed phrase.
  if (/\b(?:feel|felt|hear|heard|see|saw|watch|watched)\b.{0,70}\b(?:shake|break|rock|move|fall|rise)\b/iu.test(source)) flags.push('AMBIGUOUS_EVENT_EXPRESSION');
  if (/\b(?:come|go|take|get|turn|give|set|put|look|bring|carry|break|run)\s+(?:again|up|down|out|off|over|back|away|through)\b/iu.test(source)) flags.push('IDIOM_OR_PHRASAL_VERB_REVIEW');
  if (Number.isFinite(duration) && target.length / Math.max(.01,duration) > 22) flags.push('READING_SPEED_HIGH');
  return { status: 'REVIEW_REQUIRED', method: 'RULE_BASED_RISK_CHECKS_NOT_SEMANTIC_CERTIFICATION', issues: [...new Set(flags)] };
}

// Compare explicit numeric claims written as digits or common cardinal words.
// This is deliberately not a general language/units equivalence engine.
function numberClaims(text, language) {
  const words = language === 'en'
    ? ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven','twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen']
    : ['cero','uno','dos','tres','cuatro','cinco','seis','siete','ocho','nueve','diez','once','doce','trece','catorce','quince','dieciseis','diecisiete','dieciocho','diecinueve'];
  const values = Object.fromEntries(words.map((word,i)=>[word,i]));
  const tens = language === 'en' ? ['twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'] : ['veinte','treinta','cuarenta','cincuenta','sesenta','setenta','ochenta','noventa'];
  tens.forEach((word,i)=>{values[word]=(i+2)*10;});
  if (language === 'es') {for(let i=1;i<=9;i++)values['veinti'+words[i]]=20+i;values.veintiun=21;}
  const scales = language === 'en' ? {hundred:100,thousand:1000,million:1e6,billion:1e9} : {cien:100,ciento:100,mil:1000,millon:1e6,millones:1e6,billon:1e12,billones:1e12};
  const tokens = text.toLowerCase().normalize('NFD').replace(/\p{M}/gu,'').match(/\d+(?:[.,]\d+)*|[a-z]+/gu) || [];
  const result=[];let total=0,current=0,active=false;
  const numeric=token=>Object.hasOwn(values,token) || Object.hasOwn(scales,token) || /^\d/u.test(token||'');
  const finish=()=>{if(active)result.push(total+current);total=0;current=0;active=false;};
  for(let i=0;i<tokens.length;i++) {
    const token=tokens[i];
    if ((token==='and'||token==='y')&&active&&numeric(tokens[i+1]))continue;
    if (!numeric(token)) {finish();continue;}
    active=true;
    if(Object.hasOwn(values,token))current+=values[token];
    else if(Object.hasOwn(scales,token)){const scale=scales[token];if(scale===100)current=Math.max(1,current)*100;else if(scale===1000){total+=Math.max(1,current)*scale;current=0;}else{total=(total+current||1)*scale;current=0;}}
    else {let raw=token;if(/^\d{1,3}(?:[.,]\d{3})+$/u.test(raw))raw=raw.replace(/[.,]/gu,'');else raw=raw.replace(',','.');current+=Number(raw);}
  }
  finish();return result.sort((a,b)=>a-b);
}

export function subtitleReadability(cues) {
  return cues.flatMap(cue => {
    const reasons = [];
    if (cue.text.length / (cue.endTime-cue.startTime) > 22) reasons.push('READING_SPEED_HIGH');
    if (cue.endTime-cue.startTime < .6) reasons.push('CUE_TOO_SHORT');
    if (cue.text.split('\n').some(line => line.length > 84)) reasons.push('LONG_LINE');
    return reasons.length ? [{ cueId: cue.id, issues: reasons }] : [];
  });
}
