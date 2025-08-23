import React, { useState, useCallback, useRef, useEffect } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/use-toast';
import { 
  Bot, 
  Phone, 
  PhoneOff, 
  User, 
  Volume2, 
  MessageSquare, 
  Calendar,
  DollarSign,
  Clock,
  CheckCircle,
  XCircle,
  Play,
  BarChart3,
  Eye,
  Smartphone
} from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { RealtimeChat } from '@/utils/RealtimeAudio';
import { supabase } from '@/integrations/supabase/client';
import { getGroundingContext } from '@/lib/receptionist-rag';

interface CustomerExperienceSimulatorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  agent: any;
  tenantId: string;
}

interface SimulationScenario {
  id: string;
  title: string;
  description: string;
  customerProfile: string;
  expectedOutcome: string;
  questions: string[];
  category: 'booking' | 'pricing' | 'services' | 'hours' | 'general';
  difficulty: 'easy' | 'medium' | 'hard';
}

interface SimulationResult {
  scenario: SimulationScenario;
  responses: Array<{
    question: string;
    response: string;
    responseTime: number;
    success: boolean;
    reasoning: string;
  }>;
  overallScore: number;
  timestamp: Date;
  customerSatisfaction: number;
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: Date;
  metadata?: {
    responseTime?: number;
    confidence?: number;
    knowledgeUsed?: boolean;
  };
}

const SIMULATION_SCENARIOS: SimulationScenario[] = [
  {
    id: 'new-customer-booking',
    title: 'New Customer - First Time Booking',
    description: 'A first-time customer calls to book a service',
    customerProfile: 'Sarah, 28, never been to salon before, nervous about booking',
    expectedOutcome: 'Successfully guided through services, pricing explained, appointment booked',
    questions: [
      "Hi, I've never been to your salon before. What do you offer?",
      "How much does a basic haircut cost?",
      "Do I need to bring anything for my appointment?",
      "What's your cancellation policy?",
      "Can I book an appointment for this Friday?"
    ],
    category: 'booking',
    difficulty: 'easy'
  },
  {
    id: 'color-correction-emergency',
    title: 'Color Correction Emergency',
    description: 'Customer with hair color disaster needs immediate help',
    customerProfile: 'Jessica, 35, DIY hair color went wrong, panicked and upset',
    expectedOutcome: 'Calm customer, assess damage, schedule consultation, set expectations',
    questions: [
      "Help! I tried to color my hair at home and it's orange!",
      "Can you fix this today? I have a job interview tomorrow!",
      "How much will color correction cost?",
      "Will you be able to make it look normal again?",
      "Do you have any emergency appointments available?"
    ],
    category: 'services',
    difficulty: 'hard'
  },
  {
    id: 'wedding-party-booking',
    title: 'Wedding Party Group Booking',
    description: 'Bride wants to book hair and makeup for wedding party',
    customerProfile: 'Emily, 26, planning wedding for 6 months away, 8 people total',
    expectedOutcome: 'Coordinate group services, trial appointments, timeline planning',
    questions: [
      "I need hair and makeup for my wedding party of 8 people",
      "We need services on June 15th starting at 7 AM",
      "Do you offer on-location services?",
      "Can we schedule trial runs beforehand?",
      "What's the total cost for the full bridal package?"
    ],
    category: 'booking',
    difficulty: 'medium'
  },
  {
    id: 'late-night-availability',
    title: 'After Hours Inquiry',
    description: 'Customer calls after business hours looking for information',
    customerProfile: 'Mike, 42, works during business hours, can only call evenings',
    expectedOutcome: 'Provide hours, suggest callback times, take information for follow-up',
    questions: [
      "Are you still open? I need to book an appointment",
      "When do you open tomorrow?",
      "Can I leave my information for someone to call me back?",
      "Do you have any evening appointments available?",
      "What services do you offer for men?"
    ],
    category: 'hours',
    difficulty: 'easy'
  },
  {
    id: 'price-comparison-shopper',
    title: 'Price Comparison Shopper',
    description: 'Customer comparing prices across multiple salons',
    customerProfile: 'Linda, 45, budget-conscious, wants best value for money',
    expectedOutcome: 'Highlight value proposition, explain what\'s included, competitive positioning',
    questions: [
      "What do you charge for highlights?",
      "Do you have any package deals or discounts?",
      "What's included in your hair treatment services?",
      "How do your prices compare to other salons?",
      "Do you have any first-time customer specials?"
    ],
    category: 'pricing',
    difficulty: 'medium'
  }
];

export default function CustomerExperienceSimulator({ open, onOpenChange, agent, tenantId }: CustomerExperienceSimulatorProps) {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState('scenarios');
  const [selectedScenario, setSelectedScenario] = useState<SimulationScenario | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [simulationResults, setSimulationResults] = useState<SimulationResult[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  
  const chatRef = useRef<RealtimeChat | null>(null);
  const startTimeRef = useRef<number>(0);

  const addMessage = useCallback((role: 'user' | 'assistant' | 'system', content: string, metadata?: Message['metadata']) => {
    const msg: Message = {
      id: `${Date.now()}-${Math.random()}`,
      role,
      content,
      timestamp: new Date(),
      metadata
    };
    setMessages(prev => [...prev, msg]);
    return msg;
  }, []);

  const handleEvent = useCallback((event: any) => {
    console.log('Simulation event:', event?.type || event);

    switch (event.type) {
      case 'session.created':
        addMessage('system', '🎯 Customer simulation session started');
        setIsConnected(true);
        break;
      case 'response.audio.delta':
        setIsSpeaking(true);
        break;
      case 'response.audio.done':
        setIsSpeaking(false);
        break;
      case 'response.audio_transcript.done':
        if (event.transcript?.trim()) {
          const responseTime = Date.now() - startTimeRef.current;
          addMessage('assistant', event.transcript.trim(), {
            responseTime,
            confidence: 0.9, // Could be calculated based on response quality
            knowledgeUsed: true
          });
        }
        break;
      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript?.trim()) {
          addMessage('user', event.transcript.trim());
        }
        break;
    }
  }, [addMessage]);

  const startSimulation = useCallback(async (scenario: SimulationScenario) => {
    try {
      setIsRunning(true);
      setSelectedScenario(scenario);
      setMessages([]);
      setCurrentQuestionIndex(0);
      
      addMessage('system', `🎬 Starting simulation: ${scenario.title}`);
      addMessage('system', `👤 Customer Profile: ${scenario.customerProfile}`);
      addMessage('system', `🎯 Expected Outcome: ${scenario.expectedOutcome}`);

      // Initialize voice connection
      const chat = new RealtimeChat(handleEvent);
      chatRef.current = chat;

      await chat.init({
        voice: 'alloy',
        tenantId
      });

      toast({
        title: 'Simulation Started',
        description: `Running ${scenario.title} simulation`
      });

    } catch (error: any) {
      console.error('Simulation start error:', error);
      toast({
        title: 'Simulation Error',
        description: error?.message || 'Failed to start simulation',
        variant: 'destructive'
      });
      setIsRunning(false);
    }
  }, [tenantId, handleEvent, addMessage, toast]);

  const askNextQuestion = useCallback(async () => {
    if (!selectedScenario || !chatRef.current || currentQuestionIndex >= selectedScenario.questions.length) {
      return;
    }

    const question = selectedScenario.questions[currentQuestionIndex];
    startTimeRef.current = Date.now();
    
    addMessage('user', question);
    
    try {
      await chatRef.current.sendMessage(question);
      setCurrentQuestionIndex(prev => prev + 1);
    } catch (error: any) {
      toast({
        title: 'Question Error',
        description: error?.message || 'Failed to ask question',
        variant: 'destructive'
      });
    }
  }, [selectedScenario, currentQuestionIndex, addMessage, toast]);

  const endSimulation = useCallback(() => {
    if (chatRef.current) {
      chatRef.current.disconnect();
      chatRef.current = null;
    }
    
    if (selectedScenario && messages.length > 0) {
      // Calculate simulation results
      const responses = selectedScenario.questions.map((question, index) => {
        const userMsg = messages.find(m => m.role === 'user' && m.content === question);
        const assistantMsg = messages.find((m, i) => 
          m.role === 'assistant' && 
          i > messages.findIndex(msg => msg.content === question)
        );
        
        return {
          question,
          response: assistantMsg?.content || 'No response',
          responseTime: assistantMsg?.metadata?.responseTime || 0,
          success: assistantMsg?.content ? !assistantMsg.content.toLowerCase().includes('not enough information') : false,
          reasoning: assistantMsg?.content ? 'Response provided' : 'No response or insufficient information'
        };
      });

      const overallScore = responses.reduce((acc, r) => acc + (r.success ? 1 : 0), 0) / responses.length * 100;
      const customerSatisfaction = overallScore > 80 ? 5 : overallScore > 60 ? 4 : overallScore > 40 ? 3 : overallScore > 20 ? 2 : 1;

      const result: SimulationResult = {
        scenario: selectedScenario,
        responses,
        overallScore,
        timestamp: new Date(),
        customerSatisfaction
      };

      setSimulationResults(prev => [result, ...prev]);
    }

    setIsRunning(false);
    setIsConnected(false);
    setSelectedScenario(null);
    setCurrentQuestionIndex(0);
    
    toast({
      title: 'Simulation Complete',
      description: 'Check the Results tab for detailed analysis'
    });
  }, [selectedScenario, messages, toast]);

  const handleDialogClose = useCallback((open: boolean) => {
    if (!open && isRunning) {
      endSimulation();
    }
    onOpenChange(open);
  }, [isRunning, endSimulation, onOpenChange]);

  useEffect(() => {
    return () => {
      if (chatRef.current) {
        chatRef.current.disconnect();
      }
    };
  }, []);

  return (
    <Dialog open={open} onOpenChange={handleDialogClose}>
      <DialogContent className="max-w-6xl h-[800px] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" />
            Customer Experience Simulator
          </DialogTitle>
          <DialogDescription>
            Complete production simulation - Test exactly what customers will experience
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="scenarios">Scenarios</TabsTrigger>
            <TabsTrigger value="live">Live Simulation</TabsTrigger>
            <TabsTrigger value="results">Results</TabsTrigger>
            <TabsTrigger value="analytics">Analytics</TabsTrigger>
          </TabsList>

          <TabsContent value="scenarios" className="flex-1 overflow-y-auto">
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-lg font-semibold">Customer Journey Scenarios</h3>
                <Badge variant="outline">{SIMULATION_SCENARIOS.length} scenarios available</Badge>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {SIMULATION_SCENARIOS.map((scenario) => (
                  <Card key={scenario.id} className="hover:shadow-md transition-shadow">
                    <CardHeader>
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-base">{scenario.title}</CardTitle>
                        <div className="flex gap-2">
                          <Badge variant={scenario.difficulty === 'easy' ? 'default' : scenario.difficulty === 'medium' ? 'secondary' : 'destructive'}>
                            {scenario.difficulty}
                          </Badge>
                          <Badge variant="outline">{scenario.category}</Badge>
                        </div>
                      </div>
                      <CardDescription>{scenario.description}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-3">
                        <div>
                          <Label className="text-xs font-medium text-muted-foreground">Customer Profile</Label>
                          <p className="text-sm">{scenario.customerProfile}</p>
                        </div>
                        <div>
                          <Label className="text-xs font-medium text-muted-foreground">Questions ({scenario.questions.length})</Label>
                          <p className="text-sm text-muted-foreground">{scenario.questions[0]}...</p>
                        </div>
                        <Button 
                          onClick={() => startSimulation(scenario)}
                          disabled={isRunning}
                          className="w-full"
                        >
                          <Play className="h-4 w-4 mr-2" />
                          Run Simulation
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="live" className="flex-1 flex flex-col">
            {selectedScenario ? (
              <div className="flex-1 flex flex-col gap-4">
                <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg">
                  <div className="flex items-center gap-3">
                    <Badge variant={isConnected ? 'default' : 'outline'}>
                      {isConnected ? 'Connected' : 'Disconnected'}
                    </Badge>
                    {isSpeaking && (
                      <Badge variant="outline" className="flex items-center gap-1">
                        <Volume2 className="h-3 w-3" />
                        AI Speaking
                      </Badge>
                    )}
                    <Badge variant="secondary">
                      Question {currentQuestionIndex + 1} of {selectedScenario.questions.length}
                    </Badge>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      onClick={askNextQuestion}
                      disabled={!isConnected || currentQuestionIndex >= selectedScenario.questions.length}
                      variant="outline"
                    >
                      Ask Next Question
                    </Button>
                    <Button onClick={endSimulation} variant="destructive">
                      <PhoneOff className="h-4 w-4 mr-2" />
                      End Simulation
                    </Button>
                  </div>
                </div>

                <div className="flex-1 border rounded-lg p-4 overflow-y-auto bg-gradient-to-b from-background to-muted/20">
                  <div className="space-y-4">
                    {messages.map((message) => (
                      <div key={message.id} className={`flex gap-3 ${message.role === 'assistant' ? '' : message.role === 'user' ? 'flex-row-reverse' : ''}`}>
                        <div className={`flex-shrink-0 p-2 rounded-full ${
                          message.role === 'assistant' ? 'bg-primary' : 
                          message.role === 'user' ? 'bg-secondary' : 'bg-muted'
                        }`}>
                          {message.role === 'assistant' ? (
                            <Bot className="h-4 w-4 text-primary-foreground" />
                          ) : message.role === 'user' ? (
                            <User className="h-4 w-4" />
                          ) : (
                            <Eye className="h-4 w-4" />
                          )}
                        </div>
                        <div className={`flex-1 max-w-[80%] ${message.role === 'user' ? 'text-right' : ''}`}>
                          <div className={`p-3 rounded-lg ${
                            message.role === 'assistant' ? 'bg-primary/10' : 
                            message.role === 'user' ? 'bg-secondary/50' : 'bg-muted/50'
                          }`}>
                            <p className="text-sm">{message.content}</p>
                            {message.metadata && (
                              <div className="flex gap-2 mt-2 text-xs text-muted-foreground">
                                {message.metadata.responseTime && (
                                  <span>⏱️ {message.metadata.responseTime}ms</span>
                                )}
                                {message.metadata.knowledgeUsed && (
                                  <span>📚 Knowledge used</span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <Play className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-medium mb-2">No Active Simulation</h3>
                  <p className="text-muted-foreground">Select a scenario from the Scenarios tab to start</p>
                </div>
              </div>
            )}
          </TabsContent>

          <TabsContent value="results" className="flex-1 overflow-y-auto">
            <div className="space-y-4">
              <h3 className="text-lg font-semibold">Simulation Results</h3>
              {simulationResults.length === 0 ? (
                <div className="text-center py-8">
                  <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">No simulation results yet. Run a scenario to see results.</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {simulationResults.map((result, index) => (
                    <Card key={index}>
                      <CardHeader>
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-base">{result.scenario.title}</CardTitle>
                          <div className="flex gap-2">
                            <Badge variant={result.overallScore >= 80 ? 'default' : result.overallScore >= 60 ? 'secondary' : 'destructive'}>
                              {result.overallScore.toFixed(0)}% Success
                            </Badge>
                            <Badge variant="outline">{result.customerSatisfaction}/5 ⭐</Badge>
                          </div>
                        </div>
                        <CardDescription>
                          Completed {result.timestamp.toLocaleString()}
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <div className="space-y-3">
                          {result.responses.map((response, i) => (
                            <div key={i} className="flex items-start gap-3 p-3 border rounded-lg">
                              <div className="flex-shrink-0">
                                {response.success ? (
                                  <CheckCircle className="h-5 w-5 text-green-500" />
                                ) : (
                                  <XCircle className="h-5 w-5 text-red-500" />
                                )}
                              </div>
                              <div className="flex-1">
                                <p className="font-medium text-sm">{response.question}</p>
                                <p className="text-sm text-muted-foreground mt-1">{response.response}</p>
                                <div className="flex gap-2 mt-2 text-xs text-muted-foreground">
                                  <span>⏱️ {response.responseTime}ms</span>
                                  <span>{response.reasoning}</span>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          </TabsContent>

          <TabsContent value="analytics" className="flex-1 overflow-y-auto">
            <div className="space-y-6">
              <h3 className="text-lg font-semibold">Performance Analytics</h3>
              
              {simulationResults.length === 0 ? (
                <div className="text-center py-8">
                  <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <p className="text-muted-foreground">Run simulations to see analytics data</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Average Success Rate</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-primary">
                        {(simulationResults.reduce((acc, r) => acc + r.overallScore, 0) / simulationResults.length).toFixed(0)}%
                      </div>
                      <p className="text-sm text-muted-foreground">Across all scenarios</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Avg Customer Satisfaction</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-primary">
                        {(simulationResults.reduce((acc, r) => acc + r.customerSatisfaction, 0) / simulationResults.length).toFixed(1)}
                      </div>
                      <p className="text-sm text-muted-foreground">Out of 5 stars</p>
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-base">Simulations Run</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="text-3xl font-bold text-primary">
                        {simulationResults.length}
                      </div>
                      <p className="text-sm text-muted-foreground">Total scenarios tested</p>
                    </CardContent>
                  </Card>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}