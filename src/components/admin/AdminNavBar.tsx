import React from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/components/ui/use-toast';

interface AdminNavBarProps {
  customerName?: string;
}

export default function AdminNavBar({ customerName }: AdminNavBarProps) {
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleBackToAdmin = async () => {
    try {
      // Clear active tenant to return to admin mode
      const { data: user } = await supabase.auth.getUser();
      if (user.user) {
        await supabase
          .from('profiles')
          .update({ active_tenant_id: null })
          .eq('id', user.user.id);
      }
      
      navigate('/admin');
      
      toast({
        title: "Returned to Admin",
        description: "You're back in admin mode"
      });
    } catch (error) {
      console.error('Error returning to admin:', error);
      navigate('/admin');
    }
  };

  return (
    <div className="border-b bg-orange-50 px-4 py-2 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <Badge variant="outline" className="bg-orange-100 text-orange-800 border-orange-300">
          Admin View
        </Badge>
        {customerName && (
          <span className="text-sm text-muted-foreground">
            Viewing as: <span className="font-medium">{customerName}</span>
          </span>
        )}
      </div>
      
      <Button 
        variant="outline" 
        size="sm" 
        onClick={handleBackToAdmin}
        className="flex items-center gap-2"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to Admin
      </Button>
    </div>
  );
}