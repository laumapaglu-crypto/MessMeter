import { supabase } from "./supabase";

export async function api(path, options = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  const headers = {
    "Content-Type": "application/json",
    ...(options.headers || {})
  };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;

  const response = await fetch(`${import.meta.env.VITE_API_URL}${path}`, {
    ...options,
    headers
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : JSON.stringify(body.error || "Request failed"));
  return body;
}
