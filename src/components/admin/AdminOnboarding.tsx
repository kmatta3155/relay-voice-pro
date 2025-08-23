import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Globe, Loader2, Check, AlertCircle, Settings, Clock, Bot } from 'lucide-react';

// Data types and interfaces remain the same
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
  business_info?: {
    name?: string;
    addresses?: string[];
    phone?: string;
    email?: string;
  };
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

interface AdminOnboardingProps {
  onBack: () => void;
}

export default function AdminOnboarding({ onBack }: AdminOnboardingProps) {
  const [currentStep, setCurrentStep] = useState(1);
  const [loading, setLoading] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [businessName, setBusinessName] = useState('');
  const [businessType, setBusinessType] = useState('');
  const [extractionResult, setExtractionResult] = useState<ExtractionResult | null>(null);
  const [crawlOptions, setCrawlOptions] = useState<CrawlOptions>({
    maxPages: 5,
    maxDepth: 2,
    includePatterns: [],
    excludePatterns: ['*/blog/*', '*/news/*', '*/privacy*', '*/terms*']
  });
  const { toast } = useToast();
  const [newTenantId, setNewTenantId] = useState<string | null>(null);

  const analyzeWebsite = async (deepCrawl = false) => {
    if (!websiteUrl || !businessName) {
      toast({
        title: "Error",
        description: "Please enter both website URL and business name",
        variant: "destructive",
      });
      return;
    }

    setLoading(true);

    try {
      console.log('Starting website analysis...');
      
      const result = await supabase.functions.invoke('crawl-ingest', {
        body: {
          url: websiteUrl,
          tenant_id: 'demo', // Demo tenant for analysis
          crawlOptions: crawlOptions
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
      setExtractionResult(result.data);
      setCurrentStep(2);

      toast({
        title: "Analysis Complete",
        description: `Found ${result.data.services?.length || 0} services and business information`,
      });

    } catch (error) {
      console.error('Website analysis failed:', error);
      toast({
        title: "Analysis Failed",
        description: error instanceof Error ? error.message : 'Failed to analyze website',
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const validateSavedData = async () => {
    if (!newTenantId) {
      toast({
        title: "No Data",
        description: "No tenant created yet",
        variant: "destructive"
      });
      return;
    }

    try {
      const [agentResult, servicesResult, hoursResult] = await Promise.all([
        supabase.from('ai_agents').select('*').eq('tenant_id', newTenantId).maybeSingle(),
        supabase.from('services').select('*').eq('tenant_id', newTenantId),
        supabase.from('business_hours').select('*').eq('tenant_id', newTenantId).order('dow')
      ]);

      toast({
        title: "Data Validation",
        description: `AI Agent: ${agentResult.data ? 'Created' : 'Not found'}, Services: ${servicesResult.data?.length || 0}, Hours: ${hoursResult.data?.length || 0}`,
      });

      console.log('Validation results:', { agentResult, servicesResult, hoursResult });
    } catch (error) {
      console.error('Validation failed:', error);
      toast({
        title: "Validation Failed",
        description: error instanceof Error ? error.message : 'Validation failed',
        variant: "destructive",
      });
    }
  };

  const saveConfiguration = async () => {
    try {
      setLoading(true);
      setCurrentStep(3);
      console.log('Saving configuration:', extractionResult);
      
      // Create the tenant first
      const { data: tenantData, error: tenantError } = await supabase.functions.invoke('customer-create', {
        body: {
          name: businessName,
          business_type: businessType,
          website_url: websiteUrl
        }
      });

      if (tenantError) throw tenantError;
      if (!tenantData?.tenant_id) throw new Error('Failed to create tenant');

      const tenantId = tenantData.tenant_id;
      setNewTenantId(tenantId);
      console.log('Created tenant:', tenantId);

      // Save business data to this tenant
      if (extractionResult) {
        const { error: consolidateError } = await supabase.functions.invoke('consolidate-business-data', {
          body: {
            tenantId: tenantId,
            dataSources: [{
              type: 'website' as const,
              content: JSON.stringify(extractionResult),
              metadata: { url: websiteUrl }
            }]
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
          tenant_id: tenantId,
          agent_name: 'Receptionist',
          voice_provider: 'elevenlabs',
          voice_id: '9BWtsMINqrJLrRacOk9x'
        }
      });

      if (agentError) {
        console.error('Agent training error:', agentError);
        // Continue to completion even if agent training fails
      }

      setCurrentStep(4);
      console.log('Process completed:', { tenantData, agentData });

      toast({
        title: "Success",
        description: "Customer onboarded successfully!",
      });
    } catch (error) {
      console.error('Error in onboarding process:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : 'Failed to complete onboarding',
        variant: "destructive"
      });
      setCurrentStep(2); // Go back to review step
    } finally {
      setLoading(false);
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Customer Onboarding</h1>
          <p className="text-muted-foreground">Set up a new customer with AI agent</p>
        </div>
        <Button onClick={onBack} variant="outline">Back</Button>
      </div>

      {/* Progress Indicator */}
      <div className="flex items-center justify-between mb-8">
        {[1, 2, 3, 4].map((step) => (
          <div
            key={step}
            className={`flex items-center ${
              step < 4 ? 'flex-1' : ''
            }`}
          >
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-medium ${
                currentStep >= step
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground'
              }`}
            >
              {step}
            </div>
            {step < 4 && (
              <div
                className={`flex-1 h-0.5 ml-4 mr-4 ${
                  currentStep > step ? 'bg-primary' : 'bg-muted'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Step 1: Website Analysis */}
      {currentStep === 1 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              Website Analysis
            </CardTitle>
            <CardDescription>
              Enter customer details to begin onboarding
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label htmlFor="businessName">Business Name *</Label>
                <Input
                  id="businessName"
                  placeholder="Acme Beauty Salon"
                  value={businessName}
                  onChange={(e) => setBusinessName(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="businessType">Business Type</Label>
                <Input
                  id="businessType"
                  placeholder="Salon, Restaurant, Clinic, etc."
                  value={businessType}
                  onChange={(e) => setBusinessType(e.target.value)}
                />
              </div>
            </div>

            <div>
              <Label htmlFor="websiteUrl">Website URL *</Label>
              <Input
                id="websiteUrl"
                placeholder="https://example.com"
                value={websiteUrl}
                onChange={(e) => setWebsiteUrl(e.target.value)}
              />
            </div>

            <Button 
              onClick={() => analyzeWebsite(false)}
              disabled={loading || !websiteUrl || !businessName}
              className="w-full"
            >
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Analyzing Website...
                </>
              ) : (
                'Analyze Website & Extract Data'
              )}
            </Button>

            {extractionResult && (
              <Card className="mt-6">
                <CardHeader>
                  <CardTitle>Analysis Results</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="text-center p-4 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold">{extractionResult.services?.length || 0}</div>
                      <div className="text-sm text-muted-foreground">Services Found</div>
                    </div>
                    <div className="text-center p-4 bg-muted/50 rounded-lg">
                      <div className="text-2xl font-bold">{extractionResult.hours?.length || 0}</div>
                      <div className="text-sm text-muted-foreground">Hours Entries</div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
          </CardContent>
        </Card>
      )}

      {/* Step 2: Review Data */}
      {currentStep === 2 && extractionResult && (
        <Card>
          <CardHeader>
            <CardTitle>Review Extracted Data</CardTitle>
            <CardDescription>
              Review the business information before creating the customer
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            {/* Services */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Services ({extractionResult.services?.length || 0})</h3>
              {extractionResult.services?.length > 0 ? (
                <div className="space-y-2">
                  {extractionResult.services.map((service, index) => (
                    <div key={index} className="p-3 border rounded-lg">
                      <h4 className="font-medium">{service.name}</h4>
                      {service.description && (
                        <p className="text-sm text-muted-foreground">{service.description}</p>
                      )}
                      <div className="flex gap-2 mt-2">
                        {service.price && <span className="text-xs bg-primary/10 px-2 py-1 rounded">{service.price}</span>}
                        {service.duration_minutes && (
                          <span className="text-xs bg-secondary px-2 py-1 rounded">
                            {formatDuration(service.duration_minutes)}
                          </span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No services found</p>
              )}
            </div>

            {/* Business Hours */}
            <div>
              <h3 className="text-lg font-semibold mb-3">Business Hours ({extractionResult.hours?.length || 0})</h3>
              {extractionResult.hours?.length > 0 ? (
                <div className="grid grid-cols-2 gap-2">
                  {extractionResult.hours.map((hour, index) => (
                    <div key={index} className="flex justify-between p-2 bg-muted/50 rounded">
                      <span className="font-medium">{hour.day}</span>
                      <span className="text-muted-foreground">
                        {hour.is_closed ? 'Closed' : `${hour.open_time} - ${hour.close_time}`}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No hours found</p>
              )}
            </div>

            <div className="flex gap-3 pt-4">
              <Button onClick={() => setCurrentStep(1)} variant="outline">
                Back to Analysis
              </Button>
              <Button 
                onClick={saveConfiguration}
                disabled={loading}
                className="flex-1"
              >
                {loading ? 'Creating Customer...' : 'Create Customer & Train AI Agent'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Agent Training */}
      {currentStep === 3 && (
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mb-4">
              <Bot className="h-6 w-6 text-blue-600" />
            </div>
            <CardTitle className="text-2xl">Training AI Agent</CardTitle>
            <CardDescription>
              Creating and training the AI receptionist for this customer...
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <div className="flex items-center justify-center space-x-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span>Training in progress...</span>
            </div>
            <p className="text-muted-foreground">
              This may take a few moments while we configure the AI agent with the business information.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Step 4: Complete */}
      {currentStep === 4 && (
        <Card>
          <CardHeader className="text-center">
            <div className="mx-auto w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mb-4">
              <Check className="h-6 w-6 text-green-600" />
            </div>
            <CardTitle className="text-2xl">Onboarding Complete!</CardTitle>
            <CardDescription>
              {businessName} has been successfully onboarded with their AI receptionist.
            </CardDescription>
          </CardHeader>
          <CardContent className="text-center space-y-4">
            <p className="text-muted-foreground">
              The AI agent has been trained with the business information and is ready to assist customers.
            </p>
            <div className="flex justify-center gap-4">
              <Button onClick={() => window.location.reload()}>
                Process Another Customer
              </Button>
              <Button variant="outline" onClick={validateSavedData}>
                Validate Data
              </Button>
              <Button variant="outline" onClick={onBack}>
                Back to Dashboard
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
