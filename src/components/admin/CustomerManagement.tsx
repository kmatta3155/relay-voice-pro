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

type Customer = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  subscription_status?: string;
  stripe_customer_id?: string;
};

type CustomerDetails = {
  agent: any;
  branding: any;
  hours: any[];
  services: any[];
};

export function CustomerManagement() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | null>(null);
  const [customerDetails, setCustomerDetails] = useState<CustomerDetails | null>(null);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [detailsDialogOpen, setDetailsDialogOpen] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    try {
      const { data, error } = await supabase.functions.invoke('customers-admin', {
        body: { action: 'list' }
      });

      if (error) throw error;
      if (data?.ok) {
        setCustomers(data.customers || []);
      }
    } catch (error: any) {
      toast({
        title: "Error loading customers",
        description: error.message,
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const loadCustomerDetails = async (customerId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('customers-admin', {
        body: { action: 'details', customerId }
      });

      if (error) throw error;
      if (data?.ok) {
        setCustomerDetails({
          agent: data.agent,
          branding: data.branding,
          hours: data.hours,
          services: data.services
        });
      }
    } catch (error: any) {
      toast({
        title: "Error loading customer details",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const deleteCustomer = async (customerId: string) => {
    try {
      const { data, error } = await supabase.functions.invoke('customers-admin', {
        body: { action: 'delete', customerId }
      });

      if (error) throw error;
      if (data?.ok) {
        toast({
          title: "Customer deleted",
          description: "Customer and all associated data has been removed."
        });
        loadCustomers();
      }
    } catch (error: any) {
      toast({
        title: "Error deleting customer",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  const handleViewDetails = async (customer: Customer) => {
    setSelectedCustomer(customer);
    await loadCustomerDetails(customer.id);
    setDetailsDialogOpen(true);
  };

  const handleEditCustomer = async (customer: Customer) => {
    setSelectedCustomer(customer);
    await loadCustomerDetails(customer.id);
    setEditDialogOpen(true);
  };

  const saveChanges = async () => {
    if (!selectedCustomer || !customerDetails) return;
    
    try {
      // Update customer basic info
      const { error: customerError } = await supabase
        .from('customers')
        .update({ name: selectedCustomer.name, slug: selectedCustomer.slug })
        .eq('id', selectedCustomer.id);

      if (customerError) throw customerError;

      // Update branding
      if (customerDetails.branding) {
        const { error: brandingError } = await supabase
          .from('customer_branding')
          .upsert({
            customer_id: selectedCustomer.id,
            ...customerDetails.branding
          });
        if (brandingError) throw brandingError;
      }

      // Update agent settings
      if (customerDetails.agent) {
        const { error: agentError } = await supabase
          .from('agent_settings')
          .upsert({
            customer_id: selectedCustomer.id,
            ...customerDetails.agent
          });
        if (agentError) throw agentError;
      }

      toast({
        title: "Customer updated",
        description: "Changes have been saved successfully."
      });
      
      setEditDialogOpen(false);
      loadCustomers();
    } catch (error: any) {
      toast({
        title: "Error updating customer",
        description: error.message,
        variant: "destructive"
      });
    }
  };

  if (loading) {
    return (
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle>Customer Management</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-8">Loading customers...</div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          Customer Management
          <Badge variant="secondary">{customers.length} customer(s)</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {customers.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            No customers found. Create your first customer using the onboarding flow.
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
              {customers.map((customer) => (
                <TableRow key={customer.id}>
                  <TableCell className="font-medium">{customer.name}</TableCell>
                  <TableCell>{customer.slug}</TableCell>
                  <TableCell>
                    <Badge variant={customer.subscription_status === 'active' ? 'default' : 'secondary'}>
                      {customer.subscription_status || 'inactive'}
                    </Badge>
                  </TableCell>
                  <TableCell>{new Date(customer.created_at).toLocaleDateString()}</TableCell>
                  <TableCell>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleViewDetails(customer)}
                      >
                        <Eye className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleEditCustomer(customer)}
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
                            <AlertDialogTitle>Delete Customer</AlertDialogTitle>
                            <AlertDialogDescription>
                              Are you sure you want to delete "{customer.name}"? This will permanently remove all customer data including appointments, calls, leads, and settings. This action cannot be undone.
                            </AlertDialogDescription>
                          </AlertDialogHeader>
                          <AlertDialogFooter>
                            <AlertDialogCancel>Cancel</AlertDialogCancel>
                            <AlertDialogAction
                              onClick={() => deleteCustomer(customer.id)}
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
              <DialogTitle>Customer Details: {selectedCustomer?.name}</DialogTitle>
            </DialogHeader>
            {customerDetails && (
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
                      <div className="text-sm">{selectedCustomer?.name}</div>
                    </div>
                    <div>
                      <Label>Slug</Label>
                      <div className="text-sm">{selectedCustomer?.slug}</div>
                    </div>
                    <div>
                      <Label>Created</Label>
                      <div className="text-sm">{selectedCustomer?.created_at && new Date(selectedCustomer.created_at).toLocaleString()}</div>
                    </div>
                    <div>
                      <Label>Subscription Status</Label>
                      <div className="text-sm">{selectedCustomer?.subscription_status || 'inactive'}</div>
                    </div>
                  </div>
                  {customerDetails.agent && (
                    <div className="space-y-2">
                      <Label>Agent Settings</Label>
                      <div className="text-sm space-y-1">
                        <div>Phone: {customerDetails.agent.twilio_number || 'Not configured'}</div>
                        <div>Website: {customerDetails.agent.website_url || 'Not configured'}</div>
                        <div>Forward Number: {customerDetails.agent.forward_number || 'Not configured'}</div>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="branding" className="space-y-4">
                  {customerDetails.branding ? (
                    <div className="space-y-2">
                      <div>
                        <Label>Brand Color</Label>
                        <div className="text-sm">{customerDetails.branding.brand_color}</div>
                      </div>
                      <div>
                        <Label>Logo URL</Label>
                        <div className="text-sm">{customerDetails.branding.logo_url || 'Not set'}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="text-muted-foreground">No branding configured</div>
                  )}
                </TabsContent>

                <TabsContent value="hours" className="space-y-4">
                  {customerDetails.hours.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Day</TableHead>
                          <TableHead>Open</TableHead>
                          <TableHead>Close</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {customerDetails.hours.map((hour) => (
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
                  {customerDetails.services.length > 0 ? (
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
                        {customerDetails.services.map((service) => (
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
              <DialogTitle>Edit Customer: {selectedCustomer?.name}</DialogTitle>
            </DialogHeader>
            {selectedCustomer && customerDetails && (
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
                        <Label htmlFor="customer-name">Name</Label>
                        <Input
                          id="customer-name"
                          value={selectedCustomer.name}
                          onChange={(e) => setSelectedCustomer({...selectedCustomer, name: e.target.value})}
                        />
                      </div>
                      <div>
                        <Label htmlFor="customer-slug">Slug</Label>
                        <Input
                          id="customer-slug"
                          value={selectedCustomer.slug}
                          onChange={(e) => setSelectedCustomer({...selectedCustomer, slug: e.target.value})}
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
                          value={customerDetails.branding?.brand_color || '#6d28d9'}
                          onChange={(e) => setCustomerDetails({
                            ...customerDetails,
                            branding: {...customerDetails.branding, brand_color: e.target.value}
                          })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="logo-url">Logo URL</Label>
                        <Input
                          id="logo-url"
                          value={customerDetails.branding?.logo_url || ''}
                          onChange={(e) => setCustomerDetails({
                            ...customerDetails,
                            branding: {...customerDetails.branding, logo_url: e.target.value}
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
                          value={customerDetails.agent?.website_url || ''}
                          onChange={(e) => setCustomerDetails({
                            ...customerDetails,
                            agent: {...customerDetails.agent, website_url: e.target.value}
                          })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="forward-number">Forward Number</Label>
                        <Input
                          id="forward-number"
                          value={customerDetails.agent?.forward_number || ''}
                          onChange={(e) => setCustomerDetails({
                            ...customerDetails,
                            agent: {...customerDetails.agent, forward_number: e.target.value}
                          })}
                        />
                      </div>
                      <div>
                        <Label htmlFor="greeting">Agent Greeting</Label>
                        <Textarea
                          id="greeting"
                          value={customerDetails.agent?.greeting || ''}
                          onChange={(e) => setCustomerDetails({
                            ...customerDetails,
                            agent: {...customerDetails.agent, greeting: e.target.value}
                          })}
                        />
                      </div>
                    </div>
                  </TabsContent>
                </Tabs>
                
                <div className="flex justify-end gap-2 pt-4 border-t">
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