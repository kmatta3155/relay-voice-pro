import React from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";

export default function MessagingToolbar({ onFollowUp, onArchive, onNote, autoReplies, onToggleAuto }:{ onFollowUp:()=>void; onArchive:()=>void; onNote:()=>void; autoReplies: boolean; onToggleAuto:(v:boolean)=>void }){
  return (
    <div className="flex items-center justify-between p-2 border rounded-xl bg-white/60 dark:bg-zinc-900/40">
      <div className="flex gap-2">
        <Button size="sm" onClick={onFollowUp}>Follow-up</Button>
        <Button size="sm" variant="secondary" onClick={onArchive}>Archive</Button>
        <Button size="sm" variant="ghost" onClick={onNote}>Add Note</Button>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <span>AI SMS auto-replies</span>
        <Switch checked={autoReplies} onCheckedChange={onToggleAuto}/>
      </div>
    </div>
  );
}
