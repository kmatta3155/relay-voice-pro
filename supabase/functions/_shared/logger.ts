// Shared logger for edge functions that sends logs to both console and debug endpoint

interface LogEntry {
  timestamp: string;
  functionName: string;
  level: 'INFO' | 'ERROR' | 'DEBUG' | 'WARN';
  message: string;
  data?: any;
}

export class EdgeLogger {
  private functionName: string;
  private debugEndpoint: string;
  
  constructor(functionName: string) {
    this.functionName = functionName;
    // Use the project's public URL - this will be updated with actual deployment URL
    this.debugEndpoint = 'https://gnqqktmslswgjtvxfvdo.supabase.co/functions/v1/debug-logger';
  }
  
  private async sendLog(level: LogEntry['level'], message: string, data?: any) {
    const logEntry: LogEntry = {
      timestamp: new Date().toISOString(),
      functionName: this.functionName,
      level,
      message,
      data
    };
    
    // Always log to console for Supabase dashboard
    const consoleMessage = `[${level}] [${this.functionName}] ${message}`;
    if (data) {
      console.log(consoleMessage, typeof data === 'object' ? JSON.stringify(data) : data);
    } else {
      console.log(consoleMessage);
    }
    
    // Try to send to debug endpoint (fire and forget)
    try {
      fetch(this.debugEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logEntry)
      }).catch(() => {
        // Silently ignore failures
      });
    } catch (error) {
      // Don't let logging failures break the function
    }
  }
  
  info(message: string, data?: any) {
    return this.sendLog('INFO', message, data);
  }
  
  error(message: string, data?: any) {
    return this.sendLog('ERROR', message, data);
  }
  
  debug(message: string, data?: any) {
    return this.sendLog('DEBUG', message, data);
  }
  
  warn(message: string, data?: any) {
    return this.sendLog('WARN', message, data);
  }
}