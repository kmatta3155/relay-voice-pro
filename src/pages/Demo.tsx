import React, { useState, useEffect, useRef } from "react";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Phone, PhoneOff, Mic, MicOff, Calendar, User, Clock, CheckCircle } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type CallStatus = 'incoming' | 'active' | 'ended';
type Message = {
  id: string;
  speaker: 'customer' | 'ai';
  text: string;
  timestamp: number;
  confidence?: number;
  intent?: string;
};

const DEMO_CONVERSATIONS = [
  {
    id: 'call1',
    customer: 'Sarah Johnson',
    phone: '+1 (555) 123-4567',
    messages: [
      { speaker: 'customer', text: "Hi, I'd like to book an appointment for a consultation.", confidence: 0.95 },
      { speaker: 'ai', text: "Hello Sarah! I'd be happy to help you book a consultation. What type of consultation are you looking for?", intent: 'appointment_booking' },
      { speaker: 'customer', text: "I need a business strategy consultation for my startup.", confidence: 0.92 },
      { speaker: 'ai', text: "Perfect! I can see we have business strategy consultations available. What day works best for you this week?", intent: 'availability_check' },
      { speaker: 'customer', text: "How about Thursday afternoon?", confidence: 0.88 },
      { speaker: 'ai', text: "Thursday afternoon looks great! I have 2:00 PM and 4:00 PM available. Which time preference do you have?", intent: 'time_selection' },
      { speaker: 'customer', text: "2 PM works perfectly.", confidence: 0.94 },
      { speaker: 'ai', text: "Excellent! I've booked your business strategy consultation for Thursday at 2:00 PM. You'll receive a confirmation email shortly. Is there anything else I can help you with today?", intent: 'booking_confirmation' }
    ]
  },
  {
    id: 'call2', 
    customer: 'Mike Rodriguez',
    phone: '+1 (555) 987-6543',
    messages: [
      { speaker: 'customer', text: "Hello, I'm calling about your services. Can you tell me more about what you offer?", confidence: 0.91 },
      { speaker: 'ai', text: "Hi Mike! Absolutely, I'd love to tell you about our services. We specialize in business consulting, digital transformation, and growth strategy. What specific area interests you most?", intent: 'service_inquiry' },
      { speaker: 'customer', text: "I'm particularly interested in digital transformation for my manufacturing company.", confidence: 0.89 },
      { speaker: 'ai', text: "Digital transformation for manufacturing is one of our key specialties! We help companies modernize their operations, implement IoT solutions, and optimize their supply chains. Would you like to schedule a free assessment?", intent: 'lead_qualification' },
      { speaker: 'customer', text: "Yes, that sounds interesting. What does the assessment involve?", confidence: 0.93 },
      { speaker: 'ai', text: "Our assessment includes a comprehensive review of your current systems, identification of automation opportunities, and a roadmap for digital transformation. It typically takes about 2 hours. When would be a good time for you?", intent: 'service_explanation' }
    ]
  }
];

export default function Demo() {
  const [currentCall, setCurrentCall] = useState<typeof DEMO_CONVERSATIONS[0] | null>(null);
  const [callStatus, setCallStatus] = useState<CallStatus>('ended');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isSimulating, setIsSimulating] = useState(false);
  const [currentMessageIndex, setCurrentMessageIndex] = useState(0);
  const [appointment, setAppointment] = useState<any>(null);
  const [lead, setLead] = useState<any>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const startCall = (conversationIndex: number) => {
    const conversation = DEMO_CONVERSATIONS[conversationIndex];
    setCurrentCall(conversation);
    setCallStatus('incoming');
    setMessages([]);
    setCurrentMessageIndex(0);
    setAppointment(null);
    setLead(null);
    
    // Simulate incoming call
    setTimeout(() => {
      setCallStatus('active');
      simulateConversation(conversation);
    }, 2000);
  };

  const simulateConversation = async (conversation: typeof DEMO_CONVERSATIONS[0]) => {
    setIsSimulating(true);
    
    for (let i = 0; i < conversation.messages.length; i++) {
      const msg = conversation.messages[i];
      const message: Message = {
        id: `msg_${i}`,
        speaker: msg.speaker as 'customer' | 'ai',
        text: msg.text,
        timestamp: Date.now(),
        confidence: msg.confidence,
        intent: msg.intent
      };

      // Add typing delay
      await new Promise(resolve => setTimeout(resolve, msg.speaker === 'customer' ? 1500 : 2000));
      
      setMessages(prev => [...prev, message]);
      setCurrentMessageIndex(i + 1);

      // Check for booking intent and create appointment
      if (msg.intent === 'booking_confirmation' && conversation.id === 'call1') {
        setTimeout(async () => {
          const newAppointment = {
            id: `apt_${Date.now()}`,
            customer: conversation.customer,
            title: 'Business Strategy Consultation',
            start: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(), // 2 days from now
            end: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(), // 1 hour duration
            status: 'confirmed'
          };
          setAppointment(newAppointment);

          // Actually save to database
          try {
            const { data: user } = await supabase.auth.getUser();
            if (user.user) {
              const { data: profile } = await supabase.from("profiles").select("active_tenant_id").eq("id", user.user.id).single();
              if (profile?.active_tenant_id) {
                await supabase.from("appointments").insert({
                  tenant_id: profile.active_tenant_id,
                  title: newAppointment.title,
                  customer: newAppointment.customer,
                  start_at: newAppointment.start,
                  end_at: newAppointment.end
                });
              }
            }
          } catch (error) {
            console.log("Demo mode - appointment not saved:", error);
          }
        }, 1000);
      }

      // Check for lead qualification
      if (msg.intent === 'lead_qualification' && conversation.id === 'call2') {
        setTimeout(async () => {
          const newLead = {
            id: `lead_${Date.now()}`,
            name: conversation.customer,
            phone: conversation.phone,
            source: 'Inbound Call',
            status: 'qualified',
            intent: 'Digital Transformation Services',
            score: 85
          };
          setLead(newLead);

          // Actually save to database
          try {
            const { data: user } = await supabase.auth.getUser();
            if (user.user) {
              const { data: profile } = await supabase.from("profiles").select("active_tenant_id").eq("id", user.user.id).single();
              if (profile?.active_tenant_id) {
                await supabase.from("leads").insert({
                  tenant_id: profile.active_tenant_id,
                  name: newLead.name,
                  phone: newLead.phone,
                  source: newLead.source,
                  status: newLead.status,
                  intent: newLead.intent,
                  score: newLead.score
                });
              }
            }
          } catch (error) {
            console.log("Demo mode - lead not saved:", error);
          }
        }, 1000);
      }
    }
    
    setIsSimulating(false);
  };

  const endCall = () => {
    setCallStatus('ended');
    setCurrentCall(null);
    setIsSimulating(false);
  };

  return (
    <div className="max-w-7xl mx-auto p-6 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">Live AI Contact Center Demo</h1>
        <p className="text-slate-600">Experience real-time AI-powered call handling, appointment booking, and lead qualification</p>
      </div>

      {/* Demo Controls */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle>Demo Scenarios</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div className="p-4 border rounded-xl">
              <h3 className="font-semibold">Scenario 1: Appointment Booking</h3>
              <p className="text-sm text-slate-600 mb-3">Customer calls to book a consultation</p>
              <Button 
                onClick={() => startCall(0)} 
                disabled={callStatus !== 'ended'}
                className="rounded-2xl"
              >
                Start Appointment Demo
              </Button>
            </div>
            <div className="p-4 border rounded-xl">
              <h3 className="font-semibold">Scenario 2: Lead Qualification</h3>
              <p className="text-sm text-slate-600 mb-3">Customer inquires about services</p>
              <Button 
                onClick={() => startCall(1)} 
                disabled={callStatus !== 'ended'}
                className="rounded-2xl"
              >
                Start Lead Demo
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid lg:grid-cols-3 gap-6">
        {/* Call Interface */}
        <div className="lg:col-span-2 space-y-4">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader className="flex flex-row items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Phone className="h-5 w-5" />
                  Live Call Interface
                </CardTitle>
                {currentCall && (
                  <div className="flex items-center gap-2 mt-2">
                    <Badge variant={callStatus === 'active' ? 'default' : callStatus === 'incoming' ? 'secondary' : 'outline'}>
                      {callStatus.toUpperCase()}
                    </Badge>
                    <span className="text-sm text-slate-600">{currentCall.customer} • {currentCall.phone}</span>
                  </div>
                )}
              </div>
              {callStatus === 'active' && (
                <Button
                  onClick={endCall}
                  variant="destructive"
                  size="sm"
                  className="rounded-2xl"
                >
                  <PhoneOff className="h-4 w-4 mr-2" />
                  End Call
                </Button>
              )}
            </CardHeader>
            <CardContent>
              {callStatus === 'ended' ? (
                <div className="text-center py-12 text-slate-500">
                  <Phone className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Select a demo scenario above to start</p>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Call Status */}
                  {callStatus === 'incoming' && (
                    <div className="text-center py-8">
                      <div className="animate-pulse">
                        <Phone className="h-16 w-16 mx-auto mb-4 text-blue-500" />
                        <p className="text-lg font-semibold">Incoming Call...</p>
                        <p className="text-slate-600">{currentCall?.customer}</p>
                      </div>
                    </div>
                  )}

                  {/* Live Transcript */}
                  {callStatus === 'active' && (
                    <div className="border rounded-xl p-4 h-96 overflow-y-auto bg-slate-50">
                      <h4 className="font-semibold mb-3 flex items-center gap-2">
                        <Mic className="h-4 w-4" />
                        Live Transcript
                      </h4>
                      <div className="space-y-3">
                        {messages.map((message) => (
                          <div
                            key={message.id}
                            className={`flex ${message.speaker === 'ai' ? 'justify-end' : 'justify-start'}`}
                          >
                            <div
                              className={`max-w-[80%] p-3 rounded-xl ${
                                message.speaker === 'ai'
                                  ? 'bg-blue-500 text-white'
                                  : 'bg-white border'
                              }`}
                            >
                              <div className="flex items-center gap-2 mb-1">
                                <span className="text-xs font-semibold opacity-75">
                                  {message.speaker === 'ai' ? 'AI Assistant' : currentCall?.customer}
                                </span>
                                {message.confidence && (
                                  <Badge variant="outline" className="text-xs">
                                    {Math.round(message.confidence * 100)}% confidence
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm">{message.text}</p>
                              {message.intent && (
                                <div className="mt-2">
                                  <Badge variant="secondary" className="text-xs">
                                    Intent: {message.intent.replace('_', ' ')}
                                  </Badge>
                                </div>
                              )}
                            </div>
                          </div>
                        ))}
                        {isSimulating && (
                          <div className="flex justify-start">
                            <div className="bg-white border p-3 rounded-xl">
                              <div className="flex items-center gap-1">
                                <div className="flex space-x-1">
                                  <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"></div>
                                  <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '0.1s'}}></div>
                                  <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{animationDelay: '0.2s'}}></div>
                                </div>
                                <span className="text-xs text-slate-500 ml-2">typing...</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                      <div ref={messagesEndRef} />
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* AI Insights & Actions */}
        <div className="space-y-4">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5" />
                AI Insights
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              {callStatus === 'active' && currentCall && (
                <>
                  <div>
                    <h4 className="font-semibold text-sm">Customer Profile</h4>
                    <p className="text-sm text-slate-600">{currentCall.customer}</p>
                    <p className="text-xs text-slate-500">{currentCall.phone}</p>
                  </div>

                  {messages.length > 0 && (
                    <div>
                      <h4 className="font-semibold text-sm">Detected Intent</h4>
                      <div className="space-y-1">
                        {messages
                          .filter(m => m.intent)
                          .slice(-1)
                          .map(m => (
                            <Badge key={m.id} variant="outline" className="text-xs">
                              {m.intent?.replace('_', ' ')}
                            </Badge>
                          ))
                        }
                      </div>
                    </div>
                  )}

                  <div>
                    <h4 className="font-semibold text-sm">Conversation Score</h4>
                    <div className="flex items-center gap-2">
                      <div className="flex-1 bg-slate-200 rounded-full h-2">
                        <div 
                          className="bg-green-500 h-2 rounded-full transition-all duration-500"
                          style={{ width: `${Math.min(95, messages.length * 12)}%` }}
                        ></div>
                      </div>
                      <span className="text-sm font-semibold">{Math.min(95, messages.length * 12)}%</span>
                    </div>
                  </div>
                </>
              )}

              {appointment && (
                <div className="p-3 bg-green-50 border border-green-200 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <span className="font-semibold text-green-800">Appointment Booked!</span>
                  </div>
                  <div className="text-sm text-green-700">
                    <p><strong>{appointment.title}</strong></p>
                    <p className="flex items-center gap-1">
                      <Calendar className="h-3 w-3" />
                      {new Date(appointment.start).toLocaleDateString()} at {new Date(appointment.start).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                    </p>
                    <p>Customer: {appointment.customer}</p>
                  </div>
                </div>
              )}

              {lead && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl">
                  <div className="flex items-center gap-2 mb-2">
                    <CheckCircle className="h-4 w-4 text-blue-600" />
                    <span className="font-semibold text-blue-800">Lead Qualified!</span>
                  </div>
                  <div className="text-sm text-blue-700">
                    <p><strong>{lead.name}</strong></p>
                    <p>Interest: {lead.intent}</p>
                    <p>Score: {lead.score}/100</p>
                    <Badge variant="secondary" className="mt-1">{lead.status}</Badge>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Quick Stats */}
          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5" />
                Session Stats
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex justify-between text-sm">
                <span>Call Duration</span>
                <span className="font-semibold">
                  {callStatus === 'active' && messages.length > 0 
                    ? `${Math.floor(messages.length * 1.5)}s` 
                    : '0s'
                  }
                </span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Messages Exchanged</span>
                <span className="font-semibold">{messages.length}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>AI Response Time</span>
                <span className="font-semibold text-green-600">~1.2s avg</span>
              </div>
              <div className="flex justify-between text-sm">
                <span>Transcription Accuracy</span>
                <span className="font-semibold text-green-600">
                  {messages.length > 0 
                    ? `${Math.round(messages.reduce((acc, m) => acc + (m.confidence || 0), 0) / messages.length * 100)}%`
                    : '0%'
                  }
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}