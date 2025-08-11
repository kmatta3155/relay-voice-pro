// src/lib/permissions.ts
export type Role = "owner" | "staff" | "viewer";

export function canViewLeads(role: Role) {
  return role === "owner" || role === "staff";
}

export function canEditLeads(role: Role) {
  return role === "owner" || role === "staff";
}

export function canViewAnalytics(role: Role) {
  return role === "owner";
}

export function routeNotification(lead: any, staffList: any[]) {
  if (lead.score === "Hot") {
    return staffList.find((s) => s.role === "staff") || null;
  }
  return null;
}
