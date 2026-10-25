import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatActivityCollector, buildChatActivityWindows, chatEvidenceForWindow } from '../services/analysis/ChatActivityService.mjs';
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

test('the same reaction from many different participants is positive evidence, even at constant message volume', () => {
  const rows = bins([20, 20, 20, 20, 20, 20, 20]);
  for (const row of rows) { row.dominantTextCount = 2; row.dominantTextSenders = 2; }
  rows[6].distinctTexts = 7; rows[6].dominantTextCount = 14; rows[6].dominantTextSenders = 14;
  const reaction = buildChatActivityWindows(rows, { sourceStartUtc: origin }).at(-1);
  assert.equal(reaction.isPeak, false, 'raw message volume did not increase');
  assert.equal(reaction.isCollectiveReaction, true);
  assert.ok(reaction.score > 50);
  assert.equal(reaction.repetitionEvidence.scope, 'SAME_TEXT_MEASURED');
  assert.equal(reaction.repetitionEvidence.dominantTextSenders, 14);
  assert.equal(reaction.repetitionEvidence.share, 0.7);
  const evidence = chatEvidenceForWindow({ startTime: 50, endTime: 80 }, [reaction]);
  assert.ok(evidence.isCollectiveReaction && evidence.reviewRequired);
});

test('a persistent chorus does not create a fresh reaction every ten seconds', () => {
  const rows = bins(Array(9).fill(50));
  for (const row of rows) { row.distinctTexts = 8; row.dominantTextCount = 43; row.dominantTextSenders = 43; }
  const windows = buildChatActivityWindows(rows, { sourceStartUtc: origin });
  assert.ok(windows.slice(6).every(w => !w.isCollectiveReaction && w.score === 0));
});

test('collector measures actual same-text participants, filters other rooms and deduplicates deliveries', () => {
  let now = Date.parse(origin);
  const collector = new ChatActivityCollector({ roomId: 'westcol-room', now: () => now });
  assert.equal(collector.add({ id: 'other', roomId: 'other-room', senderId: 'viewer', content: 'JAJAJA' }), false);
  assert.equal(collector.add({ id: 'missing-sender', roomId: 'westcol-room', content: 'JAJAJA' }), false);
  for (let i = 0; i < 12; i++) assert.ok(collector.add({ id: `message-${i}`, roomId: 'westcol-room', senderId: `viewer-${i}`, content: i % 2 ? '  jajaja  ' : 'JAJAJA' }));
  assert.equal(collector.add({ id: 'message-0', roomId: 'westcol-room', senderId: 'viewer-0', content: 'JAJAJA' }), false);
  const partial = collector.snapshot()[0]; assert.equal(partial.complete, false);
  now += 10000;
  const row = collector.snapshot()[0];
  assert.equal(row.complete, true); assert.equal(row.messages, 12);
  assert.equal(row.distinctTexts, 1); assert.equal(row.uniqueSenders, 12);
  assert.equal(row.dominantTextCount, 12); assert.equal(row.dominantTextSenders, 12);
  assert.doesNotMatch(JSON.stringify(row), /viewer-|message-|jajaja/i);
});

test('collector bounds retained buckets and does not treat repeated messages from one sender as many participants', () => {
  let now = Date.parse(origin) + 1000;
  const collector = new ChatActivityCollector({ roomId: 'westcol-room', maxBins: 2, maxMessages: 4, now: () => now });
  for (let i = 0; i < 3; i++) collector.add({ id: i, roomId: 'westcol-room', senderId: 'one-viewer', content: 'JAJAJA' });
  const initial = collector.snapshot()[0];
  assert.equal(initial.messages, 3); assert.equal(initial.dominantTextSenders, 1); assert.equal(initial.complete, false);
  for (let i = 1; i <= 3; i++) { now += 10000; collector.add({ id: `new-${i}`, roomId: 'westcol-room', senderId: i, content: 'Otra reacción' }); }
  assert.equal(collector.snapshot().length, 2);
  assert.throws(() => new ChatActivityCollector({ roomId: 'x', maxBins: Infinity }), /límites/);
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
  assert.equal(largest.isCollectiveReaction, true);
  assert.ok(largest.score > 0, 'many participants repeating reactions must not be discarded for repetition');
  assert.equal(largest.repetitionEvidence.scope, 'AGGREGATE_REPETITION_ONLY', 'old counters did not measure who repeated the same phrase');
  assert.equal(largest.repetitionEvidence.dominantTextSenders, null);
  assert.ok(largest.limitations.includes('REPETITIVE_TEXT'));
  assert.ok(largest.ratio > 1.49 && largest.ratio < 1.5);
  assert.ok(!JSON.stringify(fixture).includes('sender_id'));
});

test('a new real session measures shared reactions from 20 and 31 participants without inventing clips', async () => {
  const fixture = JSON.parse(await readFile(new URL('./fixtures/westcol-collective-chat-20261025.json', import.meta.url), 'utf8'));
  assert.equal(fixture.bins.reduce((sum, bin) => sum + bin.messages, 0), fixture.observedMessages);
  assert.equal(fixture.observedMessages, 2815);
  const windows = buildChatActivityWindows(fixture.bins, { sourceStartUtc: fixture.analysisClockOriginUtc });
  const reactions = windows.filter(w => w.isCollectiveReaction);
  assert.deepEqual(reactions.map(w => w.utc), ['2026-10-25T19:04:50.000Z', '2026-10-25T19:09:00.000Z']);
  assert.deepEqual(reactions.map(w => w.repetitionEvidence.dominantTextSenders), [20, 31]);
  assert.ok(reactions.every(w => w.repetitionEvidence.scope === 'SAME_TEXT_MEASURED' && w.score > 0));
  assert.equal(fixture.videoCaptured, false, 'observed chat does not certify an MP4');
});
