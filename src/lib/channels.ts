export function ingestChannelMessage(
  channel: string,
  message: any,
  setThreads: (fn: any) => void
) {
  setThreads((cur: any[]) => {
    const id = `${channel}-${message.from}`;
    const exists = cur.find((t) => t.id === id);
    const newMsg = {
      from: message.from,
      at: new Date().toISOString(),
      text: message.text,
      channel,
    };
    if (exists) {
      return cur.map((t) =>
        t.id === id ? { ...t, thread: [...t.thread, newMsg] } : t
      );
    }
    return [
      ...cur,
      {
        id,
        with: message.from,
        thread: [newMsg],
      },
    ];
  });
}
