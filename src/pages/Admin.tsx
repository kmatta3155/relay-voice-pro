// src/pages/Admin.tsx
// Admin panel for RelayAI. This page allows platform administrators to manage
// tenants, configure their AI agents (greeting, hours, services), and
// provision phone numbers and SMS AI features. Only users with admin
// privileges should have access to this page. At a minimum you should add
// authentication checks before rendering sensitive controls.

import React, { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import HoursEditor from "@/components/HoursEditor";
import ServicesEditor from "@/components/ServicesEditor";

interface TenantSettings {
  greeting: string;
  business_intro: string;
  default_appointment_minutes: number;
  hours_json: any;
}

export default function AdminPage() {
  const [settings, setSettings] = useState<TenantSettings | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [saving, setSaving] = useState<boolean>(false);

  useEffect(() => {
    const fetchSettings = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("agent_settings")
        .select("greeting, business_intro, default_appointment_minutes, hours_json")
        .single();
      if (!error && data) {
        setSettings({
          greeting: data.greeting || "Hello!",
          business_intro: data.business_intro || "Welcome to our business.",
          default_appointment_minutes: data.default_appointment_minutes || 30,
          hours_json: data.hours_json || {},
        });
      }
      setLoading(false);
    };
    fetchSettings();
  }, []);

  const saveSettings = async () => {
    if (!settings) return;
    setSaving(true);
    const { error } = await supabase
      .from("agent_settings")
      .update({
        greeting: settings.greeting,
        business_intro: settings.business_intro,
        default_appointment_minutes: settings.default_appointment_minutes,
        hours_json: settings.hours_json,
      });
    if (error) {
      console.error("Failed to save settings", error);
    }
    setSaving(false);
  };

  if (loading || !settings) {
    return <p className="p-4">Loading settings…</p>;
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Admin</h1>
      <Card className="p-4">
        <CardHeader>
          <CardTitle>Business Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Greeting</label>
            <Input
              value={settings.greeting}
              onChange={(e) => setSettings({ ...settings, greeting: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Business Intro</label>
            <Textarea
              value={settings.business_intro}
              onChange={(e) => setSettings({ ...settings, business_intro: e.target.value })}
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Default Appointment Minutes</label>
            <Input
              type="number"
              min={5}
              value={settings.default_appointment_minutes}
              onChange={(e) =>
                setSettings({ ...settings, default_appointment_minutes: parseInt(e.target.value, 10) || 30 })
              }
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Business Hours</label>
            <HoursEditor
              value={settings.hours_json}
              onChange={(value) => setSettings({ ...settings, hours_json: value })}
            />
          </div>
        </CardContent>
      </Card>
      <Card className="p-4">
        <CardHeader>
          <CardTitle>Services</CardTitle>
        </CardHeader>
        <CardContent>
          <ServicesEditor />
        </CardContent>
      </Card>
      <Button onClick={saveSettings} disabled={saving} className="mt-4">
        {saving ? "Saving…" : "Save Settings"}
      </Button>
    </div>
  );
}