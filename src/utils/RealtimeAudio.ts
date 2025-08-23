/* Realtime audio/WebRTC helpers for OpenAI Realtime API */
import { supabase } from '@/integrations/supabase/client';

export type RealtimeEventHandler = (event: any) => void;

export class RealtimeChat {
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private remoteAudioEl: HTMLAudioElement;
  private onEvent: RealtimeEventHandler;

  constructor(onEvent: RealtimeEventHandler) {
    this.onEvent = onEvent;
    this.remoteAudioEl = document.createElement('audio');
    this.remoteAudioEl.autoplay = true;
  }

  async init(options?: { tenantId?: string; instructions?: string; voice?: 'alloy'|'ash'|'ballad'|'coral'|'echo'|'sage'|'shimmer'|'verse' }) {
    // 1) Get ephemeral token from Edge Function
    const { data, error } = await supabase.functions.invoke('realtime-session', {
      body: {
        tenant_id: options?.tenantId,
        instructions: options?.instructions,
        voice: options?.voice || 'alloy'
      }
    });

    if (error) throw new Error(error.message || 'Failed to get ephemeral token');
    if (!data?.client_secret?.value) throw new Error('Invalid token response');
    const EPHEMERAL_KEY: string = data.client_secret.value;

    // 2) Create peer connection
    this.pc = new RTCPeerConnection();

    // 3) Handle remote audio track
    this.pc.ontrack = (e) => {
      try { this.remoteAudioEl.srcObject = e.streams[0]; } catch (_) {}
    };

    // 4) Add local microphone track
    const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.pc.addTrack(ms.getTracks()[0]);

    // 5) Data channel for events
    this.dc = this.pc.createDataChannel('oai-events');
    this.dc.onmessage = (e) => {
      const evt = JSON.parse(e.data);
      // Surface to caller
      this.onEvent?.(evt);

      // After session.created, send session.update to configure
      if (evt.type === 'session.created') {
        const sessionUpdate = {
          type: 'session.update',
          session: {
            modalities: ['text','audio'],
            voice: options?.voice || 'alloy',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 1000
            },
            tool_choice: 'auto',
            max_response_output_tokens: 'inf'
          }
        } as const;
        this.dc?.send(JSON.stringify(sessionUpdate));
        // Trigger greeting
        this.dc?.send(JSON.stringify({ type: 'response.create' }));
      }
    };

    // 6) Create and set local description
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // 7) POST SDP to OpenAI and set remote answer
    const sdpResponse = await fetch(`https://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17`, {
      method: 'POST',
      body: offer.sdp || '',
      headers: {
        Authorization: `Bearer ${EPHEMERAL_KEY}`,
        'Content-Type': 'application/sdp'
      },
    });

    const answer = { type: 'answer' as RTCSdpType, sdp: await sdpResponse.text() };
    await this.pc.setRemoteDescription(answer);
  }

  async sendMessage(text: string) {
    if (!this.dc || this.dc.readyState !== 'open') throw new Error('Not connected');
    const event = {
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] }
    };
    this.dc.send(JSON.stringify(event));
    this.dc.send(JSON.stringify({ type: 'response.create' }));
  }

  disconnect() {
    try { this.dc?.close(); } catch(_){}
    try { this.pc?.close(); } catch(_){}
    this.dc = null;
    this.pc = null;
  }
}
