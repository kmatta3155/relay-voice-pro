import MFASection from "@/components/settings/MFASection";

function SettingsPageWrapper() {
  // If you already have a Settings component, just add <MFASection /> inside your layout.
  return (
    <div className="max-w-5xl mx-auto p-6 space-y-6">
      {/* keep your existing settings UI above */}
      <MFASection />
    </div>
  );
}

export default SettingsPageWrapper;
