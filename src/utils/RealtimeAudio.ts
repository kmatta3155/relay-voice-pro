/* Realtime audio/WebRTC helpers — OpenAI Realtime API (GA, SDP/WebRTC) */
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

  async init(options?: {
    tenantId?: string;
    instructions?: string;
    voice?: 'alloy' | 'ash' | 'ballad' | 'coral' | 'echo' | 'sage' | 'shimmer' | 'verse';
  }) {
    // 1) Create peer connection and wire audio
    this.pc = new RTCPeerConnection();
    this.pc.ontrack = (e) => {
      try { this.remoteAudioEl.srcObject = e.streams[0]; } catch (_) {}
    };

    // 2) Add local microphone
    const ms = await navigator.mediaDevices.getUserMedia({ audio: true });
    this.pc.addTrack(ms.getTracks()[0]);

    // 3) Data channel for OpenAI events
    let resolvedInstructions = options?.instructions || '';
    this.dc = this.pc.createDataChannel('oai-events');
    this.dc.onmessage = (e) => {
      const evt = JSON.parse(e.data);
      this.onEvent?.(evt);

      if (evt.type === 'session.created') {
        const sessionUpdate = {
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            voice: options?.voice || 'alloy',
            instructions: resolvedInstructions || 'You are a helpful, friendly AI voice assistant.',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 1000,
            },
            tool_choice: 'auto',
            max_response_output_tokens: 'inf',
          },
        } as const;
        this.dc?.send(JSON.stringify(sessionUpdate));
        this.dc?.send(JSON.stringify({ type: 'response.create' }));
      }
    };

    // 4) Create SDP offer
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);

    // 5) Send SDP to edge function (proxies to OpenAI with server-side API key)
    const { data, error } = await supabase.functions.invoke('realtime-session', {
      body: {
        sdp: offer.sdp,
        tenant_id: options?.tenantId,
        voice: options?.voice || 'alloy',
      },
    });

    if (error) throw new Error(error.message || 'Failed to negotiate realtime session');
    if (!data?.sdp) throw new Error('No SDP answer received from server');

    // Use server-fetched instructions (tenant system prompt) if available
    if (data.instructions) resolvedInstructions = data.instructions;

    // 6) Set remote description to complete WebRTC handshake
    await this.pc.setRemoteDescription({ type: 'answer' as RTCSdpType, sdp: data.sdp });
  }

  async sendMessage(text: string) {
    if (!this.dc || this.dc.readyState !== 'open') throw new Error('Not connected');
    const event = {
      type: 'conversation.item.create',
      item: { type: 'message', role: 'user', content: [{ type: 'input_text', text }] },
    };
    this.dc.send(JSON.stringify(event));
    this.dc.send(JSON.stringify({ type: 'response.create' }));
  }

  disconnect() {
    try { this.dc?.close(); } catch (_) {}
    try { this.pc?.close(); } catch (_) {}
    this.dc = null;
    this.pc = null;
  }
}
