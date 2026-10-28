"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getSupabaseClient } from "@/lib/supabase";

export default function AuthCallback() {
  const router = useRouter();
  const [message, setMessage] = useState("Completing secure Google sign-in…");

  useEffect(() => {
    let active = true;
    async function exchangeCode() {
      const supabase = getSupabaseClient();
      const parameters = new URLSearchParams(window.location.search);
      const code = parameters.get("code");
      const authError = parameters.get("error_description") || parameters.get("error");
      if (!supabase || !code) {
        setMessage(authError || "Sign-in could not be completed. Return to the app and try again.");
        return;
      }
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (error) {
        if (active) setMessage(error.message);
        return;
      }
      router.replace("/");
    }
    void exchangeCode();
    return () => { active = false; };
  }, [router]);

  return <main className="auth-page"><div className="auth-card"><div className="brand-mark">R</div><h1>One moment</h1><p>{message}</p></div></main>;
}
