import { chat, type ChatTurn } from "@/lib/assistant";

export const dynamic = "force-dynamic";

/** Streams one assistant reply as newline-delimited JSON events. */
export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const history: ChatTurn[] = Array.isArray(body.messages)
    ? body.messages
        .filter((m: ChatTurn) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.trim())
        .slice(-20)
        .map((m: ChatTurn) => ({ role: m.role, content: m.content.slice(0, 8000) }))
    : [];
  if (!history.length || history.at(-1)!.role !== "user") return Response.json({ error: "Send a message" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      for await (const event of chat(history)) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
