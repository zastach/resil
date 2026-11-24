import { spawn } from 'node:child_process';

/** Convert an uploaded recording to bounded, 20-ms mono Opus packets.
 * Ogg container parsing is deliberately first-party; ffmpeg supplies only the codec.
 * Steam voice framing follows the native packet format verified in Rust; web integration remains a release gate.
 */
export async function encodeVoicePackets(input: Buffer): Promise<string[]> {
 const output = await new Promise<Buffer>((resolve, reject) => {
  const proc = spawn('ffmpeg', [
   '-hide_banner','-loglevel','error','-nostdin','-i','pipe:0',
   '-ac','1','-ar','24000','-c:a','libopus','-application','voip',
   '-frame_duration','20','-b:a','24000','-vbr','off','-f','ogg','pipe:1'
  ], {stdio:['pipe','pipe','pipe']});
  const parts:Buffer[]=[];let length=0;let stderr='';
  let timedOut=false;
  let tooLarge=false;
  const watchdog=setTimeout(()=>{timedOut=true;proc.kill('SIGKILL');},20000);
  proc.stdout.on('data',(b:Buffer)=>{length+=b.length;if(length>2_000_000){tooLarge=true;proc.kill('SIGKILL');}else parts.push(b);});
  proc.stderr.on('data',(b:Buffer)=>{stderr+=b.toString().slice(0,1024);});
  let settled=false;
  const fail=(error:Error)=>{if(!settled){settled=true;clearTimeout(watchdog);reject(error);}};
  proc.on('error',e=>fail(e));
  proc.on('close',code=>{
   if(settled)return;
   clearTimeout(watchdog);
   if(timedOut)return fail(Error('Audio transcoding exceeded 20 seconds'));
   if(tooLarge)return fail(Error('Encoded voice stream exceeds 2 MB'));
   if(code!==0)return fail(Error('Audio transcoding failed: '+stderr.slice(0,300)));
   settled=true;resolve(Buffer.concat(parts));
  });
  proc.stdin.on('error',()=>{});
  proc.stdin.end(input);
 });
 const packets:Buffer[]=[];let offset=0;let carry:Buffer[]=[];
 while(offset<output.length){
  if(offset+27>output.length||output.toString('ascii',offset,offset+4)!=='OggS')throw Error('Invalid Ogg audio stream');
  const segments=output[offset+26];const table=offset+27;
  if(table+segments>output.length)throw Error('Truncated Ogg segments');
  let position=table+segments;
  for(let i=0;i<segments;i++){
   const n=output[table+i];
   if(position+n>output.length)throw Error('Truncated Ogg packet');
   carry.push(output.subarray(position,position+n));position+=n;
   if(n<255){const packet=Buffer.concat(carry);carry=[];packets.push(packet);}
  }
  offset=position;
 }
 if(carry.length)throw Error('Incomplete Ogg packet');
 if(packets.length<3||packets[0].toString('ascii',0,8)!=='OpusHead'||packets[1].toString('ascii',0,8)!=='OpusTags')throw Error('Missing Opus headers');
 const frames=packets.slice(2);
 if(frames.length===0||frames.length>1500||frames.some(p=>p.length===0||p.length>4096))throw Error('Voice must be 30 seconds or shorter');
 return frames.map((p, sequence) => {
  const packet = Buffer.alloc(18);
  // Steam public individual account header; no recording user's identity.
  packet.writeBigUInt64LE(0x0110000100000001n, 0);
  packet[8] = 11; packet.writeUInt16LE(24000, 9);
  packet[11] = 6; packet.writeUInt16LE(p.length + 4, 12);
  packet.writeUInt16LE(p.length, 14);
  packet.writeUInt16LE(sequence, 16);
  // Header (18 bytes), payload, then CRC (4 bytes).
  const framed = Buffer.concat([packet.subarray(0,18), p, Buffer.alloc(4)]);
  let crc = 0xffffffff;
  for (const byte of framed.subarray(0,-4)) {
   crc ^= byte;
   for (let bit=0;bit<8;bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  framed.writeUInt32LE((crc ^ 0xffffffff) >>> 0, framed.length-4);
  return framed.toString('base64');
 });
}
