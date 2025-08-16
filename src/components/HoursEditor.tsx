// src/components/HoursEditor.tsx
// A simple editor for weekly business hours. The value prop expects an object
// where keys are three-letter day abbreviations (mon, tue, wed, thu, fri, sat, sun)
// and values are objects with `open` and `close` times in 24h HH:MM format.
// Example: { mon: { open: "09:00", close: "17:00" }, tue: { open: "09:00", close: "17:00" }, ... }

import React from "react";
import { Input } from "@/components/ui/input";

export type Hours = {
  [day: string]: { open: string | null; close: string | null };
};

interface HoursEditorProps {
  value: Hours;
  onChange: (value: Hours) => void;
}

const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export default function HoursEditor({ value, onChange }: HoursEditorProps) {
  const handleChange = (day: string, field: "open" | "close", val: string) => {
    const next = { ...value, [day]: { ...(value[day] || { open: "", close: "" }), [field]: val } };
    onChange(next);
  };
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
      {days.map((day) => (
        <div key={day} className="flex items-center gap-2">
          <span className="capitalize w-10">{day}</span>
          <Input
            type="time"
            className="flex-1"
            value={value[day]?.open || ""}
            onChange={(e) => handleChange(day, "open", e.target.value)}
          />
          <span>–</span>
          <Input
            type="time"
            className="flex-1"
            value={value[day]?.close || ""}
            onChange={(e) => handleChange(day, "close", e.target.value)}
          />
        </div>
      ))}
    </div>
  );
}