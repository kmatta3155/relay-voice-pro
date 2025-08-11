export function canViewLeads(role: string) {
  return ["owner", "manager", "agent"].includes(role);
}
export function canEditLeads(role: string) {
  return ["owner", "manager"].includes(role);
}
export function routeNotification(lead: any, staffList: any[]) {
  if (lead.score >= 80) {
    const manager = staffList.find((s) => s.role === "manager");
    return manager ? { type: "hot_lead", id: manager.id } : null;
  }
  return null;
}
