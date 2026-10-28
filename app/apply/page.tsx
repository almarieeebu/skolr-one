import ApplyWizard from "@/components/apply/ApplyWizard";
import { isDemoMode } from "@/lib/config";

export const metadata = { title: "Enroll online" };

// Public enrollment form, no login. With one school in the database, /apply is enough;
// otherwise use the school's link, e.g. /apply/SA.
export default function ApplyPage() {
  return <ApplyWizard code={null} demo={isDemoMode} emailRequired={!isDemoMode && !process.env.SUPABASE_SERVICE_ROLE_KEY} />;
}
