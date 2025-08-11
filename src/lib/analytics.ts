export function getDashboardMetrics({ leads, appointments, messages }: any) {
  const hotLeads = leads.filter((l: any) => l.score >= 80).length;
  const conversionRate = leads.length
    ? Math.round((appointments.length / leads.length) * 100)
    : 0;
  return {
    hotLeads,
    conversionRate,
    totalAppointments: appointments.length,
    totalMessages: messages.length,
  };
}
