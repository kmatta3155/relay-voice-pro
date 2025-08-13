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
    scenario: 'Spa Appointment Booking',
    messages: [
      { speaker: 'customer', text: "Hi, I'd like to book a massage appointment please.", confidence: 0.95 },
      { speaker: 'ai', text: "Hello Sarah! I'd be happy to help you book a massage. What type of massage are you interested in today?", intent: 'appointment_booking' },
      { speaker: 'customer', text: "I think a deep tissue massage would be perfect. I've been really stressed with work lately.", confidence: 0.92 },
      { speaker: 'ai', text: "A deep tissue massage is excellent for stress relief! We have 60-minute and 90-minute sessions available. Which would you prefer?", intent: 'service_selection' },
      { speaker: 'customer', text: "90 minutes sounds amazing. What's your availability this week?", confidence: 0.91 },
      { speaker: 'ai', text: "Perfect choice! For 90-minute deep tissue massages, I have Thursday at 2:00 PM, Friday at 11:00 AM, or Saturday at 4:00 PM available. Which works best for you?", intent: 'availability_check' },
      { speaker: 'customer', text: "Thursday at 2 PM would be ideal!", confidence: 0.94 },
      { speaker: 'ai', text: "Wonderful! I've booked your 90-minute deep tissue massage for Thursday at 2:00 PM with our senior therapist Emma. The session is $180. Can I get your email for confirmation?", intent: 'booking_confirmation' },
      { speaker: 'customer', text: "Yes, it's sarah.johnson@email.com", confidence: 0.96 },
      { speaker: 'ai', text: "Perfect! I've sent your confirmation to sarah.johnson@email.com. Please arrive 15 minutes early to fill out our wellness form. We're looking forward to seeing you Thursday!", intent: 'booking_complete' }
    ]
  },
  {
    id: 'call2', 
    customer: 'Mike Rodriguez',
    phone: '+1 (555) 987-6543',
    scenario: 'Restaurant Reservation',
    messages: [
      { speaker: 'customer', text: "Hi, I'd like to make a dinner reservation for tonight if possible.", confidence: 0.91 },
      { speaker: 'ai', text: "Good evening Mike! I'd be delighted to help you with a dinner reservation. How many people will be joining you tonight?", intent: 'reservation_inquiry' },
      { speaker: 'customer', text: "It's for 4 people, around 7 or 8 PM would be great.", confidence: 0.89 },
      { speaker: 'ai', text: "Excellent! For a party of 4 tonight, I have 7:15 PM or 8:30 PM available. We also have a lovely window table at 7:45 PM. Which would you prefer?", intent: 'availability_check' },
      { speaker: 'customer', text: "The window table at 7:45 sounds perfect! Do you accommodate any dietary restrictions?", confidence: 0.93 },
      { speaker: 'ai', text: "Absolutely! Our chef is excellent with dietary accommodations. We handle vegetarian, vegan, gluten-free, and most allergies. What dietary needs should I note for your party?", intent: 'dietary_inquiry' },
      { speaker: 'customer', text: "One person is vegetarian, and another has a shellfish allergy.", confidence: 0.95 },
      { speaker: 'ai', text: "Perfect! I've reserved the window table for 4 at 7:45 PM tonight under Rodriguez, with notes for one vegetarian and one shellfish allergy. Our kitchen will take excellent care of your guests. See you tonight!", intent: 'reservation_confirmed' }
    ]
  },
  {
    id: 'call3',
    customer: 'Emily Chen',
    phone: '+1 (555) 234-5678',
    scenario: 'Customer Support Issue',
    messages: [
      { speaker: 'customer', text: "Hi, I'm having trouble with my account login. I keep getting an error message.", confidence: 0.94 },
      { speaker: 'ai', text: "Hi Emily! I'm sorry to hear you're having login troubles. I'm here to help resolve this quickly. What error message are you seeing exactly?", intent: 'technical_support' },
      { speaker: 'customer', text: "It says 'Invalid credentials' even though I'm sure my password is correct. I even tried resetting it twice.", confidence: 0.92 },
      { speaker: 'ai', text: "That's frustrating! The 'invalid credentials' error after password resets suggests a few possibilities. Let me check your account status. Can you confirm the email address associated with your account?", intent: 'account_verification' },
      { speaker: 'customer', text: "Yes, it's emily.chen@company.com", confidence: 0.96 },
      { speaker: 'ai', text: "Thank you! I can see your account, and I found the issue. Your account was temporarily locked due to multiple failed login attempts. I'm unlocking it now. Can you try logging in again?", intent: 'issue_resolution' },
      { speaker: 'customer', text: "Oh wow, it worked! I'm logged in now. Thank you so much!", confidence: 0.98 },
      { speaker: 'ai', text: "Excellent! I'm so glad we got that resolved quickly. To prevent this in the future, remember there's a 'Forgot Password' link if you're ever unsure. Is there anything else I can help you with today?", intent: 'support_complete' }
    ]
  },
  {
    id: 'call4',
    customer: 'David Thompson',
    phone: '+1 (555) 345-6789',
    scenario: 'Sales Inquiry & Lead Qualification',
    messages: [
      { speaker: 'customer', text: "Hello, I saw your ad about marketing automation software. Can you tell me more about it?", confidence: 0.90 },
      { speaker: 'ai', text: "Hi David! Thanks for your interest in our marketing automation platform. I'd love to show you how it can transform your marketing efforts. What type of business are you running?", intent: 'lead_qualification' },
      { speaker: 'customer', text: "I run a growing e-commerce business. We're doing about $2 million in annual revenue but our email marketing is all manual right now.", confidence: 0.93 },
      { speaker: 'ai', text: "That's fantastic growth! At $2M annual revenue, automation could save you 15-20 hours per week and increase email revenue by 25-40%. How many customers are in your email database currently?", intent: 'needs_assessment' },
      { speaker: 'customer', text: "We have about 15,000 customers on our email list, but we're only sending basic newsletters right now.", confidence: 0.91 },
      { speaker: 'ai', text: "Perfect! With 15,000 customers, you're sitting on a goldmine. Our platform could help you segment those customers, automate abandoned cart emails, and create personalized product recommendations. Would you like to see a custom demo based on your e-commerce store?", intent: 'demo_qualification' },
      { speaker: 'customer', text: "Yes, that sounds exactly what we need. When can we schedule that?", confidence: 0.95 },
      { speaker: 'ai', text: "Excellent! I'm marking you as a qualified lead for our e-commerce automation demo. I can schedule you with our senior e-commerce specialist tomorrow at 2 PM or Thursday at 10 AM. Which works better for you?", intent: 'demo_scheduling' }
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

      // Check for booking/reservation confirmations
      if ((msg.intent === 'booking_confirmation' && conversation.id === 'call1') || 
          (msg.intent === 'reservation_confirmed' && conversation.id === 'call2')) {
        setTimeout(async () => {
          let appointmentData;
          if (conversation.id === 'call1') {
            appointmentData = {
              id: `apt_${Date.now()}`,
              customer: conversation.customer,
              title: '90-min Deep Tissue Massage',
              start: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
              end: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 90 * 60 * 1000).toISOString(),
              status: 'confirmed'
            };
          } else {
            appointmentData = {
              id: `res_${Date.now()}`,
              customer: conversation.customer,
              title: 'Dinner Reservation - Table for 4',
              start: new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString(), // Tonight
              end: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(), // 2 hours
              status: 'confirmed'
            };
          }
          setAppointment(appointmentData);

          // Save to database
          try {
            const { data: user } = await supabase.auth.getUser();
            if (user.user) {
              const { data: profile } = await supabase.from("profiles").select("active_tenant_id").eq("id", user.user.id).single();
              if (profile?.active_tenant_id) {
                await supabase.from("appointments").insert({
                  tenant_id: profile.active_tenant_id,
                  title: appointmentData.title,
                  customer: appointmentData.customer,
                  start_at: appointmentData.start,
                  end_at: appointmentData.end
                });
              }
            }
          } catch (error) {
            console.log("Demo mode - appointment not saved:", error);
          }
        }, 1000);
      }

      // Check for lead qualification (sales demo)
      if (msg.intent === 'demo_qualification' && conversation.id === 'call4') {
        setTimeout(async () => {
          const newLead = {
            id: `lead_${Date.now()}`,
            name: conversation.customer,
            phone: conversation.phone,
            source: 'Marketing Ad',
            status: 'qualified',
            intent: 'E-commerce Marketing Automation',
            score: 92
          };
          setLead(newLead);

          // Save to database
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
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="p-4 border rounded-xl">
              <h3 className="font-semibold">Spa Booking</h3>
              <p className="text-sm text-slate-600 mb-3">Customer books a massage appointment</p>
              <Button 
                onClick={() => startCall(0)} 
                disabled={callStatus !== 'ended'}
                className="rounded-2xl w-full"
                size="sm"
              >
                Start Demo
              </Button>
            </div>
            <div className="p-4 border rounded-xl">
              <h3 className="font-semibold">Restaurant</h3>
              <p className="text-sm text-slate-600 mb-3">Customer makes dinner reservation</p>
              <Button 
                onClick={() => startCall(1)} 
                disabled={callStatus !== 'ended'}
                className="rounded-2xl w-full"
                size="sm"
              >
                Start Demo
              </Button>
            </div>
            <div className="p-4 border rounded-xl">
              <h3 className="font-semibold">Support</h3>
              <p className="text-sm text-slate-600 mb-3">Customer needs technical help</p>
              <Button 
                onClick={() => startCall(2)} 
                disabled={callStatus !== 'ended'}
                className="rounded-2xl w-full"
                size="sm"
              >
                Start Demo
              </Button>
            </div>
            <div className="p-4 border rounded-xl">
              <h3 className="font-semibold">Sales</h3>
              <p className="text-sm text-slate-600 mb-3">Lead qualification & follow-up</p>
              <Button 
                onClick={() => startCall(3)} 
                disabled={callStatus !== 'ended'}
                className="rounded-2xl w-full"
                size="sm"
              >
                Start Demo
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