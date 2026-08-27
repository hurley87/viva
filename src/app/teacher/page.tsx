import type { Metadata } from "next";
import { TeacherSessionList } from "./session-list";

export const metadata: Metadata = {
  title: "Teacher dashboard · Viva",
};

export default function TeacherDashboardPage() {
  return <TeacherSessionList />;
}
