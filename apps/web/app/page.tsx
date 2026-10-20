import { TutoringSession } from "@/components/TutoringSession";

export default function HomePage() {
  return (
    <main className="min-h-screen lg:h-dvh lg:overflow-hidden bg-[#0c0a09] text-[#faf8f5] p-2.5 sm:p-3.5 lg:p-4 flex flex-col justify-start">
      <TutoringSession />
    </main>
  );
}
