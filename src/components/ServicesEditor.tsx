// src/components/ServicesEditor.tsx
// Editor for a tenant's services. It fetches services from the `services` table
// and allows adding, editing, and deleting services. Each service has a name,
// optional description, duration (in minutes) and price (in cents). Save
// operations persist changes to Supabase.

import React, { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";

interface Service {
  id?: string;
  name: string;
  description?: string;
  duration_minutes: number;
  price_cents: number;
}

export default function ServicesEditor() {
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    const fetchServices = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("services")
        .select("id, name, description, duration_minutes, price_cents");
      if (!error && data) setServices(data as Service[]);
      setLoading(false);
    };
    fetchServices();
  }, []);

  const addService = () => {
    setServices([
      ...services,
      { name: "New Service", description: "", duration_minutes: 30, price_cents: 0 },
    ]);
  };

  const deleteService = (index: number) => {
    const service = services[index];
    if (service.id) {
      // Mark for deletion by setting id to null and filter on save
      service.id = `delete-${service.id}`;
    } else {
      services.splice(index, 1);
    }
    setServices([...services]);
  };

  const saveServices = async () => {
    setSaving(true);
    // Separate new, updated, and deleted services
    const toInsert = services.filter((s) => !s.id);
    const toUpdate = services.filter((s) => s.id && !s.id.startsWith("delete-"));
    const toDelete = services.filter((s) => s.id && s.id.startsWith("delete-"));
    for (const s of toInsert) {
      const { error } = await supabase
        .from("services")
        .insert({
          name: s.name,
          description: s.description,
          duration_minutes: s.duration_minutes,
          price_cents: s.price_cents,
        });
      if (error) console.error("Insert error", error);
    }
    for (const s of toUpdate) {
      const { error } = await supabase
        .from("services")
        .update({
          name: s.name,
          description: s.description,
          duration_minutes: s.duration_minutes,
          price_cents: s.price_cents,
        })
        .eq("id", s.id);
      if (error) console.error("Update error", error);
    }
    for (const s of toDelete) {
      const realId = s.id?.replace("delete-", "");
      const { error } = await supabase.from("services").delete().eq("id", realId);
      if (error) console.error("Delete error", error);
    }
    setSaving(false);
    // Re-fetch services after saving
    const { data } = await supabase.from("services").select("id, name, description, duration_minutes, price_cents");
    setServices(data as Service[]);
  };

  if (loading) {
    return <p>Loading services…</p>;
  }

  return (
    <div className="space-y-4">
      <Button onClick={addService}>Add Service</Button>
      {services.map((service, idx) => (
        <div key={idx} className="border rounded p-3 space-y-2">
          <div className="flex justify-between items-center">
            <Input
              className="flex-1"
              value={service.name}
              onChange={(e) => {
                const next = [...services];
                next[idx].name = e.target.value;
                setServices(next);
              }}
            />
            <Button variant="destructive" size="sm" onClick={() => deleteService(idx)}>
              Delete
            </Button>
          </div>
          <Textarea
            placeholder="Description"
            value={service.description}
            onChange={(e) => {
              const next = [...services];
              next[idx].description = e.target.value;
              setServices(next);
            }}
          />
          <div className="flex gap-2">
            <div className="flex-1">
              <label className="block text-xs mb-1">Duration (min)</label>
              <Input
                type="number"
                min={5}
                value={service.duration_minutes}
                onChange={(e) => {
                  const next = [...services];
                  next[idx].duration_minutes = parseInt(e.target.value, 10) || 0;
                  setServices(next);
                }}
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs mb-1">Price ($)</label>
              <Input
                type="number"
                min={0}
                step="0.01"
                value={service.price_cents / 100}
                onChange={(e) => {
                  const next = [...services];
                  next[idx].price_cents = Math.round(parseFloat(e.target.value) * 100) || 0;
                  setServices(next);
                }}
              />
            </div>
          </div>
        </div>
      ))}
      <Button onClick={saveServices} disabled={saving}>
        {saving ? "Saving…" : "Save Services"}
      </Button>
    </div>
  );
}