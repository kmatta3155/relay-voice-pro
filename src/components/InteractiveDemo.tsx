import React from "react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Phone, Bot, Volume2, VolumeX, PhoneCall } from "lucide-react";
import { motion } from "framer-motion";
import { supabase } from "@/integrations/supabase/client";

interface DemoProps {
  className?: string;
}

export function InteractiveDemo({ className }: DemoProps) {
  const [currentScenario, setCurrentScenario] = React.useState(0);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [transcript, setTranscript] = React.useState<{speaker: string, text: string, timestamp: string, isGreeting?: boolean}[]>([]);
  const [currentMessage, setCurrentMessage] = React.useState(-2); // Start at -2 for phone ring
  const [audioEnabled, setAudioEnabled] = React.useState(true);
  const [currentAudio, setCurrentAudio] = React.useState<HTMLAudioElement | null>(null);
  const [callPhase, setCallPhase] = React.useState<'dialing' | 'ringing' | 'greeting' | 'conversation' | 'ended'>('dialing');

  const scenarios = [
    {
      title: "Serenity Spa",
      subtitle: "Appointment Booking",
      description: "Customer calling to book a massage appointment",
      phoneNumber: "(555) 123-RELAX",
      businessGreeting: "Thank you for calling Serenity Spa, where relaxation meets rejuvenation. This is your AI assistant, how may I help you today?",
      conversation: [
        { speaker: "Customer", text: "Hi, I'd like to book a deep tissue massage for this Saturday", timestamp: "09:34 AM", voice: "George" },
        { speaker: "RelayAI", text: "I'd be delighted to help you book a deep tissue massage for Saturday. What time would work best for you?", timestamp: "09:34 AM", voice: "Sarah" },
        { speaker: "Customer", text: "Around 2 PM would be perfect. How much does it cost?", timestamp: "09:35 AM", voice: "George" },
        { speaker: "RelayAI", text: "Perfect! Our 60-minute deep tissue massage is $120. I have an opening at 2:15 PM with Sarah, our senior therapist. She's wonderful and very experienced with stress relief. Would you like me to book that for you?", timestamp: "09:35 AM", voice: "Sarah" },
        { speaker: "Customer", text: "Yes, that sounds great. What's your cancellation policy?", timestamp: "09:36 AM", voice: "George" },
        { speaker: "RelayAI", text: "Excellent choice! We do require 24-hour notice for cancellations to avoid any fees. I'll need your name, phone number, and email to complete the booking. What name should I put this under?", timestamp: "09:36 AM", voice: "Sarah" },
        { speaker: "Customer", text: "It's Michael Thompson. My number is 555-0192 and email is mthompson@email.com", timestamp: "09:37 AM", voice: "George" },
        { speaker: "RelayAI", text: "Perfect, Michael! I've got you booked for a 60-minute deep tissue massage this Saturday at 2:15 PM with Sarah. You'll receive a confirmation text shortly. Is there anything specific I should let Sarah know about your preferences?", timestamp: "09:37 AM", voice: "Sarah" },
        { speaker: "Customer", text: "Just that I have some tension in my shoulders from work stress.", timestamp: "09:38 AM", voice: "George" },
        { speaker: "RelayAI", text: "Absolutely, I've made a note about your shoulder tension. Sarah specializes in that area and will take excellent care of you. We'll see you Saturday at 2:15 PM, Michael. Thank you for choosing Serenity Spa!", timestamp: "09:38 AM", voice: "Sarah" }
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
      title: "Bella Vista Restaurant",
      subtitle: "Dinner Reservation",
      description: "Customer calling for dinner reservation",
      phoneNumber: "(555) 456-DINE",
      businessGreeting: "Good evening and thank you for calling Bella Vista Restaurant. This is your AI host assistant. How may I help you create a wonderful dining experience tonight?",
      conversation: [
        { speaker: "Customer", text: "Hi, I need a table for 4 people tonight around 7 PM", timestamp: "02:15 PM", voice: "Charlotte" },
        { speaker: "RelayAI", text: "I'd be happy to help with your reservation for 4 people tonight. Let me check our availability around 7 PM.", timestamp: "02:15 PM", voice: "Sarah" },
        { speaker: "Customer", text: "Do you have any outdoor seating available? The weather looks beautiful today.", timestamp: "02:16 PM", voice: "Charlotte" },
        { speaker: "RelayAI", text: "You're absolutely right about the weather! I have a lovely patio table for 4 at 7:15 PM. It's covered with heaters and beautiful string lights - very romantic atmosphere. Would that work perfectly for you?", timestamp: "02:16 PM", voice: "Sarah" },
        { speaker: "Customer", text: "That sounds wonderful! Also, one person in our group has a gluten allergy. Do you have gluten-free options?", timestamp: "02:17 PM", voice: "Charlotte" },
        { speaker: "RelayAI", text: "Absolutely! We have an extensive gluten-free menu including our famous gluten-free pasta, wood-fired pizza, and even desserts. I'll make a special note about the allergy for our kitchen staff. Can I get your name and phone number for the reservation?", timestamp: "02:17 PM", voice: "Sarah" },
        { speaker: "Customer", text: "It's Sarah Chen, and my number is 555-0156. Thank you so much for being so accommodating!", timestamp: "02:18 PM", voice: "Charlotte" },
        { speaker: "RelayAI", text: "My pleasure, Sarah! I've reserved your patio table for 4 at 7:15 PM tonight with a special note about the gluten allergy. Our chef will personally ensure everything is safe and delicious. We can't wait to see you tonight!", timestamp: "02:18 PM", voice: "Sarah" }
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
      title: "Premier Services",
      subtitle: "Customer Support",
      description: "Existing customer calling about service issue",
      phoneNumber: "(555) 789-HELP",
      businessGreeting: "Thank you for calling Premier Services, where your satisfaction is our absolute priority. This is your AI customer care specialist. How can I make your day better?",
      conversation: [
        { speaker: "Customer", text: "Hi, I had an appointment yesterday but my therapist was running late. I'm not happy about it.", timestamp: "10:22 AM", voice: "Liam" },
        { speaker: "RelayAI", text: "I sincerely apologize for the delay you experienced yesterday. I completely understand your frustration, and that's definitely not the standard of service we strive for. Let me look up your appointment and see how we can make this right immediately.", timestamp: "10:22 AM", voice: "Sarah" },
        { speaker: "Customer", text: "I waited 25 minutes past my appointment time. That's unacceptable for a premium service, especially when I have a busy schedule.", timestamp: "10:23 AM", voice: "Liam" },
        { speaker: "RelayAI", text: "You're absolutely right, and I want to make this right immediately. I'd like to offer you a complimentary 30-minute add-on to your next massage, plus a 20% discount on that entire service. Would that help restore your confidence in us?", timestamp: "10:23 AM", voice: "Sarah" },
        { speaker: "Customer", text: "That's actually quite generous. I appreciate you taking this seriously and not just brushing it off.", timestamp: "10:24 AM", voice: "Liam" },
        { speaker: "RelayAI", text: "We value you as a client and your time is precious to us. I've already added those credits to your account, and I'll personally ensure this doesn't happen again. I've also flagged your future appointments for priority scheduling. Is there anything else I can help you with today?", timestamp: "10:24 AM", voice: "Sarah" },
        { speaker: "Customer", text: "No, that covers it. Thank you for handling this so professionally.", timestamp: "10:25 AM", voice: "Liam" },
        { speaker: "RelayAI", text: "It's been my absolute pleasure to help resolve this. You'll receive a confirmation email with all the details shortly. Thank you for giving us the opportunity to make it right!", timestamp: "10:25 AM", voice: "Sarah" }
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

  // Enhanced TTS function with better voice settings and error handling
  const playTTS = async (text: string, voiceId: string): Promise<void> => {
    if (!audioEnabled) return;
    
    try {
      // Map voice names to ElevenLabs voice IDs with premium voices
      const voiceMap: { [key: string]: string } = {
        'Sarah': 'EXAVITQu4vr4xnSDxMaL',    // Professional female voice for AI
        'George': 'JBFqnCBsd6RMkjVDRZzb',   // Mature male customer voice
        'Charlotte': 'XB0fDUnXU5powFXDhCwa', // Young female customer voice 
        'Liam': 'TX3LPaxmHKxFdv7VOQHJ'      // Young male customer voice
      };

      console.log(`Playing TTS: "${text.substring(0, 30)}..." with voice: ${voiceId}`);

      const { data, error } = await supabase.functions.invoke('text-to-speech', {
        body: { 
          text,
          voice_id: voiceMap[voiceId] || voiceMap['Sarah']
        }
      });

      if (error) {
        console.warn('TTS API Error - continuing demo without audio:', error);
        return;
      }

      if (!data?.audioContent) {
        console.warn('No audio content received');
        return;
      }

      // Simple, reliable audio playback
      return new Promise((resolve) => {
        try {
          const audio = new Audio();
          audio.src = `data:audio/mpeg;base64,${data.audioContent}`;
          audio.volume = 0.8;
          
          audio.onended = () => {
            setCurrentAudio(null);
            resolve();
          };
          
          audio.onerror = () => {
            console.warn('Audio failed, continuing demo');
            setCurrentAudio(null);
            resolve();
          };
          
          setCurrentAudio(audio);
          audio.play().catch(() => {
            console.warn('Audio autoplay blocked, continuing demo');
            setCurrentAudio(null);
            resolve();
          });
          
        } catch (error) {
          console.warn('Audio setup failed:', error);
          resolve();
        }
      });
    } catch (error) {
      console.warn('TTS Error - continuing demo:', error);
    }
  };

  // Enhanced American phone ring sound
  const playPhoneRing = (): Promise<void> => {
    if (!audioEnabled) return Promise.resolve();
    
    return new Promise((resolve) => {
      try {
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
        const masterGain = audioContext.createGain();
        masterGain.connect(audioContext.destination);
        masterGain.gain.setValueAtTime(0.3, audioContext.currentTime);
        
        // Create authentic American phone ring tone
        const createAmericanRingTone = (startTime: number) => {
          // Standard North American ring tone: 440Hz + 480Hz sine waves
          const frequencies = [440, 480];
          
          frequencies.forEach((freq, index) => {
            const oscillator = audioContext.createOscillator();
            const gainNode = audioContext.createGain();
            
            oscillator.connect(gainNode);
            gainNode.connect(masterGain);
            
            oscillator.frequency.setValueAtTime(freq, audioContext.currentTime);
            oscillator.type = 'sine';
            
            // Classic US ring pattern: 2 seconds on, 4 seconds off
            const envelope = [
              { time: 0, gain: 0 },
              { time: 0.1, gain: 0.8 - (index * 0.1) }, // Slight frequency mixing
              { time: 2.0, gain: 0.8 - (index * 0.1) },
              { time: 2.1, gain: 0 }
            ];
            
            envelope.forEach(point => {
              gainNode.gain.setValueAtTime(point.gain, audioContext.currentTime + startTime + point.time);
            });
            
            oscillator.start(audioContext.currentTime + startTime);
            oscillator.stop(audioContext.currentTime + startTime + 2.2);
          });
        };
        
        // Play American ring pattern - 2 rings
        createAmericanRingTone(0);
        createAmericanRingTone(4);
        
        setTimeout(resolve, 6000);
      } catch (error) {
        console.warn('Phone ring audio failed:', error);
        resolve();
      }
    });
  };

  React.useEffect(() => {
    if (!isPlaying) return;
    
    const currentConvo = scenarios[currentScenario].conversation;
    
    const timer = setTimeout(async () => {
      if (currentMessage === -2) {
        // Show dialing phase
        setCallPhase('dialing');
        setTranscript([{ speaker: "System", text: `📞 Dialing ${scenarios[currentScenario].phoneNumber}...`, timestamp: "now", isGreeting: false }]);
        setCurrentMessage(-1);
      } else if (currentMessage === -1) {
        // Play phone ringing and show ringing phase
        setCallPhase('ringing');
        setTranscript(prev => [...prev, { speaker: "System", text: "🔔 Phone ringing...", timestamp: "now", isGreeting: false }]);
        await playPhoneRing();
        setCurrentMessage(0);
      } else if (currentMessage === 0) {
        // Play business greeting
        setCallPhase('greeting');
        const greeting = {
          speaker: "RelayAI",
          text: scenarios[currentScenario].businessGreeting,
          timestamp: currentConvo[0]?.timestamp || "now",
          isGreeting: true
        };
        setTranscript(prev => [...prev, greeting]);
        await playTTS(greeting.text, "Sarah");
        setCurrentMessage(1);
      } else if (currentMessage <= currentConvo.length) {
        // Play conversation
        setCallPhase('conversation');
        if (currentMessage <= currentConvo.length) {
          const message = currentConvo[currentMessage - 1];
          setTranscript(prev => [...prev, message]);
          
          if (message.voice) {
            await playTTS(message.text, message.voice);
          }
          
          setCurrentMessage(prev => prev + 1);
        }
      } else {
        // End call
        setCallPhase('ended');
        setIsPlaying(false);
      }
    }, currentMessage === -2 ? 800 : currentMessage === -1 ? 1200 : currentMessage === 0 ? 2000 : 3500);

    return () => clearTimeout(timer);
  }, [isPlaying, currentMessage, currentScenario, audioEnabled]);

  const startDemo = () => {
    setTranscript([]);
    setCurrentMessage(-2);
    setCallPhase('dialing');
    setIsPlaying(true);
  };

  const resetDemo = () => {
    setIsPlaying(false);
    setTranscript([]);
    setCurrentMessage(-2);
    setCallPhase('dialing');
    if (currentAudio) {
      currentAudio.pause();
      currentAudio.currentTime = 0;
      setCurrentAudio(null);
    }
  };

  return (
    <div className={`max-w-6xl mx-auto ${className}`}>
      <div className="grid lg:grid-cols-2 gap-8">
        {/* Demo Controls */}
        <div className="space-y-6">
          <Card className="p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold">Choose a Business Demo</h3>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAudioEnabled(!audioEnabled)}
                className="flex items-center gap-2"
              >
                {audioEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
                {audioEnabled ? 'Audio On' : 'Audio Off'}
              </Button>
            </div>
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
                  <div className="w-full">
                    <div className="flex items-center justify-between mb-1">
                      <div className="font-medium">{scenario.title}</div>
                      <div className="text-xs text-muted-foreground">{scenario.phoneNumber}</div>
                    </div>
                    <div className="text-sm text-muted-foreground">{scenario.subtitle}</div>
                    <div className="text-xs text-muted-foreground mt-1">{scenario.description}</div>
                  </div>
                </Button>
              ))}
            </div>
            
            <div className="mt-6 flex gap-3">
              <Button onClick={startDemo} disabled={isPlaying} className="flex-1">
                <PhoneCall className="w-4 h-4 mr-2" />
                {isPlaying ? "Call in Progress..." : "Start Demo Call"}
              </Button>
              <Button variant="outline" onClick={resetDemo}>
                Reset
              </Button>
            </div>
            
            {audioEnabled && (
              <div className="mt-4 p-3 bg-muted/50 rounded-lg">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <Volume2 className="w-4 h-4" />
                  <span>🎙️ Enhanced AI voices powered by ElevenLabs</span>
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Premium voice models for human-like conversation
                </div>
              </div>
            )}
          </Card>

          {/* AI Insights */}
          {transcript.length > 0 && callPhase === 'conversation' && (
            <Card className="p-6">
              <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
                <Bot className="w-5 h-5" />
                Live AI Insights
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
                    <h4 className="font-medium mb-2">📅 Booking Details:</h4>
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
                    <h4 className="font-medium mb-2">🍽️ Reservation Details:</h4>
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
                    <h4 className="font-medium mb-2">🎯 Resolution Details:</h4>
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

        {/* Live Call Interface */}
        <div>
          <Card className="p-6 h-[600px]">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-xl font-semibold flex items-center gap-2">
                <Phone className="w-5 h-5" />
                Live Call Experience
              </h3>
              <div className="flex items-center gap-4">
                {currentAudio && audioEnabled && (
                  <div className="flex items-center gap-2 text-sm text-green-600">
                    <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                    Speaking
                  </div>
                )}
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <div className={`w-2 h-2 rounded-full ${
                    callPhase === 'dialing' ? 'bg-yellow-500 animate-pulse' :
                    callPhase === 'ringing' ? 'bg-blue-500 animate-pulse' :
                    callPhase === 'greeting' || callPhase === 'conversation' ? 'bg-green-500 animate-pulse' :
                    'bg-gray-400'
                  }`}></div>
                  {callPhase === 'dialing' ? 'Dialing...' :
                   callPhase === 'ringing' ? 'Ringing...' :
                   callPhase === 'greeting' || callPhase === 'conversation' ? 'Connected' :
                   'Idle'}
                </div>
              </div>
            </div>
            
            <div className="h-[500px] overflow-y-auto space-y-3">
              {transcript.length === 0 ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <PhoneCall className="w-12 h-12 mx-auto mb-3 opacity-50" />
                    <p>Select a business and click "Start Demo Call"</p>
                    <p className="text-sm mt-1">Experience a real customer call from start to finish</p>
                  </div>
                </div>
              ) : (
                transcript.map((message, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex ${
                      message.speaker === 'Customer' ? 'justify-end' : 
                      message.speaker === 'System' ? 'justify-center' :
                      'justify-start'
                    }`}
                  >
                    {message.speaker === 'System' ? (
                      <div className="text-center py-2">
                        <span className="text-sm text-muted-foreground bg-muted px-3 py-1 rounded-full">
                          {message.text}
                        </span>
                      </div>
                    ) : (
                      <div className={`max-w-[80%] rounded-lg p-3 ${
                        message.speaker === 'Customer' 
                          ? 'bg-primary text-primary-foreground' 
                          : message.isGreeting
                          ? 'bg-accent text-accent-foreground border-2 border-primary/20'
                          : 'bg-muted'
                      }`}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium">
                            {message.isGreeting ? `${scenarios[currentScenario].title} AI` : message.speaker}
                          </span>
                          <span className="text-xs opacity-70">{message.timestamp}</span>
                        </div>
                        <p className="text-sm">{message.text}</p>
                      </div>
                    )}
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
          <h3 className="text-2xl font-semibold mb-2">Ready to deploy your AI receptionist?</h3>
          <p className="mb-6 opacity-90">Set up professional AI phone handling with natural conversation in under 10 minutes</p>
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