import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function MFASection() {
  const [enrolled, setEnrolled] = useState<{id:string}[]>([]);
  const [loading, setLoading] = useState(false);
  const [qr, setQr] = useState<string|undefined>();
  const [factorId, setFactorId] = useState<string|undefined>();
  const [code, setCode] = useState("");

  async function refresh() {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (!error) {
      setEnrolled((data?.all ?? []).filter((f:any)=> f?.factor_type === "totp"));
    }
  }

  useEffect(()=> { refresh(); },[]);

  async function startEnroll(){
    setLoading(true); setQr(undefined); setFactorId(undefined);
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    setLoading(false);
    if (error) { alert(error.message); return; }
    setQr(data.totp.qr_code);
    setFactorId(data.id);
  }

  async function verify(){
    if(!factorId) return;
    setLoading(true);
    const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
    if (chErr) { setLoading(false); alert(chErr.message); return; }
    const { error } = await supabase.auth.mfa.verify({ factorId, code, challengeId: challenge.id });
    setLoading(false);
    if (error) { alert(error.message); return; }
    setQr(undefined); setFactorId(undefined); setCode("");
    await refresh();
    alert("MFA enabled!");
  }

  async function disable(fid:string){
    if(!confirm("Disable MFA for this device?")) return;
    const { error } = await supabase.auth.mfa.unenroll({ factorId: fid });
    if (error) { alert(error.message); return; }
    await refresh();
  }

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader><CardTitle>Multi‑Factor Authentication (TOTP)</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {enrolled.length > 0 ? (
          <div className="space-y-2">
            <div className="text-sm">Enabled on <b>{enrolled.length}</b> device(s).</div>
            <div className="flex flex-wrap gap-2">
              {enrolled.map((f)=> (
                <Button key={f.id} variant="outline" className="rounded-2xl" onClick={()=> disable(f.id)}>Disable device {f.id.slice(0,6)}…</Button>
              ))}
            </div>
          </div>
        ) : (
          <div className="text-sm text-slate-600">MFA is not enabled.</div>
        )}

        {!qr ? (
          <Button onClick={startEnroll} disabled={loading} className="rounded-2xl">
            {loading ? "Starting…" : (enrolled.length>0? "Enroll another device":"Enable MFA")}
          </Button>
        ) : (
          <div className="grid md:grid-cols-2 gap-4 items-start">
            <div>
              <div className="text-sm mb-2">Scan with Google Authenticator, 1Password, etc., then enter the 6‑digit code.</div>
              <img src={qr} alt="TOTP QR" className="w-48 h-48 border rounded-xl" />
            </div>
            <div className="space-y-2">
              <Input placeholder="123456" value={code} onChange={(e)=> setCode(e.target.value)} />
              <Button onClick={verify} disabled={loading || !code} className="rounded-2xl">{loading? "Verifying…":"Verify & Enable"}</Button>
              <Button onClick={()=> { setQr(undefined); setFactorId(undefined); setCode(""); }} variant="outline" className="rounded-2xl">Cancel</Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
