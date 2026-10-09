import OAuthTicketClient from "./OAuthTicketClient";

export const dynamic = "force-dynamic";
export const metadata = {
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};

export default async function OAuthTicketPage({ params }: { params: Promise<{ ticket: string }> }) {
  const { ticket } = await params;
  return <OAuthTicketClient ticket={ticket} />;
}
