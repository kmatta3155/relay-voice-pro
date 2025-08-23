import React, { useState, useRef, useCallback } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Mic, MicOff, Phone, PhoneOff, Bot, User, Play, Pause, Volume2, VolumeX } from 'lucide-react';

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
  isPlaying?: boolean;
}

export default function AdminAgentTester({ open, onOpenChange, agent, tenantId }: AdminAgentTesterProps) {
  const { toast } = useToast();
  
  // State management
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [isLoading, setIsLoading] = useState(false);
  
  // Audio refs
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);
  const ringtoneRef = useRef<HTMLAudioElement | null>(null);

  const addMessage = useCallback((role: 'user' | 'assistant', content: string) => {
    const message: Message = {
      id: `${Date.now()}-${Math.random()}`,
      role,
      content,
      timestamp: new Date()
    };
    setMessages(prev => [...prev, message]);
    return message.id;
  }, []);

  const createRingtone = useCallback(() => {
    try {
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();
      
      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);
      
      // Create classic phone ring tone
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime);
      oscillator.frequency.setValueAtTime(480, audioContext.currentTime + 0.4);
      oscillator.frequency.setValueAtTime(440, audioContext.currentTime + 0.8);
      oscillator.frequency.setValueAtTime(480, audioContext.currentTime + 1.2);
      
      gainNode.gain.setValueAtTime(0.1, audioContext.currentTime);
      gainNode.gain.setValueAtTime(0, audioContext.currentTime + 1.6);
      
      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 1.6);
      
      return oscillator;
    } catch (error) {
      console.error('Failed to create ringtone:', error);
      return null;
    }
  }, []);

  const playTTS = useCallback(async (text: string, messageId?: string): Promise<void> => {
    console.log(`🎵 Generating TTS for: "${text.slice(0, 50)}..."`);
    
    try {
      setIsSpeaking(true);
      
      if (messageId) {
        setMessages(prev => prev.map(msg => 
          msg.id === messageId ? { ...msg, isPlaying: true } : msg
        ));
      }

      const { data, error } = await supabase.functions.invoke('text-to-speech', {
        body: { 
          text: text.slice(0, 500), // Limit text length for better performance
          voice_id: 'alloy'
        }
      });

      if (error) {
        console.error('TTS Error:', error);
        toast({
          title: "Audio Error",
          description: "Failed to generate speech audio. Please try again.",
          variant: "destructive"
        });
        return;
      }

      if (!data?.audioContent) {
        console.error('No audio content received');
        toast({
          title: "Audio Error", 
          description: "No audio content received from TTS service",
          variant: "destructive"
        });
        return;
      }

      // Stop any current audio first
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }

      console.log(`✅ Audio content received: ${data.audioContent.length} characters`);

      // Create audio with proper error handling and format validation
      try {
        // Validate base64 format
        if (!data.audioContent || typeof data.audioContent !== 'string') {
          throw new Error('Invalid audio content format');
        }

        const audioDataUrl = `data:audio/mpeg;base64,${data.audioContent}`;
        const audio = new Audio();
        
        // Set up all event handlers before loading
        audio.onerror = (e) => {
          console.error('Audio load/play error:', e, audio.error);
          setIsSpeaking(false);
          currentAudioRef.current = null;
          if (messageId) {
            setMessages(prev => prev.map(msg => 
              msg.id === messageId ? { ...msg, isPlaying: false } : msg
            ));
          }
          toast({
            title: "Audio Error",
            description: `Playback failed: ${audio.error?.message || 'Unknown audio error'}`,
            variant: "destructive"
          });
        };
        
        audio.onended = () => {
          console.log('🔊 Audio playback completed');
          setIsSpeaking(false);
          currentAudioRef.current = null;
          if (messageId) {
            setMessages(prev => prev.map(msg => 
              msg.id === messageId ? { ...msg, isPlaying: false } : msg
            ));
          }
        };

        audio.onloadeddata = () => {
          console.log('Audio data loaded successfully');
        };

        audio.oncanplay = async () => {
          try {
            console.log('Audio can play, starting playback');
            await audio.play();
            console.log('🔊 Audio playback started successfully');
          } catch (playError) {
            console.error('Audio play error:', playError);
            setIsSpeaking(false);
            currentAudioRef.current = null;
            if (messageId) {
              setMessages(prev => prev.map(msg => 
                msg.id === messageId ? { ...msg, isPlaying: false } : msg
              ));
            }
            toast({
              title: "Playback Error",
              description: `Cannot play audio: ${playError.message}`,
              variant: "destructive"
            });
          }
        };

        // Set audio properties
        audio.volume = 0.8;
        audio.preload = 'auto';
        currentAudioRef.current = audio;
        
        // Load the audio
        console.log('Loading audio data...');
        audio.src = audioDataUrl;
        
      } catch (audioError) {
        console.error('Audio creation error:', audioError);
        setIsSpeaking(false);
        currentAudioRef.current = null;
        if (messageId) {
          setMessages(prev => prev.map(msg => 
            msg.id === messageId ? { ...msg, isPlaying: false } : msg
          ));
        }
        toast({
          title: "Audio System Error",
          description: `Failed to create audio: ${audioError.message}`,
          variant: "destructive"
        });
      }
      
    } catch (error) {
      console.error('TTS Error:', error);
      setIsSpeaking(false);
      currentAudioRef.current = null;
      
      if (messageId) {
        setMessages(prev => prev.map(msg => 
          msg.id === messageId ? { ...msg, isPlaying: false } : msg
        ));
      }
      
      toast({
        title: "Audio System Error",
        description: "Failed to process audio request. Please check your connection.",
        variant: "destructive"
      });
    }
  }, [toast]);

  const sendMessageToAgent = useCallback(async (userMessage: string) => {
    if (isLoading) {
      toast({
        title: "Please Wait",
        description: "Previous request is still processing",
        variant: "destructive"
      });
      return;
    }

    try {
      setIsLoading(true);
      const userMessageId = addMessage('user', userMessage);

      // Call the voice edge function for AI response
      const { data, error } = await supabase.functions.invoke('voice', {
        body: {
          message: userMessage,
          tenant_id: tenantId,
          agent_name: agent.name || 'AI Assistant',
          conversation_history: messages.slice(-5).map(m => ({
            role: m.role,
            content: m.content
          }))
        }
      });

      if (error) {
        console.error('Voice function error:', error);
        toast({
          title: "AI Error",
          description: "Failed to get response from AI agent. Please try again.",
          variant: "destructive"
        });
        return;
      }

      if (!data?.response) {
        console.error('No response from voice function');
        toast({
          title: "AI Error",
          description: "No response received from AI agent",
          variant: "destructive"
        });
        return;
      }

      // Add agent response and play audio
      const assistantMessageId = addMessage('assistant', data.response);
      
      // Small delay before starting TTS to ensure message is rendered
      setTimeout(() => {
        playTTS(data.response, assistantMessageId);
      }, 100);

    } catch (error) {
      console.error('Error in sendMessageToAgent:', error);
      toast({
        title: "System Error",
        description: "Failed to process your message. Please try again.",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  }, [isLoading, addMessage, tenantId, agent.name, messages, playTTS, toast]);

  const startConversation = useCallback(async () => {
    try {
      setConnectionStatus('connecting');
      
      // Play ringtone
      const ringtone = createRingtone();
      
      // Simulate connection delay
      setTimeout(async () => {
        setConnectionStatus('connected');
        setIsConnected(true);
        
        toast({
          title: "Call Connected",
          description: `Connected to ${agent.name || 'AI Agent'}`,
        });

        // Send initial greeting
        setTimeout(async () => {
          const greeting = `Hello! I'm ${agent.name || 'your AI assistant'}. Thank you for calling. How can I help you today?`;
          const greetingId = addMessage('assistant', greeting);
          
          // Small delay before TTS
          setTimeout(() => {
            playTTS(greeting, greetingId);
          }, 200);
        }, 800);
        
      }, 2500);

    } catch (error) {
      console.error('Error starting conversation:', error);
      toast({
        title: "Connection Error",
        description: "Failed to start call. Please try again.",
        variant: "destructive"
      });
      setConnectionStatus('disconnected');
    }
  }, [createRingtone, toast, agent.name, addMessage, playTTS]);

  const endConversation = useCallback(() => {
    // Stop all audio
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
    if (ringtoneRef.current) {
      ringtoneRef.current.pause();
      ringtoneRef.current = null;
    }
    
    setIsConnected(false);
    setConnectionStatus('disconnected');
    setIsSpeaking(false);
    setIsLoading(false);
    
    toast({
      title: "Call Ended",
      description: "AI agent test session completed",
    });
  }, [toast]);

  const handleTestMessage = useCallback((message: string) => {
    if (!isConnected) {
      toast({
        title: "Not Connected",
        description: "Please start the call first",
        variant: "destructive"
      });
      return;
    }
    
    if (isSpeaking || isLoading) {
      toast({
        title: "Agent Busy",
        description: "Please wait for the agent to finish speaking",
        variant: "destructive"
      });
      return;
    }
    
    sendMessageToAgent(message);
  }, [isConnected, isSpeaking, isLoading, sendMessageToAgent, toast]);

  const stopCurrentAudio = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
      setIsSpeaking(false);
      
      // Update message playing state
      setMessages(prev => prev.map(msg => ({ ...msg, isPlaying: false })));
    }
  }, []);

  const handleDialogClose = useCallback((open: boolean) => {
    if (!open) {
      endConversation();
      setMessages([]);
    }
    onOpenChange(open);
  }, [endConversation, onOpenChange]);

  const testMessages = [
    "What are your business hours?",
    "How much does a massage cost?", 
    "I'd like to book an appointment",
    "What services do you offer?",
    "Can I cancel my appointment?",
    "Do you have availability this week?",
    "What is your cancellation policy?"
  ];

  return (
    <Dialog open={open} onOpenChange={handleDialogClose}>
      <DialogContent className="max-w-3xl h-[700px] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Test AI Agent: {agent.name || 'AI Assistant'}
          </DialogTitle>
          <DialogDescription>
            Test voice conversations with your customer's AI agent. Production-ready testing environment.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {/* Enhanced Status Bar */}
          <div className="flex items-center justify-between p-3 bg-muted/30 rounded-lg">
            <div className="flex items-center gap-3">
              <Badge 
                variant={connectionStatus === 'connected' ? 'default' : connectionStatus === 'connecting' ? 'secondary' : 'outline'}
                className="capitalize"
              >
                {connectionStatus}
              </Badge>
              {isSpeaking && (
                <Badge variant="outline" className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
                  <Volume2 className="h-3 w-3" />
                  Speaking
                </Badge>
              )}
              {isLoading && (
                <Badge variant="outline" className="flex items-center gap-1">
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  Processing
                </Badge>
              )}
            </div>
            
            <div className="flex gap-2">
              {!isConnected ? (
                <Button 
                  onClick={startConversation} 
                  disabled={connectionStatus === 'connecting'}
                  className="bg-green-600 hover:bg-green-700"
                >
                  <Phone className="h-4 w-4 mr-2" />
                  {connectionStatus === 'connecting' ? 'Connecting...' : 'Start Call'}
                </Button>
              ) : (
                <>
                  {isSpeaking && (
                    <Button onClick={stopCurrentAudio} variant="outline" size="sm">
                      <VolumeX className="h-4 w-4 mr-2" />
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

          {/* Enhanced Messages Display */}
          <div className="flex-1 border rounded-lg p-4 overflow-y-auto bg-gradient-to-b from-background to-muted/20">
            {messages.length === 0 ? (
              <div className="text-center text-muted-foreground py-12">
                {connectionStatus === 'connecting' ? (
                  <div className="flex flex-col items-center gap-3">
                    <Phone className="h-12 w-12 animate-pulse text-primary" />
                    <p className="text-lg font-medium">Connecting to AI agent...</p>
                    <div className="flex gap-1">
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce"></div>
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                      <div className="w-2 h-2 bg-primary rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                    </div>
                  </div>
                ) : isConnected ? (
                  <div className="flex flex-col items-center gap-3">
                    <Bot className="h-12 w-12 text-primary" />
                    <p className="text-lg font-medium">Ready to test</p>
                    <p>Try the quick test messages below</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-3">
                    <Phone className="h-12 w-12 text-muted-foreground" />
                    <p className="text-lg font-medium">Click "Start Call" to begin testing</p>
                    <p>Test your customer's AI agent with realistic scenarios</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((message) => (
                  <div key={message.id} className={`flex gap-3 ${message.role === 'assistant' ? '' : 'flex-row-reverse'}`}>
                    <div className={`flex-shrink-0 p-2 rounded-full ${message.role === 'assistant' ? 'bg-primary' : 'bg-secondary'}`}>
                      {message.role === 'assistant' ? 
                        <Bot className="h-4 w-4 text-primary-foreground" /> : 
                        <User className="h-4 w-4" />
                      }
                    </div>
                    <Card className={`max-w-[75%] ${message.role === 'assistant' ? 'bg-card' : 'bg-primary text-primary-foreground'}`}>
                      <CardContent className="p-3">
                        <div className="flex items-start justify-between gap-2">
                          <p className="text-sm leading-relaxed">{message.content}</p>
                          {message.role === 'assistant' && message.isPlaying && (
                            <Volume2 className="h-3 w-3 text-green-500 animate-pulse flex-shrink-0 mt-0.5" />
                          )}
                        </div>
                        <p className="text-xs opacity-70 mt-2">
                          {message.timestamp.toLocaleTimeString()}
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                ))}
                {isLoading && (
                  <div className="flex gap-3">
                    <div className="p-2 rounded-full bg-primary">
                      <Bot className="h-4 w-4 text-primary-foreground" />
                    </div>
                    <Card className="bg-card">
                      <CardContent className="p-3">
                        <div className="flex items-center gap-2">
                          <div className="flex gap-1">
                            <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce"></div>
                            <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                            <div className="w-2 h-2 bg-muted-foreground rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                          </div>
                          <span className="text-sm text-muted-foreground">Thinking...</span>
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Enhanced Quick Test Messages */}
          {isConnected && (
            <div className="space-y-3 p-3 bg-muted/30 rounded-lg">
              <p className="text-sm font-medium flex items-center gap-2">
                <Mic className="h-4 w-4" />
                Quick Test Messages:
              </p>
              <div className="grid grid-cols-2 gap-2">
                {testMessages.map((message, index) => (
                  <Button
                    key={index}
                    variant="outline"
                    size="sm"
                    onClick={() => handleTestMessage(message)}
                    disabled={isSpeaking || isLoading}
                    className="h-auto p-2 text-left justify-start whitespace-normal"
                  >
                    "{message}"
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