import { useState } from "react";
import { supabase } from "@/lib/supabaseClient";

export default function SignInScreen() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [stage, setStage] = useState("login"); // login -> mfa
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

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
    <div className="max-w-sm mx-auto p-6 bg-white rounded shadow">
      {stage === "login" && (
        <>
          <h2 className="text-lg font-bold mb-4">Sign in</h2>
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="border p-2 w-full mb-2"
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="border p-2 w-full mb-4"
          />
          {error && <p className="text-red-500 mb-2">{error}</p>}
          <button
            onClick={handleLogin}
            disabled={loading}
            className="bg-blue-500 text-white px-4 py-2 rounded w-full"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>
        </>
      )}

      {stage === "mfa" && (
        <>
          <h2 className="text-lg font-bold mb-4">Enter MFA Code</h2>
          <input
            type="text"
            placeholder="6-digit code"
            value={otp}
            onChange={(e) => setOtp(e.target.value)}
            className="border p-2 w-full mb-4"
          />
          {error && <p className="text-red-500 mb-2">{error}</p>}
          <button
            onClick={handleVerifyOtp}
            disabled={loading}
            className="bg-blue-500 text-white px-4 py-2 rounded w-full"
          >
            {loading ? "Verifying..." : "Verify Code"}
          </button>
        </>
      )}
    </div>
  );
}
