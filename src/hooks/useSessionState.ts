import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { onAuth } from "@/lib/auth";

export function useSessionState(){
  const [session,setSession]=useState<any>(null);
  useEffect(()=>{ (async()=>{ const { data } = await supabase.auth.getSession(); setSession(data.session); onAuth((s)=> setSession(s)); })(); },[]);
  return session;
}
