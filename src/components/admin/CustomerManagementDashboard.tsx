import React, { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Loader2, Bot, Play, Settings, Eye, Phone, Globe } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
// import { useNavigate } from 'react-router-dom'; // Removed - causing Router context error
import AdminAgentTester from './AdminAgentTester';
import PhoneNumberPanel from './PhoneNumberPanel';

interface CustomerData {
  tenant: any;
  agent: any;
  businessHours: any[];
  services: any[];
  quickAnswers: any[];
}

interface CustomerManagementDashboardProps {
  tenantId: string;
  onBack: () => void;
}

export default function CustomerManagementDashboard({ tenantId, onBack }: CustomerManagementDashboardProps) {
  const { toast } = useToast();
  // const navigate = useNavigate(); // Removed - causing Router context error
  const [customerData, setCustomerData] = useState<CustomerData | null>(null);
  const [loading, setLoading] = useState(true);
  const [training, setTraining] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [showAgentTester, setShowAgentTester] = useState(false);

  const loadCustomerData = useCallback(async () => {
    try {
      setLoading(true);
      
      // Load all customer data
      const [tenantRes, agentRes, hoursRes, servicesRes, qaRes] = await Promise.all([
        supabase.from('tenants').select('*').eq('id', tenantId).single(),
        supabase.from('ai_agents').select('*').eq('tenant_id', tenantId).maybeSingle(),
        supabase.from('business_hours').select('*').eq('tenant_id', tenantId),
        supabase.from('services').select('*').eq('tenant_id', tenantId).eq('active', true),
        supabase.from('business_quick_answers').select('*').eq('tenant_id', tenantId)
      ]);

      if (tenantRes.error) {
        console.error('Tenant loading error:', tenantRes.error);
        throw tenantRes.error;
      }

      if (!tenantRes.data) {
        throw new Error('Customer not found');
      }

      setCustomerData({
        tenant: tenantRes.data,
        agent: agentRes.data,
        businessHours: hoursRes.data || [],
        services: servicesRes.data || [],
        quickAnswers: qaRes.data || []
      });
    } catch (error) {
      console.error('Error loading customer data:', error);
      toast({
        title: "Error",
        description: "Failed to load customer data",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }, [tenantId, toast]);

  useEffect(() => {
    loadCustomerData();
  }, [loadCustomerData]);

  const handleTrainAgent = async () => {
    try {
      setTraining(true);
      
      const { data, error } = await supabase.functions.invoke('train-agent', {
        body: {
          tenant_id: tenantId,
          agent_name: 'Receptionist',
          voice_provider: 'elevenlabs',
          voice_id: '9BWtsMINqrJLrRacOk9x'
        }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "AI agent trained successfully"
      });

      // Reload customer data to get updated agent info
      await loadCustomerData();
    } catch (error) {
      console.error('Error training agent:', error);
      toast({
        title: "Error",
        description: "Failed to train AI agent",
        variant: "destructive"
      });
    } finally {
      setTraining(false);
    }
  };

  const handleExtractBusinessData = async () => {
    if (!websiteUrl || !customerData) return;

    setExtracting(true);
    try {
      // First, run crawl-ingest to extract data
      const { error: crawlError } = await supabase.functions.invoke('crawl-ingest', {
        body: {
          tenant_id: tenantId,
          url: websiteUrl
        }
      });

      if (crawlError) throw crawlError;

      // Then consolidate the business data
      const { error: consolidateError } = await supabase.functions.invoke('consolidate-business-data', {
        body: {
          tenant_id: tenantId
        }
      });

      if (consolidateError) throw consolidateError;

      // Finally, retrain the agent
      await handleTrainAgent();

      toast({
        title: "Success",
        description: "Business data extracted and agent retrained successfully"
      });

      // Refresh the data
      await loadCustomerData();
    } catch (error) {
      console.error('Error extracting business data:', error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : 'Failed to extract business data',
        variant: "destructive"
      });
    } finally {
      setExtracting(false);
      setWebsiteUrl('');
    }
  };

  const handleTestAgent = () => {
    if (!customerData?.agent) {
      toast({
        title: "No Agent",
        description: "Please train an AI agent first",
        variant: "destructive"
      });
      return;
    }
    setShowAgentTester(true);
  };

  const handleViewAsCustomer = async () => {
    try {
      // Set this tenant as active for the admin user
      const { data: user } = await supabase.auth.getUser();
      if (!user.user) return;

      await supabase
        .from('profiles')
        .update({ active_tenant_id: tenantId })
        .eq('id', user.user.id);

      // Use window.location to navigate instead of useNavigate
      window.location.href = '/overview';
      
      toast({
        title: "Viewing as Customer",
        description: `You're now viewing as ${customerData?.tenant.name}`,
      });
    } catch (error) {
      console.error('Error switching to customer view:', error);
      toast({
        title: "Error",
        description: "Failed to switch to customer view",
        variant: "destructive"
      });
    }
  };

  // Add error boundary for safety
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin" />
        <span className="ml-2">Loading customer data...</span>
      </div>
    );
  }

  if (!customerData || !customerData.tenant) {
    return (
      <div className="text-center py-8">
        <p className="text-muted-foreground">Customer data not found</p>
        <Button onClick={onBack} className="mt-4">Back to Customers</Button>
      </div>
    );
  }

  const { tenant, agent, businessHours, services, quickAnswers } = customerData;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{tenant.name}</h1>
          <p className="text-muted-foreground">Customer Management Dashboard</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleViewAsCustomer} variant="outline" className="flex items-center gap-2">
            <Eye className="h-4 w-4" />
            View as Customer
          </Button>
          <Button onClick={onBack} variant="outline">
            Back to Customers
          </Button>
        </div>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full grid-cols-5">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="agent">AI Agent</TabsTrigger>
          <TabsTrigger value="phone">Phone Number</TabsTrigger>
          <TabsTrigger value="business">Business Info</TabsTrigger>
          <TabsTrigger value="settings">Settings</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-6">
          {/* Overview Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">AI Agent Status</CardTitle>
                <Bot className="h-4 w-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {agent ? (
                    <Badge variant={agent.status === 'ready' ? 'default' : 'secondary'}>
                      {agent.status}
                    </Badge>
                  ) : (
                    <Badge variant="outline">Not Created</Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {agent ? `Version ${agent.version}` : 'No agent configured'}
                </p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Services</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{services.length}</div>
                <p className="text-xs text-muted-foreground">Active services</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                <CardTitle className="text-sm font-medium">Knowledge Base</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">{quickAnswers.length}</div>
                <p className="text-xs text-muted-foreground">Quick answers</p>
              </CardContent>
            </Card>
          </div>

          {/* Recent Activity */}
          <Card>
            <CardHeader>
              <CardTitle>Recent Activity</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {agent && (
                  <div className="flex items-center space-x-4">
                    <Bot className="h-4 w-4" />
                    <div className="flex-1">
                      <p className="text-sm font-medium">AI Agent {agent.status}</p>
                      <p className="text-xs text-muted-foreground">
                        {agent.trained_at ? `Last trained: ${new Date(agent.trained_at).toLocaleString()}` : 'Never trained'}
                      </p>
                    </div>
                  </div>
                )}
                <div className="flex items-center space-x-4">
                  <Settings className="h-4 w-4" />
                  <div className="flex-1">
                    <p className="text-sm font-medium">Tenant Created</p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(tenant.created_at).toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="agent" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>AI Agent Configuration</CardTitle>
              <CardDescription>
                Manage your customer's AI receptionist agent
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {agent ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Agent Name</Label>
                      <Input value={agent.name} readOnly />
                    </div>
                    <div>
                      <Label>Model</Label>
                      <Input value={agent.model} readOnly />
                    </div>
                  </div>
                  
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Voice Provider</Label>
                      <Input value={agent.voice_provider || 'None'} readOnly />
                    </div>
                    <div>
                      <Label>Voice ID</Label>
                      <Input value={agent.voice_id || 'None'} readOnly />
                    </div>
                  </div>

                  <div>
                    <Label>System Prompt</Label>
                    <Textarea 
                      value={agent.system_prompt} 
                      readOnly 
                      rows={8}
                      className="resize-none"
                    />
                  </div>

                  <div className="flex gap-4">
                    <Button 
                      onClick={handleTrainAgent} 
                      disabled={training}
                      className="flex items-center gap-2"
                    >
                      {training ? <Loader2 className="h-4 w-4 animate-spin" /> : <Bot className="h-4 w-4" />}
                      {training ? 'Training...' : 'Retrain Agent'}
                    </Button>
                    
                    <Button 
                      onClick={handleTestAgent}
                      variant="outline"
                      className="flex items-center gap-2"
                    >
                      <Play className="h-4 w-4" />
                      Test Agent
                    </Button>

                    <Dialog>
                      <DialogTrigger asChild>
                        <Button variant="outline" className="flex items-center gap-2">
                          <Globe className="h-4 w-4" />
                          Extract Business Data
                        </Button>
                      </DialogTrigger>
                      <DialogContent>
                        <DialogHeader>
                          <DialogTitle>Extract Business Data</DialogTitle>
                          <DialogDescription>
                            Enter a website URL to extract and update business information for this customer
                          </DialogDescription>
                        </DialogHeader>
                        <div className="space-y-4">
                          <div>
                            <Label htmlFor="website">Website URL</Label>
                            <Input
                              id="website"
                              value={websiteUrl}
                              onChange={(e) => setWebsiteUrl(e.target.value)}
                              placeholder="https://example.com"
                              type="url"
                            />
                          </div>
                          <Button 
                            onClick={handleExtractBusinessData}
                            disabled={extracting || !websiteUrl}
                            className="w-full"
                          >
                            {extracting ? 'Extracting...' : 'Extract & Retrain Agent'}
                          </Button>
                        </div>
                      </DialogContent>
                    </Dialog>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8">
                  <Bot className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No AI Agent</h3>
                  <p className="text-muted-foreground mb-4">
                    This customer doesn't have an AI agent yet.
                  </p>
                  <Button onClick={handleTrainAgent} disabled={training}>
                    {training ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Creating Agent...
                      </>
                    ) : (
                      <>
                        <Bot className="h-4 w-4 mr-2" />
                        Create AI Agent
                      </>
                    )}
                  </Button>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="phone" className="space-y-6">
          <PhoneNumberPanel tenantId={tenantId} />
        </TabsContent>

        <TabsContent value="business" className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <Card>
              <CardHeader>
                <CardTitle>Business Hours</CardTitle>
              </CardHeader>
              <CardContent>
                {businessHours.length > 0 ? (
                  <div className="space-y-2">
                    {businessHours.map((hour) => {
                      const dayName = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][hour.dow];
                      return (
                        <div key={hour.dow} className="flex justify-between">
                          <span className="font-medium">{dayName}</span>
                          <span className="text-muted-foreground">
                            {hour.is_closed ? 'Closed' : `${hour.open_time} - ${hour.close_time}`}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No business hours configured</p>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Services</CardTitle>
              </CardHeader>
              <CardContent>
                {services.length > 0 ? (
                  <div className="space-y-3">
                    {services.map((service) => (
                      <div key={service.id} className="border-l-2 border-primary pl-3">
                        <h4 className="font-medium">{service.name}</h4>
                        {service.description && (
                          <p className="text-sm text-muted-foreground">{service.description}</p>
                        )}
                        <div className="flex gap-4 text-xs text-muted-foreground mt-1">
                          {service.duration_minutes && <span>{service.duration_minutes} min</span>}
                          {service.price && <span>${service.price}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-muted-foreground">No services configured</p>
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Quick Answers</CardTitle>
            </CardHeader>
            <CardContent>
              {quickAnswers.length > 0 ? (
                <div className="space-y-4">
                  {quickAnswers.map((qa) => (
                    <div key={qa.id}>
                      <h4 className="font-medium text-sm">{qa.question_type}</h4>
                      <p className="text-sm text-muted-foreground">{qa.answer}</p>
                      <Separator className="mt-2" />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted-foreground">No quick answers configured</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Tenant Settings</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label>Tenant ID</Label>
                  <Input value={tenant.id} readOnly />
                </div>
                <div>
                  <Label>Slug</Label>
                  <Input value={tenant.slug} readOnly />
                </div>
              </div>
              
              <div>
                <Label>Subscription Status</Label>
                <Input value={tenant.subscription_status || 'None'} readOnly />
              </div>

              <div>
                <Label>Created</Label>
                <Input value={new Date(tenant.created_at).toLocaleString()} readOnly />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Agent Tester Modal */}
      {customerData?.agent && (
        <AdminAgentTester
          open={showAgentTester}
          onOpenChange={setShowAgentTester}
          agent={customerData.agent}
          tenantId={tenantId}
        />
      )}
    </div>
  );
}