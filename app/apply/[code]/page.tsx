import ApplyWizard from "@/components/apply/ApplyWizard";
import { isDemoMode } from "@/lib/config";

export const metadata = { title: "Enroll online" };

// /apply/SA: the form of the school with that code.
export default async function ApplySchoolPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  return (
    <ApplyWizard
      code={decodeURIComponent(code)}
      demo={isDemoMode}
      emailRequired={!isDemoMode && !process.env.SUPABASE_SERVICE_ROLE_KEY}
    />
  );
}
