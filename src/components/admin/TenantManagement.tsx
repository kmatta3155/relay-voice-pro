import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from '@/components/ui/alert-dialog';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Edit, Trash2, Eye } from 'lucide-react';

type Tenant = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  subscription_status?: string;
  stripe_customer_id?: string;
};

type TenantDetails = {
  agent: any;
  branding: any;
  hours: any[];
  services: any[];
};

export function TenantManagement() {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedTenant, setSelectedTenant] = useState<Tenant | null>(null);
  const [tenantDetails, setTenantDetails] = useState<TenantDetails | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadTenants();
  }, []);

  const loadTenants = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('tenants-admin', {
        body: { action: 'list' }
      });

      if (error) throw error;
      if (data?.ok) {
        setTenants(data.tenants || []);
      }
    } catch (error: any) {
      toast({
        title: "Error loading tenants",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const loadTenantDetails = async (tenantId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('tenants-admin', {
        body: { action: 'details', tenantId }
      });

      if (error) throw error;
      if (data?.ok) {
        setTenantDetails({
          agent: data.agent,
          branding: data.branding,
          hours: data.hours,
          services: data.services
        });
      }
    } catch (error: any) {
      toast({
        title: "Error loading tenant details",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const deleteTenant = async (tenantId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('tenants-admin', {
        body: { action: 'delete', tenantId }
      });

      if (error) throw error;
      if (data?.ok) {
        toast({
          title: "Tenant deleted",
          description: "Tenant and all associated data has been removed."
        });
        loadTenants();
      }
    } catch (error: any) {
      toast({
        title: "Error deleting tenant",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const handleViewDetails = async (tenant: Tenant) => {
    setSelectedTenant(tenant);
    await loadTenantDetails(tenant.id);
    setDetailsDialogOpen(true);
  };

  const handleEditTenant = async (tenant: Tenant) => {
    setSelectedTenant(tenant);
    await loadTenantDetails(tenant.id);
    setEditDialogOpen(true);
  };

  const saveChanges = async () => {
    if (!selectedTenant || !tenantDetails) return;
    
    try {
      // Update tenant basic info
      const { error: tenantError } = await supabase
        .from('tenants')
        .update({ name: selectedTenant.name, slug: selectedTenant.slug })
        .eq('id', selectedTenant.id);

      if (tenantError) throw tenantError;

      // Update branding
      if (tenantDetails.branding) {
        const { error: brandingError } = await supabase
          .from('tenant_branding')
          .upsert({
            tenant_id: selectedTenant.id,
            ...tenantDetails.branding
          });
        if (brandingError) throw brandingError;
      }

      // Update agent settings
      if (tenantDetails.agent) {
        const { error: agentError } = await supabase
          .from('agent_settings')
          .upsert({
            tenant_id: selectedTenant.id,
            ...tenantDetails.agent
          });
        if (agentError) throw agentError;
      }

      toast({
        title: "Tenant updated",
        description: "Changes have been saved successfully."
      });
      
      setEditDialogOpen(false);
      loadTenants();
    } catch (error: any) {
      toast({
        title: "Error updating tenant",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  if (loading) {
    return (
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle>Tenant Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">Loading tenants...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Tenant Management
          <Badge variant="secondary">{tenants.length} tenant(s)</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {tenants.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No tenants found. Create your first tenant using the onboarding flow.
          </div>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Slug</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tenants.map((tenant) => (
                <TableRow key={tenant.id}>
                  <TableCell className="font-medium">{tenant.name}</TableCell>
                  <TableCell>{tenant.slug}</TableCell>
                  <TableCell>
                    <Badge variant={tenant.subscription_status === 'active' ? 'default' : 'secondary'}>
                      {tenant.subscription_status || 'inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(tenant.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewDetails(tenant)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditTenant(tenant)}
                      >
                        <Edit className="h-4 w-4" />
                      </Button>
                      <AlertDialog>
                        <AlertDialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        </AlertDialogTrigger>
                        <AlertDialogContent>
                          <AlertDialogHeader>
                            <AlertDialogTitle>Delete Tenant</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete "{tenant.name}"? This will permanently remove all tenant data including appointments, calls, leads, and settings. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteTenant(tenant.id)}
                              className="bg-destructive text-destructive-foreground"
                            >
                              Delete
                            </AlertDialogAction>
                          </AlertDialogFooter>
                        </AlertDialogContent>
                      </AlertDialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        {/* View Details Dialog */}
        <Dialog open={detailsDialogOpen} onOpenChange={setDetailsDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Tenant Details: {selectedTenant?.name}</DialogTitle>
            </DialogHeader>
            {tenantDetails && (
              <Tabs defaultValue="basic" className="w-full">
                <TabsList className="grid w-full grid-cols-4">
                  <TabsTrigger value="basic">Basic Info</TabsTrigger>
                  <TabsTrigger value="branding">Branding</TabsTrigger>
                  <TabsTrigger value="hours">Hours</TabsTrigger>
                  <TabsTrigger value="services">Services</TabsTrigger>
                </TabsList>
                
                <TabsContent value="basic" className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <Label>Name</Label>
                      <div className="text-sm">{selectedTenant?.name}</div>
                    </div>
                    <div>
                      <Label>Slug</Label>
                      <div className="text-sm">{selectedTenant?.slug}</div>
                    </div>
                    <div>
                      <Label>Created</Label>
                      <div className="text-sm">{selectedTenant?.created_at && new Date(selectedTenant.created_at).toLocaleString()}</div>
                    </div>
                    <div>
                      <Label>Subscription Status</Label>
                      <div className="text-sm">{selectedTenant?.subscription_status || 'inactive'}</div>
                    </div>
                  </div>
                  {tenantDetails.agent && (
                    <div className="space-y-2">
                      <Label>Agent Settings</Label>
                      <div className="text-sm space-y-1">
                        <div>Phone: {tenantDetails.agent.twilio_number || 'Not configured'}</div>
                        <div>Website: {tenantDetails.agent.website_url || 'Not configured'}</div>
                        <div>Forward Number: {tenantDetails.agent.forward_number || 'Not configured'}</div>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="branding" className="space-y-4">
                  {tenantDetails.branding ? (
                    <div className="space-y-2">
                      <div>
                        <Label>Brand Color</Label>
                        <div className="text-sm">{tenantDetails.branding.brand_color}</div>
                      </div>
                      <div>
                        <Label>Logo URL</Label>
                        <div className="text-sm">{tenantDetails.branding.logo_url || 'Not set'}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-muted-foreground">No branding configured</div>
                  )}
                </TabsContent>

                <TabsContent value="hours" className="space-y-4">
                  {tenantDetails.hours.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Day</TableHead>
                          <TableHead>Open</TableHead>
                          <TableHead>Close</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tenantDetails.hours.map((hour) => (
                          <TableRow key={hour.dow}>
                            <TableCell>{['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][hour.dow]}</TableCell>
                            <TableCell>{hour.open_time}</TableCell>
                            <TableCell>{hour.close_time}</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-muted-foreground">No business hours configured</div>
                  )}
                </TabsContent>

                <TabsContent value="services" className="space-y-4">
                  {tenantDetails.services.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Service</TableHead>
                          <TableHead>Duration</TableHead>
                          <TableHead>Price</TableHead>
                          <TableHead>Status</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {tenantDetails.services.map((service) => (
                          <TableRow key={service.id}>
                            <TableCell>{service.name}</TableCell>
                            <TableCell>{service.duration_minutes} min</TableCell>
                            <TableCell>${service.price || 'N/A'}</TableCell>
                            <TableCell>
                              <Badge variant={service.active ? 'default' : 'secondary'}>
                                {service.active ? 'Active' : 'Inactive'}
                              </Badge>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="text-muted-foreground">No services configured</div>
                  )}
                </TabsContent>
              </Tabs>
            )}
          </DialogContent>
        </Dialog>

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Edit Tenant: {selectedTenant?.name}</DialogTitle>
            </DialogHeader>
            {selectedTenant && tenantDetails && (
              <>
                <Tabs defaultValue="basic" className="w-full">
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="basic">Basic Info</TabsTrigger>
                    <TabsTrigger value="branding">Branding</TabsTrigger>
                    <TabsTrigger value="agent">Agent Settings</TabsTrigger>
                  </TabsList>
                  
                  <TabsContent value="basic" className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <Label htmlFor="tenant-name">Name</Label>
                        <Input
                          id="tenant-name"
                          value={selectedTenant.name}
                          onChange={(e) => setSelectedTenant({...selectedTenant, name: e.target.value})}
                        />
                      </div>
                      <div>
                        <Label htmlFor="tenant-slug">Slug</Label>
                        <Input
                          id="tenant-slug"
                          value={selectedTenant.slug}
                          onChange={(e) => setSelectedTenant({...selectedTenant, slug: e.target.value})}
                        />
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="branding" className="space-y-4">
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="brand-color">Brand Color</Label>
                        <Input
                          id="brand-color"
                          type="color"
                          value={tenantDetails.branding?.brand_color || '#6d28d9'}
                          onChange={(e) => setTenantDetails({
                            ...tenantDetails,
                            branding: {...tenantDetails.branding, brand_color: e.target.value}
                          })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="logo-url">Logo URL</Label>
                        <Input
                          id="logo-url"
                          value={tenantDetails.branding?.logo_url || ''}
                          onChange={(e) => setTenantDetails({
                            ...tenantDetails,
                            branding: {...tenantDetails.branding, logo_url: e.target.value}
                          })}
                        />
                      </div>
                    </div>
                  </TabsContent>

                  <TabsContent value="agent" className="space-y-4">
                    <div className="space-y-4">
                      <div>
                        <Label htmlFor="website-url">Website URL</Label>
                        <Input
                          id="website-url"
                          value={tenantDetails.agent?.website_url || ''}
                          onChange={(e) => setTenantDetails({
                            ...tenantDetails,
                            agent: {...tenantDetails.agent, website_url: e.target.value}
                          })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="forward-number">Forward Number</Label>
                        <Input
                          id="forward-number"
                          value={tenantDetails.agent?.forward_number || ''}
                          onChange={(e) => setTenantDetails({
                            ...tenantDetails,
                            agent: {...tenantDetails.agent, forward_number: e.target.value}
                          })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="greeting">Greeting</Label>
                        <Textarea
                          id="greeting"
                          value={tenantDetails.agent?.greeting || ''}
                          onChange={(e) => setTenantDetails({
                            ...tenantDetails,
                            agent: {...tenantDetails.agent, greeting: e.target.value}
                          })}
                        />
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
                
                <div className="flex justify-end gap-2 mt-6">
                  <Button variant="outline" onClick={() => setEditDialogOpen(false)}>
                    Cancel
                  </Button>
                  <Button onClick={saveChanges}>
                    Save Changes
                  </Button>
                </div>
              </>
            )}
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}