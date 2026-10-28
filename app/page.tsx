import EnrollmentApp from "@/components/EnrollmentApp";
import { isDemoMode } from "@/lib/config";

// The whole app lives on this one page.
export default function Home() {
  return <EnrollmentApp demo={isDemoMode} />;
}
