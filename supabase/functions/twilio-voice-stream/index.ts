import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.54.0'

const corsHeaders={ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
const supabaseUrl=Deno.env.get('SUPABASE_URL')||''
const supabaseKey=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')||''
const supabase=(supabaseUrl&&supabaseKey)?createClient(supabaseUrl,supabaseKey):null as unknown as ReturnType<typeof createClient>
const VERSION='receptionist-rag@2025-09-06'
const USE_CONVAI=false
// Vapi input transport: default to binary raw PCM16 for maximum compatibility.
const VAPI_AUDIO_IN_EVENT=(Deno.env.get('VAPI_AUDIO_IN_EVENT')||'user_audio_chunk').trim()
const VAPI_AUDIO_END_EVENT=(Deno.env.get('VAPI_AUDIO_END_EVENT')||'end_of_user_audio').trim()
// Default to JSON chunks; some Vapi orgs require control messages for audio.
const VAPI_BINARY_IN=(Deno.env.get('VAPI_BINARY_IN')||'false').toLowerCase()==='true'
const DEBUG_VAPI=(Deno.env.get('DEBUG_VAPI')||'true').toLowerCase()==='true'
const ECHO_GUARD=(Deno.env.get('TWILIO_ECHO_GUARD')||'true').toLowerCase()==='true'
const DEBUG_AUDIO=(Deno.env.get('DEBUG_AUDIO')||'true').toLowerCase()==='true'
// Vapi realtime is driven by per-call websocketCallUrl (from router)

function sleep(ms:number){return new Promise(r=>setTimeout(r,ms))}
function pcmToMulaw(s:number){const B=0x84,C=32635;let g=0;if(s<0){g=0x80;s=-s}if(s>C)s=C;s+=B;let e=7,m=0x4000;while((s&m)===0&&e>0){e--;m>>=1}const sh=(e===0)?4:(e+3),t=(s>>sh)&0x0f;return(~(g|(e<<4)|t))&0xff}
function mulawToPcm(mu:number){
  // Correct μ-law decode per ITU G.711
  mu=(~mu)&0xff;
  const sign=mu&0x80;
  const exponent=(mu>>4)&0x07;
  const mantissa=mu&0x0f;
  const sample=((mantissa|0x10)<<(exponent+3)) - 0x84;
  return sign ? -sample : sample;
}
function ulawFramesToPcm16(frames:Uint8Array[]):Int16Array{const n=frames.reduce((a,f)=>a+f.length,0);const out=new Int16Array(n);let i=0;for(const f of frames)for(let j=0;j<f.length;j++)out[i++]=mulawToPcm(f[j]);return out}
function wavFromPcm16(s:Int16Array,rate=8000){const h=new ArrayBuffer(44),v=new DataView(h);v.setUint32(0,0x52494646,false);v.setUint32(4,36+s.length*2,true);v.setUint32(8,0x57415645,false);v.setUint32(12,0x666d7420,false);v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);v.setUint32(36,0x64617461,false);v.setUint32(40,s.length*2,true);const w=new Uint8Array(44+s.length*2);w.set(new Uint8Array(h),0);for(let i=0;i<s.length;i++){w[44+i*2]=s[i]&0xff;w[44+i*2+1]=(s[i]>>8)&0xff}return w}
function parseWavPcm(b:Uint8Array){if(b.length<12)return{formatCode:1,channels:1,sampleRate:16000,bitsPerSample:16,pcmBytes:b};const H=String.fromCharCode(...b.slice(0,4)),W=String.fromCharCode(...b.slice(8,12));if(H!=='RIFF'||W!=='WAVE')return{formatCode:1,channels:1,sampleRate:16000,bitsPerSample:16,pcmBytes:b};let fmt=false,data=false,fc=1,ch=1,sr=16000,bps=16,pcm:Uint8Array|null=null,off=12;while(off+8<=b.length){const id=String.fromCharCode(...b.slice(off,off+4));const sz=new DataView(b.buffer).getUint32(off+4,true);const next=off+8+sz;if(id==='fmt '){fmt=true;const v=new DataView(b.buffer,off+8,sz);fc=v.getUint16(0,true);ch=v.getUint16(2,true);sr=v.getUint32(4,true);bps=v.getUint16(14,true)} else if(id==='data'){data=true;const s=off+8;e:s+sz;pcm=b.slice(s,e as any)}off=next}if(!data||!pcm)return null;if(!fmt)return{formatCode:1,channels:1,sampleRate:16000,bitsPerSample:16,pcmBytes:pcm};return{formatCode:fc,channels:ch,sampleRate:sr,bitsPerSample:bps,pcmBytes:pcm}}
function bytesToInt16LE(b:Uint8Array){const s=new Int16Array(Math.floor(b.length/2));for(let i=0;i<s.length;i++){const x=i*2;if(x+1<b.length){s[i]=b[x]|(b[x+1]<<8);if(s[i]>32767)s[i]-=65536}}return s}
function stereoToMono(s:Int16Array,ch:number){if(ch===1)return s;const f=Math.floor(s.length/ch),m=new Int16Array(f);for(let i=0;i<f;i++){let a=0;for(let c=0;c<ch;c++)a+=s[i*ch+c];m[i]=Math.max(-32768,Math.min(32767,Math.round(a/ch)))}return m}
function resampleLin(inp:Int16Array,fr:number,tr:number){if(fr===tr)return inp;const r=tr/fr,out=new Int16Array(Math.max(1,Math.round(inp.length*r)));for(let i=0;i<out.length;i++){const p=i/r,i0=Math.floor(p),i1=Math.min(inp.length-1,i0+1),f=p-i0;out[i]=Math.round(inp[i0]+(inp[i1]-inp[i0])*f)}return out}
function encPcm16ToUlaw(s:Int16Array){const u=new Uint8Array(s.length);for(let i=0;i<s.length;i++)u[i]=pcmToMulaw(s[i]);return u}

const outbound=new WeakMap<WebSocket,{q:Uint8Array[];sending:boolean;cancel:boolean}>()
async function sendToTwilio(frames:Uint8Array[],sid:string,ws:WebSocket){
  let st=outbound.get(ws);
  if(!st){st={q:[],sending:false,cancel:false};outbound.set(ws,st)}
  if(st.cancel)return;
  for(const f of frames)st.q.push(f);
  if(st.sending||ws.readyState!==WebSocket.OPEN)return;
  st.sending=true;
  try{
    while(!st.cancel&&st.q.length>0&&ws.readyState===WebSocket.OPEN){
      const f=st.q.shift()!;
      // Base64 encode exactly 160 ulaw bytes per ~20ms frame
      let bin='';
      for(let i=0;i<f.length;i++)bin+=String.fromCharCode(f[i]);
      const payload=btoa(bin);
      // Per Twilio Media Streams, send minimal schema; optionally include track fallback
      const includeTrack=(ws as any)._includeOutboundTrack===true
      const msg= includeTrack ? {event:'media',streamSid:sid,track:'outbound',media:{payload}} : {event:'media',streamSid:sid,media:{payload}}
      ws.send(JSON.stringify(msg));
      await sleep(20)
    }
  }catch(e){
    console.error('[OUTBOUND]',e)
  }finally{
    st.sending=false
  }
}
async function waitDrain(ws:WebSocket,ms=8000){const st=(outbound as any).get?.(ws);const s=Date.now();while(true){const sending=st?st.sending:false,remain=st?st.q.length:0;if(!sending&&remain===0)break;if(Date.now()-s>ms)return false;await sleep(25)}return true}
function sendMark(sid:string,ws:WebSocket,name:string){try{ws.send(JSON.stringify({event:'mark',streamSid:sid,mark:{name}}))}catch{}}
function genTone(ms:number,f=1000){const sr=8000,n=Math.round(ms*sr/1000),u=new Uint8Array(n);for(let i=0;i<n;i++){const x=Math.sin(2*Math.PI*f*i/sr);u[i]=pcmToMulaw(Math.round(x*32767))}return u}
async function sendPrelude(sid:string,ws:WebSocket,ms=300){const n=Math.max(1,Math.round(ms/20)),frames:Uint8Array[]=[];for(let i=0;i<n;i++){const f=new Uint8Array(160);f.fill(0xff);frames.push(f)}await sendToTwilio(frames,sid,ws)}

// ElevenLabs direct TTS removed: Vapi handles TTS and audio transport

async function whisper(wav:Uint8Array){const key=Deno.env.get('OPENAI_API_KEY');if(!key)return'';const form=new FormData();form.append('file',new Blob([wav],{type:'audio/wav'}),'audio.wav');form.append('model',Deno.env.get('OPENAI_TRANSCRIBE_MODEL')||'whisper-1');const r=await fetch('https://api.openai.com/v1/audio/transcriptions',{method:'POST',headers:{Authorization:`Bearer ${key}`},body:form});if(!r.ok){console.error('[WHISPER]',await r.text());return''}const j=await r.json();return j.text||''}

async function kbSearch(tenantId:string, query:string){
  try{
    if(!tenantId||!query) return ''
    const base=supabaseUrl.replace(/\/$/,'')
    const url=`${base}/functions/v1/search`
    const body={tenant_id:tenantId,query,k:6,min_score:0.25}
    const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','Authorization':`Bearer ${supabaseKey}`,'apikey':supabaseKey},body:JSON.stringify(body)})
    if(!r.ok){console.warn('[KB]',r.status,await r.text());return''}
    const j=await r.json() as any
    const rows=(j.results||j||[])
    if(!Array.isArray(rows)) return ''
    const pieces=rows.map((x:any)=>x.content||x.answer||'').filter(Boolean).slice(0,6)
    return pieces.join('\n---\n')
  }catch(e){console.warn('[KB] err',e);return''}
}

async function chatReply(text:string,biz:string,tenantId?:string){
  const key=Deno.env.get('OPENAI_API_KEY');if(!key)return'';
  const rawModel=Deno.env.get('OPENAI_CHAT_MODEL')||'gpt-4o-mini'
  const model=rawModel.replace('gpt-40','gpt-4o')
  const context=await kbSearch(tenantId||'', text)
  const system=`You are the AI receptionist for ${biz}. Use ONLY the provided Business Context when relevant. If info is missing, ask a brief follow-up or say you can take a message. Keep replies to 1–2 sentences.`
  const user=`Question: ${text}\n\nBusiness Context (may be empty):\n${context}`
  const r=await fetch('https://api.openai.com/v1/chat/completions',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},body:JSON.stringify({model,temperature:0.4,messages:[{role:'system',content:system},{role:'user',content:user}]})});
  if(!r.ok){console.error('[CHATGPT]',await r.text());return''}
  const j=await r.json();return j.choices?.[0]?.message?.content||''
}

serve(async (req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:corsHeaders})
  const up=req.headers.get('upgrade')||'';if(up.toLowerCase()!=='websocket')return new Response('Expected Websocket',{status:426})
  // Echo Twilio's requested subprotocol if provided (e.g., 'audio')
  const protocolHeader = req.headers.get('sec-websocket-protocol') || ''
  const protocols = protocolHeader.split(',').map(p=>p.trim()).filter(Boolean)
  const preferredOrder = ['audio','audio.stream.v1']
  const selectedProtocol = protocols.find(p=>preferredOrder.includes(p)) || (protocols[0]||undefined)
  const {socket, response}= selectedProtocol ? Deno.upgradeWebSocket(req,{protocol:selectedProtocol}) : Deno.upgradeWebSocket(req)
  let sid='';let biz='this business';let speaking=false;let init=false;let utterFrames:Uint8Array[]=[];let inUtter=false;let sil=0;let count=0;const RMS=parseInt(Deno.env.get('VAD_SILENCE_RMS')||'700');const MIN=parseInt(Deno.env.get('VAD_MIN_FRAMES')||'15');const END=parseInt(Deno.env.get('VAD_END_FRAMES')||'15');const MAX=parseInt(Deno.env.get('VAD_MAX_FRAMES')||'240')
  let lastTtsAt = 0
  let keepAliveTimer: number | undefined
  function isSilent(f:Uint8Array){let ss=0;for(let i=0;i<f.length;i++){const s=mulawToPcm(f[i]);ss+=s*s}return Math.sqrt(ss/f.length)<RMS}
  socket.onopen=()=>console.log('[WS] up',VERSION)
  socket.onmessage=async (e)=>{try{const d=JSON.parse(e.data);if(d.event==='start'){sid=d.start?.streamSid||d.streamSid||sid;biz=d.start?.customParameters?.businessName||biz;init=true; 
      try { if (DEBUG_VAPI) console.log('[TWILIO start] customParameters', d.start?.customParameters||{}) } catch {}
      if (d.start?.customParameters?.playedGreeting) { (socket as any)._greeted = true }
      // Use voiceId from custom parameters if provided
      try { const vParam = d.start?.customParameters?.voiceId || d.start?.customParameters?.voice_id; if (vParam) (socket as any)._voiceId = vParam } catch {}
      try { const gParam = d.start?.customParameters?.greeting; if (gParam) (socket as any)._greeting = gParam } catch {}
      try {
        const trackInfo = (d.start?.tracks||'') as string
        const forceEnv = (Deno.env.get('TWILIO_FORCE_OUTBOUND_TRACK')||'false').toLowerCase()==='true'
        if (forceEnv || trackInfo==='both' || trackInfo==='outbound' || d.start?.customParameters?.forceOutboundTrack) {
          (socket as any)._includeOutboundTrack = true
        }
      } catch {}
      // Try to hydrate business context from tenant if provided
      try {
        const tenantParam = d.start?.customParameters?.tenantId || d.start?.customParameters?.tenant_id || ''
        if (tenantParam && supabase) {
          const [t, a] = await Promise.all([
            supabase.from('tenants').select('name').eq('id', tenantParam).maybeSingle(),
            supabase.from('agent_settings').select('elevenlabs_voice_id,greeting').eq('tenant_id', tenantParam).maybeSingle()
          ])
          if (t.data?.name) biz = t.data.name
          ;(socket as any)._voiceId = a.data?.elevenlabs_voice_id || (socket as any)._voiceId
          ;(socket as any)._greeting = a.data?.greeting || (socket as any)._greeting
          ;(socket as any)._tenantId = tenantParam
        }
      } catch (err) {
        console.warn('[WS] hydrate biz failed', err)
      }
      // Connect to Vapi realtime using per-call websocket URL from router
      let vapiWs: WebSocket | null = null
      const vapiUrl = (d.start?.customParameters?.vapiUrl || '').trim()
      let vapiVoice = (socket as any)._voiceId || Deno.env.get('ELEVENLABS_VOICE_ID') || ''
      if (vapiUrl) {
        try {
          const url = new URL(vapiUrl)
          vapiWs = new WebSocket(url.toString())
          ;(socket as any)._vapi = vapiWs
          let ttsEndTimer: number | undefined
          vapiWs.onopen = ()=>{
            console.log('[VAPI] Realtime connected')
            // Option A: Let the Vapi Assistant greet itself.
          }
          vapiWs.onerror = (err)=>{ console.error('[VAPI] WS error',err) }
          vapiWs.onclose = (ev)=>{ console.log('[VAPI] WS closed',ev.code,ev.reason) }
          vapiWs.onmessage = async (msg)=>{
            try {
              // If binary audio, treat as PCM16 16kHz directly
              if (typeof msg.data !== 'string') {
                let buf: ArrayBuffer
                if (msg.data instanceof ArrayBuffer) buf = msg.data
                else if ((msg.data as any)?.arrayBuffer) buf = await (msg.data as any).arrayBuffer()
                else return
                const pcm16 = new Int16Array(buf)
                // Downsample 16k -> 8k for Twilio
                const pcm8 = resampleLin(pcm16, 16000, 8000)
                // Encode to μ-law and frame into 160-byte (20ms) chunks
                const ulaw = encPcm16ToUlaw(pcm8)
                const frames: Uint8Array[] = []
                for (let i=0;i<ulaw.length;i+=160){ const f=new Uint8Array(160); const len=Math.min(160,ulaw.length-i); f.set(ulaw.subarray(i,i+len)); if(len<160) f.fill(0xff, len); frames.push(f) }
                await sendToTwilio(frames, sid, socket)
                if(!(socket as any)._greeted){ (socket as any)._greeted = true }
                speaking = true
                lastTtsAt = Date.now()
                if (ttsEndTimer) clearTimeout(ttsEndTimer)
                ttsEndTimer = setTimeout(()=>{ speaking = false }, 500) as unknown as number
                return
              }
              // Otherwise try JSON control/messages (debug unexpected types)
              try {
                const data = JSON.parse(msg.data)
                const type = data?.type || data?.event
                if (DEBUG_VAPI) console.log('[VAPI<-]', type, Object.keys(data||{}))
                if (type==='hangup') {
                  // Do not actively close Twilio WS; let Twilio end the call.
                  // Just stop forwarding and allow graceful drain.
                  try{ const v=(socket as any)._vapi as WebSocket|undefined; if(v){ try{ v.close() }catch{} } }catch{}
                  ;(socket as any)._vapi = null
                  return
                }
              } catch {}
            } catch (err) {
              console.error('[VAPI] onmessage error',err)
            }
          }
        } catch (err) {
          console.error('[VAPI] Failed to connect realtime', err)
        }
      }
      // Prelude frames to prime Twilio stream
      await sendPrelude(sid,socket,300);sendMark(sid,socket,'prelude');
      // Lightweight keepalive: periodic mark to keep intermediaries happy
      try { if (keepAliveTimer) clearInterval(keepAliveTimer) } catch {}
      keepAliveTimer = setInterval(()=>{ try { if (sid) sendMark(sid, socket, 'ka') } catch {} }, 10000) as unknown as number
      if ((socket as any)._greeted !== true) (socket as any)._greeted = false
      sendMark(sid,socket,'greeting')}
    else if(d.event==='media'&&d.media?.payload){const bin=atob(d.media.payload);const u=new Uint8Array(bin.length);for(let i=0;i<bin.length;i++)u[i]=bin.charCodeAt(i);
      // If Vapi WS is open, forward user audio directly; else use local VAD+LLM pipeline
      const vapiWs = (socket as any)._vapi as WebSocket | undefined
      if (vapiWs && vapiWs.readyState===WebSocket.OPEN) {
        // Optional echo-guard: briefly suppress user audio while TTS is still flowing
        if (ECHO_GUARD && speaking && (Date.now()-lastTtsAt) < 200) return
        try {
          const silent=isSilent(u)
          // Convert ulaw(8k) -> pcm16(8k) -> upsample to 16k
          const pcm8 = new Int16Array(u.length)
          for (let i=0;i<u.length;i++) pcm8[i] = mulawToPcm(u[i])
          const pcm16 = resampleLin(pcm8, 8000, 16000)
          // Always forward audio to Vapi (server VAD handles pauses)
          if (VAPI_BINARY_IN) {
            if (DEBUG_VAPI) console.log('[VAPI->] binary chunk', pcm16.byteLength)
            vapiWs.send(pcm16.buffer)
          } else {
            const bytes = new Uint8Array(pcm16.buffer, pcm16.byteOffset, pcm16.byteLength)
            let bin=''; for(let i=0;i<bytes.length;i++) bin+=String.fromCharCode(bytes[i])
            const b64=btoa(bin)
            const msg = { type: VAPI_AUDIO_IN_EVENT, data: b64 }
            if (DEBUG_VAPI) console.log('[VAPI->]', msg.type, 'len', bytes.length)
            vapiWs.send(JSON.stringify(msg))
          }

          // Local VAD for explicit end-of-user signal
          if (!silent) {
            if (!inUtter) { inUtter = true; count = 0; sil = 0 }
            count++
          } else if (inUtter) {
            sil++
          }
          // End of utterance detection -> notify Vapi so it can respond
          const have = count >= MIN
          const end = inUtter && sil >= END
          const cap = inUtter && count >= MAX
          if (have && (end || cap)) {
            try { 
              const endMsg = { type: VAPI_AUDIO_END_EVENT }
              if (DEBUG_VAPI) console.log('[VAPI->]', endMsg.type)
              vapiWs.send(JSON.stringify(endMsg))
              if (DEBUG_AUDIO) console.log('[VAPI] sent end-of-user')
            } catch {}
            inUtter = false; count = 0; sil = 0
          }
          if (DEBUG_AUDIO) { try { (socket as any)._dbg = ((socket as any)._dbg||0) + pcm16.length } catch {} }
        } catch(err) { console.error('[VAPI] forward audio error',err) }
        return
      }
      if(speaking)return;const silent=isSilent(u);if(!silent){if(!inUtter){inUtter=true;count=0;utterFrames=[]}sil=0;count++;utterFrames.push(u)}else{if(inUtter)sil++}const have=count>=MIN;const end=inUtter&&sil>=END;const cap=inUtter&&count>=MAX;if(have&&(end||cap)){const frames=utterFrames;inUtter=false;count=0;sil=0;utterFrames=[];(async()=>{try{const pcm=ulawFramesToPcm16(frames);const wav=wavFromPcm16(pcm,8000);const text=await whisper(wav);if(!text){const v=(socket as any)._voiceId||'';const vapi=(socket as any)._vapi as WebSocket|undefined; if(vapi&&vapi.readyState===WebSocket.OPEN){vapi.send(JSON.stringify({type:'tts', text:"I didn't catch that. Please repeat.", voiceId:v}))}return}const reply=(await chatReply(text,biz,(socket as any)._tenantId)).trim()||"I'm sorry, could you please repeat that?";const vapi=(socket as any)._vapi as WebSocket|undefined; if(vapi&&vapi.readyState===WebSocket.OPEN){vapi.send(JSON.stringify({type:'tts', text:reply, voiceId:((socket as any)._voiceId||'')}))}}catch(err){console.error('[LOOP]',err);speaking=false}})()}}
    else if(d.event==='stop'){try{const st=(outbound as any).get?.(socket);if(st){st.cancel=true;st.q.length=0}}catch{}}}catch(err){console.error('[ERR]',err)}}
  socket.onerror=(e)=>console.error('[WSERR]',e)
  socket.onclose=()=>{try{const st=(outbound as any).get?.(socket);if(st){st.cancel=true;st.q.length=0}}
    catch{} try{ const v=(socket as any)._vapi as WebSocket|undefined; if(v){ try{ v.close() }catch{} (socket as any)._vapi=null } }catch{}
    try { if (keepAliveTimer) clearInterval(keepAliveTimer) } catch {}
  }
  return response
})
