// src/pages/Auth.tsx
// Simple email-based authentication page using Supabase magic links. Update as needed
// to support your preferred auth method. After sign-in, users are redirected to
// the dashboard.

import React, { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

export default function AuthPage() {
  const [email, setEmail] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [message, setMessage] = useState<string | null>(null);

  const signIn = async () => {
    setLoading(true);
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: `${window.location.origin}/dashboard` } });
    setLoading(false);
    if (error) {
      setMessage(error.message);
    } else {
      setMessage("Check your email for a magic link to sign in.");
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="max-w-sm w-full space-y-4">
        <h1 className="text-xl font-semibold text-center">Sign In</h1>
        {message && <p className="text-sm text-center text-muted-foreground">{message}</p>}
        <Input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Button disabled={loading} className="w-full" onClick={signIn}>
          {loading ? "Sending…" : "Send magic link"}
        </Button>
      </div>
    </div>
  );
}