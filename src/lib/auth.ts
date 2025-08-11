import { supabase } from "./supabaseClient";

export async function signInWithEmail(email:string){
  const redirect = `${window.location.origin}/#app`;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirect }
  });
  if (error) throw error;
  return true;
}

export async function signInWithGoogle(){
  const redirect = `${window.location.origin}/#app`;
  const { error } = await supabase.auth.signInWithOAuth({
    provider:"google",
    options:{ redirectTo: redirect }
  });
  if (error) throw error;
  return true;
}

export async function signOut(){ await supabase.auth.signOut(); }

export function onAuth(callback:(session:any)=>void){
  supabase.auth.onAuthStateChange((_e, session)=> callback(session));
}
