import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";
import { 
  Clock, 
  DollarSign, 
  Globe, 
  Phone, 
  Mail, 
  MapPin, 
  Briefcase,
  AlertCircle,
  CheckCircle,
  Loader2
} from "lucide-react";

interface Service {
  name: string;
  price?: number | string;
  duration_minutes?: number;
  category?: string;
}

interface BusinessHour {
  day: string;
  opens: string;
  closes: string;
  isClosed?: boolean;
}

interface BusinessInfo {
  name?: string;
  phone?: string;
  email?: string;
  address?: string;
  website?: string;
  description?: string;
  services: Service[];
  businessHours: BusinessHour[];
}

export default function AdminOnboarding() {
  const [tenantId, setTenantId] = useState<string>("");
  const [businessUrl, setBusinessUrl] = useState("");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState("");
  const [businessInfo, setBusinessInfo] = useState<BusinessInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    async function loadTenant() {
      try {
        const user = (await supabase.auth.getUser()).data.user;
        if (!user) return;

        const { data } = await supabase.from("profiles").select("active_tenant_id").eq("id", user.id).maybeSingle();
        if (data?.active_tenant_id) {
          setTenantId(data.active_tenant_id);
        }
      } catch (error) {
        console.error("Error loading tenant:", error);
      }
    }
    loadTenant();
  }, []);

  async function startExtraction() {
    if (!tenantId || !businessUrl) {
      toast({
        title: "Missing Information",
        description: "Please enter your business website URL",
        variant: "destructive",
      });
      return;
    }

    setIsExtracting(true);
    setError(null);
    setBusinessInfo(null);
    setExtractionProgress("Analyzing website structure...");

    try {
      const { data, error } = await supabase.functions.invoke('crawl-ingest', {
        body: {
          tenantId,
          url: businessUrl,
          options: {
            includeSubdomains: true,
            respectRobots: true,
            followSitemaps: true,
            maxPages: 25,
            maxDepth: 3,
            rateLimitMs: 300,
            allowPatterns: ["services", "pricing", "packages", "menu", "treatment", "book", "appointment", "schedule", "about", "hours"],
            denyPatterns: ["\\.(pdf|jpg|jpeg|png|gif|webp|svg|mp4|mp3)$", "wp-admin", "login", "register"],
            includeBookingProviders: true,
          }
        }
      });

      if (error) {
        throw new Error(error.message || 'Extraction failed');
      }

      if (data?.services || data?.hours) {
        // Transform the response to match our expected format
        const businessInfo = {
          services: data.services?.map((service: any) => ({
            name: service.name,
            price: service.price,
            duration_minutes: service.duration_minutes,
            category: service.category
          })) || [],
          businessHours: data.hours?.map((hour: any) => ({
            day: hour.day,
            opens: hour.open_time,
            closes: hour.close_time,
            isClosed: hour.is_closed
          })) || []
        };
        
        setBusinessInfo(businessInfo);
        setExtractionProgress("Extraction completed successfully!");
        
        toast({
          title: "Extraction Complete!",
          description: `Found ${data.services?.length || 0} services and ${data.hours?.length || 0} business hours. Pages fetched: ${data.pages_fetched || 0}`,
        });
      } else {
        throw new Error('No data extracted from website');
      }

    } catch (error: any) {
      console.error("Extraction error:", error);
      setError(error.message);
      toast({
        title: "Extraction Failed",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsExtracting(false);
    }
  }

  async function saveConfiguration() {
    if (!businessInfo || !tenantId) return;

    try {
      // Update tenant info if we have business name
      if (businessInfo.name) {
        await supabase.from('tenants').update({
          name: businessInfo.name
        }).eq('id', tenantId);
      }

      // Save agent settings
      await supabase.from('agent_settings').upsert({
        tenant_id: tenantId,
        website_url: businessInfo.website || businessUrl,
        greeting: businessInfo.description || `Welcome to ${businessInfo.name || 'our business'}! How can I help you today?`,
      });

      toast({
        title: "Configuration Saved",
        description: "Your business information has been successfully configured.",
      });

    } catch (error: any) {
      console.error("Save error:", error);
      toast({
        title: "Save Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  }

  const formatPrice = (price: number | string | undefined) => {
    if (!price) return "Call for pricing";
    const numPrice = typeof price === 'string' ? parseFloat(price.replace(/[^\d.]/g, '')) : price;
    return isNaN(numPrice) ? "Call for pricing" : `$${numPrice}`;
  };

  const formatDuration = (duration?: number) => {
    if (!duration) return "30 min";
    return `${duration} min`;
  };

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">Business Intelligence Extraction</h1>
        <p className="text-muted-foreground">
          Let our AI analyze your website to automatically configure your receptionist
        </p>
      </div>

      {/* Extraction Form */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5" />
            Website Analysis
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="website">Business Website URL</Label>
            <Input
              id="website"
              type="url"
              placeholder="https://www.yourbusiness.com"
              value={businessUrl}
              onChange={(e) => setBusinessUrl(e.target.value)}
              disabled={isExtracting}
            />
          </div>

          <Button 
            onClick={startExtraction} 
            disabled={isExtracting || !businessUrl.trim()}
            className="w-full"
            size="lg"
          >
            {isExtracting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Analyzing...
              </>
            ) : (
              "Start AI Analysis"
            )}
          </Button>

          {isExtracting && (
            <div className="bg-muted p-4 rounded-lg">
              <div className="flex items-center gap-2 text-sm">
                <Loader2 className="h-4 w-4 animate-spin" />
                {extractionProgress}
              </div>
            </div>
          )}

          {error && (
            <div className="bg-destructive/10 border border-destructive/20 p-4 rounded-lg">
              <div className="flex items-center gap-2 text-destructive">
                <AlertCircle className="h-4 w-4" />
                <span className="font-medium">Extraction Failed</span>
              </div>
              <p className="text-sm text-destructive/80 mt-1">{error}</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Extracted Business Information */}
      {businessInfo && (
        <div className="space-y-6">
          <div className="flex items-center gap-2 text-green-600">
            <CheckCircle className="h-5 w-5" />
            <span className="font-medium">Analysis Complete</span>
          </div>

          {/* Business Overview */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Briefcase className="h-5 w-5" />
                Business Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid md:grid-cols-2 gap-4">
                {businessInfo.name && (
                  <div className="space-y-1">
                    <Label className="text-sm font-medium">Business Name</Label>
                    <p className="text-sm">{businessInfo.name}</p>
                  </div>
                )}
                
                {businessInfo.phone && (
                  <div className="space-y-1">
                    <Label className="text-sm font-medium flex items-center gap-1">
                      <Phone className="h-3 w-3" />
                      Phone
                    </Label>
                    <p className="text-sm">{businessInfo.phone}</p>
                  </div>
                )}
                
                {businessInfo.email && (
                  <div className="space-y-1">
                    <Label className="text-sm font-medium flex items-center gap-1">
                      <Mail className="h-3 w-3" />
                      Email
                    </Label>
                    <p className="text-sm">{businessInfo.email}</p>
                  </div>
                )}
                
                {businessInfo.address && (
                  <div className="space-y-1">
                    <Label className="text-sm font-medium flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      Address
                    </Label>
                    <p className="text-sm">{businessInfo.address}</p>
                  </div>
                )}
              </div>
              
              {businessInfo.description && (
                <div className="space-y-1">
                  <Label className="text-sm font-medium">Description</Label>
                  <p className="text-sm text-muted-foreground">{businessInfo.description}</p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Services */}
          {businessInfo.services && businessInfo.services.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <DollarSign className="h-5 w-5" />
                  Services & Pricing ({businessInfo.services.length} found)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <div className="grid gap-3">
                    <div className="grid grid-cols-3 gap-4 text-sm font-medium text-muted-foreground border-b pb-2">
                      <span>Service Name</span>
                      <span>Duration</span>
                      <span>Price</span>
                    </div>
                    {businessInfo.services.map((service, index) => (
                      <div key={index} className="grid grid-cols-3 gap-4 text-sm py-2 border-b border-border/50">
                        <div className="space-y-1">
                          <span className="font-medium">{service.name}</span>
                          {service.category && (
                            <Badge variant="secondary" className="text-xs">
                              {service.category}
                            </Badge>
                          )}
                        </div>
                        <span className="text-muted-foreground">
                          {formatDuration(service.duration_minutes)}
                        </span>
                        <span className="font-medium">
                          {formatPrice(service.price)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Business Hours */}
          {businessInfo.businessHours && businessInfo.businessHours.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Clock className="h-5 w-5" />
                  Business Hours ({businessInfo.businessHours.length} days found)
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {businessInfo.businessHours.map((hour, index) => (
                    <div key={index} className="flex justify-between items-center py-2 border-b border-border/50 last:border-b-0">
                      <span className="font-medium capitalize">{hour.day}</span>
                      <span className="text-muted-foreground">
                        {hour.isClosed ? 'Closed' : `${hour.opens} - ${hour.closes}`}
                      </span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Save Configuration */}
          <Card>
            <CardHeader>
              <CardTitle>Save Configuration</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground mb-4">
                Save this extracted information to configure your AI receptionist. This will update your business settings, services, and operating hours.
              </p>
              <Button onClick={saveConfiguration} className="w-full">
                Save & Configure AI Receptionist
              </Button>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}