import React, { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Calculator, TrendingUp, DollarSign } from "lucide-react";

export default function ROICalculator() {
  const [missedCalls, setMissedCalls] = useState([15]);
  const [avgBookingValue, setAvgBookingValue] = useState([120]);
  const [conversionRate, setConversionRate] = useState([25]);
  const [staffCost, setStaffCost] = useState([3500]);

  const calculations = useMemo(() => {
    const monthly = {
      missedCalls: missedCalls[0],
      avgBooking: avgBookingValue[0],
      conversion: conversionRate[0] / 100,
      staffCost: staffCost[0]
    };

    const recoveredCalls = monthly.missedCalls * 0.8; // AI captures 80% of missed calls
    const newBookings = recoveredCalls * monthly.conversion;
    const newRevenue = newBookings * monthly.avgBooking;
    const aiCost = 299; // Monthly AI receptionist cost
    const totalSavings = monthly.staffCost - aiCost;
    const totalBenefit = newRevenue + totalSavings;
    const roi = ((totalBenefit - aiCost) / aiCost) * 100;

    return {
      recoveredCalls: Math.round(recoveredCalls),
      newBookings: Math.round(newBookings),
      newRevenue: Math.round(newRevenue),
      costSavings: totalSavings,
      totalBenefit: Math.round(totalBenefit),
      roi: Math.round(roi),
      aiCost,
      paybackPeriod: aiCost / (totalBenefit / 30) // Days to break even
    };
  }, [missedCalls, avgBookingValue, conversionRate, staffCost]);

  return (
    <Card className="w-full">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          Interactive ROI Calculator
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Input Controls */}
        <div className="grid md:grid-cols-2 gap-6">
          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Missed calls per month</label>
              <Slider
                value={missedCalls}
                onValueChange={setMissedCalls}
                max={100}
                min={5}
                step={5}
                className="mt-2"
              />
              <div className="text-xs text-muted-foreground mt-1">{missedCalls[0]} calls</div>
            </div>
            
            <div>
              <label className="text-sm font-medium">Average booking value</label>
              <Slider
                value={avgBookingValue}
                onValueChange={setAvgBookingValue}
                max={500}
                min={50}
                step={10}
                className="mt-2"
              />
              <div className="text-xs text-muted-foreground mt-1">${avgBookingValue[0]}</div>
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <label className="text-sm font-medium">Conversion rate (%)</label>
              <Slider
                value={conversionRate}
                onValueChange={setConversionRate}
                max={50}
                min={10}
                step={5}
                className="mt-2"
              />
              <div className="text-xs text-muted-foreground mt-1">{conversionRate[0]}%</div>
            </div>
            
            <div>
              <label className="text-sm font-medium">Current staff cost/month</label>
              <Slider
                value={staffCost}
                onValueChange={setStaffCost}
                max={8000}
                min={2000}
                step={250}
                className="mt-2"
              />
              <div className="text-xs text-muted-foreground mt-1">${staffCost[0]}</div>
            </div>
          </div>
        </div>

        {/* Results */}
        <div className="p-4 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg border border-green-200">
          <h4 className="font-semibold text-green-800 mb-4 flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Your Monthly Impact
          </h4>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-700">{calculations.recoveredCalls}</div>
              <div className="text-xs text-green-600">Calls Recovered</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-700">{calculations.newBookings}</div>
              <div className="text-xs text-green-600">New Bookings</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-700">${calculations.newRevenue.toLocaleString()}</div>
              <div className="text-xs text-green-600">New Revenue</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-green-700">${calculations.costSavings.toLocaleString()}</div>
              <div className="text-xs text-green-600">Cost Savings</div>
            </div>
          </div>

          <div className="border-t border-green-200 pt-4">
            <div className="flex justify-between items-center mb-2">
              <span className="text-green-700 font-medium">Total Monthly Benefit:</span>
              <span className="text-2xl font-bold text-green-800">${calculations.totalBenefit.toLocaleString()}</span>
            </div>
            <div className="flex justify-between items-center mb-2">
              <span className="text-green-700 font-medium">AI Receptionist Cost:</span>
              <span className="text-lg font-semibold text-green-700">$299/month</span>
            </div>
            <div className="flex justify-between items-center">
              <span className="text-green-800 font-bold">Monthly ROI:</span>
              <span className="text-3xl font-bold text-green-800">{calculations.roi}%</span>
            </div>
          </div>

          <div className="mt-4 pt-4 border-t border-green-200">
            <div className="text-center text-green-700">
              <div className="text-sm">Payback period: <span className="font-bold">{Math.round(calculations.paybackPeriod)} days</span></div>
            </div>
          </div>
        </div>

        {/* CTA */}
        <div className="flex gap-3">
          <Button className="flex-1">
            <DollarSign className="h-4 w-4 mr-2" />
            Start Free Trial
          </Button>
          <Button variant="outline" className="flex-1">
            Schedule Demo Call
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}