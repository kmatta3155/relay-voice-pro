import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { Bot, Mic, Phone, PhoneOff, User, Volume2, Search, Send } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { RealtimeChat } from '@/utils/RealtimeAudio';
import { supabase } from '@/integrations/supabase/client';
import { getGroundingContext } from '@/lib/receptionist-rag';
import { ingestWebsite, logUnanswered } from '@/lib/rag';

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
  type?: 'transcription' | 'agent_response' | 'system' | 'knowledge_test';
}

interface KnowledgeResult {
  question: string;
  answer: string;
  timestamp: Date;
  success: boolean;
}

export default function AdminAgentTester({ open, onOpenChange, agent, tenantId }: AdminAgentTesterProps) {
  const { toast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  // Knowledge testing state
  const [knowledgeResults, setKnowledgeResults] = useState<KnowledgeResult[]>([]);
  const [knowledgeQuestion, setKnowledgeQuestion] = useState('');
  const [isTestingKnowledge, setIsTestingKnowledge] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);

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
        tenantId
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


  // Knowledge testing function
  const testKnowledge = useCallback(async (question: string) => {
    if (!question.trim()) {
      toast({ title: 'Empty Question', description: 'Please enter a question to test', variant: 'destructive' });
      return;
    }

    setIsTestingKnowledge(true);
    console.log(`🔍 Testing knowledge for: "${question}"`);

    try {
      // Use the existing RAG system to get grounding context
      const groundingContext = await getGroundingContext(tenantId, question, 6);
      
      console.log('📚 Knowledge search result:', { 
        question, 
        contextLength: groundingContext?.length || 0,
        hasContext: !!groundingContext
      });

      const success = !!groundingContext && groundingContext.trim().length > 0;

      const result: KnowledgeResult = {
        question,
        answer: groundingContext || 'No relevant knowledge found in the business data.',
        timestamp: new Date(),
        success
      };

      setKnowledgeResults(prev => [result, ...prev]);
      
      // Add to message history as well
      addMessage('user', question, 'knowledge_test');
      addMessage('assistant', `📚 Knowledge Base Result:\n\n${result.answer}`, 'knowledge_test');

      // Ask the live agent to answer using the retrieved knowledge (if connected)
      if (isConnected && chatRef.current) {
        try {
          const prompt = `Use the business knowledge below to answer the question accurately. If the knowledge is insufficient, say you don't have enough information.\n\nQuestion: ${question}\n\nBusiness Knowledge:\n${groundingContext || '(none)'}\n\nAnswer:`;
          await chatRef.current.sendMessage(prompt);
        } catch (sendErr: any) {
          console.warn('Agent send error (knowledge):', sendErr);
        }
      }

      if (success) {
        toast({ 
          title: 'Knowledge Found', 
          description: `Found relevant business information for: "${question.slice(0, 50)}..."` 
        });
      } else {
        try { await logUnanswered(tenantId, question); } catch (_) {}
        toast({ 
          title: 'No Knowledge Found', 
          description: 'No relevant business data found for this question',
          variant: 'destructive' 
        });
      }

    } catch (error: any) {
      console.error('❌ Knowledge test error:', error);
      
      const errorResult: KnowledgeResult = {
        question,
        answer: `Error testing knowledge: ${error.message || 'Unknown error'}`,
        timestamp: new Date(),
        success: false
      };

      setKnowledgeResults(prev => [errorResult, ...prev]);
      addMessage('assistant', `❌ Knowledge Test Error: ${error.message}`, 'system');
      
      toast({ 
        title: 'Knowledge Test Error', 
        description: error.message || 'Failed to test knowledge base',
        variant: 'destructive' 
      });
    } finally {
      setIsTestingKnowledge(false);
    }
  }, [tenantId, addMessage, toast, isConnected]);

  const handleKnowledgeSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (knowledgeQuestion.trim()) {
      testKnowledge(knowledgeQuestion.trim());
      setKnowledgeQuestion('');
    }
  }, [knowledgeQuestion, testKnowledge]);

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

          {/* Knowledge Base Testing Section */}
          <div className="space-y-3 p-3 bg-blue-50 dark:bg-blue-950/30 rounded-lg border border-blue-200 dark:border-blue-800">
            <p className="text-sm font-medium flex items-center gap-2 text-blue-900 dark:text-blue-100">
              <Search className="h-4 w-4" /> Test Business Knowledge Base
            </p>
            <p className="text-xs text-blue-700 dark:text-blue-300">
              Test if the AI agent can find information from your business data by asking any question.
            </p>
            
            <form onSubmit={handleKnowledgeSubmit} className="flex gap-2">
              <Input
                value={knowledgeQuestion}
                onChange={(e) => setKnowledgeQuestion(e.target.value)}
                placeholder="Ask any question about your business..."
                className="flex-1"
                disabled={isTestingKnowledge}
              />
              <Button 
                type="submit" 
                disabled={isTestingKnowledge || !knowledgeQuestion.trim()}
                size="sm"
                aria-label="Submit knowledge question"
              >
                {isTestingKnowledge ? (
                  <div className="w-4 h-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
              </Button>
            </form>

            {knowledgeResults.length > 0 && (
              <div className="mt-3 space-y-2 max-h-32 overflow-y-auto">
                <p className="text-xs font-medium text-blue-800 dark:text-blue-200">Recent Knowledge Tests:</p>
                {knowledgeResults.slice(0, 3).map((result, i) => (
                  <div key={i} className="p-2 bg-white/50 dark:bg-gray-800/50 rounded text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-medium truncate flex-1">{result.question}</span>
                      <Badge variant={result.success ? "default" : "destructive"} className="text-xs ml-2">
                        {result.success ? "✓" : "✗"}
                      </Badge>
                    </div>
                    {result.success && (
                      <p className="mt-1 text-muted-foreground truncate">
                        {result.answer.slice(0, 100)}...
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
