export function ingestChannelMessage(channel: string, message: any, setThreads: any) {
  setThreads((cur: any[]) => {
    const id = cur.find((t) => t.with === message.from)?.id || `${channel}-${Date.now()}`;
    const next = cur.find((t) => t.id === id)
      ? cur.map((t) =>
          t.id === id
            ? { ...t, thread: [...t.thread, { from: channel, at: new Date().toISOString(), text: message.text }] }
            : t
        )
      : [
          ...cur,
          {
            id,
            with: message.from,
            thread: [{ from: channel, at: new Date().toISOString(), text: message.text }],
          },
        ];
    return next;
  });
}
