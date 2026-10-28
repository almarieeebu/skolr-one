import PortalApp from "@/components/portal/PortalApp";
import { isDemoMode } from "@/lib/config";

export const metadata = { title: "Applicant Portal" };

// Applicants follow their application here (its own simple layout and sign-in).
export default function PortalPage() {
  return <PortalApp demo={isDemoMode} />;
}
