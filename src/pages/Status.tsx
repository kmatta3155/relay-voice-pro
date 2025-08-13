import React from "react";
export default function StatusPage() {
  return (
    <div className="max-w-3xl mx-auto p-6 space-y-3 text-sm">
      <h1 className="text-2xl font-semibold">System status</h1>
      <ul className="list-disc ml-5">
        <li>Database: <b>OK</b></li>
        <li>Edge Functions: <b>OK</b></li>
        <li>Realtime: <b>OK</b></li>
      </ul>
      <p className="text-slate-500">Hook this up to a real uptime monitor later.</p>
    </div>
  );
}