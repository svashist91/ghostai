export type Message = { role: "user" | "ai" | "system"; content: string };
export type Session = { id: string; title: string; messages: Message[]; date: string };

