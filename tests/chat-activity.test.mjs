import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatActivityWindows, chatEvidenceForWindow } from '../services/analysis/ChatActivityService.mjs';
import { TranscriptCandidateProvider } from '../services/analysis/TranscriptCandidateProvider.mjs';
import { scoreCandidate } from '../services/analysis/ViralScoreService.mjs';
import { readFile } from 'node:fs/promises';

const origin = '2026-10-25T17:00:00Z';
const bins = (counts, diversity = 1) => counts.map((messages, index) => ({
  utc: new Date(Date.parse(origin) + index * 10000).toISOString(), messages,
  uniqueSenders: Math.floor(messages * diversity), distinctTexts: Math.floor(messages * diversity),
}));

test('a chat spike requires a contiguous baseline and diverse observed reactions', () => {
  const result = buildChatActivityWindows(bins([20, 19, 21, 20, 22, 18, 70]), { sourceStartUtc: origin });
  assert.ok(result.slice(0, 6).every(row => row.score === null && !row.isPeak));
  assert.equal(result[6].baselineMessages, 20);
  assert.equal(result[6].ratio, 3.5);
  assert.equal(result[6].score, 100);
  assert.ok(result[6].isPeak);
  assert.ok(result[6].limitations.includes('REACTION_DELAY_UNKNOWN'));
  assert.equal(result[6].start, 60);
});

test('constant high-volume chat is not a spike; missing bins and incomplete buckets cannot fake one', () => {
  const constant = buildChatActivityWindows(bins(Array(8).fill(500)), { sourceStartUtc: origin });
  assert.equal(constant.at(-1).score, 0);
  const missing = bins([20, 20, 20, 20, 20, 20, 80]); missing.splice(3, 1);
  assert.equal(buildChatActivityWindows(missing, { sourceStartUtc: origin }).at(-1).score, null);
  const incomplete = bins([20, 20, 20, 20, 20, 20, 80]); incomplete[0].complete = false;
  assert.equal(buildChatActivityWindows(incomplete, { sourceStartUtc: origin }).at(-1).score, null);
});

test('repeated text and few senders reduce influence without claiming to identify bots', () => {
  const normal = bins([20, 20, 20, 20, 20, 20, 80]);
  const repetitive = structuredClone(normal);
  repetitive[6].distinctTexts = 1; repetitive[6].uniqueSenders = 2;
  const peak = buildChatActivityWindows(repetitive, { sourceStartUtc: origin }).at(-1);
  assert.ok(peak.isPeak);
  assert.ok(peak.score < 10);
  assert.ok(peak.limitations.includes('REPETITIVE_TEXT'));
  assert.doesNotMatch(JSON.stringify(peak), /bots/i);
});

test('replayed buckets, impossible counters and bad clocks do not invent activity', () => {
  const rows = bins([20, 20, 20, 20, 20, 20, 80]);
  const result = buildChatActivityWindows([...rows, rows[6], { ...rows[0], messages: -2 }, { ...rows[0], uniqueSenders: 200 }], { sourceStartUtc: origin });
  assert.equal(result.length, 7);
  assert.equal(result.at(-1).messages, 80);
  assert.throws(() => buildChatActivityWindows(rows, {}), /inicio UTC/);
  assert.throws(() => buildChatActivityWindows(rows, { sourceStartUtc: origin, binSeconds: 0 }), /válidos/);
  assert.equal(chatEvidenceForWindow({ startTime: 500, endTime: 530 }, result), null);
});

test('existing candidate selection uses real chat aggregates and keeps absent evidence explicit', async () => {
  const transcript = { segments: Array.from({ length: 10 }, (_, i) => ({ startTime: i * 10, endTime: (i + 1) * 10,
    text: i === 6 ? 'De repente llegó la sorpresa y todos reaccionaron con una pregunta completa.' : `Esta es la explicación número ${i} y termina con una conclusión completa.` })) };
  const chatActivityWindows = buildChatActivityWindows(bins([20, 20, 20, 20, 20, 20, 80, 20, 20, 20]), { sourceStartUtc: origin });
  const provider = new TranscriptCandidateProvider();
  const withChat = await provider.analyze({ transcript, chatActivityWindows, options: { minDuration: 20, maxDuration: 30, maxCandidates: 10 } });
  const supported = withChat.find(c => c.chatEvidence?.score > 0);
  assert.ok(supported, 'a selected transcript window must retain the measured peak');
  assert.equal(supported.components.chatActivity, supported.chatEvidence.score);
  assert.ok(!supported.missingSignals.includes('chatActivity'));
  assert.match(supported.reason, /chat observado/);
  assert.ok(supported.chatEvidence.reviewRequired);
  const absent = scoreCandidate({ duration: 30, text: 'Una frase completa.' });
  assert.equal(absent.components.chatActivity, null);
  assert.ok(absent.missingSignals.includes('chatActivity'));
  assert.equal(absent.availableWeight, 95);
});

test('the anonymized real Westcol session reproduces measured activity without inventing a strong spike', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/westcol-chat-20261025.json', import.meta.url), 'utf8'));
  assert.equal(fixture.bins.reduce((sum, bin) => sum + bin.messages, 0), 2267);
  const windows = buildChatActivityWindows(fixture.bins, { sourceStartUtc: fixture.sourceStartUtc });
  const captured = windows.filter(w => w.start >= 0 && w.end <= fixture.videoDurationSeconds);
  const largest = captured.reduce((best, row) => row.messages > best.messages ? row : best);
  assert.equal(largest.messages, 80);
  assert.equal(largest.baselineMessages, 53.5);
  assert.equal(largest.utc, '2026-10-25T17:49:10.000Z');
  assert.equal(largest.isPeak, false);
  assert.ok(largest.limitations.includes('REPETITIVE_TEXT'));
  assert.ok(largest.ratio > 1.49 && largest.ratio < 1.5);
  assert.ok(!JSON.stringify(fixture).includes('sender_id'));
});
