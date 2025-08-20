import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

export default function AcceptInvite(){
  const [status, setStatus] = useState<"idle"|"working"|"done"|"error">("idle");
  const [error, setError] = useState<string>("");

  useEffect(() => { (async () => {
    const params = new URLSearchParams(window.location.search);
    const token = params.get("token");
    if (!token) { 
      setError("Missing token"); 
      setStatus("error"); 
      return; 
    }
    
    setStatus("working");
    
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) { 
      setError("Please sign in, then reopen this link."); 
      setStatus("error"); 
      return; 
    }
    
    try {
      const { data, error: fnErr } = await supabase.functions.invoke("invite-accept", { 
        body: { token, userId: u.user.id }
      });
      
      if (fnErr) { 
        setError(fnErr.message); 
        setStatus("error"); 
        return; 
      }
      
      if (!data.ok) {
        setError(data.error || "Unknown error");
        setStatus("error");
        return;
      }
      
      setStatus("done"); 
      setTimeout(()=>{ 
        window.location.href="/overview"; 
      }, 1200);
    } catch (err) {
      setError(String(err));
      setStatus("error");
    }
  })(); }, []);

  return (
    <div className="max-w-xl mx-auto p-6">
      <Card className="rounded-2xl">
        <CardHeader><CardTitle>Accepting invite…</CardTitle></CardHeader>
        <CardContent>
          {status==="working" && <div className="text-sm">Linking your account…</div>}
          {status==="done" && <div className="text-emerald-600 text-sm">Invite accepted! Redirecting…</div>}
          {status==="error" && (
            <div className="space-y-2">
              <div className="text-rose-600 text-sm">{error}</div>
              <Button onClick={()=>window.location.reload()}>Retry</Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}