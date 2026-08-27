import type { Metadata } from "next";
import { TeacherSessionDetail } from "../../session-detail";

export const metadata: Metadata = {
  title: "Session · Teacher dashboard · Viva",
};

export default async function TeacherSessionPage({
  params,
}: {
  params: Promise<{ sessionId: string }>;
}) {
  const { sessionId } = await params;
  return <TeacherSessionDetail sessionId={sessionId} />;
}
