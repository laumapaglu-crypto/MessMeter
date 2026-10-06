import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import "dotenv/config";
import { randomUUID } from "crypto";
import { z } from "zod";
import { supabaseAdmin, supabaseForUser } from "./supabase.js";
import { requireAuth, requireRole } from "./middleware/auth.js";
import { calculateForecast } from "./forecast.js";

const app = express();
app.use(helmet());
app.use(cors({ origin: true, credentials: false }));
app.use(express.json({ limit: "1mb" }));
app.use(morgan("dev"));

const IST = "Asia/Kolkata";
const SLOT_MEAL_TIME = { breakfast: "08:00", lunch: "13:00", snacks: "17:00", dinner: "20:00" };
const DEFAULT_WINDOWS = {
  breakfast: { open: "18:00", cutoff: "22:00", openPreviousDay: true },
  lunch: { open: "06:00", cutoff: "08:30", openPreviousDay: false },
  snacks: { open: "10:00", cutoff: "14:00", openPreviousDay: false },
  dinner: { open: "13:00", cutoff: "15:00", openPreviousDay: false }
};

app.get("/api/health", (_, res) => res.json({ ok: true, app: "MessMeter", version: 2 }));

function todayIST() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function datePlus(dateStr, days) {
  const d = new Date(`${dateStr}T12:00:00+05:30`);
  d.setDate(d.getDate() + days);
  return new Intl.DateTimeFormat("en-CA", { timeZone: IST, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
function atIST(dateStr, time, dayOffset = 0) {
  const date = dayOffset ? datePlus(dateStr, dayOffset) : dateStr;
  return new Date(`${date}T${time}:00+05:30`);
}

async function getMealWindow(meal, hostelId) {
  const { data: settings } = await supabaseAdmin.from("meal_settings").select("*").eq("hostel_id", hostelId).maybeSingle();
  const fallback = DEFAULT_WINDOWS[meal.slot];
  const open = settings?.[`${meal.slot}_open_time`]?.slice(0, 5) || fallback.open;
  const cutoff = settings?.[`${meal.slot}_cutoff_time`]?.slice(0, 5) || fallback.cutoff;
  const openDateOffset = meal.slot === "breakfast" ? -1 : 0;
  const opensAt = atIST(meal.meal_date, open, openDateOffset);
  const closesAt = atIST(meal.meal_date, cutoff, openDateOffset);
  const mealTime = atIST(meal.meal_date, SLOT_MEAL_TIME[meal.slot]);
  const expiresAt = new Date(mealTime.getTime() + 2 * 60 * 60 * 1000);
  return { opensAt, closesAt, expiresAt };
}

function makeTicketCode() {
  return `MM-${randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase()}`;
}

function getForecastSummary({ strength = 0, eating = 0, skipping = 0, fullPlates = 0, halfPlates = 0, popularity = 60, eventModifier = 0, learningFactor = 1 }) {
  const undecided = Math.max(0, strength - eating - skipping);
  const eatingEquivalent = fullPlates + (halfPlates * 0.6);
  const expectedTurnout = ((eatingEquivalent * 0.95 + undecided * (0.25 + 0.5 * (popularity / 100))) * (1 + eventModifier) * learningFactor);
  const platesToCook = Math.ceil(expectedTurnout * 1.05);
  const answered = eating + skipping;
  const responseRate = strength > 0 ? answered / strength : 0;
  let confidence = "Low";
  if (responseRate > 0.7) confidence = "High";
  else if (responseRate >= 0.4) confidence = "Medium";

  return {
    fullPlates,
    halfPlates,
    skipping,
    undecided,
    eating,
    expectedTurnout: Number(expectedTurnout.toFixed(2)),
    platesToCook,
    confidence,
    confidencePercent: Number((responseRate * 100).toFixed(1)),
    answeredRate: Number((responseRate * 100).toFixed(1))
  };
}

async function ensureMeals() {
  const { data: hostels } = await supabaseAdmin.from("hostels").select("id");
  const { data: menu } = await supabaseAdmin.from("menu_items").select("id, weekday, slot");
  if (!hostels?.length || !menu?.length) return;
  const start = todayIST();
  const rows = [];
  for (const hostel of hostels) {
    for (let i = 0; i < 14; i++) {
      const date = datePlus(start, i);
      const weekday = new Date(`${date}T12:00:00+05:30`).getDay();
      for (const item of menu.filter(m => m.weekday === weekday)) {
        rows.push({ hostel_id: hostel.id, meal_date: date, slot: item.slot, menu_item_id: item.id, status: "rsvp_open" });
      }
    }
  }
  if (rows.length) await supabaseAdmin.from("meals").upsert(rows, { onConflict: "hostel_id,meal_date,slot", ignoreDuplicates: true });
}

const registerSchema = z.object({
  name: z.string().min(2).max(100), roll_no: z.string().min(1).max(50), email: z.string().email(),
  password: z.string().min(8).max(100), hostel_id: z.string().uuid(), floor: z.string().max(30).optional().default(""),
  room: z.string().max(30).optional().default(""), phone: z.string().max(30).optional().default(""), diet: z.enum(["Veg", "Non-veg"]).default("Veg")
});

app.post("/api/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const f = parsed.data;
  const { data, error } = await supabaseAdmin.auth.admin.createUser({ email: f.email, password: f.password, email_confirm: true });
  if (error) return res.status(400).json({ error: error.message });
  const { error: profileError } = await supabaseAdmin.from("profiles").insert({ id: data.user.id, name: f.name, roll_no: f.roll_no, email: f.email, hostel_id: f.hostel_id, floor: f.floor, room: f.room, phone: f.phone, diet: f.diet, status: "pending" });
  if (profileError) { await supabaseAdmin.auth.admin.deleteUser(data.user.id); return res.status(400).json({ error: profileError.message }); }
  await supabaseAdmin.from("user_roles").insert({ user_id: data.user.id, role: "student" });
  res.json({ ok: true, message: "Account created. A manager must approve it before meals can be RSVP'd." });
});

app.get("/api/me", requireAuth, async (req, res) => {
  const [{ data: profile }, { data: roles }] = await Promise.all([
    supabaseAdmin.from("profiles").select("*").eq("id", req.user.id).maybeSingle(),
    supabaseAdmin.from("user_roles").select("role").eq("user_id", req.user.id)
  ]);
  res.json({ user: req.user, profile, roles: roles?.map(r => r.role) || [] });
});

app.get("/api/meals", requireAuth, async (req, res) => {
  await ensureMeals();
  const days = Math.min(Math.max(Number(req.query.days || 7), 1), 14);
  const start = todayIST();
  const end = datePlus(start, days);
  const { data, error } = await req.db.from("meals").select("*, menu_items(*)").gte("meal_date", start).lt("meal_date", end).order("meal_date").order("slot");
  if (error) return res.status(500).json({ error: error.message });
  const ids = (data || []).map(m => m.id);
  let rsvps = [], tickets = [];
  if (ids.length) {
    const [r, t] = await Promise.all([
      req.db.from("rsvps").select("*").in("meal_id", ids).eq("student_id", req.user.id),
      req.db.from("meal_tickets").select("*").in("meal_id", ids).eq("student_id", req.user.id)
    ]);
    rsvps = r.data || []; tickets = t.data || [];
  }
  const rsvpMap = Object.fromEntries(rsvps.map(r => [r.meal_id, r]));
  const ticketMap = Object.fromEntries(tickets.map(t => [t.meal_id, t]));
  const result = [];
  for (const m of data || []) {
    const w = await getMealWindow(m, m.hostel_id);
    if (new Date() >= w.closesAt && ["planned", "rsvp_open"].includes(m.status)) {
      await supabaseAdmin.from("meals").update({ status: "cooking" }).eq("id", m.id);
      m.status = "cooking";
    }
    result.push({ ...m, my_rsvp: rsvpMap[m.id] || null, my_ticket: ticketMap[m.id] || null, booking: { opens_at: w.opensAt.toISOString(), closes_at: w.closesAt.toISOString(), expires_at: w.expiresAt.toISOString(), open: new Date() >= w.opensAt && new Date() < w.closesAt && m.status !== "served" && m.status !== "cooking", closed: new Date() >= w.closesAt } });
  }
  res.json(result);
});

const rsvpSchema = z.object({ mealId: z.string().uuid(), response: z.enum(["eating", "skipping"]), portion: z.enum(["full", "half"]).default("full"), option: z.string().max(200).nullable().optional() });
app.post("/api/rsvp", requireAuth, async (req, res) => {
  const parsed = rsvpSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { mealId, response, portion, option } = parsed.data;
  const { data: meal } = await req.db.from("meals").select("id, meal_date, slot, hostel_id, status").eq("id", mealId).single();
  if (!meal) return res.status(404).json({ error: "Meal not found" });
  const { data: profile } = await req.db.from("profiles").select("hostel_id,status").eq("id", req.user.id).single();
  if (!profile || profile.status !== "approved") return res.status(403).json({ error: "Your account is waiting for manager approval" });
  if (profile.hostel_id !== meal.hostel_id) return res.status(403).json({ error: "Meal belongs to another hostel" });
  const w = await getMealWindow(meal, meal.hostel_id);
  const now = new Date();
  if (now < w.opensAt) return res.status(409).json({ error: `Booking opens at ${w.opensAt.toLocaleString("en-IN", { timeZone: IST })}` });
  if (now >= w.closesAt || ["cooking", "served"].includes(meal.status)) return res.status(409).json({ error: "Meal booking is closed" });

  const { data, error } = await req.db.from("rsvps").upsert({ meal_id: mealId, student_id: req.user.id, response, portion: response === "eating" ? portion : "full", option: response === "eating" ? option || null : null, updated_at: new Date().toISOString() }, { onConflict: "meal_id,student_id" }).select().single();
  if (error) return res.status(400).json({ error: error.message });

  if (response === "eating") {
    const existing = await supabaseAdmin.from("meal_tickets").select("id").eq("meal_id", mealId).eq("student_id", req.user.id).maybeSingle();
    let ticket = existing.data;
    if (!ticket) {
      const created = await supabaseAdmin.from("meal_tickets").insert({ meal_id: mealId, student_id: req.user.id, ticket_code: makeTicketCode(), qr_token: randomUUID(), portion, expires_at: w.expiresAt.toISOString() }).select().single();
      if (created.error) return res.status(500).json({ error: created.error.message });
      ticket = created.data;
    } else {
      await supabaseAdmin.from("meal_tickets").update({ status: "valid", portion, expires_at: w.expiresAt.toISOString(), used_at: null, used_by: null }).eq("id", ticket.id);
      ticket = (await supabaseAdmin.from("meal_tickets").select("*").eq("id", ticket.id).single()).data;
    }
    return res.json({ rsvp: data, ticket });
  }

  await supabaseAdmin.from("meal_tickets").update({ status: "cancelled" }).eq("meal_id", mealId).eq("student_id", req.user.id).eq("status", "valid");
  res.json({ rsvp: data, ticket: null });
});

app.get("/api/tickets", requireAuth, async (req, res) => {
  const { data, error } = await req.db.from("meal_tickets").select("*, meals(meal_date,slot,menu_items(main_dish,full_text))").eq("student_id", req.user.id).order("created_at", { ascending: false }).limit(30);
  if (error) return res.status(500).json({ error: error.message });
  const now = new Date().toISOString();
  const expiredIds = (data || []).filter(t => t.status === "valid" && t.expires_at < now).map(t => t.id);
  if (expiredIds.length) await supabaseAdmin.from("meal_tickets").update({ status: "expired" }).in("id", expiredIds);
  res.json((data || []).map(t => expiredIds.includes(t.id) ? { ...t, status: "expired" } : t));
});

const feedbackSchema = z.object({
  mealId: z.string().uuid(),
  taste: z.number().int().min(1).max(5),
  quality: z.number().int().min(1).max(5),
  quantity: z.number().int().min(1).max(5),
  freshness: z.number().int().min(1).max(5),
  overall: z.number().int().min(1).max(5).default(4),
  comment: z.string().max(1000).optional().default("")
});
app.post("/api/feedback", requireAuth, async (req, res) => {
  const parsed = feedbackSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const f = parsed.data;
  const { data: ticket } = await supabaseAdmin.from("meal_tickets").select("id,status").eq("meal_id", f.mealId).eq("student_id", req.user.id).maybeSingle();
  if (!ticket || ticket.status !== "used") return res.status(403).json({ error: "Feedback is available after your meal is served." });
  const { data: meal } = await supabaseAdmin.from("meals").select("id,slot,meal_date,hostel_id").eq("id", f.mealId).single();
  if (!meal) return res.status(404).json({ error: "Meal not found" });
  const values = { meal_id: f.mealId, student_id: req.user.id, taste: f.taste, quality: f.quality, quantity: f.quantity, freshness: f.freshness, overall: f.overall, comment: f.comment, created_at: new Date().toISOString() };
  const { data, error } = await supabaseAdmin.from("meal_feedback").upsert(values, { onConflict: "meal_id,student_id" }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ...data, meal });
});

app.get("/api/meal-history", requireAuth, async (req, res) => {
  const { data, error } = await req.db
    .from("rsvps")
    .select("*, meals(meal_date, slot, status, menu_items(main_dish, full_text)), meal_tickets(*), meal_feedback(*)")
    .eq("student_id", req.user.id)
    .order("updated_at", { ascending: false });
  if (error) return res.status(500).json({ error: error.message });

  const rows = (data || []).map((row) => {
    const ticket = Array.isArray(row.meal_tickets) ? row.meal_tickets[0] : row.meal_tickets || null;
    const feedback = Array.isArray(row.meal_feedback) ? row.meal_feedback[0] : row.meal_feedback || null;
    const meal = row.meals;
    const attendance = ticket?.status === "used" ? "Served" : "Not served";
    const rating = feedback ? (feedback.overall >= 4 ? "Like" : feedback.overall <= 2 ? "Dislike" : "Not rated") : "Not rated";

    return {
      meal_id: row.meal_id,
      date: meal?.meal_date || null,
      meal: meal?.slot || null,
      menu: meal?.menu_items?.main_dish || "Menu available",
      rsvp: row.response === "eating" ? "Eating" : "Skipping",
      portion: row.portion === "half" ? "Half" : "Full",
      ticketGenerated: Boolean(ticket),
      ticketStatus: ticket?.status || "Not generated",
      attendance,
      rating,
      feedback
    };
  });

  const stats = {
    mealsBooked: rows.length,
    mealsServed: rows.filter(r => r.attendance === "Served").length,
    mealsSkipped: rows.filter(r => r.rsvp === "Skipping").length,
    attendancePercentage: rows.length ? Number(((rows.filter(r => r.attendance === "Served").length / rows.length) * 100).toFixed(1)) : 0,
    fullPlates: rows.filter(r => r.portion === "Full").length,
    halfPlates: rows.filter(r => r.portion === "Half").length
  };

  res.json({ stats, rows });
});

app.get("/api/impact", requireAuth, async (req, res) => {
  const { data: profile } = await supabaseAdmin.from("profiles").select("points,hostel_id").eq("id", req.user.id).single();
  const { data: skips } = await supabaseAdmin.from("rsvps").select("id").eq("student_id", req.user.id).eq("response", "skipping");
  res.json({ points: profile?.points || 0, mealsSkipped: skips?.length || 0, foodSavedKg: Number(((skips?.length || 0) * 0.4).toFixed(1)) });
});

app.get("/api/manager/meal-settings", requireAuth, requireRole("mess_manager", "warden", "campus_admin"), async (req, res) => {
  const { data: profile } = await supabaseAdmin.from("profiles").select("hostel_id").eq("id", req.user.id).maybeSingle();
  const hostelId = profile?.hostel_id;
  if (!hostelId) return res.status(400).json({ error: "No hostel assigned to this user" });
  const { data, error } = await supabaseAdmin.from("meal_settings").select("*").eq("hostel_id", hostelId).maybeSingle();
  if (error) return res.status(500).json({ error: error.message });
  res.json({ hostelId, settings: data || { hostel_id: hostelId } });
});

app.post("/api/manager/meal-settings", requireAuth, requireRole("mess_manager", "warden", "campus_admin"), async (req, res) => {
  const { data: profile } = await supabaseAdmin.from("profiles").select("hostel_id").eq("id", req.user.id).maybeSingle();
  const hostelId = profile?.hostel_id;
  if (!hostelId) return res.status(400).json({ error: "No hostel assigned to this user" });
  const schema = z.object({
    breakfast_open_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    breakfast_cutoff_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    lunch_open_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    lunch_cutoff_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    snacks_open_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    snacks_cutoff_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    dinner_open_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    dinner_cutoff_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
    safety_buffer_pct: z.number().min(0).max(25).optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const payload = { hostel_id: hostelId, updated_at: new Date().toISOString(), ...parsed.data };
  const { data, error } = await supabaseAdmin.from("meal_settings").upsert(payload, { onConflict: "hostel_id" }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ok: true, settings: data });
});

app.get("/api/manager/overview", requireAuth, requireRole("mess_manager", "warden", "campus_admin"), async (req, res) => {
  const { data: profile } = await supabaseAdmin.from("profiles").select("hostel_id").eq("id", req.user.id).maybeSingle();
  const hostelId = profile?.hostel_id;
  const today = todayIST();
  if (!hostelId) return res.status(400).json({ error: "No hostel assigned to this user" });
  const { data: meals, error } = await supabaseAdmin.from("meals").select("*, menu_items(*)").eq("hostel_id", hostelId).eq("meal_date", today).order("slot");
  if (error) return res.status(500).json({ error: error.message });
  const { data: host } = await supabaseAdmin.from("hostels").select("strength").eq("id", hostelId).single();
  const results = [];
  for (const meal of meals || []) {
    const bookingWindow = await getMealWindow(meal, hostelId);
    if (new Date() >= bookingWindow.closesAt && ["planned", "rsvp_open"].includes(meal.status)) {
      await supabaseAdmin.from("meals").update({ status: "cooking" }).eq("id", meal.id);
      meal.status = "cooking";
    }
    const { data: rsvps } = await supabaseAdmin.from("rsvps").select("response,portion").eq("meal_id", meal.id);
    const eating = (rsvps || []).filter(r => r.response === "eating").length;
    const skipping = (rsvps || []).filter(r => r.response === "skipping").length;
    const half = (rsvps || []).filter(r => r.response === "eating" && r.portion === "half").length;
    const full = (rsvps || []).filter(r => r.response === "eating" && r.portion === "full").length;
    const { data: settings } = await supabaseAdmin.from("meal_settings").select("safety_buffer_pct").eq("hostel_id", hostelId).maybeSingle();
    const forecast = getForecastSummary({
      strength: host?.strength || 0,
      eating,
      skipping,
      fullPlates: full,
      halfPlates: half,
      popularity: meal.menu_items?.popularity || 60,
      eventModifier: 0,
      learningFactor: 1
    });
    const recommended = Number(settings?.safety_buffer_pct ?? 5) / 100;
    forecast.platesToCook = Math.max(forecast.platesToCook, Math.ceil((forecast.expectedTurnout * (1 + recommended))));
    forecast.ticketCount = eating;
    forecast.halfPlates = half;
    forecast.fullPlates = full;
    results.push({ meal, eating, skipping, full, half, forecast, booking: bookingWindow, kitchenSlip: { meal: meal.slot, date: meal.meal_date, recommendedQuantity: forecast.platesToCook, fullPlates: full, halfPlates: half, menu: meal.menu_items?.main_dish || "Menu item" } });
  }
  const { data: waste } = await supabaseAdmin.from("food_waste_logs").select("waste_type,kg,created_at").eq("hostel_id", hostelId).gte("created_at", `${today}T00:00:00+05:30`);
  const { data: compost } = await supabaseAdmin.from("compost_batches").select("*").eq("hostel_id", hostelId).order("started_at", { ascending: false }).limit(10);
  const totals = results.reduce((acc, item) => {
    acc.expected += item.forecast.expectedTurnout;
    acc.recommended += item.forecast.platesToCook;
    acc.served += item.meal.served || 0;
    acc.ticketed += item.eating;
    return acc;
  }, { expected: 0, recommended: 0, served: 0, ticketed: 0 });
  res.json({ date: today, meals: results, waste: waste || [], compost: compost || [], totals });
});

app.get("/api/manager/impact", requireAuth, requireRole("mess_manager", "warden", "campus_admin"), async (req, res) => {
  const { data: profile } = await supabaseAdmin.from("profiles").select("hostel_id").eq("id", req.user.id).maybeSingle();
  const hostelId = profile?.hostel_id;
  if (!hostelId) return res.status(400).json({ error: "No hostel assigned to this user" });
  const [{ data: meals }, { data: waste }, { data: compost }, { data: rescue }] = await Promise.all([
    supabaseAdmin.from("meals").select("served").eq("hostel_id", hostelId),
    supabaseAdmin.from("food_waste_logs").select("waste_type,kg").eq("hostel_id", hostelId),
    supabaseAdmin.from("compost_batches").select("finished_kg,farm_used_kg,sold_kg,sale_revenue").eq("hostel_id", hostelId),
    supabaseAdmin.from("surplus_offers_v2").select("kg").eq("hostel_id", hostelId)
  ]);
  const wasteByType = {};
  for (const row of waste || []) wasteByType[row.waste_type] = Number(((wasteByType[row.waste_type] || 0) + Number(row.kg || 0)).toFixed(2));
  res.json({
    mealsServed: (meals || []).reduce((n, m) => n + Number(m.served || 0), 0),
    wasteKg: Number((waste || []).reduce((n, w) => n + Number(w.kg || 0), 0).toFixed(2)),
    plateWasteKg: Number((waste || []).filter(w => w.waste_type === "plate").reduce((n, w) => n + Number(w.kg || 0), 0).toFixed(2)),
    compostFinishedKg: Number((compost || []).reduce((n, c) => n + Number(c.finished_kg || 0), 0).toFixed(2)),
    farmUsedKg: Number((compost || []).reduce((n, c) => n + Number(c.farm_used_kg || 0), 0).toFixed(2)),
    saleRevenue: Number((compost || []).reduce((n, c) => n + Number(c.sale_revenue || 0), 0).toFixed(2)),
    rescueKg: Number((rescue || []).reduce((n, r) => n + Number(r.kg || 0), 0).toFixed(2)),
    wasteByType
  });
});

app.get("/api/manager/forecast-learning", requireAuth, requireRole("mess_manager", "warden", "campus_admin"), async (req, res) => {
  const { data: profile } = await supabaseAdmin.from("profiles").select("hostel_id").eq("id", req.user.id).maybeSingle();
  const hostelId = profile?.hostel_id;
  let query = supabaseAdmin.from("meal_forecast_logs").select("*").order("meal_date", { ascending: false });
  if (hostelId) query = query.eq("hostel_id", hostelId);
  const { data, error } = await query.limit(14);
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.get("/api/manager/rescue-partners", requireAuth, requireRole("mess_manager", "warden", "campus_admin"), async (req, res) => {
  const { data: profile } = await supabaseAdmin.from("profiles").select("hostel_id").eq("id", req.user.id).maybeSingle();
  const hostelId = profile?.hostel_id;
  let query = supabaseAdmin.from("food_rescue_partners").select("*").order("created_at", { ascending: false });
  if (hostelId) query = query.eq("hostel_id", hostelId);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post("/api/manager/rescue-partners", requireAuth, requireRole("mess_manager", "campus_admin"), async (req, res) => {
  const schema = z.object({
    name: z.string().min(2),
    phone: z.string().max(30).optional().default(""),
    email: z.string().email().optional(),
    whatsapp: z.string().max(30).optional().default(""),
    service_area: z.string().max(200).optional().default(""),
    verified: z.boolean().default(false),
    notifications_enabled: z.boolean().default(true)
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { data: profile } = await supabaseAdmin.from("profiles").select("hostel_id").eq("id", req.user.id).maybeSingle();
  const { data, error } = await supabaseAdmin.from("food_rescue_partners").insert({
    hostel_id: profile?.hostel_id || null,
    name: parsed.data.name,
    phone: parsed.data.phone,
    email: parsed.data.email || "",
    whatsapp: parsed.data.whatsapp,
    service_area: parsed.data.service_area,
    verified: parsed.data.verified,
    notifications_enabled: parsed.data.notifications_enabled
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.get("/api/manager/surplus", requireAuth, requireRole("mess_manager", "warden", "campus_admin"), async (req, res) => {
  const { data: profile } = await supabaseAdmin.from("profiles").select("hostel_id").eq("id", req.user.id).maybeSingle();
  const hostelId = profile?.hostel_id;
  let query = supabaseAdmin.from("surplus_offers_v2").select("*").order("created_at", { ascending: false });
  if (hostelId) query = query.eq("hostel_id", hostelId);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post("/api/manager/surplus", requireAuth, requireRole("mess_manager", "campus_admin"), async (req, res) => {
  const schema = z.object({
    mealId: z.string().uuid().nullable().optional(),
    kg: z.number().min(0).max(10000),
    description: z.string().min(1).max(500).default("Safe unserved surplus"),
    status: z.enum(["available", "claimed", "collected", "expired", "cancelled"]).default("available"),
    availableUntil: z.string().datetime().optional()
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { data: profile } = await supabaseAdmin.from("profiles").select("hostel_id").eq("id", req.user.id).maybeSingle();
  const { data, error } = await supabaseAdmin.from("surplus_offers_v2").insert({
    hostel_id: profile?.hostel_id,
    meal_id: parsed.data.mealId || null,
    kg: parsed.data.kg,
    description: parsed.data.description,
    available_until: parsed.data.availableUntil || new Date(Date.now() + 90 * 60 * 1000).toISOString(),
    status: parsed.data.status
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ...data, notice: "Only safe, unserved surplus should be offered for food rescue. Plate leftovers must go to compost." });
});

app.get("/api/manager/waste", requireAuth, requireRole("mess_manager", "warden", "campus_admin"), async (req, res) => {
  const { data: profile } = await supabaseAdmin.from("profiles").select("hostel_id").eq("id", req.user.id).maybeSingle();
  const hostelId = profile?.hostel_id;
  let query = supabaseAdmin.from("food_waste_logs").select("*").order("created_at", { ascending: false });
  if (hostelId) query = query.eq("hostel_id", hostelId);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post("/api/manager/waste", requireAuth, requireRole("mess_manager", "campus_admin"), async (req, res) => {
  const schema = z.object({
    mealId: z.string().uuid().nullable().optional(),
    wasteType: z.enum(["plate", "preparation", "spoiled"]),
    kg: z.number().min(0).max(10000),
    notes: z.string().max(500).optional().default("")
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { data: profile } = await supabaseAdmin.from("profiles").select("hostel_id").eq("id", req.user.id).maybeSingle();
  const { data, error } = await supabaseAdmin.from("food_waste_logs").insert({
    hostel_id: profile?.hostel_id,
    meal_id: parsed.data.mealId || null,
    waste_type: parsed.data.wasteType,
    kg: parsed.data.kg,
    notes: parsed.data.notes,
    recorded_by: req.user.id
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.get("/api/manager/compost", requireAuth, requireRole("mess_manager", "warden", "campus_admin"), async (req, res) => {
  const { data: profile } = await supabaseAdmin.from("profiles").select("hostel_id").eq("id", req.user.id).maybeSingle();
  const hostelId = profile?.hostel_id;
  let query = supabaseAdmin.from("compost_batches").select("*").order("started_at", { ascending: false });
  if (hostelId) query = query.eq("hostel_id", hostelId);
  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });
  res.json(data || []);
});

app.post("/api/manager/compost", requireAuth, requireRole("mess_manager", "campus_admin"), async (req, res) => {
  const schema = z.object({
    batchCode: z.string().min(2).optional(),
    inputKg: z.number().min(0),
    finishedKg: z.number().min(0).default(0),
    farmUsedKg: z.number().min(0).default(0),
    soldKg: z.number().min(0).default(0),
    saleRevenue: z.number().min(0).default(0),
    status: z.enum(["composting", "ready", "closed"]).default("composting"),
    notes: z.string().max(500).optional().default("")
  });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { data: profile } = await supabaseAdmin.from("profiles").select("hostel_id").eq("id", req.user.id).maybeSingle();
  const { data, error } = await supabaseAdmin.from("compost_batches").insert({
    hostel_id: profile?.hostel_id,
    batch_code: parsed.data.batchCode || `SHF-${Date.now().toString().slice(-7)}`,
    input_kg: parsed.data.inputKg,
    finished_kg: parsed.data.finishedKg,
    farm_used_kg: parsed.data.farmUsedKg,
    sold_kg: parsed.data.soldKg,
    sale_revenue: parsed.data.saleRevenue,
    status: parsed.data.status,
    notes: parsed.data.notes
  }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

app.post("/api/manager/verify-ticket", requireAuth, requireRole("mess_manager", "campus_admin"), async (req, res) => {
  const parsed = z.object({ token: z.string().min(8).max(200) }).safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Invalid QR token" });
  const { data: profile } = await supabaseAdmin.from("profiles").select("hostel_id").eq("id", req.user.id).single();
  const { data: ticket } = await supabaseAdmin.from("meal_tickets").select("*, meals(meal_date,slot,hostel_id,menu_items(main_dish))").eq("qr_token", parsed.data.token).maybeSingle();
  if (!ticket) return res.status(404).json({ error: "Ticket not found" });
  if (profile?.hostel_id && ticket.meals?.hostel_id !== profile.hostel_id) return res.status(403).json({ error: "Ticket belongs to another hostel" });
  if (ticket.status !== "valid") return res.status(409).json({ error: `Ticket is ${ticket.status}` });
  if (new Date(ticket.expires_at) < new Date()) { await supabaseAdmin.from("meal_tickets").update({ status: "expired" }).eq("id", ticket.id); return res.status(409).json({ error: "Ticket has expired" }); }
  const { data: used, error } = await supabaseAdmin.from("meal_tickets").update({ status: "used", used_at: new Date().toISOString(), used_by: req.user.id }).eq("id", ticket.id).eq("status", "valid").select().maybeSingle();
  if (error || !used) return res.status(409).json({ error: "Ticket was already used or changed. Scan again." });
  await supabaseAdmin.from("checkins").upsert({ meal_id: ticket.meal_id, student_id: ticket.student_id, scanned_at: new Date().toISOString() }, { onConflict: "meal_id,student_id" });
  const { data: currentMeal } = await supabaseAdmin.from("meals").select("served").eq("id", ticket.meal_id).single();
  await supabaseAdmin.from("meals").update({ served: Number(currentMeal?.served || 0) + 1 }).eq("id", ticket.meal_id);
  const { data: student } = await supabaseAdmin.from("profiles").select("name,roll_no").eq("id", ticket.student_id).maybeSingle();
  res.json({ ok: true, message: "Meal served", student, meal: ticket.meals, ticket: used });
});

const wasteSchema = z.object({ mealId: z.string().uuid().nullable().optional(), wasteType: z.enum(["plate", "preparation", "spoiled"]), kg: z.number().positive().max(10000), notes: z.string().max(500).optional().default("") });
app.post("/api/manager/waste", requireAuth, requireRole("mess_manager", "campus_admin"), async (req, res) => {
  const parsed = wasteSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { data: profile } = await supabaseAdmin.from("profiles").select("hostel_id").eq("id", req.user.id).single();
  const { data, error } = await supabaseAdmin.from("food_waste_logs").insert({ hostel_id: profile.hostel_id, meal_id: parsed.data.mealId || null, waste_type: parsed.data.wasteType, kg: parsed.data.kg, notes: parsed.data.notes, recorded_by: req.user.id }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

const surplusSchema = z.object({ mealId: z.string().uuid().nullable().optional(), kg: z.number().positive().max(10000), description: z.string().max(500).default("Safe unserved surplus") });
app.post("/api/manager/surplus", requireAuth, requireRole("mess_manager", "campus_admin"), async (req, res) => {
  const parsed = surplusSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { data: profile } = await supabaseAdmin.from("profiles").select("hostel_id").eq("id", req.user.id).single();
  const availableUntil = new Date(Date.now() + 90 * 60 * 1000).toISOString();
  const { data, error } = await supabaseAdmin.from("surplus_offers_v2").insert({ hostel_id: profile.hostel_id, meal_id: parsed.data.mealId || null, kg: parsed.data.kg, description: parsed.data.description, available_until: availableUntil }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ ...data, notice: "Only safe, unserved surplus should be offered for food rescue. Plate leftovers must go to compost." });
});

const compostSchema = z.object({ inputKg: z.number().nonnegative(), finishedKg: z.number().nonnegative().default(0), farmUsedKg: z.number().nonnegative().default(0), soldKg: z.number().nonnegative().default(0), saleRevenue: z.number().nonnegative().default(0), status: z.enum(["composting", "ready", "closed"]).default("composting"), notes: z.string().max(500).default("") });
app.post("/api/manager/compost", requireAuth, requireRole("mess_manager", "campus_admin"), async (req, res) => {
  const parsed = compostSchema.safeParse(req.body); if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const { data: profile } = await supabaseAdmin.from("profiles").select("hostel_id").eq("id", req.user.id).single();
  const batchCode = `SHF-${Date.now().toString().slice(-7)}`;
  const { data, error } = await supabaseAdmin.from("compost_batches").insert({ hostel_id: profile.hostel_id, batch_code: batchCode, input_kg: parsed.data.inputKg, finished_kg: parsed.data.finishedKg, farm_used_kg: parsed.data.farmUsedKg, sold_kg: parsed.data.soldKg, sale_revenue: parsed.data.saleRevenue, status: parsed.data.status, notes: parsed.data.notes }).select().single();
  if (error) return res.status(400).json({ error: error.message });
  res.json(data);
});

ensureMeals().catch(console.error);
app.listen(Number(process.env.PORT || 4000), () => console.log(`MessMeter API running on http://localhost:${process.env.PORT || 4000}`));
