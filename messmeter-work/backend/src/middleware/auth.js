import { supabaseAdmin, supabaseForUser } from "../supabase.js";

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) return res.status(401).json({ error: "Authentication required" });
    const { data, error } = await supabaseAdmin.auth.getUser(token);
    if (error || !data.user) return res.status(401).json({ error: "Invalid session" });
    req.user = data.user;
    req.db = supabaseForUser(token);
    next();
  } catch {
    res.status(401).json({ error: "Invalid session" });
  }
}

export function requireRole(...roles) {
  return async (req, res, next) => {
    const { data, error } = await supabaseAdmin.from("user_roles").select("role").eq("user_id", req.user.id);
    if (error) return res.status(500).json({ error: error.message });
    if (!data?.some(x => roles.includes(x.role))) return res.status(403).json({ error: "Insufficient permissions" });
    next();
  };
}
