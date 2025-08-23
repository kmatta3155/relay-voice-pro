import React, { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { Building2, Users, Settings, Search, Plus } from 'lucide-react';

import CustomerManagementDashboard from './CustomerManagementDashboard';

export function CustomerManagement() {
  const { toast } = useToast();
  const [customers, setCustomers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  
  const [selectedCustomer, setSelectedCustomer] = useState<string | null>(null);

  useEffect(() => {
    loadCustomers();
  }, []);

  const loadCustomers = async () => {
    try {
      setLoading(true);
      const { data, error } = await supabase
        .from('tenants')
        .select(`
          id,
          name,
          slug,
          created_at,
          subscription_status,
          stripe_customer_id
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;

      setCustomers(data || []);
    } catch (error) {
      console.error('Error loading customers:', error);
      toast({
        title: "Error",
        description: "Failed to load customers",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  const q = searchTerm.toLowerCase().trim();
  const filteredCustomers = customers.filter((customer) => {
    const name = (customer?.name ?? '').toLowerCase();
    const slug = (customer?.slug ?? '').toLowerCase();
    return q === '' || name.includes(q) || slug.includes(q);
  });


  if (selectedCustomer) {
    return (
      <CustomerManagementDashboard 
        tenantId={selectedCustomer} 
        onBack={() => setSelectedCustomer(null)} 
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Customer Management</h1>
          <p className="text-muted-foreground">Manage all your customers and their AI agents</p>
        </div>
        <Button onClick={() => window.location.href = '/admin/onboarding'} className="flex items-center gap-2">
          <Plus className="h-4 w-4" />
          Add New Customer
        </Button>
      </div>

      {/* Search */}
      <div className="flex items-center gap-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search customers..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="pl-10"
          />
        </div>
      </div>

      {/* Customer List */}
      {loading ? (
        <div className="text-center py-8">
          <div className="text-muted-foreground">Loading customers...</div>
        </div>
      ) : filteredCustomers.length === 0 ? (
        <Card>
          <CardContent className="text-center py-12">
            <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No Customers Found</h3>
            <p className="text-muted-foreground mb-4">
              {searchTerm ? 'No customers match your search.' : 'Get started by adding your first customer.'}
            </p>
            {!searchTerm && (
              <Button onClick={() => window.location.href = '/admin/onboarding'}>
                <Plus className="h-4 w-4 mr-2" />
                Add First Customer
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredCustomers.map((customer) => (
            <Card key={customer.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-lg">{customer.name}</CardTitle>
                  <div className="text-xs text-muted-foreground">
                    {customer.subscription_status || 'Free'}
                  </div>
                </div>
                <CardDescription>
                  Slug: {customer.slug}
                </CardDescription>
              </CardHeader>
              <CardContent className="pt-0">
                <div className="space-y-3">
                  <div className="flex items-center text-sm text-muted-foreground">
                    <Users className="h-4 w-4 mr-2" />
                    Created: {customer.created_at ? new Date(customer.created_at).toLocaleDateString() : '—'}
                  </div>

                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setSelectedCustomer(customer.id)}
                      className="flex-1"
                    >
                      <Settings className="h-4 w-4 mr-2" />
                      Manage
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export default CustomerManagement;