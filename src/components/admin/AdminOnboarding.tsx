
import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { AlertCircle, CheckCircle2, Globe, Clock, DollarSign, Settings } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface ExtractionResult {
  services: Array<{
    name: string;
    description?: string;
    price?: string;
    duration_minutes?: number;
  }>;
  hours: Array<{
    day: string;
    open_time?: string;
    close_time?: string;
    is_closed: boolean;
  }>;
  pages_fetched: number;
  used_firecrawl: boolean;
  extraction_method: string;
}

interface CrawlOptions {
  maxPages: number;
  maxDepth: number;
  includePatterns: string[];
  excludePatterns: string[];
}

const AdminOnboarding = () => {
  const [step, setStep] = useState(1);
  const [isLoading, setIsLoading] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState('https://tinavorasalon.com');
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>({
    maxPages: 5,
    maxDepth: 2,
    includePatterns: [],
    excludePatterns: ['*/blog/*', '*/news/*', '*/privacy*', '*/terms*']
  });
  const [showAdvanced, setShowAdvanced] = useState(false);
  const { toast } = useToast();

  const analyzeWebsite = async (deepCrawl = false) => {
    if (!websiteUrl) {
      toast({
        title: "Error",
        description: "Please enter a website URL",
        variant: "destructive",
      });
      return;
    }

    setIsLoading(true);
    setExtractionResult(null);

    const options = deepCrawl ? {
      ...crawlOptions,
      maxPages: crawlOptions.maxPages * 2,
      maxDepth: crawlOptions.maxDepth + 1
    } : crawlOptions;

    try {
      console.log('Starting AI analysis with options:', options);
      
      const { data, error } = await supabase.functions.invoke('crawl-ingest', {
        body: {
          url: websiteUrl,
          tenant_id: 'demo', // Using demo tenant for admin onboarding
          crawlOptions: options
        }
      });

      if (error) {
        console.error('Edge function error:', error);
        throw new Error(error.message || 'Failed to analyze website');
      }

      console.log('Analysis result:', data);
      setExtractionResult(data);
      
      if (data.services?.length > 0 || data.hours?.length > 0) {
        toast({
          title: "Analysis Complete",
          description: `Found ${data.services?.length || 0} services and ${data.hours?.length || 0} business hours entries`,
        });
        setStep(2);
      } else {
        toast({
          title: "Limited Results",
          description: "Try using the 'Deeper Crawl' option or check if the website has service information.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error('Website analysis failed:', error);
      toast({
        title: "Analysis Failed",
        description: error.message || 'Failed to analyze website',
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const validateSavedData = async () => {
    try {
      const [servicesResult, hoursResult] = await Promise.all([
        supabase.from('services').select('*').eq('tenant_id', 'demo'),
        supabase.from('business_hours').select('*').eq('tenant_id', 'demo').order('dow')
      ]);

      if (servicesResult.error || hoursResult.error) {
        throw new Error('Failed to fetch saved data');
      }

      toast({
        title: "Data Validation",
        description: `Found ${servicesResult.data?.length || 0} saved services and ${hoursResult.data?.length || 0} saved hours in database`,
      });

      console.log('Saved services:', servicesResult.data);
      console.log('Saved hours:', hoursResult.data);
    } catch (error) {
      console.error('Validation failed:', error);
      toast({
        title: "Validation Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  };

  const saveConfiguration = async () => {
    setIsLoading(true);
    try {
      // Configuration is already saved by the crawl-ingest function
      toast({
        title: "Configuration Saved",
        description: "Business information has been extracted and saved successfully!",
      });
      setStep(3);
    } catch (error) {
      console.error('Save failed:', error);
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const formatDuration = (minutes?: number) => {
    if (!minutes) return 'Not specified';
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    if (hours > 0) {
      return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`;
    }
    return `${mins}m`;
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">Customer Onboarding</h1>
        <p className="text-muted-foreground">
          Automatically extract business information from customer websites
        </p>
      </div>

      <div className="mb-6">
        <Progress value={(step / 3) * 100} className="w-full" />
        <div className="flex justify-between mt-2 text-sm text-muted-foreground">
          <span className={step >= 1 ? "font-medium" : ""}>AI Analysis</span>
          <span className={step >= 2 ? "font-medium" : ""}>Review & Edit</span>
          <span className={step >= 3 ? "font-medium" : ""}>Save Configuration</span>
        </div>
      </div>

      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Website Analysis
            </CardTitle>
            <CardDescription>
              Enter the customer's website URL to automatically extract business information
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="websiteUrl">Website URL</Label>
              <Input
                id="websiteUrl"
                placeholder="https://example.com"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
              />
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowAdvanced(!showAdvanced)}
              >
                <Settings className="h-4 w-4 mr-2" />
                Advanced Options
              </Button>
            </div>

            {showAdvanced && (
              <Card className="p-4 bg-muted/50">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <Label htmlFor="maxPages">Max Pages</Label>
                    <Input
                      id="maxPages"
                      type="number"
                      min="1"
                      max="20"
                      value={crawlOptions.maxPages}
                      onChange={(e) => setCrawlOptions(prev => ({
                        ...prev,
                        maxPages: parseInt(e.target.value) || 5
                      }))}
                    />
                  </div>
                  <div>
                    <Label htmlFor="maxDepth">Max Depth</Label>
                    <Input
                      id="maxDepth"
                      type="number"
                      min="1"
                      max="5"
                      value={crawlOptions.maxDepth}
                      onChange={(e) => setCrawlOptions(prev => ({
                        ...prev,
                        maxDepth: parseInt(e.target.value) || 2
                      }))}
                    />
                  </div>
                </div>
              </Card>
            )}

            <div className="flex gap-3">
              <Button 
                onClick={() => analyzeWebsite(false)}
                disabled={isLoading}
                className="flex-1"
              >
                {isLoading ? "Analyzing..." : "Start AI Analysis"}
              </Button>
              <Button 
                variant="outline"
                onClick={() => analyzeWebsite(true)}
                disabled={isLoading}
              >
                Deeper Crawl
              </Button>
            </div>

            {extractionResult && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle className="text-lg">Analysis Results</CardTitle>
                  <div className="flex gap-2 flex-wrap">
                    <Badge variant={extractionResult.used_firecrawl ? "default" : "secondary"}>
                      {extractionResult.used_firecrawl ? "Firecrawl" : "Heuristic"} crawling
                    </Badge>
                    <Badge variant="outline">
                      {extractionResult.pages_fetched} pages fetched
                    </Badge>
                    <Badge variant="outline">
                      Method: {extractionResult.extraction_method}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="text-center p-4 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold">{extractionResult.services?.length || 0}</div>
                      <div className="text-sm text-muted-foreground">Services Found</div>
                    </div>
                    <div className="text-center p-4 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold">{extractionResult.hours?.length || 0}</div>
                      <div className="text-sm text-muted-foreground">Hours Entries</div>
                    </div>
                  </div>
                  
                  <Button 
                    variant="outline" 
                    size="sm" 
                    onClick={validateSavedData}
                    className="w-full"
                  >
                    Validate Saved Data
                  </Button>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      )}

      {step === 2 && extractionResult && (
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                Extracted Information
              </CardTitle>
              <CardDescription>
                Review and edit the automatically extracted business information
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Services Section */}
              <div>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Services ({extractionResult.services?.length || 0})
                </h3>
                {extractionResult.services?.length > 0 ? (
                  <div className="space-y-3">
                    {extractionResult.services.map((service, index) => (
                      <Card key={index} className="p-4">
                        <div className="flex justify-between items-start">
                          <div className="flex-1">
                            <h4 className="font-medium">{service.name}</h4>
                            {service.description && (
                              <p className="text-sm text-muted-foreground mt-1">
                                {service.description}
                              </p>
                            )}
                            <div className="flex gap-3 mt-2">
                              {service.price && (
                                <Badge variant="secondary">{service.price}</Badge>
                              )}
                              {service.duration_minutes && (
                                <Badge variant="outline">
                                  <Clock className="h-3 w-3 mr-1" />
                                  {formatDuration(service.duration_minutes)}
                                </Badge>
                              )}
                            </div>
                          </div>
                        </div>
                      </Card>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                    No services were automatically extracted
                  </div>
                )}
              </div>

              <Separator />

              {/* Business Hours Section */}
              <div>
                <h3 className="text-lg font-semibold mb-3 flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Business Hours ({extractionResult.hours?.length || 0})
                </h3>
                {extractionResult.hours?.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {extractionResult.hours.map((hour, index) => (
                      <div key={index} className="flex justify-between items-center p-3 bg-muted/50 rounded-lg">
                        <span className="font-medium">{hour.day}</span>
                        <span className="text-muted-foreground">
                          {hour.is_closed 
                            ? "Closed" 
                            : `${hour.open_time || 'N/A'} - ${hour.close_time || 'N/A'}`
                          }
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <AlertCircle className="h-8 w-8 mx-auto mb-2" />
                    No business hours were automatically extracted
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <Button onClick={() => setStep(1)} variant="outline">
                  Back to Analysis
                </Button>
                <Button 
                  onClick={saveConfiguration}
                  disabled={isLoading}
                  className="flex-1"
                >
                  {isLoading ? "Saving..." : "Save Configuration"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-green-600" />
              Configuration Complete
            </CardTitle>
            <CardDescription>
              Business information has been successfully extracted and saved
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-center py-8">
              <CheckCircle2 className="h-12 w-12 text-green-600 mx-auto mb-4" />
              <h3 className="text-lg font-semibold mb-2">Onboarding Complete!</h3>
              <p className="text-muted-foreground">
                The customer's business information has been automatically extracted and configured.
              </p>
            </div>
            
            <div className="flex gap-3">
              <Button 
                onClick={() => {
                  setStep(1);
                  setExtractionResult(null);
                  setWebsiteUrl('');
                }}
                variant="outline"
                className="flex-1"
              >
                Process Another Website
              </Button>
              <Button onClick={validateSavedData} variant="outline">
                Validate Data
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default AdminOnboarding;
