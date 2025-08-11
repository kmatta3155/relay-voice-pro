import { supabase } from "./supabaseClient";

/** ---------- Magic link (email OTP) ---------- */
export async function signInWithEmail(email: string) {
  const redirect = `${window.location.origin}/#app`;
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: redirect }
  });
  if (error) throw error;
  return true;
}

/** ---------- Email + Password ---------- */
export async function signUpWithPassword(email: string, password: string, meta?: Record<string, any>) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: meta || {}, emailRedirectTo: `${window.location.origin}/#app` }
  });
  if (error) throw error;
  return data.user;
}
export async function signInWithPassword(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.session;
}

/** ---------- OAuth (Google, GitHub, Microsoft, Apple, Facebook, …) ---------- */
export async function signInWithOAuth(provider:
  "google" | "github" | "azure" | "bitbucket" | "gitlab" | "apple" | "facebook" | "keycloak" | "notion" | "slack" | "twitch" | "twitter" | "linkedin"
) {
  const redirect = `${window.location.origin}/#app`;
  const { error } = await supabase.auth.signInWithOAuth({ provider, options: { redirectTo: redirect } });
  if (error) throw error;
}

/** ---------- Phone OTP (SMS) ---------- */
export async function signInWithSms(phone: string) {
  // step 1: request OTP to phone
  const { error } = await supabase.auth.signInWithOtp({ phone });
  if (error) throw error;
}
export async function verifySms(phone: string, token: string) {
  // step 2: verify the OTP the user typed
  const { data, error } = await supabase.auth.verifyOtp({ phone, token, type: "sms" });
  if (error) throw error;
  return data.session;
}

/** ---------- MFA (TOTP) ---------- */
/* Requires: Auth > MFA toggled on in Supabase Dashboard */
export async function mfaEnrollTotp() {
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error) throw error;
  // data.totp.qr_code, data.totp.secret => show QR for user to scan in Authenticator app
  return data;
}
export async function mfaVerifyEnrollment(factorId: string, code: string) {
  const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
  if (chErr) throw chErr;
  const { data, error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
  if (error) throw error;
  return data;
}
export async function mfaChallenge(factorId: string) {
  const { data, error } = await supabase.auth.mfa.challenge({ factorId });
  if (error) throw error;
  return data; // data.id (challenge_id)
}
export async function mfaVerifyChallenge(factorId: string, code: string) {
  const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({ factorId });
  if (chErr) throw chErr;
  const { data, error } = await supabase.auth.mfa.verify({ factorId, challengeId: challenge.id, code });
  if (error) throw error;
  return data;
}

/** ---------- session helpers ---------- */
export async function signOut() { await supabase.auth.signOut(); }
export function onAuth(callback: (session: any) => void) {
  supabase.auth.onAuthStateChange((_e, session) => callback(session));
}
