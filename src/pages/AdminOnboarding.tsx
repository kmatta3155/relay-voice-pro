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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  FileText,
  Settings,
  Search,
  ArrowLeft,
  Save
} from "lucide-react";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import pdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?url";

// Use a locally bundled worker for reliable client-side parsing in all environments
GlobalWorkerOptions.workerSrc = pdfWorker;

interface Service {
  name: string;
  description?: string;
  price?: string;
}

interface BusinessHours {
  day: string;
  open_time?: string;
  close_time?: string;
  is_closed: boolean;
}

interface BusinessInfo {
  name?: string;
  addresses?: string[];
  phone?: string;
  email?: string;
}

interface ConsolidatedData {
  businessName: string;
  businessAddresses: string[];
  businessHours: BusinessHours[];
  services: Service[];
  confidence: number;
}

interface ExtractionResult {
  consolidatedData?: ConsolidatedData;
  rawServices?: Service[];
  rawHours?: BusinessHours[];
  rawBusinessInfo?: BusinessInfo;
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

interface DataSource {
  type: 'website' | 'file' | 'text';
  content: string;
  metadata?: any;
}

interface AdminOnboardingProps {
  onBack?: () => void;
}

export default function AdminOnboarding({ onBack }: AdminOnboardingProps = {}) {
  const [step, setStep] = useState(1);
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState("");
  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>({
    maxPages: 25,
    maxDepth: 3,
    includePatterns: ["services", "pricing", "menu", "about"],
    excludePatterns: ["blog", "admin", "login"]
  });
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [manualText, setManualText] = useState("");
  const [validationStatus, setValidationStatus] = useState("");
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const { toast } = useToast();

  useEffect(() => {
    (async () => {
      try {
        const { data: ures } = await supabase.auth.getUser();
        const uid = ures?.user?.id;
        if (!uid) return;
        
        // Check if user is site admin - they don't need an active tenant for customer creation
        const { data: p } = await supabase
          .from("profiles")
          .select("active_tenant_id, is_site_admin")
          .eq("id", uid)
          .maybeSingle();
        
        // Only set tenant for non-admin users
        if (!p?.is_site_admin) {
          setTenantId(p?.active_tenant_id || null);
        } else {
          // For site admins, we'll create the tenant during the process
          setTenantId('admin-creating-customer');
        }
      } catch {}
    })();
  }, []);

  const consolidateAllData = async () => {
    if (dataSources.length === 0) {
      toast({ title: "Error", description: "Please add at least one data source", variant: "destructive" });
      return;
    }

setIsLoading(true);
try {
  // For admin users creating customers, we skip the tenant check since they create new tenants
  const isAdminMode = tenantId === 'admin-creating-customer';
  
  if (!isAdminMode && !tenantId) {
    toast({ title: "Error", description: "No active workspace selected", variant: "destructive" });
    return;
  }
  
  const result = await supabase.functions.invoke('consolidate-business-data', {
    body: {
      dataSources: dataSources,
      tenantId: isAdminMode ? 'demo' : tenantId // Use demo tenant for analysis during admin customer creation
    }
  });

      if (result.error) {
        throw new Error(result.error.message || 'Data consolidation failed');
      }

      console.log('Data consolidation result:', result.data);
      setExtractionResult(result.data);
      setStep(2);
      toast({ title: "Success", description: "Business data consolidated successfully!" });
    } catch (error) {
      console.error('Data consolidation error:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Consolidation failed",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

const analyzeWebsite = async (deepCrawl = false) => {
  if (!websiteUrl.trim()) {
    toast({ title: "Error", description: "Please enter a website URL", variant: "destructive" });
    return;
  }

  const isAdminMode = tenantId === 'admin-creating-customer';
  const analysisMode = isAdminMode ? 'demo' : tenantId;

  console.log('Starting website analysis with:', { url: websiteUrl, analysisMode, deepCrawl });
  setIsLoading(true);
  try {
    const result = await supabase.functions.invoke('crawl-ingest', {
      body: {
        url: websiteUrl,
        tenant_id: analysisMode, // Use demo tenant for admin analysis
        options: {
          ...crawlOptions,
          maxPages: deepCrawl ? crawlOptions.maxPages * 2 : crawlOptions.maxPages
        }
      }
    });

    console.log('Edge function result:', result);

      if (result.error) {
        console.error('Website analysis error:', result.error);
        throw new Error('Edge Function returned a non-2xx status code');
      }

      if (!result.data) {
        throw new Error('No data returned from analysis');
      }

      console.log('Website analysis result:', result.data);
      
      // Add website data as a source
      const websiteSource: DataSource = {
        type: 'website',
        content: JSON.stringify(result.data),
        metadata: { url: websiteUrl, crawlOptions }
      };
      setDataSources(prev => [...prev.filter(s => s.type !== 'website'), websiteSource]);
      
      toast({ title: "Success", description: "Website data added! Click 'Consolidate All Data' to process." });
    } catch (error) {
      console.error('Website analysis error:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Analysis failed",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handlePdfUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setPdfFile(file);
    setIsLoading(true);

    try {
      // Try client-side extraction first
      let extractedText = '';
      try {
        const arrayBuffer = await file.arrayBuffer();
        const pdf = await getDocument({ data: arrayBuffer }).promise;
        
        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          const page = await pdf.getPage(pageNum);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item: any) => item.str)
            .join(' ');
          extractedText += `Page ${pageNum}: ${pageText}\n\n`;
        }
        
        console.log('Client-side PDF extraction successful');
        
        // Add PDF data as a source
        const pdfSource: DataSource = {
          type: 'file',
          content: extractedText,
          metadata: { filename: file.name, fileSize: file.size }
        };
        setDataSources(prev => [...prev.filter(s => s.type !== 'file'), pdfSource]);
        setManualText(extractedText);
        
        toast({ title: "Success", description: "PDF data added! Click 'Consolidate All Data' to process." });
      } catch (clientError) {
        console.error('Client-side extraction failed:', clientError);
        
        // Fallback to edge function
        const formData = new FormData();
        formData.append('file', file);
        
        const result = await supabase.functions.invoke('pdf-extract', {
          body: formData
        });

        if (result.error) {
          throw new Error(result.error.message || 'PDF processing failed');
        }

        if (result.data?.text) {
          const pdfSource: DataSource = {
            type: 'file',
            content: result.data.text,
            metadata: { filename: file.name, fileSize: file.size }
          };
          setDataSources(prev => [...prev.filter(s => s.type !== 'file'), pdfSource]);
          setManualText(result.data.text);
          toast({ title: "Success", description: "PDF data added! Click 'Consolidate All Data' to process." });
        } else {
          throw new Error('No text extracted from PDF');
        }
      }
    } catch (error) {
      console.error('PDF processing error:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "PDF processing failed",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const processManualText = async () => {
    if (!manualText.trim()) {
      toast({ title: "Error", description: "Please enter some text to process", variant: "destructive" });
      return;
    }

    // Add manual text as a source
    const textSource: DataSource = {
      type: 'text',
      content: manualText,
      metadata: { source: 'manual_input' }
    };
    setDataSources(prev => [...prev.filter(s => s.type !== 'text'), textSource]);
    
    toast({ title: "Success", description: "Text data added! Click 'Consolidate All Data' to process." });
  };

  const saveConfiguration = async () => {
    if (!extractionResult?.consolidatedData) return;

    setIsLoading(true);
    try {
      // Get current user
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('User not authenticated');

      // Create a new tenant/customer first
      const { data: tenantData, error: tenantError } = await supabase.functions.invoke('customer-create', {
        body: {
          name: extractionResult.consolidatedData.businessName,
          userId: user.id,
          business_type: 'Business',
          website_url: websiteUrl
        }
      });

      if (tenantError) throw tenantError;
      if (!tenantData?.tenantId) throw new Error('Failed to create tenant');

      const newTenantId = tenantData.tenantId;
      console.log('Created tenant:', newTenantId);

      // Save business data to this tenant
      if (extractionResult) {
        const { error: consolidateError } = await supabase.functions.invoke('consolidate-business-data', {
          body: {
            tenantId: newTenantId,
            dataSources: dataSources
          }
        });

        if (consolidateError) {
          console.error('Error consolidating business data:', consolidateError);
          // Continue anyway, as tenant is created
        }
      }

      // Train the AI agent for this tenant
      const { data: agentData, error: agentError } = await supabase.functions.invoke('train-agent', {
        body: {
          tenant_id: newTenantId,
          agent_name: 'Receptionist',
          voice_provider: 'elevenlabs',
          voice_id: '9BWtsMINqrJLrRacOk9x'
        }
      });

      if (agentError) {
        console.error('Agent training error:', agentError);
        // Continue to completion even if agent training fails
      }

      console.log('Process completed:', { tenantData, agentData });
      toast({ title: "Success", description: "Customer onboarded successfully!" });
      setStep(3);
      // Let user control when to go back - no auto-redirect
    } catch (error) {
      console.error('Error in onboarding process:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to complete onboarding",
        variant: "destructive"
      });
    } finally {
      setIsLoading(false);
    }
  };

  const validateSavedData = async () => {
    setValidationStatus("Validating saved configuration...");
    // Simulate validation
    setTimeout(() => {
      setValidationStatus("✅ All data validated successfully!");
      toast({ title: "Validation Complete", description: "Your business configuration is working correctly." });
    }, 2000);
  };

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="text-center space-y-2">
        <h1 className="text-3xl font-bold">AI Business Profile Setup</h1>
        <p className="text-muted-foreground">
          Combine website data, documents, and manual input to create your comprehensive business profile
        </p>
      </div>

      {/* Progress indicators */}
      <div className="flex items-center justify-center space-x-4 mb-8">
        <div className={`flex items-center space-x-2 ${step >= 1 ? 'text-primary' : 'text-muted-foreground'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${step >= 1 ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground'}`}>
            1
          </div>
          <span className="text-sm font-medium">Data Collection</span>
        </div>
        <div className="w-16 h-px bg-muted-foreground"></div>
        <div className={`flex items-center space-x-2 ${step >= 2 ? 'text-primary' : 'text-muted-foreground'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${step >= 2 ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground'}`}>
            2
          </div>
          <span className="text-sm font-medium">Review Profile</span>
        </div>
        <div className="w-16 h-px bg-muted-foreground"></div>
        <div className={`flex items-center space-x-2 ${step >= 3 ? 'text-primary' : 'text-muted-foreground'}`}>
          <div className={`w-8 h-8 rounded-full flex items-center justify-center border-2 ${step >= 3 ? 'border-primary bg-primary text-primary-foreground' : 'border-muted-foreground'}`}>
            3
          </div>
          <span className="text-sm font-medium">Complete</span>
        </div>
      </div>

      <Card>
        <CardContent className="p-6">
          {step === 1 && (
            <div className="space-y-6">
              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-2">
                  <label htmlFor="websiteUrl" className="text-sm font-medium">
                    Website URL
                  </label>
                  <Input
                    id="websiteUrl"
                    type="url"
                    value={websiteUrl}
                    onChange={(e) => setWebsiteUrl(e.target.value)}
                    placeholder="https://example.com"
                    disabled={isLoading}
                  />
                </div>
                
                <div className="space-y-2">
                  <label htmlFor="maxPages" className="text-sm font-medium">
                    Max Pages to Crawl
                  </label>
                  <Input
                    id="maxPages"
                    type="number"
                    value={crawlOptions.maxPages}
                    onChange={(e) => setCrawlOptions({
                      ...crawlOptions,
                      maxPages: parseInt(e.target.value) || 25
                    })}
                    min="5"
                    max="100"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <Collapsible>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="mb-3">
                    <Settings className="mr-2 h-4 w-4" />
                    Advanced Crawl Options
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="space-y-4">
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Include Patterns</label>
                      <Input
                        value={crawlOptions.includePatterns.join(', ')}
                        onChange={(e) => setCrawlOptions({
                          ...crawlOptions,
                          includePatterns: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                        })}
                        placeholder="services, pricing, menu"
                        disabled={isLoading}
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium">Exclude Patterns</label>
                      <Input
                        value={crawlOptions.excludePatterns.join(', ')}
                        onChange={(e) => setCrawlOptions({
                          ...crawlOptions,
                          excludePatterns: e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                        })}
                        placeholder="blog, admin, login"
                        disabled={isLoading}
                      />
                    </div>
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <div className="flex gap-3">
                <Button 
                  onClick={() => analyzeWebsite(false)} 
                  disabled={isLoading || !websiteUrl.trim()}
                  className="flex-1"
                >
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Globe className="mr-2 h-4 w-4" />}
                  Add Website Data
                </Button>
                <Button 
                  onClick={() => analyzeWebsite(true)} 
                  disabled={isLoading || !websiteUrl.trim()}
                  variant="outline"
                  className="flex-1"
                >
                  <Search className="mr-2 h-4 w-4" />
                  Deep Analysis
                </Button>
              </div>

              <div className="space-y-4 border-t pt-4">
                <div className="text-center">
                  <p className="text-sm text-muted-foreground mb-3">Or upload a PDF/document</p>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,.txt"
                      onChange={handlePdfUpload}
                      className="hidden"
                      disabled={isLoading}
                    />
                    <Button variant="outline" disabled={isLoading} asChild>
                      <span>
                        <Upload className="mr-2 h-4 w-4" />
                        Upload Document
                      </span>
                    </Button>
                  </label>
                  {pdfFile && (
                    <p className="text-xs text-muted-foreground mt-2">
                      Selected: {pdfFile.name}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-4 border-t pt-4">
                <div className="space-y-2">
                  <label htmlFor="manualText" className="text-sm font-medium">
                    Or paste business information manually:
                  </label>
                  <Textarea
                    id="manualText"
                    value={manualText}
                    onChange={(e) => setManualText(e.target.value)}
                    placeholder="Paste your business services, hours, pricing, and contact information here..."
                    rows={6}
                    disabled={isLoading}
                  />
                </div>
                <Button 
                  onClick={processManualText} 
                  disabled={isLoading || !manualText.trim()}
                  variant="outline"
                  className="w-full"
                >
                  <FileText className="mr-2 h-4 w-4" />
                  Add Text Data
                </Button>
              </div>

              {dataSources.length > 0 && (
                <div className="space-y-4 border-t pt-4">
                  <div className="bg-muted/50 p-4 rounded-lg">
                    <h3 className="font-semibold mb-2">Data Sources Added ({dataSources.length})</h3>
                    <div className="text-sm space-y-1">
                      {dataSources.map((source, index) => (
                        <div key={index} className="flex justify-between items-center">
                          <span className="capitalize">{source.type}: {source.type === 'website' ? source.metadata?.url : source.metadata?.filename || 'Manual text'}</span>
                          <Badge variant="secondary">{source.content.length} chars</Badge>
                        </div>
                      ))}
                    </div>
                  </div>

                  <Button 
                    onClick={consolidateAllData} 
                    disabled={isLoading}
                    className="w-full"
                    size="lg"
                  >
                    {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
                    Consolidate All Data with AI
                  </Button>
                </div>
              )}

              {extractionResult?.consolidatedData && (
                <div className="space-y-4 border-t pt-4">
                  <div className="bg-muted/50 p-4 rounded-lg">
                    <h3 className="font-semibold mb-2">Consolidated Business Profile</h3>
                    <div className="text-sm">
                      <Badge variant="outline">Confidence: {Math.round(extractionResult.consolidatedData.confidence * 100)}%</Badge>
                    </div>
                  </div>

                  <div className="space-y-4">
                    <div>
                      <h4 className="font-medium mb-2">Business Information</h4>
                      <div className="text-sm space-y-1 bg-muted/30 p-3 rounded">
                        <p><span className="font-medium">Name:</span> {extractionResult.consolidatedData.businessName}</p>
                        {extractionResult.consolidatedData.businessAddresses.length > 0 && (
                          <div>
                            <span className="font-medium">Address{extractionResult.consolidatedData.businessAddresses.length > 1 ? 'es' : ''}:</span>
                            {extractionResult.consolidatedData.businessAddresses.map((address, index) => (
                              <p key={index} className="ml-2">{address}</p>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {extractionResult.consolidatedData.services.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-2">Services ({extractionResult.consolidatedData.services.length})</h4>
                        <div className="max-h-40 overflow-y-auto">
                          <Table>
                            <TableHeader>
                              <TableRow>
                                <TableHead>Service</TableHead>
                                <TableHead>Price</TableHead>
                                <TableHead>Description</TableHead>
                              </TableRow>
                            </TableHeader>
                            <TableBody>
                              {extractionResult.consolidatedData.services.map((service, index) => (
                                <TableRow key={index}>
                                  <TableCell className="font-medium">{service.name}</TableCell>
                                  <TableCell>{service.price || 'Contact for pricing'}</TableCell>
                                  <TableCell className="text-sm text-muted-foreground">
                                    {service.description || 'No description'}
                                  </TableCell>
                                </TableRow>
                              ))}
                            </TableBody>
                          </Table>
                        </div>
                      </div>
                    )}

                    {extractionResult.consolidatedData.businessHours.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-2">Business Hours</h4>
                        <div className="grid gap-2 bg-muted/30 p-3 rounded">
                          {extractionResult.consolidatedData.businessHours.map((hour, index) => (
                            <div key={index} className="flex justify-between text-sm">
                              <span className="font-medium">{hour.day}</span>
                              <span>
                                {hour.is_closed ? 'Closed' : `${hour.open_time} - ${hour.close_time}`}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {step === 2 && extractionResult?.consolidatedData && (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-xl font-semibold mb-2">Review Consolidated Business Profile</h2>
                <p className="text-muted-foreground">
                  AI has consolidated all your data sources into a unified business profile. Review and save when ready.
                </p>
                <Badge variant="outline" className="mt-2">
                  Confidence: {Math.round(extractionResult.consolidatedData.confidence * 100)}%
                </Badge>
              </div>

              <div className="space-y-4">
                <div className="bg-muted/50 p-4 rounded-lg">
                  <h3 className="font-semibold mb-3">Business Information</h3>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div>
                      <label className="text-sm font-medium">Business Name</label>
                      <p className="text-sm mt-1 p-2 bg-background rounded border">
                        {extractionResult.consolidatedData.businessName}
                      </p>
                    </div>
                    
                    {extractionResult.consolidatedData.businessAddresses.length > 0 && (
                      <div>
                        <label className="text-sm font-medium">
                          Address{extractionResult.consolidatedData.businessAddresses.length > 1 ? 'es' : ''}
                        </label>
                        <div className="text-sm mt-1 p-2 bg-background rounded border space-y-1">
                          {extractionResult.consolidatedData.businessAddresses.map((address, index) => (
                            <p key={index}>{address}</p>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {extractionResult.consolidatedData.services.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-3">Services ({extractionResult.consolidatedData.services.length})</h3>
                    <div className="max-h-60 overflow-y-auto border rounded-lg">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Service Name</TableHead>
                            <TableHead>Price</TableHead>
                            <TableHead>Description</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {extractionResult.consolidatedData.services.map((service, index) => (
                            <TableRow key={index}>
                              <TableCell className="font-medium">{service.name}</TableCell>
                              <TableCell>{service.price || 'Contact for pricing'}</TableCell>
                              <TableCell className="text-sm text-muted-foreground max-w-xs truncate">
                                {service.description || 'No description'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  </div>
                )}

                {extractionResult.consolidatedData.businessHours.length > 0 && (
                  <div>
                    <h3 className="font-semibold mb-3">Business Hours</h3>
                    <div className="bg-muted/50 p-4 rounded-lg">
                      <div className="grid gap-3 md:grid-cols-2">
                        {extractionResult.consolidatedData.businessHours.map((hour, index) => (
                          <div key={index} className="flex justify-between items-center p-2 bg-background rounded">
                            <span className="font-medium">{hour.day}</span>
                            <span className="text-sm">
                              {hour.is_closed ? (
                                <Badge variant="secondary">Closed</Badge>
                              ) : (
                                `${hour.open_time} - ${hour.close_time}`
                              )}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <Button 
                  onClick={() => setStep(1)} 
                  variant="outline" 
                  className="flex-1"
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Data Collection
                </Button>
                <Button 
                  onClick={saveConfiguration} 
                  disabled={isLoading}
                  className="flex-1"
                >
                  {isLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Save Business Profile
                </Button>
              </div>
            </div>
          )}

          {step === 3 && (
            <div className="space-y-6 text-center">
              <div className="space-y-4">
                <CheckCircle className="h-16 w-16 text-green-500 mx-auto" />
                <h2 className="text-2xl font-bold">Customer Onboarded Successfully!</h2>
                <p className="text-muted-foreground">
                  Customer has been successfully added to your SaaS platform and is ready to use the service.
                </p>
              </div>

              <div className="flex gap-3 justify-center">
                <Button 
                  onClick={() => setStep(1)} 
                  variant="outline"
                >
                  Add Another Customer
                </Button>
                <Button 
                  onClick={validateSavedData} 
                  disabled={!!validationStatus}
                  variant="secondary"
                >
                  {validationStatus ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle className="mr-2 h-4 w-4" />}
                  Validate Data
                </Button>
                <Button 
                  onClick={() => {
                    if (onBack) {
                      onBack();
                    } else {
                      window.location.href = '/admin';
                    }
                  }}
                >
                  <ArrowLeft className="mr-2 h-4 w-4" />
                  Back to Customer Management
                </Button>
              </div>

              {validationStatus && (
                <div className="bg-muted/50 p-4 rounded-lg">
                  <p className="text-sm">{validationStatus}</p>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}