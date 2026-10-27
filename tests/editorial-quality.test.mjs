import test from 'node:test';
import assert from 'node:assert/strict';
import { selectIndependentClips } from '../services/analysis/BestClipsService.mjs';

const candidate = overrides => ({ id:'event', startTime:0, endTime:30, duration:30, text:'A complete answer.', ...overrides });
const options = { count:5, minDuration:25, maxDuration:35 };
test('automatic selection rejects a fully measured inaudible interval, even if its model score is high', () => {
  const silent = candidate({ viralScore:100, audiovisualEvidence:{ audio:{ coveredSeconds:30, meanDb:-100, audible:false } } });
  assert.deepEqual(selectIndependentClips([silent], options), []);
});
test('an explicitly incomplete sentence is not rendered just to fill the automatic quota', () => {
  assert.deepEqual(selectIndependentClips([candidate({ qualityWarnings:['INCOMPLETE_SENTENCE_END'] })], options), []);
});
test('unknown audio, a context warning or missing chat alone do not reject a reviewable candidate', () => {
  for (const value of [candidate({ qualityWarnings:['AUDIO_NOT_MEASURED','CONTEXT_DEPENDENT_START'] }),
    candidate({ audiovisualEvidence:{ audio:{ coveredSeconds:1, meanDb:-100, audible:false } } })]) {
    assert.equal(selectIndependentClips([value],options).length,1);
  }
});
