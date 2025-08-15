import React, { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Calendar, CreditCard, MessageSquare, Mail, Bell, Users, CheckCircle, Clock } from "lucide-react";

interface Integration {
  name: string;
  icon: any;
  description: string;
  status: "connected" | "available" | "processing";
  action: string;
}

export default function IntegrationShowcase() {
  const [integrations] = useState<Integration[]>([
    {
      name: "Calendar Sync",
      icon: Calendar,
      description: "Appointment automatically added to Google Calendar",
      status: "processing",
      action: "Booking Maya for Friday 2:15 PM"
    },
    {
      name: "Payment Processing",
      icon: CreditCard,
      description: "Deposit link sent via SMS",
      status: "connected",
      action: "25% deposit ($22.50) requested"
    },
    {
      name: "SMS Notifications",
      icon: MessageSquare,
      description: "Confirmation sent to customer",
      status: "connected",
      action: "SMS sent to (919) 555-0198"
    },
    {
      name: "Email Marketing",
      icon: Mail,
      description: "Customer added to newsletter",
      status: "processing",
      action: "Adding to Spa Wellness list"
    },
    {
      name: "Staff Alerts",
      icon: Bell,
      description: "Maya notified of new appointment",
      status: "connected",
      action: "Push notification sent"
    },
    {
      name: "CRM Update",
      icon: Users,
      description: "Customer profile created/updated",
      status: "processing",
      action: "Updating Jamie Patel's profile"
    }
  ]);

  const getStatusColor = (status: string) => {
    switch (status) {
      case "connected": return "bg-green-100 text-green-700 border-green-200";
      case "processing": return "bg-yellow-100 text-yellow-700 border-yellow-200";
      case "available": return "bg-gray-100 text-gray-700 border-gray-200";
      default: return "bg-gray-100 text-gray-700 border-gray-200";
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "connected": return <CheckCircle className="h-3 w-3" />;
      case "processing": return <Clock className="h-3 w-3" />;
      default: return null;
    }
  };

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="h-5 w-5" />
          Real-Time Integration Hub
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground mb-4">
          Watch as your AI receptionist automatically triggers actions across your business systems
        </div>

        <div className="space-y-3">
          {integrations.map((integration, idx) => (
            <div key={idx} className="flex items-center gap-3 p-3 border rounded-lg bg-card hover:bg-accent/50 transition-colors">
              <div className="flex-shrink-0">
                <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center">
                  <integration.icon className="h-5 w-5 text-primary" />
                </div>
              </div>
              
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-medium text-sm">{integration.name}</span>
                  <Badge className={`text-xs px-2 py-0.5 ${getStatusColor(integration.status)}`}>
                    <div className="flex items-center gap-1">
                      {getStatusIcon(integration.status)}
                      {integration.status === "processing" ? "Processing" : 
                       integration.status === "connected" ? "Complete" : "Available"}
                    </div>
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground mb-1">
                  {integration.description}
                </div>
                <div className="text-xs font-medium text-primary">
                  {integration.action}
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Popular Integrations */}
        <div className="mt-6 p-4 border rounded-lg bg-muted/30">
          <h4 className="font-semibold text-sm mb-3">Popular Business Integrations</h4>
          <div className="grid grid-cols-3 gap-2">
            {[
              "Calendly", "Stripe", "Square", "Mailchimp", 
              "HubSpot", "Salesforce", "Slack", "Zapier", "Twilio"
            ].map((app, idx) => (
              <Badge key={idx} variant="outline" className="justify-center py-1">
                {app}
              </Badge>
            ))}
          </div>
          <Button variant="link" size="sm" className="mt-2 p-0 h-auto">
            View all 200+ integrations →
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}