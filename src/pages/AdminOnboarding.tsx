import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/components/ui/use-toast";
import { Textarea } from "@/components/ui/textarea";
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
  Loader2,
  Upload,
  FileText
} from "lucide-react";
import { getDocument, GlobalWorkerOptions, version as pdfjsVersion } from "pdfjs-dist";

// Configure PDF.js worker from CDN for reliable client-side parsing
GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsVersion}/pdf.worker.min.js`;

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
  addresses?: string[];
  website?: string;
  description?: string;
  services: Service[];
  businessHours: BusinessHour[];
}

export default function AdminOnboarding() {
  const [tenantId, setTenantId] = useState<string>("");
  const [businessUrl, setBusinessUrl] = useState("");
  const [manualText, setManualText] = useState("");
  const [extractionMode, setExtractionMode] = useState<"website" | "manual">("website");
  const [isExtracting, setIsExtracting] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState("");
  const [businessInfo, setBusinessInfo] = useState<BusinessInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploadedFile, setUploadedFile] = useState<File | null>(null);
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

  async function handleFileUpload(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    setUploadedFile(file);
    setExtractionProgress("Reading file...");

    try {
      let text = "";
      
      if (file.type === "text/plain") {
        text = await file.text();
      } else if (file.type === "application/pdf") {
        try {
          setExtractionProgress("Parsing PDF pages...");
          const arrayBuffer = await file.arrayBuffer();
          const loadingTask = getDocument({ data: arrayBuffer });
          const pdf = await loadingTask.promise;

          let allText = "";
          for (let i = 1; i <= pdf.numPages; i++) {
            setExtractionProgress(`Extracting text from page ${i}/${pdf.numPages}...`);
            const page = await pdf.getPage(i);
            const textContent: any = await page.getTextContent();
            const pageText = (textContent.items || [])
              .map((item: any) => (typeof item.str === "string" ? item.str : ""))
              .join(" ");
            allText += pageText + "\n";
          }

          text = allText.trim();
        } catch (e) {
          console.warn("Client-side PDF parse failed, falling back to edge function:", e);
          const formData = new FormData();
          formData.append('file', file);
          const { data, error } = await supabase.functions.invoke('pdf-extract', {
            body: formData
          });
          if (error) {
            throw new Error(error.message || 'Failed to extract text from PDF');
          }
          text = data.text;
          if (data.message) {
            toast({
              title: "PDF Processed",
              description: data.message,
              variant: "default",
            });
          }
        }
      } else {
        // For DOC/DOCX files, we'd need additional handling
        throw new Error('Document format not yet supported. Please use PDF or TXT files, or copy/paste the text manually.');
      }

      setManualText(text);
      toast({
        title: "File Processed",
        description: `Successfully extracted text from ${file.name}`,
      });
    } catch (error: any) {
      console.error("File processing error:", error);
      toast({
        title: "File Processing Failed",
        description: error.message,
        variant: "destructive",
      });
    }
  }

  async function startExtraction() {
    if (!tenantId) {
      toast({
        title: "Missing Information",
        description: "Tenant ID not found",
        variant: "destructive",
      });
      return;
    }

    if (extractionMode === "website" && !businessUrl) {
      toast({
        title: "Missing Information", 
        description: "Please enter your business website URL",
        variant: "destructive",
      });
      return;
    }

    if (extractionMode === "manual" && !manualText.trim()) {
      toast({
        title: "Missing Information",
        description: "Please enter your business information text",
        variant: "destructive",
      });
      return;
    }

    setIsExtracting(true);
    setError(null);
    setBusinessInfo(null);
    
    try {
      if (extractionMode === "website") {
        setExtractionProgress("Analyzing website structure...");
        
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
              allowPatterns: ["services", "pricing", "packages", "menu", "treatment", "book", "appointment", "schedule", "about", "hours", "contact"],
              denyPatterns: ["\\.(pdf|jpg|jpeg|png|gif|webp|svg|mp4|mp3)$", "wp-admin", "login", "register"],
              includeBookingProviders: true,
            }
          }
        });

        if (error) {
          throw new Error(error.message || 'Extraction failed');
        }

        if (data?.services || data?.hours || data?.business_info) {
          // Transform the response to match our expected format
          const businessInfo = {
            name: data.business_info?.name,
            phone: data.business_info?.phone,
            email: data.business_info?.email,
            addresses: data.business_info?.addresses,
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
            description: `Found ${data.services?.length || 0} services, ${data.hours?.length || 0} business hours, and ${data.business_info?.addresses?.length || 0} addresses. Pages fetched: ${data.pages_fetched || 0}`,
          });
        } else {
          throw new Error('No data extracted from website');
        }
      } else {
        setExtractionProgress("Processing manual text...");
        
        const { data, error } = await supabase.functions.invoke('text-extract', {
          body: {
            tenantId,
            text: manualText
          }
        });

        if (error) {
          throw new Error(error.message || 'Text extraction failed');
        }

        if (data?.services || data?.hours || data?.business_info) {
          const businessInfo = {
            name: data.business_info?.name,
            phone: data.business_info?.phone,
            email: data.business_info?.email,
            addresses: data.business_info?.addresses,
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
          setExtractionProgress("Text processing completed!");
          
          toast({
            title: "Processing Complete!",
            description: `Found ${data.services?.length || 0} services and ${data.hours?.length || 0} business hours from your text.`,
          });
        } else {
          throw new Error('No data extracted from text');
        }
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
            Business Information Extraction
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Mode Selection */}
          <div className="space-y-3">
            <Label>Extraction Method</Label>
            <div className="flex gap-4">
              <Button
                variant={extractionMode === "website" ? "default" : "outline"}
                onClick={() => setExtractionMode("website")}
                disabled={isExtracting}
                className="flex-1"
              >
                <Globe className="h-4 w-4 mr-2" />
                Website Analysis
              </Button>
              <Button
                variant={extractionMode === "manual" ? "default" : "outline"}
                onClick={() => setExtractionMode("manual")}
                disabled={isExtracting}
                className="flex-1"
              >
                <FileText className="h-4 w-4 mr-2" />
                Manual Text/PDF
              </Button>
            </div>
          </div>

          {extractionMode === "website" ? (
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
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="file-upload">Upload Document</Label>
                <Input
                  id="file-upload"
                  type="file"
                  accept=".pdf,.txt,.doc,.docx"
                  onChange={handleFileUpload}
                  disabled={isExtracting}
                  className="file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-primary file:text-primary-foreground hover:file:bg-primary/90"
                />
                <p className="text-xs text-muted-foreground">
                  Upload PDF, TXT, DOC, or DOCX files containing your business information.
                </p>
              </div>
              
              <div className="flex items-center gap-4">
                <div className="flex-1 border-t"></div>
                <span className="text-sm text-muted-foreground">OR</span>
                <div className="flex-1 border-t"></div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="manual-text">Manual Text Entry</Label>
                <Textarea
                  id="manual-text"
                  placeholder="Paste your business information here - services, pricing, hours, contact details, etc. You can copy text from PDFs, brochures, or any document containing your business details."
                  value={manualText}
                  onChange={(e) => setManualText(e.target.value)}
                  disabled={isExtracting}
                  rows={8}
                  className="resize-none"
                />
                <p className="text-xs text-muted-foreground">
                  Tip: Include service names, prices, durations, business hours, addresses, and contact information for best results.
                </p>
              </div>
            </div>
          )}

          <Button 
            onClick={startExtraction} 
            disabled={isExtracting || (extractionMode === "website" && !businessUrl.trim()) || (extractionMode === "manual" && !manualText.trim())}
            className="w-full"
            size="lg"
          >
            {isExtracting ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                {extractionMode === "website" ? "Analyzing..." : "Processing..."}
              </>
            ) : (
              <>
                {extractionMode === "website" ? (
                  <>
                    <Globe className="h-4 w-4 mr-2" />
                    Start AI Website Analysis
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Process Business Information
                  </>
                )}
              </>
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
                
                {businessInfo.addresses && businessInfo.addresses.length > 0 && (
                  <div className="space-y-1">
                    <Label className="text-sm font-medium flex items-center gap-1">
                      <MapPin className="h-3 w-3" />
                      {businessInfo.addresses.length > 1 ? 'Addresses' : 'Address'}
                    </Label>
                    <div className="space-y-1">
                      {businessInfo.addresses.map((address, idx) => (
                        <p key={idx} className="text-sm">{address}</p>
                      ))}
                    </div>
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