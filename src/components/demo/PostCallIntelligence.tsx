import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { User, Phone, Calendar, DollarSign, AlertCircle, TrendingUp, Clock } from "lucide-react";

interface PostCallIntelligenceProps {
  scenario: string;
  customerData: {
    name: string;
    phone: string;
    service: string;
    urgency: "High" | "Medium" | "Low";
    revenue: number;
    conversionProb: number;
  };
  businessImpact: {
    appointmentBooked: boolean;
    followUpScheduled: boolean;
    paymentProcessed: boolean;
    staffNotified: boolean;
  };
}

export default function PostCallIntelligence({ scenario, customerData, businessImpact }: PostCallIntelligenceProps) {
  const getUrgencyColor = (urgency: string) => {
    switch (urgency) {
      case "High": return "destructive";
      case "Medium": return "default";
      case "Low": return "secondary";
      default: return "outline";
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Post-Call Intelligence
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Customer Intelligence */}
        <div className="grid md:grid-cols-2 gap-4">
          <div className="space-y-3">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <User className="h-4 w-4" />
              Lead Intelligence
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Customer:</span>
                <span className="font-medium">{customerData.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Phone:</span>
                <span className="font-medium">{customerData.phone}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Service:</span>
                <span className="font-medium">{customerData.service}</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">Urgency:</span>
                <Badge variant={getUrgencyColor(customerData.urgency) as any}>
                  {customerData.urgency}
                </Badge>
              </div>
            </div>
          </div>

          <div className="space-y-3">
            <h4 className="font-semibold text-sm flex items-center gap-2">
              <DollarSign className="h-4 w-4" />
              Revenue Impact
            </h4>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. Value:</span>
                <span className="font-medium text-green-600">${customerData.revenue}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Conversion:</span>
                <span className="font-medium">{customerData.conversionProb}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Time Saved:</span>
                <span className="font-medium text-blue-600">12 min</span>
              </div>
            </div>
          </div>
        </div>

        {/* Business Actions */}
        <div className="space-y-3">
          <h4 className="font-semibold text-sm flex items-center gap-2">
            <Calendar className="h-4 w-4" />
            Automated Actions
          </h4>
          <div className="grid grid-cols-2 gap-2">
            <div className={`flex items-center gap-2 p-2 rounded-lg ${businessImpact.appointmentBooked ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>
              <div className={`w-2 h-2 rounded-full ${businessImpact.appointmentBooked ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className="text-xs">Appointment Booked</span>
            </div>
            <div className={`flex items-center gap-2 p-2 rounded-lg ${businessImpact.followUpScheduled ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>
              <div className={`w-2 h-2 rounded-full ${businessImpact.followUpScheduled ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className="text-xs">Follow-up Scheduled</span>
            </div>
            <div className={`flex items-center gap-2 p-2 rounded-lg ${businessImpact.paymentProcessed ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>
              <div className={`w-2 h-2 rounded-full ${businessImpact.paymentProcessed ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className="text-xs">Payment Link Sent</span>
            </div>
            <div className={`flex items-center gap-2 p-2 rounded-lg ${businessImpact.staffNotified ? 'bg-green-50 text-green-700' : 'bg-gray-50 text-gray-500'}`}>
              <div className={`w-2 h-2 rounded-full ${businessImpact.staffNotified ? 'bg-green-500' : 'bg-gray-300'}`} />
              <span className="text-xs">Staff Notified</span>
            </div>
          </div>
        </div>

        {/* Suggested Actions */}
        <div className="space-y-3">
          <h4 className="font-semibold text-sm flex items-center gap-2">
            <AlertCircle className="h-4 w-4" />
            Suggested Next Actions
          </h4>
          <div className="grid gap-2">
            <Button variant="outline" size="sm" className="justify-start h-auto p-3">
              <Clock className="h-4 w-4 mr-2" />
              <div className="text-left">
                <div className="font-medium">Send reminder 24h before</div>
                <div className="text-xs text-muted-foreground">Reduce no-shows by 40%</div>
              </div>
            </Button>
            <Button variant="outline" size="sm" className="justify-start h-auto p-3">
              <Phone className="h-4 w-4 mr-2" />
              <div className="text-left">
                <div className="font-medium">Upsell preparation session</div>
                <div className="text-xs text-muted-foreground">+$75 average revenue increase</div>
              </div>
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}