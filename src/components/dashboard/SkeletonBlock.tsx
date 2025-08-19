import React from "react";

export default function SkeletonBlock({ className="h-40" }:{className?: string}){
  return <div className={"animate-pulse rounded-2xl bg-zinc-200/60 dark:bg-zinc-800/60 " + className} />;
}
