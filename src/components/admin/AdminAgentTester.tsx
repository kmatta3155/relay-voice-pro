import React, { useState, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Mic, MicOff, Phone, PhoneOff, Bot, User } from 'lucide-react';

interface AdminAgentTesterProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: any;
  tenantId: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export default function AdminAgentTester({ open, onOpenChange, agent, tenantId }: AdminAgentTesterProps) {
  const { toast } = useToast();
  const [isConnected, setIsConnected] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  
  const wsRef = useRef<WebSocket | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const recorderRef = useRef<any>(null);
  const audioQueueRef = useRef<Uint8Array[]>([]);
  const isPlayingRef = useRef(false);

  const addMessage = (role: 'user' | 'assistant', content: string) => {
    const message: Message = {
      id: Date.now().toString(),
      role,
      content,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, message]);
  };

  const createWavFromPCM = (pcmData: Uint8Array) => {
    const int16Data = new Int16Array(pcmData.length / 2);
    for (let i = 0; i < pcmData.length; i += 2) {
      int16Data[i / 2] = (pcmData[i + 1] << 8) | pcmData[i];
    }
    
    const wavHeader = new ArrayBuffer(44);
    const view = new DataView(wavHeader);
    
    const writeString = (view: DataView, offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
      }
    };

    const sampleRate = 24000;
    const numChannels = 1;
    const bitsPerSample = 16;
    const blockAlign = (numChannels * bitsPerSample) / 8;
    const byteRate = sampleRate * blockAlign;

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + int16Data.byteLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeString(view, 36, 'data');
    view.setUint32(40, int16Data.byteLength, true);
    
    const wavArray = new Uint8Array(wavHeader.byteLength + int16Data.byteLength);
    wavArray.set(new Uint8Array(wavHeader), 0);
    wavArray.set(new Uint8Array(int16Data.buffer), wavHeader.byteLength);
    
    return wavArray;
  };

  const playNextAudio = async () => {
    if (audioQueueRef.current.length === 0 || !audioContextRef.current) {
      isPlayingRef.current = false;
      setIsSpeaking(false);
      return;
    }

    isPlayingRef.current = true;
    setIsSpeaking(true);
    
    const audioData = audioQueueRef.current.shift()!;

    try {
      const wavData = createWavFromPCM(audioData);
      const audioBuffer = await audioContextRef.current.decodeAudioData(wavData.buffer);
      
      const source = audioContextRef.current.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(audioContextRef.current.destination);
      
      source.onended = () => playNextAudio();
      source.start(0);
    } catch (error) {
      console.error('Error playing audio:', error);
      playNextAudio();
    }
  };

  const addToAudioQueue = async (audioData: Uint8Array) => {
    audioQueueRef.current.push(audioData);
    if (!isPlayingRef.current) {
      await playNextAudio();
    }
  };

  const encodeAudioForAPI = (float32Array: Float32Array): string => {
    const int16Array = new Int16Array(float32Array.length);
    for (let i = 0; i < float32Array.length; i++) {
      const s = Math.max(-1, Math.min(1, float32Array[i]));
      int16Array[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
    }
    
    const uint8Array = new Uint8Array(int16Array.buffer);
    let binary = '';
    const chunkSize = 0x8000;
    
    for (let i = 0; i < uint8Array.length; i += chunkSize) {
      const chunk = uint8Array.subarray(i, Math.min(i + chunkSize, uint8Array.length));
      binary += String.fromCharCode.apply(null, Array.from(chunk));
    }
    
    return btoa(binary);
  };

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      if (!audioContextRef.current) {
        audioContextRef.current = new AudioContext({ sampleRate: 24000 });
      }

      const source = audioContextRef.current.createMediaStreamSource(stream);
      const processor = audioContextRef.current.createScriptProcessor(4096, 1, 1);
      
      processor.onaudioprocess = (e) => {
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          const inputData = e.inputBuffer.getChannelData(0);
          const audioData = encodeAudioForAPI(new Float32Array(inputData));
          
          wsRef.current.send(JSON.stringify({
            type: 'input_audio_buffer.append',
            audio: audioData
          }));
        }
      };
      
      source.connect(processor);
      processor.connect(audioContextRef.current.destination);
      
      recorderRef.current = { stream, source, processor };
      setIsRecording(true);
    } catch (error) {
      console.error('Error starting recording:', error);
      toast({
        title: "Recording Error",
        description: "Could not access microphone",
        variant: "destructive"
      });
    }
  };

  const stopRecording = () => {
    if (recorderRef.current) {
      recorderRef.current.source.disconnect();
      recorderRef.current.processor.disconnect();
      recorderRef.current.stream.getTracks().forEach((track: any) => track.stop());
      recorderRef.current = null;
      setIsRecording(false);
    }
  };

  const startConversation = async () => {
    try {
      setConnectionStatus('connecting');
      
      // Get session from our edge function
      const { data: sessionData, error } = await supabase.functions.invoke('realtime-session', {
        body: {
          instructions: agent.system_prompt,
          voice: 'alloy'
        }
      });

      if (error) throw error;

      const ephemeralKey = sessionData.client_secret.value;
      
      // Connect to OpenAI Realtime API
      const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17`);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('WebSocket connected');
        // Send auth and session update
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: agent.system_prompt,
            voice: 'alloy',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: { model: 'whisper-1' },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 1000
            },
            temperature: 0.8
          }
        }));
      };

      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        console.log('Received:', data.type, data);

        if (data.type === 'session.created') {
          setConnectionStatus('connected');
          setIsConnected(true);
          await startRecording();
          toast({
            title: "Connected",
            description: "Voice interface is ready"
          });
        } else if (data.type === 'response.audio.delta') {
          const binaryString = atob(data.delta);
          const bytes = new Uint8Array(binaryString.length);
          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }
          await addToAudioQueue(bytes);
        } else if (data.type === 'response.audio_transcript.delta') {
          // Handle streaming transcript
        } else if (data.type === 'response.audio_transcript.done') {
          if (data.transcript) {
            addMessage('assistant', data.transcript);
          }
        } else if (data.type === 'conversation.item.input_audio_transcription.completed') {
          if (data.transcript) {
            addMessage('user', data.transcript);
          }
        }
      };

      ws.onerror = (error) => {
        console.error('WebSocket error:', error);
        toast({
          title: "Connection Error",
          description: "Failed to connect to voice service",
          variant: "destructive"
        });
        setConnectionStatus('disconnected');
      };

      ws.onclose = () => {
        console.log('WebSocket closed');
        setIsConnected(false);
        setConnectionStatus('disconnected');
        stopRecording();
      };

      // Send authorization
      ws.addEventListener('open', () => {
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            authorization: { type: 'bearer', token: ephemeralKey }
          }
        }));
      });

    } catch (error) {
      console.error('Error starting conversation:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : 'Failed to start conversation',
        variant: "destructive"
      });
      setConnectionStatus('disconnected');
    }
  };

  const endConversation = () => {
    stopRecording();
    wsRef.current?.close();
    setIsConnected(false);
    setConnectionStatus('disconnected');
    setIsSpeaking(false);
    audioQueueRef.current = [];
    isPlayingRef.current = false;
  };

  useEffect(() => {
    return () => {
      endConversation();
      audioContextRef.current?.close();
    };
  }, []);

  const handleDialogClose = (open: boolean) => {
    if (!open) {
      endConversation();
      setMessages([]);
    }
    onOpenChange(open);
  };

  return (
    <Dialog open={open} onOpenChange={handleDialogClose}>
      <DialogContent className="max-w-2xl h-[600px] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Test AI Agent: {agent.name}
          </DialogTitle>
          <DialogDescription>
            Test the voice conversation with your customer's AI agent
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {/* Status Bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant={connectionStatus === 'connected' ? 'default' : 'secondary'}>
                {connectionStatus}
              </Badge>
              {isSpeaking && <Badge variant="outline">Agent Speaking</Badge>}
              {isRecording && <Badge variant="outline">Recording</Badge>}
            </div>
            
            <div className="flex gap-2">
              {!isConnected ? (
                <Button onClick={startConversation} disabled={connectionStatus === 'connecting'}>
                  <Phone className="h-4 w-4 mr-2" />
                  {connectionStatus === 'connecting' ? 'Connecting...' : 'Start Call'}
                </Button>
              ) : (
                <Button onClick={endConversation} variant="destructive">
                  <PhoneOff className="h-4 w-4 mr-2" />
                  End Call
                </Button>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 border rounded-lg p-4 overflow-y-auto bg-muted/30">
            {messages.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                {isConnected ? 'Start speaking to test the agent...' : 'Click "Start Call" to begin testing'}
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <div key={message.id} className={`flex gap-3 ${message.role === 'assistant' ? '' : 'flex-row-reverse'}`}>
                    <div className={`p-2 rounded-full ${message.role === 'assistant' ? 'bg-primary' : 'bg-muted'}`}>
                      {message.role === 'assistant' ? 
                        <Bot className="h-4 w-4 text-primary-foreground" /> : 
                        <User className="h-4 w-4" />
                      }
                    </div>
                    <Card className={`max-w-[80%] ${message.role === 'assistant' ? '' : 'bg-primary text-primary-foreground'}`}>
                      <CardContent className="p-3">
                        <p className="text-sm">{message.content}</p>
                        <p className="text-xs opacity-70 mt-1">
                          {message.timestamp.toLocaleTimeString()}
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recording Status */}
          {isConnected && (
            <div className="flex items-center justify-center gap-2 p-2 bg-muted rounded-lg">
              {isRecording ? (
                <>
                  <Mic className="h-4 w-4 text-red-500 animate-pulse" />
                  <span className="text-sm">Listening...</span>
                </>
              ) : (
                <>
                  <MicOff className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm">Microphone inactive</span>
                </>
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}