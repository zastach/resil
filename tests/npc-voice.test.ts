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

test('NPC voice conversion emits bounded, CRC-validated Steam voice packets', { skip: !ffmpegAvailable }, async () => {
  const frames = await encodeVoicePackets(wav(0.5));
  assert.ok(frames.length >= 5 && frames.length <= 6, 'Expected roughly 10 packets per second');
  for (const encoded of frames) {
    const bytes = Buffer.from(encoded, 'base64');
    assert.ok(bytes.length > 0 && bytes.length <= 4096);
    assert.equal(bytes.toString('base64'), encoded);
    assert.equal(bytes[8], 11);
    assert.equal(bytes.readUInt16LE(9), 24000);
    assert.equal(bytes[11], 6);
    assert.equal(bytes.readUInt16LE(12), bytes.length - 18);
    let pos=14, count=0;
    while(pos<bytes.length-4){
      const size=bytes.readUInt16LE(pos);
      assert.equal(bytes.readUInt16LE(pos+2),frames.indexOf(encoded)*5+count);
      pos+=4+size;count++;
    }
    assert.equal(pos,bytes.length-4);
    assert.ok(count>=1&&count<=5);
    let crc = 0xffffffff;
    for (const byte of bytes.subarray(0,-4)) {
      crc ^= byte;
      for (let bit=0;bit<8;bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    assert.equal(bytes.readUInt32LE(bytes.length-4), (crc ^ 0xffffffff) >>> 0);
  }
});

test('NPC voice conversion rejects invalid input', { skip: !ffmpegAvailable }, async () => {
  await assert.rejects(encodeVoicePackets(Buffer.from('not audio')));
});

test('NPC voice conversion enforces 30 second frame cap', { skip: !ffmpegAvailable }, async () => {
  await assert.rejects(encodeVoicePackets(wav(31)), /30 seconds|exceeds|transcoding/i);
});
