"use client";

// The single page: header, list (left), student card (middle), actions (right).

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { DataStore, EnrollmentListItem, SessionInfo } from "@/lib/data/store";
import type { EnrollmentDetail, Role } from "@/lib/enrollment/types";
import { DemoStore } from "@/lib/data/demo-store";
import { SupabaseStore } from "@/lib/data/supabase-store";
import Header from "./Header";
import EnrollmentList from "./EnrollmentList";
import StudentCard from "./StudentCard";
import ActionBox from "./ActionBox";
import NewApplicationForm from "./NewApplicationForm";
import LoadPicker from "./LoadPicker";
import { Button, Drawer } from "./ui";

export default function EnrollmentApp({ demo }: { demo: boolean }) {
  const router = useRouter();
  // The store is created in the browser only (demo mode reads localStorage).
  const [store, setStore] = useState<DataStore | null>(null);
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [items, setItems] = useState<EnrollmentListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EnrollmentDetail | null>(null);
  const [drawer, setDrawer] = useState<"new" | "load" | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

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
        setSession(s);
        const list = await store.listEnrollments();
        setItems(list);
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

  const select = async (id: string | null) => {
    setSelectedId(id);
    setDetail(id && store ? await store.getDetail(id) : null);
  };

  const switchRole = async (role: Role) => {
    if (store instanceof DemoStore) {
      store.setRole(role);
      await refresh(selectedId);
    }
  };

  const resetDemo = async () => {
    if (store instanceof DemoStore) {
      store.reset();
      await refresh(null);
      setToast("Demo data reset.");
    }
  };

  const afterChange = async (message: string, id: string | null = selectedId) => {
    setToast(message);
    await refresh(id);
  };

  if (!store || !session) {
    return (
      <div className="grid min-h-dvh place-items-center text-sm text-muted">
        {error ? <p className="text-danger">{error}</p> : <p>Loading…</p>}
      </div>
    );
  }

  const role = session.actor.role;
  const canApply = role === "registrar" || role === "student" || role === "parent";

  return (
    <div className="flex min-h-dvh flex-col">
      <Header
        session={session}
        demo={store instanceof DemoStore}
        onRole={switchRole}
        onReset={resetDemo}
        onSignOut={async () => {
          await store.signOut();
          router.replace("/login");
        }}
      />

      <main className="mx-auto grid w-full max-w-[1500px] flex-1 grid-cols-[minmax(0,1fr)] content-start gap-4 px-4 py-4 lg:grid-cols-[340px_minmax(0,1fr)_320px] lg:px-6">
        {/* Left: list. Hidden on small screens while a student is open. */}
        <div className={`min-w-0 ${selectedId ? "hidden lg:block" : "block"}`}>
          <EnrollmentList
            items={items}
            role={role}
            selectedId={selectedId}
            onSelect={select}
            onNew={canApply ? () => setDrawer("new") : undefined}
          />
        </div>

        {/* Middle + right */}
        {detail ? (
          <>
            <div className="min-w-0 space-y-3">
              <Button variant="ghost" className="lg:hidden" onClick={() => select(null)}>
                ← Back to list
              </Button>
              <StudentCard
                key={`${detail.enrollment.id}-${detail.enrollment.status}`}
                detail={detail}
                session={session}
                store={store}
                onChanged={afterChange}
              />
            </div>
            <div className="min-w-0">
              <ActionBox
                key={`${detail.enrollment.id}-${detail.enrollment.updated_at}-${session.actor.role}`}
                detail={detail}
                session={session}
                store={store}
                onChanged={afterChange}
                onPickLoad={() => setDrawer("load")}
              />
            </div>
          </>
        ) : (
          <div className="hidden rounded-2xl border border-dashed border-line bg-surface/60 p-10 text-center text-sm text-muted lg:col-span-2 lg:grid lg:place-items-center">
            <div>
              <p className="text-base font-medium text-ink">Pick a student from the list</p>
              <p className="mt-1">Their progress, papers, load, fees and history show up here.</p>
            </div>
          </div>
        )}
      </main>

      <Drawer title="New application" open={drawer === "new"} onClose={() => setDrawer(null)}>
        <NewApplicationForm
          store={store}
          session={session}
          onDone={async (id) => {
            setDrawer(null);
            await afterChange("Application submitted.", id);
          }}
        />
      </Drawer>

      <Drawer
        title={detail?.enrollment.track === "k12" ? "Pick a section" : "Pick subjects"}
        open={drawer === "load" && !!detail}
        onClose={() => setDrawer(null)}
      >
        {detail && (
          <LoadPicker
            detail={detail}
            session={session}
            store={store}
            onDone={async () => {
              setDrawer(null);
              await afterChange("Load saved and fees assessed.");
            }}
          />
        )}
      </Drawer>

      {toast && (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full bg-ink px-4 py-2 text-sm text-white shadow-lg"
        >
          {toast}
        </div>
      )}
      {error && (
        <div role="alert" className="fixed bottom-16 left-1/2 z-50 -translate-x-1/2 rounded-lg bg-danger px-4 py-2 text-sm text-white">
          {error}
        </div>
      )}
    </div>
  );
}
