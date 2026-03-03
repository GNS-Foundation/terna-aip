import React, { useState } from "react";

const mono = { fontFamily: "JetBrains Mono, monospace" };

export default function LoginScreen({ supabase, onLogin }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !supabase) return;
    setLoading(true);
    setError(null);

    try {
      const { error: authError } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: window.location.origin },
      });
      if (authError) throw authError;
      setSent(true);
    } catch (err) {
      setError(err.message || "Authentication failed");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      minHeight: "100vh", background: "#0A0F1A",
      display: "flex", alignItems: "center", justifyContent: "center",
      fontFamily: "DM Sans, sans-serif",
    }}>
      {/* Background grid */}
      <div style={{
        position: "fixed", inset: 0, opacity: 0.03,
        backgroundImage: "linear-gradient(#3B82F6 1px, transparent 1px), linear-gradient(90deg, #3B82F6 1px, transparent 1px)",
        backgroundSize: "40px 40px",
      }} />

      <div style={{ position: "relative", width: 420, padding: 20 }}>
        {/* Logo + branding */}
        <div style={{ textAlign: "center", marginBottom: 40 }}>
          <div style={{
            width: 64, height: 64, margin: "0 auto 16px",
            borderRadius: 16, background: "linear-gradient(135deg, #0A0F1A, #1E293B)",
            border: "1px solid #1E3A5F", display: "flex", alignItems: "center",
            justifyContent: "center", fontSize: 28,
          }}>
            <span role="img" aria-label="shield">&#x1F6E1;</span>
          </div>
          <div style={{
            fontSize: 24, fontWeight: 800, letterSpacing: -0.5,
            background: "linear-gradient(135deg, #00D4FF, #8B5CF6)",
            WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent",
          }}>
            GNS-AIP
          </div>
          <div style={{ fontSize: 11, color: "#4B5563", marginTop: 4, letterSpacing: 2, textTransform: "uppercase" }}>
            Compliance Dashboard
          </div>
        </div>

        {/* Login card */}
        <div style={{
          background: "#111827", border: "1px solid #1E293B", borderRadius: 12,
          padding: 32, boxShadow: "0 20px 60px rgba(0,0,0,0.5)",
        }}>
          {!sent ? (
            <>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#F1F5F9", marginBottom: 4 }}>
                Sign in
              </div>
              <div style={{ fontSize: 12, color: "#6B7280", marginBottom: 24 }}>
                Enter your email to receive a magic link
              </div>

              <div style={{ marginBottom: 16 }}>
                <label style={{ fontSize: 11, color: "#9CA3AF", display: "block", marginBottom: 6, ...mono }}>
                  Email address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@terna.it"
                  style={{
                    width: "100%", padding: "12px 14px", fontSize: 13,
                    background: "#0A0F1A", border: "1px solid #1E3A5F", borderRadius: 8,
                    color: "#F1F5F9", outline: "none", boxSizing: "border-box",
                    ...mono,
                  }}
                  onFocus={(e) => e.target.style.borderColor = "#3B82F6"}
                  onBlur={(e) => e.target.style.borderColor = "#1E3A5F"}
                />
              </div>

              {error && (
                <div style={{
                  padding: "8px 12px", marginBottom: 16, borderRadius: 6,
                  background: "rgba(239,68,68,0.1)", border: "1px solid #7F1D1D",
                  fontSize: 11, color: "#FCA5A5",
                }}>
                  {error}
                </div>
              )}

              <button
                onClick={handleSubmit}
                disabled={loading || !email}
                style={{
                  width: "100%", padding: "12px", fontSize: 13, fontWeight: 700,
                  background: loading ? "#1E293B" : "linear-gradient(135deg, #1E40AF, #3B82F6)",
                  border: "none", borderRadius: 8, color: "#F1F5F9",
                  cursor: loading ? "wait" : "pointer", transition: "all 0.2s",
                  opacity: !email ? 0.5 : 1,
                }}
              >
                {loading ? "Sending..." : "Send Magic Link"}
              </button>

              <div style={{ textAlign: "center", marginTop: 20 }}>
                <div style={{ fontSize: 10, color: "#374151", ...mono }}>
                  Powered by Supabase Auth + Ed25519
                </div>
              </div>
            </>
          ) : (
            <div style={{ textAlign: "center", padding: "16px 0" }}>
              <div style={{ fontSize: 36, marginBottom: 12 }}>
                <span role="img" aria-label="email">&#x2709;&#xFE0F;</span>
              </div>
              <div style={{ fontSize: 16, fontWeight: 700, color: "#10B981", marginBottom: 8 }}>
                Check your email
              </div>
              <div style={{ fontSize: 12, color: "#9CA3AF", marginBottom: 4 }}>
                Magic link sent to
              </div>
              <div style={{ fontSize: 13, color: "#F1F5F9", fontWeight: 600, ...mono }}>
                {email}
              </div>
              <div style={{ fontSize: 11, color: "#4B5563", marginTop: 16 }}>
                Click the link in the email to sign in.
              </div>
              <button
                onClick={() => { setSent(false); setEmail(""); }}
                style={{
                  marginTop: 20, padding: "8px 20px", fontSize: 11,
                  background: "transparent", border: "1px solid #1E3A5F",
                  borderRadius: 6, color: "#6B7280", cursor: "pointer",
                }}
              >
                Try a different email
              </button>
            </div>
          )}
        </div>

        {/* Footer */}
        <div style={{ textAlign: "center", marginTop: 24 }}>
          <div style={{ fontSize: 10, color: "#374151" }}>
            <span style={{ ...mono }}>GNS x Terna</span>
            {" | "}
            <span style={{ ...mono }}>Rete di Trasmissione Nazionale</span>
          </div>
          <div style={{ fontSize: 9, color: "#1E293B", marginTop: 4, ...mono }}>
            gns-aip.gcrumbs.com
          </div>
        </div>
      </div>
    </div>
  );
}
