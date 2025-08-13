import MFASection from "@/components/settings/MFASection";

export default function SettingsPageWrapper() {
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* existing settings content ... */}
      <MFASection />
    </div>
  );
}
