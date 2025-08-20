import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createTenant, adminControl, searchNumbers, purchaseNumber } from "@/lib/admin";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";
import { Progress } from "@/components/ui/progress";
import { ingestWebsite } from "@/lib/rag";
import { Zap, CheckCircle } from "lucide-react";

export default function AdminOnboarding(){
  const { toast } = useToast();
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [website, setWebsite] = useState("");
  const [greeting, setGreeting] = useState("");
  const [brandColor, setBrandColor] = useState("#6d28d9");
  const [logoUrl, setLogoUrl] = useState("");
  const [hours, setHours] = useState(Array.from({length:7},(_,i)=>({ dow:i, open:"09:00", close:"17:00" })));
  const [services, setServices] = useState([{ name:"Consultation", duration_minutes:30, price:0 }]);
  const [numbers, setNumbers] = useState<any[]>([]);
  const [pickedNumber, setPickedNumber] = useState<string>("");
  const [link, setLink] = useState<string>("");
  const [userId, setUserId] = useState<string>("");
  const [knowledgeUrl, setKnowledgeUrl] = useState("");
  const [knowledgeBusy, setKnowledgeBusy] = useState(false);
  const [extractionProgress, setExtractionProgress] = useState(0);
  const [businessInfo, setBusinessInfo] = useState<any>({});
  const [tenants, setTenants] = useState<any[]>([]);
  const [tenantsLoading, setTenantsLoading] = useState(false);

  useEffect(()=>{ (async()=>{
    const { data } = await supabase.auth.getUser();
    if (data.user?.id) setUserId(data.user.id);
    await loadTenants();
  })(); },[]);

  async function handleCreateTenant(){
    try {
      const res = await createTenant({ name, userId, website_url: website, greeting, brand_color: brandColor, logo_url: logoUrl });
      setTenantId(res.tenantId);
      toast({ title: "Tenant created", description: res.tenantId });
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  }
  
  async function saveBranding(){ 
    try {
      await adminControl({ action:"update_branding", tenantId, brand_color: brandColor, logo_url: logoUrl }); 
      toast({ title: "Branding saved" }); 
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  }
  
  async function saveHours(){ 
    try {
      await adminControl({ action:"upsert_hours", tenantId, hours }); 
      toast({ title: "Business hours saved" }); 
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  }
  
  async function saveServices(){ 
    try {
      await adminControl({ action:"upsert_services", tenantId, services }); 
      toast({ title: "Services saved" }); 
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  }
  
  async function findNumbers(){ 
    try {
      const res = await searchNumbers({ country:"US" }); 
      setNumbers(res.numbers || []); 
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  }
  
  async function buyNumber(){
    try {
      const base = (import.meta as any).env?.VITE_SUPABASE_URL?.replace(/\/rest\/v1.*$/,"/functions/v1") || "";
      const res = await purchaseNumber({ phoneNumber: pickedNumber, tenantId: tenantId!, projectBase: base });
      await adminControl({ action:"update_agent", tenantId, greeting, website_url: website });
      await supabase.from("agent_settings").update({ twilio_number: res.phoneNumber }).eq("tenant_id", tenantId);
      toast({ title: "Number purchased", description: res.phoneNumber });
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  }
  
  async function createInvite(email:string, role:"admin"|"manager"|"staff"){
    try {
      const { data, error } = await supabase.functions.invoke("admin-control", { body: { action: "invite", tenantId, email, role }});
      if (error) return toast({ title:"Invite error", description: error.message, variant:"destructive" });
      setLink(data?.link || ""); 
      toast({ title:"Invite created" });
    } catch (error) {
      toast({ title: "Error", description: String(error), variant: "destructive" });
    }
  }

  async function handleKnowledgeIngest() {
    if (!tenantId || !knowledgeUrl) return;
    setKnowledgeBusy(true);
    setExtractionProgress(0);
    
    try {
      // Simulate progress
      const progressInterval = setInterval(() => {
        setExtractionProgress(prev => Math.min(prev + 10, 90));
      }, 500);
      
      const result = await ingestWebsite(tenantId, knowledgeUrl);
      clearInterval(progressInterval);
      setExtractionProgress(100);
      
      // If we got business info, auto-populate hours and services
      if (result?.business_info) {
        setBusinessInfo(result.business_info);
        
        // Auto-populate business hours if available
        if (result.business_info.business_hours) {
          const autoHours = result.business_info.business_hours.map((h: any) => {
            const day = h.day?.toLowerCase();
            const dayIndex = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"].indexOf(day);
            if (dayIndex !== -1 && h.hours && h.hours !== "Closed") {
              const times = h.hours.split(" - ") || h.hours.split("-");
              if (times.length === 2) {
                return { dow: dayIndex, open: times[0].trim(), close: times[1].trim() };
              }
            }
            return { dow: dayIndex !== -1 ? dayIndex : 0, open: "09:00", close: "17:00" };
          });
          if (autoHours.length > 0) {
            setHours(autoHours);
          }
        }
        
        // Auto-populate services if available
        if (result.business_info.services) {
          const autoServices = result.business_info.services.map((service: string) => ({
            name: service,
            duration_minutes: 30,
            price: 0 // Will be updated if we can extract pricing
          }));
          setServices(autoServices);
        }
        
        toast({ 
          title: "Knowledge ingested successfully", 
          description: "Business hours and services have been auto-populated. You can edit them in their respective tabs." 
        });
      }
      
      setKnowledgeUrl("");
      setTimeout(() => setExtractionProgress(0), 2000);
    } catch (e) {
      setExtractionProgress(0);
      console.error("Knowledge ingestion failed:", e);
      toast({ 
        title: "Ingestion failed", 
        description: e instanceof Error ? e.message : "Failed to ingest website",
        variant: "destructive"
      });
    } finally {
      setKnowledgeBusy(false);
    }
  }

  async function loadTenants(){
    try {
      setTenantsLoading(true);
      const { data, error } = await supabase.functions.invoke("tenants-admin", { body: { action: "list" } });
      if (error) throw error;
      setTenants(data?.tenants || []);
    } catch (err:any) {
      toast({ title: "Error loading tenants", description: err.message || String(err), variant: "destructive" });
    } finally {
      setTenantsLoading(false);
    }
  }

  function timeStr(t?: string){
    if (!t) return "";
    return t.slice(0,5);
  }

  async function openTenant(id: string){
    try {
      const { data, error } = await supabase.functions.invoke("tenants-admin", { body: { action: "details", tenantId: id }});
      if (error) throw error;
      setTenantId(id);
      setGreeting(data?.agent?.greeting || "");
      setWebsite(data?.agent?.website_url || "");
      if (data?.branding) {
        setBrandColor(data.branding.brand_color || "#6d28d9");
        setLogoUrl(data.branding.logo_url || "");
      }
      if (Array.isArray(data?.hours)) {
        setHours(data.hours.map((h:any)=>({ dow: h.dow, open: timeStr(h.open_time), close: timeStr(h.close_time) })));
      }
      if (Array.isArray(data?.services)) {
        setServices(data.services.map((s:any)=>({ id: s.id, name: s.name, duration_minutes: s.duration_minutes, price: s.price })));
      }
      toast({ title: "Tenant loaded", description: "You can now edit configuration in tabs." });
    } catch (err:any) {
      toast({ title: "Failed to open tenant", description: err.message || String(err), variant: "destructive" });
    }
  }

  async function deleteTenant(id: string){
    try {
      if (!window.confirm("Delete this tenant and all its data? This cannot be undone.")) return;
      const { error } = await supabase.functions.invoke("tenants-admin", { body: { action: "delete", tenantId: id }});
      if (error) throw error;
      if (tenantId === id) setTenantId(null);
      await loadTenants();
      toast({ title: "Tenant deleted" });
    } catch (err:any) {
      toast({ title: "Failed to delete tenant", description: err.message || String(err), variant: "destructive" });
    }
  }

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
        <Card className="rounded-2xl">
          <CardHeader><CardTitle className="text-center">Tenant Onboarding Dashboard</CardTitle></CardHeader>
        <CardContent className="space-y-6">
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="text-sm">Business name *</label><Input value={name} onChange={e=>setName(e.target.value)} placeholder="Acme Dental"/></div>
            <div><label className="text-sm">Website URL</label><Input value={website} onChange={e=>setWebsite(e.target.value)} placeholder="https://acme.example"/></div>
            <div className="md:col-span-2"><label className="text-sm">Phone greeting</label><Input value={greeting} onChange={e=>setGreeting(e.target.value)} placeholder="Thanks for calling Acme Dental!"/></div>
            <div><label className="text-sm">Brand color</label><Input type="color" value={brandColor} onChange={e=>setBrandColor(e.target.value)}/></div>
            <div><label className="text-sm">Logo URL</label><Input value={logoUrl} onChange={e=>setLogoUrl(e.target.value)} placeholder="https://..."/></div>
          </div>
          <Button onClick={handleCreateTenant} disabled={!name || !userId}>Create Tenant</Button>
          {tenantId && <div className="text-xs text-zinc-500">Tenant ID: {tenantId}</div>}
        </CardContent>
      </Card>

      {tenantId && (
        <Card className="rounded-2xl">
          <CardHeader><CardTitle>Configure</CardTitle></CardHeader>
          <CardContent>
            <Tabs defaultValue="branding">
              <TabsList className="flex flex-wrap gap-2">
                <TabsTrigger value="branding">Branding</TabsTrigger>
                <TabsTrigger value="hours">Hours</TabsTrigger>
                <TabsTrigger value="services">Services</TabsTrigger>
                <TabsTrigger value="number">Number & Agent</TabsTrigger>
                <TabsTrigger value="knowledge">Knowledge</TabsTrigger>
                <TabsTrigger value="team">Team</TabsTrigger>
                <TabsTrigger value="launch">Launch</TabsTrigger>
              </TabsList>

              <TabsContent value="branding" className="pt-4">
                <div className="grid md:grid-cols-2 gap-4">
                  <div><label className="text-sm">Brand color</label><Input type="color" value={brandColor} onChange={e=>setBrandColor(e.target.value)}/></div>
                  <div><label className="text-sm">Logo URL</label><Input value={logoUrl} onChange={e=>setLogoUrl(e.target.value)}/></div>
                </div>
                <div className="mt-3"><Button onClick={saveBranding}>Save branding</Button></div>
              </TabsContent>

              <TabsContent value="hours" className="pt-4 space-y-3">
                {hours.map((h,i)=>(
                  <div key={i} className="flex gap-2 items-center">
                    <div className="w-24 text-sm">{["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][h.dow]}</div>
                    <Input className="w-32" value={h.open} onChange={e=>setHours(prev=>prev.map((x,ix)=>ix===i?{...x,open:e.target.value}:x))}/>
                    <span className="text-sm">to</span>
                    <Input className="w-32" value={h.close} onChange={e=>setHours(prev=>prev.map((x,ix)=>ix===i?{...x,close:e.target.value}:x))}/>
                  </div>
                ))}
                <Button onClick={saveHours}>Save hours</Button>
              </TabsContent>

              <TabsContent value="services" className="pt-4 space-y-3">
                {services.map((s, i)=>(
                  <div key={i} className="grid md:grid-cols-3 gap-2">
                    <Input value={s.name} onChange={e=>setServices(prev=>prev.map((x,ix)=>ix===i?{...x,name:e.target.value}:x))} placeholder="Service name"/>
                    <Input type="number" value={s.duration_minutes} onChange={e=>setServices(prev=>prev.map((x,ix)=>ix===i?{...x,duration_minutes:parseInt(e.target.value)}:x))} placeholder="Duration (min)"/>
                    <Input type="number" value={s.price ?? 0} onChange={e=>setServices(prev=>prev.map((x,ix)=>ix===i?{...x,price:parseFloat(e.target.value)}:x))} placeholder="Price"/>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={()=>setServices(prev=>[...prev, { name:"New Service", duration_minutes:30, price:0 }])}>Add service</Button>
                  <Button onClick={saveServices}>Save services</Button>
                </div>
              </TabsContent>

              <TabsContent value="number" className="pt-4 space-y-3">
                <div className="flex gap-2">
                  <Button onClick={findNumbers}>Search available numbers</Button>
                </div>
                <div className="grid md:grid-cols-3 gap-2">
                  {numbers.map((n:any)=>(
                    <button key={n.phone_number} onClick={()=>setPickedNumber(n.phone_number)} className={"p-2 border rounded-xl text-left " + (pickedNumber===n.phone_number?"border-violet-500 ring-2 ring-violet-200":"")}>
                      <div className="font-medium">{n.friendly_name}</div>
                      <div className="text-xs text-zinc-500">{n.phone_number}</div>
                    </button>
                  ))}
                </div>
                <Button disabled={!pickedNumber} onClick={buyNumber}>Purchase & configure webhooks</Button>
              </TabsContent>

              <TabsContent value="knowledge" className="pt-4 space-y-4">
                <div className="space-y-4">
                  <div>
                    <label className="text-sm font-medium flex items-center gap-2">
                      <CheckCircle className="h-4 w-4 text-green-500" />
                      Business Website URL
                    </label>
                    <Input 
                      placeholder="https://example.com" 
                      value={knowledgeUrl} 
                      onChange={(e)=> setKnowledgeUrl(e.target.value)}
                      className="mt-1"
                    />
                    <div className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                      <Zap className="h-3 w-3" />
                      AI extracts business hours, services, contact info, and creates smart knowledge chunks
                    </div>
                  </div>
                  
                  <Button 
                    disabled={!knowledgeUrl || knowledgeBusy} 
                    onClick={handleKnowledgeIngest} 
                    className="w-full"
                  >
                    {knowledgeBusy ? "AI Processing..." : "Analyze & Ingest Website"}
                  </Button>

                  {extractionProgress > 0 && (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-sm">
                        <Zap className="h-4 w-4 text-primary animate-pulse" />
                        AI extracting business intelligence...
                      </div>
                      <Progress value={extractionProgress} className="h-2" />
                    </div>
                  )}

                  {businessInfo.business_hours && (
                    <div className="p-3 bg-green-50 dark:bg-green-950/20 rounded-lg">
                      <div className="text-sm font-medium text-green-800 dark:text-green-200 mb-1">
                        ✓ Business hours extracted and auto-populated
                      </div>
                      <div className="text-xs text-green-600 dark:text-green-300">
                        Check the "Hours" tab to review and customize
                      </div>
                    </div>
                  )}

                  {businessInfo.services && (
                    <div className="p-3 bg-blue-50 dark:bg-blue-950/20 rounded-lg">
                      <div className="text-sm font-medium text-blue-800 dark:text-blue-200 mb-1">
                        ✓ Services extracted and auto-populated
                      </div>
                      <div className="text-xs text-blue-600 dark:text-blue-300">
                        Check the "Services" tab to review, add prices, and customize
                      </div>
                    </div>
                  )}
                </div>
              </TabsContent>

              <TabsContent value="team" className="pt-4">
                <InviteTeam onCreate={createInvite} link={link}/>
              </TabsContent>

              <TabsContent value="launch" className="pt-4 space-y-3">
                <p className="text-sm">Optionally seed demo data and go live.</p>
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={async ()=>{ 
                    try {
                      await supabase.functions.invoke("seed-demo", { body: { tenantId } }); 
                      toast({ title: "Demo data seeded" });
                    } catch (error) {
                      toast({ title: "Error", description: String(error), variant: "destructive" });
                    }
                  }}>Seed Demo</Button>
                  <Button onClick={()=> window.location.href="/overview"}>Go to Dashboard</Button>
                </div>
              </TabsContent>

            </Tabs>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function InviteTeam({ onCreate, link }:{ onCreate:(email:string,role:"admin"|"manager"|"staff")=>void; link:string }){
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin"|"manager"|"staff">("manager");
  return (
    <div className="space-y-3">
      <div className="grid md:grid-cols-3 gap-2">
        <div className="md:col-span-2">
          <label className="text-sm">Email</label>
          <Input value={email} onChange={e=>setEmail(e.target.value)} placeholder="teammate@company.com"/>
        </div>
        <div>
          <label className="text-sm">Role</label>
          <select className="w-full border rounded-md h-10 px-2" value={role} onChange={e=>setRole(e.target.value as any)}>
            <option value="admin">Admin</option>
            <option value="manager">Manager</option>
            <option value="staff">Staff</option>
          </select>
        </div>
      </div>
      <div className="flex gap-2">
        <Button onClick={()=> onCreate(email, role)} disabled={!email}>Create invite</Button>
        {link && <Button type="button" variant="secondary" onClick={()=>navigator.clipboard.writeText(link)}>Copy invite link</Button>}
      </div>
      {link && <div className="text-xs text-zinc-500 break-all">{link}</div>}
    </div>
  );
}