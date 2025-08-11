// src/lib/analytics.ts
import { postWebhook } from "@/lib/webhooks";

export async function getDashboardMetrics(data: {
  leads: any[];
  appointments: any[];
  messages: any[];
}) {
  const leadSources = data.leads.reduce((acc: any, l) => {
    acc[l.source || "Unknown"] = (acc[l.source || "Unknown"] || 0) + 1;
    return acc;
  }, {});

  const conversionRate =
    data.leads.length > 0
      ? Math.round(
          (data.appointments.length / data.leads.length) * 100
        )
      : 0;

  const hotLeads = data.leads.filter((l) => l.score === "Hot").length;

  return {
    leadSources,
    conversionRate,
    hotLeads,
    totalAppointments: data.appointments.length,
    totalMessages: data.messages.length,
  };
}

// optional: push metrics snapshot webhook
export async function pushMetricsSnapshot(metrics: any) {
  try {
    await postWebhook({ type: "metrics.snapshot", metrics });
  } catch {}
}
