import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { SiteFooter } from "@/components/shell/nav";
import { Topbar } from "@/components/shell/topbar";
import { GridCursor } from "@/components/shell/grid-cursor";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  // Send anonymous visitors to the landing page, not a login form: the landing
  // page explains the product and carries its own sign-in links, so a stranger
  // is never dropped onto a dead end.
  if (!user) redirect("/");

  // Website layout: a single full-width header and a footer, with content
  // flowing between them. No fixed sidebar, no bottom bar, no drawer — those
  // are app patterns and they squeeze the content column on small screens.
  // `relative z-10` lifts content above the fixed cursor-grid layer.
  return (
    <div className="relative z-10 flex min-h-screen flex-col">
      <GridCursor />
      <Topbar />
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-6 pb-10 sm:px-6 lg:px-8">
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
