// src/lib/appointments.ts
import { postWebhook } from "@/lib/webhooks";

export async function upsertAppointmentWithWebhook(appt: any, setAppts: (updater: any) => void) {
  setAppts((cur: any[]) => {
    const i = cur.findIndex((x: any) => x.id === appt.id);
    const next = [...cur];
    if (i >= 0) next[i] = appt;
    else next.push(appt);
    return next;
  });

  try {
    await postWebhook({ type: "appointment.created", appointment: appt });
  } catch {
    // no-op
  }
}
