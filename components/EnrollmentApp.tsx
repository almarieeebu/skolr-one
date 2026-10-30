"use client";

// The single page: rail (modules) | list | detail. See docs/design.md.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { ClassListItem, DataStore, EnrollmentListItem, SessionInfo } from "@/lib/data/store";
import { fullName } from "@/lib/data/store";
import type { EnrollmentDetail, Role } from "@/lib/enrollment/types";
import { DemoStore } from "@/lib/data/demo-store";
import { demoUserByRole } from "@/lib/data/seed";
import { SupabaseStore } from "@/lib/data/supabase-store";
import Shell, { DetailPane, useWorkspaceKeys, type ModuleTab } from "./shell/Shell";
import EnrollmentList, { inModule, waitsIn, type ListModule } from "./EnrollmentList";
import { KeyFacts, StudentHeader, StudentTabBody, StudentTabs, defaultTab, relevantTabs, type DetailTab } from "./StudentCard";
import ActionBox from "./ActionBox";
import NewApplicationForm from "./NewApplicationForm";
import PasswordForm from "./PasswordForm";
import Statement from "./Statement";
import ClassList from "./ClassList";
import ClassWorkspace from "./ClassWorkspace";
import { SetupDetail, SetupList, type SetupId } from "./SetupModule";
import { feePermissions } from "@/lib/fees";
import { Button, EmptyState, SidePanel, Toast, inputClass } from "./ui";

type ModuleId =
  | "enrollment"
  | "applicants"
  | "cashier"
  | "grades"
  | "setup"
  | "classes"
  | "students"
  | "my"
  | "fees"
  | "mygrades"
  | "requests";

const MODULE_DEF: Record<ModuleId, Omit<ModuleTab, "id" | "waiting">> = {
  enrollment: { label: "Enrollment", icon: "enrollment" },
  applicants: { label: "Applicants", icon: "applicants" },
  cashier: { label: "Cashier", icon: "cashier" },
  grades: { label: "Grades", icon: "grades" },
  setup: { label: "Setup", icon: "setup" },
  classes: { label: "Classes", icon: "classes" },
  students: { label: "Students", icon: "students" },
  my: { label: "Enrollment", icon: "enrollment" },
  fees: { label: "Fees", icon: "fees" },
  mygrades: { label: "Grades", icon: "grades" },
  requests: { label: "Requests", icon: "messages" },
};

const MODULES: Record<Role, ModuleId[]> = {
  registrar: ["enrollment", "applicants", "cashier", "grades", "setup"],
  cashier: ["cashier", "enrollment"],
  dean: ["enrollment", "grades"],
  teacher: ["classes", "students"],
  student: ["my", "fees", "mygrades", "requests"],
  parent: ["my", "fees", "mygrades", "requests"],
  applicant: ["my", "requests"],
};

const LIST_OF: Partial<Record<ModuleId, ListModule>> = {
  enrollment: "enrollment",
  applicants: "applicants",
  cashier: "cashier",
  students: "students",
  my: "family",
  fees: "family",
  mygrades: "family",
  requests: "family",
};

/** Family modules show one fixed set of tabs. */
const FAMILY_TABS: Partial<Record<ModuleId, DetailTab[]>> = {
  my: ["profile", "papers", "load", "history"],
  fees: ["fees"],
  mygrades: ["grades"],
  requests: ["requests"],
};

const DEMO_ROLES: { role: Role; label: string }[] = [
  { role: "registrar", label: "Registrar" },
  { role: "cashier", label: "Cashier" },
  { role: "student", label: "Student" },
  { role: "parent", label: "Parent" },
  { role: "teacher", label: "Teacher" },
  // Opens the applicant portal as the sample applicant (Kevin Navarro).
  { role: "applicant", label: "Applicant" },
];

function useIsDesktop() {
  const [desk, setDesk] = useState(true);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const on = () => setDesk(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return desk;
}

export default function EnrollmentApp({ demo }: { demo: boolean }) {
  const router = useRouter();
  const desktop = useIsDesktop();
  // The store is created in the browser only (demo mode reads localStorage).
  const [store, setStore] = useState<DataStore | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [items, setItems] = useState<EnrollmentListItem[]>([]);
  const [classes, setClasses] = useState<ClassListItem[]>([]);
  const [module, setModule] = useState<ModuleId>("enrollment");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EnrollmentDetail | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  const [setupId, setSetupId] = useState<SetupId | null>(null);
  /** Phones: the detail view is open (else the list). */
  const [phoneDetail, setPhoneDetail] = useState(false);
  /** Last sub-tab the user picked, per module. */
  const [tabMemory, setTabMemory] = useState<Partial<Record<ModuleId, DetailTab>>>({});
  const [newOpen, setNewOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    setStore(demo ? new DemoStore() : new SupabaseStore());
  }, [demo]);

  const refresh = useCallback(
    async (keepId?: string | null) => {
      if (!store) return;
      try {
        const s = await store.getSession();
        if (!s) {
          router.replace("/login");
          return;
        }
        // Applicants use their own portal.
        if (s.actor.role === "applicant") {
          router.replace("/portal");
          return;
        }
        setSession(s);
        const [list, cls] = await Promise.all([store.listEnrollments(), store.listClasses()]);
        setItems(list);
        setClasses(cls);
        setClassId((c) => (c && cls.some((x) => x.offering_id === c) ? c : null));
        setModule((m) => (MODULES[s.actor.role].includes(m) ? m : MODULES[s.actor.role][0]));
        const id = keepId === undefined ? selectedId : keepId;
        const still = id && list.some((i) => i.id === id) ? id : null;
        setSelectedId(still);
        setDetail(still ? await store.getDetail(still) : null);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [store, router, selectedId],
  );

  useEffect(() => {
    void refresh();
    // Only on store creation; later refreshes are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [store]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  const role = session?.actor.role ?? "registrar";
  const listModule = LIST_OF[module];
  const moduleItems = useMemo(() => (listModule ? items.filter((i) => inModule(listModule, i)) : []), [items, listModule]);
  const isFamily = role === "student" || role === "parent";
  const showList = !isFamily || items.length > 1;

  const select = useCallback(
    async (id: string | null, openOnPhone = true) => {
      setSelectedId(id);
      if (openOnPhone) setPhoneDetail(!!id);
      setDetail(id && store ? await store.getDetail(id) : null);
    },
    [store],
  );

  // Keep something open in the detail pane: on desktop the first item of the
  // module (waiting items come first); a single family enrollment everywhere.
  useEffect(() => {
    if (!session) return;
    if (module === "grades" || module === "classes") {
      if (!classId && desktop && classes.length) {
        const first = classes.find((c) => c.waiting) ?? classes.find((c) => c.students > 0) ?? classes[0];
        setClassId(first.offering_id);
      }
      return;
    }
    if (module === "setup") {
      if (!setupId && desktop) setSetupId("fees");
      return;
    }
    if (!listModule) return;
    const inList = selectedId && moduleItems.some((i) => i.id === selectedId);
    if (inList) return;
    if (isFamily && items.length === 1) {
      void select(items[0].id, false);
      setPhoneDetail(true);
    } else if (desktop && moduleItems.length) {
      void select(moduleItems[0].id, false);
    } else if (selectedId) {
      void select(null, false);
    }
  }, [session, module, moduleItems, selectedId, desktop, classes, classId, setupId, listModule, isFamily, items, role, select]);

  const switchRole = async (r: Role) => {
    if (r === "applicant") {
      // Demo: the applicant portal, signed in as the sample applicant.
      DemoStore.openPortalAs(demoUserByRole.applicant);
      router.push("/portal");
      return;
    }
    if (store instanceof DemoStore) {
      store.setRole(r);
      setModule(MODULES[r][0]);
      setClassId(null);
      setPhoneDetail(false);
      await refresh(selectedId);
      // Pick a class again from the new role's list.
      setClassId(null);
    }
  };

  const resetDemo = async () => {
    if (store instanceof DemoStore) {
      store.reset();
      await refresh(null);
      setToast("Demo data reset");
    }
  };

  const afterChange = async (message: string, id: string | null = selectedId) => {
    setToast(message);
    await refresh(id);
  };

  const goModule = (m: string) => {
    setModule(m as ModuleId);
    setPhoneDetail(false);
  };

  // Sub-tabs: "[" and "]" move between the tabs of the open detail.
  const cycleTabs = (dir: 1 | -1) => {
    const list = document.querySelector<HTMLElement>("main [data-subtabs]");
    if (!list) return;
    const tabs = [...list.querySelectorAll<HTMLElement>('[role="tab"]')];
    const i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    next?.click();
  };
  useWorkspaceKeys({ searchRef, listRef, onPrevTab: () => cycleTabs(-1), onNextTab: () => cycleTabs(1) });

  if (!store || !session) {
    return (
      <div className="grid h-dvh place-items-center text-sm text-muted">
        {error ? <p className="text-stop">{error}</p> : <p>Loading</p>}
      </div>
    );
  }

  const canApply = role === "registrar" || role === "student" || role === "parent";
  const fees = feePermissions(role);
  const modules: ModuleTab[] = MODULES[role].map((id) => {
    const lm = LIST_OF[id];
    const waiting =
      id === "grades" || id === "classes"
        ? classes.filter((c) => c.waiting).length
        : lm && !isFamily
          ? items.filter((i) => inModule(lm, i) && waitsIn(lm, role, i)).length
          : id === "my"
            ? items.filter((i) => i.waiting).length
            : 0;
    return { id, ...MODULE_DEF[id], label: isFamily && id === "my" ? "Enrollment" : MODULE_DEF[id].label, waiting };
  });

  // ---------- list column ----------
  let list: React.ReactNode = undefined;
  if (module === "grades" || module === "classes") {
    list = (
      <ClassList
        key={`${role}-${module}`}
        items={classes}
        role={role}
        selectedId={classId}
        onSelect={(id) => {
          setClassId(id);
          setPhoneDetail(true);
        }}
        searchRef={searchRef}
        listRef={listRef}
      />
    );
  } else if (module === "setup") {
    list = (
      <SetupList
        selected={setupId}
        onSelect={(id) => {
          setSetupId(id);
          setPhoneDetail(true);
        }}
        listRef={listRef}
      />
    );
  } else if (listModule && showList) {
    list = (
      <EnrollmentList
        key={`${role}-${module}`}
        module={listModule}
        items={items}
        role={role}
        selectedId={selectedId}
        onSelect={(id) => void select(id)}
        onNew={canApply && (module === "enrollment" || isFamily) ? () => setNewOpen(true) : undefined}
        searchRef={searchRef}
        listRef={listRef}
      />
    );
  }

  // ---------- detail ----------
  let detailPane: React.ReactNode;
  const back = () => setPhoneDetail(false);
  if (module === "grades" || module === "classes") {
    detailPane = classId ? (
      <ClassWorkspace key={classId} store={store} session={session} offeringId={classId} onBack={back} onChanged={(msg) => void afterChange(msg)} />
    ) : (
      <EmptyState title={role === "teacher" ? "Pick a class" : "Pick a class to review"}>
        {role === "teacher"
          ? "Its grade sheet opens here. Type grades, save a draft and submit."
          : "Approve or return submitted grade sheets and decide change requests."}
      </EmptyState>
    );
  } else if (module === "setup") {
    detailPane = setupId ? (
      <SetupDetail id={setupId} store={store} session={session} onChanged={(m) => void afterChange(m)} onBack={back} />
    ) : (
      <EmptyState title="Pick a settings group">Fee setup, grade settings, terms and term closing open here.</EmptyState>
    );
  } else if (detail && moduleItems.some((i) => i.id === detail.enrollment.id)) {
    const fixed = isFamily ? FAMILY_TABS[module] : undefined;
    const tabs = fixed ?? relevantTabs(detail, role);
    const prefer: DetailTab[] | undefined =
      module === "cashier" ? ["fees"] : module === "applicants" ? (detail.requests ?? []).some((r) => r.status === "open") ? ["requests"] : ["papers"] : undefined;
    const remembered = tabMemory[module];
    const tab = remembered && tabs.includes(remembered) ? remembered : defaultTab(detail, tabs, prefer);
    detailPane = (
      <DetailPane
        key={detail.enrollment.id}
        onBack={showList ? back : undefined}
        backLabel={MODULE_DEF[module].label}
        header={
          <StudentHeader
            detail={detail}
            session={session}
            aside={
              isFamily && !showList && canApply ? (
                <Button variant="secondary" size="sm" onClick={() => setNewOpen(true)} data-testid="new-application">
                  New application
                </Button>
              ) : undefined
            }
          />
        }
        tabs={<StudentTabs detail={detail} tabs={tabs} tab={tab} onTab={(t) => setTabMemory((m) => ({ ...m, [module]: t }))} role={role} />}
        panelId="detail-panel"
        labelledBy={`detail-tab-${tab}`}
        dock={
          <ActionBox
            key={`${detail.enrollment.id}-${detail.enrollment.updated_at}-${role}`}
            detail={detail}
            session={session}
            store={store}
            onChanged={afterChange}
          />
        }
        testId="enrollment-detail"
      >
        {tab === "fees" || tab === "profile" || tab === "grades" ? (
          <StudentTabBody tab={tab} detail={detail} session={session} store={store} onChanged={afterChange} />
        ) : (
          <div className="grid gap-10 xl:grid-cols-[minmax(0,1fr)_260px]">
            <div className="min-w-0">
              <StudentTabBody tab={tab} detail={detail} session={session} store={store} onChanged={afterChange} />
            </div>
            <KeyFacts detail={detail} />
          </div>
        )}
      </DetailPane>
    );
  } else if (isFamily && items.length === 0) {
    detailPane = (
      <EmptyState
        title="No enrollment yet"
        action={canApply ? <Button onClick={() => setNewOpen(true)} data-testid="new-application">New application</Button> : undefined}
      >
        Start an application for this school year. You can upload papers after you send it.
      </EmptyState>
    );
  } else {
    detailPane = (
      <EmptyState title={moduleItems.length ? "Pick a student from the list" : "Nothing to open"}>
        {moduleItems.length
          ? "Their progress, papers, load, fees and history open here."
          : module === "applicants"
            ? "New online applications and applicant requests show up in this list."
            : module === "cashier"
              ? "Students with a balance show up here once their load is set."
              : "Enrollments show up here."}
      </EmptyState>
    );
  }

  const isDemo = store instanceof DemoStore;
  const roles = session.school.settings.use_dean_approval ? [...DEMO_ROLES, { role: "dean" as Role, label: "Dean" }] : DEMO_ROLES;

  return (
    <>
      <Shell
        school={session.school}
        modules={modules}
        active={module}
        onModule={goModule}
        user={{ name: session.actor.name, role }}
        showDetailOnPhone={phoneDetail || !showList}
        list={list}
        detail={detailPane}
        menu={(close) => (
          <div className="space-y-3">
            {isDemo ? (
              <>
                <label className="block">
                  <span className="mb-1 block text-xs font-medium text-muted">Viewing as (demo)</span>
                  <select
                    data-testid="role-switcher"
                    aria-label="Switch role"
                    className={inputClass}
                    value={role}
                    onChange={(e) => {
                      close();
                      void switchRole(e.target.value as Role);
                    }}
                  >
                    {roles.map((r) => (
                      <option key={r.role} value={r.role}>{r.label}</option>
                    ))}
                  </select>
                </label>
                <p className="text-xs text-muted">Demo mode: data lives in this browser.</p>
                <div className="flex gap-2 border-t border-line pt-3">
                  <Button variant="secondary" size="sm" className="flex-1" onClick={() => { close(); void resetDemo(); }} data-testid="reset-demo">
                    Reset demo
                  </Button>
                  <a href="/apply" className="inline-flex min-h-8 flex-1 items-center justify-center rounded-md border border-line px-3 text-xs font-semibold hover:bg-hover">
                    Online form
                  </a>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted break-all">{session.email}</p>
            )}
            <Button variant="secondary" size="sm" className="w-full" data-testid="change-password" onClick={() => { close(); setPwOpen(true); }}>
              Change password
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              data-testid="sign-out"
              onClick={async () => {
                close();
                await store.signOut();
                router.replace("/login");
              }}
            >
              Sign out
            </Button>
          </div>
        )}
      />

      <SidePanel title="New application" subtitle={session.school.name} open={newOpen} onClose={() => setNewOpen(false)} testId="new-application-panel">
        <NewApplicationForm
          store={store}
          session={session}
          onDone={async (id) => {
            setNewOpen(false);
            if (!["enrollment", "my"].includes(module)) setModule(isFamily ? "my" : "enrollment");
            setPhoneDetail(true);
            await afterChange("Application saved", id);
          }}
        />
      </SidePanel>

      <SidePanel title="Change password" subtitle={isDemo ? `${session.actor.name} (demo)` : session.email} open={pwOpen} onClose={() => setPwOpen(false)} testId="password-panel">
        <PasswordForm
          onSave={(next) => store.changePassword(next)}
          onDone={() => {
            setPwOpen(false);
            void afterChange("Password changed.");
          }}
          note={isDemo ? "Demo mode: this only changes the practice password in this browser." : undefined}
        />
      </SidePanel>

      {toast && <Toast message={toast} />}
      {error && <Toast message={error} tone="stop" />}

      {/* Print only: the statement of account of the open student. */}
      {detail && fees.view && listModule && (
        <div className="hidden print:block" data-print-doc="statement">
          <Statement detail={detail} session={session} />
        </div>
      )}
      <span className="sr-only" aria-live="polite">{detail ? `Open: ${fullName(detail.student)}` : ""}</span>
    </>
  );
}
