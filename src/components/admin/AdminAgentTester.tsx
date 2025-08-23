import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { Bot, Mic, Phone, PhoneOff, User, Volume2 } from 'lucide-react';
import { RealtimeChat } from '@/utils/RealtimeAudio';

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

export default function AdminAgentTester({ open, onOpenChange, agent, tenantId }: AdminAgentTesterProps) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);

  const chatRef = useRef<RealtimeChat | null>(null);
  const transcriptRef = useRef<string>('');

  const addMessage = useCallback((role: 'user' | 'assistant', content: string, type?: Message['type']) => {
    const msg: Message = { id: `${Date.now()}-${Math.random()}`, role, content, timestamp: new Date(), type };
    setMessages(prev => [...prev, msg]);
  }, []);

  const handleEvent = useCallback((event: any) => {
    // Debug all events
    console.log('Realtime event:', event?.type || event);

    switch (event.type) {
      case 'session.created':
        addMessage('assistant', '🎯 AI agent session started', 'system');
        break;
      case 'response.audio.delta':
        setIsSpeaking(true);
        break;
      case 'response.audio.done':
        setIsSpeaking(false);
        break;
      case 'response.audio_transcript.delta':
        transcriptRef.current += event.delta || '';
        break;
      case 'response.audio_transcript.done':
        if (transcriptRef.current.trim()) {
          addMessage('assistant', transcriptRef.current.trim(), 'agent_response');
          transcriptRef.current = '';
        }
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript?.trim()) addMessage('user', event.transcript.trim(), 'transcription');
        break;
      default:
        break;
    }
  }, [addMessage]);

  const startConversation = useCallback(async () => {
    try {
      setIsConnecting(true);
      addMessage('assistant', '🔄 Connecting to AI agent...', 'system');

      // Ask mic permission upfront to improve UX
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const chat = new RealtimeChat(handleEvent);
      chatRef.current = chat;

      await chat.init({
        voice: 'alloy',
        instructions: `You are ${agent.name || 'an AI receptionist'} for tenant ${tenantId}. 
Answer professionally about hours, pricing, services, availability, and booking steps. Always be concise and helpful.`
      });

      setIsConnected(true);
      toast({ title: 'Connected', description: `Connected to ${agent.name || 'AI Agent'}` });
    } catch (error: any) {
      console.error('Start conversation error:', error);
      toast({ title: 'Connection Error', description: error?.message || 'Failed to connect to AI agent', variant: 'destructive' });
      setIsConnected(false);
    } finally {
      setIsConnecting(false);
    }
  }, [agent?.name, tenantId, handleEvent, addMessage, toast]);

  const endConversation = useCallback(() => {
    try { chatRef.current?.disconnect(); } catch(_) {}
    chatRef.current = null;
    setIsConnected(false);
    setIsSpeaking(false);
    toast({ title: 'Call Ended', description: 'AI agent conversation ended' });
  }, [toast]);

  const handleDialogClose = useCallback((open: boolean) => {
    if (!open) {
      endConversation();
      setMessages([]);
    }
    onOpenChange(open);
  }, [endConversation, onOpenChange]);

  const testMessages = [
    'What are your business hours?',
    'How much does a massage cost?',
    "I'd like to book an appointment",
    'What services do you offer?',
    'Do you have availability this week?'
  ];

  const handleTestMessage = async (text: string) => {
    if (!isConnected || !chatRef.current) {
      toast({ title: 'Not Connected', description: 'Start the voice call first', variant: 'destructive' });
      return;
    }
    addMessage('user', text, 'transcription');
    try {
      await chatRef.current.sendMessage(text);
    } catch (e: any) {
      toast({ title: 'Send Error', description: e?.message || 'Failed to send message', variant: 'destructive' });
    }
  };

  useEffect(() => () => { chatRef.current?.disconnect(); }, []);

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
          <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-3">
              <Badge variant={isConnected ? 'default' : isConnecting ? 'secondary' : 'outline'} className="capitalize">
                {isConnected ? 'Connected' : isConnecting ? 'Connecting' : 'Disconnected'}
              </Badge>
              {isSpeaking && (
                <Badge variant="outline" className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <Volume2 className="h-3 w-3" />
                  AI Speaking
                </Badge>
              )}
            </div>
            <div className="flex gap-2">
              {!isConnected ? (
                <Button onClick={startConversation} disabled={isConnecting} className="bg-green-600 hover:bg-green-700">
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

          <div className="flex-1 border rounded-lg p-4 overflow-y-auto bg-gradient-to-b from-background to-muted/20">
            {messages.length === 0 ? (
              <div className="text-center text-muted-foreground py-12">
                {isConnecting ? (
                  <div className="flex flex-col items-center gap-3">
                    <Phone className="h-12 w-12 animate-pulse text-primary" />
                    <p className="text-lg font-medium">Connecting to OpenAI Realtime API...</p>
                    <p>Setting up voice conversation</p>
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
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <div key={message.id} className={`flex gap-3 ${message.role === 'assistant' ? '' : 'flex-row-reverse'}`}>
                    <div className={`flex-shrink-0 p-2 rounded-full ${message.role === 'assistant' ? (message.type === 'system' ? 'bg-muted' : 'bg-primary') : 'bg-secondary'}`}>
                      {message.role === 'assistant' ? (
                        <Bot className={`h-4 w-4 ${message.type === 'system' ? 'text-muted-foreground' : 'text-primary-foreground'}`} />
                      ) : (
                        <User className="h-4 w-4" />
                      )}
                    </div>
                    <Card className={`max-w-[75%] ${message.role === 'assistant' ? (message.type === 'system' ? 'bg-muted/50' : 'bg-card') : 'bg-primary text-primary-foreground'}`}>
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm leading-relaxed">{message.content}</p>
                          {message.type && (
                            <Badge variant="outline" className="text-xs">{message.type.replace('_', ' ')}</Badge>
                          )}
                        </div>
                        <p className="text-xs opacity-70 mt-2">{message.timestamp.toLocaleTimeString()}</p>
                      </CardContent>
                    </Card>
                  </div>
                ))}
              </div>
            )}
          </div>

          {isConnected && (
            <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
              <p className="text-sm font-medium flex items-center gap-2">
                <Mic className="h-4 w-4" /> Quick Test Messages:
              </p>
              <div className="grid grid-cols-2 gap-2">
                {testMessages.map((m, i) => (
                  <Button key={i} variant="outline" size="sm" onClick={() => handleTestMessage(m)} className="h-auto p-2 text-left justify-start whitespace-normal">
                    "{m}"
                  </Button>
                ))}
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
