import React, { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Mic, MicOff, Phone, PhoneOff, Bot, User, Play, Pause, Volume2 } from 'lucide-react';

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
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringAudioRef = useRef<HTMLAudioElement | null>(null);

  const addMessage = (role: 'user' | 'assistant', content: string) => {
    const message: Message = {
      id: Date.now().toString(),
      role,
      content,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, message]);
  };

  const playRingTone = () => {
    // Create a simple ring tone using oscillator
    const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.setValueAtTime(400, audioContext.currentTime);
    oscillator.frequency.setValueAtTime(450, audioContext.currentTime + 0.5);
    
    gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
    gainNode.gain.setValueAtTime(0, audioContext.currentTime + 1);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 1);
  };

  const playTTS = async (text: string): Promise<void> => {
    console.log(`🎵 Playing TTS for: "${text.slice(0, 50)}..."`);
    
    try {
      setIsSpeaking(true);

      const { data, error } = await supabase.functions.invoke('text-to-speech', {
        body: { 
          text, 
          voice_id: 'alloy'
        }
      });

      console.log('TTS Response:', { data, error });

      if (error) {
        console.error('TTS Error:', error);
        toast({
          title: "Audio Error",
          description: "Failed to generate speech audio",
          variant: "destructive"
        });
        return;
      }

      if (!data?.audioContent) {
        console.error('No audio content received');
        toast({
          title: "Audio Error",
          description: "No audio content received",
          variant: "destructive"
        });
        return;
      }

      console.log(`✅ Audio content received: ${data.audioContent.length} characters`);

      const audioDataUrl = `data:audio/mpeg;base64,${data.audioContent}`;
      const audio = new Audio(audioDataUrl);
      audio.volume = 0.8;
      
      currentAudioRef.current = audio;
      
      audio.onended = () => {
        console.log('Audio playback ended');
        setIsSpeaking(false);
        currentAudioRef.current = null;
      };
      
      audio.onerror = (e) => {
        console.error('Audio playback error:', e);
        setIsSpeaking(false);
        currentAudioRef.current = null;
        toast({
          title: "Audio Error",
          description: "Failed to play audio",
          variant: "destructive"
        });
      };

      await audio.play();
      console.log('🔊 Audio playback started');
      
    } catch (error) {
      console.error('Error in TTS playback:', error);
      setIsSpeaking(false);
      currentAudioRef.current = null;
      
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

      // Simulate agent response based on common queries
      let agentResponse = "I understand your request. How can I assist you further?";
      
      if (userMessage.toLowerCase().includes('hours')) {
        agentResponse = "Our business hours are Monday through Friday, 9 AM to 6 PM, and Saturday 10 AM to 4 PM. We're closed on Sundays.";
      } else if (userMessage.toLowerCase().includes('appointment') || userMessage.toLowerCase().includes('book')) {
        agentResponse = "I'd be happy to help you book an appointment. What type of service are you interested in, and when would you prefer to schedule it?";
      } else if (userMessage.toLowerCase().includes('price') || userMessage.toLowerCase().includes('cost')) {
        agentResponse = "Our pricing varies by service. For example, a standard massage is $80 for 60 minutes. Would you like pricing for a specific service?";
      } else if (userMessage.toLowerCase().includes('service')) {
        agentResponse = "We offer massage therapy, facial treatments, and wellness consultations. Each service can be customized to your specific needs.";
      } else if (userMessage.toLowerCase().includes('cancel')) {
        agentResponse = "I can help you with cancellations. We require 24-hour notice to avoid any cancellation fees. May I have your appointment details?";
      }

      // Add a delay to simulate processing
      setTimeout(async () => {
        addMessage('assistant', agentResponse);
        await playTTS(agentResponse);
      }, 1000);

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
      
      // Play ring tone
      playRingTone();
      
      // Simulate connection delay
      setTimeout(async () => {
        setConnectionStatus('connected');
        setIsConnected(true);
        
        toast({
          title: "Connected",
          description: "AI agent test session started"
        });

        // Send initial greeting after a short delay
        setTimeout(async () => {
          const greeting = `Hello! I'm ${agent.name}, your AI assistant. How can I help you today?`;
          addMessage('assistant', greeting);
          await playTTS(greeting);
        }, 500);
        
      }, 2000);

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
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if (ringAudioRef.current) {
      ringAudioRef.current.pause();
      ringAudioRef.current = null;
    }
    setIsConnected(false);
    setConnectionStatus('disconnected');
    setIsSpeaking(false);
    
    toast({
      title: "Call Ended",
      description: "AI agent test session ended"
    });
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
    
    if (isSpeaking) {
      toast({
        title: "Agent Speaking",
        description: "Please wait for the agent to finish speaking",
        variant: "destructive"
      });
      return;
    }
    
    sendMessageToAgent(message);
  };

  const stopCurrentAudio = () => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
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
            Test the voice conversation with your customer's AI agent
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {/* Status Bar */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant={connectionStatus === 'connected' ? 'default' : connectionStatus === 'connecting' ? 'secondary' : 'outline'}>
                {connectionStatus}
              </Badge>
              {isSpeaking && (
                <Badge variant="outline" className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <Volume2 className="h-3 w-3" />
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
                {connectionStatus === 'connecting' ? (
                  <div className="flex flex-col items-center gap-2">
                    <Phone className="h-8 w-8 animate-pulse" />
                    <p>Calling agent...</p>
                  </div>
                ) : isConnected ? (
                  'Conversation ready - try the test messages below'
                ) : (
                  'Click "Start Call" to begin testing'
                )}
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