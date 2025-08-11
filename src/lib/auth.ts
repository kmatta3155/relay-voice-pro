import { supabase } from "./supabaseClient";

export async function signInWithEmail(email:string){
  const { error } = await supabase.auth.signInWithOtp({ email, options:{ emailRedirectTo: window.location.origin } });
  if (error) throw error;
  return true;
}
export async function signInWithGoogle(){
  const { error } = await supabase.auth.signInWithOAuth({ provider:"google", options:{ redirectTo: window.location.origin } });
  if (error) throw error;
  return true;
}
export async function signOut(){ await supabase.auth.signOut(); }

/* auth state helper */
export function onAuth(callback:(session:any)=>void){
  supabase.auth.onAuthStateChange((_e, session)=> callback(session));
}
