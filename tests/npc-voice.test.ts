import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';
import { encodeVoicePackets } from '../src/server/lib/npc-voice';

const ffmpegAvailable = spawnSync('ffmpeg', ['-version'], { encoding: 'utf8' }).status === 0;

function wav(seconds: number): Buffer {
  const result = spawnSync('ffmpeg', [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi',
    '-i', 'sine=frequency=440:sample_rate=48000',
    '-t', String(seconds), '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1'
  ], { maxBuffer: 12 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr?.toString());
  return result.stdout;
}

test('NPC voice conversion emits bounded, base64 Opus frames', { skip: !ffmpegAvailable }, async () => {
  const frames = await encodeVoicePackets(wav(0.5));
  assert.ok(frames.length >= 20 && frames.length <= 30, 'Expected roughly 50 frames per second');
  for (const encoded of frames) {
    const bytes = Buffer.from(encoded, 'base64');
    assert.ok(bytes.length > 0 && bytes.length <= 4096);
    assert.equal(bytes.toString('base64'), encoded);
  }
});

test('NPC voice conversion rejects invalid input', { skip: !ffmpegAvailable }, async () => {
  await assert.rejects(encodeVoicePackets(Buffer.from('not audio')));
});

test('NPC voice conversion enforces 30 second frame cap', { skip: !ffmpegAvailable }, async () => {
  await assert.rejects(encodeVoicePackets(wav(31)), /30 seconds|exceeds|transcoding/i);
});
