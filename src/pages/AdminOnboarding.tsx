import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { createTenant, adminControl, searchNumbers, purchaseNumber } from "@/lib/admin";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useToast } from "@/components/ui/use-toast";

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

  useEffect(()=>{ (async()=>{
    const { data } = await supabase.auth.getUser();
    if (data.user?.id) setUserId(data.user.id);
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

  return (
    <div className="max-w-5xl mx-auto p-6 space-y-4">
      <Card className="rounded-2xl">
        <CardHeader><CardTitle className="text-center">Admin Onboarding Dashboard</CardTitle></CardHeader>
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

              <TabsContent value="knowledge" className="pt-4">
                <p className="text-sm mb-2">Open the Knowledge Trainer to ingest site & docs.</p>
                <Button onClick={()=>window.location.hash="#admin/knowledge"}>Open Knowledge Trainer</Button>
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