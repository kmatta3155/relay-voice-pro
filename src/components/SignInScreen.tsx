import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabaseClient";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState<"login" | "mfa">("login");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    document.title = "Sign in | RelayAI Receptionist";
  }, []);

  const handleLogin = async () => {
    setLoading(true);
    setError("");
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    if (data?.user?.factors?.length) {
      setStage("mfa");
    } else {
      window.location.href = "/dashboard";
    }
  };

  const handleVerifyOtp = async () => {
    setLoading(true);
    setError("");
    const { error } = await (supabase.auth as any).verifyOtp({
      type: "totp",
      token: otp,
    });
    setLoading(false);

    if (error) {
      setError(error.message);
      return;
    }

    window.location.href = "/dashboard";
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
