import React, { useState, useRef, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { Mic, MicOff, Phone, PhoneOff, Bot, User, Volume2, VolumeX } from 'lucide-react';

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
  type?: 'transcription' | 'agent_response' | 'system';
}

// Audio utilities for OpenAI Realtime API
class AudioRecorder {
  private stream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private processor: ScriptProcessorNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;

  constructor(private onAudioData: (audioData: Float32Array) => void) {}

  async start() {
    try {
      console.log('🎤 Starting audio recorder...');
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 24000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });

      this.audioContext = new AudioContext({
        sampleRate: 24000,
      });

      this.source = this.audioContext.createMediaStreamSource(this.stream);
      this.processor = this.audioContext.createScriptProcessor(4096, 1, 1);
      
      this.processor.onaudioprocess = (e) => {
        const inputData = e.inputBuffer.getChannelData(0);
        this.onAudioData(new Float32Array(inputData));
      };

      this.source.connect(this.processor);
      this.processor.connect(this.audioContext.destination);
      
      console.log('✅ Audio recorder started');
    } catch (error) {
      console.error('❌ Error accessing microphone:', error);
      throw error;
    }
  }

  stop() {
    console.log('🛑 Stopping audio recorder...');
    if (this.source) {
      this.source.disconnect();
      this.source = null;
    }
    if (this.processor) {
      this.processor.disconnect();
      this.processor = null;
    }
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
    }
    console.log('✅ Audio recorder stopped');
  }
}

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

const createWavFromPCM = (pcmData: Uint8Array): Uint8Array => {
  console.log(`🎵 Creating WAV from PCM data: ${pcmData.length} bytes`);
  
  // Convert bytes to 16-bit samples (little-endian)
  const int16Data = new Int16Array(pcmData.length / 2);
  for (let i = 0; i < pcmData.length; i += 2) {
    int16Data[i / 2] = (pcmData[i + 1] << 8) | pcmData[i];
  }
  
  // WAV header parameters
  const sampleRate = 24000;
  const numChannels = 1;
  const bitsPerSample = 16;
  const blockAlign = (numChannels * bitsPerSample) / 8;
  const byteRate = sampleRate * blockAlign;
  
  // Create WAV header (44 bytes)
  const wavHeader = new ArrayBuffer(44);
  const view = new DataView(wavHeader);
  
  const writeString = (view: DataView, offset: number, string: string) => {
    for (let i = 0; i < string.length; i++) {
      view.setUint8(offset + i, string.charCodeAt(i));
    }
  };
  
  // Write WAV header
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
  
  // Combine header and data
  const wavArray = new Uint8Array(wavHeader.byteLength + int16Data.byteLength);
  wavArray.set(new Uint8Array(wavHeader), 0);
  wavArray.set(new Uint8Array(int16Data.buffer), wavHeader.byteLength);
  
  console.log(`✅ WAV created: ${wavArray.length} bytes`);
  return wavArray;
};

class AudioQueue {
  private queue: Uint8Array[] = [];
  private isPlaying = false;
  private audioContext: AudioContext;

  constructor(audioContext: AudioContext) {
    this.audioContext = audioContext;
  }

  async addToQueue(audioData: Uint8Array) {
    console.log(`🔊 Adding audio to queue: ${audioData.length} bytes`);
    this.queue.push(audioData);
    if (!this.isPlaying) {
      await this.playNext();
    }
  }

  private async playNext() {
    if (this.queue.length === 0) {
      this.isPlaying = false;
      console.log('🔇 Audio queue empty, stopped playing');
      return;
    }

    this.isPlaying = true;
    const audioData = this.queue.shift()!;

    try {
      console.log(`🎵 Playing audio chunk: ${audioData.length} bytes`);
      const wavData = createWavFromPCM(audioData);
      const audioBuffer = await this.audioContext.decodeAudioData(wavData.buffer);
      
      const source = this.audioContext.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(this.audioContext.destination);
      
      source.onended = () => {
        console.log('🎵 Audio chunk finished, playing next...');
        this.playNext();
      };
      
      source.start(0);
      console.log('✅ Audio chunk started playing');
    } catch (error) {
      console.error('❌ Error playing audio chunk:', error);
      this.playNext(); // Continue with next segment even if current fails
    }
  }

  clear() {
    console.log('🗑️ Clearing audio queue');
    this.queue = [];
    this.isPlaying = false;
  }
}

export default function AdminAgentTester({ open, onOpenChange, agent, tenantId }: AdminAgentTesterProps) {
  const { toast } = useToast();
  
  // State management
  const [messages, setMessages] = useState<Message[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isListening, setIsListening] = useState(false);

  // Refs
  const wsRef = useRef<WebSocket | null>(null);
  const audioRecorderRef = useRef<AudioRecorder | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioQueueRef = useRef<AudioQueue | null>(null);
  const currentTranscriptRef = useRef<string>('');

  const addMessage = useCallback((role: 'user' | 'assistant', content: string, type?: string) => {
    const message: Message = {
      id: `${Date.now()}-${Math.random()}`,
      role,
      content,
      timestamp: new Date(),
      type: type as any
    };
    setMessages(prev => [...prev, message]);
    return message.id;
  }, []);

  const playAudioData = useCallback(async (audioData: Uint8Array) => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    if (!audioQueueRef.current) {
      audioQueueRef.current = new AudioQueue(audioContextRef.current);
    }
    await audioQueueRef.current.addToQueue(audioData);
  }, []);

  const startConversation = useCallback(async () => {
    try {
      setIsConnecting(true);
      console.log('🚀 Starting AI agent conversation...');

      // Request microphone permission first
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (micError) {
        console.error('❌ Microphone permission denied:', micError);
        toast({
          title: "Microphone Required",
          description: "Please allow microphone access to test the AI agent",
          variant: "destructive"
        });
        return;
      }

      addMessage('assistant', '🔄 Connecting to AI agent...', 'system');

      // Connect to our Supabase edge function WebSocket
      const wsUrl = `wss://gnqqktmslswgjtvxfvdo.functions.supabase.co/realtime-session`;
      console.log(`🔗 Connecting to: ${wsUrl}`);
      
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = async () => {
        console.log('✅ WebSocket connected');
        setIsConnected(true);
        setIsConnecting(false);
        
        toast({
          title: "Connected",
          description: `Connected to ${agent.name || 'AI Agent'}`,
        });

        // Start audio recording
        try {
          const recorder = new AudioRecorder((audioData) => {
            if (ws.readyState === WebSocket.OPEN) {
              const base64Audio = encodeAudioForAPI(audioData);
              ws.send(JSON.stringify({
                type: 'input_audio_buffer.append',
                audio: base64Audio
              }));
            }
          });
          
          await recorder.start();
          audioRecorderRef.current = recorder;
          setIsListening(true);
          console.log('✅ Audio recording started');
          
        } catch (error) {
          console.error('❌ Failed to start audio recording:', error);
          toast({
            title: "Audio Error",
            description: "Failed to start audio recording",
            variant: "destructive"
          });
        }
      };

      ws.onmessage = async (event) => {
        const data = JSON.parse(event.data);
        console.log(`📥 Received: ${data.type}`);

        switch (data.type) {
          case 'session.created':
            console.log('✅ Session created');
            addMessage('assistant', '🎯 AI agent session started', 'system');
            break;

          case 'session.updated':
            console.log('✅ Session updated');
            break;

          case 'response.audio.delta':
            // Convert base64 to Uint8Array and play
            const binaryString = atob(data.delta);
            const bytes = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            await playAudioData(bytes);
            setIsSpeaking(true);
            break;

          case 'response.audio.done':
            console.log('🔇 Audio response completed');
            setIsSpeaking(false);
            break;

          case 'response.audio_transcript.delta':
            // Accumulate transcript
            currentTranscriptRef.current += data.delta;
            break;

          case 'response.audio_transcript.done':
            // Add completed transcript as message
            if (currentTranscriptRef.current.trim()) {
              addMessage('assistant', currentTranscriptRef.current.trim(), 'agent_response');
              currentTranscriptRef.current = '';
            }
            break;

          case 'conversation.item.input_audio_transcription.completed':
            // User speech transcription
            if (data.transcript?.trim()) {
              addMessage('user', data.transcript.trim(), 'transcription');
            }
            break;

          case 'error':
            console.error('❌ WebSocket error:', data.error);
            toast({
              title: "Connection Error",
              description: data.error,
              variant: "destructive"
            });
            break;

          default:
            console.log(`ℹ️ Unhandled message type: ${data.type}`);
        }
      };

      ws.onerror = (error) => {
        console.error('❌ WebSocket error:', error);
        toast({
          title: "Connection Error",
          description: "Failed to connect to AI agent",
          variant: "destructive"
        });
        setIsConnecting(false);
        setIsConnected(false);
      };

      ws.onclose = () => {
        console.log('🔌 WebSocket closed');
        setIsConnected(false);
        setIsConnecting(false);
        setIsSpeaking(false);
        setIsListening(false);
      };

    } catch (error) {
      console.error('❌ Failed to start conversation:', error);
      toast({
        title: "Connection Failed",
        description: "Unable to start AI agent conversation",
        variant: "destructive"
      });
      setIsConnecting(false);
    }
  }, [addMessage, toast, agent.name, playAudioData]);

  const endConversation = useCallback(() => {
    console.log('🛑 Ending conversation...');
    
    // Stop audio recording
    if (audioRecorderRef.current) {
      audioRecorderRef.current.stop();
      audioRecorderRef.current = null;
    }

    // Clear audio queue
    if (audioQueueRef.current) {
      audioQueueRef.current.clear();
    }

    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }

    setIsConnected(false);
    setIsConnecting(false);
    setIsSpeaking(false);
    setIsListening(false);
    currentTranscriptRef.current = '';
    
    toast({
      title: "Call Ended",
      description: "AI agent conversation ended",
    });
  }, [toast]);

  const handleDialogClose = useCallback((open: boolean) => {
    if (!open) {
      endConversation();
      setMessages([]);
    }
    onOpenChange(open);
  }, [endConversation, onOpenChange]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      endConversation();
    };
  }, [endConversation]);

  return (
    <Dialog open={open} onOpenChange={handleDialogClose}>
      <DialogContent className="max-w-3xl h-[700px] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Test AI Agent: {agent.name || 'AI Assistant'}
          </DialogTitle>
          <DialogDescription>
            Real-time voice conversation with OpenAI Realtime API. Production-ready testing environment.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {/* Status Bar */}
          <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-3">
              <Badge 
                variant={isConnected ? 'default' : isConnecting ? 'secondary' : 'outline'}
                className="capitalize"
              >
                {isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Disconnected'}
              </Badge>
              {isSpeaking && (
                <Badge variant="outline" className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <Volume2 className="h-3 w-3" />
                  AI Speaking
                </Badge>
              )}
              {isListening && (
                <Badge variant="outline" className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  <Mic className="h-3 w-3" />
                  Listening
                </Badge>
              )}
            </div>
            
            <div className="flex gap-2">
              {!isConnected ? (
                <Button 
                  onClick={startConversation} 
                  disabled={isConnecting}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Phone className="h-4 w-4 mr-2" />
                  {isConnecting ? 'Connecting...' : 'Start Voice Call'}
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
          <div className="flex-1 border rounded-lg p-4 overflow-y-auto bg-gradient-to-b from-background to-muted/20">
            {messages.length === 0 ? (
              <div className="text-center text-muted-foreground py-12">
                {isConnecting ? (
                  <div className="flex flex-col items-center gap-3">
                    <Phone className="h-12 w-12 animate-pulse text-primary" />
                    <p className="text-lg font-medium">Connecting to OpenAI Realtime API...</p>
                    <p>Setting up voice conversation</p>
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    </div>
                  </div>
                ) : isConnected ? (
                  <div className="flex flex-col items-center gap-3">
                    <Mic className="h-12 w-12 text-primary" />
                    <p className="text-lg font-medium">Voice conversation active</p>
                    <p>Speak naturally with the AI agent</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Phone className="h-12 w-12 text-muted-foreground" />
                    <p className="text-lg font-medium">OpenAI Realtime API</p>
                    <p>Click "Start Voice Call" to begin real-time voice testing</p>
                    <div className="text-sm text-muted-foreground mt-4 max-w-md">
                      <p className="font-medium">Production Features:</p>
                      <ul className="list-disc list-inside mt-2 space-y-1">
                        <li>Real-time voice conversation</li>
                        <li>Natural speech recognition</li>
                        <li>Professional AI responses</li>
                        <li>Same tech as landing page demo</li>
                      </ul>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <div key={message.id} className={`flex gap-3 ${message.role === 'assistant' ? '' : 'flex-row-reverse'}`}>
                    <div className={`flex-shrink-0 p-2 rounded-full ${
                      message.role === 'assistant' 
                        ? message.type === 'system' 
                          ? 'bg-muted' 
                          : 'bg-primary' 
                        : 'bg-secondary'
                    }`}>
                      {message.role === 'assistant' ? 
                        <Bot className={`h-4 w-4 ${message.type === 'system' ? 'text-muted-foreground' : 'text-primary-foreground'}`} /> : 
                        <User className="h-4 w-4" />
                      }
                    </div>
                    <Card className={`max-w-[75%] ${
                      message.role === 'assistant' 
                        ? message.type === 'system'
                          ? 'bg-muted/50'
                          : 'bg-card' 
                        : 'bg-primary text-primary-foreground'
                    }`}>
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm leading-relaxed">{message.content}</p>
                          {message.type && (
                            <Badge variant="outline" className="text-xs">
                              {message.type.replace('_', ' ')}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs opacity-70 mt-2">
                          {message.timestamp.toLocaleTimeString()}
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Voice instructions */}
          {isConnected && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-start gap-2">
                <Mic className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-100">Real-time Voice Active</p>
                  <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
                    Speak naturally to test the AI agent. Try asking about business hours, services, pricing, or booking appointments.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}