import { SessionScreen } from "@/components/session-screen";

export default async function SessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <SessionScreen sessionId={sessionId} />;
}
