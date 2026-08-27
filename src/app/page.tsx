import { AuthPanel } from "@/components/auth-panel";
import { ConvexStatus } from "@/components/convex-status";
import { StartSession } from "@/components/start-session";
import { TeacherHomeLink } from "./teacher/home-link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6">
      <main className="flex max-w-xl flex-col gap-4">
        <h1 className="text-3xl font-semibold tracking-tight">Viva</h1>
        <p className="text-lg leading-7 text-zinc-600 dark:text-zinc-400">
          A Teacher defines an Assignment and private Standard. A Student
          responds in a live voice Session. The transcript is assessed against
          that Standard.
        </p>
        <AuthPanel />
        <StartSession />
        <TeacherHomeLink />
        <ConvexStatus />
      </main>
    </div>
  );
}
