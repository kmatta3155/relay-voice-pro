import React from "react";
import { Phone, Zap } from "lucide-react";

interface VoiceRelayLogoProps {
  size?: "sm" | "md" | "lg";
  showText?: boolean;
  className?: string;
}

export function VoiceRelayLogo({ size = "md", showText = true, className = "" }: VoiceRelayLogoProps) {
  const sizeConfig = {
    sm: { icon: 20, text: "text-sm", container: "gap-1.5" },
    md: { icon: 24, text: "text-lg", container: "gap-2" },
    lg: { icon: 32, text: "text-2xl", container: "gap-3" }
  };

  const config = sizeConfig[size];

  return (
    <div className={`flex items-center ${config.container} ${className}`}>
      <div className="relative">
        {/* Outer glow effect */}
        <div className="absolute inset-0 bg-primary/20 rounded-lg blur-sm"></div>
        
        {/* Logo container with gradient */}
        <div className="relative bg-gradient-to-br from-primary to-primary-glow rounded-lg p-2 shadow-lg">
          <div className="relative">
            {/* Phone icon */}
            <Phone 
              size={config.icon} 
              className="text-white drop-shadow-sm" 
            />
            
            {/* Lightning bolt overlay for "relay" concept */}
            <Zap 
              size={config.icon * 0.6} 
              className="absolute -top-1 -right-1 text-accent fill-accent animate-pulse" 
            />
          </div>
        </div>
      </div>
      
      {showText && (
        <div className="flex flex-col leading-tight">
          <span className={`font-bold bg-gradient-to-r from-primary to-primary-glow bg-clip-text text-transparent ${config.text}`}>
            Voice Relay
          </span>
          <span className={`font-semibold text-muted-foreground -mt-0.5 ${config.text === 'text-2xl' ? 'text-lg' : config.text === 'text-lg' ? 'text-sm' : 'text-xs'}`}>
            PRO
          </span>
        </div>
      )}
    </div>
  );
}