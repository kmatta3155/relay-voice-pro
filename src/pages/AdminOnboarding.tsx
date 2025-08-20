import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createTenant, adminControl, searchNumbers, purchaseNumber, promoteUserToAdmin } from "@/lib/admin";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";

export default function AdminOnboarding() {
  const { toast } = useToast();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [greeting, setGreeting] = useState("");
  const [brandColor, setBrandColor] = useState("#6d28d9");
  const [logoUrl, setLogoUrl] = useState("");
  const [hours, setHours] = useState(
    Array.from({length: 7}, (_, i) => ({ dow: i, open: "09:00", close: "17:00" }))
  );
  const [services, setServices] = useState([
    { name: "Consultation", duration_minutes: 30, price: 0 }
  ]);
  const [numbers, setNumbers] = useState<any[]>([]);
  const [pickedNumber, setPickedNumber] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.auth.getUser();
      if (data.user?.id) setUserId(data.user.id);
    })();
  }, []);

  async function handleCreateTenant() {
    if (!name || !userId) return;
    
    setLoading(true);
    try {
      const res = await createTenant({ 
        name, 
        userId, 
        website_url: website, 
        greeting, 
        brand_color: brandColor, 
        logo_url: logoUrl 
      });
      setTenantId(res.tenantId);
      toast({ title: "Tenant created", description: `Tenant ID: ${res.tenantId}` });
    } catch (error) {
      toast({ 
        title: "Error creating tenant", 
        description: String(error),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }

  async function saveBranding() {
    if (!tenantId) return;
    
    setLoading(true);
    try {
      await adminControl({ 
        action: "update_branding", 
        tenantId, 
        brand_color: brandColor, 
        logo_url: logoUrl 
      });
      toast({ title: "Branding saved" });
    } catch (error) {
      toast({ 
        title: "Error saving branding", 
        description: String(error),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }

  async function saveHours() {
    if (!tenantId) return;
    
    setLoading(true);
    try {
      await adminControl({ action: "upsert_hours", tenantId, hours });
      toast({ title: "Business hours saved" });
    } catch (error) {
      toast({ 
        title: "Error saving hours", 
        description: String(error),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }

  async function saveServices() {
    if (!tenantId) return;
    
    setLoading(true);
    try {
      await adminControl({ action: "upsert_services", tenantId, services });
      toast({ title: "Services saved" });
    } catch (error) {
      toast({ 
        title: "Error saving services", 
        description: String(error),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }

  async function findNumbers() {
    setLoading(true);
    try {
      const res = await searchNumbers({ country: "US" });
      setNumbers(res.numbers || []);
      toast({ title: "Numbers loaded", description: `Found ${res.numbers?.length || 0} available numbers` });
    } catch (error) {
      toast({ 
        title: "Error searching numbers", 
        description: String(error),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }

  async function buyNumber() {
    if (!pickedNumber || !tenantId) return;
    
    setLoading(true);
    try {
      // Get the base URL for webhooks
      const base = `https://gnqqktmslswgjtvxfvdo.supabase.co/functions/v1`;
      
      const res = await purchaseNumber({ 
        phoneNumber: pickedNumber, 
        tenantId: tenantId, 
        projectBase: base 
      });
      
      // Update agent settings with the new number
      await adminControl({ 
        action: "update_agent", 
        tenantId, 
        greeting, 
        website_url: website 
      });
      
      // Update agent settings with Twilio number
      await supabase
        .from("agent_settings")
        .update({ twilio_number: res.phoneNumber })
        .eq("tenant_id", tenantId);
      
      toast({ 
        title: "Number purchased", 
        description: `Successfully purchased ${res.phoneNumber}` 
      });
    } catch (error) {
      toast({ 
        title: "Error purchasing number", 
        description: String(error),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted p-6">
      <div className="max-w-4xl mx-auto space-y-6">
        <Card className="border-primary/20 shadow-lg">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent">
              Admin Onboarding Dashboard
            </CardTitle>
            <p className="text-muted-foreground">Set up a new customer tenant with all necessary configurations</p>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="grid md:grid-cols-2 gap-4">
              <div>
                <label className="text-sm font-medium text-foreground">Business name *</label>
                <Input 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  placeholder="Acme Dental"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Website URL</label>
                <Input 
                  value={website} 
                  onChange={e => setWebsite(e.target.value)} 
                  placeholder="https://acme.example"
                  className="mt-1"
                />
              </div>
              <div className="md:col-span-2">
                <label className="text-sm font-medium text-foreground">Phone greeting</label>
                <Input 
                  value={greeting} 
                  onChange={e => setGreeting(e.target.value)} 
                  placeholder="Thanks for calling Acme Dental!"
                  className="mt-1"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Brand color</label>
                <Input 
                  type="color" 
                  value={brandColor} 
                  onChange={e => setBrandColor(e.target.value)}
                  className="mt-1 h-10"
                />
              </div>
              <div>
                <label className="text-sm font-medium text-foreground">Logo URL</label>
                <Input 
                  value={logoUrl} 
                  onChange={e => setLogoUrl(e.target.value)} 
                  placeholder="https://..."
                  className="mt-1"
                />
              </div>
            </div>
            <Button 
              onClick={handleCreateTenant} 
              disabled={!name || !userId || loading}
              className="w-full"
            >
              {loading ? "Creating..." : "Create Tenant"}
            </Button>
            {tenantId && (
              <div className="text-sm text-muted-foreground bg-muted p-3 rounded-lg">
                <strong>Tenant created:</strong> {tenantId}
              </div>
            )}
          </CardContent>
        </Card>

        {tenantId && (
          <Card className="border-primary/20 shadow-lg">
            <CardHeader>
              <CardTitle className="text-xl">Configuration Wizard</CardTitle>
            </CardHeader>
            <CardContent>
              <Tabs defaultValue="branding" className="w-full">
                <TabsList className="grid w-full grid-cols-7">
                  <TabsTrigger value="branding">Branding</TabsTrigger>
                  <TabsTrigger value="hours">Hours</TabsTrigger>
                  <TabsTrigger value="services">Services</TabsTrigger>
                  <TabsTrigger value="number">Number</TabsTrigger>
                  <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
                  <TabsTrigger value="team">Team</TabsTrigger>
                  <TabsTrigger value="launch">Launch</TabsTrigger>
                </TabsList>

                <TabsContent value="branding" className="space-y-4 mt-6">
                  <div className="grid md:grid-cols-2 gap-4">
                    <div>
                      <label className="text-sm font-medium">Brand color</label>
                      <Input 
                        type="color" 
                        value={brandColor} 
                        onChange={e => setBrandColor(e.target.value)}
                        className="mt-1 h-10"
                      />
                    </div>
                    <div>
                      <label className="text-sm font-medium">Logo URL</label>
                      <Input 
                        value={logoUrl} 
                        onChange={e => setLogoUrl(e.target.value)}
                        className="mt-1"
                      />
                    </div>
                  </div>
                  <Button onClick={saveBranding} disabled={loading}>
                    {loading ? "Saving..." : "Save Branding"}
                  </Button>
                </TabsContent>

                <TabsContent value="hours" className="space-y-4 mt-6">
                  {hours.map((h, i) => (
                    <div key={i} className="flex gap-3 items-center">
                      <div className="w-20 text-sm font-medium">
                        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][h.dow]}
                      </div>
                      <Input 
                        type="time"
                        value={h.open} 
                        onChange={e => setHours(prev => prev.map((x, ix) => 
                          ix === i ? {...x, open: e.target.value} : x
                        ))}
                        className="w-32"
                      />
                      <span className="text-sm text-muted-foreground">to</span>
                      <Input 
                        type="time"
                        value={h.close} 
                        onChange={e => setHours(prev => prev.map((x, ix) => 
                          ix === i ? {...x, close: e.target.value} : x
                        ))}
                        className="w-32"
                      />
                    </div>
                  ))}
                  <Button onClick={saveHours} disabled={loading}>
                    {loading ? "Saving..." : "Save Hours"}
                  </Button>
                </TabsContent>

                <TabsContent value="services" className="space-y-4 mt-6">
                  {services.map((s, i) => (
                    <div key={i} className="grid md:grid-cols-3 gap-3">
                      <Input 
                        value={s.name} 
                        onChange={e => setServices(prev => prev.map((x, ix) => 
                          ix === i ? {...x, name: e.target.value} : x
                        ))} 
                        placeholder="Service name"
                      />
                      <Input 
                        type="number" 
                        value={s.duration_minutes} 
                        onChange={e => setServices(prev => prev.map((x, ix) => 
                          ix === i ? {...x, duration_minutes: parseInt(e.target.value) || 0} : x
                        ))} 
                        placeholder="Duration (min)"
                      />
                      <Input 
                        type="number" 
                        value={s.price ?? 0} 
                        onChange={e => setServices(prev => prev.map((x, ix) => 
                          ix === i ? {...x, price: parseFloat(e.target.value) || 0} : x
                        ))} 
                        placeholder="Price"
                      />
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      onClick={() => setServices(prev => [...prev, { 
                        name: "New Service", 
                        duration_minutes: 30, 
                        price: 0 
                      }])}
                    >
                      Add Service
                    </Button>
                    <Button onClick={saveServices} disabled={loading}>
                      {loading ? "Saving..." : "Save Services"}
                    </Button>
                  </div>
                </TabsContent>

                <TabsContent value="number" className="space-y-4 mt-6">
                  <div className="flex gap-2">
                    <Button onClick={findNumbers} disabled={loading}>
                      {loading ? "Searching..." : "Search Available Numbers"}
                    </Button>
                  </div>
                  {numbers.length > 0 && (
                    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                      {numbers.map((n: any) => (
                        <button 
                          key={n.phone_number} 
                          onClick={() => setPickedNumber(n.phone_number)} 
                          className={`p-3 border rounded-xl text-left transition-all ${
                            pickedNumber === n.phone_number 
                              ? "border-primary ring-2 ring-primary/20 bg-primary/5" 
                              : "border-border hover:border-primary/50"
                          }`}
                        >
                          <div className="font-medium">{n.friendly_name}</div>
                          <div className="text-sm text-muted-foreground">{n.phone_number}</div>
                        </button>
                      ))}
                    </div>
                  )}
                  <Button 
                    disabled={!pickedNumber || loading} 
                    onClick={buyNumber}
                    className="w-full"
                  >
                    {loading ? "Purchasing..." : "Purchase & Configure Number"}
                  </Button>
                </TabsContent>

                <TabsContent value="knowledge" className="space-y-4 mt-6">
                  <p className="text-sm text-muted-foreground mb-4">
                    Use the existing Knowledge page to ingest website content and documents. 
                    This will train the AI receptionist with business-specific information.
                  </p>
                  <Button onClick={() => window.location.hash = "#admin/knowledge"}>
                    Open Knowledge Trainer
                  </Button>
                </TabsContent>

                <TabsContent value="team" className="space-y-4 mt-6">
                  <InviteTeam tenantId={tenantId} />
                </TabsContent>

                <TabsContent value="launch" className="space-y-4 mt-6">
                  <p className="text-sm text-muted-foreground">
                    Your tenant is now configured! You can optionally seed demo data or go live.
                  </p>
                  <div className="flex gap-2">
                    <Button 
                      variant="outline" 
                      onClick={async () => {
                        try {
                          await supabase.functions.invoke("seed-demo", { body: { tenantId } });
                          toast({ title: "Demo data seeded" });
                        } catch (error) {
                          toast({ 
                            title: "Error seeding demo", 
                            description: String(error),
                            variant: "destructive"
                          });
                        }
                      }}
                    >
                      Seed Demo Data
                    </Button>
                    <Button onClick={() => window.location.hash = "#overview"}>
                      Go to Dashboard
                    </Button>
                  </div>
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        )}

        {/* Quick User Promotion */}
        <Card className="border-primary/20 shadow-lg">
          <CardHeader>
            <CardTitle className="text-xl">Quick User Promotion</CardTitle>
          </CardHeader>
          <CardContent>
            <QuickPromoteUser />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function InviteTeam({ tenantId }: { tenantId: string }) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin"|"manager"|"staff">("manager");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();
  
  const handleInvite = async () => {
    if (!email) return;
    
    setLoading(true);
    try {
      await adminControl({ action: "invite", tenantId, email, role });
      setEmail("");
      toast({ title: "Invite sent", description: `${role} invite sent to ${email}` });
    } catch (error) {
      toast({ 
        title: "Error sending invite", 
        description: String(error),
        variant: "destructive"
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex gap-3 items-end">
        <div className="flex-1">
          <label className="text-sm font-medium">Email</label>
          <Input 
            value={email} 
            onChange={e => setEmail(e.target.value)} 
            placeholder="teammate@company.com"
            type="email"
            className="mt-1"
          />
        </div>
        <div className="w-40">
          <label className="text-sm font-medium">Role</label>
          <select 
            className="w-full border border-border rounded-md h-10 px-3 mt-1 bg-background" 
            value={role} 
            onChange={e => setRole(e.target.value as any)}
          >
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="staff">Staff</option>
          </select>
        </div>
        <Button onClick={handleInvite} disabled={loading || !email}>
          {loading ? "Inviting..." : "Send Invite"}
        </Button>
      </div>
    </div>
  );
}

function QuickPromoteUser() {
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
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-2">Email to promote</label>
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
        {loading ? "Promoting..." : `Promote ${email} to ${role}`}
      </Button>
    </div>
  );
}