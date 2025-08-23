import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/components/ui/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { searchNumbers, purchaseNumber } from '@/lib/admin';
import { Phone, Search, ShoppingCart, Loader2 } from 'lucide-react';

interface PhoneNumberPanelProps {
  tenantId: string;
}

interface PhoneNumber {
  phoneNumber: string;
  locality: string;
  region: string;
  friendlyName: string;
}

export default function PhoneNumberPanel({ tenantId }: PhoneNumberPanelProps) {
  const { toast } = useToast();
  const [currentNumber, setCurrentNumber] = useState<string>('');
  const [availableNumbers, setAvailableNumbers] = useState<PhoneNumber[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [purchaseLoading, setPurchaseLoading] = useState<string>('');
  const [searchParams, setSearchParams] = useState({
    country: 'US',
    areaCode: ''
  });

  useEffect(() => {
    loadCurrentNumber();
  }, [tenantId]);

  const loadCurrentNumber = async () => {
    try {
      const { data, error } = await supabase
        .from('agent_settings')
        .select('twilio_number')
        .eq('tenant_id', tenantId)
        .maybeSingle();

      if (error && error.code !== 'PGRST116') throw error;
      setCurrentNumber(data?.twilio_number || '');
    } catch (error) {
      console.error('Error loading current number:', error);
    }
  };

  const handleSearchNumbers = async () => {
    try {
      setSearchLoading(true);
      const data = await searchNumbers(searchParams);
      setAvailableNumbers(data.availablePhoneNumbers || []);
      
      if (data.availablePhoneNumbers?.length === 0) {
        toast({
          title: "No Numbers Found",
          description: "Try searching with a different area code",
          variant: "destructive"
        });
      }
    } catch (error) {
      console.error('Error searching numbers:', error);
      toast({
        title: "Search Error",
        description: "Failed to search for phone numbers",
        variant: "destructive"
      });
    } finally {
      setSearchLoading(false);
    }
  };

  const handlePurchaseNumber = async (phoneNumber: string) => {
    try {
      setPurchaseLoading(phoneNumber);
      
      await purchaseNumber({
        phoneNumber,
        tenantId,
        projectBase: 'https://gnqqktmslswgjtvxfvdo.supabase.co'
      });

      // Update agent_settings with the new number
      const { error } = await supabase
        .from('agent_settings')
        .upsert({
          tenant_id: tenantId,
          twilio_number: phoneNumber,
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'tenant_id'
        });

      if (error) throw error;

      setCurrentNumber(phoneNumber);
      setAvailableNumbers([]);
      
      toast({
        title: "Number Purchased",
        description: `Successfully purchased ${phoneNumber}`,
      });
    } catch (error) {
      console.error('Error purchasing number:', error);
      toast({
        title: "Purchase Error",
        description: "Failed to purchase phone number",
        variant: "destructive"
      });
    } finally {
      setPurchaseLoading('');
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Phone className="h-5 w-5" />
          Phone Number Management
        </CardTitle>
        <CardDescription>
          Assign a Twilio phone number for voice calls
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Current Number */}
        <div>
          <Label>Current Phone Number</Label>
          <div className="flex items-center gap-2 mt-2">
            {currentNumber ? (
              <Badge variant="default" className="text-base px-3 py-1">
                {currentNumber}
              </Badge>
            ) : (
              <Badge variant="outline">No number assigned</Badge>
            )}
          </div>
        </div>

        {/* Search for Numbers */}
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label>Country</Label>
              <Select value={searchParams.country} onValueChange={(value) => 
                setSearchParams(prev => ({ ...prev, country: value }))
              }>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="US">United States</SelectItem>
                  <SelectItem value="CA">Canada</SelectItem>
                  <SelectItem value="GB">United Kingdom</SelectItem>
                </SelectContent>
              </Select>
            </div>
            
            <div>
              <Label>Area Code (Optional)</Label>
              <Input
                placeholder="e.g., 415"
                value={searchParams.areaCode}
                onChange={(e) => setSearchParams(prev => ({ ...prev, areaCode: e.target.value }))}
              />
            </div>
          </div>

          <Button 
            onClick={handleSearchNumbers} 
            disabled={searchLoading}
            className="w-full"
          >
            {searchLoading ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Searching...
              </>
            ) : (
              <>
                <Search className="h-4 w-4 mr-2" />
                Search Available Numbers
              </>
            )}
          </Button>
        </div>

        {/* Available Numbers */}
        {availableNumbers.length > 0 && (
          <div className="space-y-3">
            <Label>Available Numbers</Label>
            <div className="max-h-64 overflow-y-auto space-y-2">
              {availableNumbers.map((number) => (
                <div key={number.phoneNumber} className="flex items-center justify-between p-3 border rounded-lg">
                  <div>
                    <div className="font-medium">{number.phoneNumber}</div>
                    <div className="text-sm text-muted-foreground">
                      {number.locality}, {number.region}
                    </div>
                  </div>
                  <Button
                    size="sm"
                    onClick={() => handlePurchaseNumber(number.phoneNumber)}
                    disabled={!!purchaseLoading}
                  >
                    {purchaseLoading === number.phoneNumber ? (
                      <>
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Purchasing...
                      </>
                    ) : (
                      <>
                        <ShoppingCart className="h-4 w-4 mr-2" />
                        Purchase
                      </>
                    )}
                  </Button>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}