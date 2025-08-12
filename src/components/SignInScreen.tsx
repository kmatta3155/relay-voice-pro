import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { signUpWithPassword } from "@/lib/auth";

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState<"login" | "mfa" | "signup" | "forgot">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState("");

  useEffect(() => {
    document.title = `${stage === "signup" ? "Create account" : "Sign in"} | RelayAI Receptionist`;
  }, [stage]);

  const handleLogin = async () => {
    setLoading(true);
    setError("");
    setOk("");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    if (data?.user?.factors?.length) {
      setStage("mfa");
    } else {
      location.hash = "#app";
    }
  };

  const handleVerifyOtp = async () => {
    setLoading(true);
    setError("");
    setOk("");
    const { error } = await (supabase.auth as any).verifyOtp({
      type: "totp",
      token: otp,
    });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    location.hash = "#app";
  };

  const handleSignUp = async () => {
    setLoading(true);
    setError("");
    setOk("");
    try {
      await signUpWithPassword(email, password);
      setOk("Account created. Check your email (if confirmation is enabled), then sign in.");
      setStage("login");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleForgot = async () => {
    setLoading(true);
    setError("");
    setOk("");
    try {
      const redirectTo = `${window.location.origin}/#signin`;
      const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
      if (error) throw error;
      setOk("Password reset email sent. Check your inbox for the link.");
      setStage("login");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className="min-h-screen bg-background grid place-items-center px-4 py-10">
      <Card className="w-full max-w-md">
        {stage === "login" && (
          <>
            <CardHeader>
              <CardTitle>Welcome back</CardTitle>
              <CardDescription>Sign in with your email and password.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertTitle>Sign in failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {ok && (
                <Alert>
                  <AlertTitle>Success</AlertTitle>
                  <AlertDescription>{ok}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="you@company.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                />
              </div>
              <Button onClick={handleLogin} disabled={loading} className="w-full">
                {loading ? "Signing in…" : "Sign in"}
              </Button>
              <div className="flex items-center justify-between text-sm">
                <button className="underline" onClick={() => { setStage("signup"); setError(""); setOk(""); }}>Create account</button>
                <button className="underline" onClick={() => { setStage("forgot"); setError(""); setOk(""); }}>Forgot password?</button>
              </div>
            </CardContent>
          </>
        )}

        {stage === "signup" && (
          <>
            <CardHeader>
              <CardTitle>Create your account</CardTitle>
              <CardDescription>Use your work email and a strong password.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertTitle>Sign up failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {ok && (
                <Alert>
                  <AlertTitle>Success</AlertTitle>
                  <AlertDescription>{ok}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="su-email">Email</Label>
                <Input id="su-email" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="su-password">Password</Label>
                <Input id="su-password" type="password" placeholder="••••••••" value={password} onChange={(e) => setPassword(e.target.value)} />
              </div>
              <Button onClick={handleSignUp} disabled={loading} className="w-full">
                {loading ? "Creating…" : "Create account"}
              </Button>
              <div className="text-sm text-muted-foreground">
                Already have an account? <button className="underline" onClick={() => { setStage("login"); setError(""); setOk(""); }}>Sign in</button>
              </div>
            </CardContent>
          </>
        )}

        {stage === "forgot" && (
          <>
            <CardHeader>
              <CardTitle>Reset your password</CardTitle>
              <CardDescription>We’ll email you a link to set a new password.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertTitle>Request failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              {ok && (
                <Alert>
                  <AlertTitle>Sent</AlertTitle>
                  <AlertDescription>{ok}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="fp-email">Email</Label>
                <Input id="fp-email" type="email" placeholder="you@company.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              </div>
              <Button onClick={handleForgot} disabled={loading} className="w-full">
                {loading ? "Sending…" : "Send reset link"}
              </Button>
              <div className="text-sm text-muted-foreground">
                Remembered your password? <button className="underline" onClick={() => { setStage("login"); setError(""); setOk(""); }}>Back to sign in</button>
              </div>
            </CardContent>
          </>
        )}

        {stage === "mfa" && (
          <>
            <CardHeader>
              <CardTitle>Multi‑factor authentication</CardTitle>
              <CardDescription>Enter the 6‑digit code from your authenticator app.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error && (
                <Alert variant="destructive">
                  <AlertTitle>Verification failed</AlertTitle>
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              )}
              <div className="space-y-2">
                <Label htmlFor="otp">Authenticator code</Label>
                <Input
                  id="otp"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  placeholder="123456"
                  value={otp}
                  onChange={(e) => setOtp(e.target.value)}
                />
              </div>
              <Button onClick={handleVerifyOtp} disabled={loading} className="w-full">
                {loading ? "Verifying…" : "Verify code"}
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </main>
  );
}
