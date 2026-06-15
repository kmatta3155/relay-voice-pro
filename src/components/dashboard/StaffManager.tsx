import React, { useEffect, useMemo, useRef, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import {
  Users, Calendar as CalendarIcon, Clock, Settings as SettingsIcon, Plus, Trash2,
  Pencil, Globe, Upload, Phone, Link2, Sparkles, CheckCircle2, AlertCircle, Loader2,
} from "lucide-react";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Staff, StaffSchedule, BookingSettings, Slot, TimeOff, DAYS,
  listStaff, upsertStaff, deleteStaff, listSchedules, setSchedule,
  getBookingSettings, saveBookingSettings, importStaffFromWebsite, importStaffCSV,
  computeAvailability, bookAppointment, listServicesLite,
  listStaffServices, setStaffServices, listTimeOff, addTimeOff, deleteTimeOff,
  uploadStaffPhoto,
} from "@/lib/staff";

// Stylist avatar — photo if available, else colored initials
function Avatar({ name, url, size = 40 }: { name: string; url?: string | null; size?: number }) {
  const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]?.toUpperCase()).join("") || "?";
  const hue = [...name].reduce((a, c) => a + c.charCodeAt(0), 0) % 360;
  if (url) {
    return <img src={url} alt={name} className="rounded-full object-cover shrink-0" style={{ width: size, height: size }} />;
  }
  return (
    <div className="rounded-full grid place-items-center shrink-0 font-semibold text-white"
      style={{ width: size, height: size, fontSize: size * 0.36, background: `hsl(${hue} 60% 55%)` }}>
      {initials}
    </div>
  );
}
import { listAppointments, deleteAppointment } from "@/lib/data";

type SubTab = "stylists" | "schedules" | "bookings" | "settings";

export default function StaffManager() {
  const { toast } = useToast();
  const [sub, setSub] = useState<SubTab>("stylists");
  const [staff, setStaff] = useState<Staff[]>([]);
  const [loading, setLoading] = useState(true);
  const [tablesMissing, setTablesMissing] = useState(false);

  async function refreshStaff() {
    setLoading(true);
    try {
      setStaff(await listStaff());
      setTablesMissing(false);
    } catch (e: any) {
      if (/relation .*staff.* does not exist|does not exist/i.test(e.message || "")) setTablesMissing(true);
      else toast({ title: "Couldn't load staff", description: e.message, variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refreshStaff(); }, []);

  const tabs: { id: SubTab; label: string; icon: React.ReactNode }[] = [
    { id: "stylists", label: "Stylists", icon: <Users className="w-4 h-4" /> },
    { id: "schedules", label: "Schedules", icon: <Clock className="w-4 h-4" /> },
    { id: "bookings", label: "Bookings", icon: <CalendarIcon className="w-4 h-4" /> },
    { id: "settings", label: "Booking Setup", icon: <SettingsIcon className="w-4 h-4" /> },
  ];

  if (tablesMissing) {
    return (
      <Card className="rounded-2xl shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><AlertCircle className="w-5 h-5 text-amber-500" /> Booking tables not set up yet</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground space-y-2">
          <p>The staff and booking tables haven't been created in your database. Run the migration SQL
          (<code>20260612000000_staff_and_schedules.sql</code> and <code>20260612120000_booking_settings.sql</code>)
          in the Supabase SQL Editor, then reload this page.</p>
          <Button variant="outline" className="rounded-xl" onClick={refreshStaff}>Retry</Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold flex items-center gap-2"><Users className="w-6 h-6 text-primary" /> Staff &amp; Booking</h2>
        <p className="text-sm text-muted-foreground">Your AI receptionist books appointments using this data during calls.</p>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map(t => (
          <button key={t.id} onClick={() => setSub(t.id)}
            className={`inline-flex items-center gap-2 px-3 py-2 rounded-xl text-sm border transition ${
              sub === t.id ? "bg-[image:var(--gradient-primary)] text-white border-transparent shadow" : "bg-card hover:bg-muted"
            }`}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {sub === "stylists" && <StylistsTab staff={staff} loading={loading} onChange={refreshStaff} />}
      {sub === "schedules" && <SchedulesTab staff={staff} />}
      {sub === "bookings" && <BookingsTab staff={staff} />}
      {sub === "settings" && <SettingsTab />}
    </div>
  );
}

/* ============================ STYLISTS ============================ */
function StylistsTab({ staff, loading, onChange }: { staff: Staff[]; loading: boolean; onChange: () => void }) {
  const { toast } = useToast();
  const [editing, setEditing] = useState<Staff | null>(null);
  const [open, setOpen] = useState(false);
  const [crawlUrl, setCrawlUrl] = useState("");
  const [crawling, setCrawling] = useState(false);
  const [services, setServices] = useState<{ id: string; name: string }[]>([]);
  const [assigned, setAssigned] = useState<Set<string>>(new Set());
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const photoRef = useRef<HTMLInputElement>(null);

  useEffect(() => { listServicesLite().then(setServices).catch(() => {}); }, []);

  async function newStylist() {
    setEditing({ name: "", role: "", specialties: [], bio: "", active: true });
    setAssigned(new Set());
    setOpen(true);
  }
  async function editStylist(s: Staff) {
    setEditing({ ...s });
    try { setAssigned(new Set(s.id ? await listStaffServices(s.id) : [])); }
    catch { setAssigned(new Set()); }
    setOpen(true);
  }

  async function save() {
    if (!editing?.name.trim()) { toast({ title: "Name is required", variant: "destructive" }); return; }
    try {
      const saved = await upsertStaff(editing);
      if (saved.id) {
        try { await setStaffServices(saved.id, [...assigned]); }
        catch (e: any) { toast({ title: "Service assignment not saved", description: "Run the latest migration SQL, then retry.", variant: "destructive" }); }
      }
      toast({ title: "Saved", description: `${editing.name} updated.` });
      setOpen(false); onChange();
    } catch (e: any) { toast({ title: "Save failed", description: e.message, variant: "destructive" }); }
  }

  async function remove(s: Staff) {
    if (!s.id || !confirm(`Remove ${s.name}?`)) return;
    await deleteStaff(s.id); onChange();
  }

  async function runCrawl() {
    if (!crawlUrl.trim()) return;
    setCrawling(true);
    try {
      const r = await importStaffFromWebsite(crawlUrl.trim());
      toast({ title: "Import complete", description: `Found ${r.staff} staff and ${r.services} services from the website.` });
      setCrawlUrl(""); onChange();
    } catch (e: any) {
      toast({ title: "Import failed", description: e.message, variant: "destructive" });
    } finally { setCrawling(false); }
  }

  async function onCsv(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; if (!file) return;
    try {
      const text = await file.text();
      const r = await importStaffCSV(text);
      toast({
        title: `Imported ${r.imported} stylist${r.imported === 1 ? "" : "s"}`,
        description: r.errors.length ? `${r.errors.length} row(s) skipped.` : "All rows imported.",
        variant: r.errors.length ? "destructive" : undefined,
      });
      onChange();
    } catch (e: any) { toast({ title: "CSV import failed", description: e.message, variant: "destructive" }); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }

  return (
    <div className="space-y-4">
      {/* Import row */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Sparkles className="w-4 h-4 text-primary" /> Add your team</CardTitle></CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label className="text-xs">Import from your website</Label>
            <div className="flex gap-2">
              <Input placeholder="https://yoursalon.com" value={crawlUrl} onChange={e => setCrawlUrl(e.target.value)} />
              <Button onClick={runCrawl} disabled={crawling} className="rounded-xl shrink-0">
                {crawling ? <Loader2 className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                <span className="ml-1 hidden sm:inline">Import</span>
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">We scan /team, /staff, /stylists pages and pull names, roles, and specialties.</p>
          </div>
          <div className="space-y-2">
            <Label className="text-xs">Or upload a CSV</Label>
            <div className="flex gap-2">
              <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onCsv} className="hidden" />
              <Button variant="outline" onClick={() => fileRef.current?.click()} className="rounded-xl">
                <Upload className="w-4 h-4 mr-1" /> Upload CSV
              </Button>
              <Button onClick={newStylist} className="rounded-xl"><Plus className="w-4 h-4 mr-1" /> Add manually</Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Columns: name, role, specialties, monday…sunday (e.g. <code>9:00-17:00</code>).</p>
          </div>
        </CardContent>
      </Card>

      {/* Roster */}
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-2"><CardTitle className="text-base">Team ({staff.length})</CardTitle></CardHeader>
        <CardContent>
          {loading ? (
            <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
          ) : staff.length === 0 ? (
            <div className="text-sm text-muted-foreground py-8 text-center">No stylists yet. Import from your website or add one manually.</div>
          ) : (
            <div className="divide-y">
              {staff.map(s => (
                <div key={s.id} className="flex items-start justify-between py-3 gap-3">
                  <div className="flex items-start gap-3 min-w-0">
                    <Avatar name={s.name} url={s.photo_url} />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium truncate">{s.name}</span>
                        {!s.active && <Badge variant="secondary" className="text-[10px]">inactive</Badge>}
                        {s.source && s.source !== "manual" && <Badge variant="outline" className="text-[10px]">{s.source}</Badge>}
                      </div>
                      {(s.role || s.specialties?.length) && (
                        <div className="text-xs text-muted-foreground truncate">
                          {s.role}{s.role && s.specialties?.length ? " · " : ""}
                          {s.specialties?.length ? s.specialties.join(", ") : ""}
                        </div>
                      )}
                      {s.bio && <div className="text-xs text-muted-foreground mt-1 line-clamp-2">{s.bio}</div>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Button size="sm" variant="ghost" onClick={() => editStylist(s)}><Pencil className="w-4 h-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(s)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Edit dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Edit stylist" : "Add stylist"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar name={editing.name || "?"} url={editing.photo_url} size={56} />
                <div className="space-y-1">
                  <Label>Photo</Label>
                  <div className="flex items-center gap-2">
                    <input ref={photoRef} type="file" accept="image/*" className="hidden"
                      onChange={async (e) => {
                        const f = e.target.files?.[0]; if (!f) return;
                        setUploading(true);
                        try {
                          const url = await uploadStaffPhoto(f);
                          setEditing(cur => cur ? { ...cur, photo_url: url } : cur);
                        } catch (err: any) {
                          toast({ title: "Photo upload failed", description: err.message?.includes("Bucket") ? "Create the 'staff-photos' storage bucket first (see setup SQL)." : err.message, variant: "destructive" });
                        } finally { setUploading(false); if (photoRef.current) photoRef.current.value = ""; }
                      }} />
                    <Button type="button" size="sm" variant="outline" className="rounded-xl" disabled={uploading} onClick={() => photoRef.current?.click()}>
                      {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                      <span className="ml-1">{uploading ? "Uploading…" : "Upload"}</span>
                    </Button>
                    {editing.photo_url && (
                      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(cur => cur ? { ...cur, photo_url: null } : cur)}>Remove</Button>
                    )}
                  </div>
                </div>
              </div>
              <div className="space-y-1">
                <Label>Name</Label>
                <Input value={editing.name} onChange={e => setEditing({ ...editing, name: e.target.value })} placeholder="Jane Doe" />
              </div>
              <div className="space-y-1">
                <Label>Role / title</Label>
                <Input value={editing.role || ""} onChange={e => setEditing({ ...editing, role: e.target.value })} placeholder="Senior Stylist" />
              </div>
              <div className="space-y-1">
                <Label>Specialties (comma-separated)</Label>
                <Input value={(editing.specialties || []).join(", ")}
                  onChange={e => setEditing({ ...editing, specialties: e.target.value.split(",").map(x => x.trim()).filter(Boolean) })}
                  placeholder="balayage, color correction, extensions" />
              </div>
              <div className="space-y-1">
                <Label>Bio</Label>
                <Textarea rows={3} value={editing.bio || ""}
                  onChange={e => setEditing({ ...editing, bio: e.target.value })}
                  placeholder="Short intro the AI can share with callers, e.g. '12 years of experience specializing in dimensional color.'" />
              </div>
              {services.length > 0 && (
                <div className="space-y-1">
                  <Label>Services this stylist performs</Label>
                  <p className="text-[11px] text-muted-foreground -mt-0.5">Leave all unchecked if they can take any service.</p>
                  <div className="max-h-44 overflow-y-auto rounded-lg border p-2 grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {services.map(svc => (
                      <label key={svc.id} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer">
                        <Checkbox
                          checked={assigned.has(svc.id)}
                          onCheckedChange={(v) => {
                            const next = new Set(assigned);
                            if (v) next.add(svc.id); else next.delete(svc.id);
                            setAssigned(next);
                          }}
                        />
                        <span className="truncate">{svc.name}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex items-center justify-between">
                <Label>Active (bookable)</Label>
                <Switch checked={editing.active ?? true} onCheckedChange={v => setEditing({ ...editing, active: v })} />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ============================ SCHEDULES ============================ */
function SchedulesTab({ staff }: { staff: Staff[] }) {
  const { toast } = useToast();
  const active = staff.filter(s => s.active !== false);
  const [selId, setSelId] = useState<string>("");
  const [rows, setRows] = useState<Record<number, { start: string; end: string; on: boolean }>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => { if (!selId && active.length) setSelId(active[0].id!); }, [active, selId]);

  useEffect(() => {
    if (!selId) return;
    (async () => {
      const sched = await listSchedules(selId);
      const next: Record<number, { start: string; end: string; on: boolean }> = {};
      for (let d = 0; d < 7; d++) {
        const found = sched.find(s => s.dow === d);
        next[d] = found
          ? { start: found.start_time.slice(0, 5), end: found.end_time.slice(0, 5), on: true }
          : { start: "09:00", end: "17:00", on: false };
      }
      setRows(next);
    })();
  }, [selId]);

  async function save() {
    if (!selId) return;
    setSaving(true);
    try {
      const payload = Object.entries(rows)
        .filter(([, v]) => v.on)
        .map(([dow, v]) => ({ dow: Number(dow), start_time: `${v.start}:00`, end_time: `${v.end}:00` }));
      await setSchedule(selId, payload);
      toast({ title: "Schedule saved" });
    } catch (e: any) { toast({ title: "Save failed", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  if (!active.length) return <EmptyHint text="Add a stylist first, then set their weekly hours here." />;

  return (
    <div className="space-y-4">
    <Card className="rounded-2xl shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><Clock className="w-4 h-4 text-primary" /> Weekly availability</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="max-w-xs">
          <Label className="text-xs">Stylist</Label>
          <Select value={selId} onValueChange={setSelId}>
            <SelectTrigger><SelectValue placeholder="Pick a stylist" /></SelectTrigger>
            <SelectContent>
              {active.map(s => <SelectItem key={s.id} value={s.id!}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          {DAYS.map((d, i) => {
            const r = rows[i] || { start: "09:00", end: "17:00", on: false };
            return (
              <div key={i} className="flex items-center gap-3 py-1">
                <div className="w-28 flex items-center gap-2">
                  <Switch checked={r.on} onCheckedChange={v => setRows({ ...rows, [i]: { ...r, on: v } })} />
                  <span className={`text-sm ${r.on ? "" : "text-muted-foreground"}`}>{d}</span>
                </div>
                <Input type="time" value={r.start} disabled={!r.on}
                  onChange={e => setRows({ ...rows, [i]: { ...r, start: e.target.value } })} className="w-32" />
                <span className="text-muted-foreground text-sm">to</span>
                <Input type="time" value={r.end} disabled={!r.on}
                  onChange={e => setRows({ ...rows, [i]: { ...r, end: e.target.value } })} className="w-32" />
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save schedule"}</Button>
          <p className="text-[11px] text-muted-foreground">No hours set? The AI falls back to your business hours for this stylist.</p>
        </div>
      </CardContent>
    </Card>

    {selId && <TimeOffCard staffId={selId} staffName={active.find(s => s.id === selId)?.name || ""} />}
    </div>
  );
}

function TimeOffCard({ staffId, staffName }: { staffId: string; staffName: string }) {
  const { toast } = useToast();
  const [rows, setRows] = useState<TimeOff[]>([]);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [reason, setReason] = useState("");
  const [unavailable, setUnavailable] = useState(false);

  async function refresh() {
    try { setRows(await listTimeOff(staffId)); setUnavailable(false); }
    catch { setUnavailable(true); }
  }
  useEffect(() => { refresh(); }, [staffId]);

  async function add() {
    if (!start) { toast({ title: "Pick a start date", variant: "destructive" }); return; }
    const endDate = end || start;
    if (endDate < start) { toast({ title: "End date is before start date", variant: "destructive" }); return; }
    try {
      await addTimeOff({ staff_id: staffId, start_date: start, end_date: endDate, reason: reason.trim() || null });
      setStart(""); setEnd(""); setReason("");
      refresh();
      toast({ title: "Time off added", description: `${staffName} won't be offered for bookings during that period.` });
    } catch (e: any) { toast({ title: "Couldn't add time off", description: e.message, variant: "destructive" }); }
  }

  if (unavailable) return null; // table not migrated yet — keep the page clean

  return (
    <Card className="rounded-2xl shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2"><CalendarIcon className="w-4 h-4 text-primary" /> Time off — {staffName}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1"><Label className="text-xs">From</Label>
            <Input type="date" value={start} onChange={e => setStart(e.target.value)} className="w-40" /></div>
          <div className="space-y-1"><Label className="text-xs">To (optional)</Label>
            <Input type="date" value={end} onChange={e => setEnd(e.target.value)} className="w-40" /></div>
          <div className="space-y-1 flex-1 min-w-40"><Label className="text-xs">Reason (optional)</Label>
            <Input value={reason} onChange={e => setReason(e.target.value)} placeholder="Vacation" /></div>
          <Button onClick={add} className="rounded-xl"><Plus className="w-4 h-4 mr-1" /> Add</Button>
        </div>
        {rows.length > 0 && (
          <div className="divide-y">
            {rows.map(r => (
              <div key={r.id} className="flex items-center justify-between py-2 text-sm">
                <span>
                  {r.start_date === r.end_date ? r.start_date : `${r.start_date} → ${r.end_date}`}
                  {r.reason ? <span className="text-muted-foreground"> · {r.reason}</span> : null}
                </span>
                <Button size="sm" variant="ghost" onClick={async () => { await deleteTimeOff(r.id!); refresh(); }}>
                  <Trash2 className="w-4 h-4 text-destructive" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================ BOOKINGS ============================ */
function BookingsTab({ staff }: { staff: Staff[] }) {
  const { toast } = useToast();
  const [appts, setAppts] = useState<any[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [services, setServices] = useState<{ id: string; name: string; duration_minutes?: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ customer: "", phone: "", serviceId: "", staffId: "", slotIdx: "" });

  async function refresh() {
    setLoading(true);
    const [a, sv] = await Promise.all([listAppointments(), listServicesLite()]);
    setAppts((a || []).filter((x: any) => +new Date(x.start_at) >= Date.now() - 3600000));
    setServices(sv);
    setLoading(false);
  }
  useEffect(() => { refresh(); }, []);

  async function loadSlots(staffId: string, serviceId: string) {
    const svc = services.find(s => s.id === serviceId);
    setSlots(await computeAvailability({
      staffId: staffId || undefined,
      serviceId: serviceId || undefined,
      durationMinutes: svc?.duration_minutes || 60,
      days: 7,
    }));
  }

  useEffect(() => { if (open) loadSlots(form.staffId, form.serviceId); }, [open, form.staffId, form.serviceId]);

  async function submit() {
    const svc = services.find(s => s.id === form.serviceId);
    const slot = slots[Number(form.slotIdx)];
    if (!form.customer.trim() || !svc || !slot) {
      toast({ title: "Fill in customer, service, and a time slot", variant: "destructive" }); return;
    }
    try {
      await bookAppointment({
        customer_name: form.customer.trim(), phone: form.phone.trim() || undefined,
        service_name: svc.name, service_id: svc.id,
        staff_id: slot.staff_id, staff_name: slot.staff,
        start: slot.start, durationMinutes: svc.duration_minutes || 60,
      });
      toast({ title: "Booked", description: `${svc.name} with ${slot.staff} — ${slot.label}` });
      setOpen(false); setForm({ customer: "", phone: "", serviceId: "", staffId: "", slotIdx: "" });
      refresh();
    } catch (e: any) { toast({ title: "Booking failed", description: e.message, variant: "destructive" }); }
  }

  async function cancel(id: string) {
    if (!confirm("Cancel this appointment?")) return;
    await deleteAppointment(id); refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-medium">Upcoming appointments</h3>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button className="rounded-xl"><Plus className="w-4 h-4 mr-1" /> New booking</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>New booking</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1"><Label>Customer name</Label>
                  <Input value={form.customer} onChange={e => setForm({ ...form, customer: e.target.value })} /></div>
                <div className="space-y-1"><Label>Phone</Label>
                  <Input value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} placeholder="(optional)" /></div>
              </div>
              <div className="space-y-1"><Label>Service</Label>
                <Select value={form.serviceId} onValueChange={v => setForm({ ...form, serviceId: v, slotIdx: "" })}>
                  <SelectTrigger><SelectValue placeholder="Choose a service" /></SelectTrigger>
                  <SelectContent>{services.map(s => <SelectItem key={s.id} value={s.id}>{s.name}{s.duration_minutes ? ` (${s.duration_minutes}m)` : ""}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Stylist</Label>
                <Select value={form.staffId || "any"} onValueChange={v => setForm({ ...form, staffId: v === "any" ? "" : v, slotIdx: "" })}>
                  <SelectTrigger><SelectValue placeholder="Any available" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="any">Any available</SelectItem>
                    {staff.filter(s => s.active !== false).map(s => <SelectItem key={s.id} value={s.id!}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1"><Label>Time slot</Label>
                <Select value={form.slotIdx} onValueChange={v => setForm({ ...form, slotIdx: v })}>
                  <SelectTrigger><SelectValue placeholder={slots.length ? "Pick a slot" : "No open slots — set schedules first"} /></SelectTrigger>
                  <SelectContent className="max-h-64">
                    {slots.map((s, i) => <SelectItem key={i} value={String(i)}>{s.label} — {s.staff}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
              <Button onClick={submit}>Book</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="rounded-2xl shadow-sm">
        <CardContent className="pt-6">
          {loading ? <div className="text-sm text-muted-foreground py-6 text-center">Loading…</div>
            : appts.length === 0 ? <div className="text-sm text-muted-foreground py-8 text-center">No upcoming appointments. The AI receptionist will add them here as it books calls.</div>
            : (
              <div className="divide-y">
                {appts.map(a => (
                  <div key={a.id} className="flex items-center justify-between py-3 gap-3">
                    <div className="min-w-0">
                      <div className="font-medium truncate">{a.title} <span className="text-muted-foreground font-normal">· {a.customer}</span></div>
                      <div className="text-xs text-muted-foreground">
                        {new Date(a.start_at).toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                        {a.staff ? ` · ${a.staff}` : ""}
                        {a.source ? ` · ${a.source}` : ""}
                      </div>
                    </div>
                    <Button size="sm" variant="ghost" onClick={() => cancel(a.id)}><Trash2 className="w-4 h-4 text-destructive" /></Button>
                  </div>
                ))}
              </div>
            )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ============================ SETTINGS ============================ */
function SettingsTab() {
  const { toast } = useToast();
  const [s, setS] = useState<BookingSettings | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => { getBookingSettings().then(setS); }, []);
  if (!s) return <EmptyHint text="Loading…" />;

  async function save() {
    setSaving(true);
    try { await saveBookingSettings(s!); toast({ title: "Booking setup saved" }); }
    catch (e: any) { toast({ title: "Save failed", description: e.message, variant: "destructive" }); }
    finally { setSaving(false); }
  }

  return (
    <div className="space-y-4 max-w-2xl">
      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-3"><CardTitle className="text-base">How should the AI handle booking?</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <button onClick={() => setS({ ...s, mode: "native" })}
            className={`w-full text-left p-4 rounded-xl border-2 transition ${s.mode === "native" ? "border-primary bg-accent/40" : "border-border hover:bg-muted"}`}>
            <div className="flex items-center gap-2 font-medium">
              {s.mode === "native" ? <CheckCircle2 className="w-4 h-4 text-primary" /> : <CalendarIcon className="w-4 h-4" />}
              Voice Relay books directly (recommended)
            </div>
            <p className="text-xs text-muted-foreground mt-1">The AI checks your stylists' real availability and writes the appointment into this dashboard. Works even if you have no other booking system.</p>
          </button>
          <button onClick={() => setS({ ...s, mode: "external" })}
            className={`w-full text-left p-4 rounded-xl border-2 transition ${s.mode === "external" ? "border-primary bg-accent/40" : "border-border hover:bg-muted"}`}>
            <div className="flex items-center gap-2 font-medium">
              {s.mode === "external" ? <CheckCircle2 className="w-4 h-4 text-primary" /> : <Link2 className="w-4 h-4" />}
              Hand off to my existing booking system
            </div>
            <p className="text-xs text-muted-foreground mt-1">The AI answers questions and gathers details, then directs the caller to your existing platform's booking link or offers to text it.</p>
          </button>
        </CardContent>
      </Card>

      {s.mode === "external" && (
        <Card className="rounded-2xl shadow-sm">
          <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><Link2 className="w-4 h-4 text-primary" /> Existing system</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1"><Label>Provider</Label>
              <Select value={s.provider || ""} onValueChange={v => setS({ ...s, provider: v })}>
                <SelectTrigger><SelectValue placeholder="Select your booking platform" /></SelectTrigger>
                <SelectContent>
                  {["Vagaro", "Square", "Fresha", "Booksy", "Mindbody", "Boulevard", "GlossGenius", "Acuity", "Calendly", "Other"]
                    .map(p => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1"><Label>Booking link</Label>
              <Input value={s.external_url || ""} onChange={e => setS({ ...s, external_url: e.target.value })} placeholder="https://www.vagaro.com/yoursalon" />
              <p className="text-[11px] text-muted-foreground">The AI offers this link (or texts it) when a caller wants to book.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <Card className="rounded-2xl shadow-sm">
        <CardHeader className="pb-3"><CardTitle className="text-base">Slot rules</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="space-y-1"><Label>Default service length (min)</Label>
            <Input type="number" min={15} step={15} value={s.default_service_minutes}
              onChange={e => setS({ ...s, default_service_minutes: parseInt(e.target.value) || 60 })} /></div>
          <div className="space-y-1"><Label>Buffer between appts (min)</Label>
            <Input type="number" min={0} step={5} value={s.buffer_minutes}
              onChange={e => setS({ ...s, buffer_minutes: parseInt(e.target.value) || 0 })} /></div>
        </CardContent>
      </Card>

      <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save booking setup"}</Button>
    </div>
  );
}

function EmptyHint({ text }: { text: string }) {
  return (
    <Card className="rounded-2xl shadow-sm">
      <CardContent className="py-10 text-center text-sm text-muted-foreground">{text}</CardContent>
    </Card>
  );
}
