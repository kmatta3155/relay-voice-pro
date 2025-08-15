import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Check, X, Zap, Globe, Shield, Smartphone } from "lucide-react";

export default function CompetitiveShowcase() {
  const features = [
    {
      category: "Availability",
      icon: Zap,
      items: [
        { feature: "24/7 Operation", us: true, traditional: false, competitors: false },
        { feature: "Holiday Coverage", us: true, traditional: false, competitors: true },
        { feature: "Instant Response", us: true, traditional: false, competitors: false },
        { feature: "No Sick Days", us: true, traditional: false, competitors: true }
      ]
    },
    {
      category: "Language Support",
      icon: Globe,
      items: [
        { feature: "Real-time Translation", us: true, traditional: false, competitors: false },
        { feature: "32+ Languages", us: true, traditional: false, competitors: false },
        { feature: "Accent Adaptation", us: true, traditional: false, competitors: false },
        { feature: "Cultural Context", us: true, traditional: true, competitors: false }
      ]
    },
    {
      category: "Integration",
      icon: Smartphone,
      items: [
        { feature: "Calendar Sync", us: true, traditional: false, competitors: true },
        { feature: "CRM Integration", us: true, traditional: false, competitors: true },
        { feature: "Payment Processing", us: true, traditional: false, competitors: false },
        { feature: "Analytics Dashboard", us: true, traditional: false, competitors: true }
      ]
    },
    {
      category: "Security & Compliance",
      icon: Shield,
      items: [
        { feature: "HIPAA Compliant", us: true, traditional: true, competitors: false },
        { feature: "SOC2 Certified", us: true, traditional: false, competitors: false },
        { feature: "Call Recording", us: true, traditional: true, competitors: true },
        { feature: "Data Encryption", us: true, traditional: false, competitors: true }
      ]
    }
  ];

  const CheckIcon = ({ value }: { value: boolean }) => 
    value ? <Check className="h-4 w-4 text-green-600" /> : <X className="h-4 w-4 text-red-400" />;

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          Competitive Advantage Matrix
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-6">
          {features.map((category, idx) => (
            <div key={idx} className="space-y-3">
              <div className="flex items-center gap-2 pb-2 border-b">
                <category.icon className="h-4 w-4 text-primary" />
                <h4 className="font-semibold text-sm">{category.category}</h4>
              </div>
              
              <div className="space-y-2">
                <div className="grid grid-cols-4 gap-2 text-xs font-medium text-muted-foreground pb-1">
                  <div>Feature</div>
                  <div className="text-center">Our AI</div>
                  <div className="text-center">Traditional</div>
                  <div className="text-center">Competitors</div>
                </div>
                
                {category.items.map((item, itemIdx) => (
                  <div key={itemIdx} className="grid grid-cols-4 gap-2 py-2 items-center text-sm border-b border-gray-50 last:border-b-0">
                    <div className="font-medium">{item.feature}</div>
                    <div className="flex justify-center">
                      <CheckIcon value={item.us} />
                    </div>
                    <div className="flex justify-center">
                      <CheckIcon value={item.traditional} />
                    </div>
                    <div className="flex justify-center">
                      <CheckIcon value={item.competitors} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Value Proposition */}
        <div className="mt-6 p-4 bg-primary/5 rounded-lg border border-primary/20">
          <h4 className="font-semibold text-primary mb-2">Why Businesses Choose Our AI Receptionist</h4>
          <div className="grid md:grid-cols-2 gap-3 text-sm">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="w-fit">Cost</Badge>
              <span>87% lower than hiring staff</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="w-fit">Speed</Badge>
              <span>Deploy in under 24 hours</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="w-fit">Scale</Badge>
              <span>Handle unlimited concurrent calls</span>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="w-fit">Quality</Badge>
              <span>Consistent service every time</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}