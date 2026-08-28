import type { ReactNode } from "react";
import { TeacherShell } from "./teacher-shell";

export default function TeacherLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 py-12">
      <TeacherShell>{children}</TeacherShell>
    </div>
  );
}
