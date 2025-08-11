export function canViewLeads(role: string) {
  return ["admin", "manager", "owner"].includes(role);
}
export function canEditLeads(role: string) {
  return ["admin", "manager"].includes(role);
}
export function routeNotification(lead: any, staff: any[]) {
  if (lead.score >= 80) {
    const manager = staff.find((u) => u.role === "manager");
    return manager || null;
  }
  return null;
}
