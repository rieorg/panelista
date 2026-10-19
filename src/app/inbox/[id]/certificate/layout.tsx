import type { Metadata } from "next";

// The page is a client component, so its title lives here. It also names the saved PDF.
export const metadata: Metadata = { title: "Certificate of Evaluation" };

export default function CertificateLayout({ children }: LayoutProps<"/inbox/[id]/certificate">) {
  return children;
}
