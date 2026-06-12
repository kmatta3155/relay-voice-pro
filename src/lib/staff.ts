import { supabase } from "./supabaseClient";

export type Staff = {
  id?: string;
  tenant_id?: string;
  name: string;
  role?: string | null;
  specialties?: string[] | null;
  bio?: string | null;
  photo_url?: string | null;
  source?: string;
  active?: boolean;
};

export type TimeOff = {
  id?: string;
  staff_id: string;
  start_date: string; // YYYY-MM-DD
  end_date: string;
  reason?: string | null;
};

export type StaffSchedule = {
  id?: string;
  tenant_id?: string;
  staff_id: string;
  dow: number; // 0=Sun..6=Sat
  start_time: string; // "HH:MM" or "HH:MM:SS"
  end_time: string;
};

export type BookingSettings = {
  tenant_id?: string;
  mode: "native" | "external";
  provider?: string | null;
  external_url?: string | null;
  slot_granularity_minutes: number;
  buffer_minutes: number;
  default_service_minutes: number;
  timezone?: string;
};

export const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

async function activeTenantId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase.from("profiles").select("active_tenant_id").eq("id", user.id).maybeSingle();
  return data?.active_tenant_id || null;
}

/* ---------------- Staff ---------------- */
export async function listStaff(): Promise<Staff[]> {
  const t = await activeTenantId(); if (!t) return [];
  const { data, error } = await supabase.from("staff").select("*").eq("tenant_id", t).order("name");
  if (error) throw error;
  return data || [];
}

export async function upsertStaff(s: Staff): Promise<Staff> {
  const t = await activeTenantId(); if (!t) throw new Error("No active workspace");
  const payload: any = {
    tenant_id: t,
    name: s.name.trim(),
    role: s.role || null,
    specialties: s.specialties && s.specialties.length ? s.specialties : null,
    bio: s.bio?.trim() || null,
    photo_url: s.photo_url?.trim() || null,
    source: s.source || "manual",
    active: s.active ?? true,
    updated_at: new Date().toISOString(),
  };
  if (s.id) payload.id = s.id;
  // onConflict on (tenant_id,name) lets re-imports update instead of erroring
  const { data, error } = await supabase.from("staff")
    .upsert(payload, { onConflict: s.id ? "id" : "tenant_id,name" })
    .select("*").single();
  if (error) throw error;
  return data;
}

export async function deleteStaff(id: string): Promise<void> {
  const t = await activeTenantId(); if (!t) return;
  await supabase.from("staff").delete().eq("tenant_id", t).eq("id", id);
}

/* ---------------- Schedules ---------------- */
export async function listSchedules(staffId?: string): Promise<StaffSchedule[]> {
  const t = await activeTenantId(); if (!t) return [];
  let q = supabase.from("staff_schedules").select("*").eq("tenant_id", t);
  if (staffId) q = q.eq("staff_id", staffId);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

// Replace a staff member's entire weekly schedule in one shot
export async function setSchedule(staffId: string, rows: Omit<StaffSchedule, "tenant_id" | "staff_id" | "id">[]): Promise<void> {
  const t = await activeTenantId(); if (!t) throw new Error("No active workspace");
  await supabase.from("staff_schedules").delete().eq("tenant_id", t).eq("staff_id", staffId);
  const clean = rows
    .filter(r => r.start_time && r.end_time && r.start_time < r.end_time)
    .map(r => ({ tenant_id: t, staff_id: staffId, dow: r.dow, start_time: r.start_time, end_time: r.end_time }));
  if (clean.length) {
    const { error } = await supabase.from("staff_schedules").insert(clean);
    if (error) throw error;
  }
}

/* ---------------- Service assignments ---------------- */
export async function listStaffServices(staffId: string): Promise<string[]> {
  const t = await activeTenantId(); if (!t) return [];
  const { data } = await supabase.from("staff_services").select("service_id").eq("tenant_id", t).eq("staff_id", staffId);
  return (data || []).map((r: any) => r.service_id);
}

export async function setStaffServices(staffId: string, serviceIds: string[]): Promise<void> {
  const t = await activeTenantId(); if (!t) throw new Error("No active workspace");
  await supabase.from("staff_services").delete().eq("tenant_id", t).eq("staff_id", staffId);
  if (serviceIds.length) {
    const { error } = await supabase.from("staff_services")
      .insert(serviceIds.map(sid => ({ tenant_id: t, staff_id: staffId, service_id: sid })));
    if (error) throw error;
  }
}

/* ---------------- Time off ---------------- */
export async function listTimeOff(staffId?: string): Promise<TimeOff[]> {
  const t = await activeTenantId(); if (!t) return [];
  let q = supabase.from("staff_time_off").select("*").eq("tenant_id", t).order("start_date");
  if (staffId) q = q.eq("staff_id", staffId);
  const { data } = await q;
  return data || [];
}

export async function addTimeOff(o: TimeOff): Promise<void> {
  const t = await activeTenantId(); if (!t) throw new Error("No active workspace");
  const { error } = await supabase.from("staff_time_off").insert({
    tenant_id: t, staff_id: o.staff_id, start_date: o.start_date, end_date: o.end_date, reason: o.reason || null,
  });
  if (error) throw error;
}

export async function deleteTimeOff(id: string): Promise<void> {
  const t = await activeTenantId(); if (!t) return;
  await supabase.from("staff_time_off").delete().eq("tenant_id", t).eq("id", id);
}

/* ---------------- Booking settings ---------------- */
const DEFAULT_SETTINGS: BookingSettings = {
  mode: "native",
  provider: null,
  external_url: null,
  slot_granularity_minutes: 30,
  buffer_minutes: 0,
  default_service_minutes: 60,
  timezone: "America/New_York",
};

export async function getBookingSettings(): Promise<BookingSettings> {
  const t = await activeTenantId(); if (!t) return { ...DEFAULT_SETTINGS };
  const { data } = await supabase.from("booking_settings").select("*").eq("tenant_id", t).maybeSingle();
  return data ? { ...DEFAULT_SETTINGS, ...data } : { ...DEFAULT_SETTINGS };
}

export async function saveBookingSettings(s: BookingSettings): Promise<void> {
  const t = await activeTenantId(); if (!t) throw new Error("No active workspace");
  const { error } = await supabase.from("booking_settings").upsert({
    tenant_id: t,
    mode: s.mode,
    provider: s.provider || null,
    external_url: s.external_url || null,
    slot_granularity_minutes: s.slot_granularity_minutes,
    buffer_minutes: s.buffer_minutes,
    default_service_minutes: s.default_service_minutes,
    timezone: s.timezone || "America/New_York",
    updated_at: new Date().toISOString(),
  }, { onConflict: "tenant_id" });
  if (error) throw error;
}

/* ---------------- Import from website ---------------- */
export async function importStaffFromWebsite(url: string): Promise<{ staff: number; services: number }> {
  const t = await activeTenantId(); if (!t) throw new Error("No active workspace");
  const { data, error } = await supabase.functions.invoke("crawl-ingest", {
    body: { url, tenant_id: t, options: { maxPages: 6 } },
  });
  if (error) throw new Error(error.message || "Crawl failed");
  return { staff: data?.staff?.length || 0, services: data?.services?.length || 0 };
}

/* ---------------- CSV import ----------------
   Accepts headers: name, role, specialties, plus per-day columns like
   "monday", "tuesday" with values "9:00-17:00" (or blank/closed). */
export async function importStaffCSV(text: string): Promise<{ imported: number; errors: string[] }> {
  const errors: string[] = [];
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return { imported: 0, errors: ["CSV needs a header row and at least one data row"] };

  const headers = splitCsvLine(lines[0]).map(h => h.trim().toLowerCase());
  const nameIdx = headers.indexOf("name");
  if (nameIdx === -1) return { imported: 0, errors: ["CSV must have a 'name' column"] };
  const roleIdx = headers.indexOf("role");
  const specIdx = headers.findIndex(h => h === "specialties" || h === "specialty");
  const dayIdx: Record<number, number> = {};
  DAYS.forEach((d, i) => {
    const idx = headers.indexOf(d.toLowerCase());
    if (idx !== -1) dayIdx[i] = idx;
  });

  let imported = 0;
  for (let i = 1; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const name = (cells[nameIdx] || "").trim();
    if (!name) continue;
    try {
      const staff = await upsertStaff({
        name,
        role: roleIdx !== -1 ? (cells[roleIdx] || "").trim() || null : null,
        specialties: specIdx !== -1
          ? (cells[specIdx] || "").split(/[;|]/).map(s => s.trim()).filter(Boolean)
          : null,
        source: "csv",
        active: true,
      });

      const schedRows: Omit<StaffSchedule, "tenant_id" | "staff_id" | "id">[] = [];
      for (const [dowStr, colIdx] of Object.entries(dayIdx)) {
        const raw = (cells[colIdx] || "").trim();
        const parsed = parseRange(raw);
        if (parsed) schedRows.push({ dow: Number(dowStr), start_time: parsed.start, end_time: parsed.end });
      }
      if (schedRows.length && staff.id) await setSchedule(staff.id, schedRows);
      imported++;
    } catch (e: any) {
      errors.push(`${name}: ${e.message || e}`);
    }
  }
  return { imported, errors };
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "", inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === "," && !inQuotes) { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

// "9:00-17:00", "9am-5pm", "09:00 - 17:00" → {start, end} as HH:MM:SS
function parseRange(raw: string): { start: string; end: string } | null {
  if (!raw || /closed|off|—|-$/i.test(raw.trim()) === false && !raw.includes("-")) return null;
  const m = raw.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return null;
  const to24 = (h: string, min: string | undefined, ap: string | undefined) => {
    let hh = parseInt(h, 10);
    const mm = min || "00";
    if (ap) { const a = ap.toLowerCase(); if (a === "pm" && hh !== 12) hh += 12; if (a === "am" && hh === 12) hh = 0; }
    if (hh > 23) return null;
    return `${String(hh).padStart(2, "0")}:${mm}:00`;
  };
  const start = to24(m[1], m[2], m[3]);
  const end = to24(m[4], m[5], m[6]);
  if (!start || !end || start >= end) return null;
  return { start, end };
}

/* ---------------- Availability (client mirror of the voice agent) ---------------- */
export type Slot = { staff: string; staff_id: string; start: Date; end: Date; label: string };

export async function computeAvailability(opts: {
  staffId?: string;
  serviceId?: string;
  date?: Date;
  days?: number;
  durationMinutes?: number;
}): Promise<Slot[]> {
  const t = await activeTenantId(); if (!t) return [];
  const dur = opts.durationMinutes || 60;
  const days = opts.days || 7;

  const [{ data: staffRows }, { data: scheds }, { data: appts }, { data: bizHours }, { data: timeOff }, { data: assignments }] = await Promise.all([
    supabase.from("staff").select("id,name").eq("tenant_id", t).eq("active", true),
    supabase.from("staff_schedules").select("staff_id,dow,start_time,end_time").eq("tenant_id", t),
    supabase.from("appointments").select("staff,staff_id,start_at,end_at").eq("tenant_id", t),
    supabase.from("business_hours").select("dow,open_time,close_time,is_closed").eq("tenant_id", t),
    supabase.from("staff_time_off").select("staff_id,start_date,end_date").eq("tenant_id", t),
    supabase.from("staff_services").select("staff_id,service_id").eq("tenant_id", t),
  ]);

  let roster = staffRows || [];
  if (opts.staffId) roster = roster.filter((s: any) => s.id === opts.staffId);
  // Filter by service assignment — but only when assignments exist at all for
  // this service (salons that haven't assigned services keep everyone bookable)
  if (opts.serviceId && (assignments || []).some((a: any) => a.service_id === opts.serviceId)) {
    const allowed = new Set((assignments || []).filter((a: any) => a.service_id === opts.serviceId).map((a: any) => a.staff_id));
    roster = roster.filter((s: any) => allowed.has(s.id));
  }
  if (!roster.length) return [];

  const isOnTimeOff = (staffId: string, day: Date) => {
    const ymd = day.toISOString().slice(0, 10);
    return (timeOff || []).some((o: any) => o.staff_id === staffId && o.start_date <= ymd && o.end_date >= ymd);
  };

  // Effective schedule per staff: their own, else business hours
  const schedFor = (staffId: string): { dow: number; start_time: string; end_time: string }[] => {
    const own = (scheds || []).filter((s: any) => s.staff_id === staffId);
    if (own.length) return own;
    return (bizHours || [])
      .filter((h: any) => !h.is_closed && h.open_time && h.close_time)
      .map((h: any) => ({ dow: h.dow, start_time: h.open_time, end_time: h.close_time }));
  };

  const now = new Date();
  const base = opts.date ? new Date(opts.date) : now;
  base.setHours(0, 0, 0, 0);
  const out: Slot[] = [];

  for (let d = 0; d < (opts.date ? 1 : days) && out.length < 40; d++) {
    const day = new Date(base); day.setDate(base.getDate() + d);
    const dow = day.getDay();
    for (const person of roster) {
      if (isOnTimeOff(person.id, day)) continue;
      for (const sc of schedFor(person.id)) {
        if (sc.dow !== dow) continue;
        const [sh, sm] = String(sc.start_time).split(":").map(Number);
        const [eh, em] = String(sc.end_time).split(":").map(Number);
        const shiftStart = new Date(day); shiftStart.setHours(sh, sm, 0, 0);
        const shiftEnd = new Date(day); shiftEnd.setHours(eh, em, 0, 0);
        for (let ts = shiftStart.getTime(); ts + dur * 60000 <= shiftEnd.getTime(); ts += 30 * 60000) {
          if (out.length >= 40) break;
          const slotStart = new Date(ts);
          const slotEnd = new Date(ts + dur * 60000);
          if (slotStart < now) continue;
          const conflict = (appts || []).some((a: any) => {
            const sameStaff = a.staff_id === person.id ||
              (a.staff && a.staff.toLowerCase().includes(person.name.toLowerCase().split(" ")[0].toLowerCase()));
            return sameStaff && new Date(a.start_at) < slotEnd && new Date(a.end_at) > slotStart;
          });
          if (conflict) continue;
          out.push({
            staff: person.name, staff_id: person.id, start: slotStart, end: slotEnd,
            label: slotStart.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }),
          });
        }
      }
    }
  }
  out.sort((a, b) => +a.start - +b.start);
  return out;
}

/* ---------------- Manual booking ---------------- */
export async function bookAppointment(a: {
  customer_name: string;
  phone?: string;
  service_name: string;
  service_id?: string;
  staff_id?: string;
  staff_name?: string;
  start: Date;
  durationMinutes?: number;
}): Promise<void> {
  const t = await activeTenantId(); if (!t) throw new Error("No active workspace");
  const dur = a.durationMinutes || 60;
  const end = new Date(+a.start + dur * 60000);
  const { error } = await supabase.from("appointments").insert({
    tenant_id: t,
    title: a.service_name,
    customer: a.phone ? `${a.customer_name} (${a.phone})` : a.customer_name,
    phone: a.phone || null,
    staff: a.staff_name || null,
    staff_id: a.staff_id || null,
    service_id: a.service_id || null,
    start_at: a.start.toISOString(),
    end_at: end.toISOString(),
    status: "booked",
    source: "dashboard",
  });
  if (error) throw error;
}

export async function listServicesLite(): Promise<{ id: string; name: string; duration_minutes?: number }[]> {
  const t = await activeTenantId(); if (!t) return [];
  const { data } = await supabase.from("services").select("id,name,duration_minutes").eq("tenant_id", t).eq("active", true).order("name");
  return data || [];
}
