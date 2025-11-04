import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { Checkbox } from "@/components/ui/checkbox";
import { Clock, Save, AlertCircle, Loader2 } from "lucide-react";

async function getActiveTenantId(): Promise<string | null> {
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data } = await supabase
    .from("profiles")
    .select("active_tenant_id")
    .eq("id", user.id)
    .maybeSingle();
  return data?.active_tenant_id || null;
}

interface BusinessHour {
  tenant_id: string;
  dow: number;
  open_time: string;
  close_time: string;
  is_closed: boolean;
}

interface TenantSettings {
  tenant_id: string;
  timezone: string;
  cancellation_policy: string | null;
  booking_policy: string | null;
  deposit_policy: string | null;
  auto_extracted: boolean;
}

const DAYS_OF_WEEK = [
  { dow: 1, name: "Monday" },
  { dow: 2, name: "Tuesday" },
  { dow: 3, name: "Wednesday" },
  { dow: 4, name: "Thursday" },
  { dow: 5, name: "Friday" },
  { dow: 6, name: "Saturday" },
  { dow: 0, name: "Sunday" },
];

const US_TIMEZONES = [
  { value: "America/New_York", label: "Eastern Time (ET)" },
  { value: "America/Chicago", label: "Central Time (CT)" },
  { value: "America/Denver", label: "Mountain Time (MT)" },
  { value: "America/Los_Angeles", label: "Pacific Time (PT)" },
  { value: "America/Phoenix", label: "Arizona Time (MST)" },
  { value: "America/Anchorage", label: "Alaska Time (AKT)" },
  { value: "Pacific/Honolulu", label: "Hawaii Time (HST)" },
];

export default function SettingsPage() {
  const { toast } = useToast();
  const [businessHours, setBusinessHours] = useState<BusinessHour[]>([]);
  const [settings, setSettings] = useState<TenantSettings>({
    tenant_id: "",
    timezone: "America/New_York",
    cancellation_policy: "",
    booking_policy: "",
    deposit_policy: "",
    auto_extracted: false,
  });

  const { data: tenantId, isLoading: tenantLoading } = useQuery({
    queryKey: ["activeTenant"],
    queryFn: getActiveTenantId,
  });

  const { isLoading: dataLoading } = useQuery({
    queryKey: ["settingsData", tenantId],
    queryFn: async () => {
      if (!tenantId) throw new Error("No tenant ID");

      const [hoursRes, settingsRes] = await Promise.all([
        supabase
          .from("business_hours")
          .select("*")
          .eq("tenant_id", tenantId)
          .order("dow"),
        supabase
          .from("tenant_settings")
          .select("*")
          .eq("tenant_id", tenantId)
          .maybeSingle(),
      ]);

      if (hoursRes.error) throw hoursRes.error;
      if (settingsRes.error && settingsRes.error.code !== "PGRST116") throw settingsRes.error;

      const hours = hoursRes.data || [];
      const existingSettings = settingsRes.data;

      const defaultHours = DAYS_OF_WEEK.map((day) => {
        const existing = hours.find((h) => h.dow === day.dow);
        return existing || {
          tenant_id: tenantId,
          dow: day.dow,
          open_time: "09:00",
          close_time: "17:00",
          is_closed: day.dow === 0,
        };
      });

      setBusinessHours(defaultHours);

      if (existingSettings) {
        setSettings(existingSettings);
      } else {
        setSettings({
          tenant_id: tenantId,
          timezone: "America/New_York",
          cancellation_policy: "",
          booking_policy: "",
          deposit_policy: "",
          auto_extracted: false,
        });
      }

      return { hours: defaultHours, settings: existingSettings };
    },
    enabled: !!tenantId,
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (!tenantId) throw new Error("No tenant ID");

      const hoursToUpsert = businessHours.map((hour) => ({
        tenant_id: tenantId,
        dow: hour.dow,
        open_time: hour.open_time,
        close_time: hour.close_time,
        is_closed: hour.is_closed,
      }));

      const [hoursRes, settingsRes] = await Promise.all([
        supabase.from("business_hours").upsert(hoursToUpsert),
        supabase.from("tenant_settings").upsert({
          tenant_id: tenantId,
          timezone: settings.timezone,
          cancellation_policy: settings.cancellation_policy,
          booking_policy: settings.booking_policy,
          deposit_policy: settings.deposit_policy,
          auto_extracted: settings.auto_extracted,
        }),
      ]);

      if (hoursRes.error) throw hoursRes.error;
      if (settingsRes.error) throw settingsRes.error;

      return { success: true };
    },
    onSuccess: () => {
      toast({
        title: "Settings saved",
        description: "Your settings have been saved successfully.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Error saving settings",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const updateBusinessHour = (dow: number, field: keyof BusinessHour, value: any) => {
    setBusinessHours((prev) =>
      prev.map((h) => (h.dow === dow ? { ...h, [field]: value } : h))
    );
  };

  if (tenantLoading || dataLoading) {
    return (
      <main className="px-4 py-10">
        <div className="max-w-6xl mx-auto">
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        </div>
      </main>
    );
  }

  if (!tenantId) {
    return (
      <main className="px-4 py-10">
        <div className="max-w-6xl mx-auto">
          <Card data-testid="card-no-tenant">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <AlertCircle className="h-5 w-5 text-destructive" />
                No Workspace
              </CardTitle>
              <CardDescription>
                You need to be part of a workspace to access settings.
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </main>
    );
  }

  return (
    <main className="px-4 py-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <div>
          <h1 className="text-3xl font-semibold mb-2" data-testid="text-title">Settings</h1>
          <p className="text-muted-foreground">
            Configure your business hours, timezone, and policies.
          </p>
        </div>

        {settings.auto_extracted && (
          <Badge variant="secondary" className="px-4 py-2 text-sm" data-testid="badge-auto-extracted">
            <AlertCircle className="h-4 w-4 mr-2" />
            These settings were automatically extracted from your website. You can edit them below.
          </Badge>
        )}

        <Card data-testid="card-business-hours">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              Business Hours
            </CardTitle>
            <CardDescription>
              Set your operating hours for each day of the week.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {DAYS_OF_WEEK.map((day) => {
              const hour = businessHours.find((h) => h.dow === day.dow);
              if (!hour) return null;

              return (
                <div
                  key={day.dow}
                  className="grid grid-cols-1 md:grid-cols-4 gap-4 items-center pb-4 border-b last:border-b-0"
                  data-testid={`row-business-hours-${day.dow}`}
                >
                  <div className="font-medium" data-testid={`text-day-${day.dow}`}>
                    {day.name}
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`open-${day.dow}`} className="w-16">
                      Open
                    </Label>
                    <Input
                      id={`open-${day.dow}`}
                      type="time"
                      value={hour.open_time}
                      onChange={(e) =>
                        updateBusinessHour(day.dow, "open_time", e.target.value)
                      }
                      disabled={hour.is_closed}
                      className="flex-1"
                      data-testid={`input-open-time-${day.dow}`}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`close-${day.dow}`} className="w-16">
                      Close
                    </Label>
                    <Input
                      id={`close-${day.dow}`}
                      type="time"
                      value={hour.close_time}
                      onChange={(e) =>
                        updateBusinessHour(day.dow, "close_time", e.target.value)
                      }
                      disabled={hour.is_closed}
                      className="flex-1"
                      data-testid={`input-close-time-${day.dow}`}
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id={`closed-${day.dow}`}
                      checked={hour.is_closed}
                      onCheckedChange={(checked) =>
                        updateBusinessHour(day.dow, "is_closed", checked === true)
                      }
                      data-testid={`checkbox-closed-${day.dow}`}
                    />
                    <Label
                      htmlFor={`closed-${day.dow}`}
                      className="cursor-pointer font-normal"
                    >
                      Closed
                    </Label>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card data-testid="card-timezone">
          <CardHeader>
            <CardTitle>Timezone</CardTitle>
            <CardDescription>
              Select your business timezone for scheduling and appointments.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <Label htmlFor="timezone">Timezone</Label>
              <Select
                value={settings.timezone}
                onValueChange={(value) =>
                  setSettings((prev) => ({ ...prev, timezone: value }))
                }
              >
                <SelectTrigger id="timezone" data-testid="select-timezone">
                  <SelectValue placeholder="Select timezone" />
                </SelectTrigger>
                <SelectContent>
                  {US_TIMEZONES.map((tz) => (
                    <SelectItem key={tz.value} value={tz.value} data-testid={`option-timezone-${tz.value}`}>
                      {tz.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card data-testid="card-policies">
          <CardHeader>
            <CardTitle>Policies</CardTitle>
            <CardDescription>
              Define your business policies for bookings and cancellations.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="cancellation-policy">Cancellation Policy</Label>
              <Textarea
                id="cancellation-policy"
                placeholder="Enter your cancellation policy..."
                value={settings.cancellation_policy || ""}
                onChange={(e) =>
                  setSettings((prev) => ({
                    ...prev,
                    cancellation_policy: e.target.value,
                  }))
                }
                rows={4}
                data-testid="textarea-cancellation-policy"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="booking-policy">Booking Policy</Label>
              <Textarea
                id="booking-policy"
                placeholder="Enter your booking policy..."
                value={settings.booking_policy || ""}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, booking_policy: e.target.value }))
                }
                rows={4}
                data-testid="textarea-booking-policy"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="deposit-policy">Deposit Policy</Label>
              <Textarea
                id="deposit-policy"
                placeholder="Enter your deposit policy..."
                value={settings.deposit_policy || ""}
                onChange={(e) =>
                  setSettings((prev) => ({ ...prev, deposit_policy: e.target.value }))
                }
                rows={4}
                data-testid="textarea-deposit-policy"
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex justify-end">
          <Button
            onClick={() => saveMutation.mutate()}
            disabled={saveMutation.isPending}
            size="lg"
            data-testid="button-save"
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Saving...
              </>
            ) : (
              <>
                <Save className="mr-2 h-4 w-4" />
                Save Settings
              </>
            )}
          </Button>
        </div>
      </div>
    </main>
  );
}
