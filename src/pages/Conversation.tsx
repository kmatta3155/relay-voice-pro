
import React, { useEffect, useState } from "react";
import { useParams } from "react-router";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";

export default function Conversation(){
  const [data, setData] = useState<any>(null);
  const callId = (window.location.hash || "").split("/")[1];

  useEffect(()=>{
    (async ()=>{
      if (!callId) return;
      const { data: t } = await supabase.from("calls").select("*").eq("id", callId).single();
      setData(t);
    })();
  },[callId]);

  if (!callId) return <div className="p-4">No call selected.</div>;

  return (
    <div className="space-y-4">
      <Card className="rounded-2xl"><CardHeader><CardTitle>Call {callId}</CardTitle></CardHeader>
      <CardContent>
        <pre className="text-sm whitespace-pre-wrap">{data?.transcript || "—"}</pre>
      </CardContent></Card>
      <Card className="rounded-2xl"><CardHeader><CardTitle>Entities</CardTitle></CardHeader>
      <CardContent>
        <pre className="text-sm">{JSON.stringify(data?.call_entities || [], null, 2)}</pre>
      </CardContent></Card>
    </div>
  );
}
