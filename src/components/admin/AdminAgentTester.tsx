import React, { useState, useCallback, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { useConversation } from '@11labs/react';
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

export default function AdminAgentTester({ open, onOpenChange, agent, tenantId }: AdminAgentTesterProps) {
  const { toast } = useToast();
  
  // State management
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [isInitializing, setIsInitializing] = useState(false);

  // ElevenLabs conversation hook with proper configuration
  const conversation = useConversation({
    onConnect: () => {
      console.log('🎯 ElevenLabs conversation connected');
      toast({
        title: "Connected",
        description: `Connected to ${agent.name || 'AI Agent'}`,
      });
    },
    onDisconnect: () => {
      console.log('🎯 ElevenLabs conversation disconnected');
      setConversationId(null);
      toast({
        title: "Call Ended",
        description: "AI agent conversation ended",
      });
    },
    onMessage: (message) => {
      console.log('🎯 ElevenLabs message:', message);
      
      // Add message to conversation history
      const newMessage: Message = {
        id: `${Date.now()}-${Math.random()}`,
        role: message.source === 'user' ? 'user' : 'assistant',
        content: message.message,
        timestamp: new Date(),
        type: message.source === 'user' ? 'transcription' : 'agent_response'
      };
      
      setMessages(prev => [...prev, newMessage]);
    },
    onError: (error) => {
      console.error('🎯 ElevenLabs error:', error);
      toast({
        title: "Conversation Error",
        description: `Connection error: ${error.message || 'Unknown error'}`,
        variant: "destructive"
      });
    },
    overrides: {
      agent: {
        prompt: {
          prompt: `You are ${agent.name || 'an AI assistant'} for ${tenantId}. You are helpful, professional, and knowledgeable about the business. Answer questions about services, pricing, availability, and help with booking appointments.`
        },
        firstMessage: `Hello! I'm ${agent.name || 'your AI assistant'}. Thank you for calling. How can I help you today?`,
        language: "en"
      }
    }
  });

  const addSystemMessage = useCallback((content: string) => {
    const message: Message = {
      id: `${Date.now()}-system`,
      role: 'assistant',
      content,
      timestamp: new Date(),
      type: 'system'
    };
    setMessages(prev => [...prev, message]);
  }, []);

  const startConversation = useCallback(async () => {
    try {
      setIsInitializing(true);
      
      // Request microphone permission first
      try {
        await navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (micError) {
        console.error('Microphone permission denied:', micError);
        toast({
          title: "Microphone Required",
          description: "Please allow microphone access to test the AI agent",
          variant: "destructive"
        });
        return;
      }

      addSystemMessage("🔄 Connecting to AI agent...");

      // For this demo, we'll use a public agent ID
      // In production, you'd get this from your ElevenLabs dashboard
      const demoAgentId = "your-elevenlabs-agent-id";
      
      // Start the conversation
      const id = await conversation.startSession({ 
        agentId: demoAgentId
      });
      
      setConversationId(id);
      console.log('🎯 Conversation started with ID:', id);
      
    } catch (error) {
      console.error('Failed to start conversation:', error);
      addSystemMessage("❌ Failed to connect to AI agent");
      toast({
        title: "Connection Failed",
        description: "Unable to start conversation. Please check your configuration.",
        variant: "destructive"
      });
    } finally {
      setIsInitializing(false);
    }
  }, [conversation, addSystemMessage, toast, agent.name]);

  const endConversation = useCallback(async () => {
    try {
      await conversation.endSession();
      setConversationId(null);
      addSystemMessage("📞 Call ended");
    } catch (error) {
      console.error('Error ending conversation:', error);
    }
  }, [conversation, addSystemMessage]);

  const handleDialogClose = useCallback((open: boolean) => {
    if (!open && conversationId) {
      endConversation();
      setMessages([]);
    }
    onOpenChange(open);
  }, [conversationId, endConversation, onOpenChange]);

  const handleVolumeToggle = useCallback(async () => {
    try {
      // Toggle between muted and normal volume
      const newVolume = conversation.status === 'connected' ? 0 : 0.8;
      await conversation.setVolume({ volume: newVolume });
    } catch (error) {
      console.error('Error toggling volume:', error);
    }
  }, [conversation]);

  // Helper functions for UI state
  const isConnected = conversation.status === 'connected';
  const isConnecting = isInitializing;
  const isSpeaking = conversation.isSpeaking;

  return (
    <Dialog open={open} onOpenChange={handleDialogClose}>
      <DialogContent className="max-w-3xl h-[700px] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Bot className="h-5 w-5 text-primary" />
            Test AI Agent: {agent.name || 'AI Assistant'}
          </DialogTitle>
          <DialogDescription>
            Test voice conversations with ElevenLabs Conversational AI. Real-time voice chat with your AI agent.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 flex flex-col gap-4 min-h-0">
          {/* Enhanced Status Bar */}
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
                  Agent Speaking
                </Badge>
              )}
              {isConnected && (
                <Badge variant="outline" className="flex items-center gap-1">
                  <Mic className="h-3 w-3" />
                  Voice Active
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
                <>
                  <Button onClick={handleVolumeToggle} variant="outline" size="sm">
                    <Volume2 className="h-4 w-4 mr-2" />
                    Volume
                  </Button>
                  <Button onClick={endConversation} variant="destructive">
                    <PhoneOff className="h-4 w-4 mr-2" />
                    End Call
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Messages Display */}
          <div className="flex-1 border rounded-lg p-4 overflow-y-auto bg-gradient-to-b from-background to-muted/20">
            {messages.length === 0 ? (
              <div className="text-center text-muted-foreground py-12">
                {isConnecting ? (
                  <div className="flex flex-col items-center gap-3">
                    <Phone className="h-12 w-12 animate-pulse text-primary" />
                    <p className="text-lg font-medium">Connecting to ElevenLabs AI...</p>
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
                    <p className="text-lg font-medium">ElevenLabs Conversational AI</p>
                    <p>Click "Start Voice Call" to begin real-time voice testing</p>
                    <div className="text-sm text-muted-foreground mt-4 max-w-md">
                      <p className="font-medium">Features:</p>
                      <ul className="list-disc list-inside mt-2 space-y-1">
                        <li>Real-time voice conversation</li>
                        <li>Natural speech recognition</li>
                        <li>Professional AI responses</li>
                        <li>Production-ready testing</li>
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

          {/* Instructions for voice interaction */}
          {isConnected && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
              <div className="flex items-start gap-2">
                <Mic className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-900 dark:text-blue-100">Voice Conversation Active</p>
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