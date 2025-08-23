import React, { useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Mic, MicOff, Phone, PhoneOff, Bot, User, Play, Pause } from 'lucide-react';

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
  const [currentAudio, setCurrentAudio] = useState<HTMLAudioElement | null>(null);

  const addMessage = (role: 'user' | 'assistant', content: string) => {
    const message: Message = {
      id: Date.now().toString(),
      role,
      content,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, message]);
  };

  const playTTS = async (text: string): Promise<void> => {
    console.log(`🎵 Playing TTS for: "${text.slice(0, 50)}..."`);
    
    try {
      setIsSpeaking(true);

      const { data, error } = await supabase.functions.invoke('text-to-speech', {
        body: { 
          text, 
          voice_id: 'EXAVITQu4vr4xnSDxMaL' // Sarah's voice
        }
      });

      console.log('TTS Response:', { data, error });

      if (error) {
        console.error('TTS Error:', error);
        return;
      }

      if (!data?.audioContent) {
        console.error('No audio content received');
        return;
      }

      console.log(`✅ Audio content received: ${data.audioContent.length} characters`);

      const audioDataUrl = `data:audio/mpeg;base64,${data.audioContent}`;
      const audio = new Audio(audioDataUrl);
      audio.volume = 0.8;
      
      setCurrentAudio(audio);
      
      audio.onended = () => {
        console.log('Audio playback ended');
        setIsSpeaking(false);
        setCurrentAudio(null);
      };
      
      audio.onerror = (e) => {
        console.error('Audio playback error:', e);
        setIsSpeaking(false);
        setCurrentAudio(null);
      };

      await audio.play();
      console.log('🔊 Audio playback started');
      
    } catch (error) {
      console.error('Error in TTS playback:', error);
      setIsSpeaking(false);
      setCurrentAudio(null);
      
      toast({
        title: "Audio Error",
        description: "Failed to play audio response",
        variant: "destructive"
      });
    }
  };

  const sendMessageToAgent = async (userMessage: string) => {
    try {
      addMessage('user', userMessage);

      // Call the AI agent with the message
      const { data, error } = await supabase.functions.invoke('voice', {
        body: {
          message: userMessage,
          tenant_id: tenantId,
          conversation_history: messages.map(m => ({
            role: m.role,
            content: m.content
          }))
        }
      });

      if (error) {
        console.error('Agent response error:', error);
        throw error;
      }

      if (data?.response) {
        addMessage('assistant', data.response);
        await playTTS(data.response);
      }

    } catch (error) {
      console.error('Error sending message to agent:', error);
      toast({
        title: "Error",
        description: "Failed to get response from AI agent",
        variant: "destructive"
      });
    }
  };

  const startConversation = async () => {
    try {
      setConnectionStatus('connecting');
      
      // Simulate connection
      setTimeout(() => {
        setConnectionStatus('connected');
        setIsConnected(true);
        
        toast({
          title: "Connected",
          description: "AI agent test session started"
        });

        // Send initial greeting
        const greeting = "Hello! I'm your AI assistant. How can I help you today?";
        addMessage('assistant', greeting);
        playTTS(greeting);
        
      }, 1000);

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
    if (currentAudio) {
      currentAudio.pause();
      setCurrentAudio(null);
    }
    setIsConnected(false);
    setConnectionStatus('disconnected');
    setIsSpeaking(false);
    setIsRecording(false);
  };

  const handleTestMessage = (message: string) => {
    if (!isConnected) {
      toast({
        title: "Not Connected",
        description: "Please start the call first",
        variant: "destructive"
      });
      return;
    }
    
    sendMessageToAgent(message);
  };

  const stopCurrentAudio = () => {
    if (currentAudio) {
      currentAudio.pause();
      setCurrentAudio(null);
      setIsSpeaking(false);
    }
  };

  const handleDialogClose = (open: boolean) => {
    if (!open) {
      endConversation();
      setMessages([]);
    }
    onOpenChange(open);
  };

  const testMessages = [
    "What are your business hours?",
    "How much does a massage cost?", 
    "I'd like to book an appointment",
    "What services do you offer?",
    "Can I cancel my appointment?"
  ];

  return (
    <Dialog open={open} onOpenChange={handleDialogClose}>
      <DialogContent className="max-w-2xl h-[600px] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5" />
            Test AI Agent: {agent.name}
          </DialogTitle>
          <DialogDescription>
            Test the AI conversation with your customer's agent
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {/* Status Bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant={connectionStatus === 'connected' ? 'default' : 'secondary'}>
                {connectionStatus}
              </Badge>
              {isSpeaking && (
                <Badge variant="outline" className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  Agent Speaking
                </Badge>
              )}
            </div>
            
            <div className="flex gap-2">
              {!isConnected ? (
                <Button onClick={startConversation} disabled={connectionStatus === 'connecting'}>
                  <Phone className="h-4 w-4 mr-2" />
                  {connectionStatus === 'connecting' ? 'Connecting...' : 'Start Call'}
                </Button>
              ) : (
                <>
                  {isSpeaking && (
                    <Button onClick={stopCurrentAudio} variant="outline" size="sm">
                      <Pause className="h-4 w-4 mr-2" />
                      Stop Audio
                    </Button>
                  )}
                  <Button onClick={endConversation} variant="destructive">
                    <PhoneOff className="h-4 w-4 mr-2" />
                    End Call
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Messages */}
          <div className="flex-1 border rounded-lg p-4 overflow-y-auto bg-muted/30">
            {messages.length === 0 ? (
              <div className="text-center text-muted-foreground py-8">
                {isConnected ? 'Conversation started...' : 'Click "Start Call" to begin testing'}
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

          {/* Test Message Buttons */}
          {isConnected && (
            <div className="space-y-2">
              <p className="text-sm font-medium">Quick Test Messages:</p>
              <div className="flex flex-wrap gap-2">
                {testMessages.map((message, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    size="sm"
                    onClick={() => handleTestMessage(message)}
                    disabled={isSpeaking}
                  >
                    {message}
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