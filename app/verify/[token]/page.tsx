import VerifyClient from "./VerifyClient";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "ยืนยันตัวตน Discord",
  robots: { index: false, follow: false },
  // The link is a one-time secret, so the next page must not see it in a Referer header.
  referrer: "no-referrer" as const,
};

export default async function VerifyPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <VerifyClient token={token} />;
}
