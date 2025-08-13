import React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Phone, Bot } from "lucide-react";
import { motion } from "framer-motion";

interface DemoProps {
  className?: string;
}

export function InteractiveDemo({ className }: DemoProps) {
  const [currentScenario, setCurrentScenario] = React.useState(0);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [transcript, setTranscript] = React.useState<{speaker: string, text: string, timestamp: string}[]>([]);
  const [currentMessage, setCurrentMessage] = React.useState(0);

  const scenarios = [
    {
      title: "Spa Appointment Booking",
      description: "Customer calling to book a massage appointment",
      conversation: [
        { speaker: "Customer", text: "Hi, I'd like to book a deep tissue massage for this Saturday", timestamp: "09:34 AM" },
        { speaker: "RelayAI", text: "I'd be happy to help you book a deep tissue massage for Saturday. What time would work best for you?", timestamp: "09:34 AM" },
        { speaker: "Customer", text: "Around 2 PM would be perfect. How much does it cost?", timestamp: "09:35 AM" },
        { speaker: "RelayAI", text: "Perfect! Our 60-minute deep tissue massage is $120. I have an opening at 2:15 PM with Sarah, our senior therapist. Would you like me to book that for you?", timestamp: "09:35 AM" },
        { speaker: "Customer", text: "Yes, that sounds great. What's your cancellation policy?", timestamp: "09:36 AM" },
        { speaker: "RelayAI", text: "We require 24-hour notice for cancellations. I'll need your name, phone number, and email to complete the booking.", timestamp: "09:36 AM" }
      ],
      insights: {
        intent: "Appointment Booking",
        confidence: 98,
        appointment: {
          service: "Deep Tissue Massage (60 min)",
          date: "Saturday, Nov 16",
          time: "2:15 PM",
          therapist: "Sarah",
          price: "$120"
        }
      }
    },
    {
      title: "Restaurant Reservation",
      description: "Customer calling for dinner reservation",
      conversation: [
        { speaker: "Customer", text: "Hi, I need a table for 4 people tonight around 7 PM", timestamp: "02:15 PM" },
        { speaker: "RelayAI", text: "I'd be happy to help with your reservation for 4 people tonight. Let me check our availability around 7 PM.", timestamp: "02:15 PM" },
        { speaker: "Customer", text: "Do you have any outdoor seating available?", timestamp: "02:16 PM" },
        { speaker: "RelayAI", text: "Yes! I have a lovely patio table for 4 at 7:15 PM. It's covered and heated. Would that work for you?", timestamp: "02:16 PM" },
        { speaker: "Customer", text: "Perfect! Also, one person has a gluten allergy. Do you have gluten-free options?", timestamp: "02:17 PM" },
        { speaker: "RelayAI", text: "Absolutely! We have a full gluten-free menu including pasta, pizza, and desserts. I'll make a note about the allergy. Can I get your name and phone number?", timestamp: "02:17 PM" }
      ],
      insights: {
        intent: "Restaurant Reservation",
        confidence: 96,
        reservation: {
          party_size: "4 people",
          date: "Tonight",
          time: "7:15 PM",
          seating: "Outdoor patio",
          special_requests: "Gluten allergy accommodation"
        }
      }
    },
    {
      title: "Customer Support",
      description: "Existing customer calling about service issue",
      conversation: [
        { speaker: "Customer", text: "Hi, I had an appointment yesterday but my therapist was running late. I'm not happy about it.", timestamp: "10:22 AM" },
        { speaker: "RelayAI", text: "I sincerely apologize for the delay you experienced. Let me look up your appointment and see how we can make this right.", timestamp: "10:22 AM" },
        { speaker: "Customer", text: "I waited 25 minutes. That's unacceptable for a premium service.", timestamp: "10:23 AM" },
        { speaker: "RelayAI", text: "You're absolutely right, and I understand your frustration. I'd like to offer you a complimentary 30-minute add-on to your next massage and a 20% discount. Would that help restore your confidence in our service?", timestamp: "10:23 AM" },
        { speaker: "Customer", text: "That's actually quite generous. Yes, I'd appreciate that.", timestamp: "10:24 AM" },
        { speaker: "RelayAI", text: "Wonderful! I've added those credits to your account. Is there anything else I can help you with today?", timestamp: "10:24 AM" }
      ],
      insights: {
        intent: "Customer Complaint Resolution",
        confidence: 94,
        resolution: {
          issue: "Late appointment (25 min delay)",
          compensation: "30-min add-on + 20% discount",
          status: "Resolved",
          satisfaction: "High"
        }
      }
    }
  ];

  React.useEffect(() => {
    if (!isPlaying) return;
    
    const currentConvo = scenarios[currentScenario].conversation;
    if (currentMessage >= currentConvo.length) {
      setIsPlaying(false);
      return;
    }

    const timer = setTimeout(() => {
      setTranscript(prev => [...prev, currentConvo[currentMessage]]);
      setCurrentMessage(prev => prev + 1);
    }, 2000);

    return () => clearTimeout(timer);
  }, [isPlaying, currentMessage, currentScenario]);

  const startDemo = () => {
    setTranscript([]);
    setCurrentMessage(0);
    setIsPlaying(true);
  };

  const resetDemo = () => {
    setIsPlaying(false);
    setTranscript([]);
    setCurrentMessage(0);
  };

  return (
    <div className={`max-w-6xl mx-auto ${className}`}>
      <div className="grid lg:grid-cols-2 gap-8">
        {/* Demo Controls */}
        <div className="space-y-6">
          <Card className="p-6">
            <h3 className="text-xl font-semibold mb-4">Choose a Scenario</h3>
            <div className="space-y-3">
              {scenarios.map((scenario, index) => (
                <Button
                  key={index}
                  variant={currentScenario === index ? "default" : "outline"}
                  className="w-full justify-start text-left h-auto p-4"
                  onClick={() => {
                    setCurrentScenario(index);
                    resetDemo();
                  }}
                >
                  <div>
                    <div className="font-medium">{scenario.title}</div>
                    <div className="text-sm text-muted-foreground">{scenario.description}</div>
                  </div>
                </Button>
              ))}
            </div>
            
            <div className="mt-6 flex gap-3">
              <Button onClick={startDemo} disabled={isPlaying} className="flex-1">
                {isPlaying ? "Playing..." : "Start Demo"}
              </Button>
              <Button variant="outline" onClick={resetDemo}>
                Reset
              </Button>
            </div>
          </Card>

          {/* AI Insights */}
          {transcript.length > 0 && (
            <Card className="p-6">
              <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Bot className="w-5 h-5" />
                AI Insights
              </h3>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="font-medium">Intent Detection:</span>
                  <span className="text-primary">{scenarios[currentScenario].insights.intent}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-medium">Confidence:</span>
                  <span className="text-green-600">{scenarios[currentScenario].insights.confidence}%</span>
                </div>
                
                {scenarios[currentScenario].insights.appointment && (
                  <div className="mt-4 p-4 bg-muted rounded-lg">
                    <h4 className="font-medium mb-2">Booking Details:</h4>
                    <div className="space-y-1 text-sm">
                      <div><strong>Service:</strong> {scenarios[currentScenario].insights.appointment?.service}</div>
                      <div><strong>Date:</strong> {scenarios[currentScenario].insights.appointment?.date}</div>
                      <div><strong>Time:</strong> {scenarios[currentScenario].insights.appointment?.time}</div>
                      <div><strong>Provider:</strong> {scenarios[currentScenario].insights.appointment?.therapist}</div>
                      <div><strong>Price:</strong> {scenarios[currentScenario].insights.appointment?.price}</div>
                    </div>
                  </div>
                )}

                {scenarios[currentScenario].insights.reservation && (
                  <div className="mt-4 p-4 bg-muted rounded-lg">
                    <h4 className="font-medium mb-2">Reservation Details:</h4>
                    <div className="space-y-1 text-sm">
                      <div><strong>Party Size:</strong> {scenarios[currentScenario].insights.reservation?.party_size}</div>
                      <div><strong>Date:</strong> {scenarios[currentScenario].insights.reservation?.date}</div>
                      <div><strong>Time:</strong> {scenarios[currentScenario].insights.reservation?.time}</div>
                      <div><strong>Seating:</strong> {scenarios[currentScenario].insights.reservation?.seating}</div>
                      <div><strong>Notes:</strong> {scenarios[currentScenario].insights.reservation?.special_requests}</div>
                    </div>
                  </div>
                )}

                {scenarios[currentScenario].insights.resolution && (
                  <div className="mt-4 p-4 bg-muted rounded-lg">
                    <h4 className="font-medium mb-2">Resolution Details:</h4>
                    <div className="space-y-1 text-sm">
                      <div><strong>Issue:</strong> {scenarios[currentScenario].insights.resolution?.issue}</div>
                      <div><strong>Compensation:</strong> {scenarios[currentScenario].insights.resolution?.compensation}</div>
                      <div><strong>Status:</strong> {scenarios[currentScenario].insights.resolution?.status}</div>
                      <div><strong>Satisfaction:</strong> {scenarios[currentScenario].insights.resolution?.satisfaction}</div>
                    </div>
                  </div>
                )}
              </div>
            </Card>
          )}
        </div>

        {/* Live Transcript */}
        <div>
          <Card className="p-6 h-[600px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold flex items-center gap-2">
                <Phone className="w-5 h-5" />
                Live Call Transcript
              </h3>
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <div className={`w-2 h-2 rounded-full ${isPlaying ? 'bg-red-500 animate-pulse' : 'bg-gray-400'}`}></div>
                {isPlaying ? 'Recording' : 'Idle'}
              </div>
            </div>
            
            <div className="h-[500px] overflow-y-auto space-y-3">
              {transcript.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  Select a scenario and click "Start Demo" to begin
                </div>
              ) : (
                transcript.map((message, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex ${message.speaker === 'Customer' ? 'justify-end' : 'justify-start'}`}
                  >
                    <div className={`max-w-[80%] rounded-lg p-3 ${
                      message.speaker === 'Customer' 
                        ? 'bg-primary text-primary-foreground' 
                        : 'bg-muted'
                    }`}>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium">{message.speaker}</span>
                        <span className="text-xs opacity-70">{message.timestamp}</span>
                      </div>
                      <p className="text-sm">{message.text}</p>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </Card>
        </div>
      </div>
      
      {/* Call to Action */}
      <div className="mt-10 text-center">
        <Card className="p-8 bg-primary text-primary-foreground">
          <h3 className="text-2xl font-semibold mb-2">Ready to try it with your business?</h3>
          <p className="mb-6 opacity-90">Set up your AI receptionist in under 10 minutes</p>
          <div className="flex flex-wrap justify-center gap-4">
            <Button asChild size="lg" variant="secondary">
              <a href="#app">Start Free Trial</a>
            </Button>
            <Button asChild size="lg" variant="outline" className="bg-transparent border-primary-foreground/20 text-primary-foreground hover:bg-primary-foreground/10">
              <a href="#contact">Book Demo Call</a>
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}