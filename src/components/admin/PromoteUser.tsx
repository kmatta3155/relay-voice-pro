import React, { useState } from "react";
import { promoteUserToAdmin } from "@/lib/admin";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

export default function PromoteUser() {
  const [email, setEmail] = useState("ramakrismatta@gmail.com");
  const [role, setRole] = useState("admin");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handlePromote = async () => {
    if (!email) {
      toast({
        title: "Error",
        description: "Please enter an email address",
        variant: "destructive"
      });
      return;
    }

    setLoading(true);
    try {
      const result = await promoteUserToAdmin(email, role);
      console.log("Promotion result:", result);
      
      toast({
        title: "Success",
        description: result.message || `User ${email} has been promoted to ${role}`,
      });
      
    } catch (error: any) {
      console.error("Error promoting user:", error);
      toast({
        title: "Error",
        description: error.message || "Failed to promote user",
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 bg-white rounded-xl border">
      <h3 className="text-lg font-semibold mb-4">Promote User to Admin</h3>
      
      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2">Email</label>
          <Input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="user@example.com"
          />
        </div>
        
        <div>
          <label className="block text-sm font-medium mb-2">Role</label>
          <select 
            value={role} 
            onChange={(e) => setRole(e.target.value)}
            className="w-full border rounded-xl px-3 py-2"
          >
            <option value="admin">Admin</option>
            <option value="owner">Owner</option>
            <option value="manager">Manager</option>
          </select>
        </div>
        
        <Button 
          onClick={handlePromote} 
          disabled={loading}
          className="w-full"
        >
          {loading ? "Promoting..." : `Promote to ${role}`}
        </Button>
      </div>
    </div>
  );
}