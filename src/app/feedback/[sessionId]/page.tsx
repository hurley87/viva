import { SessionFeedback } from "./session-feedback";

export default async function SessionFeedbackPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <SessionFeedback sessionId={sessionId} />;
}
