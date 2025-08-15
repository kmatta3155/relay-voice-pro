import React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { TrendingUp, Phone, Calendar, DollarSign, Clock, Users, Star } from "lucide-react";

interface AnalyticsDashboardProps {
  metrics: {
    callsHandled: number;
    conversionRate: number;
    revenueGenerated: number;
    timeSaved: number;
    customerSatisfaction: number;
    missedCallsRecovered: number;
  };
}

export default function AnalyticsDashboard({ metrics }: AnalyticsDashboardProps) {
  const cards = [
    {
      title: "Calls Handled",
      value: metrics.callsHandled.toLocaleString(),
      change: "+24%",
      icon: Phone,
      trend: "up",
      color: "text-blue-600",
      bgColor: "bg-blue-50"
    },
    {
      title: "Conversion Rate",
      value: `${metrics.conversionRate}%`,
      change: "+8.3%",
      icon: TrendingUp,
      trend: "up",
      color: "text-green-600",
      bgColor: "bg-green-50"
    },
    {
      title: "Revenue Generated",
      value: `$${metrics.revenueGenerated.toLocaleString()}`,
      change: "+42%",
      icon: DollarSign,
      trend: "up",
      color: "text-emerald-600",
      bgColor: "bg-emerald-50"
    },
    {
      title: "Time Saved",
      value: `${metrics.timeSaved}h`,
      change: "vs traditional",
      icon: Clock,
      trend: "neutral",
      color: "text-orange-600",
      bgColor: "bg-orange-50"
    },
    {
      title: "Customer Satisfaction",
      value: `${metrics.customerSatisfaction}/5`,
      change: "+0.4",
      icon: Star,
      trend: "up",
      color: "text-yellow-600",
      bgColor: "bg-yellow-50"
    },
    {
      title: "After-Hours Recovery",
      value: metrics.missedCallsRecovered.toString(),
      change: "calls saved",
      icon: Users,
      trend: "up",
      color: "text-purple-600",
      bgColor: "bg-purple-50"
    }
  ];

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Live Analytics Dashboard
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {cards.map((card, index) => (
              <div key={index} className={`p-4 rounded-lg ${card.bgColor}`}>
                <div className="flex items-center justify-between mb-2">
                  <card.icon className={`h-5 w-5 ${card.color}`} />
                  {card.trend === "up" && (
                    <Badge variant="secondary" className="text-xs bg-white/50">
                      {card.change}
                    </Badge>
                  )}
                </div>
                <div className="space-y-1">
                  <div className={`text-2xl font-bold ${card.color}`}>
                    {card.value}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {card.title}
                  </div>
                  {card.trend === "neutral" && (
                    <div className="text-xs text-muted-foreground">
                      {card.change}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* ROI Highlight */}
      <Card className="bg-gradient-to-r from-green-50 to-emerald-50 border-green-200">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-lg font-semibold text-green-800">Monthly ROI Impact</h3>
              <p className="text-green-600">Your AI receptionist is generating measurable results</p>
            </div>
            <div className="text-right">
              <div className="text-3xl font-bold text-green-700">247%</div>
              <div className="text-sm text-green-600">Return on Investment</div>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-4 mt-4 pt-4 border-t border-green-200">
            <div className="text-center">
              <div className="text-xl font-bold text-green-700">$12,450</div>
              <div className="text-xs text-green-600">Revenue Captured</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-green-700">$3,200</div>
              <div className="text-xs text-green-600">Cost Savings</div>
            </div>
            <div className="text-center">
              <div className="text-xl font-bold text-green-700">156</div>
              <div className="text-xs text-green-600">New Customers</div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}