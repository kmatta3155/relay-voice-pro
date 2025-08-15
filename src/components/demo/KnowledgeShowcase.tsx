import React, { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Brain, Zap, Clock, Phone, MapPin, CheckCircle, Star, TrendingUp } from "lucide-react";
import { Progress } from "@/components/ui/progress";

export function KnowledgeShowcase() {
  const [demoProgress, setDemoProgress] = useState(0);
  const [currentStep, setCurrentStep] = useState(0);
  const [isRunning, setIsRunning] = useState(false);

  const demoSteps = [
    "Analyzing website structure...",
    "Extracting business information...",
    "Creating knowledge chunks...",
    "Generating AI embeddings...",
    "Building quick answers...",
    "Knowledge base ready!"
  ];

  const extractedInfo = {
    business_hours: [
      { day: "Monday-Friday", hours: "9:00 AM - 6:00 PM" },
      { day: "Saturday", hours: "10:00 AM - 4:00 PM" }
    ],
    phone: "(555) 123-4567",
    services: ["Hair Cuts", "Color Services", "Styling", "Treatments"],
    address: "123 Main St, Downtown",
    quick_answers: 4
  };

  const runDemo = () => {
    setIsRunning(true);
    setDemoProgress(0);
    setCurrentStep(0);

    const interval = setInterval(() => {
      setDemoProgress(prev => {
        const newProgress = prev + 2;
        const step = Math.floor(newProgress / 17);
        setCurrentStep(Math.min(step, demoSteps.length - 1));
        
        if (newProgress >= 100) {
          clearInterval(interval);
          setTimeout(() => {
            setIsRunning(false);
          }, 1000);
        }
        
        return Math.min(newProgress, 100);
      });
    }, 100);
  };

  return (
    <div className="bg-gradient-to-br from-primary/5 via-accent/5 to-secondary/5 rounded-3xl p-8">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 bg-primary/10 text-primary px-4 py-2 rounded-full text-sm font-medium mb-4">
          <Brain className="h-4 w-4" />
          AI Knowledge Management
        </div>
        <h2 className="text-3xl font-bold mb-4">Transform Websites into Intelligent Knowledge</h2>
        <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
          Our AI automatically extracts business information, creates searchable knowledge bases, 
          and enables instant answers to customer questions.
        </p>
      </div>

      <div className="grid lg:grid-cols-2 gap-8 items-start">
        {/* Demo Control */}
        <div className="space-y-6">
          <Card className="border-2 border-primary/20">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Zap className="h-5 w-5 text-primary" />
                Live Demo: Website Analysis
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="bg-gray-100 dark:bg-gray-800 p-3 rounded-lg font-mono text-sm">
                https://elitehairstudio.com
              </div>
              
              <Button 
                onClick={runDemo} 
                disabled={isRunning}
                className="w-full bg-gradient-to-r from-primary to-accent hover:opacity-90"
                size="lg"
              >
                {isRunning ? "AI Processing..." : "Analyze Website with AI"}
              </Button>

              {isRunning && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm">
                    <Zap className="h-4 w-4 text-primary animate-pulse" />
                    {demoSteps[currentStep]}
                  </div>
                  <Progress value={demoProgress} className="h-2" />
                </div>
              )}
            </CardContent>
          </Card>

          {/* Results Stats */}
          {demoProgress > 80 && (
            <div className="grid grid-cols-2 gap-4 animate-fade-in">
              <Card className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-950/20 dark:to-emerald-950/20">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-green-600">15</div>
                  <div className="text-sm text-muted-foreground">Knowledge Chunks</div>
                </CardContent>
              </Card>
              <Card className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-950/20 dark:to-indigo-950/20">
                <CardContent className="p-4 text-center">
                  <div className="text-2xl font-bold text-blue-600">4</div>
                  <div className="text-sm text-muted-foreground">Quick Answers</div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Extracted Information */}
        <div className="space-y-4">
          <h3 className="text-xl font-semibold mb-4 flex items-center gap-2">
            <CheckCircle className="h-5 w-5 text-green-500" />
            Extracted Business Intelligence
          </h3>

          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Clock className="h-5 w-5 text-primary" />
                <div>
                  <div className="font-medium">Business Hours</div>
                  <div className="text-sm text-muted-foreground">
                    Monday-Friday: 9:00 AM - 6:00 PM
                  </div>
                </div>
                <Badge variant="secondary" className="ml-auto">Auto-detected</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <Phone className="h-5 w-5 text-primary" />
                <div>
                  <div className="font-medium">Contact Information</div>
                  <div className="text-sm text-muted-foreground">
                    {extractedInfo.phone}
                  </div>
                </div>
                <Badge variant="secondary" className="ml-auto">Auto-detected</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <MapPin className="h-5 w-5 text-primary" />
                <div>
                  <div className="font-medium">Location</div>
                  <div className="text-sm text-muted-foreground">
                    {extractedInfo.address}
                  </div>
                </div>
                <Badge variant="secondary" className="ml-auto">Auto-detected</Badge>
              </div>
            </CardContent>
          </Card>

          <Card className="hover:shadow-md transition-shadow">
            <CardContent className="p-4">
              <div>
                <div className="font-medium mb-2 flex items-center gap-2">
                  <Star className="h-4 w-4 text-primary" />
                  Services Offered
                </div>
                <div className="flex flex-wrap gap-2">
                  {extractedInfo.services.map((service, i) => (
                    <Badge key={i} variant="outline">{service}</Badge>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-gradient-to-r from-primary/10 to-accent/10 border-primary/20">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <TrendingUp className="h-5 w-5 text-primary" />
                <div className="flex-1">
                  <div className="font-medium">Instant Customer Answers</div>
                  <div className="text-sm text-muted-foreground">
                    AI can now answer questions about hours, services, contact info automatically
                  </div>
                </div>
                <Badge variant="default">Ready</Badge>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="mt-8 text-center">
        <div className="text-sm text-muted-foreground">
          Transform any business website into an intelligent knowledge base in seconds
        </div>
      </div>
    </div>
  );
}