import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { Phone, PhoneCall, PhoneOff, Mic, MicOff } from 'lucide-react';

interface VoiceConversationInterfaceProps {
  tenantId: string;
  customerData: any;
  onClose: () => void;
}

export default function VoiceConversationInterface({ 
  tenantId, 
  customerData, 
  onClose 
}: VoiceConversationInterfaceProps) {
  const { toast } = useToast();
  const [callStatus, setCallStatus] = useState<'idle' | 'connecting' | 'connected' | 'ended'>('idle');
  const [isConnecting, setIsConnecting] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [conversationId, setConversationId] = useState<string>('');

  const handleStartIncomingCallSimulation = async () => {
    try {
      setIsConnecting(true)
      setCallStatus('connecting')
      
      // Simulate incoming call delay
      await new Promise(resolve => setTimeout(resolve, 1000))
      
      setCallStatus('connected')
      setConversationId(`sim_${Date.now()}`)
      
      toast({
        title: "Incoming Call Simulation",
        description: "Simulating incoming call to AI receptionist",
      })
      
    } catch (error) {
      console.error('Failed to start call simulation:', error)
      toast({
        title: "Connection Failed",
        description: "Unable to start the voice conversation",
        variant: "destructive"
      })
      setCallStatus('idle')
    } finally {
      setIsConnecting(false)
    }
  }

  const handleEndCall = () => {
    setCallStatus('ended')
    setConversationId('')
    toast({
      title: "Call Ended",
      description: "Voice simulation ended",
    })
  }

  const toggleMute = () => {
    setIsMuted(!isMuted)
    toast({
      title: isMuted ? "Unmuted" : "Muted",
      description: `Microphone ${isMuted ? 'enabled' : 'disabled'}`,
    })
  }

  const getStatusBadge = () => {
    switch (callStatus) {
      case 'connecting':
        return <Badge variant="secondary">Connecting...</Badge>
      case 'connected':
        return <Badge variant="default">Connected</Badge>
      case 'ended':
        return <Badge variant="outline">Call Ended</Badge>
      default:
        return <Badge variant="outline">Ready</Badge>
    }
  }

  return (
    <Card className="w-full max-w-md mx-auto">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Phone className="h-5 w-5" />
            Voice Simulation
          </div>
          <Button variant="ghost" size="sm" onClick={onClose}>
            ×
          </Button>
        </CardTitle>
        <CardDescription>
          Simulate incoming calls to {customerData?.tenant?.business_name || 'the business'}
        </CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-6">
        {/* Call Status */}
        <div className="text-center space-y-4">
          {getStatusBadge()}
          
          {conversationId && (
            <div className="text-sm text-muted-foreground">
              Call ID: {conversationId}
            </div>
          )}
        </div>

        {/* Call Controls */}
        <div className="flex justify-center gap-4">
          {callStatus === 'idle' && (
            <Button 
              onClick={handleStartIncomingCallSimulation}
              disabled={isConnecting}
              size="lg"
              className="bg-green-600 hover:bg-green-700"
            >
              <PhoneCall className="h-5 w-5 mr-2" />
              Simulate Incoming Call
            </Button>
          )}

          {(callStatus === 'connecting' || callStatus === 'connected') && (
            <>
              <Button
                onClick={toggleMute}
                variant={isMuted ? "destructive" : "outline"}
                size="lg"
              >
                {isMuted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
              </Button>
              
              <Button
                onClick={handleEndCall}
                variant="destructive"
                size="lg"
              >
                <PhoneOff className="h-5 w-5 mr-2" />
                End Call
              </Button>
            </>
          )}

          {callStatus === 'ended' && (
            <Button 
              onClick={() => setCallStatus('idle')}
              variant="outline"
              size="lg"
            >
              <Phone className="h-5 w-5 mr-2" />
              Start New Simulation
            </Button>
          )}
        </div>

        {/* Call Information */}
        {callStatus === 'connected' && (
          <div className="bg-muted p-4 rounded-lg space-y-2">
            <div className="text-sm font-medium">AI Receptionist Active</div>
            <div className="text-xs text-muted-foreground">
              The AI is now answering incoming calls using:
              <ul className="mt-1 ml-4 list-disc">
                <li>Business knowledge from {customerData?.tenant?.business_name}</li>
                <li>Phone number: {customerData?.agent?.twilio_number || 'Not configured'}</li>
                <li>Voice: ElevenLabs AI voice</li>
              </ul>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}